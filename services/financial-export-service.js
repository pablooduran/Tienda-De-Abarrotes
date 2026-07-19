const ExcelJS = require('exceljs');
const {
  MAX_EXPORT_ROWS,
  expensesByCategory,
  financialSummary,
  productProfitability,
  reportRange
} = require('./financial-service');

const FILE_NAMES = Object.freeze({
  ventas: 'ventas',
  pagos: 'pagos',
  fiados: 'fiados',
  gastos: 'gastos',
  rentabilidad: 'rentabilidad-productos',
  'resumen-financiero': 'resumen-financiero',
  cierres: 'cierres-caja'
});

function neutralizeFormula(value) {
  if (typeof value !== 'string') return value;
  return /^[=+\-@]/.test(value.trimStart()) ? `'${value}` : value;
}

function safeSheetName(value) {
  return String(value).replace(/[\\/*?:\[\]]/g, '-').slice(0, 31) || 'Reporte';
}

function readableHeader(value) {
  return String(value)
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^./, (char) => char.toUpperCase());
}

function addWorksheet(workbook, name, rows) {
  const sheet = workbook.addWorksheet(safeSheetName(name), { views: [{ state: 'frozen', ySplit: 1 }] });
  const keys = rows.length ? Object.keys(rows[0]) : ['mensaje'];
  sheet.columns = keys.map((key) => ({ header: readableHeader(key), key, width: Math.min(42, Math.max(14, key.length + 4)) }));
  const source = rows.length ? rows : [{ mensaje: 'No hay datos para el rango seleccionado.' }];
  source.forEach((row) => {
    const safe = Object.fromEntries(Object.entries(row).map(([key, value]) => [key, neutralizeFormula(value)]));
    sheet.addRow(safe);
  });
  sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF286A59' } };
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: keys.length } };
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber > 1) row.alignment = { vertical: 'top', wrapText: true };
  });
  return sheet;
}

async function limitedRows(connection, sql, params) {
  const [rows] = await connection.query(`${sql} LIMIT ?`, [...params, MAX_EXPORT_ROWS + 1]);
  if (rows.length > MAX_EXPORT_ROWS) {
    const error = new Error(`La exportacion supera el limite de ${MAX_EXPORT_ROWS} filas. Reduzca el rango.`);
    error.status = 413;
    throw error;
  }
  return rows;
}

async function exportRows(connection, idTienda, type, range, query) {
  const params = [idTienda, range.inicio, range.finExclusivo];
  if (type === 'ventas') {
    return limitedRows(connection,
      `SELECT v.codigoComprobante, v.fecha, COALESCE(c.nombre,'Cliente ocasional') cliente,
              v.subtotal, v.descuento, v.total, v.montoPagado, v.saldoPendiente, v.estadoPago
       FROM venta v LEFT JOIN cliente c ON c.idTienda=v.idTienda AND c.idCliente=v.idCliente
       WHERE v.idTienda=? AND v.fecha>=? AND v.fecha<? ORDER BY v.fecha, v.idVenta`, params);
  }
  if (type === 'pagos') {
    return limitedRows(connection,
      `SELECT v.codigoComprobante, pv.creadoEn fechaPago,
              CASE WHEN pv.idPagoFiado IS NOT NULL THEN COALESCE(cf.metodoPago,pv.metodoPago)
                   ELSE pv.metodoPago END metodoPago, pv.monto,
              CASE WHEN pv.idPagoFiado IS NULL THEN 'Pago inicial' ELSE 'Cobro de fiado' END origen,
              pv.referencia
       FROM pagoVenta pv JOIN venta v ON v.idTienda=pv.idTienda AND v.idVenta=pv.idVenta
       LEFT JOIN pagoFiado pf ON pf.idTienda=pv.idTienda AND pf.idPagoFiado=pv.idPagoFiado
       LEFT JOIN cobroFiado cf ON cf.idTienda=pf.idTienda AND cf.idCobroFiado=pf.idCobroFiado
       WHERE pv.idTienda=? AND pv.creadoEn>=? AND pv.creadoEn<? ORDER BY pv.creadoEn, pv.idPagoVenta`, params);
  }
  if (type === 'fiados') {
    return limitedRows(connection,
      `SELECT f.idFiado, v.codigoComprobante, f.fechaInicio, c.nombre cliente,
              f.totalFiado, f.totalPagado, f.saldoPendiente, f.estado,
              CASE WHEN f.activo=1 THEN 'Visible' ELSE 'Oculto' END visibilidad
       FROM fiado f JOIN cliente c ON c.idTienda=f.idTienda AND c.idCliente=f.idCliente
       LEFT JOIN venta v ON v.idTienda=f.idTienda AND v.idVenta=f.idVenta
       WHERE f.idTienda=? AND f.fechaInicio>=DATE(?) AND f.fechaInicio<DATE(?)
       ORDER BY f.fechaInicio, f.idFiado`, params);
  }
  if (type === 'gastos') {
    return limitedRows(connection,
      `SELECT g.fechaGasto, cg.nombre categoria, g.concepto, g.monto, g.metodoPago,
              g.referencia, g.recurrente, g.estado, g.observacion
       FROM gasto g JOIN categoriaGasto cg ON cg.idTienda=g.idTienda AND cg.idCategoriaGasto=g.idCategoriaGasto
       WHERE g.idTienda=? AND g.fechaGasto>=? AND g.fechaGasto<? ORDER BY g.fechaGasto, g.idGasto`, params);
  }
  if (type === 'cierres') {
    return limitedRows(connection,
      `SELECT fechaInicio, fechaFin, efectivoInicial, efectivoVentasEsperado, efectivoFiadosCobrado,
              gastosEfectivo, efectivoEsperado, efectivoContado, diferencia, totalQR,
              totalCobrado, totalVentas, totalFiadoGenerado, totalGastos, totalCompras, estado, observacion
       FROM cierreCaja WHERE idTienda=? AND fechaInicio>=? AND fechaInicio<?
       ORDER BY fechaInicio, idCierreCaja`, params);
  }
  if (type === 'rentabilidad') {
    const rows = await productProfitability(
      connection,
      idTienda,
      range,
      { ...query, limit: MAX_EXPORT_ROWS },
      { maximumLimit: MAX_EXPORT_ROWS }
    );
    return rows.map(({ costoConfiable, ...row }) => ({ ...row, costoConfiable: costoConfiable ? 'Si' : 'No' }));
  }
  if (type === 'resumen-financiero') {
    const summary = await financialSummary(connection, idTienda, range);
    return Object.entries(summary)
      .filter(([key]) => key !== 'rango')
      .map(([concepto, valor]) => ({ concepto: readableHeader(concepto), valor }));
  }
  const error = new Error('La exportacion solicitada no existe.');
  error.status = 404;
  throw error;
}

async function buildFinancialExport(connection, idTienda, type, query = {}) {
  if (!FILE_NAMES[type]) {
    const error = new Error('La exportacion solicitada no existe.');
    error.status = 404;
    throw error;
  }
  const range = reportRange(query);
  const rows = await exportRows(connection, idTienda, type, range, query);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Plataforma de tiendas';
  workbook.created = new Date();
  addWorksheet(workbook, FILE_NAMES[type], rows);
  if (type === 'gastos') addWorksheet(workbook, 'Resumen por categoria', await expensesByCategory(connection, idTienda, range));
  const buffer = await workbook.xlsx.writeBuffer();
  return {
    buffer,
    fileName: `${FILE_NAMES[type]}-${range.desde}-a-${range.hasta}.xlsx`,
    rowCount: rows.length,
    range
  };
}

module.exports = {
  buildFinancialExport,
  neutralizeFormula
};
