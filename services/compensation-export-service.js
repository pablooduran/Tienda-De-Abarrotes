const ExcelJS = require('exceljs');
const {
  safeExportFileName,
  sanitizeSpreadsheetCell
} = require('./customer-credit-export-service');
const {
  financialSummary,
  paymentMethods,
  reportRange
} = require('./financial-service');
const {
  MAX_EXPORT_ROWS,
  allCompensationsForExport
} = require('./compensation-query-service');
const { formatLocalDate } = require('../utils/local-datetime');
const { stockError } = require('./stock-movement-service');

const EXPORT_TYPES = Object.freeze([
  'historial',
  'devoluciones',
  'liquidaciones',
  'finanzas-netas',
  'cuentas-por-cobrar',
  'metodos-pago'
]);
const EXPORT_FORMATS = Object.freeze(['csv', 'xlsx']);
const MONEY_FORMAT = '#,##0.00';
const DATE_FORMAT = 'yyyy-mm-dd hh:mm:ss';

function exportError(status, message, code) {
  return stockError(status, message, code);
}

function assertExport(type, format) {
  if (!EXPORT_TYPES.includes(type) || !EXPORT_FORMATS.includes(format)) {
    throw exportError(404, 'La exportacion solicitada no existe.',
      'COMPENSATION_EXPORT_NOT_FOUND');
  }
}

function safeText(value) {
  return sanitizeSpreadsheetCell(value) ?? '';
}

function decimal(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function excelDate(value) {
  if (value instanceof Date) return value;
  const match = String(value || '').match(
    /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/
  );
  if (!match) return value;
  return new Date(Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4] || 0),
    Number(match[5] || 0),
    Number(match[6] || 0)
  ));
}

function operationRows(rows) {
  return rows.map((row) => ({
    Fecha: row.fechaSolicitud,
    Tipo: row.tipoOperacion,
    Estado: row.estado,
    Venta: row.codigoVenta || row.idVenta || '',
    Cliente: row.cliente,
    Responsable: row.administrador,
    Motivo: row.motivoCodigo,
    Observacion: row.observacion || '',
    CompensacionComercial: decimal(row.montoCompensado),
    LiquidacionMaterial: decimal(row.montoLiquidado),
    MetodoOriginal: row.metodoOriginal || row.metodoPagoOriginal || '',
    MetodoDestino: row.metodoDestino || row.metodoPagoDestino || ''
  }));
}

async function settlementRows(connection, idTienda, query) {
  const range = reportRange(query);
  const [rows] = await connection.query(
    `SELECT mlc.fechaMovimiento Fecha,mlc.tipoLiquidacion Tipo,
            mlc.metodoLiquidacion Metodo,mlc.monto Monto,
            mlc.referencia Referencia,mlc.observacion Observacion,
            v.codigoComprobante Venta,COALESCE(c.nombre,'Cliente ocasional') Cliente,
            a.usuario Responsable,mlc.periodoOriginalCerrado PeriodoOriginalCerrado
     FROM movimientoLiquidacionCompensacion mlc
     JOIN obligacionReembolsoVenta ore
       ON ore.idTienda=mlc.idTienda
      AND ore.idObligacionReembolsoVenta=mlc.idObligacionReembolsoVenta
     JOIN venta v ON v.idTienda=ore.idTienda AND v.idVenta=ore.idVenta
     LEFT JOIN cliente c ON c.idTienda=v.idTienda AND c.idCliente=v.idCliente
     JOIN administrador a
       ON a.idTienda=mlc.idTienda AND a.idAdministrador=mlc.idAdministrador
     WHERE mlc.idTienda=? AND mlc.fechaMovimiento>=? AND mlc.fechaMovimiento<?
     ORDER BY mlc.fechaMovimiento,mlc.idMovimientoLiquidacionCompensacion
     LIMIT ?`,
    [idTienda, range.inicio, range.finExclusivo, MAX_EXPORT_ROWS + 1]
  );
  if (rows.length > MAX_EXPORT_ROWS) {
    throw exportError(413,
      `La exportacion supera el limite de ${MAX_EXPORT_ROWS} filas. Reduce el rango.`,
      'COMPENSATION_EXPORT_LIMIT_EXCEEDED');
  }
  return rows.map((row) => ({
    ...row,
    Monto: decimal(row.Monto),
    PeriodoOriginalCerrado: Number(row.PeriodoOriginalCerrado) ? 'Si' : 'No'
  }));
}

async function receivableRows(connection, idTienda) {
  const [rows] = await connection.query(
    `SELECT f.idFiado Fiado,v.codigoComprobante Venta,c.nombre Cliente,
            f.totalFiado Bruto,f.totalPagado Pagado,
            f.totalCompensado ReduccionDeuda,f.saldoPendiente SaldoPendiente,
            f.estado Estado,f.fechaInicio FechaInicio,f.fechaVencimiento FechaVencimiento
     FROM fiado f
     JOIN cliente c ON c.idTienda=f.idTienda AND c.idCliente=f.idCliente
     LEFT JOIN venta v ON v.idTienda=f.idTienda AND v.idVenta=f.idVenta
     WHERE f.idTienda=? AND f.saldoPendiente>0
     ORDER BY f.fechaInicio,f.idFiado LIMIT ?`,
    [idTienda, MAX_EXPORT_ROWS + 1]
  );
  if (rows.length > MAX_EXPORT_ROWS) {
    throw exportError(413,
      `La exportacion supera el limite de ${MAX_EXPORT_ROWS} filas. Aplica filtros.`,
      'COMPENSATION_EXPORT_LIMIT_EXCEEDED');
  }
  return rows.map((row) => ({
    ...row,
    Bruto: decimal(row.Bruto),
    Pagado: decimal(row.Pagado),
    ReduccionDeuda: decimal(row.ReduccionDeuda),
    SaldoPendiente: decimal(row.SaldoPendiente)
  }));
}

async function rowsForType(connection, idTienda, type, query) {
  if (type === 'historial' || type === 'devoluciones') {
    const rows = await allCompensationsForExport(connection, idTienda, {
      ...query,
      ...(type === 'devoluciones' ? { tipo: 'devolucion_venta' } : {})
    });
    return operationRows(rows);
  }
  if (type === 'liquidaciones') return settlementRows(connection, idTienda, query);
  if (type === 'cuentas-por-cobrar') return receivableRows(connection, idTienda);
  const range = reportRange(query);
  if (type === 'metodos-pago') {
    return (await paymentMethods(connection, idTienda, range)).map((row) => ({
      Metodo: row.metodoPago,
      Bruto: decimal(row.bruto),
      AjustesCompensatorios: decimal(row.ajustesCompensatorios),
      Reembolsos: decimal(row.reembolsos),
      Neto: decimal(row.total),
      Operaciones: Number(row.cantidad || 0)
    }));
  }
  const summary = await financialSummary(connection, idTienda, range);
  return [{
    Desde: range.desde,
    Hasta: range.hasta,
    VentasBrutas: decimal(summary.ventasAntesCompensaciones),
    CompensacionComercial: decimal(summary.compensacionesVenta),
    VentasNetas: decimal(summary.ventasNetas),
    CobrosBrutos: decimal(summary.dineroCobradoBruto),
    AjustesCobro: decimal(summary.ajustesCompensatoriosCobro),
    ReembolsosMateriales: decimal(summary.reembolsosRealizados),
    FlujoCobradoNeto: decimal(summary.dineroCobrado),
    ReduccionDeuda: decimal(summary.deudaCompensada),
    CuentasPorCobrar: decimal(summary.cuentasPorCobrar),
    GananciaBruta: decimal(summary.gananciaBruta),
    GananciaNeta: decimal(summary.gananciaNeta)
  }];
}

function csvCell(value) {
  const safe = safeText(value);
  const text = value instanceof Date ? value.toISOString() : String(safe);
  return `"${text.replace(/"/g, '""')}"`;
}

function buildCsv(rows) {
  const keys = rows.length ? Object.keys(rows[0]) : ['Mensaje'];
  const source = rows.length ? rows : [{ Mensaje: 'No hay datos para los filtros seleccionados.' }];
  return Buffer.from(`\uFEFF${[
    keys.map(csvCell).join(','),
    ...source.map((row) => keys.map((key) => csvCell(row[key])).join(','))
  ].join('\r\n')}\r\n`, 'utf8');
}

async function buildXlsx(rows, title) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Tienda de abarrotes';
  workbook.created = new Date();
  const sheet = workbook.addWorksheet(title.slice(0, 31), {
    views: [{ state: 'frozen', ySplit: 1 }]
  });
  const keys = rows.length ? Object.keys(rows[0]) : ['Mensaje'];
  sheet.columns = keys.map((key) => ({
    header: key,
    key,
    width: Math.min(38, Math.max(14, key.length + 4))
  }));
  const source = rows.length ? rows : [{ Mensaje: 'No hay datos para los filtros seleccionados.' }];
  for (const item of source) {
    const row = sheet.addRow(Object.fromEntries(
      Object.entries(item).map(([key, value]) => [
        key,
        safeText(/fecha|desde|hasta/i.test(key) ? excelDate(value) : value)
      ])
    ));
    row.eachCell((cell) => {
      if (typeof cell.value === 'number' && /monto|bruto|neto|saldo|pagado|compens|reembolso|ganancia|cobro/i.test(String(cell._column?.key || ''))) {
        cell.numFmt = MONEY_FORMAT;
      } else if (cell.value instanceof Date || /fecha/i.test(String(cell._column?.key || ''))) {
        cell.numFmt = DATE_FORMAT;
      }
    });
  }
  sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF286A59' } };
  sheet.autoFilter = { from: 'A1', to: `${sheet.getColumn(keys.length).letter}1` };
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

async function buildCompensationExport(connection, idTienda, type, format, query = {}) {
  const normalizedType = String(type || '').trim().toLowerCase();
  const normalizedFormat = String(format || '').trim().toLowerCase();
  assertExport(normalizedType, normalizedFormat);
  const rows = await rowsForType(connection, idTienda, normalizedType, query);
  const buffer = normalizedFormat === 'csv'
    ? buildCsv(rows)
    : await buildXlsx(rows, normalizedType.replace(/-/g, ' '));
  const baseName = safeExportFileName(
    normalizedType.replace(/-/g, '_'),
    'compensaciones',
    formatLocalDate()
  ).replace(/\.xlsx$/, '');
  return {
    buffer,
    contentType: normalizedFormat === 'csv'
      ? 'text/csv; charset=utf-8'
      : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    fileName: `${baseName}.${normalizedFormat}`,
    rowCount: rows.length,
    limit: MAX_EXPORT_ROWS
  };
}

module.exports = {
  EXPORT_FORMATS,
  EXPORT_TYPES,
  buildCompensationExport,
  buildCsv
};
