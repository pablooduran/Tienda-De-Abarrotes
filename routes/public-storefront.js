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
  return router;
}

module.exports = createPublicStorefrontRouter();
module.exports.createPublicStorefrontRouter = createPublicStorefrontRouter;
