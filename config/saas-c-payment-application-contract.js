const { idempotencyKey, requestReference } = require('./saas-c-payment-request-contract');

function applicationBody(body) {
  const source = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  if (Object.keys(source).length) {
    const error = new Error('La aplicacion no acepta campos del frontend.');
    error.status = 400;
    error.code = 'PAYMENT_APPLICATION_FIELDS_NOT_ALLOWED';
    throw error;
  }
  return Object.freeze({});
}

module.exports = { applicationBody, idempotencyKey, requestReference };
