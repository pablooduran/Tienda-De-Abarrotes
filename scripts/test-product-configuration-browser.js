const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright-core');

const ROOT = path.resolve(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const EDGE = [
  process.env.BROWSER_EXECUTABLE_PATH,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
].find((candidate) => candidate && fs.existsSync(candidate));
const VIEWPORTS = Object.freeze([
  { width: 360, height: 800 },
  { width: 768, height: 1024 },
  { width: 1366, height: 768 }
]);

function sendJson(response, status, body) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store, max-age=0'
  });
  response.end(JSON.stringify(body));
}

function ownerContext(readOnly) {
  return {
    tienda: { nombre: 'Tienda configuracion sintética' },
    plan: { codigo: 'basico', nombre: 'Basico' },
    suscripcion: { estadoEfectivo: readOnly ? 'gracia' : 'activa', fechaFin: '2026-12-31 00:00:00', diasRestantes: 120 },
    acceso: {}, estadoAcceso: readOnly ? 'solo_lectura' : 'completo', soloLectura: readOnly,
    caracteristicas: ['clientes_basico', 'punto_venta']
  };
}

function initialConfiguration() {
  return {
    nombreMostrado: 'Tienda configuracion sintética', moneda: 'BOB', zonaHoraria: 'America/La_Paz',
    telefono: null, direccion: null, datoFiscalBasico: null
  };
}

function contentType(file) {
  const extension = path.extname(file);
  if (extension === '.html') return 'text/html; charset=utf-8';
  if (extension === '.css') return 'text/css; charset=utf-8';
  return 'text/javascript; charset=utf-8';
}

function createServer() {
  let configuration = initialConfiguration();
  const requests = [];
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    const readOnly = String(request.headers.referer || '').includes('readonly=1');
    if (url.pathname === '/favicon.ico') { response.writeHead(204); return response.end(); }
    if (url.pathname.startsWith('/api/')) {
      if (url.pathname === '/api/contexto') return sendJson(response, 200, ownerContext(readOnly));
      if (url.pathname === '/api/lotes/acceso') return sendJson(response, 200, { productosControlados: 0 });
      if (url.pathname === '/api/configuracion-tienda' && request.method === 'GET') {
        return sendJson(response, 200, { configuracion: configuration, onboardingCompletado: true });
      }
      if (url.pathname === '/api/configuracion-tienda' && request.method === 'PATCH') {
        let raw = '';
        request.on('data', (chunk) => { raw += chunk; });
        request.on('end', () => {
          const body = JSON.parse(raw || '{}');
          requests.push({ path: url.pathname, method: request.method, body, requestedWith: request.headers['x-requested-with'] || null });
          if (body.nombreMostrado === 'forzar-error') {
            return sendJson(response, 400, { error: 'Dato no permitido.', code: 'CONFIGURATION_INPUT_INVALID' });
          }
          setTimeout(() => {
            configuration = {
              ...configuration,
              ...body,
              telefono: body.telefono || null,
              direccion: body.direccion || null,
              datoFiscalBasico: body.datoFiscalBasico || null
            };
            sendJson(response, 200, { configuracion: configuration, onboardingCompletado: true });
          }, 25);
        });
        return;
      }
      if (['/api/productos', '/api/clientes', '/api/proveedores', '/api/fiados', '/api/ventas', '/api/categorias'].includes(url.pathname)) return sendJson(response, 200, []);
      if (url.pathname === '/api/dashboard') return sendJson(response, 200, { ventasHoy: 0, ventasAyer: 0, ventasMes: 0, ventasMesPasado: 0, gananciaHoy: 0, gananciaMes: 0, bajoStock: 0, fiados: {}, chartVentasDias: [] });
      return sendJson(response, 200, { rows: [], resultados: [], paginas: 1, page: 1, pages: 1, resumen: {}, paginacion: { page: 1, totalPages: 1 } });
    }
    const relative = url.pathname === '/' ? 'app.html' : url.pathname.slice(1);
    const file = path.resolve(PUBLIC, relative);
    if (!file.startsWith(`${PUBLIC}${path.sep}`) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      response.writeHead(404); return response.end();
    }
    response.writeHead(200, { 'Content-Type': contentType(file), 'Cache-Control': 'no-store, max-age=0' });
    return fs.createReadStream(file).pipe(response);
  });
  return { server, requests, configuration: () => configuration };
}

async function openConfiguration(page) {
  const family = page.locator('[data-navigation-family="administracion"]');
  if (!await family.evaluate((node) => node.open)) await family.locator('> summary').click();
  await page.locator('[data-view="configuracion"]').focus();
  await page.keyboard.press('Enter');
  await page.locator('[data-configuration-panel]').waitFor();
}

async function assertViewport(browser, baseUrl, viewport, { readOnly = false } = {}) {
  const context = await browser.newContext({ viewport, isMobile: viewport.width === 360, hasTouch: viewport.width !== 1366 });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await page.goto(`${baseUrl}/app.html${readOnly ? '?readonly=1' : ''}`);
    await openConfiguration(page);
    await page.locator('input[name="nombreMostrado"]').waitFor();
    assert.strictEqual(await page.locator('input[name="nombreMostrado"]').inputValue(), 'Tienda configuracion sintética');
    assert.strictEqual(await page.locator('select[name="moneda"]').inputValue(), 'BOB');
    assert.strictEqual(await page.locator('select[name="zonaHoraria"]').inputValue(), 'America/La_Paz');
    assert.strictEqual(await page.locator('input[name="datoFiscalBasico"]').count(), 1, 'Dato fiscal opcional visible.');
    assert.strictEqual(await page.locator('body').textContent().then((text) => !text.includes('idTienda') && !text.includes('idConfiguracionTienda')), true, 'Sin identificadores internos visibles.');
    assert.strictEqual(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2), true, `Overflow a ${viewport.width}x${viewport.height}.`);
    if (readOnly) {
      assert.strictEqual(await page.locator('[data-configuration-save]').count(), 0, 'Solo lectura no puede guardar.');
      assert.strictEqual(await page.locator('.readonly-note').count(), 1, 'Aviso de solo lectura.');
    } else {
      assert.strictEqual(await page.locator('[data-configuration-save]').isEnabled(), true);
    }
    assert.deepStrictEqual(errors, [], `Consola limpia a ${viewport.width}x${viewport.height}.`);
  } finally {
    await context.close();
  }
}

async function main() {
  if (!EDGE) throw new Error('No se encontro Edge local para PRODUCTO-1 P5.');
  const fixture = createServer();
  await new Promise((resolve) => fixture.server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ executablePath: EDGE, headless: true });
  const baseUrl = `http://127.0.0.1:${fixture.server.address().port}`;
  try {
    const context = await browser.newContext({ viewport: VIEWPORTS[2] });
    const page = await context.newPage();
    const errors = [];
    page.on('console', (message) => {
      if (message.type() === 'error' && !message.text().includes('400 (Bad Request)')) errors.push(message.text());
    });
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`${baseUrl}/app.html`);
    await openConfiguration(page);
    const original = await page.locator('input[name="telefono"]').inputValue();
    await page.locator('input[name="telefono"]').fill('70000001');
    await page.locator('[data-configuration-save]').evaluate((button) => { button.click(); button.click(); });
    await page.locator('[data-configuration-save]').waitFor({ hasText: 'Guardando...' });
    await page.locator('[data-configuration-message]').waitFor({ hasText: 'Cambios guardados.' });
    assert.strictEqual(fixture.requests.filter((item) => item.method === 'PATCH').length, 1, 'Un solo guardado pese al doble envio protegido.');
    await page.reload();
    await openConfiguration(page);
    assert.strictEqual(await page.locator('input[name="telefono"]').inputValue(), '70000001', 'Persistencia despues de recargar.');
    await page.locator('input[name="telefono"]').fill(original);
    await page.locator('[data-configuration-save]').click();
    await page.locator('[data-configuration-message]').waitFor({ hasText: 'Cambios guardados.' });
    await page.locator('input[name="nombreMostrado"]').fill('forzar-error');
    await page.locator('[data-configuration-save]').click();
    await page.locator('[data-configuration-message]').waitFor({ hasText: 'No pudimos completar la operaciÃ³n.' });
    await page.locator('[data-configuration-save]').waitFor({ state: 'visible' });
    await page.waitForFunction(() => !document.querySelector('[data-configuration-save]').disabled);
    assert.strictEqual(await page.locator('[data-configuration-save]').isEnabled(), true, 'El boton se recupera tras error seguro.');
    assert.deepStrictEqual(errors, [], 'Consola limpia en el flujo autenticado simulado.');
    await context.close();
    assert.strictEqual(fixture.configuration().telefono, null, 'Fixture restaurado.');
    assert(fixture.requests.every((item) => item.requestedWith === 'XMLHttpRequest'), 'Mutaciones con proteccion CSRF.');
    assert(fixture.requests.every((item) => !Object.hasOwn(item.body, 'idTienda')), 'El frontend no envia tenant.');
    for (const viewport of VIEWPORTS) await assertViewport(browser, baseUrl, viewport);
    await assertViewport(browser, baseUrl, VIEWPORTS[0], { readOnly: true });
    console.log('test:product-configuration-browser OK');
  } finally {
    await browser.close();
    await new Promise((resolve) => fixture.server.close(resolve));
  }
}

main().catch((error) => {
  console.error(`test:product-configuration-browser FAIL: ${error.message}`);
  process.exitCode = 1;
});
