const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { EVENTS } = require('../config/product-analytics');
const {
  createAnalytics,
  createBusinessAnalytics,
  createMemoryAdapter
} = require('../services/product-analytics');

const root = path.join(__dirname, '..');
const memory = createMemoryAdapter();
const analytics = createAnalytics(memory);
const business = createBusinessAnalytics(analytics);

function count(eventName) {
  return memory.events.filter((event) => event.eventName === eventName).length;
}

function assertPostCommit(file, call) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  const callIndex = source.indexOf(call);
  assert(callIndex >= 0, `${file} debe contener ${call}.`);
  const commitIndex = source.lastIndexOf('await connection.commit();', callIndex);
  assert(commitIndex >= 0 && commitIndex < callIndex, `${call} debe ejecutarse despues del commit.`);
}

assert.strictEqual(business.accountRegistered({ created: true, plan: 'basico' }), true);
assert.strictEqual(count('account_registered'), 1);
assert.strictEqual(business.accountRegistered({ created: false, plan: 'basico' }), false);
assert.strictEqual(business.accountRegistered({ created: true, replayed: true, plan: 'basico' }), false);
assert.strictEqual(count('account_registered'), 1, 'Registro fallido o replay no debe duplicar el evento.');

assert.strictEqual(business.emailVerified({ changed: true }), true);
assert.strictEqual(business.emailVerified({ changed: false }), false);
assert.strictEqual(count('email_verified'), 1, 'La verificacion repetida no debe emitir otro evento.');

assert.strictEqual(business.storeConfigured({ completed: true, repeated: false }), true);
assert.strictEqual(business.storeConfigured({ completed: true, repeated: true }), false);
assert.strictEqual(count('store_configured'), 1, 'Completar onboarding de nuevo no debe duplicar el evento.');

assert.strictEqual(business.stockRegistered({ registered: true, mode: 'manual_adjustment' }), true);
assert.strictEqual(business.stockRegistered({ registered: false, mode: 'manual_adjustment' }), false);
assert.strictEqual(business.stockRegistered({ registered: true, repeated: true }), false);
assert.strictEqual(count('stock_registered'), 1, 'Fallo o replay de stock no debe emitir otro evento.');

assert.strictEqual(business.saleCompleted({ completed: true, paymentMode: 'paid', currency: 'BOB' }), true);
assert.strictEqual(business.saleCompleted({ completed: false, paymentMode: 'paid', currency: 'BOB' }), false);
assert.strictEqual(business.saleCompleted({ completed: true, repeated: true, paymentMode: 'paid' }), false);
assert.strictEqual(count('sale_completed'), 1, 'Rollback o replay de venta no debe emitir otro evento.');

const saleEvent = memory.events.find((event) => event.eventName === 'sale_completed');
assert.deepStrictEqual(saleEvent.properties, { module: 'pos', paymentMode: 'paid', currency: 'BOB' });
const serializedProperties = JSON.stringify(memory.events.map((event) => event.properties));
assert(!serializedProperties.match(/idTienda|tenant|correo|email|nombre|telefono|monto|cantidad|requestId/i),
  'Los eventos de negocio no deben contener PII, tenant, IDs ni datos comerciales.');

const failingBusiness = createBusinessAnalytics({ track: () => { throw new Error('adapter failure'); } });
assert.doesNotThrow(() => failingBusiness.saleCompleted({ completed: true, paymentMode: 'paid' }));

assertPostCommit('services/public-registration-service.js', 'analytics.accountRegistered');
assertPostCommit('services/email-verification-service.js', 'analytics.emailVerified');
assertPostCommit('services/onboarding-service.js', 'analytics.storeConfigured');
assertPostCommit('services/inventory-adjustment-service.js', 'analytics.stockRegistered');
assertPostCommit('services/pos-sale-service.js', 'analytics.saleCompleted');

const productRoute = fs.readFileSync(path.join(root, 'routes/api.js'), 'utf8');
assert(EVENTS.product_created, 'El contrato product_created debe preservarse para instrumentacion futura.');
assert(!productRoute.includes('analytics.productCreated'),
  'Producto no debe instrumentarse sin distinguir de forma segura una creacion nueva de un retry.');
assert(!JSON.stringify(memory.events).includes('subscription_cancelled'));
assert(!EVENTS.aha_moment, 'El Aha Moment se deriva del funnel y no es un evento propio.');

console.log('test:product-analytics-business OK');
