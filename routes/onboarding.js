const express = require('express');
const { onboardingService } = require('../services/onboarding-service');

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

function createOnboardingRouter({ service = onboardingService } = {}) {
  const router = express.Router();
  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store, max-age=0');
    next();
  });

  router.get('/', asyncRoute(async (req, res) => {
    res.json(await service.get(context(req)));
  }));

  router.patch('/', asyncRoute(async (req, res) => {
    res.json(await service.save(context(req), req.body));
  }));

  router.post('/completar', asyncRoute(async (req, res) => {
    const body = req.body && typeof req.body === 'object' && Object.keys(req.body).length > 0
      ? req.body
      : null;
    res.json(await service.complete(context(req), body));
  }));

  return router;
}

module.exports = createOnboardingRouter();
module.exports.createOnboardingRouter = createOnboardingRouter;
