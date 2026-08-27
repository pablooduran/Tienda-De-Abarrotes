const express = require('express');
const multer = require('multer');
const { pipeline } = require('stream/promises');
const {
  emptyQuery,
  idempotencyKey,
  requestReference
} = require('../config/saas-c-payment-request-contract');
const {
  MAX_RECEIPT_BYTES,
  RECEIPT_FIELD_NAME,
  receiptError,
  receiptReference,
  respondReceiptFeatureDisabled
} = require('../config/saas-c-payment-receipt-contract');
const { createSaasCPaymentService } = require('../services/saas-c-payment-service');
const { createSaasCPaymentReceiptService } = require('../services/saas-c-payment-receipt-service');

const receiptUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_RECEIPT_BYTES, files: 1, fields: 0, parts: 2 }
}).single(RECEIPT_FIELD_NAME);

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

function uploadMiddleware(req, res, next) {
  receiptUpload(req, res, (error) => {
    if (!error) return next();
    if (error instanceof multer.MulterError) {
      if (error.code === 'LIMIT_FILE_SIZE') {
        return next(receiptError(413, 'El comprobante supera el limite de 5 MiB.', 'RECEIPT_TOO_LARGE'));
      }
      return next(receiptError(400, 'La carga contiene partes no permitidas.', 'INVALID_RECEIPT_MULTIPART'));
    }
    return next(error);
  });
}

function createPaymentSubscriptionsRouter({
  service = createSaasCPaymentService(),
  receiptService = null,
  receiptsEnabled = true
} = {}) {
  if (typeof receiptsEnabled !== 'boolean') throw new Error('La disponibilidad de comprobantes no es valida.');
  const activeReceiptService = receiptsEnabled
    ? receiptService || createSaasCPaymentReceiptService()
    : null;
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

  router.use('/solicitudes/:reference/comprobantes', (req, res, next) => {
    if (!receiptsEnabled) return respondReceiptFeatureDisabled(req, res);
    return next();
  });

  router.get('/solicitudes/:reference/comprobantes', asyncRoute(async (req, res) => {
    emptyQuery(req.query);
    res.json(await activeReceiptService.list({
      ...ownerContext(req),
      reference: requestReference(req.params.reference)
    }));
  }));

  router.post('/solicitudes/:reference/comprobantes', uploadMiddleware, asyncRoute(async (req, res) => {
    const result = await activeReceiptService.upload({
      ...ownerContext(req),
      reference: requestReference(req.params.reference),
      idempotencyKey: idempotencyKey(req.get('Idempotency-Key')),
      file: req.file
    });
    res.status(result.comprobante.replayed ? 200 : 201).json(result);
  }));

  router.get('/solicitudes/:reference/comprobantes/:receiptReference', asyncRoute(async (req, res) => {
    emptyQuery(req.query);
    const result = await activeReceiptService.download({
      ...ownerContext(req),
      reference: requestReference(req.params.reference),
      receiptReference: receiptReference(req.params.receiptReference)
    });
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Type', result.mime);
    res.setHeader('Content-Length', String(result.size));
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    await pipeline(result.stream, res);
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
