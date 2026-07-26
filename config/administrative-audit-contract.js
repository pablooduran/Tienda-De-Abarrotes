const ACTOR_TYPES = Object.freeze(['administrador', 'sistema', 'anonimo']);
const AUDIT_RESULTS = Object.freeze(['correcto', 'rechazado', 'fallido', 'limitado']);
const AUDIT_ORIGINS = Object.freeze(['web', 'sistema', 'script']);

const VALUE_TYPES = Object.freeze({
  activo: 'boolean',
  estado: 'code',
  rol: 'code',
  planCodigo: 'code',
  tipoSuscripcion: 'code',
  sesionesRevocadas: 'integer',
  versionSesionIncrementada: 'boolean'
});

function definition(category, entity, before = [], after = [], metadata = []) {
  return Object.freeze({
    category,
    entity,
    allowed: Object.freeze({
      before: Object.freeze(before),
      after: Object.freeze(after),
      metadata: Object.freeze(metadata)
    })
  });
}

const AUDIT_ACTIONS = Object.freeze({
  inicio_sesion: definition('autenticacion', 'administrador', [], [], ['rol']),
  cierre_sesion: definition('sesion', 'sesion'),
  revocacion_sesion: definition('sesion', 'sesion', [], [], ['sesionesRevocadas']),
  cambio_password: definition('credencial', 'administrador', [], [], ['versionSesionIncrementada']),
  restablecimiento_password: definition('credencial', 'administrador', [], [], ['versionSesionIncrementada']),
  creacion_tienda: definition('tienda', 'tienda', [], ['activo', 'estado']),
  modificacion_tienda: definition('tienda', 'tienda', ['activo', 'estado'], ['activo', 'estado']),
  activacion_tienda: definition('tienda', 'tienda', ['activo', 'estado'], ['activo', 'estado']),
  desactivacion_tienda: definition('tienda', 'tienda', ['activo', 'estado'], ['activo', 'estado']),
  creacion_propietario: definition('propietario', 'administrador', [], ['activo', 'rol']),
  modificacion_propietario: definition('propietario', 'administrador', ['activo', 'rol'], ['activo', 'rol']),
  activacion_propietario: definition('propietario', 'administrador', ['activo'], ['activo']),
  desactivacion_propietario: definition('propietario', 'administrador', ['activo'], ['activo']),
  asignacion_plan: definition('plan', 'plan', ['planCodigo'], ['planCodigo']),
  creacion_suscripcion: definition(
    'suscripcion',
    'suscripcion',
    [],
    ['estado', 'planCodigo', 'tipoSuscripcion']
  ),
  suspension_suscripcion: definition('suscripcion', 'suscripcion', ['estado'], ['estado']),
  cancelacion_suscripcion: definition('suscripcion', 'suscripcion', ['estado'], ['estado'])
});

const ADMIN_FAILURE_CODES = Object.freeze(['ADMIN_OPERATION_REJECTED', 'ADMIN_OPERATION_FAILED']);
const AUDIT_ACTION_RESULT_CODES = Object.freeze({
  inicio_sesion: Object.freeze([
    'LOGIN_OK',
    'INVALID_CREDENTIALS',
    'LOGIN_INPUT_INVALID',
    'TOO_MANY_LOGIN_ATTEMPTS'
  ]),
  cierre_sesion: Object.freeze(['LOGOUT_OK']),
  revocacion_sesion: Object.freeze(['SESSION_REVOKED', 'STORE_UNAVAILABLE']),
  cambio_password: Object.freeze(['PASSWORD_CHANGED', 'PASSWORD_CHANGE_REJECTED']),
  restablecimiento_password: Object.freeze(['PASSWORD_RESET', ...ADMIN_FAILURE_CODES]),
  creacion_tienda: Object.freeze(['STORE_CREATED', ...ADMIN_FAILURE_CODES]),
  modificacion_tienda: Object.freeze(['STORE_UPDATED', ...ADMIN_FAILURE_CODES]),
  activacion_tienda: Object.freeze(['STORE_ACTIVATED', ...ADMIN_FAILURE_CODES]),
  desactivacion_tienda: Object.freeze(['STORE_DEACTIVATED', ...ADMIN_FAILURE_CODES]),
  creacion_propietario: Object.freeze(['OWNER_CREATED', ...ADMIN_FAILURE_CODES]),
  modificacion_propietario: Object.freeze(['OWNER_UPDATED', ...ADMIN_FAILURE_CODES]),
  activacion_propietario: Object.freeze(['OWNER_ACTIVATED', ...ADMIN_FAILURE_CODES]),
  desactivacion_propietario: Object.freeze(['OWNER_DEACTIVATED', ...ADMIN_FAILURE_CODES]),
  asignacion_plan: Object.freeze(['PLAN_ASSIGNED']),
  creacion_suscripcion: Object.freeze(['SUBSCRIPTION_CREATED', ...ADMIN_FAILURE_CODES]),
  suspension_suscripcion: Object.freeze(['SUBSCRIPTION_SUSPENDED', ...ADMIN_FAILURE_CODES]),
  cancelacion_suscripcion: Object.freeze(['SUBSCRIPTION_CANCELLED', ...ADMIN_FAILURE_CODES])
});

const AUDIT_CATEGORIES = Object.freeze(
  [...new Set(Object.values(AUDIT_ACTIONS).map((item) => item.category))]
);

const AUDIT_RESULT_CODES = Object.freeze([
  'LOGIN_OK',
  'INVALID_CREDENTIALS',
  'LOGIN_INPUT_INVALID',
  'TOO_MANY_LOGIN_ATTEMPTS',
  'LOGOUT_OK',
  'SESSION_REVOKED',
  'STORE_UNAVAILABLE',
  'PASSWORD_CHANGED',
  'PASSWORD_CHANGE_REJECTED',
  'PASSWORD_RESET',
  'STORE_CREATED',
  'STORE_UPDATED',
  'STORE_ACTIVATED',
  'STORE_DEACTIVATED',
  'OWNER_CREATED',
  'OWNER_UPDATED',
  'OWNER_ACTIVATED',
  'OWNER_DEACTIVATED',
  'PLAN_ASSIGNED',
  'SUBSCRIPTION_CREATED',
  'SUBSCRIPTION_SUSPENDED',
  'SUBSCRIPTION_CANCELLED',
  'ADMIN_OPERATION_REJECTED',
  'ADMIN_OPERATION_FAILED'
]);

const AUDIT_RESULTS_BY_CODE = Object.freeze({
  LOGIN_OK: Object.freeze(['correcto']),
  INVALID_CREDENTIALS: Object.freeze(['rechazado']),
  LOGIN_INPUT_INVALID: Object.freeze(['rechazado']),
  TOO_MANY_LOGIN_ATTEMPTS: Object.freeze(['limitado']),
  LOGOUT_OK: Object.freeze(['correcto']),
  SESSION_REVOKED: Object.freeze(['correcto', 'rechazado']),
  STORE_UNAVAILABLE: Object.freeze(['rechazado']),
  PASSWORD_CHANGED: Object.freeze(['correcto']),
  PASSWORD_CHANGE_REJECTED: Object.freeze(['rechazado', 'fallido']),
  PASSWORD_RESET: Object.freeze(['correcto']),
  STORE_CREATED: Object.freeze(['correcto']),
  STORE_UPDATED: Object.freeze(['correcto']),
  STORE_ACTIVATED: Object.freeze(['correcto']),
  STORE_DEACTIVATED: Object.freeze(['correcto']),
  OWNER_CREATED: Object.freeze(['correcto']),
  OWNER_UPDATED: Object.freeze(['correcto']),
  OWNER_ACTIVATED: Object.freeze(['correcto']),
  OWNER_DEACTIVATED: Object.freeze(['correcto']),
  PLAN_ASSIGNED: Object.freeze(['correcto']),
  SUBSCRIPTION_CREATED: Object.freeze(['correcto']),
  SUBSCRIPTION_SUSPENDED: Object.freeze(['correcto']),
  SUBSCRIPTION_CANCELLED: Object.freeze(['correcto']),
  ADMIN_OPERATION_REJECTED: Object.freeze(['rechazado']),
  ADMIN_OPERATION_FAILED: Object.freeze(['fallido'])
});

module.exports = {
  ACTOR_TYPES,
  AUDIT_ACTION_RESULT_CODES,
  AUDIT_ACTIONS,
  AUDIT_CATEGORIES,
  AUDIT_ORIGINS,
  AUDIT_RESULTS,
  AUDIT_RESULTS_BY_CODE,
  AUDIT_RESULT_CODES,
  VALUE_TYPES
};
