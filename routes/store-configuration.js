const express = require('express');
const { storeConfigurationService } = require('../services/store-configuration-service');

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function context(req) {
  return { idTienda: req.tenant.idTienda, idAdministrador: req.auth.idAdministrador, requestId: req.requestId };
}

function createStoreConfigurationRouter({ service = storeConfigurationService } = {}) {
  const router = express.Router();
  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store, max-age=0');
    next();
  });
  router.get('/', asyncRoute(async (req, res) => res.json(await service.get(context(req)))));
  router.patch('/', asyncRoute(async (req, res) => res.json(await service.save(context(req), req.body))));
  return router;
}

module.exports = createStoreConfigurationRouter();
module.exports.createStoreConfigurationRouter = createStoreConfigurationRouter;
