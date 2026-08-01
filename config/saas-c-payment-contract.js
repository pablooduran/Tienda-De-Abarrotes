const PUBLIC_PLAN_CODES = Object.freeze(['basico', 'standard', 'pro']);
const LEGACY_PLAN_CODES = Object.freeze(['avanzado']);
const PAYMENT_PERIODS = Object.freeze({
  mensual: Object.freeze({ months: 1 }),
  trimestral: Object.freeze({ months: 3 }),
  anual: Object.freeze({ months: 12 })
});
const PAYMENT_REQUEST_STATES = Object.freeze([
  'pendiente_comprobante',
  'pendiente_revision',
  'observada',
  'rechazada',
  'aplicada',
  'cancelada',
  'vencida'
]);
const OPEN_PAYMENT_REQUEST_STATES = Object.freeze([
  'pendiente_comprobante',
  'pendiente_revision',
  'observada'
]);
const PAYMENT_OPERATIONS = Object.freeze([
  'renovacion',
  'reactivacion',
  'nueva_activacion',
  'upgrade'
]);
const PAYMENT_METHOD_CODES = Object.freeze([
  'qr_manual',
  'transferencia_deposito',
  'efectivo_administrativo'
]);
const PAYMENT_HISTORY_EVENTS = Object.freeze([
  'creada',
  'comprobante_cargado',
  'comprobante_reemplazado',
  'enviada_revision',
  'observada',
  'corregida',
  'rechazada',
  'aplicada',
  'cancelada',
  'vencida'
]);
const COMMERCIAL_CURRENCIES = Object.freeze({ base: 'USD', charge: 'BOB' });
const PAYMENT_REQUEST_TTL_HOURS = 72;

const PLAN_CATALOG = Object.freeze({
  basico: Object.freeze({
    name: 'Basic',
    order: 10,
    limits: Object.freeze({ owners: 1, products: 500, customers: 25, suppliers: 15 }),
    pricesUsd: Object.freeze({ mensual: 3, trimestral: 8.25, anual: 30 })
  }),
  standard: Object.freeze({
    name: 'Standard',
    order: 20,
    limits: Object.freeze({ owners: 3, products: 1200, customers: 70, suppliers: 50 }),
    pricesUsd: Object.freeze({ mensual: 6, trimestral: 16.5, anual: 60 })
  }),
  pro: Object.freeze({
    name: 'Pro',
    order: 30,
    limits: Object.freeze({ owners: null, products: null, customers: null, suppliers: null }),
    pricesUsd: Object.freeze({ mensual: 10, trimestral: 27.5, anual: 100 })
  })
});

const BASIC_FEATURES = Object.freeze([
  'ajuste_stock',
  'alertas_stock',
  'anulaciones_operativas',
  'catalogo_maestro',
  'clientes_basico',
  'dashboard_financiero',
  'estado_cuenta_basico',
  'fiados_basico',
  'gastos',
  'historial_stock',
  'inventario_resumen',
  'pagos_fiado',
  'pagos_multiples',
  'punto_venta',
  'ranking_productos',
  'recibos_whatsapp',
  'reportes_financieros',
  'valor_inventario_basico'
]);
const STANDARD_FEATURES = Object.freeze([
  ...BASIC_FEATURES,
  'cierre_caja',
  'compras_sugeridas',
  'dias_cobertura',
  'exportacion_clientes_fiados',
  'exportacion_inventario',
  'exportacion_reportes',
  'inventario_sin_movimiento',
  'limites_credito',
  'recordatorios_fiado',
  'rentabilidad_producto',
  'rotacion_inventario',
  'segmentacion_clientes',
  'seguimiento_cobranza'
]);
const PRO_FEATURES = Object.freeze([
  ...STANDARD_FEATURES,
  'alertas_vencimiento',
  'control_lotes',
  'exportacion_lotes',
  'trazabilidad_lotes',
  'vencimientos_lote'
]);
const EXCLUDED_PUBLIC_FEATURES = Object.freeze(['portal_clientes', 'reportes_avanzados']);

module.exports = {
  BASIC_FEATURES,
  COMMERCIAL_CURRENCIES,
  EXCLUDED_PUBLIC_FEATURES,
  LEGACY_PLAN_CODES,
  OPEN_PAYMENT_REQUEST_STATES,
  PAYMENT_HISTORY_EVENTS,
  PAYMENT_METHOD_CODES,
  PAYMENT_OPERATIONS,
  PAYMENT_PERIODS,
  PAYMENT_REQUEST_STATES,
  PAYMENT_REQUEST_TTL_HOURS,
  PLAN_CATALOG,
  PRO_FEATURES,
  PUBLIC_PLAN_CODES,
  STANDARD_FEATURES
};
