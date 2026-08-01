const express = require('express');
const { publicSubscriptionSummary } = require('../services/subscription-access-service');
const { subscriptionPlanService } = require('../services/subscription-plan-service');

const router = express.Router();

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function serviceContext(req) {
  return {
    idTienda: req.tenant.idTienda,
    idSuscripcion: req.subscriptionContext.suscripcion.idSuscripcion,
    idAdministrador: req.auth.idAdministrador,
    idempotencyKey: req.get('Idempotency-Key'),
    requestId: req.requestId,
    uso: req.subscriptionContext.uso
  };
}

router.get('/', (req, res) => {
  res.json(publicSubscriptionSummary(req.subscriptionContext));
});

router.get('/planes', asyncRoute(async (req, res) => {
  res.json(await subscriptionPlanService.list(serviceContext(req)));
}));

router.post('/upgrade', asyncRoute(async (req, res) => {
  res.json(await subscriptionPlanService.upgrade({ ...serviceContext(req), body: req.body }));
}));

router.post('/downgrade', asyncRoute(async (req, res) => {
  res.json(await subscriptionPlanService.scheduleDowngrade({ ...serviceContext(req), body: req.body }));
}));

module.exports = router;
