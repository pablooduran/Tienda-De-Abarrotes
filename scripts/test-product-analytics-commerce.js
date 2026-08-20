const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { EVENTS } = require('../config/product-analytics');
const {
  createAnalytics,
  createBusinessAnalytics,
  createMemoryAdapter
} = require('../services/product-analytics');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const memory = createMemoryAdapter();
const business = createBusinessAnalytics(createAnalytics(memory));
const count = (eventName) => memory.events.filter((event) => event.eventName === eventName).length;

business.saleCompleted({ completed: true, paymentMode: 'credit', currency: 'BOB' });
business.creditSaleCompleted({ completed: true, currency: 'BOB' });
business.creditSaleCompleted({ completed: false, currency: 'BOB' });
business.creditSaleCompleted({ completed: true, repeated: true, currency: 'BOB' });
assert.strictEqual(count('sale_completed'), 1);
assert.strictEqual(count('credit_sale_completed'), 1,
  'Una venta a credito confirmada debe emitir ambos hechos una sola vez.');

business.collectionCompleted({ completed: true, currency: 'BOB' });
business.collectionCompleted({ completed: false, currency: 'BOB' });
business.collectionCompleted({ completed: true, repeated: true, currency: 'BOB' });
assert.strictEqual(count('collection_completed'), 1,
  'Un cobro fallido o repetido no debe emitir collection_completed.');

business.paymentRequestCreated({
  created: true,
  operation: 'renovacion',
  plan: 'standard',
  currency: 'BOB'
});
business.paymentRequestCreated({
  created: false,
  operation: 'renovacion',
  plan: 'standard',
  currency: 'BOB'
});
business.paymentRequestCreated({
  created: true,
  replayed: true,
  operation: 'renovacion',
  plan: 'standard',
  currency: 'BOB'
});
assert.strictEqual(count('payment_request_created'), 1,
  'Una solicitud abierta reutilizada o un replay no debe emitir otro evento.');

const serialized = JSON.stringify(memory.events);
assert(!/idTienda|tenant|idCliente|idVenta|monto|saldo|nombre|telefono|email|referencia|comprobante/i.test(serialized),
  'Los eventos complementarios no deben contener PII, IDs ni datos financieros.');
assert.deepStrictEqual(
  memory.events.find((event) => event.eventName === 'payment_request_created').properties,
  { module: 'subscription_payments', operation: 'renovacion', plan: 'standard', currency: 'BOB' }
);

const failing = createBusinessAnalytics({ track: () => { throw new Error('adapter failure'); } });
assert.doesNotThrow(() => failing.creditSaleCompleted({ completed: true }));
assert.doesNotThrow(() => failing.collectionCompleted({ completed: true }));
assert.doesNotThrow(() => failing.paymentRequestCreated({ created: true, operation: 'upgrade', plan: 'pro' }));

const saleService = read('services/pos-sale-service.js');
const saleCommit = saleService.indexOf('await connection.commit();');
assert(saleCommit >= 0 && saleCommit < saleService.indexOf('analytics.creditSaleCompleted'),
  'credit_sale_completed debe ejecutarse despues del commit de la venta.');
assert(saleService.includes("completed: balanceCents > 0"),
  'credit_sale_completed debe limitarse a ventas con saldo a credito.');

const collectionService = read('services/debt-collection-service.js');
const collectionEvent = collectionService.indexOf('analytics.collectionCompleted');
assert(collectionEvent > collectionService.indexOf('await connection.commit();'),
  'collection_completed debe ejecutarse despues del commit propio.');
assert(collectionService.includes('repeated: result.repetido'),
  'La cobranza debe usar la senal canonica de replay.');

const paymentService = read('services/saas-c-payment-service.js');
assert(paymentService.indexOf('analytics.paymentRequestCreated')
  > paymentService.indexOf('const result = await withTransaction'),
  'payment_request_created debe ejecutarse despues de cerrar la transaccion.');
assert(paymentService.includes('created: result.created') && paymentService.includes('replayed: result.replayed'),
  'La solicitud debe usar las senales canonicas de creacion y replay.');

const customers = read('routes/customers-credit.js');
assert(EVENTS.customer_created, 'El contrato customer_created debe preservarse.');
assert(!customers.includes('analytics.customerCreated'),
  'customer_created debe seguir pendiente mientras el alta no distinga retries.');

const subscriptionHtml = read('public/subscription.html');
assert(subscriptionHtml.indexOf('/js/product-analytics.js') < subscriptionHtml.indexOf('/js/subscription-ui.js'),
  'Mi plan debe cargar la capa analytics local antes de instrumentar UX.');
const subscriptionUi = read('public/js/subscription-ui.js');
assert(subscriptionUi.includes("ProductAnalytics?.track('plan_viewed'")
  && subscriptionUi.includes("['basico', 'standard', 'pro'].includes(plan)")
  && subscriptionUi.includes('viewedPlans.has(plan)'),
  'plan_viewed debe usar codigos publicos y evitar rerenders evidentes.');
const paymentUi = read('public/js/payment-subscription-ui.js');
const quoteBranch = paymentUi.indexOf("if (action === 'quote')");
const quoteEvent = paymentUi.indexOf("ProductAnalytics?.track('quote_started'");
assert(quoteEvent > quoteBranch && quoteEvent < paymentUi.indexOf("request('/api/pagos-suscripcion/cotizar", quoteBranch),
  'quote_started debe representar la intencion explicita antes de solicitar la cotizacion.');

const browserContext = { window: {} };
vm.runInNewContext(read('public/js/product-analytics.js'), browserContext);
assert.strictEqual(browserContext.window.ProductAnalytics.track('plan_viewed', {
  module: 'subscription', plan: 'basico', email: 'private@example.test', idTienda: 9
}), true);
assert.strictEqual(browserContext.window.ProductAnalytics.track('unknown_event', {}), false);

assert(!EVENTS.aha_moment, 'PRODUCT-029 sigue siendo una hipotesis, no un evento propio.');
assert(!read('routes/api.js').includes('analytics.productCreated'),
  'product_created debe permanecer pendiente por replay seguro.');

console.log('test:product-analytics-commerce OK');
