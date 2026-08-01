const ACTOR_TYPES = Object.freeze(['administrador', 'sistema', 'anonimo']);
const AUDIT_RESULTS = Object.freeze(['correcto', 'rechazado', 'fallido', 'limitado']);
const AUDIT_ORIGINS = Object.freeze(['web', 'sistema', 'script']);

const VALUE_TYPES = Object.freeze({
  activo: 'boolean',
  estado: 'code',
  estadoOperacion: 'code',
  estadoPago: 'code',
  rol: 'code',
  planCodigo: 'code',
  tipoSuscripcion: 'code',
  tipoOperacion: 'code',
  tipoAjuste: 'code',
  motivoCodigo: 'code',
  tratamientoInventario: 'code',
  clasificacionInventario: 'code',
  metodoPago: 'code',
  formato: 'code',
  tipoExportacion: 'code',
  stock: 'integer',
  stockFisico: 'integer',
  stockVendible: 'integer',
  filas: 'integer',
  sesionesRevocadas: 'integer',
  versionSesionIncrementada: 'boolean',
  camposModificados: 'field_list'
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

const BASE_AUDIT_ACTIONS = {
  inicio_sesion: definition('autenticacion', 'administrador', [], [], ['rol']),
  cierre_sesion: definition('sesion', 'sesion'),
  revocacion_sesion: definition('sesion', 'sesion', [], [], ['sesionesRevocadas']),
  cambio_password: definition('credencial', 'administrador', [], [], ['versionSesionIncrementada']),
  restablecimiento_password: definition('credencial', 'administrador', [], [], ['versionSesionIncrementada']),
  registro_publico_solicitado: definition('registro_publico', 'registro_publico'),
  registro_publico_completado: definition(
    'registro_publico', 'tienda', [], ['activo', 'estado'], ['planCodigo', 'tipoSuscripcion']
  ),
  registro_publico_rechazado: definition('registro_publico', 'registro_publico'),
  registro_publico_fallido: definition('registro_publico', 'registro_publico'),
  verificacion_correo_emitida: definition('registro_publico', 'administrador'),
  reenvio_verificacion_solicitado: definition('registro_publico', 'registro_publico'),
  correo_verificado: definition('registro_publico', 'administrador', [], ['estado']),
  verificacion_correo_rechazada: definition('registro_publico', 'verificacion_correo'),
  verificacion_correo_entrega_fallida: definition('registro_publico', 'administrador'),
  recuperacion_password_solicitada: definition('registro_publico', 'recuperacion_password'),
  token_recuperacion_emitido: definition('registro_publico', 'recuperacion_password'),
  recuperacion_password_completada: definition('registro_publico', 'administrador', [], [], ['versionSesionIncrementada']),
  token_recuperacion_rechazado: definition('registro_publico', 'recuperacion_password'),
  recuperacion_entrega_fallida: definition('registro_publico', 'administrador'),
  onboarding_iniciado: definition('onboarding', 'tienda', ['estado'], ['estado'], ['camposModificados']),
  onboarding_progreso_guardado: definition('onboarding', 'configuracion_tienda', ['estado'], ['estado'], ['camposModificados']),
  onboarding_completado: definition('onboarding', 'tienda', ['estado'], ['estado'], ['camposModificados']),
  onboarding_rechazado: definition('onboarding', 'tienda'),
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
  suspension_suscripcion: definition('suscripcion', 'suscripcion', ['estado'], ['estado'], ['motivoCodigo']),
  reactivacion_suscripcion: definition('suscripcion', 'suscripcion', ['estado'], ['estado'], ['motivoCodigo']),
  cancelacion_suscripcion: definition('suscripcion', 'suscripcion', ['estado'], ['estado'])
};

const COMMERCIAL_AUDIT_ACTIONS = {
  creacion_cliente: definition('cliente', 'cliente', [], ['activo']),
  modificacion_cliente: definition('cliente', 'cliente'),
  ocultamiento_cliente: definition('cliente', 'cliente', ['activo'], ['activo']),
  restauracion_cliente: definition('cliente', 'cliente', ['activo'], ['activo']),
  configuracion_credito: definition('credito', 'configuracion_credito'),
  creacion_producto: definition('producto', 'producto', [], ['activo']),
  modificacion_producto: definition('producto', 'producto'),
  ocultamiento_producto: definition('producto', 'producto', ['activo'], ['activo']),
  restauracion_producto: definition('producto', 'producto', ['activo'], ['activo']),
  ajuste_stock: definition('inventario', 'producto', ['stock'], ['stock']),
  ajuste_inventario_solicitado: definition(
    'inventario',
    'ajuste_inventario',
    [],
    [],
    ['tipoAjuste', 'motivoCodigo']
  ),
  ajuste_inventario_aplicado: definition(
    'inventario',
    'ajuste_inventario',
    ['stockFisico', 'stockVendible'],
    ['stockFisico', 'stockVendible'],
    ['tipoAjuste', 'motivoCodigo', 'clasificacionInventario']
  ),
  ajuste_inventario_rechazado: definition(
    'inventario',
    'producto',
    [],
    [],
    ['tipoAjuste', 'motivoCodigo']
  ),
  ajuste_inventario_fallido: definition(
    'inventario',
    'producto',
    [],
    [],
    ['tipoAjuste', 'motivoCodigo']
  ),
  conciliacion_inventario_consultada: definition(
    'inventario',
    'conciliacion_inventario'
  ),
  consulta_sugerencias_compra: definition('inventario', 'sugerencia_compra'),
  exportacion_rotacion_inventario: definition(
    'exportacion', 'inventario', [], [], ['formato', 'tipoExportacion', 'filas']
  ),
  exportacion_alertas_inventario: definition(
    'exportacion', 'inventario', [], [], ['formato', 'tipoExportacion', 'filas']
  ),
  configuracion_lotes: definition('inventario', 'producto'),
  distribucion_lotes: definition('inventario', 'producto'),
  registro_compra: definition('inventario', 'compra'),
  registro_venta: definition('venta', 'venta', [], ['estadoOperacion', 'estadoPago']),
  ocultamiento_fiado: definition('credito', 'fiado', ['activo'], ['activo']),
  restauracion_fiado: definition('credito', 'fiado', ['activo'], ['activo']),
  registro_pago_fiado: definition('cobranza', 'cobro_fiado', [], [], ['metodoPago']),
  actualizacion_promesa_pago: definition('cobranza', 'fiado'),
  registro_seguimiento_cobranza: definition('cobranza', 'seguimiento_cobranza'),
  creacion_gasto: definition('finanzas', 'gasto', [], ['estado']),
  modificacion_gasto: definition('finanzas', 'gasto'),
  anulacion_gasto: definition('finanzas', 'gasto', ['estado'], ['estado']),
  cierre_caja: definition('finanzas', 'cierre_caja', [], ['estado']),
  anulacion_cierre_caja: definition('finanzas', 'cierre_caja', ['estado'], ['estado']),
  compensacion_venta: definition(
    'compensacion',
    'operacion_compensatoria',
    [],
    ['estadoOperacion'],
    ['tipoOperacion', 'tratamientoInventario']
  ),
  resolucion_liquidacion: definition('compensacion', 'liquidacion_compensacion'),
  compensacion_cobro: definition('compensacion', 'cobro_fiado'),
  correccion_metodo_pago: definition('compensacion', 'pago_venta', [], [], ['metodoPago']),
  liquidacion_reembolso: definition('compensacion', 'liquidacion_reembolso', [], [], ['metodoPago']),
  exportacion_datos: definition('exportacion', 'exportacion', [], [], ['formato', 'tipoExportacion', 'filas'])
};

const AUDIT_ACTIONS = Object.freeze({
  ...BASE_AUDIT_ACTIONS,
  ...COMMERCIAL_AUDIT_ACTIONS
});

const ADMIN_FAILURE_CODES = Object.freeze(['ADMIN_OPERATION_REJECTED', 'ADMIN_OPERATION_FAILED']);
const COMMERCIAL_RESULT_CODES = Object.freeze([
  'COMMERCIAL_OPERATION_OK',
  'COMMERCIAL_OPERATION_REJECTED',
  'COMMERCIAL_OPERATION_FAILED',
  'COMMERCIAL_OPERATION_LIMITED'
]);
const EXPORT_RESULT_CODES = Object.freeze([
  'EXPORT_COMPLETED',
  'EXPORT_REJECTED',
  'EXPORT_FAILED',
  'EXPORT_LIMITED'
]);
const BASE_ACTION_RESULT_CODES = {
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
  registro_publico_solicitado: Object.freeze(['PUBLIC_REGISTRATION_REQUESTED']),
  registro_publico_completado: Object.freeze(['PUBLIC_REGISTRATION_COMPLETED']),
  registro_publico_rechazado: Object.freeze(['PUBLIC_REGISTRATION_REJECTED']),
  registro_publico_fallido: Object.freeze(['PUBLIC_REGISTRATION_FAILED']),
  verificacion_correo_emitida: Object.freeze(['EMAIL_VERIFICATION_ISSUED']),
  reenvio_verificacion_solicitado: Object.freeze(['EMAIL_VERIFICATION_RESEND_REQUESTED']),
  correo_verificado: Object.freeze(['EMAIL_VERIFIED']),
  verificacion_correo_rechazada: Object.freeze(['EMAIL_VERIFICATION_REJECTED']),
  verificacion_correo_entrega_fallida: Object.freeze(['EMAIL_VERIFICATION_DELIVERY_FAILED']),
  recuperacion_password_solicitada: Object.freeze(['PASSWORD_RECOVERY_REQUESTED']),
  token_recuperacion_emitido: Object.freeze(['PASSWORD_RECOVERY_TOKEN_ISSUED']),
  recuperacion_password_completada: Object.freeze(['PASSWORD_RESET_COMPLETED']),
  token_recuperacion_rechazado: Object.freeze(['PASSWORD_RECOVERY_TOKEN_REJECTED']),
  recuperacion_entrega_fallida: Object.freeze(['PASSWORD_RECOVERY_DELIVERY_FAILED']),
  onboarding_iniciado: Object.freeze(['ONBOARDING_STARTED']),
  onboarding_progreso_guardado: Object.freeze(['ONBOARDING_PROGRESS_SAVED']),
  onboarding_completado: Object.freeze(['ONBOARDING_COMPLETED']),
  onboarding_rechazado: Object.freeze(['ONBOARDING_REJECTED', 'ONBOARDING_FAILED']),
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
  reactivacion_suscripcion: Object.freeze(['SUBSCRIPTION_REACTIVATED', ...ADMIN_FAILURE_CODES]),
  cancelacion_suscripcion: Object.freeze(['SUBSCRIPTION_CANCELLED', ...ADMIN_FAILURE_CODES])
};
const INVENTORY_ACTION_RESULT_CODES = Object.freeze({
  ajuste_inventario_solicitado: Object.freeze(['INVENTORY_ADJUSTMENT_REQUESTED']),
  ajuste_inventario_aplicado: Object.freeze(['INVENTORY_ADJUSTMENT_APPLIED']),
  ajuste_inventario_rechazado: Object.freeze(['INVENTORY_ADJUSTMENT_REJECTED']),
  ajuste_inventario_fallido: Object.freeze(['INVENTORY_ADJUSTMENT_FAILED']),
  conciliacion_inventario_consultada: Object.freeze(['INVENTORY_RECONCILIATION_READ']),
  consulta_sugerencias_compra: Object.freeze(['INVENTORY_SUGGESTIONS_READ']),
  exportacion_rotacion_inventario: Object.freeze(['EXPORT_COMPLETED', 'EXPORT_REJECTED', 'EXPORT_FAILED', 'EXPORT_LIMITED']),
  exportacion_alertas_inventario: Object.freeze(['EXPORT_COMPLETED', 'EXPORT_REJECTED', 'EXPORT_FAILED', 'EXPORT_LIMITED'])
});
const AUDIT_ACTION_RESULT_CODES = Object.freeze({
  ...BASE_ACTION_RESULT_CODES,
  ...Object.fromEntries(
    Object.keys(COMMERCIAL_AUDIT_ACTIONS).map((action) => [
      action,
      INVENTORY_ACTION_RESULT_CODES[action]
        || (action === 'exportacion_datos' ? EXPORT_RESULT_CODES : COMMERCIAL_RESULT_CODES)
    ])
  )
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
  'PUBLIC_REGISTRATION_REQUESTED',
  'PUBLIC_REGISTRATION_COMPLETED',
  'PUBLIC_REGISTRATION_REJECTED',
  'PUBLIC_REGISTRATION_FAILED',
  'EMAIL_VERIFICATION_ISSUED',
  'EMAIL_VERIFICATION_RESEND_REQUESTED',
  'EMAIL_VERIFIED',
  'EMAIL_VERIFICATION_REJECTED',
  'EMAIL_VERIFICATION_DELIVERY_FAILED',
  'PASSWORD_RECOVERY_REQUESTED',
  'PASSWORD_RECOVERY_TOKEN_ISSUED',
  'PASSWORD_RESET_COMPLETED',
  'PASSWORD_RECOVERY_TOKEN_REJECTED',
  'PASSWORD_RECOVERY_DELIVERY_FAILED',
  'ONBOARDING_STARTED',
  'ONBOARDING_PROGRESS_SAVED',
  'ONBOARDING_COMPLETED',
  'ONBOARDING_REJECTED',
  'ONBOARDING_FAILED',
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
  'SUBSCRIPTION_REACTIVATED',
  'SUBSCRIPTION_CANCELLED',
  'ADMIN_OPERATION_REJECTED',
  'ADMIN_OPERATION_FAILED',
  ...COMMERCIAL_RESULT_CODES,
  ...EXPORT_RESULT_CODES,
  'INVENTORY_ADJUSTMENT_REQUESTED',
  'INVENTORY_ADJUSTMENT_APPLIED',
  'INVENTORY_ADJUSTMENT_REJECTED',
  'INVENTORY_ADJUSTMENT_FAILED',
  'INVENTORY_RECONCILIATION_READ',
  'INVENTORY_SUGGESTIONS_READ'
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
  PUBLIC_REGISTRATION_REQUESTED: Object.freeze(['correcto']),
  PUBLIC_REGISTRATION_COMPLETED: Object.freeze(['correcto']),
  PUBLIC_REGISTRATION_REJECTED: Object.freeze(['rechazado']),
  PUBLIC_REGISTRATION_FAILED: Object.freeze(['fallido']),
  EMAIL_VERIFICATION_ISSUED: Object.freeze(['correcto']),
  EMAIL_VERIFICATION_RESEND_REQUESTED: Object.freeze(['correcto']),
  EMAIL_VERIFIED: Object.freeze(['correcto']),
  EMAIL_VERIFICATION_REJECTED: Object.freeze(['rechazado']),
  EMAIL_VERIFICATION_DELIVERY_FAILED: Object.freeze(['fallido']),
  PASSWORD_RECOVERY_REQUESTED: Object.freeze(['correcto']),
  PASSWORD_RECOVERY_TOKEN_ISSUED: Object.freeze(['correcto']),
  PASSWORD_RESET_COMPLETED: Object.freeze(['correcto']),
  PASSWORD_RECOVERY_TOKEN_REJECTED: Object.freeze(['rechazado']),
  PASSWORD_RECOVERY_DELIVERY_FAILED: Object.freeze(['fallido']),
  ONBOARDING_STARTED: Object.freeze(['correcto']),
  ONBOARDING_PROGRESS_SAVED: Object.freeze(['correcto']),
  ONBOARDING_COMPLETED: Object.freeze(['correcto']),
  ONBOARDING_REJECTED: Object.freeze(['rechazado']),
  ONBOARDING_FAILED: Object.freeze(['fallido']),
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
  SUBSCRIPTION_REACTIVATED: Object.freeze(['correcto']),
  SUBSCRIPTION_CANCELLED: Object.freeze(['correcto']),
  ADMIN_OPERATION_REJECTED: Object.freeze(['rechazado']),
  ADMIN_OPERATION_FAILED: Object.freeze(['fallido']),
  COMMERCIAL_OPERATION_OK: Object.freeze(['correcto']),
  COMMERCIAL_OPERATION_REJECTED: Object.freeze(['rechazado']),
  COMMERCIAL_OPERATION_FAILED: Object.freeze(['fallido']),
  COMMERCIAL_OPERATION_LIMITED: Object.freeze(['limitado']),
  EXPORT_COMPLETED: Object.freeze(['correcto']),
  EXPORT_REJECTED: Object.freeze(['rechazado']),
  EXPORT_FAILED: Object.freeze(['fallido']),
  EXPORT_LIMITED: Object.freeze(['limitado']),
  INVENTORY_ADJUSTMENT_REQUESTED: Object.freeze(['correcto']),
  INVENTORY_ADJUSTMENT_APPLIED: Object.freeze(['correcto']),
  INVENTORY_ADJUSTMENT_REJECTED: Object.freeze(['rechazado']),
  INVENTORY_ADJUSTMENT_FAILED: Object.freeze(['fallido']),
  INVENTORY_RECONCILIATION_READ: Object.freeze(['correcto']),
  INVENTORY_SUGGESTIONS_READ: Object.freeze(['correcto'])
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
