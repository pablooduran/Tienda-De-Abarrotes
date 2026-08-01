const pool = require('../config/db');
const {
  accessDescription,
  accessLevelForStatus
} = require('../config/subscription-access-policy');
const { materializeSubscriptionLifecycle } = require('./subscription-lifecycle-service');
const { resolveSubscriptionContext } = require('./subscription-service');

function decorateContext(context) {
  const status = context?.suscripcion?.estadoEfectivo || 'sin_suscripcion';
  const access = accessDescription(status);
  return Object.freeze({
    ...context,
    estadoAcceso: access.nivel,
    acceso: access,
    soloLectura: access.nivel !== 'completo'
  });
}

async function resolveSubscriptionAccess(database = pool, idTienda, options = {}) {
  let context = await resolveSubscriptionContext(database, idTienda, { now: options.now });
  if (options.materialize !== false && context.suscripcion?.idSuscripcion) {
    const result = await materializeSubscriptionLifecycle(database, {
      idTienda,
      idSuscripcion: context.suscripcion.idSuscripcion,
      now: options.now
    });
    if (result.transition || result.estado !== context.suscripcion.estado) {
      context = await resolveSubscriptionContext(database, idTienda, { now: options.now });
    }
  }
  return decorateContext(context);
}

function publicSubscriptionSummary(context) {
  const subscription = context?.suscripcion;
  const status = subscription?.estadoEfectivo || 'sin_suscripcion';
  const access = context?.acceso || accessDescription(status);
  return Object.freeze({
    estado: subscription?.estado || 'sin_suscripcion',
    estadoEfectivo: status,
    tipo: subscription?.tipo || null,
    periodo: subscription ? {
      tipo: subscription.tipoPeriodo || null,
      duracionDias: subscription.duracionDias ?? null
    } : null,
    fechaInicio: subscription?.fechaInicio || null,
    fechaFin: subscription?.fechaFin || null,
    fechaFinGracia: subscription?.fechaFinGracia || null,
    diasRestantes: subscription?.diasRestantes ?? null,
    diasGraciaRestantes: subscription?.diasGraciaRestantes ?? null,
    plan: context?.plan ? { codigo: context.plan.codigo, nombre: context.plan.nombre } : null,
    acceso: access,
    limites: context?.limites || {},
    uso: context?.uso || {},
    funcionalidades: Array.isArray(context?.caracteristicas) ? [...context.caracteristicas] : [],
    puedeRenovar: ['gracia', 'suspendida'].includes(status),
    puedeReactivar: status === 'suspendida'
  });
}

function ownerDestination(context, onboardingStatus) {
  const accessLevel = context?.estadoAcceso || accessLevelForStatus(context?.suscripcion?.estadoEfectivo);
  if (accessLevel === 'restringido') return '/suscripcion.html';
  if (accessLevel === 'solo_lectura') return '/app.html';
  return onboardingStatus === 'completado' ? '/app.html' : '/onboarding.html';
}

module.exports = {
  decorateContext,
  ownerDestination,
  publicSubscriptionSummary,
  resolveSubscriptionAccess
};
