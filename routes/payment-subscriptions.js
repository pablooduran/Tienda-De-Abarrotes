const express = require('express');
const {
  emptyQuery,
  idempotencyKey,
  requestReference
} = require('../config/saas-c-payment-request-contract');
const { createSaasCPaymentService } = require('../services/saas-c-payment-service');

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function ownerContext(req) {
  const subscription = req.subscriptionContext?.suscripcion;
  if (!subscription?.idSuscripcion) {
    const error = new Error('La tienda no tiene una suscripcion disponible.');
    error.status = 409;
    error.code = 'SUBSCRIPTION_NOT_AVAILABLE';
    throw error;
  }
  return Object.freeze({
    idTienda: req.tenant.idTienda,
    idSuscripcion: subscription.idSuscripcion,
    idAdministrador: req.auth.idAdministrador,
    requestId: req.requestId
  });
}

function createPaymentSubscriptionsRouter({ service = createSaasCPaymentService() } = {}) {
  const router = express.Router();
  router.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    next();
  });

  router.get('/planes', asyncRoute(async (req, res) => {
    emptyQuery(req.query);
    res.json(await service.listPublicPlans(ownerContext(req)));
  }));

  router.get('/metodos', asyncRoute(async (req, res) => {
    emptyQuery(req.query);
    ownerContext(req);
    res.json(await service.listOwnerMethods());
  }));

  router.post('/cotizar', asyncRoute(async (req, res) => {
    res.json(await service.quote({ ...ownerContext(req), body: req.body }));
  }));

  router.get('/solicitudes', asyncRoute(async (req, res) => {
    res.json(await service.listRequests({ ...ownerContext(req), query: req.query }));
  }));

  router.post('/solicitudes', asyncRoute(async (req, res) => {
    const result = await service.createRequest({
      ...ownerContext(req),
      body: req.body,
      idempotencyKey: idempotencyKey(req.get('Idempotency-Key'))
    });
    res.status(result.created ? 201 : 200).json(result);
  }));

  router.get('/solicitudes/:reference', asyncRoute(async (req, res) => {
    res.json(await service.requestDetail({
      ...ownerContext(req),
      reference: requestReference(req.params.reference)
    }));
  }));

  router.post('/solicitudes/:reference/cancelar', asyncRoute(async (req, res) => {
    const source = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
    if (Object.keys(source).length) {
      const error = new Error('La solicitud contiene campos no permitidos.');
      error.status = 400;
      error.code = 'PAYMENT_REQUEST_FIELDS_NOT_ALLOWED';
      throw error;
    }
    res.json(await service.cancelRequest({
      ...ownerContext(req),
      reference: requestReference(req.params.reference),
      idempotencyKey: idempotencyKey(req.get('Idempotency-Key'))
    }));
  }));

  return router;
}

module.exports = { createPaymentSubscriptionsRouter };
