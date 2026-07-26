const crypto = require('crypto');
const pool = require('../config/db');
const {
  COLLECTION_PAYMENT_METHODS,
  COMPENSATION_REASONS,
  MATERIAL_SETTLEMENT_TYPES,
  OPERATION_KEY_PATTERN
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

function moneyToCents(value, label) {
  const number = Number(value);
  const cents = Math.round(number * 100);
  if (!Number.isFinite(number) || !Number.isSafeInteger(cents)
    || cents <= 0 || cents > MAX_MONEY_CENTS) {
    throw stockError(400, `${label} no es valido.`, 'INVALID_SETTLEMENT_AMOUNT');
  }
  return cents;
}

function centsToDecimal(value) {
  return (value / 100).toFixed(2);
}

function cleanText(value, maximum, label, required = false) {
  const text = String(value ?? '').trim();
  if (!text) {
    if (required) {
      throw stockError(400, `${label} es obligatoria.`, 'SETTLEMENT_REFERENCE_REQUIRED');
    }
    return null;
  }
  if (text.length > maximum || /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(text)) {
    throw stockError(400, `${label} no es valida.`, 'INVALID_COMPENSATION_TEXT');
  }
  return text;
}

function fingerprint(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function normalizeRequest(idObligacion, body) {
  const source = body && typeof body === 'object' ? body : {};
  const id = positiveId(idObligacion, 'La obligacion de reembolso');
  if (source.confirmar !== true) {
    throw stockError(400, 'Debe confirmar expresamente la liquidacion.',
      'MATERIAL_SETTLEMENT_CONFIRMATION_REQUIRED');
  }
  const key = String(source.claveOperacion || '').trim();
  if (!OPERATION_KEY_PATTERN.test(key)) {
    throw stockError(400, 'La clave de operacion no es valida.', 'INVALID_OPERATION_KEY');
  }
  const reason = String(source.motivoCodigo || '').trim().toLowerCase();
  if (!COMPENSATION_REASONS.includes(reason)) {
    throw stockError(400, 'El motivo no es valido.', 'INVALID_COMPENSATION_REASON');
  }
  const observation = cleanText(source.observacion, 500, 'La observacion');
  if (reason === 'otro_controlado' && (!observation || observation.length < 8)) {
    throw stockError(400, 'otro_controlado requiere una observacion suficiente.',
      'COMPENSATION_OBSERVATION_REQUIRED');
  }
  const type = String(source.tipoLiquidacion || '').trim().toLowerCase();
  if (type === 'credito_a_favor') {
    throw stockError(409, 'El credito a favor aun no dispone de un libro de consumo seguro.',
      'CREDIT_BALANCE_NOT_AVAILABLE');
  }
  if (!MATERIAL_SETTLEMENT_TYPES.includes(type)) {
    throw stockError(400, 'El tipo de liquidacion no es valido.',
      'INVALID_MATERIAL_SETTLEMENT_TYPE');
  }
  const method = String(source.metodoLiquidacion || source.metodoPago || '')
    .trim().toLowerCase();
  if (!COLLECTION_PAYMENT_METHODS.includes(method)) {
    throw stockError(400, 'El metodo de liquidacion no es valido.',
      'INVALID_SETTLEMENT_METHOD');
  }
  const amountCents = moneyToCents(source.monto, 'El monto');
  const reference = cleanText(
    source.referencia,
    160,
    'La referencia',
    method !== 'efectivo'
  );
  const canonical = {
    accion: 'liquidar_obligacion_reembolso',
    idObligacionReembolsoVenta: id,
    claveOperacion: key,
    motivoCodigo: reason,
    observacion: observation,
    tipoLiquidacion: type,
    metodoLiquidacion: method,
    montoCentavos: amountCents,
    referencia: reference
  };
  return {
    idObligacionReembolsoVenta: id,
    claveOperacion: key,
    motivoCodigo: reason,
    observacion: observation,
    tipoLiquidacion: type,
    metodoLiquidacion: method,
    amountCents,
    referencia: reference,
    huellaSolicitud: fingerprint(canonical)
  };
}

async function lockOperation(connection, input, request, now) {
  const [insert] = await connection.query(
    `INSERT INTO operacionCompensatoria
     (idTienda, tipoOperacion, estado, motivoCodigo, observacion, requiereAprobacion,
      idAdministradorSolicitante, idAdministradorAprobador, claveOperacion,
      huellaSolicitud, fechaSolicitud, fechaAprobacion, fechaAplicacion, creadoEn,
      actualizadoEn)
     VALUES (?, 'correccion_saldo', 'solicitada', ?, ?, 0, ?, NULL, ?, ?, ?,
             NULL, NULL, ?, ?)
     ON DUPLICATE KEY UPDATE
       idOperacionCompensatoria=LAST_INSERT_ID(idOperacionCompensatoria)`,
    [input.idTienda, request.motivoCodigo, request.observacion,
      input.idAdministrador, request.claveOperacion, request.huellaSolicitud,
      now, now, now]
  );
  const [rows] = await connection.query(
    `SELECT idOperacionCompensatoria, tipoOperacion, estado, huellaSolicitud
     FROM operacionCompensatoria
     WHERE idTienda=? AND idOperacionCompensatoria=?
     FOR UPDATE`,
    [input.idTienda, insert.insertId]
  );
  const operation = rows[0];
  if (!operation) {
    throw stockError(500, 'No se pudo bloquear la operacion.',
      'FINANCIAL_OPERATION_LOCK_FAILED');
  }
  if (operation.tipoOperacion !== 'correccion_saldo'
    || operation.huellaSolicitud !== request.huellaSolicitud) {
    throw stockError(409, 'La clave de operacion ya fue usada con otra solicitud.',
      'OPERATION_KEY_CONFLICT');
  }
  return operation;
}

async function loadResult(connection, idTienda, idOperacion, repeated) {
  const [rows] = await connection.query(
    `SELECT mlc.idMovimientoLiquidacionCompensacion,
            mlc.idObligacionReembolsoVenta, mlc.tipoLiquidacion,
            mlc.metodoLiquidacion, mlc.monto, mlc.referencia,
            mlc.observacion, mlc.periodoOriginalCerrado,
            mlc.fechaMovimiento, ore.monto montoObligacion, ore.estado,
            COALESCE((
              SELECT SUM(previous.monto)
              FROM movimientoLiquidacionCompensacion previous
              WHERE previous.idTienda=mlc.idTienda
                AND previous.idObligacionReembolsoVenta=mlc.idObligacionReembolsoVenta
            ),0) montoLiquidado
     FROM movimientoLiquidacionCompensacion mlc
     JOIN obligacionReembolsoVenta ore
       ON ore.idTienda=mlc.idTienda
      AND ore.idObligacionReembolsoVenta=mlc.idObligacionReembolsoVenta
     WHERE mlc.idTienda=? AND mlc.idOperacionCompensatoria=?`,
    [idTienda, idOperacion]
  );
  if (!rows.length) {
    throw stockError(409, 'El resultado material no esta disponible.',
      'MATERIAL_SETTLEMENT_RESULT_INCOMPLETE');
  }
  const row = rows[0];
  const balance = Math.max(
    0,
    Math.round(Number(row.montoObligacion) * 100)
      - Math.round(Number(row.montoLiquidado) * 100)
  );
  return {
    idMovimientoLiquidacionCompensacion:
      Number(row.idMovimientoLiquidacionCompensacion),
    idObligacionReembolsoVenta: Number(row.idObligacionReembolsoVenta),
    tipoLiquidacion: row.tipoLiquidacion,
    metodoLiquidacion: row.metodoLiquidacion,
    monto: row.monto,
    referencia: row.referencia,
    observacion: row.observacion,
    periodoOriginalCerrado: Boolean(row.periodoOriginalCerrado),
    fechaMovimiento: row.fechaMovimiento,
    estadoObligacion: row.estado,
    montoObligacion: row.montoObligacion,
    montoLiquidado: row.montoLiquidado,
    saldoPendiente: centsToDecimal(balance),
    repetida: repeated
  };
}

async function execute(connection, input, request, runtime) {
  const now = formatLocalDateTime(runtime.now());
  const [obligations] = await connection.query(
    `SELECT ore.idObligacionReembolsoVenta, ore.idVenta, ore.monto, ore.estado,
            v.fecha fechaVenta
     FROM obligacionReembolsoVenta ore
     JOIN venta v ON v.idTienda=ore.idTienda AND v.idVenta=ore.idVenta
     WHERE ore.idTienda=? AND ore.idObligacionReembolsoVenta=?
     FOR UPDATE`,
    [input.idTienda, request.idObligacionReembolsoVenta]
  );
  if (!obligations.length) {
    throw stockError(404, 'Obligacion de reembolso no encontrada.',
      'REFUND_OBLIGATION_NOT_FOUND');
  }
  const obligation = obligations[0];
  const operation = await lockOperation(connection, input, request, now);
  const [existing] = await connection.query(
    `SELECT idMovimientoLiquidacionCompensacion
     FROM movimientoLiquidacionCompensacion
     WHERE idTienda=? AND idOperacionCompensatoria=?
     FOR UPDATE`,
    [input.idTienda, operation.idOperacionCompensatoria]
  );
  if (existing.length) {
    if (operation.estado !== 'aplicada') {
      throw stockError(409, 'La operacion existente no esta aplicada.',
        'MATERIAL_SETTLEMENT_RESULT_INCOMPLETE');
    }
    return loadResult(
      connection, input.idTienda, operation.idOperacionCompensatoria, true
    );
  }
  if (operation.estado !== 'solicitada') {
    throw stockError(409, 'La operacion no puede aplicar esta liquidacion.',
      'COMPENSATION_STATE_CONFLICT');
  }
  if (obligation.estado !== 'pendiente') {
    throw stockError(409, 'La obligacion ya fue liquidada.',
      'REFUND_OBLIGATION_ALREADY_SETTLED');
  }
  const [totals] = await connection.query(
    `SELECT COALESCE(SUM(monto),0) montoLiquidado
     FROM movimientoLiquidacionCompensacion
     WHERE idTienda=? AND idObligacionReembolsoVenta=?
     FOR UPDATE`,
    [input.idTienda, obligation.idObligacionReembolsoVenta]
  );
  const obligationCents = moneyToCents(obligation.monto, 'La obligacion');
  const settledCents = Math.round(Number(totals[0].montoLiquidado || 0) * 100);
  const remainingCents = obligationCents - settledCents;
  if (remainingCents <= 0) {
    throw stockError(409, 'La obligacion no tiene saldo pendiente.',
      'REFUND_OBLIGATION_ALREADY_SETTLED');
  }
  if (request.amountCents > remainingCents) {
    throw stockError(409, 'La liquidacion supera el saldo pendiente.',
      'SETTLEMENT_EXCEEDS_REFUND_BALANCE');
  }
  const [closed] = await connection.query(
    `SELECT idCierreCaja
     FROM cierreCaja
     WHERE idTienda=? AND estado='cerrado'
       AND fechaInicio<=? AND ?<fechaFin
     LIMIT 1`,
    [input.idTienda, obligation.fechaVenta, obligation.fechaVenta]
  );
  await connection.query(
    `INSERT INTO movimientoLiquidacionCompensacion
     (idTienda, idOperacionCompensatoria, idObligacionReembolsoVenta,
      tipoLiquidacion, metodoLiquidacion, monto, referencia, observacion,
      periodoOriginalCerrado, fechaMovimiento, idAdministrador)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [input.idTienda, operation.idOperacionCompensatoria,
      obligation.idObligacionReembolsoVenta, request.tipoLiquidacion,
      request.metodoLiquidacion, centsToDecimal(request.amountCents),
      request.referencia, request.observacion, closed.length ? 1 : 0,
      now, input.idAdministrador]
  );
  const newSettledCents = settledCents + request.amountCents;
  if (newSettledCents === obligationCents) {
    const [types] = await connection.query(
      `SELECT COUNT(DISTINCT tipoLiquidacion) tipos,
              MIN(tipoLiquidacion) tipo
       FROM movimientoLiquidacionCompensacion
       WHERE idTienda=? AND idObligacionReembolsoVenta=?`,
      [input.idTienda, obligation.idObligacionReembolsoVenta]
    );
    const state = Number(types[0].tipos) === 1
      && types[0].tipo === 'reembolso_realizado'
      ? 'reembolsado'
      : 'compensado';
    const [updated] = await connection.query(
      `UPDATE obligacionReembolsoVenta
       SET estado=?, resueltoEn=?, idAdministradorResuelve=?
       WHERE idTienda=? AND idObligacionReembolsoVenta=? AND estado='pendiente'`,
      [state, now, input.idAdministrador, input.idTienda,
        obligation.idObligacionReembolsoVenta]
    );
    if (Number(updated.affectedRows) !== 1) {
      throw stockError(409, 'La obligacion cambio durante la liquidacion.',
        'REFUND_OBLIGATION_STATE_CONFLICT');
    }
  }
  if (typeof runtime.afterMaterialSettlement === 'function') {
    await runtime.afterMaterialSettlement({
      connection,
      idObligacionReembolsoVenta: obligation.idObligacionReembolsoVenta
    });
  }
  const [applied] = await connection.query(
    `UPDATE operacionCompensatoria
     SET estado='aplicada', fechaAplicacion=?, actualizadoEn=?
     WHERE idTienda=? AND idOperacionCompensatoria=? AND estado='solicitada'`,
    [now, now, input.idTienda, operation.idOperacionCompensatoria]
  );
  if (Number(applied.affectedRows) !== 1) {
    throw stockError(409, 'La operacion cambio durante la liquidacion.',
      'COMPENSATION_STATE_CONFLICT');
  }
  return loadResult(
    connection, input.idTienda, operation.idOperacionCompensatoria, false
  );
}

function createMaterialSettlementService(dependencies = {}) {
  const servicePool = dependencies.pool || pool;
  const runtime = {
    now: dependencies.now || (() => new Date()),
    afterMaterialSettlement: dependencies.afterMaterialSettlement
  };
  return {
    async settleRefundObligation(input) {
      const request = normalizeRequest(input.idObligacionReembolsoVenta, input.body);
      const identity = {
        idTienda: positiveId(input.idTienda, 'La tienda'),
        idAdministrador: positiveId(input.idAdministrador, 'El administrador')
      };
      const connection = await servicePool.getConnection();
      try {
        await connection.beginTransaction();
        const result = await execute(connection, identity, request, runtime);
        await connection.commit();
        return result;
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    }
  };
}

const defaultService = createMaterialSettlementService();

module.exports = {
  createMaterialSettlementService,
  normalizeRequest,
  settleRefundObligation: (input) => defaultService.settleRefundObligation(input)
};
