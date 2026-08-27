const assert = require('assert');
const express = require('express');
const { createPaymentSubscriptionsRouter } = require('../routes/payment-subscriptions');
const { createAdminPaymentReviewsRouter } = require('../routes/admin-payment-reviews');

const DISABLED_CODE = 'PAYMENT_RECEIPTS_DISABLED';
const DISABLED_MESSAGE = 'Los comprobantes manuales de suscripcion no estan disponibles en este entorno.';

function forbiddenService() {
  return new Proxy({}, {
    get() {
      throw new Error('Una ruta bloqueada no debe invocar servicios de comprobantes.');
    }
  });
}

async function start(router, mount) {
  const app = express();
  app.use((req, res, next) => {
    req.requestId = 'synthetic-request';
    req.auth = { idAdministrador: 1 };
    req.tenant = { idTienda: 1 };
    req.subscriptionContext = { suscripcion: { idSuscripcion: 1 } };
    next();
  });
  app.use(mount, router);
  const server = await new Promise((resolve, reject) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
    listener.once('error', reject);
  });
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  };
}

async function assertDisabled(baseUrl, path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, options);
  const body = await response.json();
  assert.strictEqual(response.status, 503);
  assert.deepStrictEqual(body, {
    error: DISABLED_MESSAGE,
    code: DISABLED_CODE,
    requestId: 'synthetic-request'
  });
}

async function main() {
  const owner = await start(createPaymentSubscriptionsRouter({
    receiptsEnabled: false,
    receiptService: forbiddenService()
  }), '/api/pagos-suscripcion');
  try {
    await assertDisabled(owner.baseUrl, '/api/pagos-suscripcion/solicitudes/reference/comprobantes');
    await assertDisabled(owner.baseUrl, '/api/pagos-suscripcion/solicitudes/reference/comprobantes', { method: 'POST' });
    await assertDisabled(owner.baseUrl, '/api/pagos-suscripcion/solicitudes/reference/comprobantes/receipt');
  } finally {
    await owner.close();
  }

  const admin = await start(createAdminPaymentReviewsRouter({
    receiptsEnabled: false,
    service: forbiddenService(),
    applicationService: forbiddenService()
  }), '/api/admin/pagos-suscripcion/revision');
  try {
    await assertDisabled(admin.baseUrl, '/api/admin/pagos-suscripcion/revision');
    await assertDisabled(admin.baseUrl, '/api/admin/pagos-suscripcion/revision/reference');
    await assertDisabled(admin.baseUrl, '/api/admin/pagos-suscripcion/revision/reference/comprobante');
    await assertDisabled(admin.baseUrl, '/api/admin/pagos-suscripcion/revision/reference/aplicar', { method: 'POST' });
  } finally {
    await admin.close();
  }
  console.log('test:payment-receipts-disabled OK');
}

main().catch((error) => {
  console.error(`test:payment-receipts-disabled FAIL: ${error.message}`);
  process.exitCode = 1;
});
