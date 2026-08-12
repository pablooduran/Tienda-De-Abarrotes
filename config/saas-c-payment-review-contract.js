const { requestReference, idempotencyKey } = require('./saas-c-payment-request-contract');

const REVIEW_DECISIONS = Object.freeze(['observada', 'rechazada']);
const REVIEW_STATES = Object.freeze(['pendiente_revision', 'observada']);
const REVIEW_MOTIVES = Object.freeze([
  'comprobante_ilegible',
  'datos_incompletos',
  'monto_incorrecto',
  'metodo_no_valido',
  'otro_controlado'
]);

function reviewBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw inputError('La revision no es valida.');
  const keys = Object.keys(body);
  if (keys.some((key) => !['motivo', 'observacion'].includes(key))) throw inputError('La revision contiene campos no permitidos.');
  const motivo = String(body.motivo || '').trim().toLowerCase();
  if (!REVIEW_MOTIVES.includes(motivo)) throw inputError('El motivo de revision no es valido.');
  const observacion = String(body.observacion || '').trim().replace(/\r\n?/g, '\n');
  if (observacion.length < 4 || observacion.length > 500 || /[<>\u0000-\u001F\u007F]/.test(observacion)) {
    throw inputError('La observacion no es valida.');
  }
  return Object.freeze({ motivo, observacion });
}

function inputError(message, code = 'INVALID_PAYMENT_REVIEW_INPUT') {
  const error = new Error(message); error.status = 400; error.code = code; return error;
}

function reviewQuery(query = {}) {
  const allowed = ['estado', 'orden', 'pagina', 'limite'];
  if (Object.keys(query).some((key) => !allowed.includes(key))) throw inputError('Los filtros no son validos.');
  const estado = query.estado ? String(query.estado).trim().toLowerCase() : null;
  if (estado && !REVIEW_STATES.includes(estado)) throw inputError('El estado no es valido.');
  const orden = query.orden ? String(query.orden).trim().toLowerCase() : 'recientes';
  if (!['recientes', 'vencimiento', 'antiguas'].includes(orden)) throw inputError('El orden no es valido.');
  const pagina = Number(query.pagina || 1); const limite = Number(query.limite || 20);
  if (!Number.isSafeInteger(pagina) || pagina < 1 || !Number.isSafeInteger(limite) || limite < 1 || limite > 100) throw inputError('La paginacion no es valida.');
  return Object.freeze({ estado, orden, pagina, limite });
}

module.exports = { REVIEW_DECISIONS, REVIEW_MOTIVES, REVIEW_STATES, idempotencyKey, requestReference, reviewBody, reviewQuery };
