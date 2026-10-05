const {
  addLocalDays: shiftLocalDays,
  formatLocalDate,
  formatLocalDateTime,
  parseLocalDate: parseBusinessDate
} = require('../utils/local-datetime');
const { enforcePlanLimit } = require('./subscription-service');

const CREDIT_POLICIES = new Set(['permitir', 'advertir', 'bloquear']);
const COMMUNICATION_CHANNELS = new Set(['ninguno', 'whatsapp', 'telefono', 'correo', 'presencial']);
const CUSTOMER_STATES = new Set(['activos', 'ocultos', 'todos']);
const COLLECTION_STATES = new Set(['vencido', 'vence_hoy', 'proximo_a_vencer', 'al_dia', 'sin_fecha', 'pagado']);
const STORED_DEBT_STATES = new Set(['pendiente', 'parcial', 'pagado']);
const MAX_MONEY_CENTS = 9999999999;

function creditError(status, message, code) {
  const error = new Error(message);
  error.status = status;
  if (code) error.code = code;
  return error;
}

function moneyToCents(value, label, { allowNull = false, allowZero = true } = {}) {
  if (value === null || value === undefined || value === '') {
    if (allowNull) return null;
    throw creditError(400, `${label} es obligatorio.`);
  }
  const number = Number(value);
  if (!Number.isFinite(number)) throw creditError(400, `${label} no es valido.`);
  const cents = Math.round(number * 100);
  if (cents < 0 || (!allowZero && cents === 0) || cents > MAX_MONEY_CENTS) {
    throw creditError(400, `${label} no es valido.`);
  }
  return cents;
}

function centsToDecimal(value) {
  return (value / 100).toFixed(2);
}

function cleanText(value, maximum, { required = false } = {}) {
  const text = String(value ?? '').trim();
  if (required && !text) throw creditError(400, 'El texto es obligatorio.');
  if (text.length > maximum) throw creditError(400, `El texto no puede superar ${maximum} caracteres.`);
  return text || null;
}

function normalizePhone(value) {
  const original = cleanText(value, 30);
  if (!original) return { original: null, normalized: null };
  const normalized = original.replace(/\D/g, '');
  if (!normalized) throw creditError(400, 'El telefono debe contener al menos un digito.');
  return { original, normalized };
}

function normalizeDocument(value) {
  const original = cleanText(value, 50);
  if (!original) return { original: null, normalized: null };
  const normalized = original.toUpperCase().replace(/[\s.\-_/]+/g, '');
  if (!normalized) throw creditError(400, 'El documento no es valido.');
  return { original, normalized };
}

function normalizeEmail(value) {
  const email = cleanText(value, 160);
  if (!email) return null;
  const normalized = email.toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw creditError(400, 'El correo no es valido.');
  }
  return normalized;
}

function booleanValue(value, label, fallback) {
  if (value === undefined) return fallback;
  if (value === true || value === 1 || value === '1') return 1;
  if (value === false || value === 0 || value === '0') return 0;
  throw creditError(400, `${label} no es valido.`);
}

function integerRange(value, label, minimum, maximum, { allowNull = false } = {}) {
  if (value === null || value === undefined || value === '') {
    if (allowNull) return null;
    throw creditError(400, `${label} es obligatorio.`);
  }
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum || number > maximum) {
    throw creditError(400, `${label} debe estar entre ${minimum} y ${maximum}.`);
  }
  return number;
}

function parseLocalDate(value, label, { allowNull = true } = {}) {
  if (value === null || value === undefined || value === '') {
    if (allowNull) return null;
    throw creditError(400, `${label} es obligatoria.`);
  }
  const text = String(value).trim();
  try {
    parseBusinessDate(text);
  } catch {
    throw creditError(400, `${label} no es valida.`);
  }
  return text;
}

function addLocalDays(dateText, days) {
  return formatLocalDate(shiftLocalDays(parseBusinessDate(dateText), days));
}

function queryBoolean(value, label) {
  if (value === undefined || value === '') return null;
  if (value === '1' || value === 1 || value === true || value === 'true') return 1;
  if (value === '0' || value === 0 || value === false || value === 'false') return 0;
  throw creditError(400, `${label} no es valido.`);
}

function positiveIdentifier(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) throw creditError(400, `${label} no es valido.`);
  return number;
}

function resolveCustomerState(query = {}, forcedState = null) {
  if (forcedState) return forcedState;
  const requested = String(cleanText(query.estado, 20) || '').toLowerCase();
  if (requested && !CUSTOMER_STATES.has(requested)) {
    throw creditError(400, 'El estado de clientes no es valido.', 'INVALID_CUSTOMER_STATE');
  }
  if (requested) return requested;
  const legacyActive = queryBoolean(query.activo, 'El filtro de actividad');
  if (legacyActive !== null) return legacyActive === 1 ? 'activos' : 'ocultos';
  return 'activos';
}

function buildCustomerFilter(query, idTienda, { forcedState = null } = {}) {
  const conditions = ['c.idTienda=?'];
  const params = [idTienda];
  const text = cleanText(query.texto || query.q, 100);
  const state = resolveCustomerState(query, forcedState);
  const allowsCredit = queryBoolean(query.permiteFiado, 'El filtro de fiado');
  const hasDebt = queryBoolean(query.conDeuda, 'El filtro de deuda');
  const overdue = queryBoolean(query.vencido, 'El filtro de vencimiento');
  if (text) {
    conditions.push(`(c.nombre LIKE ? OR c.telefono LIKE ? OR c.telefonoAlternativo LIKE ?
      OR c.documentoIdentidad LIKE ? OR c.correo LIKE ?)`);
    const pattern = `%${text}%`;
    params.push(pattern, pattern, pattern, pattern, pattern);
  }
  if (state === 'activos') conditions.push('c.activo=1');
  if (state === 'ocultos') conditions.push('c.activo=0');
  if (allowsCredit !== null) {
    conditions.push('c.permiteFiado=?');
    params.push(allowsCredit);
  }
  if (hasDebt !== null) {
    conditions.push(`${hasDebt ? '' : 'NOT '}EXISTS (
      SELECT 1 FROM fiado fd WHERE fd.idTienda=c.idTienda AND fd.idCliente=c.idCliente AND fd.saldoPendiente>0
    )`);
  }
  if (overdue !== null) {
    conditions.push(`${overdue ? '' : 'NOT '}EXISTS (
      SELECT 1 FROM fiado fv WHERE fv.idTienda=c.idTienda AND fv.idCliente=c.idCliente
        AND fv.saldoPendiente>0
        AND COALESCE(fv.fechaPrometidaPago, fv.fechaVencimiento) IS NOT NULL
        AND COALESCE(fv.fechaPrometidaPago, fv.fechaVencimiento)<?
    )`);
    params.push(formatLocalDate());
  }
  if (query.documento) {
    conditions.push('c.documentoNormalizado=?');
    params.push(normalizeDocument(query.documento).normalized);
  }
  if (query.telefono) {
    conditions.push('c.telefonoNormalizado=?');
    params.push(normalizePhone(query.telefono).normalized);
  }
  return { conditions, params, state, where: conditions.join(' AND ') };
}

function addDebtStateFilter(conditions, params, state, options = {}) {
  if (!state) return;
  const allowed = options.allowStored
    ? new Set([...COLLECTION_STATES, ...STORED_DEBT_STATES])
    : new Set([...COLLECTION_STATES].filter((item) => item !== 'pagado'));
  if (!allowed.has(state)) throw creditError(400, 'El estado de cobranza no es valido.');
  const alias = options.alias || 'f';
  const effectiveDate = `COALESCE(${alias}.fechaPrometidaPago,${alias}.fechaVencimiento)`;
  if (options.allowStored && (state === 'pendiente' || state === 'parcial')) {
    conditions.push(`${alias}.estado=?`);
    params.push(state);
  } else if (state === 'pagado') {
    conditions.push(`${alias}.saldoPendiente<=0`);
  } else if (state === 'vencido') {
    conditions.push(`${alias}.saldoPendiente>0 AND ${effectiveDate} IS NOT NULL AND ${effectiveDate}<?`);
    params.push(options.today);
  } else if (state === 'vence_hoy') {
    conditions.push(`${alias}.saldoPendiente>0 AND ${effectiveDate}=?`);
    params.push(options.today);
  } else if (state === 'proximo_a_vencer') {
    conditions.push(`${alias}.saldoPendiente>0 AND ${effectiveDate}>? AND ${effectiveDate}<=?`);
    params.push(options.today, options.warningThrough);
  } else if (state === 'al_dia') {
    conditions.push(`${alias}.saldoPendiente>0 AND ${effectiveDate}>?`);
    params.push(options.warningThrough);
  } else if (state === 'sin_fecha') {
    conditions.push(`${alias}.saldoPendiente>0 AND ${effectiveDate} IS NULL`);
  }
}

function buildDebtFilter(query, idTienda, configuration, { forcedActive = null, allowStored = true } = {}) {
  const conditions = ['f.idTienda=?'];
  const params = [idTienda];
  const today = formatLocalDate();
  const warningThrough = addLocalDays(today, Number(configuration.diasAvisoVencimiento));
  const active = forcedActive === null ? queryBoolean(query.activo, 'El filtro de actividad') : forcedActive;
  if (active !== null) {
    conditions.push('f.activo=?');
    params.push(active);
  }
  const openOnly = queryBoolean(query.soloAbiertos, 'El filtro de saldo abierto');
  if (openOnly !== null) conditions.push(openOnly ? 'f.saldoPendiente>0' : 'f.saldoPendiente<=0');
  const minimumBalanceCents = query.saldoMinimo === undefined || query.saldoMinimo === ''
    ? null : moneyToCents(query.saldoMinimo, 'El saldo minimo');
  const maximumBalanceCents = query.saldoMaximo === undefined || query.saldoMaximo === ''
    ? null : moneyToCents(query.saldoMaximo, 'El saldo maximo');
  if (minimumBalanceCents !== null && maximumBalanceCents !== null
    && minimumBalanceCents > maximumBalanceCents) {
    throw creditError(400, 'El saldo minimo no puede superar el saldo maximo.');
  }
  if (minimumBalanceCents !== null) {
    conditions.push('f.saldoPendiente>=?');
    params.push(centsToDecimal(minimumBalanceCents));
  }
  if (maximumBalanceCents !== null) {
    conditions.push('f.saldoPendiente<=?');
    params.push(centsToDecimal(maximumBalanceCents));
  }
  if (query.idCliente || query.cliente) {
    conditions.push('f.idCliente=?');
    params.push(positiveIdentifier(query.idCliente || query.cliente, 'El cliente'));
  }
  const search = cleanText(query.busqueda || query.texto, 100);
  if (search) {
    conditions.push('(c.nombre LIKE ? OR c.telefono LIKE ? OR c.telefonoNormalizado LIKE ?)');
    const pattern = `%${search}%`;
    params.push(pattern, pattern, pattern);
  }
  const state = String(cleanText(query.estado, 30) || '').toLowerCase();
  addDebtStateFilter(conditions, params, state, {
    alias: 'f', today, warningThrough, allowStored
  });
  const startedFrom = query.desde
    ? parseLocalDate(query.desde, 'La fecha inicial', { allowNull: false }) : null;
  const startedTo = query.hasta
    ? parseLocalDate(query.hasta, 'La fecha final', { allowNull: false }) : null;
  if (startedFrom && startedTo && startedFrom > startedTo) {
    throw creditError(400, 'La fecha inicial debe ser anterior a la final.');
  }
  if (startedFrom) {
    conditions.push('f.fechaInicio>=?');
    params.push(startedFrom);
  }
  if (startedTo) {
    conditions.push('f.fechaInicio<=?');
    params.push(startedTo);
  }
  const effectiveDate = 'COALESCE(f.fechaPrometidaPago,f.fechaVencimiento)';
  const dueFrom = query.venceDesde
    ? parseLocalDate(query.venceDesde, 'La fecha inicial de vencimiento', { allowNull: false }) : null;
  const dueTo = query.venceHasta
    ? parseLocalDate(query.venceHasta, 'La fecha final de vencimiento', { allowNull: false }) : null;
  if (dueFrom && dueTo && dueFrom > dueTo) {
    throw creditError(400, 'La fecha inicial de vencimiento debe ser anterior a la final.');
  }
  if (dueFrom) {
    conditions.push(`${effectiveDate}>=?`);
    params.push(dueFrom);
  }
  if (dueTo) {
    conditions.push(`${effectiveDate}<=?`);
    params.push(dueTo);
  }
  return {
    active,
    conditions,
    dueFrom,
    dueTo,
    effectiveDate,
    params,
    startedFrom,
    startedTo,
    state,
    today,
    warningThrough,
    where: conditions.join(' AND ')
  };
}

function buildStatementFilter(query, idTienda, idCliente) {
  const from = parseLocalDate(query.fechaDesde, 'La fecha inicial');
  const to = parseLocalDate(query.fechaHasta, 'La fecha final');
  if (from && to && from > to) throw creditError(400, 'La fecha inicial debe ser anterior a la final.');
  const paymentConditions = ['f.idTienda=?', 'f.idCliente=?'];
  const paymentParams = [idTienda, idCliente];
  const debtConditions = ['f.idTienda=?', 'f.idCliente=?'];
  const debtParams = [idTienda, idCliente];
  const saleConditions = ['v.idTienda=?', 'v.idCliente=?'];
  const saleParams = [idTienda, idCliente];
  const debtEventDate = "COALESCE(v.fecha,CONCAT(f.fechaInicio,' 00:00:00'))";
  const fromDateTime = from ? `${from} 00:00:00` : null;
  const toExclusive = to ? `${addLocalDays(to, 1)} 00:00:00` : null;
  if (fromDateTime) {
    paymentConditions.push('pf.fechaPago>=?');
    paymentParams.push(fromDateTime);
    debtConditions.push(`${debtEventDate}>=?`);
    debtParams.push(fromDateTime);
    saleConditions.push('v.fecha>=?');
    saleParams.push(fromDateTime);
  }
  if (toExclusive) {
    paymentConditions.push('pf.fechaPago<?');
    paymentParams.push(toExclusive);
    debtConditions.push(`${debtEventDate}<?`);
    debtParams.push(toExclusive);
    saleConditions.push('v.fecha<?');
    saleParams.push(toExclusive);
  }
  const movementSql = `
    SELECT 'venta' tipo, v.fecha, 1 tipoOrden, v.idVenta ordenId,
           v.idVenta, NULL idFiado, NULL idPagoFiado, v.total monto,
           NULL metodoPago, NULL referencia, v.codigoComprobante,
           v.saldoPendiente, v.estadoPago
    FROM venta v WHERE ${saleConditions.join(' AND ')}
    UNION ALL
    SELECT 'fiado' tipo, ${debtEventDate} fecha, 2 tipoOrden, f.idFiado ordenId,
           f.idVenta, f.idFiado, NULL idPagoFiado, f.totalFiado monto,
           NULL metodoPago, NULL referencia, v.codigoComprobante,
           f.saldoPendiente, f.estado estadoPago
    FROM fiado f LEFT JOIN venta v ON v.idTienda=f.idTienda AND v.idVenta=f.idVenta
    WHERE ${debtConditions.join(' AND ')}
    UNION ALL
    SELECT 'pago' tipo, pf.fechaPago fecha, 3 tipoOrden, pf.idPagoFiado ordenId,
           f.idVenta, pf.idFiado, pf.idPagoFiado, pf.monto,
           cf.metodoPago, cf.referencia, v.codigoComprobante,
           f.saldoPendiente, f.estado estadoPago
    FROM pagoFiado pf
    JOIN fiado f ON f.idTienda=pf.idTienda AND f.idFiado=pf.idFiado
    JOIN cobroFiado cf ON cf.idTienda=pf.idTienda AND cf.idCobroFiado=pf.idCobroFiado
    LEFT JOIN venta v ON v.idTienda=f.idTienda AND v.idVenta=f.idVenta
    WHERE ${paymentConditions.join(' AND ')}`;
  return {
    debtConditions,
    debtEventDate,
    debtParams,
    from,
    fromDateTime,
    movementParams: [...saleParams, ...debtParams, ...paymentParams],
    movementSql,
    paymentConditions,
    paymentParams,
    saleConditions,
    saleParams,
    to,
    toExclusive
  };
}

function daysBetweenLocalDates(from, to) {
  const [fromYear, fromMonth, fromDay] = from.split('-').map(Number);
  const [toYear, toMonth, toDay] = to.split('-').map(Number);
  return Math.round((Date.UTC(toYear, toMonth - 1, toDay) - Date.UTC(fromYear, fromMonth - 1, fromDay)) / 86400000);
}

function localDateText(value) {
  if (!value) return null;
  if (value instanceof Date) return formatLocalDate(value);
  const text = String(value);
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : null;
}

function effectiveDebtDate(debt) {
  return localDateText(debt.fechaPrometidaPago) || localDateText(debt.fechaVencimiento) || null;
}

function collectionState(debt, today = formatLocalDate(), warningDays = 3) {
  if (moneyToCents(debt.saldoPendiente, 'El saldo') === 0) return 'pagado';
  const effectiveDate = effectiveDebtDate(debt);
  if (!effectiveDate) return 'sin_fecha';
  if (effectiveDate < today) return 'vencido';
  if (effectiveDate === today) return 'vence_hoy';
  return effectiveDate <= addLocalDays(today, warningDays) ? 'proximo_a_vencer' : 'al_dia';
}

async function getCreditConfiguration(connection, idTienda, { forUpdate = false } = {}) {
  const [rows] = await connection.query(
    `SELECT limiteCreditoDefault, diasCreditoDefault, diasAvisoVencimiento,
            politicaFiadoVencido, requiereTelefonoParaFiado, permiteFiadoSinFecha,
            codigoPaisWhatsApp, creadoEn, actualizadoEn, idAdministradorActualiza
     FROM configuracionCreditoTienda
     WHERE idTienda=?${forUpdate ? ' FOR UPDATE' : ''}`,
    [idTienda]
  );
  if (!rows.length) {
    throw creditError(409, 'La tienda no tiene una configuracion de credito valida.', 'CREDIT_CONFIGURATION_MISSING');
  }
  return rows[0];
}

async function lockCustomer(connection, idTienda, idCliente, { requireActive = false } = {}) {
  const [rows] = await connection.query(
    `SELECT idCliente, nombre, telefono, telefonoNormalizado, telefonoAlternativo,
            documentoIdentidad, documentoNormalizado, correo, direccion, notas,
            limiteCredito, permiteFiado, diasCreditoDefault, canalPreferido,
            aceptaRecordatorios, horarioPreferido, activo, eliminadoEn,
            creadoEn, actualizadoEn, idAdministradorActualiza
     FROM cliente
     WHERE idTienda=? AND idCliente=?
     FOR UPDATE`,
    [idTienda, idCliente]
  );
  if (!rows.length || (requireActive && Number(rows[0].activo) !== 1)) {
    throw creditError(404, 'Cliente no encontrado o inactivo.', 'CUSTOMER_NOT_FOUND');
  }
  return rows[0];
}

async function setCustomerVisibility(connection, input) {
  const targetActive = input.active === true ? 1 : 0;
  await connection.query('SELECT idTienda FROM tienda WHERE idTienda=? FOR UPDATE', [input.idTienda]);
  const customer = await lockCustomer(connection, input.idTienda, input.idCliente);
  if (Number(customer.activo) === targetActive) {
    throw targetActive
      ? creditError(409, 'El cliente ya esta activo.', 'CUSTOMER_ALREADY_ACTIVE')
      : creditError(409, 'El cliente ya esta oculto.', 'CUSTOMER_ALREADY_HIDDEN');
  }
  if (targetActive === 1) await enforcePlanLimit(connection, input.idTienda, 'clientes');

  const [[history]] = await connection.query(
    `SELECT COUNT(*) fiados, COALESCE(SUM(saldoPendiente),0) saldoPendiente
     FROM fiado WHERE idTienda=? AND idCliente=?`,
    [input.idTienda, input.idCliente]
  );
  const now = input.now || formatLocalDateTime();
  const [result] = await connection.query(
    `UPDATE cliente
     SET activo=?, eliminadoEn=?, actualizadoEn=?, idAdministradorActualiza=?
     WHERE idTienda=? AND idCliente=? AND activo=?`,
    [targetActive, targetActive ? null : now, now, input.idAdministrador,
      input.idTienda, input.idCliente, targetActive ? 0 : 1]
  );
  if (result.affectedRows !== 1) {
    throw creditError(409, 'El estado del cliente cambio durante la operacion.', 'CUSTOMER_STATE_CHANGED');
  }
  return {
    idCliente: customer.idCliente,
    activo: Boolean(targetActive),
    eliminadoEn: targetActive ? null : now,
    fiados: Number(history.fiados || 0),
    saldoPendiente: history.saldoPendiente,
    actualizadoEn: now
  };
}

async function lockCustomerDebts(connection, idTienda, idCliente) {
  const [rows] = await connection.query(
    `SELECT idFiado, idVenta, fechaInicio, fechaVencimiento, fechaPrometidaPago,
            totalFiado, totalPagado, saldoPendiente, estado, activo, cerradoEn
     FROM fiado
     WHERE idTienda=? AND idCliente=?
     ORDER BY idFiado ASC
     FOR UPDATE`,
    [idTienda, idCliente]
  );
  return rows;
}

function summarizeDebts(debts, today = formatLocalDate()) {
  let openCents = 0;
  let overdueCents = 0;
  let excessCents = 0;
  for (const debt of debts) {
    const balanceCents = moneyToCents(debt.saldoPendiente, 'El saldo');
    if (balanceCents <= 0) continue;
    openCents += balanceCents;
    if (collectionState(debt, today, 0) === 'vencido') overdueCents += balanceCents;
  }
  return { openCents, overdueCents, excessCents };
}

function effectiveLimitCents(customer, configuration) {
  const source = customer.limiteCredito === null ? configuration.limiteCreditoDefault : customer.limiteCredito;
  return moneyToCents(source, 'El limite de credito', { allowNull: true });
}

async function validateNewCredit(connection, input) {
  const today = input.saleDate || formatLocalDate();
  const newDebtCents = moneyToCents(input.newDebt, 'El nuevo saldo fiado', { allowZero: false });
  const customer = input.customer || await lockCustomer(connection, input.idTienda, input.idCliente, { requireActive: true });
  if (Number(customer.activo) !== 1) throw creditError(409, 'El cliente esta inactivo y no puede recibir un fiado.', 'CUSTOMER_INACTIVE');
  if (Number(customer.permiteFiado) !== 1) throw creditError(409, 'El cliente no tiene habilitados nuevos fiados.', 'CUSTOMER_CREDIT_DISABLED');
  const configuration = input.configuration || await getCreditConfiguration(connection, input.idTienda, { forUpdate: true });
  const hasUsablePhone = customer.telefonoNormalizado || normalizePhone(customer.telefonoAlternativo).normalized;
  if (Number(configuration.requiereTelefonoParaFiado) === 1 && !hasUsablePhone) {
    throw creditError(409, 'La politica de la tienda exige un telefono para vender fiado.', 'CUSTOMER_PHONE_REQUIRED');
  }
  const debts = input.debts || await lockCustomerDebts(connection, input.idTienda, input.idCliente);
  const summary = summarizeDebts(debts, today);
  const limitCents = effectiveLimitCents(customer, configuration);
  const projectedCents = summary.openCents + newDebtCents;
  if (limitCents !== null && projectedCents > limitCents) {
    throw creditError(409, 'El nuevo fiado supera el limite de credito disponible.', 'CREDIT_LIMIT_EXCEEDED');
  }

  let dueDate = parseLocalDate(input.requestedDueDate, 'La fecha de vencimiento');
  if (!dueDate) {
    const days = customer.diasCreditoDefault === null
      ? Number(configuration.diasCreditoDefault)
      : Number(customer.diasCreditoDefault);
    if (Number.isInteger(days) && days > 0) dueDate = addLocalDays(today, days);
  }
  if (!dueDate && Number(configuration.permiteFiadoSinFecha) !== 1) {
    throw creditError(409, 'La politica de la tienda exige una fecha de vencimiento.', 'CREDIT_DUE_DATE_REQUIRED');
  }
  if (dueDate && dueDate < today) {
    throw creditError(400, 'La fecha de vencimiento no puede ser anterior a la venta.', 'INVALID_CREDIT_DUE_DATE');
  }

  const warnings = [];
  let confirmedOverdueDebt = false;
  if (summary.overdueCents > 0) {
    const policy = String(configuration.politicaFiadoVencido);
    if (!CREDIT_POLICIES.has(policy)) throw creditError(409, 'La politica de deuda vencida no es valida.');
    if (policy === 'bloquear') {
      throw creditError(409, 'El cliente tiene deuda vencida y la politica de la tienda bloquea nuevos fiados.', 'OVERDUE_DEBT_BLOCKED');
    }
    warnings.push('El cliente tiene deuda vencida.');
    if (policy === 'advertir') {
      const reason = cleanText(input.overdueReason, 2000);
      if (input.confirmOverdueDebt !== true || !reason) {
        throw creditError(409, 'Debe confirmar la deuda vencida e indicar un motivo.', 'OVERDUE_DEBT_CONFIRMATION_REQUIRED');
      }
      confirmedOverdueDebt = true;
    }
  }

  const availableAfterCents = limitCents === null ? null : Math.max(0, limitCents - projectedCents);
  return {
    customer,
    configuration,
    debts,
    warnings,
    confirmedOverdueDebt,
    overdueReason: confirmedOverdueDebt ? cleanText(input.overdueReason, 2000) : null,
    dueDate,
    debtBeforeCents: summary.openCents,
    overdueDebtCents: summary.overdueCents,
    newDebtCents,
    debtAfterCents: projectedCents,
    limitCents,
    availableAfterCents,
    excessAfterCents: limitCents === null ? 0 : Math.max(0, projectedCents - limitCents)
  };
}

async function recordOverdueCreditConfirmation(connection, input) {
  if (!input.validation?.confirmedOverdueDebt) return null;
  const [result] = await connection.query(
    `INSERT INTO seguimientoCobranza
     (idTienda, idCliente, idFiado, tipo, canal, detalle, fechaCompromiso, creadoEn, idAdministrador)
     VALUES (?, ?, ?, 'nota', 'ninguno', ?, NULL, ?, ?)`,
    [input.idTienda, input.idCliente, input.idFiado, input.validation.overdueReason,
      input.createdAt || formatLocalDateTime(), input.idAdministrador]
  );
  return result.insertId;
}

function normalizeCustomerPayload(body, current = {}) {
  const source = body && typeof body === 'object' ? body : {};
  const name = cleanText(source.nombre === undefined ? current.nombre : source.nombre, 100, { required: true });
  const phone = normalizePhone(source.telefono === undefined ? current.telefono : source.telefono);
  const alternatePhone = normalizePhone(source.telefonoAlternativo === undefined
    ? current.telefonoAlternativo : source.telefonoAlternativo);
  const document = normalizeDocument(source.documentoIdentidad === undefined
    ? current.documentoIdentidad : source.documentoIdentidad);
  const channel = String(source.canalPreferido === undefined
    ? (current.canalPreferido || 'ninguno') : source.canalPreferido).trim().toLowerCase();
  if (!COMMUNICATION_CHANNELS.has(channel)) throw creditError(400, 'El canal preferido no es valido.');
  return {
    nombre: name,
    telefono: phone.original,
    telefonoNormalizado: phone.normalized,
    telefonoAlternativo: alternatePhone.original,
    documentoIdentidad: document.original,
    documentoNormalizado: document.normalized,
    correo: normalizeEmail(source.correo === undefined ? current.correo : source.correo),
    direccion: cleanText(source.direccion === undefined ? current.direccion : source.direccion, 255),
    notas: cleanText(source.notas === undefined ? current.notas : source.notas, 1000),
    limiteCreditoCents: moneyToCents(source.limiteCredito === undefined ? current.limiteCredito : source.limiteCredito,
      'El limite de credito', { allowNull: true }),
    permiteFiado: booleanValue(source.permiteFiado, 'La autorizacion de fiado', Number(current.permiteFiado ?? 1)),
    diasCreditoDefault: integerRange(source.diasCreditoDefault === undefined
      ? current.diasCreditoDefault : source.diasCreditoDefault, 'Los dias de credito', 1, 365, { allowNull: true }),
    canalPreferido: channel,
    aceptaRecordatorios: booleanValue(source.aceptaRecordatorios, 'La autorizacion de recordatorios',
      Number(current.aceptaRecordatorios ?? 1)),
    horarioPreferido: cleanText(source.horarioPreferido === undefined ? current.horarioPreferido : source.horarioPreferido, 120)
  };
}

function normalizeCreditConfiguration(body, current) {
  const source = body && typeof body === 'object' ? body : {};
  const policy = String(source.politicaFiadoVencido === undefined
    ? current.politicaFiadoVencido : source.politicaFiadoVencido).trim().toLowerCase();
  if (!CREDIT_POLICIES.has(policy)) throw creditError(400, 'La politica de fiado vencido no es valida.');
  const countryCodeRaw = source.codigoPaisWhatsApp === undefined ? current.codigoPaisWhatsApp : source.codigoPaisWhatsApp;
  const countryCode = cleanText(countryCodeRaw, 8);
  if (countryCode && !/^\d{1,8}$/.test(countryCode)) throw creditError(400, 'El codigo de pais debe contener solo digitos.');
  return {
    limiteCreditoDefaultCents: moneyToCents(source.limiteCreditoDefault === undefined
      ? current.limiteCreditoDefault : source.limiteCreditoDefault, 'El limite de credito predeterminado', { allowNull: true }),
    diasCreditoDefault: integerRange(source.diasCreditoDefault === undefined
      ? current.diasCreditoDefault : source.diasCreditoDefault, 'Los dias de credito', 1, 365),
    diasAvisoVencimiento: integerRange(source.diasAvisoVencimiento === undefined
      ? current.diasAvisoVencimiento : source.diasAvisoVencimiento, 'Los dias de aviso', 0, 90),
    politicaFiadoVencido: policy,
    requiereTelefonoParaFiado: booleanValue(source.requiereTelefonoParaFiado,
      'La exigencia de telefono', Number(current.requiereTelefonoParaFiado)),
    permiteFiadoSinFecha: booleanValue(source.permiteFiadoSinFecha,
      'La autorizacion de fiado sin fecha', Number(current.permiteFiadoSinFecha)),
    codigoPaisWhatsApp: countryCode
  };
}

module.exports = {
  addLocalDays,
  buildCustomerFilter,
  buildDebtFilter,
  buildStatementFilter,
  centsToDecimal,
  cleanText,
  collectionState,
  creditError,
  effectiveDebtDate,
  effectiveLimitCents,
  daysBetweenLocalDates,
  getCreditConfiguration,
  lockCustomer,
  lockCustomerDebts,
  localDateText,
  moneyToCents,
  normalizeCreditConfiguration,
  normalizeCustomerPayload,
  normalizeDocument,
  normalizeEmail,
  normalizePhone,
  parseLocalDate,
  recordOverdueCreditConfirmation,
  setCustomerVisibility,
  summarizeDebts,
  validateNewCredit
};
