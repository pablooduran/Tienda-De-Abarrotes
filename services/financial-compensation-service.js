const crypto = require('crypto');
const pool = require('../config/db');
const {
  COLLECTION_COMPENSATION_TYPES,
  COLLECTION_PAYMENT_METHODS,
  COMPENSATION_REASONS,
  OPERATION_KEY_PATTERN,
  SALE_PAYMENT_METHODS
} = require('../config/compensation-contract');
const { stockError } = require('./stock-movement-service');
const { formatLocalDateTime } = require('../utils/local-datetime');

const MAX_MONEY_CENTS = 9999999999;

function positiveId(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    throw stockError(400, `${label} no es valido.`, 'INVALID_COMPENSATION_REFERENCE');
  }
  return number;
}

function moneyToCents(value, label, { allowZero = true } = {}) {
  const number = Number(value);
  const cents = Math.round(number * 100);
  if (!Number.isFinite(number) || !Number.isSafeInteger(cents)
    || cents < (allowZero ? 0 : 1) || cents > MAX_MONEY_CENTS) {
    throw stockError(409, `${label} no es valido.`, 'FINANCIAL_HISTORY_INCONSISTENT');
  }
  return cents;
}

function centsToDecimal(cents) {
  return (cents / 100).toFixed(2);
}

function cleanText(value, maximum, label) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  if (text.length > maximum) {
    throw stockError(400, `${label} no puede superar ${maximum} caracteres.`,
      'INVALID_COMPENSATION_TEXT');
  }
  return text;
}

function normalizeCommonRequest(body, identity) {
  const source = body && typeof body === 'object' ? body : {};
  if (source.confirmar !== true) {
    throw stockError(400, 'Debe confirmar expresamente la operacion financiera.',
      'FINANCIAL_COMPENSATION_CONFIRMATION_REQUIRED');
  }
  const key = String(source.claveOperacion || '').trim();
  if (!OPERATION_KEY_PATTERN.test(key)) {
    throw stockError(400, 'La clave de operacion no es valida.', 'INVALID_OPERATION_KEY');
  }
  const reason = String(source.motivoCodigo || '').trim().toLowerCase();
  if (!COMPENSATION_REASONS.includes(reason)) {
    throw stockError(400, 'El motivo de la compensacion no es valido.',
      'INVALID_COMPENSATION_REASON');
  }
  const observation = cleanText(source.observacion, 1000, 'La observacion');
  if (reason === 'otro_controlado' && (!observation || observation.length < 8)) {
    throw stockError(400, 'El motivo otro_controlado requiere una observacion suficiente.',
      'COMPENSATION_OBSERVATION_REQUIRED');
  }
  return {
    key,
    reason,
    observation,
    source,
    fingerprintBase: { ...identity, claveOperacion: key, motivoCodigo: reason, observacion: observation }
  };
}

function requestFingerprint(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function normalizeMethodDestination(source, methods) {
  const method = String(source.metodoPagoDestino || source.metodoDestino || '').trim().toLowerCase();
  if (!methods.includes(method)) {
    throw stockError(400, 'El metodo de pago de destino no es valido.',
      'INVALID_DESTINATION_PAYMENT_METHOD');
  }
  let receivedCents = null;
  if (source.montoRecibidoDestino !== undefined && source.montoRecibidoDestino !== null
    && source.montoRecibidoDestino !== '') {
    receivedCents = moneyToCents(
      source.montoRecibidoDestino,
      'El monto recibido de destino',
      { allowZero: false }
    );
  }
  return {
    method,
    receivedCents,
    reference: cleanText(source.referenciaDestino, 160, 'La referencia de destino')
  };
}

function normalizeSettlementRequest(idLiquidacion, body) {
  const id = positiveId(idLiquidacion, 'La liquidacion');
  const common = normalizeCommonRequest(body, {
    accion: 'resolver_liquidacion_venta',
    idLiquidacionCompensacionVenta: id
  });
  return {
    idLiquidacionCompensacionVenta: id,
    tipoOperacion: 'correccion_saldo',
    claveOperacion: common.key,
    motivoCodigo: common.reason,
    observacion: common.observation,
    huellaSolicitud: requestFingerprint(common.fingerprintBase)
  };
}

function normalizeCollectionRequest(idCobro, body) {
  const id = positiveId(idCobro, 'El cobro');
  const common = normalizeCommonRequest(body, {
    accion: 'compensar_cobro_fiado',
    idCobroFiado: id
  });
  const type = String(common.source.tipoCompensacion || common.source.tipo || '')
    .trim().toLowerCase();
  if (!COLLECTION_COMPENSATION_TYPES.includes(type)) {
    throw stockError(400, 'El tipo de compensacion del cobro no es valido.',
      'INVALID_COLLECTION_COMPENSATION_TYPE');
  }
  const destination = type === 'correccion_metodo'
    ? normalizeMethodDestination(common.source, COLLECTION_PAYMENT_METHODS)
    : null;
  const fingerprintBase = {
    ...common.fingerprintBase,
    tipoCompensacion: type,
    metodoDestino: destination?.method || null,
    montoRecibidoDestino: destination?.receivedCents ?? null,
    referenciaDestino: destination?.reference || null
  };
  return {
    idCobroFiado: id,
    tipoOperacion: type === 'correccion_metodo'
      ? 'correccion_pago_venta'
      : 'anulacion_cobro_fiado',
    tipoCompensacion: type,
    destination,
    claveOperacion: common.key,
    motivoCodigo: common.reason,
    observacion: common.observation,
    huellaSolicitud: requestFingerprint(fingerprintBase)
  };
}

function normalizePaymentMethodRequest(idPagoVenta, body) {
  const id = positiveId(idPagoVenta, 'El pago de venta');
  const common = normalizeCommonRequest(body, {
    accion: 'corregir_metodo_pago_venta',
    idPagoVenta: id
  });
  const destination = normalizeMethodDestination(common.source, SALE_PAYMENT_METHODS);
  return {
    idPagoVenta: id,
    tipoOperacion: 'correccion_pago_venta',
    destination,
    claveOperacion: common.key,
    motivoCodigo: common.reason,
    observacion: common.observation,
    huellaSolicitud: requestFingerprint({
      ...common.fingerprintBase,
      metodoDestino: destination.method,
      montoRecibidoDestino: destination.receivedCents,
      referenciaDestino: destination.reference
    })
  };
}

async function lockOperation(connection, input, request, now) {
  const [insert] = await connection.query(
    `INSERT INTO operacionCompensatoria
     (idTienda, tipoOperacion, estado, motivoCodigo, observacion, requiereAprobacion,
      idAdministradorSolicitante, idAdministradorAprobador, claveOperacion,
      huellaSolicitud, fechaSolicitud, fechaAprobacion, fechaAplicacion, creadoEn, actualizadoEn)
     VALUES (?, ?, 'solicitada', ?, ?, 0, ?, NULL, ?, ?, ?, NULL, NULL, ?, ?)
     ON DUPLICATE KEY UPDATE idOperacionCompensatoria=LAST_INSERT_ID(idOperacionCompensatoria)`,
    [input.idTienda, request.tipoOperacion, request.motivoCodigo, request.observacion,
      input.idAdministrador, request.claveOperacion, request.huellaSolicitud, now, now, now]
  );
  const idOperacionCompensatoria = Number(insert.insertId);
  const [rows] = await connection.query(
    `SELECT idOperacionCompensatoria, tipoOperacion, estado, huellaSolicitud
     FROM operacionCompensatoria
     WHERE idTienda=? AND idOperacionCompensatoria=?
     FOR UPDATE`,
    [input.idTienda, idOperacionCompensatoria]
  );
  const operation = rows[0];
  if (!operation) {
    throw stockError(500, 'No se pudo bloquear la operacion financiera.',
      'FINANCIAL_OPERATION_LOCK_FAILED');
  }
  if (operation.tipoOperacion !== request.tipoOperacion
    || operation.huellaSolicitud !== request.huellaSolicitud) {
    throw stockError(409, 'La clave de operacion ya fue utilizada con otra solicitud.',
      'OPERATION_KEY_CONFLICT');
  }
  return operation;
}

async function markOperationApplied(connection, idTienda, idOperacionCompensatoria, now) {
  const [result] = await connection.query(
    `UPDATE operacionCompensatoria
     SET estado='aplicada', fechaAplicacion=?, actualizadoEn=?
     WHERE idTienda=? AND idOperacionCompensatoria=? AND estado='solicitada'`,
    [now, now, idTienda, idOperacionCompensatoria]
  );
  if (result.affectedRows !== 1) {
    throw stockError(409, 'La operacion financiera cambio durante su aplicacion.',
      'COMPENSATION_STATE_CONFLICT');
  }
}

async function originalPeriodIsClosed(connection, idTienda, dateTime) {
  const [rows] = await connection.query(
    `SELECT idCierreCaja
     FROM cierreCaja
     WHERE idTienda=? AND estado='cerrado' AND fechaInicio<=? AND fechaFin>=?
     ORDER BY idCierreCaja
     FOR UPDATE`,
    [idTienda, dateTime, dateTime]
  );
  return rows.length > 0;
}

async function assertNoPendingSaleSettlements(connection, idTienda, saleIds) {
  const ids = [...new Set((saleIds || []).map(Number).filter((id) => id > 0))]
    .sort((left, right) => left - right);
  if (!ids.length) return;
  const [rows] = await connection.query(
    `SELECT cv.idVenta
     FROM compensacionVenta cv
     JOIN liquidacionCompensacionVenta lcv
       ON lcv.idTienda=cv.idTienda
      AND lcv.idCompensacionVenta=cv.idCompensacionVenta
     WHERE cv.idTienda=? AND cv.idVenta IN (?) AND lcv.estado='pendiente_c3'
     ORDER BY cv.idVenta, lcv.idLiquidacionCompensacionVenta
     FOR UPDATE`,
    [idTienda, ids]
  );
  if (rows.length) {
    throw stockError(409,
      'La venta tiene una liquidacion compensatoria pendiente de resolver.',
      'SALE_SETTLEMENT_PENDING');
  }
}

async function assertPaymentsNotCommittedToRefund(connection, idTienda, paymentIds) {
  const ids = [...new Set((paymentIds || []).map(Number).filter((id) => id > 0))]
    .sort((left, right) => left - right);
  if (!ids.length) return;
  const [rows] = await connection.query(
    `SELECT dorp.idPagoVenta
     FROM detalleObligacionReembolsoPago dorp
     WHERE dorp.idTienda=? AND dorp.idPagoVenta IN (?)
     ORDER BY dorp.idPagoVenta
     FOR UPDATE`,
    [idTienda, ids]
  );
  if (rows.length) {
    throw stockError(409,
      'El pago respalda una obligacion de reembolso y no puede compensarse otra vez.',
      'PAYMENT_COMMITTED_TO_REFUND');
  }
}

function salePaymentState(balanceCents, paidCents) {
  if (balanceCents === 0) return 'pagada';
  return paidCents > 0 ? 'parcial' : 'pendiente';
}

async function loadSettlementResult(connection, idTienda, idOperacionCompensatoria, repeated) {
  const [rows] = await connection.query(
    `SELECT rlv.idResolucionLiquidacionVenta, rlv.idLiquidacionCompensacionVenta,
            rlv.idFiado, rlv.montoReduccionDeuda, rlv.montoReembolso,
            rlv.periodoOriginalCerrado, rlv.creadoEn,
            ore.idObligacionReembolsoVenta, ore.estado estadoReembolso, ore.monto montoReembolsoRegistrado,
            lcv.estado estadoLiquidacion, cv.idVenta
     FROM resolucionLiquidacionVenta rlv
     JOIN liquidacionCompensacionVenta lcv
       ON lcv.idTienda=rlv.idTienda
      AND lcv.idLiquidacionCompensacionVenta=rlv.idLiquidacionCompensacionVenta
     JOIN compensacionVenta cv
       ON cv.idTienda=lcv.idTienda
      AND cv.idCompensacionVenta=lcv.idCompensacionVenta
     LEFT JOIN obligacionReembolsoVenta ore
       ON ore.idTienda=rlv.idTienda
      AND ore.idResolucionLiquidacionVenta=rlv.idResolucionLiquidacionVenta
     WHERE rlv.idTienda=? AND rlv.idOperacionCompensatoria=?`,
    [idTienda, idOperacionCompensatoria]
  );
  if (!rows.length) {
    throw stockError(409, 'La operacion existente no tiene una resolucion completa.',
      'COMPENSATION_RESULT_INCOMPLETE');
  }
  const result = rows[0];
  const [refundDetails] = result.idObligacionReembolsoVenta === null
    ? [[]]
    : await connection.query(
      `SELECT idPagoVenta, metodoOriginal, monto
       FROM detalleObligacionReembolsoPago
       WHERE idTienda=? AND idObligacionReembolsoVenta=?
       ORDER BY idDetalleObligacionReembolsoPago`,
      [idTienda, result.idObligacionReembolsoVenta]
    );
  return {
    idOperacionCompensatoria,
    idResolucionLiquidacionVenta: Number(result.idResolucionLiquidacionVenta),
    idLiquidacionCompensacionVenta: Number(result.idLiquidacionCompensacionVenta),
    idVenta: Number(result.idVenta),
    idFiado: result.idFiado === null ? null : Number(result.idFiado),
    montoReduccionDeuda: result.montoReduccionDeuda,
    montoReembolso: result.montoReembolso,
    periodoOriginalCerrado: Number(result.periodoOriginalCerrado) === 1,
    estadoLiquidacion: result.estadoLiquidacion,
    obligacionReembolso: result.idObligacionReembolsoVenta === null ? null : {
      idObligacionReembolsoVenta: Number(result.idObligacionReembolsoVenta),
      monto: result.montoReembolsoRegistrado,
      estado: result.estadoReembolso,
      pagos: refundDetails.map((detail) => ({
        idPagoVenta: Number(detail.idPagoVenta),
        metodoOriginal: detail.metodoOriginal,
        monto: detail.monto
      }))
    },
    repetida: repeated
  };
}

async function lockRefundablePayments(connection, idTienda, idVenta) {
  const [payments] = await connection.query(
    `SELECT pv.idPagoVenta, pv.monto,
            CASE
              WHEN pv.idPagoFiado IS NOT NULL
                THEN COALESCE(ccf.metodoDestino, cf.metodoPago, pv.metodoPago)
              ELSE COALESCE(cpv.metodoDestino, pv.metodoPago)
            END metodoEfectivo
     FROM pagoVenta pv
     LEFT JOIN compensacionPagoVenta cpv
       ON cpv.idTienda=pv.idTienda AND cpv.idPagoVenta=pv.idPagoVenta
     LEFT JOIN pagoFiado pf
       ON pf.idTienda=pv.idTienda AND pf.idPagoFiado=pv.idPagoFiado
     LEFT JOIN cobroFiado cf
       ON cf.idTienda=pf.idTienda AND cf.idCobroFiado=pf.idCobroFiado
     LEFT JOIN compensacionCobroFiado ccf
       ON ccf.idTienda=cf.idTienda
      AND ccf.idCobroFiado=cf.idCobroFiado
      AND ccf.tipoCompensacion='correccion_metodo'
     LEFT JOIN detalleCompensacionCobro dcc
       ON dcc.idTienda=pv.idTienda AND dcc.idPagoVenta=pv.idPagoVenta
     WHERE pv.idTienda=? AND pv.idVenta=?
       AND dcc.idDetalleCompensacionCobro IS NULL
     ORDER BY pv.creadoEn DESC, pv.idPagoVenta DESC
     FOR UPDATE`,
    [idTienda, idVenta]
  );
  return payments;
}

async function executeSettlementResolution(connection, input, request, runtime) {
  const [settlements] = await connection.query(
    `SELECT lcv.idLiquidacionCompensacionVenta, lcv.idCompensacionVenta,
            lcv.montoCompensado AS montoLiquidacion,
            lcv.montoReduccionDeudaPendiente,
            lcv.montoReembolsoPendiente, lcv.estado,
            cv.idVenta, v.fecha, v.total, v.montoPagado,
            v.montoCompensado AS montoCompensadoVenta,
            v.saldoPendiente
     FROM liquidacionCompensacionVenta lcv
     JOIN compensacionVenta cv
       ON cv.idTienda=lcv.idTienda
      AND cv.idCompensacionVenta=lcv.idCompensacionVenta
     JOIN venta v ON v.idTienda=cv.idTienda AND v.idVenta=cv.idVenta
     WHERE lcv.idTienda=? AND lcv.idLiquidacionCompensacionVenta=?
     FOR UPDATE`,
    [input.idTienda, request.idLiquidacionCompensacionVenta]
  );
  if (!settlements.length) {
    throw stockError(404, 'Liquidacion compensatoria no encontrada.',
      'SALE_SETTLEMENT_NOT_FOUND');
  }
  const settlement = settlements[0];
  const now = formatLocalDateTime(runtime.now());
  const operation = await lockOperation(connection, input, request, now);
  const [existing] = await connection.query(
    `SELECT idResolucionLiquidacionVenta
     FROM resolucionLiquidacionVenta
     WHERE idTienda=? AND idOperacionCompensatoria=?
     FOR UPDATE`,
    [input.idTienda, operation.idOperacionCompensatoria]
  );
  if (existing.length) {
    if (operation.estado !== 'aplicada') {
      throw stockError(409, 'La resolucion existente no esta aplicada.',
        'COMPENSATION_RESULT_INCOMPLETE');
    }
    return loadSettlementResult(
      connection, input.idTienda, operation.idOperacionCompensatoria, true
    );
  }
  if (operation.estado !== 'solicitada') {
    throw stockError(409, 'La operacion no puede resolver esta liquidacion.',
      'COMPENSATION_STATE_CONFLICT');
  }
  if (settlement.estado !== 'pendiente_c3') {
    throw stockError(409, 'La liquidacion ya fue resuelta o no requiere C3.',
      'SALE_SETTLEMENT_ALREADY_RESOLVED');
  }

  const debtCents = moneyToCents(
    settlement.montoReduccionDeudaPendiente,
    'La reduccion de deuda pendiente'
  );
  const refundCents = moneyToCents(
    settlement.montoReembolsoPendiente,
    'El reembolso pendiente'
  );
  const amountCents = moneyToCents(settlement.montoLiquidacion, 'El monto compensado');
  if (debtCents + refundCents !== amountCents || amountCents <= 0) {
    throw stockError(409, 'La liquidacion pendiente no esta conciliada.',
      'FINANCIAL_HISTORY_INCONSISTENT');
  }

  let debt = null;
  if (debtCents > 0) {
    const [debts] = await connection.query(
      `SELECT idFiado, totalFiado, totalPagado, totalCompensado,
              saldoPendiente, estado
       FROM fiado
       WHERE idTienda=? AND idVenta=?
       ORDER BY idFiado
       FOR UPDATE`,
      [input.idTienda, settlement.idVenta]
    );
    if (debts.length !== 1) {
      throw stockError(409, 'La deuda de la venta no puede identificarse de forma inequivoca.',
        'SALE_DEBT_INCONSISTENT');
    }
    debt = debts[0];
    const currentBalance = moneyToCents(debt.saldoPendiente, 'El saldo del fiado');
    if (debtCents > currentBalance) {
      throw stockError(409, 'La reduccion compensatoria supera la deuda pendiente.',
        'COMPENSATION_EXCEEDS_DEBT');
    }
    const totalPaid = moneyToCents(debt.totalPagado, 'El total pagado del fiado');
    const totalCompensated = moneyToCents(
      debt.totalCompensado,
      'El total compensado del fiado'
    ) + debtCents;
    const totalDebt = moneyToCents(debt.totalFiado, 'El total del fiado');
    const newBalance = totalDebt - totalPaid - totalCompensated;
    if (newBalance < 0) {
      throw stockError(409, 'La reduccion dejaria un saldo de fiado negativo.',
        'NEGATIVE_DEBT_BALANCE');
    }
    await connection.query(
      `UPDATE fiado
       SET totalCompensado=?, saldoPendiente=?, estado=?, cerradoEn=?
       WHERE idTienda=? AND idFiado=?`,
      [centsToDecimal(totalCompensated), centsToDecimal(newBalance),
        newBalance === 0 ? 'pagado' : (totalPaid > 0 ? 'parcial' : 'pendiente'),
        newBalance === 0 ? now : null, input.idTienda, debt.idFiado]
    );
  }

  const saleTotal = moneyToCents(settlement.total, 'El total de la venta');
  const salePaid = moneyToCents(settlement.montoPagado, 'El total pagado de la venta');
  const saleCompensated = moneyToCents(
    settlement.montoCompensadoVenta,
    'El total compensado de la venta'
  ) + amountCents;
  if (saleCompensated > saleTotal) {
    throw stockError(409, 'Las liquidaciones superan el total historico de la venta.',
      'COMPENSATION_EXCEEDS_SALE');
  }
  const effectiveTotal = saleTotal - saleCompensated;
  const newSaleBalance = Math.max(0, effectiveTotal - salePaid);
  await connection.query(
    `UPDATE venta
     SET montoCompensado=?, saldoPendiente=?, estadoPago=?
     WHERE idTienda=? AND idVenta=?`,
    [centsToDecimal(saleCompensated), centsToDecimal(newSaleBalance),
      salePaymentState(newSaleBalance, salePaid), input.idTienda, settlement.idVenta]
  );

  const closedPeriod = await originalPeriodIsClosed(
    connection, input.idTienda, settlement.fecha
  );
  const [resolution] = await connection.query(
    `INSERT INTO resolucionLiquidacionVenta
     (idTienda, idOperacionCompensatoria, idLiquidacionCompensacionVenta, idFiado,
      montoReduccionDeuda, montoReembolso, periodoOriginalCerrado, creadoEn,
      idAdministrador)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [input.idTienda, operation.idOperacionCompensatoria,
      settlement.idLiquidacionCompensacionVenta, debt?.idFiado || null,
      centsToDecimal(debtCents), centsToDecimal(refundCents),
      closedPeriod ? 1 : 0, now, input.idAdministrador]
  );
  if (refundCents > 0) {
    const refundablePayments = await lockRefundablePayments(
      connection, input.idTienda, settlement.idVenta
    );
    const availableRefundCents = refundablePayments.reduce(
      (sum, payment) => sum + moneyToCents(payment.monto, 'El pago reembolsable'),
      0
    );
    if (availableRefundCents < refundCents) {
      throw stockError(409,
        'Los pagos vigentes no cubren la obligacion de reembolso.',
        'REFUND_PAYMENT_HISTORY_INCONSISTENT');
    }
    const [refund] = await connection.query(
      `INSERT INTO obligacionReembolsoVenta
       (idTienda, idResolucionLiquidacionVenta, idVenta, monto, estado,
        creadoEn, resueltoEn, idAdministradorResuelve)
       VALUES (?, ?, ?, ?, 'pendiente', ?, NULL, NULL)`,
      [input.idTienda, resolution.insertId, settlement.idVenta,
        centsToDecimal(refundCents), now]
    );
    let remainingRefundCents = refundCents;
    for (const payment of refundablePayments) {
      if (remainingRefundCents <= 0) break;
      const allocatedCents = Math.min(
        remainingRefundCents,
        moneyToCents(payment.monto, 'El pago reembolsable')
      );
      await connection.query(
        `INSERT INTO detalleObligacionReembolsoPago
         (idTienda, idObligacionReembolsoVenta, idPagoVenta,
          metodoOriginal, monto, creadoEn)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [input.idTienda, refund.insertId, payment.idPagoVenta,
          payment.metodoEfectivo, centsToDecimal(allocatedCents), now]
      );
      remainingRefundCents -= allocatedCents;
    }
    if (remainingRefundCents !== 0) {
      throw stockError(409, 'La obligacion de reembolso no pudo distribuirse.',
        'REFUND_ALLOCATION_INCONSISTENT');
    }
  }
  const [settlementUpdate] = await connection.query(
    `UPDATE liquidacionCompensacionVenta
     SET estado='resuelta', resueltoEn=?
     WHERE idTienda=? AND idLiquidacionCompensacionVenta=? AND estado='pendiente_c3'`,
    [now, input.idTienda, settlement.idLiquidacionCompensacionVenta]
  );
  if (Number(settlementUpdate.affectedRows) !== 1) {
    throw stockError(409, 'La liquidacion cambio durante la resolucion.',
      'SALE_SETTLEMENT_STATE_CONFLICT');
  }
  if (typeof runtime.afterFinancialChanges === 'function') {
    await runtime.afterFinancialChanges({
      connection,
      action: 'resolve_settlement',
      idResolucionLiquidacionVenta: Number(resolution.insertId)
    });
  }
  await markOperationApplied(
    connection, input.idTienda, operation.idOperacionCompensatoria, now
  );
  return loadSettlementResult(
    connection, input.idTienda, operation.idOperacionCompensatoria, false
  );
}

function validateDestinationAmount(destination, amountCents) {
  if (destination.method === 'efectivo') {
    const received = destination.receivedCents ?? amountCents;
    if (received < amountCents) {
      throw stockError(400, 'El efectivo de destino no cubre el importe.',
        'INVALID_DESTINATION_CASH_AMOUNT');
    }
    return { receivedCents: received, changeCents: received - amountCents };
  }
  if (destination.receivedCents !== null) {
    throw stockError(400, 'Solo el efectivo puede indicar monto recibido.',
      'INVALID_DESTINATION_CASH_AMOUNT');
  }
  return { receivedCents: null, changeCents: 0 };
}

async function loadCollectionCompensationResult(
  connection,
  idTienda,
  idOperacionCompensatoria,
  repeated
) {
  const [headers] = await connection.query(
    `SELECT ccf.idCompensacionCobroFiado, ccf.idCobroFiado,
            ccf.tipoCompensacion, ccf.montoCompensado,
            ccf.metodoOriginal, ccf.metodoDestino,
            ccf.montoRecibidoDestino, ccf.cambioDestino,
            ccf.referenciaDestino, ccf.periodoOriginalCerrado,
            cf.estadoOperacion
     FROM compensacionCobroFiado ccf
     JOIN cobroFiado cf
       ON cf.idTienda=ccf.idTienda
      AND cf.idCobroFiado=ccf.idCobroFiado
     WHERE ccf.idTienda=? AND ccf.idOperacionCompensatoria=?`,
    [idTienda, idOperacionCompensatoria]
  );
  if (!headers.length) {
    throw stockError(409, 'La operacion existente no tiene un resultado completo.',
      'COMPENSATION_RESULT_INCOMPLETE');
  }
  const [details] = await connection.query(
    `SELECT idDetalleCompensacionCobro, idPagoFiado, idPagoVenta,
            idFiado, montoCompensado
     FROM detalleCompensacionCobro
     WHERE idTienda=? AND idCompensacionCobroFiado=?
     ORDER BY idDetalleCompensacionCobro`,
    [idTienda, headers[0].idCompensacionCobroFiado]
  );
  const header = headers[0];
  return {
    idOperacionCompensatoria,
    idCompensacionCobroFiado: Number(header.idCompensacionCobroFiado),
    idCobroFiado: Number(header.idCobroFiado),
    tipoCompensacion: header.tipoCompensacion,
    montoCompensado: header.montoCompensado,
    metodoOriginal: header.metodoOriginal,
    metodoDestino: header.metodoDestino,
    montoRecibidoDestino: header.montoRecibidoDestino,
    cambioDestino: header.cambioDestino,
    referenciaDestino: header.referenciaDestino,
    periodoOriginalCerrado: Number(header.periodoOriginalCerrado) === 1,
    estadoOperacionCobro: header.estadoOperacion,
    distribuciones: details.map((detail) => ({
      idPagoFiado: Number(detail.idPagoFiado),
      idPagoVenta: detail.idPagoVenta === null ? null : Number(detail.idPagoVenta),
      idFiado: Number(detail.idFiado),
      montoCompensado: detail.montoCompensado
    })),
    repetida: repeated
  };
}

async function executeCollectionCompensation(connection, input, request, runtime) {
  const [collections] = await connection.query(
    `SELECT idCobroFiado, idCliente, fechaCobro, montoTotal, metodoPago,
            montoRecibido, cambio, referencia, estadoOperacion
     FROM cobroFiado
     WHERE idTienda=? AND idCobroFiado=?
     FOR UPDATE`,
    [input.idTienda, request.idCobroFiado]
  );
  if (!collections.length) {
    throw stockError(404, 'Cobro no encontrado.', 'COLLECTION_NOT_FOUND');
  }
  const collection = collections[0];
  const [applications] = await connection.query(
    `SELECT pf.idPagoFiado, pf.idFiado, pf.monto,
            f.idVenta, pv.idPagoVenta, pv.monto montoPagoVenta
     FROM pagoFiado pf
     JOIN fiado f ON f.idTienda=pf.idTienda AND f.idFiado=pf.idFiado
     LEFT JOIN pagoVenta pv
       ON pv.idTienda=pf.idTienda AND pv.idPagoFiado=pf.idPagoFiado
     WHERE pf.idTienda=? AND pf.idCobroFiado=?
     ORDER BY pf.idFiado, pf.idPagoFiado
     FOR UPDATE`,
    [input.idTienda, request.idCobroFiado]
  );
  const debtIds = [...new Set(applications.map((row) => Number(row.idFiado)))]
    .sort((left, right) => left - right);
  const debts = new Map();
  for (const idFiado of debtIds) {
    const [rows] = await connection.query(
      `SELECT idFiado, idVenta, totalFiado, totalPagado, totalCompensado,
              saldoPendiente, estado
       FROM fiado
       WHERE idTienda=? AND idFiado=?
       FOR UPDATE`,
      [input.idTienda, idFiado]
    );
    if (!rows.length) {
      throw stockError(409, 'El cobro referencia una deuda inexistente.',
        'COLLECTION_HISTORY_INCONSISTENT');
    }
    debts.set(idFiado, rows[0]);
  }
  const saleIds = [...new Set(applications.map((row) => Number(row.idVenta)).filter(Boolean))]
    .sort((left, right) => left - right);
  const sales = new Map();
  for (const idVenta of saleIds) {
    const [rows] = await connection.query(
      `SELECT idVenta, total, montoPagado, montoCompensado, saldoPendiente
       FROM venta
       WHERE idTienda=? AND idVenta=?
       FOR UPDATE`,
      [input.idTienda, idVenta]
    );
    if (!rows.length) {
      throw stockError(409, 'El cobro referencia una venta inexistente.',
        'COLLECTION_HISTORY_INCONSISTENT');
    }
    sales.set(idVenta, rows[0]);
  }
  const now = formatLocalDateTime(runtime.now());
  const operation = await lockOperation(connection, input, request, now);
  const [existing] = await connection.query(
    `SELECT idCompensacionCobroFiado
     FROM compensacionCobroFiado
     WHERE idTienda=? AND idOperacionCompensatoria=?
     FOR UPDATE`,
    [input.idTienda, operation.idOperacionCompensatoria]
  );
  if (existing.length) {
    if (operation.estado !== 'aplicada') {
      throw stockError(409, 'La compensacion existente no esta aplicada.',
        'COMPENSATION_RESULT_INCOMPLETE');
    }
    return loadCollectionCompensationResult(
      connection, input.idTienda, operation.idOperacionCompensatoria, true
    );
  }
  if (operation.estado !== 'solicitada') {
    throw stockError(409, 'La operacion no puede compensar este cobro.',
      'COMPENSATION_STATE_CONFLICT');
  }
  await assertPaymentsNotCommittedToRefund(
    connection,
    input.idTienda,
    applications.map((row) => Number(row.idPagoVenta)).filter(Boolean)
  );
  if (collection.estadoOperacion === 'compensado') {
    throw stockError(409, 'El cobro ya fue compensado.', 'COLLECTION_ALREADY_COMPENSATED');
  }
  const amountCents = moneyToCents(collection.montoTotal, 'El total del cobro', {
    allowZero: false
  });
  const destinationValues = request.destination
    ? validateDestinationAmount(request.destination, amountCents)
    : { receivedCents: null, changeCents: 0 };
  if (request.destination?.method === collection.metodoPago) {
    throw stockError(409, 'El metodo de destino coincide con el original.',
      'PAYMENT_METHOD_UNCHANGED');
  }
  const closedPeriod = await originalPeriodIsClosed(
    connection, input.idTienda, collection.fechaCobro
  );
  const [compensation] = await connection.query(
    `INSERT INTO compensacionCobroFiado
     (idTienda, idOperacionCompensatoria, idCobroFiado, tipoCompensacion,
      montoCompensado, metodoOriginal, metodoDestino, montoRecibidoDestino,
      cambioDestino, referenciaDestino, periodoOriginalCerrado, creadoEn)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [input.idTienda, operation.idOperacionCompensatoria, collection.idCobroFiado,
      request.tipoCompensacion, centsToDecimal(amountCents), collection.metodoPago,
      request.destination?.method || null,
      destinationValues.receivedCents === null
        ? null : centsToDecimal(destinationValues.receivedCents),
      centsToDecimal(destinationValues.changeCents),
      request.destination?.reference || null, closedPeriod ? 1 : 0, now]
  );

  if (request.tipoCompensacion === 'anulacion_total') {
    if (!applications.length) {
      throw stockError(409, 'El cobro no tiene distribuciones reversibles.',
        'COLLECTION_WITHOUT_DISTRIBUTIONS');
    }
    const distributedCents = applications.reduce(
      (sum, row) => sum + moneyToCents(row.monto, 'La distribucion del cobro'), 0
    );
    if (distributedCents !== amountCents) {
      throw stockError(409, 'Las distribuciones no coinciden con el total del cobro.',
        'COLLECTION_HISTORY_INCONSISTENT');
    }
    await assertNoPendingSaleSettlements(connection, input.idTienda, saleIds);
    const reversedBySale = new Map();
    for (const application of applications) {
      const debt = debts.get(Number(application.idFiado));
      const appliedCents = moneyToCents(application.monto, 'El pago de fiado');
      const totalPaid = moneyToCents(debt.totalPagado, 'El total pagado del fiado')
        - appliedCents;
      const totalCompensated = moneyToCents(
        debt.totalCompensado,
        'El total compensado del fiado'
      );
      const totalDebt = moneyToCents(debt.totalFiado, 'El total del fiado');
      const newBalance = totalDebt - totalPaid - totalCompensated;
      if (totalPaid < 0 || newBalance < 0) {
        throw stockError(409, 'La anulacion del cobro dejaria una deuda incoherente.',
          'NEGATIVE_DEBT_BALANCE');
      }
      await connection.query(
        `UPDATE fiado
         SET totalPagado=?, saldoPendiente=?, estado=?, cerradoEn=NULL
         WHERE idTienda=? AND idFiado=?`,
        [centsToDecimal(totalPaid), centsToDecimal(newBalance),
          totalPaid > 0 ? 'parcial' : 'pendiente', input.idTienda, debt.idFiado]
      );
      debt.totalPagado = centsToDecimal(totalPaid);
      debt.saldoPendiente = centsToDecimal(newBalance);
      if (application.idPagoVenta !== null) {
        const paymentCents = moneyToCents(
          application.montoPagoVenta,
          'El pago de venta vinculado'
        );
        if (paymentCents !== appliedCents) {
          throw stockError(409, 'El pago de venta no coincide con la distribucion.',
            'COLLECTION_HISTORY_INCONSISTENT');
        }
        const idVenta = Number(application.idVenta);
        reversedBySale.set(idVenta, (reversedBySale.get(idVenta) || 0) + paymentCents);
      }
      await connection.query(
        `INSERT INTO detalleCompensacionCobro
         (idTienda, idCompensacionCobroFiado, idPagoFiado, idPagoVenta,
          idFiado, montoCompensado, creadoEn)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [input.idTienda, compensation.insertId, application.idPagoFiado,
          application.idPagoVenta, application.idFiado,
          centsToDecimal(appliedCents), now]
      );
    }
    for (const idVenta of [...reversedBySale.keys()].sort((a, b) => a - b)) {
      const sale = sales.get(idVenta);
      const paidCents = moneyToCents(sale.montoPagado, 'El total pagado de la venta')
        - reversedBySale.get(idVenta);
      const effectiveTotal = moneyToCents(sale.total, 'El total de la venta')
        - moneyToCents(sale.montoCompensado, 'El total compensado de la venta');
      const balanceCents = effectiveTotal - paidCents;
      if (paidCents < 0 || balanceCents < 0) {
        throw stockError(409, 'La anulacion del cobro dejaria la venta incoherente.',
          'COLLECTION_HISTORY_INCONSISTENT');
      }
      await connection.query(
        `UPDATE venta
         SET montoPagado=?, saldoPendiente=?, estadoPago=?
         WHERE idTienda=? AND idVenta=?`,
        [centsToDecimal(paidCents), centsToDecimal(balanceCents),
          salePaymentState(balanceCents, paidCents), input.idTienda, idVenta]
      );
    }
    const [collectionUpdate] = await connection.query(
      `UPDATE cobroFiado
       SET estadoOperacion='compensado'
       WHERE idTienda=? AND idCobroFiado=? AND estadoOperacion='vigente'`,
      [input.idTienda, collection.idCobroFiado]
    );
    if (Number(collectionUpdate.affectedRows) !== 1) {
      throw stockError(409, 'El cobro cambio durante la compensacion.',
        'COLLECTION_STATE_CONFLICT');
    }
  }
  if (typeof runtime.afterFinancialChanges === 'function') {
    await runtime.afterFinancialChanges({
      connection,
      action: 'compensate_collection',
      idCompensacionCobroFiado: Number(compensation.insertId)
    });
  }
  await markOperationApplied(
    connection, input.idTienda, operation.idOperacionCompensatoria, now
  );
  return loadCollectionCompensationResult(
    connection, input.idTienda, operation.idOperacionCompensatoria, false
  );
}

async function loadPaymentMethodResult(
  connection,
  idTienda,
  idOperacionCompensatoria,
  repeated
) {
  const [rows] = await connection.query(
    `SELECT cpv.idCompensacionPagoVenta, cpv.idPagoVenta, cpv.idVenta,
            cpv.monto, cpv.metodoOriginal, cpv.metodoDestino,
            cpv.montoRecibidoDestino, cpv.cambioDestino,
            cpv.referenciaDestino, cpv.periodoOriginalCerrado
     FROM compensacionPagoVenta cpv
     WHERE cpv.idTienda=? AND cpv.idOperacionCompensatoria=?`,
    [idTienda, idOperacionCompensatoria]
  );
  if (!rows.length) {
    throw stockError(409, 'La correccion existente no tiene un resultado completo.',
      'COMPENSATION_RESULT_INCOMPLETE');
  }
  const row = rows[0];
  return {
    idOperacionCompensatoria,
    idCompensacionPagoVenta: Number(row.idCompensacionPagoVenta),
    idPagoVenta: Number(row.idPagoVenta),
    idVenta: Number(row.idVenta),
    monto: row.monto,
    metodoOriginal: row.metodoOriginal,
    metodoDestino: row.metodoDestino,
    montoRecibidoDestino: row.montoRecibidoDestino,
    cambioDestino: row.cambioDestino,
    referenciaDestino: row.referenciaDestino,
    periodoOriginalCerrado: Number(row.periodoOriginalCerrado) === 1,
    repetida: repeated
  };
}

async function executePaymentMethodCorrection(connection, input, request, runtime) {
  const [payments] = await connection.query(
    `SELECT pv.idPagoVenta, pv.idVenta, pv.idPagoFiado, pv.metodoPago,
            pv.monto, pv.creadoEn, v.total, v.montoPagado,
            v.montoCompensado, v.saldoPendiente
     FROM pagoVenta pv
     JOIN venta v ON v.idTienda=pv.idTienda AND v.idVenta=pv.idVenta
     WHERE pv.idTienda=? AND pv.idPagoVenta=?
     FOR UPDATE`,
    [input.idTienda, request.idPagoVenta]
  );
  if (!payments.length) {
    throw stockError(404, 'Pago de venta no encontrado.', 'SALE_PAYMENT_NOT_FOUND');
  }
  const payment = payments[0];
  if (payment.idPagoFiado !== null) {
    throw stockError(409,
      'El pago pertenece a un cobro de fiado y debe corregirse desde ese cobro.',
      'PAYMENT_BELONGS_TO_COLLECTION');
  }
  const now = formatLocalDateTime(runtime.now());
  const operation = await lockOperation(connection, input, request, now);
  const [existing] = await connection.query(
    `SELECT idCompensacionPagoVenta
     FROM compensacionPagoVenta
     WHERE idTienda=? AND idOperacionCompensatoria=?
     FOR UPDATE`,
    [input.idTienda, operation.idOperacionCompensatoria]
  );
  if (existing.length) {
    if (operation.estado !== 'aplicada') {
      throw stockError(409, 'La correccion existente no esta aplicada.',
        'COMPENSATION_RESULT_INCOMPLETE');
    }
    return loadPaymentMethodResult(
      connection, input.idTienda, operation.idOperacionCompensatoria, true
    );
  }
  if (operation.estado !== 'solicitada') {
    throw stockError(409, 'La operacion no puede corregir este pago.',
      'COMPENSATION_STATE_CONFLICT');
  }
  await assertPaymentsNotCommittedToRefund(
    connection, input.idTienda, [Number(payment.idPagoVenta)]
  );
  await assertNoPendingSaleSettlements(
    connection, input.idTienda, [Number(payment.idVenta)]
  );
  if (request.destination.method === payment.metodoPago) {
    throw stockError(409, 'El metodo de destino coincide con el original.',
      'PAYMENT_METHOD_UNCHANGED');
  }
  const amountCents = moneyToCents(payment.monto, 'El monto del pago', { allowZero: false });
  const destinationValues = validateDestinationAmount(request.destination, amountCents);
  const closedPeriod = await originalPeriodIsClosed(
    connection, input.idTienda, payment.creadoEn
  );
  const [compensation] = await connection.query(
    `INSERT INTO compensacionPagoVenta
     (idTienda, idOperacionCompensatoria, idPagoVenta, idVenta, monto,
      metodoOriginal, metodoDestino, montoRecibidoDestino, cambioDestino,
      referenciaDestino, periodoOriginalCerrado, creadoEn)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [input.idTienda, operation.idOperacionCompensatoria, payment.idPagoVenta,
      payment.idVenta, centsToDecimal(amountCents), payment.metodoPago,
      request.destination.method,
      destinationValues.receivedCents === null
        ? null : centsToDecimal(destinationValues.receivedCents),
      centsToDecimal(destinationValues.changeCents),
      request.destination.reference, closedPeriod ? 1 : 0, now]
  );
  if (typeof runtime.afterFinancialChanges === 'function') {
    await runtime.afterFinancialChanges({
      connection,
      action: 'correct_payment_method',
      idCompensacionPagoVenta: Number(compensation.insertId)
    });
  }
  await markOperationApplied(
    connection, input.idTienda, operation.idOperacionCompensatoria, now
  );
  return loadPaymentMethodResult(
    connection, input.idTienda, operation.idOperacionCompensatoria, false
  );
}

function createFinancialCompensationService(dependencies = {}) {
  const servicePool = dependencies.pool || pool;
  const runtime = {
    now: dependencies.now || (() => new Date()),
    afterFinancialChanges: dependencies.afterFinancialChanges
  };

  async function transaction(input, normalize, execute, target) {
    const request = normalize(target, input.body);
    const idTienda = positiveId(input.idTienda, 'La tienda');
    const idAdministrador = positiveId(input.idAdministrador, 'El administrador');
    const connection = await servicePool.getConnection();
    try {
      await connection.beginTransaction();
      const result = await execute(connection, {
        idTienda,
        idAdministrador
      }, request, runtime);
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  return {
    resolveSaleSettlement(input) {
      return transaction(
        input,
        normalizeSettlementRequest,
        executeSettlementResolution,
        input.idLiquidacionCompensacionVenta
      );
    },
    compensateDebtCollection(input) {
      return transaction(
        input,
        normalizeCollectionRequest,
        executeCollectionCompensation,
        input.idCobroFiado
      );
    },
    correctSalePaymentMethod(input) {
      return transaction(
        input,
        normalizePaymentMethodRequest,
        executePaymentMethodCorrection,
        input.idPagoVenta
      );
    }
  };
}

const defaultService = createFinancialCompensationService();

module.exports = {
  assertNoPendingSaleSettlements,
  createFinancialCompensationService,
  normalizeCollectionRequest,
  normalizePaymentMethodRequest,
  normalizeSettlementRequest,
  compensateDebtCollection: (input) => defaultService.compensateDebtCollection(input),
  correctSalePaymentMethod: (input) => defaultService.correctSalePaymentMethod(input),
  resolveSaleSettlement: (input) => defaultService.resolveSaleSettlement(input)
};
