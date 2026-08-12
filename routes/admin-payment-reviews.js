const express = require('express');
const { pipeline } = require('stream/promises');
const { idempotencyKey, requestReference, reviewBody, reviewQuery } = require('../config/saas-c-payment-review-contract');
const { createSaasCPaymentReviewService } = require('../services/saas-c-payment-review-service');

function asyncRoute(handler) { return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next); }
function context(req) { return { idAdministrador: req.auth.idAdministrador, requestId: req.requestId }; }
function storeId(req) { const value = Number(req.query.idTienda); if (!Number.isSafeInteger(value) || value < 1) { const error = new Error('El contexto de tienda es obligatorio.'); error.status = 400; error.code = 'STORE_CONTEXT_REQUIRED'; throw error; } return value; }

function createAdminPaymentReviewsRouter({ service = createSaasCPaymentReviewService() } = {}) {
  const router = express.Router();
  router.use((req, res, next) => { res.setHeader('Cache-Control', 'no-store, max-age=0'); next(); });
  router.get('/', asyncRoute(async (req, res) => res.json(await service.list({ ...context(req), query: reviewQuery(req.query) }))));
  router.get('/:reference', asyncRoute(async (req, res) => res.json(await service.detail({ ...context(req), reference: requestReference(req.params.reference), idTienda: storeId(req) }))));
  for (const decision of ['observada', 'rechazada']) {
    router.post('/:reference/' + decision, asyncRoute(async (req, res) => res.json(await service.transition({
      ...context(req), idTienda: storeId(req), reference: requestReference(req.params.reference), decision,
      body: reviewBody(req.body), idempotencyKey: idempotencyKey(req.get('Idempotency-Key'))
    }))));
  }
  router.get('/:reference/comprobante', asyncRoute(async (req, res) => {
    const result = await service.download({ ...context(req), idTienda: storeId(req), reference: requestReference(req.params.reference) });
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Type', result.mime);
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    res.setHeader('Content-Length', String(result.size));
    await pipeline(result.stream, res);
  }));
  return router;
}

module.exports = { createAdminPaymentReviewsRouter };
