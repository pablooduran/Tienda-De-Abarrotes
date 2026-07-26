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

const SALE_COMPENSATION_TYPES = Object.freeze([
  'anulacion_total',
  'devolucion_parcial'
]);

const INVENTORY_RETURN_TREATMENTS = Object.freeze([
  'reintegrar_vendible',
  'no_reintegrar',
  'aislar_no_vendible'
]);

const INVENTORY_RETURN_RESULTS = Object.freeze([
  'reintegrado_stock',
  'reintegrado_lote_original',
  'aislado_lote_tecnico',
  'aislado_no_vendible',
  'no_reintegrado'
]);

const SALE_SETTLEMENT_STATES = Object.freeze([
  'sin_efecto',
  'pendiente_c3',
  'resuelta'
]);

const COLLECTION_COMPENSATION_TYPES = Object.freeze([
  'anulacion_total',
  'correccion_metodo'
]);

const COLLECTION_OPERATION_STATES = Object.freeze([
  'vigente',
  'compensado'
]);

const REFUND_OBLIGATION_STATES = Object.freeze([
  'pendiente',
  'reembolsado',
  'credito_a_favor',
  'compensado'
]);

const MATERIAL_SETTLEMENT_TYPES = Object.freeze([
  'reembolso_realizado',
  'compensacion_otro_medio'
]);

const COLLECTION_PAYMENT_METHODS = Object.freeze([
  'efectivo',
  'qr',
  'transferencia',
  'tarjeta',
  'otro',
  'no_especificado'
]);

const SALE_PAYMENT_METHODS = Object.freeze([
  'efectivo',
  'qr',
  'no_especificado'
]);

const OPERATION_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const REQUEST_FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/;

function isAllowed(value, allowlist) {
  return allowlist.includes(String(value || ''));
}

module.exports = {
  COLLECTION_COMPENSATION_TYPES,
  COLLECTION_OPERATION_STATES,
  COLLECTION_PAYMENT_METHODS,
  COMPENSATION_FEATURE,
  COMPENSATION_REASONS,
  COMPENSATION_STATES,
  COMPENSATION_TYPES,
  INVENTORY_RETURN_RESULTS,
  INVENTORY_RETURN_TREATMENTS,
  MATERIAL_SETTLEMENT_TYPES,
  OPERATION_KEY_PATTERN,
  REQUEST_FINGERPRINT_PATTERN,
  REFUND_OBLIGATION_STATES,
  SALE_COMPENSATION_TYPES,
  SALE_OPERATION_STATES,
  SALE_PAYMENT_METHODS,
  SALE_SETTLEMENT_STATES,
  TERMINAL_COMPENSATION_STATES,
  isCompensationReason: (value) => isAllowed(value, COMPENSATION_REASONS),
  isCompensationState: (value) => isAllowed(value, COMPENSATION_STATES),
  isCompensationType: (value) => isAllowed(value, COMPENSATION_TYPES),
  isInventoryReturnTreatment: (value) => isAllowed(value, INVENTORY_RETURN_TREATMENTS),
  isSaleCompensationType: (value) => isAllowed(value, SALE_COMPENSATION_TYPES),
  isSaleOperationState: (value) => isAllowed(value, SALE_OPERATION_STATES)
};
