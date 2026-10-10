const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright-core');

const root = path.resolve(__dirname, '..');
function executable() {
  return [
    process.env.BROWSER_EXECUTABLE_PATH,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
  ].filter(Boolean).find((file) => fs.existsSync(file));
}

const catalog = {
  tienda: {
    nombre: 'Tienda Prueba', slug: 'tienda-prueba', telefono: null, direccion: 'Zona central',
    mensajeBienvenida: 'Productos para tu hogar, listos para consultar.',
    opciones: { recojo: true, entrega: true, efectivo: true, qr: true },
    pedidoMinimo: 20, entregaGratisDesde: 20, costoEntrega: 5, tiempoPreparacionMinutos: 30
  },
  categorias: ['ABARROTES', 'BEBIDAS'],
  productos: [
    { idProducto: 1, nombre: 'Arroz familiar 1 kg', categoria: 'ABARROTES', unidadMedida: 'unidad', precioVenta: 12.5, disponibilidad: 'disponible' },
    { idProducto: 2, nombre: 'Gaseosa 2 litros', categoria: 'BEBIDAS', unidadMedida: 'unidad', precioVenta: 15, disponibilidad: 'pocas_unidades' },
    { idProducto: 3, nombre: 'Aceite vegetal', categoria: 'ABARROTES', unidadMedida: 'unidad', precioVenta: 18, disponibilidad: 'agotado' }
  ]
};

async function main() {
  const assets = new Map([
    ['/tienda/tienda-prueba', ['text/html', path.join(root, 'public', 'storefront.html')]],
    ['/css/storefront.css?v=20261009-2', ['text/css', path.join(root, 'public', 'css', 'storefront.css')]],
    ['/js/storefront.js?v=20261009-2', ['application/javascript', path.join(root, 'public', 'js', 'storefront.js')]],
    ['/js/http-security.js', ['application/javascript', path.join(root, 'public', 'js', 'http-security.js')]],
    ['/assets/administrau-icon.png', ['image/png', path.join(root, 'public', 'assets', 'administrau-icon.png')]]
  ]);
  const server = http.createServer((request, response) => {
    if (request.url === '/api/public/tiendas/tienda-prueba') {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify(catalog));
      return;
    }
    const asset = assets.get(request.url);
    if (asset) {
      response.writeHead(200, { 'Content-Type': asset[0] });
      fs.createReadStream(asset[1]).pipe(response);
      return;
    }
    response.writeHead(404).end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ executablePath: executable(), headless: true });
    for (const viewport of [{ width: 360, height: 800 }, { width: 768, height: 1024 }, { width: 1366, height: 768 }]) {
      const page = await browser.newPage({ viewport });
      const errors = [];
      page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(`http://127.0.0.1:${server.address().port}/tienda/tienda-prueba`);
      await page.getByRole('heading', { name: 'Tienda Prueba' }).waitFor();
      assert.strictEqual(await page.locator('.storefront-product').count(), 3);
      assert.strictEqual(await page.getByText('Quedan pocas unidades').count(), 1);
      assert.strictEqual(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
      await page.locator('[data-add-product="1"]').click();
      await page.getByRole('button', { name: 'Agregar una unidad' }).last().click();
      await page.getByRole('button', { name: 'Confirmar cantidad' }).click();
      assert.strictEqual(await page.locator('[data-cart-count]').first().textContent(), '2');
      await page.locator('[data-cart-action="decrease"]').click();
      assert.strictEqual(await page.locator('[data-cart-count]').first().textContent(), '1');
      await page.getByRole('button', { name: 'Eliminar Arroz familiar 1 kg' }).click();
      assert.strictEqual(await page.locator('[data-cart-count]').first().textContent(), '0');
      await page.locator('[data-add-product="1"]').click();
      await page.getByRole('button', { name: 'Confirmar cantidad' }).click();
      await page.getByRole('button', { name: 'Continuar pedido' }).click();
      await page.getByText('Entrega a domicilio', { exact: true }).click();
      assert.strictEqual(await page.getByLabel('Dirección de entrega').isVisible(), true);
      assert.strictEqual(await page.getByText('Noche', { exact: true }).count(), 1);
      assert.strictEqual(await page.getByText('QR', { exact: true }).count(), 1);
      await page.getByRole('button', { name: 'Cerrar' }).click();
      await page.getByRole('button', { name: 'BEBIDAS' }).click();
      assert.strictEqual(await page.locator('.storefront-product').count(), 1);
      await page.getByLabel('Buscar productos').fill('no existe');
      assert.strictEqual(await page.getByText('No encontramos productos').count(), 1);
      assert.deepStrictEqual(errors, []);
      await page.close();
    }
    console.log('test:online-store-browser OK');
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error(`test:online-store-browser FAIL: ${error.message}`);
  process.exitCode = 1;
});
