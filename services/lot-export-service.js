const ExcelJS = require('exceljs');
const { formatLocalDate } = require('../utils/local-datetime');
const { databaseLocalDate, databaseLocalDateTime, LOT_STATES, validLocalDate } = require('./lot-service');
const { stockError } = require('./stock-movement-service');

const MAX_EXPORT_ROWS = 5000;
const CALCULATED_STATES = new Set([
  'vencido', 'vence_hoy', 'proximo_a_vencer', 'vigente', 'bloqueado', 'agotado'
]);
const LOT_COLUMNS = [
  ['Producto', 'producto'], ['Categoria', 'categoria'], ['Codigo de lote', 'codigoLote'],
  ['Proveedor', 'proveedor'], ['Origen', 'origen'], ['Fecha de ingreso', 'fechaIngreso'],
  ['Fecha de vencimiento', 'fechaVencimiento'], ['Estado operativo', 'estadoOperativo'],
  ['Estado calculado', 'estadoCalculado'], ['Cantidad inicial', 'cantidadInicial'],
  ['Cantidad restante', 'cantidadRestante'], ['Costo unitario base', 'costoUnitarioBase'],
  ['Valor restante', 'valorRestante'], ['Compra relacionada', 'idCompra'],
  ['Fecha de compra', 'fechaCompra'], ['Creado por', 'creadoPor'],
  ['Ultima actualizacion', 'actualizadoEn']
];

function neutralizeFormula(value) {
  if (typeof value !== 'string') return value;
  return /^[=+\-@]/.test(value.trimStart()) ? `'${value}` : value;
}

function positiveId(value, label) {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) throw stockError(400, `${label} no es valido.`);
  return number;
}

function booleanFilter(value, label) {
  if (value === undefined || value === null || value === '') return false;
  if ([true, 1, '1', 'true'].includes(value)) return true;
  if ([false, 0, '0', 'false'].includes(value)) return false;
  throw stockError(400, `${label} no es valido.`);
}

function lotFilters(query = {}) {
  const conditions = ['l.idTienda=?'];
  const params = [];
  const idProducto = positiveId(query.producto ?? query.idProducto, 'El producto');
  const idProveedor = positiveId(query.proveedor ?? query.idProveedor, 'El proveedor');
  if (idProducto) { conditions.push('l.idProducto=?'); params.push(idProducto); }
  if (idProveedor) { conditions.push('l.idProveedor=?'); params.push(idProveedor); }
  if (query.estadoOperativo) {
    const state = String(query.estadoOperativo).trim();
    if (!LOT_STATES.has(state)) throw stockError(400, 'El estado operativo no es valido.');
    conditions.push('l.estadoOperativo=?');
    params.push(state);
  }
  const code = String(query.codigoLote || '').trim();
  if (code) {
    if (code.length > 80) throw stockError(400, 'El codigo de lote supera 80 caracteres.');
    conditions.push('l.codigoLote LIKE ?');
    params.push(`%${code}%`);
  }
  const from = query.venceDesde ? validLocalDate(query.venceDesde, 'La fecha inicial') : null;
  const to = query.venceHasta ? validLocalDate(query.venceHasta, 'La fecha final') : null;
  if (from && to && from > to) throw stockError(400, 'El rango de vencimiento no es valido.');
  if (from) { conditions.push('l.fechaVencimiento>=?'); params.push(from); }
  if (to) { conditions.push('l.fechaVencimiento<=?'); params.push(to); }
  if (booleanFilter(query.soloConSaldo, 'El filtro de saldo')) conditions.push('l.cantidadRestante>0');

  const calculatedState = String(query.estadoCalculado || '').trim();
  if (calculatedState && !CALCULATED_STATES.has(calculatedState)) {
    throw stockError(400, 'El estado calculado no es valido.');
  }
  return { conditions, params, calculatedState, idProducto, idProveedor };
}

function lotBaseQuery(idTienda, query = {}) {
  const today = formatLocalDate();
  const filters = lotFilters(query);
  const classification = `CASE
    WHEN l.estadoOperativo='bloqueado' THEN 'bloqueado'
    WHEN l.cantidadRestante=0 THEN 'agotado'
    WHEN l.fechaVencimiento<? THEN 'vencido'
    WHEN l.fechaVencimiento=? THEN 'vence_hoy'
    WHEN l.fechaVencimiento<=DATE_ADD(?, INTERVAL COALESCE(p.diasAlertaVencimiento,c.diasAlertaVencimientoDefault) DAY)
      THEN 'proximo_a_vencer'
    ELSE 'vigente' END`;
  const sql = `SELECT l.idLoteProducto, l.idProducto, p.nombre producto, p.categoria,
      pr.nombre proveedor, l.codigoLote, l.origen, l.fechaIngreso, l.fechaVencimiento,
      l.estadoOperativo, ${classification} estadoCalculado,
      l.cantidadInicial, l.cantidadRestante,
      CAST(l.costoUnitarioBase AS CHAR) costoUnitarioBase,
      CASE WHEN l.costoUnitarioBase IS NULL THEN NULL
           ELSE ROUND(l.cantidadRestante*l.costoUnitarioBase,2) END valorRestante,
      dc.idCompra, co.fecha fechaCompra, a.usuario creadoPor, l.actualizadoEn
    FROM loteProducto l
    JOIN producto p ON p.idTienda=l.idTienda AND p.idProducto=l.idProducto
    JOIN configuracionInventarioTienda c ON c.idTienda=l.idTienda
    LEFT JOIN proveedor pr ON pr.idTienda=l.idTienda AND pr.idProveedor=l.idProveedor
    LEFT JOIN detalleCompra dc ON dc.idTienda=l.idTienda AND dc.idProducto=l.idProducto
      AND dc.idDetalleCompra=l.idDetalleCompra
    LEFT JOIN compra co ON co.idTienda=dc.idTienda AND co.idCompra=dc.idCompra
    LEFT JOIN administrador a ON a.idTienda=l.idTienda AND a.idAdministrador=l.idAdministradorCrea
    WHERE ${filters.conditions.join(' AND ')}`;
  return {
    sql,
    params: [today, today, today, idTienda, ...filters.params],
    outerWhere: filters.calculatedState ? 'WHERE estadoCalculado=?' : '',
    outerParams: filters.calculatedState ? [filters.calculatedState] : [],
    filters
  };
}

async function lotSummary(connection, idTienda, query = {}) {
  const base = lotBaseQuery(idTienda, query);
  const [summaryRows] = await connection.query(
    `SELECT COUNT(*) totalLotes,
            COALESCE(SUM(cantidadRestante),0) stockTrazado,
            COALESCE(SUM(CASE WHEN estadoCalculado IN ('vigente','vence_hoy','proximo_a_vencer')
                              AND estadoOperativo='disponible' THEN cantidadRestante ELSE 0 END),0) stockVendible,
            COALESCE(SUM(CASE WHEN estadoCalculado='vencido' THEN cantidadRestante ELSE 0 END),0) stockVencido,
            COALESCE(SUM(CASE WHEN estadoCalculado='bloqueado' THEN cantidadRestante ELSE 0 END),0) stockBloqueado,
            SUM(CASE WHEN estadoCalculado='vencido' THEN 1 ELSE 0 END) lotesVencidos,
            SUM(CASE WHEN estadoCalculado='proximo_a_vencer' THEN 1 ELSE 0 END) lotesProximos,
            SUM(CASE WHEN estadoCalculado='vence_hoy' THEN 1 ELSE 0 END) lotesVencenHoy,
            SUM(CASE WHEN estadoCalculado='bloqueado' THEN 1 ELSE 0 END) lotesBloqueados,
            SUM(CASE WHEN estadoCalculado='agotado' THEN 1 ELSE 0 END) lotesAgotados,
            ROUND(SUM(CASE WHEN costoUnitarioBase IS NOT NULL THEN valorRestante ELSE 0 END),2) valorTotalRestante,
            ROUND(SUM(CASE WHEN estadoCalculado='vencido' AND costoUnitarioBase IS NOT NULL
                           THEN valorRestante ELSE 0 END),2) valorVencido,
            ROUND(SUM(CASE WHEN estadoCalculado='bloqueado' AND costoUnitarioBase IS NOT NULL
                           THEN valorRestante ELSE 0 END),2) valorBloqueado,
            SUM(CASE WHEN cantidadRestante>0 AND costoUnitarioBase IS NULL THEN 1 ELSE 0 END) lotesCostoDesconocido
     FROM (${base.sql}) lotes ${base.outerWhere}`,
    [...base.params, ...base.outerParams]
  );
  const productConditions = ['idTienda=?', 'controlaLotes=1'];
  const productParams = [idTienda];
  if (base.filters.idProducto) { productConditions.push('idProducto=?'); productParams.push(base.filters.idProducto); }
  if (base.filters.idProveedor) { productConditions.push('idProveedor=?'); productParams.push(base.filters.idProveedor); }
  const [productRows] = await connection.query(
    `SELECT COUNT(*) productosControlados FROM producto WHERE ${productConditions.join(' AND ')}`,
    productParams
  );
  return {
    ...summaryRows[0],
    productosControlados: Number(productRows[0].productosControlados),
    totalLotes: Number(summaryRows[0].totalLotes),
    stockTrazado: Number(summaryRows[0].stockTrazado),
    stockVendible: Number(summaryRows[0].stockVendible),
    stockVencido: Number(summaryRows[0].stockVencido),
    stockBloqueado: Number(summaryRows[0].stockBloqueado),
    lotesProximos: Number(summaryRows[0].lotesProximos),
    lotesVencidos: Number(summaryRows[0].lotesVencidos),
    lotesVencenHoy: Number(summaryRows[0].lotesVencenHoy),
    lotesBloqueados: Number(summaryRows[0].lotesBloqueados),
    lotesAgotados: Number(summaryRows[0].lotesAgotados),
    valorTotalRestante: Number(summaryRows[0].valorTotalRestante || 0),
    valorVencido: Number(summaryRows[0].valorVencido || 0),
    valorBloqueado: Number(summaryRows[0].valorBloqueado || 0),
    lotesCostoDesconocido: Number(summaryRows[0].lotesCostoDesconocido)
  };
}

function styleSheet(sheet, widths) {
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF286A59' } };
  sheet.getRow(1).alignment = { vertical: 'middle' };
  sheet.columns.forEach((column, index) => { column.width = widths[index] || 16; });
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: sheet.columnCount } };
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber > 1) row.alignment = { vertical: 'top', wrapText: true };
  });
}

function addRows(sheet, rows) {
  if (!rows.length) {
    sheet.addRow({ producto: 'No hay datos para los filtros seleccionados.' });
    return;
  }
  rows.forEach((row) => {
    const safe = Object.fromEntries(Object.entries(row).map(([key, value]) => [key, neutralizeFormula(value)]));
    sheet.addRow(safe);
  });
}

async function buildLotExport(connection, idTienda, query = {}) {
  const base = lotBaseQuery(idTienda, query);
  const [rows] = await connection.query(
    `SELECT * FROM (${base.sql}) lotes ${base.outerWhere}
     ORDER BY fechaVencimiento IS NULL, fechaVencimiento, fechaIngreso, idLoteProducto
     LIMIT ?`,
    [...base.params, ...base.outerParams, MAX_EXPORT_ROWS]
  );
  const exportRows = rows.map((row) => ({
    ...row,
    fechaIngreso: databaseLocalDateTime(row.fechaIngreso),
    fechaVencimiento: databaseLocalDate(row.fechaVencimiento),
    fechaCompra: databaseLocalDateTime(row.fechaCompra),
    actualizadoEn: databaseLocalDateTime(row.actualizadoEn)
  }));
  const summary = await lotSummary(connection, idTienda, query);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Plataforma de tiendas';
  workbook.created = new Date();

  const lots = workbook.addWorksheet('Lotes');
  lots.columns = LOT_COLUMNS.map(([header, key]) => ({ header, key }));
  addRows(lots, exportRows);
  styleSheet(lots, [28, 18, 18, 24, 18, 20, 20, 18, 20, 16, 17, 19, 17, 18, 20, 20, 22]);

  const summarySheet = workbook.addWorksheet('Resumen');
  summarySheet.columns = [{ header: 'Metrica', key: 'metrica' }, { header: 'Valor', key: 'valor' }];
  const labels = {
    totalLotes: 'Total de lotes', productosControlados: 'Productos controlados',
    stockTrazado: 'Cantidad fisica trazada', stockVendible: 'Cantidad vendible',
    stockVencido: 'Cantidad vencida', stockBloqueado: 'Cantidad bloqueada',
    lotesVencidos: 'Lotes vencidos', lotesProximos: 'Lotes proximos a vencer',
    lotesVencenHoy: 'Lotes que vencen hoy', lotesBloqueados: 'Lotes bloqueados',
    lotesAgotados: 'Lotes agotados', valorTotalRestante: 'Valor total restante conocido',
    valorVencido: 'Valor vencido conocido', valorBloqueado: 'Valor bloqueado conocido',
    lotesCostoDesconocido: 'Lotes con saldo y costo desconocido'
  };
  Object.entries(labels).forEach(([key, label]) => summarySheet.addRow({ metrica: label, valor: summary[key] }));
  styleSheet(summarySheet, [38, 24]);

  const alerts = exportRows.filter((row) => row.estadoCalculado !== 'vigente');
  if (alerts.length) {
    const alertsSheet = workbook.addWorksheet('Alertas');
    alertsSheet.columns = LOT_COLUMNS.map(([header, key]) => ({ header, key }));
    addRows(alertsSheet, alerts);
    styleSheet(alertsSheet, [28, 18, 18, 24, 18, 20, 20, 18, 20, 16, 17, 19, 17, 18, 20, 20, 22]);
  }

  return {
    buffer: await workbook.xlsx.writeBuffer(),
    fileName: `lotes-vencimientos-${formatLocalDate()}.xlsx`,
    totalExportado: exportRows.length,
    limitado: exportRows.length === MAX_EXPORT_ROWS
  };
}

module.exports = {
  MAX_EXPORT_ROWS,
  buildLotExport,
  lotSummary,
  neutralizeFormula
};
