const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright-core');

const ROOT = path.resolve(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');

function executable() {
  const candidates = [
    process.env.BROWSER_EXECUTABLE_PATH,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  ].filter(Boolean);
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) throw new Error('No se encontro Edge o Chrome para la prueba Welcome.');
  return found;
}

function json(response, body) {
  response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
}

function dashboard() {
  return { ventasHoy: 0, ventasAyer: 0, ventasSemana: 0, ventasSemanaPasada: 0, ventasMes: 0, ventasMesPasado: 0, bajoStock: 0, fiados: {}, chartVentasDias: [] };
}

function createFixture() {
  const state = { products: [], sales: [], readOnly: false, requests: [] };
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    state.requests.push({ path: url.pathname, search: url.search, method: request.method });
    if (url.pathname === '/favicon.ico') { response.writeHead(204); return response.end(); }
    if (url.pathname.startsWith('/api/')) {
      if (url.pathname === '/api/contexto') return json(response, {
        usuario: 'owner_welcome', tienda: { nombre: 'Tienda Welcome' }, plan: { nombre: 'Pro' },
        suscripcion: { estadoEfectivo: state.readOnly ? 'gracia' : 'activa', diasRestantes: 20 },
        acceso: {}, caracteristicas: [], limites: {}, uso: {}, soloLectura: state.readOnly
      });
      if (url.pathname === '/api/lotes/acceso') return json(response, { productosControlados: 0 });
      if (url.pathname === '/api/dashboard') return json(response, dashboard());
      if (url.pathname === '/api/productos') return json(response, state.products);
      if (url.pathname === '/api/ventas') return json(response, state.sales);
      if (url.pathname === '/api/pos/productos') return json(response, { productos: state.products });
      if (url.pathname === '/api/pos/clientes') return json(response, { clientes: [] });
      if (['/api/clientes', '/api/proveedores', '/api/fiados', '/api/categorias', '/api/compras'].includes(url.pathname)) return json(response, []);
      return json(response, []);
    }
    const relative = url.pathname === '/' ? 'app.html' : url.pathname.slice(1);
    const file = path.resolve(PUBLIC, relative);
    if (!file.startsWith(`${PUBLIC}${path.sep}`) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      response.writeHead(404); return response.end('No encontrado');
    }
    const extension = path.extname(file);
    const contentType = extension === '.html' ? 'text/html; charset=utf-8'
      : extension === '.js' ? 'text/javascript; charset=utf-8'
        : extension === '.css' ? 'text/css; charset=utf-8' : 'application/octet-stream';
    response.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-store' });
    fs.createReadStream(file).pipe(response);
  });
  return {
    server,
    state,
    reset() { state.products = []; state.sales = []; state.readOnly = false; },
    product(stock = 0) { state.products = [{ idProducto: 1, nombre: 'Producto Welcome', stockUnidadesTotal: stock, precioVenta: 10, unidadesPorPaquete: 1 }]; },
    sale() { state.sales = [{ idVenta: 1, total: 10, fecha: '2026-08-14 10:00:00' }]; }
  };
}

function track(page, errors) {
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', (error) => errors.push(error.message));
}

async function open(browser, baseUrl, viewport = { width: 1366, height: 768 }) {
  const context = await browser.newContext({ viewport, hasTouch: viewport.width < 768, isMobile: viewport.width < 768 });
  const page = await context.newPage();
  const errors = [];
  track(page, errors);
  await page.goto(`${baseUrl}/app.html`);
  await page.locator('#view').waitFor();
  return { context, page, errors };
}

async function goHome(page) {
  const family = page.locator('[data-navigation-family="inicio"]');
  if (!await family.evaluate((node) => node.open)) await family.locator('summary').click();
  await page.locator('[data-navigation-family="inicio"] [data-view="inicio"]').click();
  await page.locator('#viewTitle').getByText('Inicio').waitFor();
}

async function assertViewport(browser, baseUrl, viewport) {
  const session = await open(browser, baseUrl, viewport);
  try {
    await session.page.locator('.welcome-guide').waitFor();
    const overflow = await session.page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    assert.strictEqual(overflow, false, `Welcome no debe desbordar a ${viewport.width}x${viewport.height}.`);
    assert.strictEqual(await session.page.locator('.welcome-step').count(), 3);
    assert.deepStrictEqual(session.errors, [], `Consola limpia a ${viewport.width}x${viewport.height}.`);
  } finally { await session.context.close(); }
}

async function main() {
  const fixture = createFixture();
  const browser = await chromium.launch({ executablePath: executable(), headless: true });
  await new Promise((resolve) => fixture.server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${fixture.server.address().port}`;
  try {
    const first = await open(browser, baseUrl);
    const { page } = first;
    await page.locator('.welcome-guide').waitFor();
    assert.strictEqual(await page.locator('.welcome-step').count(), 3, 'La guia muestra tres pasos.');
    const productAction = page.locator('[data-welcome-action="producto"]');
    assert.strictEqual(await productAction.textContent(), 'Agregar producto');
    await productAction.focus();
    await page.keyboard.press('Enter');
    await page.locator('#viewTitle').getByText('Productos').waitFor();

    fixture.product(0);
    await goHome(page);
    await page.locator('[data-welcome-action="stock"]').waitFor();
    assert.strictEqual(await page.locator('.welcome-step.is-complete').count(), 1, 'Producto completo depende de datos reales.');
    assert.strictEqual(await page.locator('[data-welcome-action="stock"]').textContent(), 'Registrar stock');
    await page.locator('[data-welcome-action="stock"]').click();
    await page.locator('#viewTitle').getByText('Compras / stock').waitFor();

    fixture.product(4);
    await goHome(page);
    await page.locator('[data-welcome-action="venta"]').waitFor();
    assert.strictEqual(await page.locator('.welcome-step.is-complete').count(), 2, 'Stock completo depende de existencias reales.');
    assert.strictEqual(await page.locator('[data-welcome-action="venta"]').textContent(), 'Ir al punto de venta');
    await page.locator('[data-welcome-action="venta"]').click();
    await page.locator('#viewTitle').getByText('Punto de venta').waitFor();

    fixture.sale();
    await goHome(page);
    await page.locator('.welcome-complete').waitFor();
    assert.match(await page.locator('.welcome-complete').textContent(), /lista para operar/i);
    assert.deepStrictEqual(first.errors, [], 'El recorrido Welcome mantiene la consola limpia.');
    await first.context.close();

    fixture.reset();
    const skipped = await open(browser, baseUrl);
    await skipped.page.locator('[data-welcome-hide]').click();
    await skipped.page.locator('[data-welcome-resume]').waitFor();
    const stored = await skipped.page.evaluate(() => Object.entries(localStorage).filter(([key]) => key.includes('tienda.welcome.hidden.v1')));
    assert(stored.length > 0 && stored.every(([key, value]) => !key.includes('idTienda') && value === '1'), 'Saltar solo guarda una preferencia visual no sensible.');
    await skipped.page.locator('[data-welcome-resume]').focus();
    await skipped.page.keyboard.press('Enter');
    await skipped.page.locator('.welcome-guide').waitFor();
    await skipped.context.close();

    fixture.product(4); fixture.sale();
    const established = await open(browser, baseUrl);
    assert.strictEqual(await established.page.locator('.welcome-guide, .welcome-resume, .welcome-complete').count(), 0, 'Una tienda operativa no recibe una guia invasiva.');
    await established.context.close();

    fixture.reset(); fixture.state.readOnly = true;
    const readOnly = await open(browser, baseUrl);
    await readOnly.page.locator('.welcome-guide-readonly').waitFor();
    assert.strictEqual(await readOnly.page.locator('[data-welcome-action="producto"]').isDisabled(), true, 'Modo solo lectura no ofrece CTA activo.');
    await readOnly.context.close();

    fixture.reset();
    await assertViewport(browser, baseUrl, { width: 360, height: 800 });
    await assertViewport(browser, baseUrl, { width: 768, height: 1024 });
    await assertViewport(browser, baseUrl, { width: 1366, height: 768 });
    assert(fixture.state.requests.every((request) => !request.search.includes('idTienda')), 'Welcome no envia idTienda en consultas.');
    console.log('test:welcome-browser OK');
  } finally {
    await browser.close();
    await new Promise((resolve) => fixture.server.close(resolve));
  }
}

main().catch((error) => {
  console.error(`test:welcome-browser FAIL: ${error.message}`);
  process.exitCode = 1;
});
