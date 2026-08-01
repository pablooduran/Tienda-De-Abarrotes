const express = require('express');
const { actionBody, storeReference } = require('../config/saas-subscription-admin-contract');
const { createSaasSubscriptionAdminService } = require('../services/saas-subscription-admin-service');

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function operationKey(req) {
  const key = String(req.get('Idempotency-Key') || '').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$/.test(key)) {
    const error = new Error('La clave de operacion no es valida.');
    error.status = 400;
    error.code = 'INVALID_OPERATION_KEY';
    throw error;
  }
  return key;
}

function createAdminSubscriptionsRouter({ service = createSaasSubscriptionAdminService() } = {}) {
  const router = express.Router();
  router.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  router.get('/', asyncRoute(async (req, res) => res.json(await service.list(req.query))));
  router.get('/resumen', asyncRoute(async (req, res) => res.json(await service.summary())));
  router.get('/:reference', asyncRoute(async (req, res) => (
    res.json(await service.detail(storeReference(req.params.reference), req.query))
  )));

  for (const action of ['suspender', 'reactivar', 'renovar', 'cancelar', 'upgrade', 'downgrade']) {
    router.post(`/:reference/${action}`, asyncRoute(async (req, res) => {
      const result = await service.mutate({
        reference: storeReference(req.params.reference),
        action,
        body: actionBody(action, req.body),
        idAdministrador: req.auth.idAdministrador,
        idempotencyKey: operationKey(req),
        requestId: req.requestId
      });
      res.json({ message: 'La suscripcion se actualizo correctamente.', resultado: result });
    }));
  }
  return router;
}

module.exports = { createAdminSubscriptionsRouter };
