const express = require('express');
const { emptyQuery, idempotencyKey, methodReference } = require('../config/saas-c-payment-request-contract');
const { createSaasCPaymentService } = require('../services/saas-c-payment-service');

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function adminContext(req) {
  return Object.freeze({
    idAdministrador: req.auth.idAdministrador,
    requestId: req.requestId
  });
}

function createAdminPaymentSubscriptionsRouter({ service = createSaasCPaymentService() } = {}) {
  const router = express.Router();
  router.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    next();
  });

  router.get('/tipos-cambio', asyncRoute(async (req, res) => {
    res.json(await service.listExchangeRates(req.query));
  }));

  router.post('/tipos-cambio', asyncRoute(async (req, res) => {
    const result = await service.registerExchangeRate({
      ...adminContext(req),
      body: req.body,
      idempotencyKey: idempotencyKey(req.get('Idempotency-Key'))
    });
    res.status(result.replayed ? 200 : 201).json(result);
  }));

  router.get('/metodos', asyncRoute(async (req, res) => {
    emptyQuery(req.query, 'PAYMENT_METHOD_FILTERS_NOT_ALLOWED');
    res.json(await service.listAdminMethods());
  }));

  router.patch('/metodos/:reference', asyncRoute(async (req, res) => {
    res.json(await service.configurePaymentMethod({
      ...adminContext(req),
      reference: methodReference(req.params.reference),
      body: req.body,
      idempotencyKey: idempotencyKey(req.get('Idempotency-Key'))
    }));
  }));

  return router;
}

module.exports = { createAdminPaymentSubscriptionsRouter };
