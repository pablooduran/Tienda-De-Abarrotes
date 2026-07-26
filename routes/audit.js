const express = require('express');
const {
  createAdministrativeAuditQueryService
} = require('../services/administrative-audit-query-service');

function noStore(res) {
  res.set('Cache-Control', 'no-store');
}

function createAuditRouter({
  service = createAdministrativeAuditQueryService(),
  mode = 'tenant'
} = {}) {
  const router = express.Router();
  const administratorMode = mode === 'admin';

  router.get('/', async (req, res, next) => {
    try {
      noStore(res);
      const options = administratorMode
        ? { allowStoreFilter: true }
        : { forcedStoreId: req.tenant.idTienda };
      res.json(await service.list(req.query, options));
    } catch (error) {
      next(error);
    }
  });

  router.get('/:id', async (req, res, next) => {
    try {
      noStore(res);
      const options = administratorMode
        ? { includeStore: true }
        : { forcedStoreId: req.tenant.idTienda };
      res.json(await service.detail(req.params.id, options));
    } catch (error) {
      next(error);
    }
  });

  return router;
}

module.exports = { createAuditRouter };
