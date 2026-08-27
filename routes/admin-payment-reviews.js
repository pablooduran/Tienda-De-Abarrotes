const express = require('express');
const { pipeline } = require('stream/promises');
const {
  idempotencyKey,
  requestReference,
  reviewBody,
  reviewQuery
} = require('../config/saas-c-payment-review-contract');
const { applicationBody } = require('../config/saas-c-payment-application-contract');
const { respondReceiptFeatureDisabled } = require('../config/saas-c-payment-receipt-contract');
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
  service = null,
  applicationService = null,
  receiptsEnabled = true
} = {}) {
  if (typeof receiptsEnabled !== 'boolean') throw new Error('La disponibilidad de comprobantes no es valida.');
  const router = express.Router();
  router.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    next();
  });
  if (!receiptsEnabled) {
    router.use((req, res) => respondReceiptFeatureDisabled(req, res));
    return router;
  }
  const activeService = service || createSaasCPaymentReviewService();
  const activeApplicationService = applicationService || createSaasCPaymentApplicationService();

  router.get('/', asyncRoute(async (req, res) => {
    res.json(await activeService.list({ ...context(req), query: reviewQuery(req.query) }));
  }));

  router.post('/:reference/aplicar', asyncRoute(async (req, res) => {
    applicationBody(req.body);
    res.json(await activeApplicationService.apply({
      ...context(req),
      reference: requestReference(req.params.reference),
      idempotencyKey: idempotencyKey(req.get('Idempotency-Key'))
    }));
  }));

  router.get('/:reference/comprobante', asyncRoute(async (req, res) => {
    const result = await activeService.download({
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
    res.json(await activeService.detail({
      ...context(req),
      reference: requestReference(req.params.reference)
    }));
  }));

  for (const decision of ['observada', 'rechazada']) {
    router.post(`/:reference/${decision}`, asyncRoute(async (req, res) => {
      res.json(await activeService.transition({
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
