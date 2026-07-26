const crypto = require('crypto');
const pool = require('../config/db');
const { formatLocalDateTime } = require('../utils/local-datetime');
const {
  assertNoPendingSaleSettlements
} = require('./financial-compensation-service');
const {
  centsToDecimal,
  cleanText,
  creditError,
  effectiveDebtDate,
  lockCustomer,
  localDateText,
  moneyToCents
} = require('./customer-credit-service');
const { administrativeAuditService } = require('./administrative-audit-service');

const COLLECTION_METHODS = new Set(['efectivo', 'qr', 'transferencia', 'tarjeta', 'otro', 'no_especificado']);

function positiveId(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) throw creditError(400, `${label} no es valido.`);
  return number;
}

function operationKey(value) {
  const key = String(value ?? '').trim();
  if (!key) throw creditError(400, 'La clave de operacion del cobro es obligatoria.', 'COLLECTION_KEY_REQUIRED');
  if (key.length > 160 || !/^[A-Za-z0-9._:-]+$/.test(key)) {
    throw creditError(400, 'La clave de operacion del cobro no es valida.', 'INVALID_COLLECTION_KEY');
  }
  return key;
}

function distributionKey(key, idFiado) {
  const digest = crypto.createHash('sha256').update(key).digest('hex').slice(0, 32);
  return `cobro:${digest}:fiado:${idFiado}`;
}

function normalizeCollection(body) {
  const source = body && typeof body === 'object' ? body : {};
  const amountCents = moneyToCents(source.monto, 'El monto del cobro', { allowZero: false });
  const method = String(source.metodoPago || '').trim().toLowerCase();
  if (!COLLECTION_METHODS.has(method) || method === 'no_especificado') {
    throw creditError(400, 'El metodo de pago del cobro no es valido.');
  }
  const key = operationKey(source.claveOperacion);
  let receivedCents = null;
  let changeCents = 0;
  if (method === 'efectivo') {
    receivedCents = source.montoRecibido === null || source.montoRecibido === undefined || source.montoRecibido === ''
      ? amountCents
      : moneyToCents(source.montoRecibido, 'El monto recibido', { allowZero: false });
    if (receivedCents < amountCents) throw creditError(400, 'El efectivo recibido no alcanza para el cobro.');
    changeCents = receivedCents - amountCents;
  } else if (source.montoRecibido !== undefined && source.montoRecibido !== null && source.montoRecibido !== '') {
    throw creditError(400, 'Solo los cobros en efectivo pueden incluir monto recibido y cambio.');
  }
  return {
    amountCents,
    method,
    key,
    receivedCents,
    changeCents,
    reference: cleanText(source.referencia, 160),
    observation: cleanText(source.observacion, 1000)
  };
}

async function findTargetCustomer(connection, idTienda, { idFiado, idCliente }) {
  if (idCliente) return positiveId(idCliente, 'El cliente');
  const debtId = positiveId(idFiado, 'El fiado');
  const [rows] = await connection.query(
    'SELECT idCliente FROM fiado WHERE idTienda=? AND idFiado=?',
    [idTienda, debtId]
  );
  if (!rows.length) throw creditError(404, 'Fiado no encontrado.', 'DEBT_NOT_FOUND');
  return Number(rows[0].idCliente);
}

async function lockAllCustomerDebts(connection, idTienda, idCliente) {
  const [debts] = await connection.query(
    `SELECT idFiado, idVenta, idCliente, fechaInicio, fechaVencimiento, fechaPrometidaPago,
            totalFiado, totalPagado, saldoPendiente, estado, activo, cerradoEn
     FROM fiado
     WHERE idTienda=? AND idCliente=?
     ORDER BY idFiado ASC
     FOR UPDATE`,
    [idTienda, idCliente]
  );
  const saleIds = [...new Set(debts.map((debt) => Number(debt.idVenta)).filter((id) => id > 0))].sort((a, b) => a - b);
  const sales = [];
  for (const idVenta of saleIds) {
    const [rows] = await connection.query(
      'SELECT idVenta, total, montoPagado, saldoPendiente FROM venta WHERE idTienda=? AND idVenta=? FOR UPDATE',
      [idTienda, idVenta]
    );
    if (!rows.length) throw creditError(409, 'Una deuda referencia una venta inexistente.', 'DEBT_SALE_MISSING');
    sales.push(rows[0]);
  }
  return { debts, sales };
}

async function existingCollection(connection, idTienda, key) {
  const [headers] = await connection.query(
    `SELECT idCobroFiado, idCliente, fechaCobro, montoTotal, metodoPago, montoRecibido,
            cambio, referencia, observacion, claveOperacion, creadoEn
     FROM cobroFiado
     WHERE idTienda=? AND claveOperacion=?
     FOR UPDATE`,
    [idTienda, key]
  );
  if (!headers.length) return null;
  const [applications] = await connection.query(
    `SELECT pf.idPagoFiado, pf.idFiado, pf.monto, pf.fechaPago,
            f.saldoPendiente, f.estado
     FROM pagoFiado pf
     JOIN fiado f ON f.idTienda=pf.idTienda AND f.idFiado=pf.idFiado
     WHERE pf.idTienda=? AND pf.idCobroFiado=?
     ORDER BY pf.idPagoFiado`,
    [idTienda, headers[0].idCobroFiado]
  );
  return collectionResponse(headers[0], applications, true);
}

function collectionResponse(header, applications, repeated) {
  return {
    idCobroFiado: header.idCobroFiado,
    idCliente: header.idCliente,
    fechaCobro: header.fechaCobro,
    montoTotal: header.montoTotal,
    metodoPago: header.metodoPago,
    montoRecibido: header.montoRecibido,
    cambio: header.cambio,
    referencia: header.referencia,
    aplicaciones: applications.map((item) => ({
      idPagoFiado: item.idPagoFiado,
      idFiado: item.idFiado,
      monto: item.monto,
      saldoPendiente: item.saldoPendiente,
      estado: item.estado
    })),
    repetido: repeated
  };
}

function paymentMethodForSale(method) {
  return method === 'efectivo' || method === 'qr' ? method : 'no_especificado';
}

async function insertSalePayment(connection, input) {
  if (!input.debt.idVenta) return;
  const method = paymentMethodForSale(input.collection.method);
  await connection.query(
    `INSERT INTO pagoVenta
     (idTienda, idVenta, idPagoFiado, metodoPago, monto, montoRecibido, cambio,
      referencia, claveOperacion, idAdministrador, creadoEn)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
    [input.idTienda, input.debt.idVenta, input.idPagoFiado, method, centsToDecimal(input.appliedCents),
      method === 'efectivo' ? centsToDecimal(input.appliedCents) : null,
      input.collection.reference ? input.collection.reference.slice(0, 120) : null,
      `cobro:${input.idCobroFiado}:pago:${input.applicationIndex + 1}`,
      input.idAdministrador || null, input.operationDateTime]
  );
}

async function reconcileSales(connection, idTienda, saleIds) {
  for (const idVenta of [...new Set(saleIds.filter(Boolean))].sort((a, b) => a - b)) {
    const [[sale]] = await connection.query(
      'SELECT total, montoCompensado FROM venta WHERE idTienda=? AND idVenta=?',
      [idTienda, idVenta]
    );
    if (!sale) throw creditError(409, 'Venta asociada al fiado no encontrada.');
    const [[payments]] = await connection.query(
      `SELECT COALESCE(SUM(pv.monto),0) totalPagado
       FROM pagoVenta pv
       LEFT JOIN detalleCompensacionCobro dcc
         ON dcc.idTienda=pv.idTienda
        AND dcc.idPagoVenta=pv.idPagoVenta
       WHERE pv.idTienda=? AND pv.idVenta=?
         AND dcc.idDetalleCompensacionCobro IS NULL`,
      [idTienda, idVenta]
    );
    const totalCents = moneyToCents(sale.total, 'El total de la venta');
    const compensatedCents = moneyToCents(
      sale.montoCompensado,
      'El total compensado de la venta'
    );
    const paidCents = moneyToCents(payments.totalPagado, 'Los pagos de la venta');
    const effectiveTotalCents = totalCents - compensatedCents;
    if (effectiveTotalCents < 0 || paidCents > effectiveTotalCents) {
      throw creditError(409, 'Los pagos efectivos superan el total vigente de la venta.');
    }
    const balanceCents = effectiveTotalCents - paidCents;
    const state = balanceCents === 0 ? 'pagada' : (paidCents > 0 ? 'parcial' : 'pendiente');
    await connection.query(
      `UPDATE venta SET montoPagado=?, saldoPendiente=?, estadoPago=?
       WHERE idTienda=? AND idVenta=?`,
      [centsToDecimal(paidCents), centsToDecimal(balanceCents), state, idTienda, idVenta]
    );
  }
}

async function executeCollection(connection, input) {
  const idCliente = await findTargetCustomer(connection, input.idTienda, input);
  const customer = await lockCustomer(connection, input.idTienda, idCliente);
  const { debts } = await lockAllCustomerDebts(connection, input.idTienda, idCliente);
  const repeated = await existingCollection(connection, input.idTienda, input.collection.key);
  if (repeated) {
    const requestedDebt = input.idFiado ? positiveId(input.idFiado, 'El fiado') : null;
    if (Number(repeated.idCliente) !== idCliente
      || moneyToCents(repeated.montoTotal, 'El monto del cobro') !== input.collection.amountCents
      || repeated.metodoPago !== input.collection.method
      || (requestedDebt && !repeated.aplicaciones.some((item) => Number(item.idFiado) === requestedDebt))) {
      throw creditError(409, 'La clave de operacion ya pertenece a otro cobro.', 'COLLECTION_KEY_CONFLICT');
    }
    return repeated;
  }

  const targetDebts = input.idFiado
    ? debts.filter((debt) => Number(debt.idFiado) === positiveId(input.idFiado, 'El fiado'))
    : debts;
  if (!targetDebts.length) throw creditError(404, 'Fiado no encontrado.', 'DEBT_NOT_FOUND');
  await assertNoPendingSaleSettlements(
    connection,
    input.idTienda,
    targetDebts.map((debt) => Number(debt.idVenta)).filter(Boolean)
  );
  const openDebts = targetDebts.filter((debt) => moneyToCents(debt.saldoPendiente, 'El saldo') > 0);
  if (!openDebts.length) throw creditError(409, 'No existe saldo pendiente para aplicar el cobro.', 'NO_OPEN_DEBT');
  const totalDebtCents = openDebts.reduce(
    (sum, debt) => sum + moneyToCents(debt.saldoPendiente, 'El saldo pendiente'), 0
  );
  if (input.collection.amountCents > totalDebtCents) {
    throw creditError(400, 'El cobro no puede superar la deuda pendiente.', 'COLLECTION_EXCEEDS_DEBT');
  }

  const operationDateTime = formatLocalDateTime();
  const [headerResult] = await connection.query(
    `INSERT INTO cobroFiado
     (idTienda, idCliente, fechaCobro, montoTotal, metodoPago, montoRecibido, cambio,
      referencia, observacion, claveOperacion, creadoEn, idAdministrador, esLegado)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    [input.idTienda, customer.idCliente, operationDateTime, centsToDecimal(input.collection.amountCents),
      input.collection.method,
      input.collection.receivedCents === null ? null : centsToDecimal(input.collection.receivedCents),
      centsToDecimal(input.collection.changeCents), input.collection.reference, input.collection.observation,
      input.collection.key, operationDateTime, input.idAdministrador || null]
  );
  const idCobroFiado = headerResult.insertId;
  let remainingCents = input.collection.amountCents;
  const applications = [];
  const affectedSales = [];

  const orderedDebts = [...openDebts].sort((left, right) => {
    const leftDate = effectiveDebtDate(left) || localDateText(left.fechaInicio);
    const rightDate = effectiveDebtDate(right) || localDateText(right.fechaInicio);
    return String(leftDate).localeCompare(String(rightDate)) || Number(left.idFiado) - Number(right.idFiado);
  });
  for (let index = 0; index < orderedDebts.length && remainingCents > 0; index += 1) {
    const debt = orderedDebts[index];
    const balanceCents = moneyToCents(debt.saldoPendiente, 'El saldo pendiente');
    const appliedCents = Math.min(balanceCents, remainingCents);
    const key = distributionKey(input.collection.key, debt.idFiado);
    const [paymentResult] = await connection.query(
      `INSERT INTO pagoFiado
       (idTienda, idFiado, idCobroFiado, fechaPago, monto, observacion, claveDistribucion)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [input.idTienda, debt.idFiado, idCobroFiado, operationDateTime, centsToDecimal(appliedCents),
        input.collection.observation ? input.collection.observation.slice(0, 150) : null, key]
    );
    const totalPaidCents = moneyToCents(debt.totalPagado, 'El total pagado') + appliedCents;
    const newBalanceCents = moneyToCents(debt.totalFiado, 'El total fiado') - totalPaidCents;
    if (newBalanceCents < 0) throw creditError(409, 'El cobro dejaria un saldo negativo.');
    const state = newBalanceCents === 0 ? 'pagado' : 'parcial';
    await connection.query(
      `UPDATE fiado
       SET totalPagado=?, saldoPendiente=?, estado=?, cerradoEn=?
       WHERE idTienda=? AND idFiado=?`,
      [centsToDecimal(totalPaidCents), centsToDecimal(newBalanceCents), state,
        newBalanceCents === 0 ? operationDateTime : null, input.idTienda, debt.idFiado]
    );
    await insertSalePayment(connection, {
      idTienda: input.idTienda,
      debt,
      idPagoFiado: paymentResult.insertId,
      idCobroFiado,
      appliedCents,
      collection: input.collection,
      applicationIndex: applications.length,
      idAdministrador: input.idAdministrador,
      operationDateTime
    });
    if (debt.idVenta) affectedSales.push(Number(debt.idVenta));
    applications.push({
      idPagoFiado: paymentResult.insertId,
      idFiado: debt.idFiado,
      monto: centsToDecimal(appliedCents),
      saldoPendiente: centsToDecimal(newBalanceCents),
      estado: state
    });
    remainingCents -= appliedCents;
  }
  if (remainingCents !== 0) throw creditError(409, 'El cobro no pudo distribuirse completamente.');
  await reconcileSales(connection, input.idTienda, affectedSales);
  return collectionResponse({
    idCobroFiado,
    idCliente: customer.idCliente,
    fechaCobro: operationDateTime,
    montoTotal: centsToDecimal(input.collection.amountCents),
    metodoPago: input.collection.method,
    montoRecibido: input.collection.receivedCents === null ? null : centsToDecimal(input.collection.receivedCents),
    cambio: centsToDecimal(input.collection.changeCents),
    referencia: input.collection.reference
  }, applications, false);
}

async function runCollection(input) {
  const ownedConnection = !input.connection;
  const connection = input.connection || await pool.getConnection();
  try {
    if (ownedConnection) await connection.beginTransaction();
    const result = await executeCollection(connection, {
      ...input,
      collection: normalizeCollection(input.body)
    });
    if (!result.repetido && input.requestId) {
      await administrativeAuditService.recordCritical(connection, {
        storeId: input.idTienda,
        actorType: 'administrador',
        administratorId: input.idAdministrador,
        action: 'registro_pago_fiado',
        result: 'correcto',
        resultCode: 'COMMERCIAL_OPERATION_OK',
        origin: 'web',
        reference: `cobro_fiado:${result.idCobroFiado}`,
        requestId: input.requestId,
        metadata: { metodoPago: result.metodoPago }
      });
    }
    if (ownedConnection) await connection.commit();
    return result;
  } catch (error) {
    if (ownedConnection) await connection.rollback();
    throw error;
  } finally {
    if (ownedConnection) connection.release();
  }
}

function collectSpecificDebt(input) {
  return runCollection({ ...input, idFiado: positiveId(input.idFiado, 'El fiado') });
}

function collectCustomerDebt(input) {
  return runCollection({ ...input, idCliente: positiveId(input.idCliente, 'El cliente') });
}

module.exports = {
  collectCustomerDebt,
  collectSpecificDebt,
  distributionKey,
  normalizeCollection,
  operationKey
};
