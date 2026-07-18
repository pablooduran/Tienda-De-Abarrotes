const { formatLocalDate, formatLocalDateTime } = require('../utils/local-datetime');

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
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw httpError(400, `${label} debe usar el formato AAAA-MM-DD.`);
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (date.getFullYear() !== Number(match[1]) || date.getMonth() !== Number(match[2]) - 1 || date.getDate() !== Number(match[3])) {
    throw httpError(400, `${label} no es valida.`);
  }
  return date;
}

const formatDateOnly = formatLocalDate;
const formatMysqlDateTime = formatLocalDateTime;

function addDays(date, days) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

function startOfWeek(date) {
  const copy = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const weekday = copy.getDay() || 7;
  copy.setDate(copy.getDate() - weekday + 1);
  return copy;
}

function reportRange(query = {}, { maximumDays = MAX_REPORT_DAYS, defaultPeriod = 'mes' } = {}) {
  const now = new Date();
  const period = String(query.periodo || defaultPeriod).trim().toLowerCase();
  let start;
  let endExclusive;
  if (query.desde || query.hasta || period === 'rango') {
    if (!query.desde || !query.hasta) throw httpError(400, 'Debe indicar fecha de inicio y fecha final.');
    start = dateParts(query.desde, 'La fecha de inicio');
    endExclusive = addDays(dateParts(query.hasta, 'La fecha final'), 1);
  } else if (period === 'hoy' || period === 'dia') {
    start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    endExclusive = addDays(start, 1);
  } else if (period === 'ayer') {
    endExclusive = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    start = addDays(endExclusive, -1);
  } else if (period === 'semana') {
    start = startOfWeek(now);
    endExclusive = addDays(now, 1);
  } else if (period === 'mes_anterior') {
    start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    endExclusive = new Date(now.getFullYear(), now.getMonth(), 1);
  } else if (period === 'anio') {
    start = new Date(now.getFullYear(), 0, 1);
    endExclusive = addDays(now, 1);
  } else if (period === 'mes') {
    start = new Date(now.getFullYear(), now.getMonth(), 1);
    endExclusive = addDays(now, 1);
  } else {
    throw httpError(400, 'El periodo seleccionado no es valido.');
  }
  if (endExclusive <= start) throw httpError(400, 'La fecha final debe ser igual o posterior a la fecha inicial.');
  const days = Math.ceil((endExclusive.getTime() - start.getTime()) / 86400000);
  if (days > maximumDays) throw httpError(400, `El rango no puede superar ${maximumDays} dias.`);
  return {
    desde: formatDateOnly(start),
    hasta: formatDateOnly(addDays(endExclusive, -1)),
    inicio: `${formatDateOnly(start)} 00:00:00`,
    finExclusivo: `${formatDateOnly(endExclusive)} 00:00:00`,
    dias: days,
    periodo: period
  };
}

function parseLocalDateTime(value, label) {
  const match = String(value || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) throw httpError(400, `${label} debe usar una fecha y hora local valida.`);
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]), Number(match[6] || 0));
  if (date.getFullYear() !== Number(match[1]) || date.getMonth() !== Number(match[2]) - 1
    || date.getDate() !== Number(match[3]) || date.getHours() !== Number(match[4]) || date.getMinutes() !== Number(match[5])) {
    throw httpError(400, `${label} no es valida.`);
  }
  return date;
}

function closeRange(body = {}) {
  const start = parseLocalDateTime(body.fechaInicio, 'La fecha de inicio');
  const end = parseLocalDateTime(body.fechaFin, 'La fecha final');
  if (end <= start) throw httpError(400, 'La fecha final debe ser posterior a la fecha inicial.');
  const durationDays = (end.getTime() - start.getTime()) / 86400000;
  if (durationDays > 31) throw httpError(400, 'Un cierre no puede cubrir mas de 31 dias.');
  if (end.getTime() > Date.now() + 300000) throw httpError(400, 'La fecha final no puede estar en el futuro.');
  return { inicio: formatMysqlDateTime(start), finExclusivo: formatMysqlDateTime(end) };
}

async function ensureDefaultExpenseCategories(connection, idTienda) {
  for (const [name, normalized] of DEFAULT_EXPENSE_CATEGORIES) {
    await connection.query(
      `INSERT INTO categoriaGasto (idTienda, nombre, nombreNormalizado, descripcion)
       VALUES (?, ?, ?, 'Categoria inicial editable de la tienda.')
       ON DUPLICATE KEY UPDATE idCategoriaGasto=idCategoriaGasto`,
      [idTienda, name, normalized]
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
  const date = body.fechaGasto ? parseLocalDateTime(body.fechaGasto, 'La fecha del gasto') : new Date();
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
  const [[sales], [costs], [payments], [expenses], [debts], [receivables], [purchases]] = await Promise.all([
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
    connection.query(
      `SELECT COALESCE(SUM(monto),0) dineroCobrado,
              COALESCE(SUM(CASE WHEN metodoPago='efectivo' THEN monto ELSE 0 END),0) efectivo,
              COALESCE(SUM(CASE WHEN metodoPago='qr' THEN monto ELSE 0 END),0) qr,
              COALESCE(SUM(CASE WHEN metodoPago='no_especificado' THEN monto ELSE 0 END),0) noEspecificado,
              COALESCE(SUM(CASE WHEN idPagoFiado IS NOT NULL THEN monto ELSE 0 END),0) cobrosFiado
       FROM pagoVenta WHERE idTienda=? AND creadoEn>=? AND creadoEn<?`, params
    ),
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
    )
  ]);
  const ventasNetas = Number(sales[0].ventasNetas || 0);
  const costoVendido = Number(costs[0].costoVendido || 0);
  const gastos = Number(expenses[0].gastos || 0);
  const dineroCobrado = Number(payments[0].dineroCobrado || 0);
  const gananciaConfirmada = Number(costs[0].gananciaConfirmada || 0);
  const gananciaEstimada = Number(costs[0].gananciaEstimada || 0);
  const detallesCostoDesconocido = Number(costs[0].detallesCostoDesconocido || 0);
  const gananciaBruta = ventasNetas - costoVendido;
  const gananciaBrutaCalculable = gananciaConfirmada + gananciaEstimada;
  return {
    rango: range,
    ventasBrutas: Number(sales[0].ventasBrutas || 0),
    descuentos: Number(sales[0].descuentos || 0),
    ventasNetas,
    cantidadVentas: Number(sales[0].cantidadVentas || 0),
    costoVendido,
    costoReal: Number(costs[0].costoReal || 0),
    costoEstimado: Number(costs[0].costoEstimado || 0),
    gananciaBrutaConfirmada: gananciaConfirmada,
    gananciaBrutaEstimada: gananciaEstimada,
    ventasSinCosto: Number(costs[0].ventasSinCosto || 0),
    detallesCostoDesconocido,
    gananciaBruta,
    gananciaBrutaCalculable,
    gastos,
    cantidadGastos: Number(expenses[0].cantidadGastos || 0),
    gananciaNeta: gananciaBruta - gastos,
    gananciaNetaCalculable: gananciaBrutaCalculable - gastos,
    rentabilidadCompleta: detallesCostoDesconocido === 0,
    rentabilidadExacta: detallesCostoDesconocido === 0 && Number(costs[0].costoEstimado || 0) === 0,
    dineroCobrado,
    efectivo: Number(payments[0].efectivo || 0),
    qr: Number(payments[0].qr || 0),
    cobrosNoEspecificados: Number(payments[0].noEspecificado || 0),
    cobrosFiado: Number(payments[0].cobrosFiado || 0),
    fiadoGenerado: Number(debts[0].fiadoGenerado || 0),
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
  return rows;
}

async function paymentMethods(connection, idTienda, range) {
  const [rows] = await connection.query(
    `SELECT metodoPago,
            COALESCE(SUM(CASE WHEN idPagoFiado IS NULL THEN monto ELSE 0 END),0) pagosIniciales,
            COALESCE(SUM(CASE WHEN idPagoFiado IS NOT NULL THEN monto ELSE 0 END),0) cobrosFiado,
            COALESCE(SUM(monto),0) total, COUNT(*) cantidad
     FROM pagoVenta
     WHERE idTienda=? AND creadoEn>=? AND creadoEn<?
     GROUP BY metodoPago ORDER BY total DESC`,
    [idTienda, range.inicio, range.finExclusivo]
  );
  return rows;
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
  const conditions = ['d.idTienda=?', 'v.fecha>=?', 'v.fecha<?'];
  const params = [idTienda, range.inicio, range.finExclusivo];
  if (filters.idProducto) { conditions.push('d.idProducto=?'); params.push(positiveId(filters.idProducto, 'El producto')); }
  if (filters.categoria) { conditions.push('p.categoria=?'); params.push(String(filters.categoria).trim().slice(0, 50)); }
  if (filters.idProveedor) { conditions.push('p.idProveedor=?'); params.push(positiveId(filters.idProveedor, 'El proveedor')); }
  if (filters.presentacion) {
    const presentation = String(filters.presentacion).trim().toLowerCase();
    if (!['unidad', 'paquete'].includes(presentation)) throw httpError(400, 'La presentacion no es valida.');
    conditions.push('d.presentacionVenta=?'); params.push(presentation);
  }
  if (filters.estadoPago) {
    const state = String(filters.estadoPago).trim().toLowerCase();
    if (!['pagada', 'parcial', 'pendiente', 'legado'].includes(state)) throw httpError(400, 'El estado de pago no es valido.');
    conditions.push('v.estadoPago=?'); params.push(state);
  }
  const maximumLimit = Math.min(MAX_EXPORT_ROWS, Math.max(1, Number(options.maximumLimit) || 500));
  const limit = Math.min(maximumLimit, Math.max(1, Number.parseInt(filters.limit, 10) || 100));
  const [rows] = await connection.query(
    `SELECT p.idProducto, p.nombre, p.categoria, COALESCE(pr.nombre,'Sin proveedor') proveedor,
            SUM(d.cantidadEquivalenteUnidades) unidadesVendidas,
            SUM(CASE WHEN d.presentacionVenta='paquete' THEN d.cantidad ELSE 0 END) paquetesVendidos,
            SUM(d.subtotal) ventasBrutas,
            SUM(GREATEST(0, d.subtotal-(d.subtotalCosto+d.ganancia))) descuentos,
            SUM(d.subtotalCosto+d.ganancia) ventasNetas,
            SUM(d.subtotalCosto) costoVendido,
            SUM(CASE WHEN d.origenCosto<>'desconocido' THEN d.ganancia ELSE 0 END) gananciaConCosto,
            SUM(CASE WHEN d.origenCosto='desconocido' THEN d.subtotalCosto+d.ganancia ELSE 0 END) ventasSinCosto,
            SUM(CASE WHEN d.origenCosto='real' THEN 1 ELSE 0 END) detallesCostoReal,
            SUM(CASE WHEN d.origenCosto='estimado' THEN 1 ELSE 0 END) detallesCostoEstimado,
            SUM(CASE WHEN d.origenCosto='desconocido' THEN 1 ELSE 0 END) detallesCostoDesconocido
     FROM detalleVenta d
     JOIN venta v ON v.idTienda=d.idTienda AND v.idVenta=d.idVenta
     JOIN producto p ON p.idTienda=d.idTienda AND p.idProducto=d.idProducto
     LEFT JOIN proveedor pr ON pr.idTienda=p.idTienda AND pr.idProveedor=p.idProveedor
     WHERE ${conditions.join(' AND ')}
     GROUP BY p.idTienda, p.idProducto, p.nombre, p.categoria, pr.nombre
     ORDER BY gananciaConCosto DESC, ventasNetas DESC LIMIT ?`,
    [...params, limit]
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
  const [[payments], [expenses], [sales], [debts], [purchases]] = await Promise.all([
    connection.query(
      `SELECT
        COALESCE(SUM(CASE WHEN metodoPago='efectivo' AND idPagoFiado IS NULL THEN monto ELSE 0 END),0) efectivoVentas,
        COALESCE(SUM(CASE WHEN metodoPago='efectivo' AND idPagoFiado IS NOT NULL THEN monto ELSE 0 END),0) efectivoFiados,
        COALESCE(SUM(CASE WHEN metodoPago='qr' THEN monto ELSE 0 END),0) totalQR,
        COALESCE(SUM(CASE WHEN metodoPago='no_especificado' THEN monto ELSE 0 END),0) totalNoEspecificado,
        COALESCE(SUM(monto),0) totalCobrado
       FROM pagoVenta WHERE idTienda=? AND creadoEn>=? AND creadoEn<?`, params
    ),
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
    )
  ]);
  const efectivoVentas = cents(payments[0].efectivoVentas, 'Efectivo de ventas');
  const efectivoFiados = cents(payments[0].efectivoFiados, 'Efectivo de fiados');
  const gastosEfectivo = cents(expenses[0].gastosEfectivo, 'Gastos en efectivo');
  const expected = initialCents + efectivoVentas + efectivoFiados - gastosEfectivo;
  if (expected < 0) throw httpError(409, 'El efectivo esperado es negativo. Revise el efectivo inicial o los gastos del periodo.');
  return {
    fechaInicio: range.inicio,
    fechaFin: range.finExclusivo,
    efectivoInicial: decimal(initialCents),
    efectivoVentasEsperado: decimal(efectivoVentas),
    efectivoFiadosCobrado: decimal(efectivoFiados),
    gastosEfectivo: decimal(gastosEfectivo),
    efectivoEsperado: decimal(expected),
    totalQR: decimal(cents(payments[0].totalQR, 'Total QR')),
    totalNoEspecificado: decimal(cents(payments[0].totalNoEspecificado, 'Total no especificado')),
    totalCobrado: decimal(cents(payments[0].totalCobrado, 'Total cobrado')),
    totalVentas: decimal(cents(sales[0].totalVentas, 'Total vendido')),
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
