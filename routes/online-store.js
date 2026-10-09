const express = require('express');
const { onlineStoreService } = require('../services/online-store-service');

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function context(req) {
  return {
    idTienda: req.tenant.idTienda,
    idAdministrador: req.auth.idAdministrador,
    requestId: req.requestId
  };
}

function createOnlineStoreRouter({ service = onlineStoreService } = {}) {
  const router = express.Router();
  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store, max-age=0');
    next();
  });
  router.get('/configuracion', asyncRoute(async (req, res) => res.json(await service.getConfiguration(req.tenant.idTienda))));
  router.put('/configuracion', asyncRoute(async (req, res) => res.json(await service.updateConfiguration(context(req), req.body))));
  router.get('/productos', asyncRoute(async (req, res) => res.json(await service.listProducts(req.tenant.idTienda))));
  router.patch('/productos/:idProducto', asyncRoute(async (req, res) => res.json(await service.updateProduct(context(req), req.params.idProducto, req.body))));
  return router;
}

module.exports = createOnlineStoreRouter();
module.exports.createOnlineStoreRouter = createOnlineStoreRouter;
