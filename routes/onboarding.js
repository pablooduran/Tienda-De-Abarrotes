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
    if (req.body && typeof req.body === 'object' && Object.keys(req.body).length) {
      const error = new Error('La solicitud de finalizacion no acepta campos adicionales.');
      error.status = 400;
      error.code = 'ONBOARDING_INPUT_INVALID';
      throw error;
    }
    res.json(await service.complete(context(req)));
  }));

  return router;
}

module.exports = createOnboardingRouter();
module.exports.createOnboardingRouter = createOnboardingRouter;
