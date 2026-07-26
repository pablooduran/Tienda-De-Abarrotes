const {
  addLocalDays,
  createLocalDate,
  dateTimeParts,
  formatLocalDate,
  formatLocalDateTime,
  getLocalNow,
  parseLocalDate,
  parseLocalDateTime: parseBusinessDateTime,
  startOfLocalDay
} = require('../utils/local-datetime');
const {
  debtCompensationMetrics,
  materialSettlementMetrics,
  paymentFlowsByMethod,
  salesCompensationMetrics,
  salesCompensationsByDay
} = require('./compensation-report-service');

const DEFAULT_EXPENSE_CATEGORIES = Object.freeze([
  ['Servicios básicos', 'servicios basicos'],
  ['Alquiler', 'alquiler'],
  ['Transporte y delivery', 'transporte y delivery'],
  ['Empaques y bolsas', 'empaques y bolsas'],
  ['Mantenimiento', 'mantenimiento'],
  ['Personal', 'personal'],
  ['Impuestos', 'impuestos'],
  ['Otros', 'otros']
]);

const EXPENSE_METHODS = new Set(['efectivo', 'qr', 'transferencia', 'otro']);
const COST_SOURCES = new Set(['real', 'estimado', 'desconocido']);
const MAX_REPORT_DAYS = 366;
const MAX_EXPORT_ROWS = 10000;
const MAX_MONEY_CENTS = 999999999999;

function httpError(status, message, code) {
  const error = new Error(message);
  error.status = status;
  if (code) error.code = code;
  return error;
}

function cleanText(value, maximum, { required = false, label = 'El texto' } = {}) {
  const text = String(value ?? '').trim().replace(/\s+/g, ' ');
  if (required && !text) throw httpError(400, `${label} es obligatorio.`);
  if (text.length > maximum) throw httpError(400, `${label} no puede superar ${maximum} caracteres.`);
  return text || null;
}

function normalizeName(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('es')
    .trim()
    .replace(/\s+/g, ' ');
}

function positiveId(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) throw httpError(400, `${label} no es valido.`);
  return number;
}

function booleanValue(value, defaultValue = false) {
  if (value === undefined || value === null || value === '') return defaultValue;
  if ([true, 1, '1', 'true'].includes(value)) return true;
  if ([false, 0, '0', 'false'].includes(value)) return false;
  throw httpError(400, 'El valor booleano no es valido.');
}

function cents(value, label, { allowZero = true } = {}) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw httpError(400, `${label} no es valido.`);
  const amount = Math.round(number * 100);
  if (amount < 0 || (!allowZero && amount === 0)) throw httpError(400, `${label} debe ser mayor a cero.`);
  if (!Number.isSafeInteger(amount) || amount > MAX_MONEY_CENTS) throw httpError(400, `${label} supera el monto permitido.`);
  return amount;
}

function decimal(valueInCents) {
  return (valueInCents / 100).toFixed(2);
}

function dateParts(value, label) {
  try {
    return parseLocalDate(value);
  } catch {
    throw httpError(400, `${label} debe usar una fecha valida en formato AAAA-MM-DD.`);
  }
}

const formatDateOnly = formatLocalDate;
const formatMysqlDateTime = formatLocalDateTime;

function startOfWeek(date) {
  const start = startOfLocalDay(date);
  const parts = dateTimeParts(start);
  const weekday = new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay() || 7;
  return addLocalDays(start, -weekday + 1);
}

function reportRange(query = {}, { maximumDays = MAX_REPORT_DAYS, defaultPeriod = 'mes' } = {}) {
  const now = getLocalNow();
  const today = startOfLocalDay(now);
  const todayParts = dateTimeParts(today);
  const period = String(query.periodo || defaultPeriod).trim().toLowerCase();
  let start;
  let endExclusive;
  if (query.desde || query.hasta || period === 'rango') {
    if (!query.desde || !query.hasta) throw httpError(400, 'Debe indicar fecha de inicio y fecha final.');
    start = dateParts(query.desde, 'La fecha de inicio');
    endExclusive = addLocalDays(dateParts(query.hasta, 'La fecha final'), 1);
  } else if (period === 'hoy' || period === 'dia') {
    start = today;
    endExclusive = addLocalDays(start, 1);
  } else if (period === 'ayer') {
    endExclusive = today;
    start = addLocalDays(endExclusive, -1);
  } else if (period === 'semana') {
    start = startOfWeek(now);
    endExclusive = addLocalDays(today, 1);
  } else if (period === 'mes_anterior') {
    endExclusive = createLocalDate(todayParts.year, todayParts.month, 1);
    const previousMonth = todayParts.month === 1
      ? { year: todayParts.year - 1, month: 12 }
      : { year: todayParts.year, month: todayParts.month - 1 };
    start = createLocalDate(previousMonth.year, previousMonth.month, 1);
  } else if (period === 'anio') {
    start = createLocalDate(todayParts.year, 1, 1);
    endExclusive = addLocalDays(today, 1);
  } else if (period === 'mes') {
    start = createLocalDate(todayParts.year, todayParts.month, 1);
    endExclusive = addLocalDays(today, 1);
  } else {
    throw httpError(400, 'El periodo seleccionado no es valido.');
  }
  if (endExclusive <= start) throw httpError(400, 'La fecha final debe ser igual o posterior a la fecha inicial.');
  const days = Math.ceil((endExclusive.getTime() - start.getTime()) / 86400000);
  if (days > maximumDays) throw httpError(400, `El rango no puede superar ${maximumDays} dias.`);
  return {
    desde: formatDateOnly(start),
    hasta: formatDateOnly(addLocalDays(endExclusive, -1)),
    inicio: `${formatDateOnly(start)} 00:00:00`,
    finExclusivo: `${formatDateOnly(endExclusive)} 00:00:00`,
    dias: days,
    periodo: period
  };
}

function parseLocalDateTime(value, label) {
  try {
    return parseBusinessDateTime(value);
  } catch {
    throw httpError(400, `${label} debe usar una fecha y hora local valida.`);
  }
}

function closeRange(body = {}) {
  const start = parseLocalDateTime(body.fechaInicio, 'La fecha de inicio');
  const end = parseLocalDateTime(body.fechaFin, 'La fecha final');
  if (end <= start) throw httpError(400, 'La fecha final debe ser posterior a la fecha inicial.');
  const durationDays = (end.getTime() - start.getTime()) / 86400000;
  if (durationDays > 31) throw httpError(400, 'Un cierre no puede cubrir mas de 31 dias.');
  if (end.getTime() > getLocalNow().getTime()) throw httpError(400, 'La fecha final no puede estar en el futuro.');
  return { inicio: formatMysqlDateTime(start), finExclusivo: formatMysqlDateTime(end) };
}

async function ensureDefaultExpenseCategories(connection, idTienda, localDateTime = formatLocalDateTime()) {
  for (const [name, normalized] of DEFAULT_EXPENSE_CATEGORIES) {
    await connection.query(
      `INSERT INTO categoriaGasto
       (idTienda, nombre, nombreNormalizado, descripcion, creadoEn, actualizadoEn)
       VALUES (?, ?, ?, 'Categoria inicial editable de la tienda.', ?, ?)
       ON DUPLICATE KEY UPDATE idCategoriaGasto=idCategoriaGasto`,
      [idTienda, name, normalized, localDateTime, localDateTime]
    );
  }
}

async function validateExpenseCategory(connection, idTienda, idCategoriaGasto, forUpdate = false) {
  const [rows] = await connection.query(
    `SELECT idCategoriaGasto, nombre, activo FROM categoriaGasto
     WHERE idTienda=? AND idCategoriaGasto=?${forUpdate ? ' FOR UPDATE' : ''}`,
    [idTienda, idCategoriaGasto]
  );
  if (!rows.length) throw httpError(404, 'La categoria de gasto no existe.');
  if (Number(rows[0].activo) !== 1) throw httpError(409, 'La categoria de gasto esta inactiva.');
  return rows[0];
}

function expensePayload(body = {}) {
  const idCategoriaGasto = positiveId(body.idCategoriaGasto, 'La categoria');
  const concepto = cleanText(body.concepto, 160, { required: true, label: 'El concepto' });
  const monto = decimal(cents(body.monto, 'El monto', { allowZero: false }));
  const metodoPago = String(body.metodoPago || '').trim().toLowerCase();
  if (!EXPENSE_METHODS.has(metodoPago)) throw httpError(400, 'El metodo de pago no es valido.');
  const date = body.fechaGasto ? parseLocalDateTime(body.fechaGasto, 'La fecha del gasto') : getLocalNow();
  return {
    idCategoriaGasto,
    concepto,
    monto,
    metodoPago,
    fechaGasto: formatMysqlDateTime(date),
    referencia: cleanText(body.referencia, 120, { label: 'La referencia' }),
    observacion: cleanText(body.observacion, 500, { label: 'La observacion' }),
    recurrente: booleanValue(body.recurrente) ? 1 : 0
  };
}

async function financialSummary(connection, idTienda, range) {
  const params = [idTienda, range.inicio, range.finExclusivo];
  const [
    [sales],
    [costs],
    paymentRows,
    [expenses],
    [debts],
    [receivables],
    [purchases],
    saleCompensations,
    materialSettlements,
    debtCompensations
  ] = await Promise.all([
    connection.query(
      `SELECT COALESCE(SUM(subtotal),0) ventasBrutas, COALESCE(SUM(descuento),0) descuentos,
              COALESCE(SUM(total),0) ventasNetas, COUNT(*) cantidadVentas
       FROM venta WHERE idTienda=? AND fecha>=? AND fecha<?`, params
    ),
    connection.query(
      `SELECT COALESCE(SUM(d.subtotalCosto),0) costoVendido,
              COALESCE(SUM(CASE WHEN d.origenCosto='real' THEN d.subtotalCosto ELSE 0 END),0) costoReal,
              COALESCE(SUM(CASE WHEN d.origenCosto='estimado' THEN d.subtotalCosto ELSE 0 END),0) costoEstimado,
              COALESCE(SUM(CASE WHEN d.origenCosto='real' THEN d.ganancia ELSE 0 END),0) gananciaConfirmada,
              COALESCE(SUM(CASE WHEN d.origenCosto='estimado' THEN d.ganancia ELSE 0 END),0) gananciaEstimada,
              COALESCE(SUM(CASE WHEN d.origenCosto='desconocido' THEN d.subtotalCosto+d.ganancia ELSE 0 END),0) ventasSinCosto,
              SUM(CASE WHEN d.origenCosto='desconocido' THEN 1 ELSE 0 END) detallesCostoDesconocido
       FROM detalleVenta d
       JOIN venta v ON v.idTienda=d.idTienda AND v.idVenta=d.idVenta
       WHERE d.idTienda=? AND v.fecha>=? AND v.fecha<?`, params
    ),
    paymentFlowsByMethod(connection, idTienda, range),
    connection.query(
      `SELECT COALESCE(SUM(monto),0) gastos, COUNT(*) cantidadGastos
       FROM gasto WHERE idTienda=? AND estado='registrado' AND fechaGasto>=? AND fechaGasto<?`, params
    ),
    connection.query(
      `SELECT COALESCE(SUM(f.totalFiado),0) fiadoGenerado
       FROM fiado f JOIN venta v ON v.idTienda=f.idTienda AND v.idVenta=f.idVenta
       WHERE f.idTienda=? AND v.fecha>=? AND v.fecha<?`, params
    ),
    connection.query(
      `SELECT COALESCE(SUM(saldoPendiente),0) cuentasPorCobrar,
              SUM(CASE WHEN saldoPendiente>0 THEN 1 ELSE 0 END) fiadosAbiertos
       FROM fiado WHERE idTienda=?`, [idTienda]
    ),
    connection.query(
      `SELECT COALESCE(SUM(total),0) compras, COUNT(*) cantidadCompras
       FROM compra WHERE idTienda=? AND fecha>=? AND fecha<?`, params
    ),
    salesCompensationMetrics(connection, idTienda, range),
    materialSettlementMetrics(connection, idTienda, range),
    debtCompensationMetrics(connection, idTienda, range)
  ]);
  const ventasAntesCompensaciones = Number(sales[0].ventasNetas || 0);
  const compensacionesVenta = Number(saleCompensations.montoCompensado || 0);
  const ventasNetas = ventasAntesCompensaciones - compensacionesVenta;
  const costoVendidoBruto = Number(costs[0].costoVendido || 0);
  const costoCompensado = Number(saleCompensations.costoCompensado || 0);
  const costoVendido = costoVendidoBruto - costoCompensado;
  const gastos = Number(expenses[0].gastos || 0);
  const dineroCobradoBruto = paymentRows.reduce(
    (sum, row) => sum + Number(row.bruto || 0), 0
  );
  const ajustesCompensatoriosCobro = paymentRows.reduce(
    (sum, row) => sum + Number(row.ajustesCompensatorios || 0), 0
  );
  const reembolsosRealizados = Number(materialSettlements.reembolsosRealizados || 0);
  const dineroCobrado = dineroCobradoBruto + ajustesCompensatoriosCobro
    - reembolsosRealizados;
  const gananciaConfirmada = Number(costs[0].gananciaConfirmada || 0)
    - Number(saleCompensations.gananciaRealCompensada || 0);
  const gananciaEstimada = Number(costs[0].gananciaEstimada || 0)
    - Number(saleCompensations.gananciaEstimadaCompensada || 0);
  const detallesCostoDesconocido = Number(costs[0].detallesCostoDesconocido || 0)
    + Number(saleCompensations.detallesCostoDesconocidoCompensados || 0);
  const gananciaBruta = ventasNetas - costoVendido;
  const gananciaBrutaCalculable = Number(costs[0].gananciaConfirmada || 0)
    + Number(costs[0].gananciaEstimada || 0)
    - Number(saleCompensations.gananciaCalculableCompensada || 0);
  const method = (name) => paymentRows.find((row) => row.metodo === name);
  const methodNet = (name) => Number(method(name)?.neto || 0);
  const cobrosFiado = paymentRows.reduce(
    (sum, row) => sum + Number(row.cobrosFiadoNetos || 0), 0
  );
  return {
    rango: range,
    ventasBrutas: Number(sales[0].ventasBrutas || 0),
    descuentos: Number(sales[0].descuentos || 0),
    ventasAntesCompensaciones,
    compensacionesVenta,
    ventasNetas,
    cantidadVentas: Number(sales[0].cantidadVentas || 0),
    costoVendidoBruto,
    costoCompensado,
    costoVendido,
    costoReal: Number(costs[0].costoReal || 0)
      - Number(saleCompensations.costoRealCompensado || 0),
    costoEstimado: Number(costs[0].costoEstimado || 0)
      - Number(saleCompensations.costoEstimadoCompensado || 0),
    gananciaBrutaConfirmada: gananciaConfirmada,
    gananciaBrutaEstimada: gananciaEstimada,
    ventasSinCosto: Number(costs[0].ventasSinCosto || 0)
      - Number(saleCompensations.ventasSinCostoCompensadas || 0),
    detallesCostoDesconocido,
    gananciaBruta,
    gananciaBrutaCalculable,
    gastos,
    cantidadGastos: Number(expenses[0].cantidadGastos || 0),
    gananciaNeta: gananciaBruta - gastos,
    gananciaNetaCalculable: gananciaBrutaCalculable - gastos,
    rentabilidadCompleta: detallesCostoDesconocido === 0,
    rentabilidadExacta: detallesCostoDesconocido === 0 && Number(costs[0].costoEstimado || 0) === 0,
    dineroCobradoBruto,
    ajustesCompensatoriosCobro,
    reembolsosRealizados,
    liquidacionesOtroMedio: Number(materialSettlements.liquidacionesOtroMedio || 0),
    dineroCobrado,
    efectivo: methodNet('efectivo'),
    qr: methodNet('qr'),
    cobrosNoEspecificados: methodNet('no_especificado'),
    cobrosOtrosMetodos: paymentRows
      .filter((row) => !['efectivo', 'qr', 'no_especificado'].includes(row.metodo))
      .reduce((sum, row) => sum + Number(row.neto || 0), 0),
    cobrosFiado,
    fiadoGenerado: Number(debts[0].fiadoGenerado || 0),
    deudaCompensada: Number(debtCompensations.deudaCompensada || 0),
    cuentasPorCobrar: Number(receivables[0].cuentasPorCobrar || 0),
    fiadosAbiertos: Number(receivables[0].fiadosAbiertos || 0),
    compras: Number(purchases[0].compras || 0),
    cantidadCompras: Number(purchases[0].cantidadCompras || 0),
    flujoEfectivoConocido: dineroCobrado - gastos,
    comprasIncluidasEnFlujo: false
  };
}

async function salesByDay(connection, idTienda, range) {
  const [rows] = await connection.query(
    `SELECT DATE_FORMAT(v.fecha,'%Y-%m-%d') fecha, COUNT(*) cantidadVentas,
            COALESCE(SUM(v.subtotal),0) ventasBrutas, COALESCE(SUM(v.descuento),0) descuentos,
            COALESCE(SUM(v.total),0) ventasNetas,
            COALESCE(SUM(costos.costo),0) costoVendido,
            COALESCE(SUM(v.total),0)-COALESCE(SUM(costos.costo),0) gananciaBruta,
            COALESCE(SUM(costos.gananciaCalculable),0) gananciaCalculable
     FROM venta v
     LEFT JOIN (
       SELECT idTienda, idVenta, SUM(subtotalCosto) costo,
              SUM(CASE WHEN origenCosto<>'desconocido' THEN ganancia ELSE 0 END) gananciaCalculable
       FROM detalleVenta GROUP BY idTienda, idVenta
     ) costos ON costos.idTienda=v.idTienda AND costos.idVenta=v.idVenta
     WHERE v.idTienda=? AND v.fecha>=? AND v.fecha<?
     GROUP BY DATE_FORMAT(v.fecha,'%Y-%m-%d')
     ORDER BY DATE_FORMAT(v.fecha,'%Y-%m-%d')`,
    [idTienda, range.inicio, range.finExclusivo]
  );
  const compensations = await salesCompensationsByDay(
    connection, idTienda, range
  );
  const byDate = new Map(rows.map((row) => [String(row.fecha), {
    ...row,
    ventasAntesCompensaciones: Number(row.ventasNetas || 0),
    compensacionesVenta: 0,
    costoCompensado: 0,
    cantidadCompensaciones: 0
  }]));
  for (const compensation of compensations) {
    const date = String(compensation.fecha);
    const current = byDate.get(date) || {
      fecha: date,
      cantidadVentas: 0,
      ventasBrutas: 0,
      descuentos: 0,
      ventasNetas: 0,
      ventasAntesCompensaciones: 0,
      costoVendido: 0,
      gananciaBruta: 0,
      gananciaCalculable: 0,
      compensacionesVenta: 0,
      costoCompensado: 0,
      cantidadCompensaciones: 0
    };
    current.compensacionesVenta = Number(compensation.montoCompensado || 0);
    current.costoCompensado = Number(compensation.costoCompensado || 0);
    current.cantidadCompensaciones = Number(
      compensation.cantidadCompensaciones || 0
    );
    current.ventasNetas = Number(current.ventasAntesCompensaciones || 0)
      - current.compensacionesVenta;
    current.costoVendido = Number(current.costoVendido || 0)
      - current.costoCompensado;
    current.gananciaBruta = current.ventasNetas - current.costoVendido;
    current.gananciaCalculable = Number(current.gananciaCalculable || 0)
      - Number(compensation.gananciaCalculableCompensada || 0);
    byDate.set(date, current);
  }
  return [...byDate.values()].sort((left, right) =>
    String(left.fecha).localeCompare(String(right.fecha)));
}

async function paymentMethods(connection, idTienda, range) {
  const rows = await paymentFlowsByMethod(connection, idTienda, range);
  return rows.map((row) => ({
    metodoPago: row.metodo,
    pagosIniciales: Number(row.pagosInicialesNetos || 0),
    cobrosFiado: Number(row.cobrosFiadoNetos || 0),
    bruto: Number(row.bruto || 0),
    ajustesCompensatorios: Number(row.ajustesCompensatorios || 0),
    compensaciones: Number(row.salidasCompensatorias || 0),
    reembolsos: Number(row.reembolsos || 0),
    total: Number(row.neto || 0),
    cantidad: Number(row.cantidad || 0)
  }));
}

async function expensesByCategory(connection, idTienda, range) {
  const [rows] = await connection.query(
    `SELECT cg.idCategoriaGasto, cg.nombre categoria, COUNT(g.idGasto) cantidad,
            COALESCE(SUM(g.monto),0) total
     FROM categoriaGasto cg
     LEFT JOIN gasto g ON g.idTienda=cg.idTienda AND g.idCategoriaGasto=cg.idCategoriaGasto
       AND g.estado='registrado' AND g.fechaGasto>=? AND g.fechaGasto<?
     WHERE cg.idTienda=?
     GROUP BY cg.idTienda, cg.idCategoriaGasto, cg.nombre
     HAVING total>0 ORDER BY total DESC`,
    [range.inicio, range.finExclusivo, idTienda]
  );
  const total = rows.reduce((sum, row) => sum + Number(row.total || 0), 0);
  return rows.map((row) => ({ ...row, porcentaje: total ? Number(row.total) * 100 / total : 0 }));
}

async function expensesByDay(connection, idTienda, range) {
  const [rows] = await connection.query(
    `SELECT DATE(fechaGasto) AS fecha, COUNT(*) AS cantidad, COALESCE(SUM(monto),0) AS total
     FROM gasto
     WHERE idTienda=? AND estado='registrado' AND fechaGasto>=? AND fechaGasto<?
     GROUP BY DATE(fechaGasto)
     ORDER BY DATE(fechaGasto)`,
    [idTienda, range.inicio, range.finExclusivo]
  );
  return rows;
}

async function productProfitability(connection, idTienda, range, filters = {}, options = {}) {
  const commonConditions = [];
  const commonParams = [];
  if (filters.idProducto) {
    commonConditions.push('p.idProducto=?');
    commonParams.push(positiveId(filters.idProducto, 'El producto'));
  }
  if (filters.categoria) {
    commonConditions.push('p.categoria=?');
    commonParams.push(String(filters.categoria).trim().slice(0, 50));
  }
  if (filters.idProveedor) {
    commonConditions.push('p.idProveedor=?');
    commonParams.push(positiveId(filters.idProveedor, 'El proveedor'));
  }
  let presentation = null;
  if (filters.presentacion) {
    presentation = String(filters.presentacion).trim().toLowerCase();
    if (!['unidad', 'paquete'].includes(presentation)) throw httpError(400, 'La presentacion no es valida.');
  }
  let paymentState = null;
  if (filters.estadoPago) {
    paymentState = String(filters.estadoPago).trim().toLowerCase();
    if (!['pagada', 'parcial', 'pendiente', 'legado'].includes(paymentState)) {
      throw httpError(400, 'El estado de pago no es valido.');
    }
  }
  const maximumLimit = Math.min(MAX_EXPORT_ROWS, Math.max(1, Number(options.maximumLimit) || 500));
  const limit = Math.min(maximumLimit, Math.max(1, Number.parseInt(filters.limit, 10) || 100));
  const saleConditions = [
    'd.idTienda=?',
    'v.fecha>=?',
    'v.fecha<?',
    ...commonConditions,
    ...(presentation ? ['d.presentacionVenta=?'] : []),
    ...(paymentState ? ['v.estadoPago=?'] : [])
  ];
  const saleParams = [
    idTienda,
    range.inicio,
    range.finExclusivo,
    ...commonParams,
    ...(presentation ? [presentation] : []),
    ...(paymentState ? [paymentState] : [])
  ];
  const compensationConditions = [
    'dcv.idTienda=?',
    'cv.creadoEn>=?',
    'cv.creadoEn<?',
    ...commonConditions,
    ...(presentation ? ['d.presentacionVenta=?'] : []),
    ...(paymentState ? ['v.estadoPago=?'] : [])
  ];
  const compensationParams = [
    idTienda,
    range.inicio,
    range.finExclusivo,
    ...commonParams,
    ...(presentation ? [presentation] : []),
    ...(paymentState ? [paymentState] : [])
  ];
  const [rows] = await connection.query(
    `WITH movimientos AS (
       SELECT d.idTienda, d.idProducto,
              d.cantidadEquivalenteUnidades unidadesVendidas,
              0 unidadesDevueltas,
              CASE WHEN d.presentacionVenta='paquete' THEN d.cantidad ELSE 0 END
                paquetesVendidos,
              d.subtotal ventasBrutas,
              GREATEST(0,d.subtotal-(d.subtotalCosto+d.ganancia)) descuentos,
              d.subtotalCosto+d.ganancia ventasAntesCompensaciones,
              0 compensacionesVenta,
              d.subtotalCosto costoVendidoBruto,
              0 costoCompensado,
              CASE WHEN d.origenCosto<>'desconocido' THEN d.ganancia ELSE 0 END
                gananciaConCostoBruta,
              0 gananciaCompensada,
              CASE WHEN d.origenCosto='desconocido'
                   THEN d.subtotalCosto+d.ganancia ELSE 0 END ventasSinCosto,
              CASE WHEN d.origenCosto='real' THEN 1 ELSE 0 END detallesCostoReal,
              CASE WHEN d.origenCosto='estimado' THEN 1 ELSE 0 END
                detallesCostoEstimado,
              CASE WHEN d.origenCosto='desconocido' THEN 1 ELSE 0 END
                detallesCostoDesconocido
       FROM detalleVenta d
       JOIN venta v ON v.idTienda=d.idTienda AND v.idVenta=d.idVenta
       JOIN producto p ON p.idTienda=d.idTienda AND p.idProducto=d.idProducto
       WHERE ${saleConditions.join(' AND ')}

       UNION ALL

       SELECT dcv.idTienda, dcv.idProducto, 0, dcv.unidadesDevueltas, 0,
              0, 0, 0, dcv.montoCompensado, 0, dcv.costoCompensado, 0,
              CASE WHEN d.origenCosto<>'desconocido'
                   THEN dcv.montoCompensado-dcv.costoCompensado ELSE 0 END,
              CASE WHEN d.origenCosto='desconocido'
                   THEN -dcv.montoCompensado ELSE 0 END,
              CASE WHEN d.origenCosto='real' THEN 1 ELSE 0 END,
              CASE WHEN d.origenCosto='estimado' THEN 1 ELSE 0 END,
              CASE WHEN d.origenCosto='desconocido' THEN 1 ELSE 0 END
       FROM detalleCompensacionVenta dcv
       JOIN compensacionVenta cv
         ON cv.idTienda=dcv.idTienda
        AND cv.idCompensacionVenta=dcv.idCompensacionVenta
       JOIN detalleVenta d
         ON d.idTienda=dcv.idTienda AND d.idDetalleVenta=dcv.idDetalleVenta
       JOIN venta v ON v.idTienda=d.idTienda AND v.idVenta=d.idVenta
       JOIN producto p ON p.idTienda=dcv.idTienda AND p.idProducto=dcv.idProducto
       WHERE ${compensationConditions.join(' AND ')}
     )
     SELECT p.idProducto, p.nombre, p.categoria,
            COALESCE(pr.nombre,'Sin proveedor') proveedor,
            SUM(m.unidadesVendidas) unidadesVendidas,
            SUM(m.unidadesDevueltas) unidadesDevueltas,
            SUM(m.unidadesVendidas)-SUM(m.unidadesDevueltas) unidadesNetas,
            SUM(m.paquetesVendidos) paquetesVendidos,
            SUM(m.ventasBrutas) ventasBrutas,
            SUM(m.descuentos) descuentos,
            SUM(m.ventasAntesCompensaciones) ventasAntesCompensaciones,
            SUM(m.compensacionesVenta) compensacionesVenta,
            SUM(m.ventasAntesCompensaciones)-SUM(m.compensacionesVenta) ventasNetas,
            SUM(m.costoVendidoBruto) costoVendidoBruto,
            SUM(m.costoCompensado) costoCompensado,
            SUM(m.costoVendidoBruto)-SUM(m.costoCompensado) costoVendido,
            SUM(m.gananciaConCostoBruta)-SUM(m.gananciaCompensada) gananciaConCosto,
            SUM(m.ventasSinCosto) ventasSinCosto,
            SUM(m.detallesCostoReal) detallesCostoReal,
            SUM(m.detallesCostoEstimado) detallesCostoEstimado,
            SUM(m.detallesCostoDesconocido) detallesCostoDesconocido
     FROM movimientos m
     JOIN producto p ON p.idTienda=m.idTienda AND p.idProducto=m.idProducto
     LEFT JOIN proveedor pr
       ON pr.idTienda=p.idTienda AND pr.idProveedor=p.idProveedor
     GROUP BY p.idTienda, p.idProducto, p.nombre, p.categoria, pr.nombre
     ORDER BY gananciaConCosto DESC, ventasNetas DESC, p.idProducto
     LIMIT ?`,
    [...saleParams, ...compensationParams, limit]
  );
  return rows.map((row, index) => ({
    ...row,
    ranking: index + 1,
    margenPorcentaje: Number(row.ventasNetas) > 0 && Number(row.detallesCostoDesconocido) === 0
      ? Number(row.gananciaConCosto) * 100 / Number(row.ventasNetas)
      : null,
    margenEstimado: Number(row.detallesCostoEstimado) > 0,
    costoConfiable: Number(row.detallesCostoDesconocido) === 0 && Number(row.detallesCostoEstimado) === 0
  }));
}

async function receivables(connection, idTienda, { limit = 100, offset = 0 } = {}) {
  const [rows] = await connection.query(
    `SELECT f.idFiado, f.idVenta, f.fechaInicio, f.totalFiado, f.totalPagado,
            f.saldoPendiente, f.estado, f.activo, c.idCliente, c.nombre cliente, c.telefono
     FROM fiado f JOIN cliente c ON c.idTienda=f.idTienda AND c.idCliente=f.idCliente
     WHERE f.idTienda=? AND f.saldoPendiente>0
     ORDER BY f.fechaInicio, f.idFiado LIMIT ? OFFSET ?`, [idTienda, limit, offset]
  );
  return rows;
}

async function purchasesReport(connection, idTienda, range, { limit = 100, offset = 0 } = {}) {
  const [rows] = await connection.query(
    `SELECT c.idCompra, c.fecha, c.total, COALESCE(p.nombre,'Sin proveedor') proveedor
     FROM compra c LEFT JOIN proveedor p ON p.idTienda=c.idTienda AND p.idProveedor=c.idProveedor
     WHERE c.idTienda=? AND c.fecha>=? AND c.fecha<? ORDER BY c.fecha DESC, c.idCompra DESC LIMIT ? OFFSET ?`,
    [idTienda, range.inicio, range.finExclusivo, limit, offset]
  );
  return rows;
}

async function calculateCashClose(connection, idTienda, range, initialValue = 0) {
  const initialCents = cents(initialValue, 'El efectivo inicial');
  const params = [idTienda, range.inicio, range.finExclusivo];
  const [
    paymentRows,
    [expenses],
    [sales],
    [debts],
    [purchases],
    saleCompensations,
    materialSettlements
  ] = await Promise.all([
    paymentFlowsByMethod(connection, idTienda, range),
    connection.query(
      `SELECT COALESCE(SUM(CASE WHEN metodoPago='efectivo' THEN monto ELSE 0 END),0) gastosEfectivo,
              COALESCE(SUM(monto),0) totalGastos
       FROM gasto WHERE idTienda=? AND estado='registrado' AND fechaGasto>=? AND fechaGasto<?`, params
    ),
    connection.query(
      'SELECT COALESCE(SUM(total),0) totalVentas FROM venta WHERE idTienda=? AND fecha>=? AND fecha<?', params
    ),
    connection.query(
      `SELECT COALESCE(SUM(f.totalFiado),0) totalFiadoGenerado
       FROM fiado f JOIN venta v ON v.idTienda=f.idTienda AND v.idVenta=f.idVenta
       WHERE f.idTienda=? AND v.fecha>=? AND v.fecha<?`, params
    ),
    connection.query(
      'SELECT COALESCE(SUM(total),0) totalCompras FROM compra WHERE idTienda=? AND fecha>=? AND fecha<?', params
    ),
    salesCompensationMetrics(connection, idTienda, range),
    materialSettlementMetrics(connection, idTienda, range)
  ]);
  const cash = paymentRows.find((row) => row.metodo === 'efectivo') || {};
  const efectivoVentas = cents(
    Number(cash.pagosInicialesBrutos || 0) + Number(cash.entradasVenta || 0),
    'Efectivo de ventas'
  );
  const efectivoFiados = cents(
    Number(cash.cobrosFiadoBrutos || 0) + Number(cash.entradasFiado || 0),
    'Efectivo de fiados'
  );
  const reembolsosEfectivo = cents(
    cash.reembolsos || 0, 'Reembolsos en efectivo'
  );
  const compensacionesEfectivo = cents(
    Number(cash.salidasVenta || 0) + Number(cash.salidasFiado || 0),
    'Compensaciones en efectivo'
  );
  const gastosEfectivo = cents(expenses[0].gastosEfectivo, 'Gastos en efectivo');
  const expected = initialCents + efectivoVentas + efectivoFiados
    - compensacionesEfectivo - reembolsosEfectivo - gastosEfectivo;
  if (expected < 0) throw httpError(409, 'El efectivo esperado es negativo. Revise el efectivo inicial o los gastos del periodo.');
  const methodInflows = (name) => {
    const row = paymentRows.find((item) => item.metodo === name) || {};
    return Number(row.bruto || 0) + Number(row.entradasCompensatorias || 0);
  };
  const unspecifiedInflows = paymentRows
    .filter((row) => !['efectivo', 'qr'].includes(row.metodo))
    .reduce((sum, row) => sum + Number(row.bruto || 0)
      + Number(row.entradasCompensatorias || 0), 0);
  const totalCollected = paymentRows.reduce(
    (sum, row) => sum + Number(row.bruto || 0)
      + Number(row.entradasCompensatorias || 0), 0
  );
  const totalCompensations = paymentRows.reduce(
    (sum, row) => sum + Number(row.salidasCompensatorias || 0), 0
  );
  const totalRefunds = paymentRows.reduce(
    (sum, row) => sum + Number(row.reembolsos || 0), 0
  );
  const totalCollectedNet = totalCollected - totalCompensations - totalRefunds;
  const totalSales = Number(sales[0].totalVentas || 0);
  const compensatedSales = Number(saleCompensations.montoCompensado || 0);
  return {
    fechaInicio: range.inicio,
    fechaFin: range.finExclusivo,
    efectivoInicial: decimal(initialCents),
    efectivoVentasEsperado: decimal(efectivoVentas),
    efectivoFiadosCobrado: decimal(efectivoFiados),
    gastosEfectivo: decimal(gastosEfectivo),
    compensacionesEfectivo: decimal(compensacionesEfectivo),
    reembolsosEfectivo: decimal(reembolsosEfectivo),
    compensacionesCobroTotal: decimal(cents(
      totalCompensations, 'Compensaciones totales de cobro'
    )),
    reembolsosTotal: decimal(cents(totalRefunds, 'Reembolsos totales')),
    efectivoEsperado: decimal(expected),
    totalQR: decimal(cents(methodInflows('qr'), 'Total QR')),
    totalNoEspecificado: decimal(cents(
      unspecifiedInflows, 'Total no especificado'
    )),
    totalCobrado: decimal(cents(totalCollected, 'Total cobrado')),
    totalCobradoNeto: decimal(Math.round(totalCollectedNet * 100)),
    totalVentas: decimal(cents(totalSales, 'Total vendido')),
    compensacionesVenta: decimal(cents(
      compensatedSales, 'Compensaciones de venta'
    )),
    totalVentasNeto: decimal(Math.round((totalSales - compensatedSales) * 100)),
    liquidacionesOtroMedio: decimal(cents(
      materialSettlements.liquidacionesOtroMedio || 0,
      'Liquidaciones por otro medio'
    )),
    totalFiadoGenerado: decimal(cents(debts[0].totalFiadoGenerado, 'Fiado generado')),
    totalGastos: decimal(cents(expenses[0].totalGastos, 'Total de gastos')),
    totalCompras: decimal(cents(purchases[0].totalCompras, 'Total de compras')),
    comprasAfectanEfectivoEsperado: false
  };
}

module.exports = {
  COST_SOURCES,
  DEFAULT_EXPENSE_CATEGORIES,
  EXPENSE_METHODS,
  MAX_EXPORT_ROWS,
  MAX_REPORT_DAYS,
  calculateCashClose,
  cents,
  cleanText,
  closeRange,
  decimal,
  ensureDefaultExpenseCategories,
  expensePayload,
  expensesByCategory,
  expensesByDay,
  financialSummary,
  formatMysqlDateTime,
  httpError,
  normalizeName,
  paymentMethods,
  positiveId,
  productProfitability,
  purchasesReport,
  receivables,
  reportRange,
  salesByDay,
  validateExpenseCategory
};
