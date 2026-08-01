const pool = require('../config/db');
const { subscriptionRequestDecision } = require('../config/subscription-access-policy');
const { enforcePlanLimit } = require('../services/subscription-service');
const { resolveSubscriptionAccess } = require('../services/subscription-access-service');
const { logRejectedStockAction } = require('../services/stock-movement-service');

async function resolveSubscription(req, res, next) {
  try {
    req.subscriptionContext = await resolveSubscriptionAccess(pool, req.tenant.idTienda);
    next();
  } catch (error) {
    next(error);
  }
}

function blockedSubscriptionResponse(req, res) {
  const context = req.subscriptionContext;
  const adjustmentMatch = req.originalUrl.match(/\/productos\/(\d+)\/ajustar-stock(?:\?|$)/);
  if (adjustmentMatch) {
    logRejectedStockAction('ajuste_manual', {
      idTienda: req.tenant?.idTienda,
      idAdministrador: req.session?.admin?.id,
      idProducto: adjustmentMatch[1],
      codigo: 'SUSCRIPCION_SOLO_LECTURA'
    });
  }
  const status = context?.suscripcion?.estadoEfectivo || 'sin_suscripcion';
  const codes = {
    gracia: 'SUBSCRIPTION_GRACE_READ_ONLY',
    suspendida: 'SUBSCRIPTION_SUSPENDED',
    cancelada: 'SUBSCRIPTION_CANCELLED'
  };
  return res.status(403).json({
    error: context?.acceso?.mensaje || 'La suscripcion no permite acceder a esta operacion.',
    code: codes[status] || 'SUBSCRIPTION_RESTRICTED',
    estadoSuscripcion: status,
    nivelAcceso: context?.estadoAcceso || 'restringido',
    siguienteAccion: context?.acceso?.siguienteAccion || 'contactar_soporte'
  });
}

function requireActiveSubscription(req, res, next) {
  const decision = subscriptionRequestDecision({
    method: req.method,
    path: req.originalUrl,
    accessLevel: req.subscriptionContext?.estadoAcceso
  });
  if (decision.allowed) return next();
  return blockedSubscriptionResponse(req, res);
}

function requireFullSubscriptionAccess(req, res, next) {
  if (req.subscriptionContext?.estadoAcceso === 'completo') return next();
  return blockedSubscriptionResponse(req, res);
}

function requirePlanFeature(featureCode) {
  return (req, res, next) => {
    if (req.subscriptionContext?.caracteristicas?.includes(featureCode)) return next();
    return res.status(403).json({ error: 'Esta funcion no esta incluida en el plan actual.', code: 'PLAN_FEATURE_REQUIRED' });
  };
}

function enforcePlanEntityLimit(entity) {
  return async (req, res, next) => {
    try {
      await enforcePlanLimit(pool, req.tenant.idTienda, entity);
      next();
    } catch (error) {
      next(error);
    }
  };
}

module.exports = {
  enforcePlanEntityLimit,
  requireActiveSubscription,
  requireFullSubscriptionAccess,
  requirePlanFeature,
  resolveSubscription
};
