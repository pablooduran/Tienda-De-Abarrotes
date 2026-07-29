const ExcelJS = require('exceljs');
const {
  MAX_ANALYSIS_ROWS,
  inventoryAlerts,
  inventoryRanking,
  inventoryRotation,
  inventorySummary,
  inventoryValuation,
  inventoryWithoutMovement,
  suggestedPurchases
} = require('./inventory-intelligence-service');

function neutralizeFormula(value) {
  if (typeof value !== 'string') return value;
  return /^[\s\u0000-\u001F\u200B\uFEFF]*[=+\-@]/.test(value) ? `'${value}` : value;
}

function flatten(value, prefix = '', result = {}) {
  for (const [key, item] of Object.entries(value || {})) {
    const target = prefix ? `${prefix}.${key}` : key;
    if (item && typeof item === 'object' && !Array.isArray(item) && !(item instanceof Date)) {
      flatten(item, target, result);
    } else if (!Array.isArray(item)) {
      result[target] = item;
    }
  }
  return result;
}

function readableHeader(value) {
  return String(value)
    .replace(/\./g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^./, (character) => character.toUpperCase());
}

function addSheet(workbook, name, sourceRows) {
  const rows = sourceRows.length ? sourceRows.map((row) => flatten(row)) : [{ mensaje: 'No hay datos para los filtros seleccionados.' }];
  const keys = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const sheet = workbook.addWorksheet(name.slice(0, 31), { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = keys.map((key) => ({
    header: readableHeader(key),
    key,
    width: Math.min(45, Math.max(14, key.length + 4))
  }));
  rows.forEach((row) => {
    sheet.addRow(Object.fromEntries(keys.map((key) => [key, neutralizeFormula(row[key] ?? null)])));
  });
  sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF286A59' } };
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: keys.length } };
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber > 1) row.alignment = { vertical: 'top', wrapText: true };
  });
}

function exportQuery(query) {
  return { ...query, pagina: 1, limite: MAX_ANALYSIS_ROWS };
}

function exportType(query = {}) {
  const type = String(query.tipoExportacion || 'completo').trim().toLowerCase();
  if (!['completo', 'alertas', 'sugerencias', 'rotacion'].includes(type)) {
    const error = new Error('El tipo de exportacion de inventario no es valido.');
    error.status = 400;
    error.code = 'INVALID_INVENTORY_EXPORT_TYPE';
    throw error;
  }
  return type;
}

function requireFeature(enabled, feature, type) {
  if (enabled.has(feature)) return;
  const error = new Error('La exportacion solicitada no esta incluida en el plan actual.');
  error.status = 403;
  error.code = 'FEATURE_NOT_AVAILABLE';
  error.inventoryExportType = type;
  throw error;
}

async function buildInventoryIntelligenceExport(connection, idTienda, query = {}, features = []) {
  const enabled = new Set(features);
  const boundedQuery = exportQuery(query);
  const type = exportType(query);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Plataforma de tiendas';
  workbook.created = new Date();

  const summary = await inventorySummary(connection, idTienda, boundedQuery);
  let rowCount = 0;
  if (type === 'completo') addSheet(workbook, 'Resumen', [summary]);

  if ((type === 'completo' && enabled.has('alertas_stock')) || type === 'alertas') {
    requireFeature(enabled, 'alertas_stock', type);
    const alerts = await inventoryAlerts(connection, idTienda, boundedQuery, { maximumLimit: MAX_ANALYSIS_ROWS });
    addSheet(workbook, 'Alertas', alerts.rows);
    rowCount += alerts.rows.length;
  }
  if (type === 'completo' && enabled.has('ranking_productos')) {
    const ranking = await inventoryRanking(connection, idTienda, boundedQuery, { maximumLimit: MAX_ANALYSIS_ROWS });
    addSheet(workbook, 'Mas vendidos', ranking.masVendidosUnidades);
    addSheet(workbook, 'Ranking ingresos', ranking.masVendidosIngresos);
    addSheet(workbook, 'Menos vendidos', ranking.menosVendidos);
  }
  if ((type === 'completo' && enabled.has('compras_sugeridas')) || type === 'sugerencias') {
    requireFeature(enabled, 'compras_sugeridas', type);
    const suggestions = await suggestedPurchases(
      connection, idTienda, boundedQuery, { maximumLimit: MAX_ANALYSIS_ROWS }
    );
    addSheet(workbook, 'Compras sugeridas', suggestions.rows);
    rowCount += suggestions.rows.length;
  }
  if ((type === 'completo' && enabled.has('rotacion_inventario')) || type === 'rotacion') {
    requireFeature(enabled, 'rotacion_inventario', type);
    const rotation = await inventoryRotation(connection, idTienda, boundedQuery, { maximumLimit: MAX_ANALYSIS_ROWS });
    addSheet(workbook, 'Rotacion', rotation.rows);
    rowCount += rotation.rows.length;
  }
  if (type === 'completo' && enabled.has('inventario_sin_movimiento')) {
    const withoutMovement = await inventoryWithoutMovement(
      connection, idTienda, boundedQuery, { maximumLimit: MAX_ANALYSIS_ROWS }
    );
    addSheet(workbook, 'Sin movimiento', withoutMovement.rows);
  }
  if (type === 'completo' && enabled.has('valor_inventario_basico')) {
    const valuation = await inventoryValuation(connection, idTienda, boundedQuery, { maximumLimit: MAX_ANALYSIS_ROWS });
    addSheet(workbook, 'Valoracion resumen', [valuation.resumen]);
    addSheet(workbook, 'Valoracion detalle', valuation.rows);
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const date = String(summary.periodo.hastaExclusivo).slice(0, 10);
  const name = {
    completo: 'inteligencia-inventario',
    alertas: 'alertas-inventario',
    sugerencias: 'sugerencias-compra',
    rotacion: 'rotacion-inventario'
  }[type];
  return {
    buffer,
    fileName: `${name}-${date}.xlsx`,
    sheets: workbook.worksheets.map((sheet) => sheet.name),
    type,
    rowCount
  };
}

module.exports = {
  buildInventoryIntelligenceExport,
  exportType,
  neutralizeFormula
};
