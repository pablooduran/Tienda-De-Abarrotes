const crypto = require('crypto');

const SUBSCRIPTION_GRACE_DAYS = 7;
const SUBSCRIPTION_STATES = Object.freeze([
  'pendiente',
  'activa',
  'gracia',
  'vencida',
  'suspendida',
  'cancelada'
]);
const SUBSCRIPTION_PERIOD_TYPES = Object.freeze([
  'mensual',
  'anual',
  'personalizada'
]);
const SUBSCRIPTION_TRANSITION_OPERATIONS = Object.freeze([
  'migracion_inicial',
  'inicio_prueba',
  'activacion',
  'entrada_gracia',
  'vencimiento',
  'suspension',
  'reactivacion',
  'renovacion',
  'upgrade',
  'downgrade_programado',
  'downgrade_aplicado',
  'cancelacion'
]);
const SUBSCRIPTION_TRANSITION_REASONS = Object.freeze([
  'inicio_prueba',
  'asignacion_administrativa',
  'fin_vigencia',
  'fin_gracia',
  'renovacion',
  'cambio_plan',
  'reemplazo_periodo',
  'suspension_administrativa',
  'cancelacion_administrativa',
  'reactivacion_administrativa',
  'migracion_inicial',
  'otro_controlado'
]);
const SUBSCRIPTION_ACTOR_TYPES = Object.freeze([
  'administrador',
  'sistema',
  'anonimo',
  'migracion'
]);
const SUBSCRIPTION_IDEMPOTENT_OPERATIONS = Object.freeze([
  'renovar',
  'suspender',
  'reactivar',
  'cancelar',
  'cambiar_plan'
]);
const SUBSCRIPTION_OPERATION_STATES = Object.freeze([
  'en_proceso',
  'completada',
  'fallida'
]);

const METADATA_FIELDS = Object.freeze({
  migracion_inicial: Object.freeze(['planCodigo', 'tipoSuscripcion', 'tipoPeriodo']),
  inicio_prueba: Object.freeze(['planCodigo', 'tipoSuscripcion', 'tipoPeriodo']),
  activacion: Object.freeze(['planCodigo', 'tipoSuscripcion', 'tipoPeriodo']),
  entrada_gracia: Object.freeze([]),
  vencimiento: Object.freeze([]),
  suspension: Object.freeze([]),
  reactivacion: Object.freeze([]),
  renovacion: Object.freeze(['planCodigo', 'tipoPeriodo']),
  upgrade: Object.freeze(['planCodigoAnterior', 'planCodigoNuevo']),
  downgrade_programado: Object.freeze(['planCodigoAnterior', 'planCodigoNuevo']),
  downgrade_aplicado: Object.freeze(['planCodigoAnterior', 'planCodigoNuevo']),
  cancelacion: Object.freeze([])
});

function periodTypeForDuration(durationDays) {
  const duration = Number(durationDays);
  if (!Number.isInteger(duration) || duration <= 0) {
    throw new Error('La duracion del periodo debe ser un entero positivo.');
  }
  if (duration === 30) return 'mensual';
  if (duration === 365) return 'anual';
  return 'personalizada';
}

function snapshotFromPlan(plan, durationDays) {
  if (!plan?.idPlan || !plan.codigo || !plan.nombre) {
    throw new Error('El plan no permite construir un snapshot valido.');
  }
  return Object.freeze({
    planCodigo: String(plan.codigo),
    planNombre: String(plan.nombre),
    tipoPeriodo: periodTypeForDuration(durationDays),
    duracionDias: Number(durationDays),
    precioReferencia: Number(plan.precioMensual || 0),
    limitePropietarios: plan.limitePropietarios === null ? null : Number(plan.limitePropietarios),
    limiteProductos: plan.limiteProductos === null ? null : Number(plan.limiteProductos),
    limiteClientes: plan.limiteClientes === null ? null : Number(plan.limiteClientes),
    limiteProveedores: plan.limiteProveedores === null ? null : Number(plan.limiteProveedores)
  });
}

function sanitizeLifecycleMetadata(operation, metadata = {}) {
  const allowed = METADATA_FIELDS[operation];
  if (!allowed) throw new Error('La operacion de historial no esta permitida.');
  const source = metadata && typeof metadata === 'object' && !Array.isArray(metadata)
    ? metadata
    : {};
  const sanitized = {};
  for (const field of allowed) {
    const value = source[field];
    if (value !== undefined && value !== null && value !== '') {
      sanitized[field] = String(value).slice(0, 80);
    }
  }
  return Object.freeze(sanitized);
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

module.exports = {
  SUBSCRIPTION_ACTOR_TYPES,
  SUBSCRIPTION_GRACE_DAYS,
  SUBSCRIPTION_IDEMPOTENT_OPERATIONS,
  SUBSCRIPTION_OPERATION_STATES,
  SUBSCRIPTION_PERIOD_TYPES,
  SUBSCRIPTION_STATES,
  SUBSCRIPTION_TRANSITION_OPERATIONS,
  SUBSCRIPTION_TRANSITION_REASONS,
  periodTypeForDuration,
  sanitizeLifecycleMetadata,
  sha256,
  snapshotFromPlan
};
