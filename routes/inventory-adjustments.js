const express = require('express');
const pool = require('../config/db');
const { requirePlanFeature } = require('../middleware/subscription');
const {
  INVENTORY_ADJUSTMENT_FEATURE,
  INVENTORY_HISTORY_FEATURE,
  INVENTORY_RECONCILIATION_FEATURE
} = require('../config/inventory-adjustment-contract');
const {
  createInventoryAdjustmentService,
  listInventoryAdjustments
} = require('../services/inventory-adjustment-service');
const { inventoryReconciliation } = require('../services/inventory-reconciliation-service');
const { administrativeAuditService } = require('../services/administrative-audit-service');

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function createInventoryAdjustmentsRouter({
  database = pool,
  audit = administrativeAuditService,
  adjustmentService = createInventoryAdjustmentService({ database, audit })
} = {}) {
  const router = express.Router();

  router.get(
    '/inventario/conciliacion',
    requirePlanFeature(INVENTORY_RECONCILIATION_FEATURE),
    asyncRoute(async (req, res) => {
      const result = await inventoryReconciliation(database, req.tenant.idTienda, req.query);
      res.set('Cache-Control', 'no-store');
      res.json(result);
      await audit.recordOutcome({
        storeId: req.tenant.idTienda,
        actorType: 'administrador',
        administratorId: Number(req.session.admin.id),
        action: 'conciliacion_inventario_consultada',
        result: 'correcto',
        resultCode: 'INVENTORY_RECONCILIATION_READ',
        origin: 'web',
        reference: null,
        requestId: req.requestId
      });
    })
  );

  router.get(
    '/inventario/ajustes',
    requirePlanFeature(INVENTORY_HISTORY_FEATURE),
    asyncRoute(async (req, res) => {
      res.set('Cache-Control', 'no-store');
      res.json(await listInventoryAdjustments(database, req.tenant.idTienda, req.query));
    })
  );

  router.post(
    '/inventario/ajustes',
    requirePlanFeature(INVENTORY_ADJUSTMENT_FEATURE),
    asyncRoute(async (req, res) => {
      const result = await adjustmentService.applyAdjustment({
        idTienda: req.tenant.idTienda,
        idAdministrador: Number(req.session.admin.id),
        idProducto: req.body?.idProducto,
        requestId: req.requestId
      }, req.body || {});
      res.status(result.repetida ? 200 : 201).json({
        message: result.repetida
          ? 'El ajuste ya habia sido aplicado.'
          : 'Ajuste de inventario aplicado.',
        ajuste: result
      });
    })
  );

  return router;
}

module.exports = createInventoryAdjustmentsRouter();
module.exports.createInventoryAdjustmentsRouter = createInventoryAdjustmentsRouter;
