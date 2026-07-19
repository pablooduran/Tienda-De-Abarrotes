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
  return /^[=+\-@]/.test(value.trimStart()) ? `'${value}` : value;
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

async function buildInventoryIntelligenceExport(connection, idTienda, query = {}, features = []) {
  const enabled = new Set(features);
  const boundedQuery = exportQuery(query);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Plataforma de tiendas';
  workbook.created = new Date();

  const summary = await inventorySummary(connection, idTienda, boundedQuery);
  addSheet(workbook, 'Resumen', [summary]);

  if (enabled.has('alertas_stock')) {
    const alerts = await inventoryAlerts(connection, idTienda, boundedQuery, { maximumLimit: MAX_ANALYSIS_ROWS });
    addSheet(workbook, 'Alertas', alerts.rows);
  }
  if (enabled.has('ranking_productos')) {
    const ranking = await inventoryRanking(connection, idTienda, boundedQuery, { maximumLimit: MAX_ANALYSIS_ROWS });
    addSheet(workbook, 'Mas vendidos', ranking.masVendidosUnidades);
    addSheet(workbook, 'Ranking ingresos', ranking.masVendidosIngresos);
    addSheet(workbook, 'Menos vendidos', ranking.menosVendidos);
  }
  if (enabled.has('compras_sugeridas')) {
    const suggestions = await suggestedPurchases(
      connection, idTienda, boundedQuery, { maximumLimit: MAX_ANALYSIS_ROWS }
    );
    addSheet(workbook, 'Compras sugeridas', suggestions.rows);
  }
  if (enabled.has('rotacion_inventario')) {
    const rotation = await inventoryRotation(connection, idTienda, boundedQuery, { maximumLimit: MAX_ANALYSIS_ROWS });
    addSheet(workbook, 'Rotacion', rotation.rows);
  }
  if (enabled.has('inventario_sin_movimiento')) {
    const withoutMovement = await inventoryWithoutMovement(
      connection, idTienda, boundedQuery, { maximumLimit: MAX_ANALYSIS_ROWS }
    );
    addSheet(workbook, 'Sin movimiento', withoutMovement.rows);
  }
  if (enabled.has('valor_inventario_basico')) {
    const valuation = await inventoryValuation(connection, idTienda, boundedQuery, { maximumLimit: MAX_ANALYSIS_ROWS });
    addSheet(workbook, 'Valoracion resumen', [valuation.resumen]);
    addSheet(workbook, 'Valoracion detalle', valuation.rows);
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const date = String(summary.periodo.hastaExclusivo).slice(0, 10);
  return {
    buffer,
    fileName: `inteligencia-inventario-${date}.xlsx`,
    sheets: workbook.worksheets.map((sheet) => sheet.name)
  };
}

module.exports = {
  buildInventoryIntelligenceExport,
  neutralizeFormula
};
