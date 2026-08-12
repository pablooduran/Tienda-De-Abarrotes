const {
  PAYMENT_METHOD_CODES,
  PAYMENT_PERIODS,
  PAYMENT_REQUEST_STATES,
  PUBLIC_PLAN_CODES
} = require('./saas-c-payment-contract');

const OWNER_PAYMENT_OPERATIONS = Object.freeze(['renovacion', 'reactivacion', 'upgrade']);
const OWNER_CANCELLABLE_STATES = Object.freeze(['pendiente_comprobante']);
const REQUEST_REFERENCE_PATTERN = /^[A-Za-z0-9_-]{32,64}$/;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$/;
const LOCAL_DATETIME_PATTERN = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2})?$/;
const DECIMAL_RATE_PATTERN = /^(?:0|[1-9]\d{0,9})(?:\.\d{1,8})?$/;

function inputError(message, code = 'INVALID_PAYMENT_REQUEST_INPUT') {
  const error = new Error(message);
  error.status = 400;
  error.code = code;
  return error;
}

function sourceObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw inputError('La solicitud no tiene un formato valido.');
  }
  return value;
}

function onlyFields(source, allowed, code = 'PAYMENT_REQUEST_FIELDS_NOT_ALLOWED') {
  const unknown = Object.keys(source).filter((key) => !allowed.includes(key));
  if (unknown.length) throw inputError('La solicitud contiene campos no permitidos.', code);
}

function code(value, allowed, label) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!/^[a-z][a-z0-9_-]{1,79}$/.test(normalized) || (allowed && !allowed.includes(normalized))) {
    throw inputError(`${label} no es valido.`);
  }
  return normalized;
}

function booleanValue(value, label) {
  if (value !== true && value !== false) throw inputError(`${label} debe ser verdadero o falso.`);
  return value;
}

function safeText(value, label, { min = 1, max = 120, nullable = false } = {}) {
  if (nullable && (value === null || value === undefined || value === '')) return null;
  const normalized = String(value || '').trim().replace(/\r\n?/g, '\n');
  if (normalized.length < min || normalized.length > max || /[<>\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(normalized)) {
    throw inputError(`${label} no es valido.`);
  }
  return normalized;
}

function optionalDateTime(value, label) {
  if (value === undefined || value === null || value === '') return null;
  const normalized = String(value).trim().replace('T', ' ');
  if (!LOCAL_DATETIME_PATTERN.test(normalized)) throw inputError(`${label} no es valida.`);
  return normalized;
}

function positivePage(value, fallback, maximum) {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw inputError('La paginacion no es valida.');
  }
  return parsed;
}

function idempotencyKey(value) {
  const normalized = String(value || '').trim();
  if (!IDEMPOTENCY_KEY_PATTERN.test(normalized)) {
    throw inputError('La clave de operacion no es valida.', 'INVALID_OPERATION_KEY');
  }
  return normalized;
}

function requestReference(value) {
  const normalized = String(value || '').trim();
  if (!REQUEST_REFERENCE_PATTERN.test(normalized)) {
    throw inputError('La referencia de solicitud no es valida.', 'INVALID_PAYMENT_REQUEST_REFERENCE');
  }
  return normalized;
}

function quoteBody(body) {
  const source = sourceObject(body);
  onlyFields(source, ['plan', 'periodo', 'operacion', 'metodo']);
  return Object.freeze({
    plan: code(source.plan, PUBLIC_PLAN_CODES, 'El plan'),
    periodo: code(source.periodo, Object.keys(PAYMENT_PERIODS), 'El periodo'),
    operacion: code(source.operacion, OWNER_PAYMENT_OPERATIONS, 'La operacion'),
    metodo: code(source.metodo, PAYMENT_METHOD_CODES, 'El metodo de pago')
  });
}

function exchangeRateBody(body) {
  const source = sourceObject(body);
  onlyFields(source, ['valor', 'fuente', 'fechaEfectiva', 'vigenteDesde'], 'EXCHANGE_RATE_FIELDS_NOT_ALLOWED');
  const value = String(source.valor || '').trim();
  if (!DECIMAL_RATE_PATTERN.test(value) || /^0(?:\.0+)?$/.test(value)) {
    throw inputError('El valor del tipo de cambio debe ser positivo.', 'INVALID_EXCHANGE_RATE');
  }
  return Object.freeze({
    valor: value,
    fuente: safeText(source.fuente, 'La fuente', { min: 2, max: 120 }),
    fechaEfectiva: optionalDateTime(source.fechaEfectiva, 'La fecha efectiva'),
    vigenteDesde: optionalDateTime(source.vigenteDesde, 'La fecha de vigencia')
  });
}

function paymentMethodBody(body) {
  const source = sourceObject(body);
  onlyFields(source, ['activo', 'visiblePropietario', 'instrucciones'], 'PAYMENT_METHOD_FIELDS_NOT_ALLOWED');
  return Object.freeze({
    activo: booleanValue(source.activo, 'El estado activo'),
    visiblePropietario: booleanValue(source.visiblePropietario, 'La visibilidad'),
    instrucciones: safeText(source.instrucciones, 'Las instrucciones', { max: 500, nullable: true })
  });
}

function listQuery(query = {}) {
  onlyFields(query, ['estado', 'orden', 'pagina', 'limite'], 'PAYMENT_REQUEST_FILTERS_NOT_ALLOWED');
  const state = query.estado === undefined || query.estado === ''
    ? null
    : code(query.estado, PAYMENT_REQUEST_STATES, 'El estado');
  const order = query.orden === undefined || query.orden === ''
    ? 'recientes'
    : code(query.orden, ['recientes', 'antiguas', 'vencimiento'], 'El orden');
  return Object.freeze({
    estado: state,
    orden: order,
    pagina: positivePage(query.pagina, 1, 100000),
    limite: positivePage(query.limite, 20, 100)
  });
}

function exchangeRateQuery(query = {}) {
  onlyFields(query, ['pagina', 'limite'], 'EXCHANGE_RATE_FILTERS_NOT_ALLOWED');
  return Object.freeze({
    pagina: positivePage(query.pagina, 1, 100000),
    limite: positivePage(query.limite, 20, 100)
  });
}

function emptyQuery(query = {}, codeValue = 'PAYMENT_QUERY_FIELDS_NOT_ALLOWED') {
  onlyFields(query, [], codeValue);
  return Object.freeze({});
}

function methodReference(value) {
  return code(value, PAYMENT_METHOD_CODES, 'El metodo de pago');
}

module.exports = {
  OWNER_CANCELLABLE_STATES,
  OWNER_PAYMENT_OPERATIONS,
  exchangeRateBody,
  exchangeRateQuery,
  emptyQuery,
  idempotencyKey,
  listQuery,
  methodReference,
  paymentMethodBody,
  quoteBody,
  requestReference
};
