const express = require('express');
const { onlineStoreService } = require('../services/online-store-service');

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function createPublicStorefrontRouter({ service = onlineStoreService } = {}) {
  const router = express.Router();
  router.get('/:slug', asyncRoute(async (req, res) => {
    res.set('Cache-Control', 'public, max-age=30, stale-while-revalidate=30');
    res.json(await service.getPublicCatalog(req.params.slug));
  }));
  router.post('/:slug/clientes/buscar', asyncRoute(async (req, res) => {
    res.set('Cache-Control', 'no-store, max-age=0');
    res.json(await service.identifyPublicCustomer(req.params.slug, req.body?.telefono));
  }));
  router.post('/:slug/pedidos', asyncRoute(async (req, res) => {
    res.set('Cache-Control', 'no-store, max-age=0');
    res.status(201).json(await service.createPublicOrder(req.params.slug, req.body));
  }));
  return router;
}

module.exports = createPublicStorefrontRouter();
module.exports.createPublicStorefrontRouter = createPublicStorefrontRouter;
