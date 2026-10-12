const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { nextSaleReceiptCode } = require('../utils/receipt-code');

const root = path.resolve(__dirname, '..');
const posService = fs.readFileSync(path.join(root, 'services', 'pos-sale-service.js'), 'utf8');
const onlineService = fs.readFileSync(path.join(root, 'services', 'online-store-service.js'), 'utf8');

async function run() {
  const calls = [];
  const connection = {
    async query(sql, params) {
      calls.push({ sql, params });
      return [[{ ultimo: params[1] === 'online' ? 12 : 7 }]];
    }
  };

  assert.strictEqual(await nextSaleReceiptCode(connection, 4, 'tienda'), 'T-008');
  assert.strictEqual(await nextSaleReceiptCode(connection, 4, 'online'), 'O-013');
  assert.deepStrictEqual(calls.map((call) => call.params), [
    [4, 'tienda', 'T-%'],
    [4, 'online', 'O-%']
  ]);
  await assert.rejects(() => nextSaleReceiptCode(connection, 4, 'otro'), /canal/);

  assert(posService.includes("nextSaleReceiptCode(connection, idTienda, 'tienda')"));
  assert(/canalVenta\)\s+VALUES \(\?, \?, 0, 'pagada', NULL, \?, 'tienda'\)/.test(posService));
  assert(onlineService.includes("nextSaleReceiptCode(connection, idTienda, 'online')"));
  assert(onlineService.includes("?,'online')"));
  console.log('test:receipt-channels OK');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
