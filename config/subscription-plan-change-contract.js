const PLAN_LIMIT_KEYS = Object.freeze([
  'propietarios',
  'productos',
  'clientes',
  'proveedores'
]);

const PUBLIC_PERIODS = Object.freeze(['mensual', 'anual']);
const PLAN_CHANGE_TYPES = Object.freeze({
  UPGRADE: 'upgrade',
  DOWNGRADE: 'downgrade',
  SAME: 'mismo_plan',
  INVALID: 'cambio_invalido'
});

function planCode(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!/^[a-z][a-z0-9_-]{1,49}$/.test(normalized)) {
    const error = new Error('El plan seleccionado no es valido.');
    error.status = 400;
    error.code = 'INVALID_PLAN_CODE';
    throw error;
  }
  return normalized;
}

function validatePlanChangeBody(body) {
  const source = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  const allowed = new Set(['codigoPlan']);
  const unknown = Object.keys(source).filter((key) => !allowed.has(key));
  if (unknown.length) {
    const error = new Error('La solicitud contiene campos no permitidos.');
    error.status = 400;
    error.code = 'PLAN_CHANGE_FIELDS_NOT_ALLOWED';
    throw error;
  }
  return Object.freeze({ codigoPlan: planCode(source.codigoPlan) });
}

function entitlementValue(value) {
  return value === null || value === undefined ? Number.POSITIVE_INFINITY : Number(value);
}

function featureSet(plan) {
  return new Set(Array.isArray(plan?.funcionalidades) ? plan.funcionalidades.map(String) : []);
}

function comparePlanEntitlements(current, target) {
  if (!current?.codigo || !target?.codigo) {
    throw new Error('Los planes no permiten una comparacion segura.');
  }
  if (current.codigo === target.codigo) {
    return Object.freeze({ tipo: PLAN_CHANGE_TYPES.SAME, diferencias: [], condiciones: [] });
  }

  const differences = [];
  let targetAtLeastCurrent = true;
  let targetAtMostCurrent = true;
  for (const key of PLAN_LIMIT_KEYS) {
    const currentValue = entitlementValue(current.limites?.[key]);
    const targetValue = entitlementValue(target.limites?.[key]);
    if (targetValue < currentValue) targetAtLeastCurrent = false;
    if (targetValue > currentValue) targetAtMostCurrent = false;
    if (targetValue !== currentValue) {
      differences.push(Object.freeze({ tipo: 'limite', clave: key, actual: current.limites?.[key] ?? null, objetivo: target.limites?.[key] ?? null }));
    }
  }

  const currentFeatures = featureSet(current);
  const targetFeatures = featureSet(target);
  const targetContainsCurrent = [...currentFeatures].every((feature) => targetFeatures.has(feature));
  const currentContainsTarget = [...targetFeatures].every((feature) => currentFeatures.has(feature));
  for (const feature of [...new Set([...currentFeatures, ...targetFeatures])].sort()) {
    if (currentFeatures.has(feature) !== targetFeatures.has(feature)) {
      differences.push(Object.freeze({ tipo: 'funcionalidad', clave: feature, actual: currentFeatures.has(feature), objetivo: targetFeatures.has(feature) }));
    }
  }

  const hasExpansion = differences.some((item) => (
    item.tipo === 'funcionalidad' ? item.objetivo : entitlementValue(item.objetivo) > entitlementValue(item.actual)
  ));
  const hasReduction = differences.some((item) => (
    item.tipo === 'funcionalidad' ? item.actual : entitlementValue(item.objetivo) < entitlementValue(item.actual)
  ));
  const conditions = Object.freeze([
    current.tipoPeriodo !== target.tipoPeriodo
      ? Object.freeze({ tipo: 'periodo', actual: current.tipoPeriodo || null, objetivo: target.tipoPeriodo || null })
      : null,
    Number(current.precioReferencia) !== Number(target.precioReferencia)
      ? Object.freeze({ tipo: 'precio_referencia', actual: Number(current.precioReferencia || 0), objetivo: Number(target.precioReferencia || 0) })
      : null
  ].filter(Boolean));

  if (targetAtLeastCurrent && targetContainsCurrent && hasExpansion && !hasReduction) {
    return Object.freeze({ tipo: PLAN_CHANGE_TYPES.UPGRADE, diferencias: Object.freeze(differences), condiciones: conditions });
  }
  if (targetAtMostCurrent && currentContainsTarget && hasReduction && !hasExpansion) {
    return Object.freeze({ tipo: PLAN_CHANGE_TYPES.DOWNGRADE, diferencias: Object.freeze(differences), condiciones: conditions });
  }
  return Object.freeze({ tipo: PLAN_CHANGE_TYPES.INVALID, diferencias: Object.freeze(differences), condiciones: conditions });
}

function limitAvailability(limits = {}, usage = {}, increment = 1) {
  return Object.freeze(Object.fromEntries(PLAN_LIMIT_KEYS.map((key) => {
    const limit = limits[key] === null || limits[key] === undefined ? null : Number(limits[key]);
    const current = Number(usage[key] || 0);
    const available = limit === null ? null : Math.max(0, limit - current);
    return [key, Object.freeze({
      limite: limit,
      uso: current,
      disponible: available,
      alcanzado: limit !== null && current === limit,
      excedido: limit !== null && current > limit,
      permiteAlta: limit === null || current + Number(increment) <= limit
    })];
  })));
}

module.exports = {
  PLAN_CHANGE_TYPES,
  PLAN_LIMIT_KEYS,
  PUBLIC_PERIODS,
  comparePlanEntitlements,
  limitAvailability,
  planCode,
  validatePlanChangeBody
};
