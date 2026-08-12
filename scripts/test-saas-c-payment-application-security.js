const assert = require('assert');
const fs = require('fs');
const { applicationBody } = require('../config/saas-c-payment-application-contract');

const route = fs.readFileSync(require.resolve('../routes/admin-payment-reviews'), 'utf8');
const service = fs.readFileSync(require.resolve('../services/saas-c-payment-application-service'), 'utf8');
const server = fs.readFileSync(require.resolve('../server'), 'utf8');

assert.deepStrictEqual(applicationBody({}), {});
for (const field of ['idTienda', 'idSuscripcion', 'plan', 'precio', 'tipoCambio', 'monto', 'fechaFin', 'operacion']) {
  assert.throws(
    () => applicationBody({ [field]: 'x' }),
    (error) => error.code === 'PAYMENT_APPLICATION_FIELDS_NOT_ALLOWED'
  );
}
assert(route.includes("router.post('/:reference/aplicar'"));
assert(route.includes('requestReference(req.params.reference)'));
assert(!route.includes('req.query.idTienda'));
assert(!route.includes('req.body.idTienda'));
assert(service.includes("alcance='aplicar'"));
assert(service.includes("estado !== 'pendiente_revision'"));
assert(service.includes('lockStoreAndSubscription'));
assert(service.includes('idTienda=? AND idSolicitudPago=?'));
assert(service.includes("decision,estadoAnterior,estadoNuevo"));
assert(service.includes("'aplicar','pendiente_revision','aplicada'"));
assert(service.includes('PAYMENT_APPLICATION_SNAPSHOT_STALE'));
assert(!service.includes('precioPlanPeriodo'));
assert(!service.includes('tipoCambioSuscripcion'));
assert(!service.includes('planFuncionalidad'));
assert(!service.includes('idempotencyKey: input.idempotencyKey,' + "\n        metadata"));
assert(server.includes("'/api/admin/pagos-suscripcion/revision'"));
assert(server.includes("requireRole('superadmin')"));
assert(server.includes('app.use(mutationProtection'));
assert(server.includes("app.use('/api/admin', rateLimiters.admin)"));
assert(server.includes('app.use(noStoreSensitiveResponses)'));
console.log('SAAS-C5 payment application security checks: PASS');
