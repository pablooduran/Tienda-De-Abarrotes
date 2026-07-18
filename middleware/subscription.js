const pool = require('../config/db');
const { enforcePlanLimit, resolveSubscriptionContext } = require('../services/subscription-service');

async function resolveSubscription(req, res, next) {
  try {
    req.subscriptionContext = await resolveSubscriptionContext(pool, req.tenant.idTienda);
    next();
  } catch (error) {
    next(error);
  }
}

function requireActiveSubscription(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const context = req.subscriptionContext;
  if (context && !context.soloLectura) return next();
  return res.status(403).json({
    error: 'La suscripcion no permite realizar cambios. Los datos siguen disponibles en modo de solo lectura.',
    code: 'SUBSCRIPTION_READ_ONLY',
    estadoSuscripcion: context?.suscripcion?.estadoEfectivo || 'sin_suscripcion',
    fechaFin: context?.suscripcion?.fechaFin || null
  });
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
  requirePlanFeature,
  resolveSubscription
};
