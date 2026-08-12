const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  OWNER_CANCELLABLE_STATES,
  exchangeRateBody,
  idempotencyKey,
  paymentMethodBody,
  quoteBody,
  requestReference
} = require('../config/saas-c-payment-request-contract');
const { convertedAmount } = require('../services/saas-c-payment-service');

function rejects(action, code) {
  assert.throws(action, (error) => error.code === code);
}

function source(file) {
  return fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
}

function main() {
  assert.deepStrictEqual(OWNER_CANCELLABLE_STATES, ['pendiente_comprobante']);
  assert.deepStrictEqual(quoteBody({
    plan: 'standard', periodo: 'trimestral', operacion: 'upgrade', metodo: 'qr_manual'
  }), {
    plan: 'standard', periodo: 'trimestral', operacion: 'upgrade', metodo: 'qr_manual'
  });
  rejects(() => quoteBody({
    plan: 'basico', periodo: 'mensual', operacion: 'renovacion', metodo: 'qr_manual', idTienda: 9
  }), 'PAYMENT_REQUEST_FIELDS_NOT_ALLOWED');
  rejects(() => quoteBody({
    plan: 'avanzado', periodo: 'mensual', operacion: 'renovacion', metodo: 'qr_manual'
  }), 'INVALID_PAYMENT_REQUEST_INPUT');
  rejects(() => quoteBody({
    plan: 'basico', periodo: 'mensual', operacion: 'downgrade', metodo: 'qr_manual'
  }), 'INVALID_PAYMENT_REQUEST_INPUT');
  rejects(() => exchangeRateBody({ valor: '0', fuente: 'Prueba local' }), 'INVALID_EXCHANGE_RATE');
  rejects(() => exchangeRateBody({ valor: '7.0', fuente: '<script>' }), 'INVALID_PAYMENT_REQUEST_INPUT');
  rejects(() => paymentMethodBody({
    activo: true, visiblePropietario: true, instrucciones: '<b>dato</b>'
  }), 'INVALID_PAYMENT_REQUEST_INPUT');
  rejects(() => idempotencyKey('corta'), 'INVALID_OPERATION_KEY');
  rejects(() => requestReference('123'), 'INVALID_PAYMENT_REQUEST_REFERENCE');
  assert.strictEqual(convertedAmount('3.00', '7.00000000'), '21.00');
  assert.strictEqual(convertedAmount('8.25', '7.00000000'), '57.75');
  assert.strictEqual(convertedAmount('3.00', '6.66666667'), '20.00');

  const ownerRoutes = source('routes/payment-subscriptions.js');
  const adminRoutes = source('routes/admin-payment-subscriptions.js');
  const server = source('server.js');
  const service = source('services/saas-c-payment-service.js');
  assert(ownerRoutes.includes('req.tenant.idTienda'));
  assert(ownerRoutes.includes('req.subscriptionContext'));
  assert(!/req\.(body|query|params)\.idTienda/.test(ownerRoutes));
  assert(server.includes("'/api/pagos-suscripcion'"));
  assert(server.includes("'/api/admin/pagos-suscripcion'"));
  assert(server.includes("requireRole('superadmin')"));
  assert(!/precio\s*:\s*req\.body|monto\s*:\s*req\.body|tasa\s*:\s*req\.body/.test(service));
  assert(!/resultadoReferencia[^\n]*clave|claveHash[^\n]*res\.json/.test(`${ownerRoutes}\n${adminRoutes}\n${service}`));
  assert(service.includes("WHERE idTienda=? AND referenciaPublica=?"));
  assert(service.includes("WHERE idTienda=? AND idSuscripcion=?"));
  assert(service.includes("actorTipo: 'superadmin'"));
  assert(service.includes("alcance: 'registrar_tipo_cambio'"));
  assert(service.includes("alcance: 'configurar_metodo'"));
  assert(service.includes("alcance: 'crear_solicitud'"));
  assert(service.includes("alcance: 'cancelar'"));
  console.log('test:saas-c-payment-request-security OK');
}

try { main(); } catch (error) {
  console.error(`test:saas-c-payment-request-security FAIL: ${error.message}`);
  process.exitCode = 1;
}
