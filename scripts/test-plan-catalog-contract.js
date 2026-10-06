const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  BASIC_FEATURES,
  EXCLUDED_PUBLIC_FEATURES,
  PLAN_CATALOG,
  PRO_FEATURES,
  STANDARD_FEATURES
} = require('../config/saas-c-payment-contract');

const root = path.join(__dirname, '..');
const migration = fs.readFileSync(
  path.join(root, 'database', 'migrations', '028_reordenar_funciones_por_plan.sql'),
  'utf8'
);
const schema = fs.readFileSync(path.join(root, 'database', 'tienda_abarrotes.sql'), 'utf8');
const subscriptionUi = fs.readFileSync(path.join(root, 'public', 'js', 'subscription-ui.js'), 'utf8');

function sameMembers(actual, expected) {
  return actual.length === new Set(actual).size
    && expected.every((value) => actual.includes(value));
}

assert.deepStrictEqual(PLAN_CATALOG.basico.limits, {
  owners: 1, products: 300, customers: 15, suppliers: 15
});
assert.deepStrictEqual(PLAN_CATALOG.standard.limits, {
  owners: 3, products: 1000, customers: 30, suppliers: 30
});
assert.deepStrictEqual(PLAN_CATALOG.pro.limits, {
  owners: null, products: null, customers: null, suppliers: null
});
assert.deepStrictEqual(
  Object.fromEntries(Object.entries(PLAN_CATALOG).map(([code, plan]) => [code, plan.pricesUsd.mensual])),
  { basico: 3, standard: 6, pro: 10 }
);

assert.strictEqual(BASIC_FEATURES.length, 9);
assert.strictEqual(STANDARD_FEATURES.length, 22);
assert.strictEqual(PRO_FEATURES.length, 36);
assert(sameMembers(STANDARD_FEATURES, BASIC_FEATURES));
assert(sameMembers(PRO_FEATURES, STANDARD_FEATURES));
assert(EXCLUDED_PUBLIC_FEATURES.every((feature) => !PRO_FEATURES.includes(feature)));
assert(!BASIC_FEATURES.includes('anulaciones_operativas'));
assert(!BASIC_FEATURES.includes('ajuste_stock'));
assert(!BASIC_FEATURES.includes('gastos'));
assert(!BASIC_FEATURES.includes('recibos_whatsapp'));
assert(STANDARD_FEATURES.includes('reportes_financieros'));
assert(STANDARD_FEATURES.includes('gastos'));
assert(STANDARD_FEATURES.includes('recibos_whatsapp'));
assert(!STANDARD_FEATURES.includes('cierre_caja'));
assert(!STANDARD_FEATURES.includes('rentabilidad_producto'));
assert(PRO_FEATURES.includes('rentabilidad_producto'));
assert(PRO_FEATURES.includes('cierre_caja'));

for (const code of Object.keys(PLAN_CATALOG)) {
  assert(migration.includes(`WHERE p.codigo='${code}'`));
  assert(schema.includes(`WHERE p.codigo='${code}'`));
}
for (const feature of PRO_FEATURES) {
  assert(migration.includes(`'${feature}'`), `La migracion no declara ${feature}`);
  assert(subscriptionUi.includes(`${feature}:`), `Falta etiqueta visible para ${feature}`);
}
for (const feature of EXCLUDED_PUBLIC_FEATURES) {
  assert(!migration.match(new RegExp(`'${feature}'[\\s\\S]{0,80}THEN 1`)));
}

console.log('test:plan-catalog-contract OK');
