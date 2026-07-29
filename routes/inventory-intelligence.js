const express = require('express');
const pool = require('../config/db');
const { requirePlanFeature } = require('../middleware/subscription');
const { buildInventoryIntelligenceExport } = require('../services/inventory-intelligence-export-service');
const { administrativeAuditService } = require('../services/administrative-audit-service');
const {
  inventoryAlerts,
  inventoryConfiguration,
  inventoryRanking,
  inventoryRotation,
  inventorySummary,
  inventoryValuation,
  inventoryWithoutMovement,
  suggestedPurchases,
  updateInventoryConfiguration,
  updateProductInventoryConfiguration
} = require('../services/inventory-intelligence-service');

const router = express.Router();

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function idTienda(req) {
  return req.tenant.idTienda;
}

router.get('/inventario-inteligente/resumen', requirePlanFeature('inventario_resumen'), asyncRoute(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(await inventorySummary(pool, idTienda(req), req.query));
}));

router.get('/inventario-inteligente/alertas', requirePlanFeature('alertas_stock'), asyncRoute(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(await inventoryAlerts(pool, idTienda(req), req.query));
}));

router.get('/inventario-inteligente/ranking', requirePlanFeature('ranking_productos'), asyncRoute(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(await inventoryRanking(pool, idTienda(req), req.query));
}));

router.get('/inventario-inteligente/valoracion', requirePlanFeature('valor_inventario_basico'), asyncRoute(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(await inventoryValuation(pool, idTienda(req), req.query));
}));

router.get('/inventario-inteligente/compras-sugeridas', requirePlanFeature('compras_sugeridas'), asyncRoute(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const result = await suggestedPurchases(pool, idTienda(req), req.query);
  res.json(result);
  await administrativeAuditService.recordOutcome({
    storeId: idTienda(req),
    actorType: 'administrador',
    administratorId: Number(req.session.admin.id),
    action: 'consulta_sugerencias_compra',
    result: 'correcto',
    resultCode: 'INVENTORY_SUGGESTIONS_READ',
    origin: 'web',
    reference: `inventario:${idTienda(req)}`,
    requestId: req.requestId
  });
}));

router.get('/inventario-inteligente/rotacion', requirePlanFeature('rotacion_inventario'), asyncRoute(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(await inventoryRotation(pool, idTienda(req), req.query));
}));

router.get('/inventario-inteligente/sin-movimiento', requirePlanFeature('inventario_sin_movimiento'), asyncRoute(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(await inventoryWithoutMovement(pool, idTienda(req), req.query));
}));

router.get('/inventario-inteligente/configuracion', requirePlanFeature('inventario_resumen'), asyncRoute(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(await inventoryConfiguration(pool, idTienda(req), req.query));
}));

router.put('/inventario-inteligente/configuracion', requirePlanFeature('inventario_resumen'), asyncRoute(async (req, res) => {
  const configuration = await updateInventoryConfiguration(
    pool,
    idTienda(req),
    req.session.admin.id,
    req.body || {}
  );
  res.json({ message: 'Configuracion de inventario actualizada.', configuracion: configuration });
}));

router.patch('/productos/:id/configuracion-inventario', requirePlanFeature('inventario_resumen'), asyncRoute(async (req, res) => {
  const configuration = await updateProductInventoryConfiguration(
    pool,
    idTienda(req),
    req.params.id,
    req.body || {}
  );
  res.json({ message: 'Configuracion del producto actualizada.', configuracion: configuration });
}));

router.get('/inventario-inteligente/exportacion.xlsx', requirePlanFeature('exportacion_inventario'), asyncRoute(async (req, res) => {
  const report = await buildInventoryIntelligenceExport(
    pool,
    idTienda(req),
    req.query,
    req.subscriptionContext?.caracteristicas || []
  );
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${report.fileName}"`);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Inventory-Sheets', String(report.sheets.length));
  res.send(Buffer.from(report.buffer));
  const action = report.type === 'rotacion'
    ? 'exportacion_rotacion_inventario'
    : report.type === 'alertas' ? 'exportacion_alertas_inventario' : null;
  if (!action) return;
  await administrativeAuditService.recordOutcome({
    storeId: idTienda(req),
    actorType: 'administrador',
    administratorId: Number(req.session.admin.id),
    action,
    result: 'correcto',
    resultCode: 'EXPORT_COMPLETED',
    origin: 'web',
    reference: `inventario:${idTienda(req)}`,
    requestId: req.requestId,
    metadata: { formato: 'xlsx', tipoExportacion: report.type, filas: report.rowCount }
  });
}));

module.exports = router;
