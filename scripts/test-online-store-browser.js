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
    nombre: 'Tienda Prueba', slug: 'tienda-prueba', telefono: null, direccion: 'Zona central', codigoPaisTelefono: '591',
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
for (let idProducto = 4; idProducto <= 12; idProducto += 1) {
  catalog.productos.push({ idProducto, nombre: `Producto de prueba ${idProducto}`, categoria: 'ABARROTES', unidadMedida: 'unidad', precioVenta: idProducto, disponibilidad: 'disponible' });
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.on('data', (chunk) => { body += chunk; });
    request.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); } catch (error) { reject(error); }
    });
    request.on('error', reject);
  });
}

async function main() {
  const assets = new Map([
    ['/tienda/tienda-prueba', ['text/html', path.join(root, 'public', 'storefront.html')]],
    ['/css/storefront.css?v=20261012-2', ['text/css', path.join(root, 'public', 'css', 'storefront.css')]],
    ['/js/storefront.js?v=20261012-2', ['application/javascript', path.join(root, 'public', 'js', 'storefront.js')]],
    ['/js/http-security.js', ['application/javascript', path.join(root, 'public', 'js', 'http-security.js')]],
    ['/assets/administrau-icon.png', ['image/png', path.join(root, 'public', 'assets', 'administrau-icon.png')]]
  ]);
  const receivedOrders = [];
  let rejectNextOrderForStock = false;
  const server = http.createServer(async (request, response) => {
    if (request.url === '/api/public/tiendas/tienda-prueba') {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify(catalog));
      return;
    }
    if (request.url === '/api/public/tiendas/tienda-prueba/clientes/buscar' && request.method === 'POST') {
      const body = await readBody(request);
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify(body.telefono === '+59177049566'
        ? { encontrado: true, cliente: { nombre: 'Pablo', direccion: 'Zona central' } }
        : { encontrado: false, cliente: null }));
      return;
    }
    if (request.url === '/api/public/tiendas/tienda-prueba/pedidos' && request.method === 'POST') {
      const body = await readBody(request);
      if (rejectNextOrderForStock) {
        rejectNextOrderForStock = false;
        response.writeHead(409, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ error: 'No alcanza el stock. MICII: pediste 15 y solo quedan 14. Reduce la cantidad en el carrito e intenta nuevamente.', code: 'ONLINE_STORE_STOCK_CHANGED' }));
        return;
      }
      receivedOrders.push(body);
      response.writeHead(201, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ pedido: { codigo: 'ABC123', total: 12.5 } }));
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
    for (const viewport of [{ width: 320, height: 720 }, { width: 360, height: 800 }, { width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 1024, height: 600 }, { width: 1366, height: 768 }]) {
      const context = await browser.newContext({ viewport });
      const page = await context.newPage();
      const errors = [];
      page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(`http://127.0.0.1:${server.address().port}/tienda/tienda-prueba`);
      await page.getByRole('heading', { name: 'Tienda Prueba' }).waitFor();
      assert.strictEqual(await page.locator('.storefront-product').count(), 12);
      assert.strictEqual(await page.getByText('Quedan pocas unidades').count(), 1);
      assert.strictEqual(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
      assert.strictEqual(await page.locator('.storefront-product').evaluateAll((cards) => cards.every((card) => {
        const bounds = card.getBoundingClientRect();
        return bounds.left >= 0 && bounds.right <= window.innerWidth + 1;
      })), true);
      await page.locator('[data-add-product="1"]').click();
      await page.getByRole('button', { name: 'Agregar una unidad' }).last().click();
      await page.getByRole('button', { name: 'Confirmar cantidad' }).click();
      assert.strictEqual(await page.locator('[data-cart-count]').first().textContent(), '2');
      if (viewport.width <= 680) await page.getByRole('button', { name: /Carrito ·/ }).click();
      await page.locator('[data-cart-action="decrease"]').click();
      assert.strictEqual(await page.locator('[data-cart-count]').first().textContent(), '1');
      await page.getByRole('button', { name: 'Eliminar Arroz familiar 1 kg' }).click();
      assert.strictEqual(await page.locator('[data-cart-count]').first().textContent(), '0');
      if (viewport.width <= 680) await page.getByRole('button', { name: 'Cerrar carrito' }).last().click();
      await page.locator('[data-add-product="1"]').click();
      await page.getByRole('button', { name: 'Confirmar cantidad' }).click();
      await page.reload();
      await page.getByRole('heading', { name: 'Tienda Prueba' }).waitFor();
      assert.strictEqual(await page.locator('[data-cart-count]').first().textContent(), '1');
      if (viewport.width === 1024) {
        for (let idProducto = 4; idProducto <= 12; idProducto += 1) {
          await page.locator(`[data-add-product="${idProducto}"]`).click();
          await page.getByRole('button', { name: 'Confirmar cantidad' }).click();
        }
        const cartMetrics = await page.locator('[data-cart-items]').evaluate((node) => ({ clientHeight: node.clientHeight, scrollHeight: node.scrollHeight }));
        assert(cartMetrics.scrollHeight > cartMetrics.clientHeight);
        assert.strictEqual(await page.locator('.storefront-cart footer').isVisible(), true);
        await page.locator('[data-cart-items]').evaluate((node) => { node.scrollTop = node.scrollHeight; });
        assert((await page.locator('[data-cart-items]').evaluate((node) => node.scrollTop)) > 0);
      }
      if (viewport.width <= 680) {
        await page.getByRole('button', { name: /Carrito ·/ }).click();
        assert.strictEqual(await page.locator('[data-cart-panel]').evaluate((node) => node.classList.contains('is-open')), true);
        assert.strictEqual(await page.getByRole('button', { name: 'Cerrar carrito' }).last().isVisible(), true);
      }
      await page.getByRole('button', { name: 'Continuar pedido' }).click();
      assert.strictEqual(await page.getByText('+591', { exact: true }).count(), 1);
      await page.getByLabel('Número de teléfono').fill('77049566');
      await page.getByRole('button', { name: 'Buscar cliente' }).click();
      await page.getByText('Cliente encontrado.', { exact: false }).waitFor();
      await page.getByText('Pablo', { exact: true }).waitFor();
      await page.getByText('Tus datos ya están completos. Puedes continuar.', { exact: true }).waitFor();
      assert.strictEqual(await page.locator('[data-customer-name]').isHidden(), true);
      assert.strictEqual(await page.locator('[data-customer-confirmation]').isVisible(), true);
      assert.strictEqual(await page.locator('[data-customer-confirmation]').evaluate((node) => node.classList.contains('is-visible')), true);
      assert.strictEqual(await page.getByRole('button', { name: '✓ Cliente encontrado' }).count(), 1);
      await page.getByText('Entrega a domicilio', { exact: true }).click();
      assert.strictEqual(await page.getByLabel('Dirección de entrega').isVisible(), true);
      await page.getByLabel('Dirección de entrega').fill('Zona central');
      assert.strictEqual(await page.getByRole('button', { name: '✓ Cliente encontrado' }).count(), 1);
      assert.strictEqual(await page.getByRole('button', { name: 'Enviar pedido a la tienda' }).count(), 1);
      assert.strictEqual(await page.getByText('Noche', { exact: true }).count(), 1);
      assert.strictEqual(await page.getByText('QR', { exact: true }).count(), 1);
      const fulfillmentHeights = await page.locator('[data-fulfillment-options] label').evaluateAll((nodes) => nodes.map((node) => Math.round(node.getBoundingClientRect().height)));
      assert.strictEqual(new Set(fulfillmentHeights).size, 1);
      await page.getByText('Noche', { exact: true }).click();
      await page.getByText('QR', { exact: true }).click();
      rejectNextOrderForStock = true;
      await page.getByRole('button', { name: 'Enviar pedido a la tienda' }).click();
      await page.getByText('MICII: pediste 15 y solo quedan 14.', { exact: false }).waitFor();
      assert.strictEqual(await page.locator('[data-customer-result]').evaluate((node) => node.classList.contains('error')), true);
      assert(errors.some((message) => message.includes('409')));
      errors.length = 0;
      await page.getByRole('button', { name: 'Enviar pedido a la tienda' }).click();
      try {
        await page.getByText('¡Pedido enviado!', { exact: true }).waitFor({ timeout: 5000 });
      } catch (error) {
        const status = await page.locator('[data-customer-result]').textContent().catch(() => 'sin estado');
        const buttonText = await page.locator('[data-submit-order]').textContent().catch(() => 'sin botón');
        const formState = await page.locator('[data-checkout-dialog] form').evaluate((form) => ({ valid: form.checkValidity(), noValidate: form.noValidate, open: form.closest('dialog').open }));
        throw new Error(`El pedido no se confirmó: ${status} (${buttonText}); recibidos=${receivedOrders.length}; formulario=${JSON.stringify(formState)}; errores=${JSON.stringify(errors)}. ${error.message}`);
      }
      const order = receivedOrders.at(-1);
      assert.strictEqual(order.telefono, '+59177049566');
      assert.strictEqual(order.nombre, 'Pablo');
      assert.strictEqual(order.tipoEntrega, 'entrega');
      assert.strictEqual(order.franjaEntrega, 'noche');
      assert.strictEqual(order.metodoPago, 'qr');
      assert.strictEqual(await page.locator('[data-cart-count]').first().textContent(), '0');
      await page.reload();
      await page.getByRole('heading', { name: 'Tienda Prueba' }).waitFor();
      assert.strictEqual(await page.locator('[data-cart-count]').first().textContent(), '0');
      await page.getByRole('button', { name: 'BEBIDAS' }).click();
      assert.strictEqual(await page.locator('.storefront-product').count(), 1);
      await page.getByLabel('Buscar productos').fill('no existe');
      assert.strictEqual(await page.getByText('No encontramos productos').count(), 1);
      assert.deepStrictEqual(errors, []);
      await context.close();
    }
    const scaledContext = await browser.newContext({ viewport: { width: 320, height: 720 } });
    const scaledPage = await scaledContext.newPage();
    await scaledPage.goto(`http://127.0.0.1:${server.address().port}/tienda/tienda-prueba`);
    await scaledPage.getByRole('heading', { name: 'Tienda Prueba' }).waitFor();
    await scaledPage.evaluate(() => { document.documentElement.style.fontSize = '125%'; });
    assert.strictEqual(await scaledPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true,
      'El catálogo no debe desbordarse cuando el teléfono amplía el texto.');
    assert.strictEqual(await scaledPage.locator('.storefront-product').evaluateAll((cards) => cards.every((card) => {
      const bounds = card.getBoundingClientRect();
      return bounds.left >= 0 && bounds.right <= window.innerWidth + 1;
    })), true);
    await scaledContext.close();
    console.log('test:online-store-browser OK');
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error(`test:online-store-browser FAIL: ${error.stack || error.message}`);
  process.exitCode = 1;
});
