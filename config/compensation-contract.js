const COMPENSATION_FEATURE = 'anulaciones_operativas';

const COMPENSATION_TYPES = Object.freeze([
  'anulacion_venta',
  'devolucion_venta',
  'correccion_pago_venta',
  'anulacion_fiado',
  'anulacion_cobro_fiado',
  'correccion_saldo'
]);

const COMPENSATION_STATES = Object.freeze([
  'solicitada',
  'pendiente_aprobacion',
  'aprobada',
  'aplicada',
  'rechazada',
  'fallida',
  'cancelada'
]);

const TERMINAL_COMPENSATION_STATES = Object.freeze([
  'aplicada',
  'rechazada',
  'cancelada'
]);

const COMPENSATION_REASONS = Object.freeze([
  'error_cantidad',
  'error_producto',
  'error_cliente',
  'error_metodo_pago',
  'operacion_duplicada',
  'devolucion_cliente',
  'mercaderia_danada',
  'otro_controlado'
]);

const SALE_OPERATION_STATES = Object.freeze([
  'vigente',
  'devuelta_parcial',
  'anulada'
]);

const OPERATION_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const REQUEST_FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/;

function isAllowed(value, allowlist) {
  return allowlist.includes(String(value || ''));
}

module.exports = {
  COMPENSATION_FEATURE,
  COMPENSATION_REASONS,
  COMPENSATION_STATES,
  COMPENSATION_TYPES,
  OPERATION_KEY_PATTERN,
  REQUEST_FINGERPRINT_PATTERN,
  SALE_OPERATION_STATES,
  TERMINAL_COMPENSATION_STATES,
  isCompensationReason: (value) => isAllowed(value, COMPENSATION_REASONS),
  isCompensationState: (value) => isAllowed(value, COMPENSATION_STATES),
  isCompensationType: (value) => isAllowed(value, COMPENSATION_TYPES),
  isSaleOperationState: (value) => isAllowed(value, SALE_OPERATION_STATES)
};
