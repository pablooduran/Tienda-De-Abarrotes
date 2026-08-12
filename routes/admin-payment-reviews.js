const express = require('express');
const { pipeline } = require('stream/promises');
const {
  idempotencyKey,
  requestReference,
  reviewBody,
  reviewQuery
} = require('../config/saas-c-payment-review-contract');
const { applicationBody } = require('../config/saas-c-payment-application-contract');
const { createSaasCPaymentReviewService } = require('../services/saas-c-payment-review-service');
const { createSaasCPaymentApplicationService } = require('../services/saas-c-payment-application-service');

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function context(req) {
  return Object.freeze({
    idAdministrador: req.auth.idAdministrador,
    requestId: req.requestId
  });
}

function createAdminPaymentReviewsRouter({
  service = createSaasCPaymentReviewService(),
  applicationService = createSaasCPaymentApplicationService()
} = {}) {
  const router = express.Router();
  router.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    next();
  });

  router.get('/', asyncRoute(async (req, res) => {
    res.json(await service.list({ ...context(req), query: reviewQuery(req.query) }));
  }));

  router.post('/:reference/aplicar', asyncRoute(async (req, res) => {
    applicationBody(req.body);
    res.json(await applicationService.apply({
      ...context(req),
      reference: requestReference(req.params.reference),
      idempotencyKey: idempotencyKey(req.get('Idempotency-Key'))
    }));
  }));

  router.get('/:reference/comprobante', asyncRoute(async (req, res) => {
    const result = await service.download({
      ...context(req),
      reference: requestReference(req.params.reference)
    });
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Type', result.mime);
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    res.setHeader('Content-Length', String(result.size));
    await pipeline(result.stream, res);
  }));

  router.get('/:reference', asyncRoute(async (req, res) => {
    res.json(await service.detail({
      ...context(req),
      reference: requestReference(req.params.reference)
    }));
  }));

  for (const decision of ['observada', 'rechazada']) {
    router.post(`/:reference/${decision}`, asyncRoute(async (req, res) => {
      res.json(await service.transition({
        ...context(req),
        reference: requestReference(req.params.reference),
        decision,
        body: reviewBody(req.body),
        idempotencyKey: idempotencyKey(req.get('Idempotency-Key'))
      }));
    }));
  }
  return router;
}

module.exports = { createAdminPaymentReviewsRouter };
