const ExcelJS = require('exceljs');
const {
  buildCustomerFilter,
  buildDebtFilter,
  buildStatementFilter,
  collectionState,
  creditError,
  daysBetweenLocalDates,
  effectiveDebtDate,
  getCreditConfiguration,
  moneyToCents
} = require('./customer-credit-service');
const { formatLocalDate, formatLocalDateTime } = require('../utils/local-datetime');

const DEFAULT_EXPORT_LIMITS = Object.freeze({
  customers: 5000,
  debts: 10000,
  statement: 20000
});
const MAX_CONFIGURED_EXPORT_ROWS = 100000;
const MONEY_FORMAT = '#,##0.00';
const DATE_FORMAT = 'yyyy-mm-dd';
const DATETIME_FORMAT = 'yyyy-mm-dd hh:mm:ss';

function configuredLimit(environment, name, fallback) {
  const raw = String(environment[name] ?? '').trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > MAX_CONFIGURED_EXPORT_ROWS) {
    throw new Error(`${name} debe ser un entero entre 1 y ${MAX_CONFIGURED_EXPORT_ROWS}.`);
  }
  return value;
}

function resolveCustomerCreditExportLimits(environment = process.env) {
  return Object.freeze({
    customers: configuredLimit(
      environment,
      'CUSTOMER_CREDIT_EXPORT_CLIENTS_MAX_ROWS',
      DEFAULT_EXPORT_LIMITS.customers
    ),
    debts: configuredLimit(
      environment,
      'CUSTOMER_CREDIT_EXPORT_DEBTS_MAX_ROWS',
      DEFAULT_EXPORT_LIMITS.debts
    ),
    statement: configuredLimit(
      environment,
      'CUSTOMER_CREDIT_EXPORT_STATEMENT_MAX_ROWS',
      DEFAULT_EXPORT_LIMITS.statement
    )
  });
}

function sanitizeSpreadsheetCell(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' || typeof value === 'boolean' || value instanceof Date) return value;
  const text = String(value);
  return /^[\s\u0000-\u001f\u007f-\u009f\u200b-\u200d\u2060\ufeff]*[=+\-@]/u.test(text)
    ? `'${text}`
    : text;
}

function safeFilePart(value, fallback = 'exportacion') {
  const normalized = String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]+/g, ' ')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 70);
  const candidate = normalized || fallback;
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(candidate) ? `archivo_${candidate}` : candidate;
}

function safeExportFileName(prefix, subject, date = formatLocalDate()) {
  const localDate = /^\d{4}-\d{2}-\d{2}$/.test(String(date)) ? String(date) : safeFilePart(date, 'fecha');
  const parts = [safeFilePart(prefix), safeFilePart(subject, 'tienda'), localDate];
  return `${parts.join('_').slice(0, 150)}.xlsx`;
}

function excelDate(value) {
  if (!value || value instanceof Date) return value || null;
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (!match) return null;
  return new Date(Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4] || 0),
    Number(match[5] || 0),
    Number(match[6] || 0)
  ));
}

function newWorkbook(title) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Tienda de abarrotes';
  workbook.title = sanitizeSpreadsheetCell(title);
  workbook.created = excelDate(formatLocalDateTime());
  workbook.modified = workbook.created;
  workbook.calcProperties.fullCalcOnLoad = false;
  return workbook;
}

function styleHeader(row) {
  row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF315C45' } };
  row.alignment = { vertical: 'middle', wrapText: true };
  row.height = 24;
}

function configureTableSheet(sheet, headerRow, columnCount) {
  sheet.views = [{ state: 'frozen', ySplit: headerRow.number }];
  sheet.autoFilter = {
    from: { row: headerRow.number, column: 1 },
    to: { row: headerRow.number, column: columnCount }
  };
  styleHeader(headerRow);
}

function addSafeRow(sheet, values) {
  return sheet.addRow(values.map(sanitizeSpreadsheetCell));
}

async function storeName(connection, idTienda) {
  const [rows] = await connection.query('SELECT nombre FROM tienda WHERE idTienda=?', [idTienda]);
  if (!rows.length) throw creditError(404, 'Tienda no encontrada.');
  return rows[0].nombre;
}

async function limitedRows(connection, sql, params, limit, label) {
  const [rows] = await connection.query(`${sql} LIMIT ?`, [...params, limit + 1]);
  if (rows.length > limit) {
    throw creditError(
      413,
      `La exportacion de ${label} supera el limite de ${limit} filas. Reduce el rango o aplica mas filtros.`,
      'EXPORT_ROW_LIMIT_EXCEEDED'
    );
  }
  return rows;
}

function decimalNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

async function exportCustomers(connection, idTienda, query = {}, options = {}) {
  const limits = options.limits || resolveCustomerCreditExportLimits();
  const filter = buildCustomerFilter(query, idTienda);
  const [name, rows] = await Promise.all([
    storeName(connection, idTienda),
    limitedRows(
      connection,
      `SELECT c.idCliente, c.nombre, c.telefono, c.telefonoAlternativo,
              c.documentoIdentidad, c.correo, c.direccion, c.activo, c.eliminadoEn,
              c.creadoEn, c.permiteFiado, c.limiteCredito, c.diasCreditoDefault,
              (SELECT COALESCE(SUM(f.saldoPendiente),0) FROM fiado f
               WHERE f.idTienda=c.idTienda AND f.idCliente=c.idCliente AND f.saldoPendiente>0) saldoPendiente,
              (SELECT MAX(v.fecha) FROM venta v
               WHERE v.idTienda=c.idTienda AND v.idCliente=c.idCliente) ultimaCompra,
              (SELECT COALESCE(SUM(v.total),0) FROM venta v
               WHERE v.idTienda=c.idTienda AND v.idCliente=c.idCliente) totalComprado
       FROM cliente c
       WHERE ${filter.where}
       ORDER BY c.nombre, c.idCliente`,
      filter.params,
      limits.customers,
      'clientes'
    )
  ]);
  const workbook = newWorkbook(`Clientes - ${name}`);
  const sheet = workbook.addWorksheet('Clientes');
  sheet.columns = [
    { width: 12 }, { width: 28 }, { width: 18 }, { width: 20 }, { width: 20 },
    { width: 28 }, { width: 34 }, { width: 12 }, { width: 20 }, { width: 20 },
    { width: 15 }, { width: 17 }, { width: 15 }, { width: 18 }, { width: 20 }, { width: 18 }
  ];
  const header = addSafeRow(sheet, [
    'ID cliente', 'Nombre', 'Telefono', 'Telefono alternativo', 'Documento', 'Correo',
    'Direccion', 'Estado', 'Fecha de creacion', 'Fecha de ocultacion', 'Permite fiado',
    'Limite de credito', 'Dias de credito', 'Saldo pendiente', 'Ultima compra', 'Total comprado'
  ]);
  configureTableSheet(sheet, header, 16);
  for (const item of rows) {
    const row = addSafeRow(sheet, [
      Number(item.idCliente), item.nombre, item.telefono, item.telefonoAlternativo,
      item.documentoIdentidad, item.correo, item.direccion, Number(item.activo) === 1 ? 'Activo' : 'Oculto',
      excelDate(item.creadoEn), excelDate(item.eliminadoEn), Number(item.permiteFiado) === 1 ? 'Si' : 'No',
      decimalNumber(item.limiteCredito), item.diasCreditoDefault === null ? null : Number(item.diasCreditoDefault),
      decimalNumber(item.saldoPendiente), excelDate(item.ultimaCompra), decimalNumber(item.totalComprado)
    ]);
    row.getCell(9).numFmt = DATETIME_FORMAT;
    row.getCell(10).numFmt = DATETIME_FORMAT;
    row.getCell(12).numFmt = MONEY_FORMAT;
    row.getCell(14).numFmt = MONEY_FORMAT;
    row.getCell(15).numFmt = DATETIME_FORMAT;
    row.getCell(16).numFmt = MONEY_FORMAT;
  }
  return {
    buffer: await workbook.xlsx.writeBuffer(),
    fileName: safeExportFileName('clientes', name),
    rowCount: rows.length,
    filters: { ...query, estado: filter.state },
    limit: limits.customers
  };
}

async function exportDebts(connection, idTienda, query = {}, options = {}) {
  const limits = options.limits || resolveCustomerCreditExportLimits();
  const configuration = await getCreditConfiguration(connection, idTienda);
  const filter = buildDebtFilter(query, idTienda, configuration, { allowStored: true });
  const [name, rows] = await Promise.all([
    storeName(connection, idTienda),
    limitedRows(
      connection,
      `SELECT f.idFiado, f.idCliente, f.fechaInicio, f.fechaVencimiento,
              f.fechaPrometidaPago, f.totalFiado, f.totalPagado, f.saldoPendiente,
              f.estado, f.activo, c.nombre cliente, c.telefono, c.activo clienteActivo,
              (SELECT MAX(s.creadoEn) FROM seguimientoCobranza s
               WHERE s.idTienda=f.idTienda AND s.idFiado=f.idFiado) ultimaGestion
       FROM fiado f
       JOIN cliente c ON c.idTienda=f.idTienda AND c.idCliente=f.idCliente
       WHERE ${filter.where}
       ORDER BY ${filter.effectiveDate} IS NULL, ${filter.effectiveDate}, f.fechaInicio, f.idFiado`,
      filter.params,
      limits.debts,
      'fiados'
    )
  ]);
  const workbook = newWorkbook(`Fiados y cobranza - ${name}`);
  const sheet = workbook.addWorksheet('Cobranza');
  sheet.columns = [
    { width: 12 }, { width: 28 }, { width: 18 }, { width: 16 }, { width: 18 },
    { width: 18 }, { width: 20 }, { width: 16 }, { width: 16 }, { width: 16 },
    { width: 15 }, { width: 18 }, { width: 20 }, { width: 16 }
  ];
  const totalCents = rows.reduce(
    (sum, row) => sum + moneyToCents(row.saldoPendiente, 'El saldo pendiente'),
    0
  );
  addSafeRow(sheet, ['Resumen filtrado']);
  addSafeRow(sheet, ['Total de fiados', rows.length]);
  const totalRow = addSafeRow(sheet, ['Saldo pendiente total', totalCents / 100]);
  totalRow.getCell(2).numFmt = MONEY_FORMAT;
  addSafeRow(sheet, ['Generado', excelDate(formatLocalDateTime())]).getCell(2).numFmt = DATETIME_FORMAT;
  sheet.addRow([]);
  const header = addSafeRow(sheet, [
    'ID fiado', 'Cliente', 'Telefono', 'Fecha de creacion', 'Fecha de vencimiento',
    'Fecha prometida', 'Estado de cobranza', 'Monto original', 'Total pagado',
    'Saldo pendiente', 'Dias de atraso', 'Ultima gestion', 'Estado del cliente', 'Estado del fiado'
  ]);
  configureTableSheet(sheet, header, 14);
  for (const item of rows) {
    const dueDate = effectiveDebtDate(item);
    const state = collectionState(item, filter.today, Number(configuration.diasAvisoVencimiento));
    const lateDays = dueDate ? Math.max(0, -daysBetweenLocalDates(filter.today, dueDate)) : null;
    const row = addSafeRow(sheet, [
      Number(item.idFiado), item.cliente, item.telefono, excelDate(item.fechaInicio),
      excelDate(item.fechaVencimiento), excelDate(item.fechaPrometidaPago), state,
      decimalNumber(item.totalFiado), decimalNumber(item.totalPagado), decimalNumber(item.saldoPendiente),
      lateDays, excelDate(item.ultimaGestion), Number(item.clienteActivo) === 1 ? 'Activo' : 'Oculto',
      Number(item.activo) === 1 ? 'Activo' : 'Oculto'
    ]);
    row.getCell(4).numFmt = DATE_FORMAT;
    row.getCell(5).numFmt = DATE_FORMAT;
    row.getCell(6).numFmt = DATE_FORMAT;
    row.getCell(8).numFmt = MONEY_FORMAT;
    row.getCell(9).numFmt = MONEY_FORMAT;
    row.getCell(10).numFmt = MONEY_FORMAT;
    row.getCell(12).numFmt = DATETIME_FORMAT;
  }
  return {
    buffer: await workbook.xlsx.writeBuffer(),
    fileName: safeExportFileName('fiados', name),
    rowCount: rows.length,
    totalPending: (totalCents / 100).toFixed(2),
    limit: limits.debts
  };
}

async function openingBalanceCents(connection, idTienda, idCliente, fromDateTime) {
  if (!fromDateTime) return 0;
  const [[debts], [payments]] = await Promise.all([
    connection.query(
      `SELECT COALESCE(SUM(f.totalFiado),0) total
       FROM fiado f LEFT JOIN venta v ON v.idTienda=f.idTienda AND v.idVenta=f.idVenta
       WHERE f.idTienda=? AND f.idCliente=?
         AND COALESCE(v.fecha,CONCAT(f.fechaInicio,' 00:00:00'))<?`,
      [idTienda, idCliente, fromDateTime]
    ),
    connection.query(
      `SELECT COALESCE(SUM(pf.monto),0) total
       FROM pagoFiado pf
       JOIN fiado f ON f.idTienda=pf.idTienda AND f.idFiado=pf.idFiado
       WHERE f.idTienda=? AND f.idCliente=? AND pf.fechaPago<?`,
      [idTienda, idCliente, fromDateTime]
    )
  ]);
  return moneyToCents(debts[0].total, 'El saldo inicial')
    - moneyToCents(payments[0].total, 'Los pagos anteriores');
}

async function exportCustomerStatement(connection, idTienda, idCliente, query = {}, options = {}) {
  const limits = options.limits || resolveCustomerCreditExportLimits();
  const [customers] = await connection.query(
    `SELECT c.idCliente, c.nombre, c.telefono, c.documentoIdentidad, c.direccion,
            c.activo, c.limiteCredito, t.nombre tienda
     FROM cliente c JOIN tienda t ON t.idTienda=c.idTienda
     WHERE c.idTienda=? AND c.idCliente=?`,
    [idTienda, idCliente]
  );
  if (!customers.length) throw creditError(404, 'Cliente no encontrado.');
  const customer = customers[0];
  const statement = buildStatementFilter(query, idTienda, idCliente);
  const [rows, openingCents] = await Promise.all([
    limitedRows(
      connection,
      `SELECT * FROM (${statement.movementSql}) movimientos
       ORDER BY fecha, tipoOrden, ordenId`,
      statement.movementParams,
      limits.statement,
      'movimientos del estado de cuenta'
    ),
    openingBalanceCents(connection, idTienda, idCliente, statement.fromDateTime)
  ]);
  let runningCents = openingCents;
  const movements = rows.map((item) => {
    const amountCents = moneyToCents(item.monto, 'El monto del movimiento');
    const debitCents = item.tipo === 'fiado' ? amountCents : 0;
    const creditCents = item.tipo === 'pago' ? amountCents : 0;
    runningCents += debitCents - creditCents;
    return { ...item, debitCents, creditCents, runningCents };
  });
  const workbook = newWorkbook(`Estado de cuenta - ${customer.nombre}`);
  const sheet = workbook.addWorksheet('Estado de cuenta');
  sheet.columns = [
    { width: 20 }, { width: 16 }, { width: 22 }, { width: 12 }, { width: 34 },
    { width: 16 }, { width: 16 }, { width: 16 }, { width: 16 }
  ];
  addSafeRow(sheet, ['Estado de cuenta']);
  addSafeRow(sheet, ['Tienda', customer.tienda]);
  addSafeRow(sheet, ['Cliente', customer.nombre]);
  addSafeRow(sheet, ['Telefono', customer.telefono]);
  addSafeRow(sheet, ['Documento', customer.documentoIdentidad]);
  addSafeRow(sheet, ['Periodo', `${statement.from || 'inicio'} a ${statement.to || formatLocalDate()}`]);
  const openingRow = addSafeRow(sheet, ['Saldo inicial', openingCents / 100]);
  openingRow.getCell(2).numFmt = MONEY_FORMAT;
  const finalRow = addSafeRow(sheet, ['Saldo final', runningCents / 100]);
  finalRow.getCell(2).numFmt = MONEY_FORMAT;
  sheet.addRow([]);
  const header = addSafeRow(sheet, [
    'Fecha', 'Tipo', 'Comprobante', 'ID fiado', 'Detalle', 'Monto de venta',
    'Debito', 'Credito', 'Saldo acumulado'
  ]);
  configureTableSheet(sheet, header, 9);
  for (const item of movements) {
    const detail = item.tipo === 'pago'
      ? `Pago ${item.metodoPago || 'no especificado'}${item.referencia ? ` - ${item.referencia}` : ''}`
      : item.tipo === 'fiado' ? 'Deuda originada por venta' : 'Venta relacionada';
    const row = addSafeRow(sheet, [
      excelDate(item.fecha), item.tipo, item.codigoComprobante,
      item.idFiado === null ? null : Number(item.idFiado), detail,
      item.tipo === 'venta' ? decimalNumber(item.monto) : null,
      item.debitCents ? item.debitCents / 100 : null,
      item.creditCents ? item.creditCents / 100 : null,
      item.runningCents / 100
    ]);
    row.getCell(1).numFmt = DATETIME_FORMAT;
    for (const column of [6, 7, 8, 9]) row.getCell(column).numFmt = MONEY_FORMAT;
  }
  return {
    buffer: await workbook.xlsx.writeBuffer(),
    fileName: safeExportFileName('estado_cuenta', customer.nombre),
    rowCount: rows.length,
    openingBalance: (openingCents / 100).toFixed(2),
    finalBalance: (runningCents / 100).toFixed(2),
    limit: limits.statement
  };
}

module.exports = {
  DEFAULT_EXPORT_LIMITS,
  exportCustomerStatement,
  exportCustomers,
  exportDebts,
  resolveCustomerCreditExportLimits,
  safeExportFileName,
  sanitizeSpreadsheetCell
};
