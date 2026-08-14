const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const sources = [
  'public/js/subscription-ui.js',
  'public/js/payment-subscription-ui.js',
  'public/js/saas-subscription-admin-ui.js',
  'public/js/payment-subscription-admin-ui.js'
].map(read).join('\n');

assert.match(read('services/subscription-plan-service.js'), /visiblePublicamente=1 AND esLegado=0/);
assert.match(read('services/subscription-plan-service.js'), /codigo IN \('basico','standard','pro'\)/);
assert.match(read('public/js/subscription-ui.js'), /Plan actual/);
assert.match(read('public/js/subscription-ui.js'), /Periodo de gracia/);
assert.match(read('public/js/subscription-ui.js'), /subscription-feature-detail/);
assert.match(read('public/js/payment-subscription-ui.js'), /Crear solicitud, realizar el pago, adjuntar comprobante y esperar la revision/);
assert.match(read('public/js/saas-subscription-admin-ui.js'), /Mas opciones/);
assert.match(read('public/js/payment-subscription-admin-ui.js'), /UiPatterns/);
assert.match(read('public/admin.html'), /paymentAdminFeedback/);
assert(!/idTienda/.test(sources), 'La interfaz P6 no debe decidir el tenant.');
assert(!/global\.alert/.test(read('public/js/payment-subscription-admin-ui.js')), 'Los errores administrativos deben ser visibles y sanitizados en la interfaz.');

console.log('test:product-subscription-admin OK');
