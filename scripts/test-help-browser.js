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
  if (!found) throw new Error('No se encontro Edge o Chrome para la prueba HELP.');
  return found;
}

function json(response, body) {
  response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
}

function fixture() {
  const state = { requests: [] };
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    state.requests.push({ path: url.pathname, search: url.search, method: request.method });
    if (url.pathname === '/favicon.ico') { response.writeHead(204); return response.end(); }
    if (url.pathname.startsWith('/api/')) {
      if (url.pathname === '/api/contexto') return json(response, {
        usuario: 'owner_help', tienda: { nombre: 'Tienda Help' }, plan: { nombre: 'Pro' },
        suscripcion: { estadoEfectivo: 'activa', diasRestantes: 20 }, acceso: {}, caracteristicas: [], limites: {}, uso: {}, soloLectura: false
      });
      if (url.pathname === '/api/lotes/acceso') return json(response, { productosControlados: 0 });
      if (url.pathname === '/api/dashboard') return json(response, { ventasHoy: 0, ventasAyer: 0, ventasSemana: 0, ventasSemanaPasada: 0, ventasMes: 0, ventasMesPasado: 0, bajoStock: 0, fiados: {}, chartVentasDias: [] });
      if (url.pathname === '/api/productos' || url.pathname === '/api/clientes' || url.pathname === '/api/proveedores' || url.pathname === '/api/fiados' || url.pathname === '/api/ventas' || url.pathname === '/api/categorias' || url.pathname === '/api/compras') return json(response, []);
      if (url.pathname === '/api/pos/productos') return json(response, { productos: [] });
      if (url.pathname === '/api/pos/clientes') return json(response, { clientes: [] });
      return json(response, []);
    }
    const relative = url.pathname === '/' ? 'app.html' : url.pathname.slice(1);
    const file = path.resolve(PUBLIC, relative);
    if (!file.startsWith(`${PUBLIC}${path.sep}`) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      response.writeHead(404); return response.end('No encontrado');
    }
    const extension = path.extname(file);
    const type = extension === '.html' ? 'text/html; charset=utf-8' : extension === '.js' ? 'text/javascript; charset=utf-8' : extension === '.css' ? 'text/css; charset=utf-8' : 'application/octet-stream';
    response.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    fs.createReadStream(file).pipe(response);
  });
  return { server, state };
}

async function open(browser, baseUrl, viewport = { width: 1366, height: 768 }) {
  const context = await browser.newContext({ viewport, hasTouch: viewport.width < 768, isMobile: viewport.width < 768 });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${baseUrl}/app.html`);
  await page.locator('#viewTitle').getByText('Inicio').waitFor();
  return { context, page, errors };
}

async function assertViewport(browser, baseUrl, viewport) {
  const session = await open(browser, baseUrl, viewport);
  try {
    await session.page.locator('#helpBtn').click();
    await session.page.locator('#helpCenterTitle').waitFor();
    const overflow = await session.page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    assert.strictEqual(overflow, false, `HELP no debe desbordar a ${viewport.width}x${viewport.height}.`);
    assert.deepStrictEqual(session.errors, [], `Consola limpia a ${viewport.width}x${viewport.height}.`);
  } finally { await session.context.close(); }
}

async function main() {
  const data = fixture();
  const browser = await chromium.launch({ executablePath: executable(), headless: true });
  await new Promise((resolve) => data.server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${data.server.address().port}`;
  try {
    const session = await open(browser, baseUrl);
    const { page } = session;
    await page.locator('#helpBtn').click();
    await page.locator('#helpCenterTitle').waitFor();
    assert.strictEqual(await page.locator('[data-help-category]').count(), 8, 'HELP muestra categorias reales.');

    const search = page.locator('#helpSearch');
    await search.fill('cobranza');
    await page.locator('[data-help-article="registrar-cobranza"]').waitFor();
    assert.match(await page.locator('[data-help-results]').textContent(), /tema/i);
    await search.fill('sin coincidencia disponible');
    await page.locator('.help-empty').waitFor();
    assert.match(await page.locator('[data-help-results]').textContent(), /No encontramos/i, 'La busqueda informa cuando no hay resultados.');
    await page.locator('[data-help-clear]').click();
    assert.strictEqual(await search.inputValue(), '', 'Limpiar busqueda restaura la consulta.');

    await page.locator('[data-help-category="inventario"]').click();
    await page.locator('[data-help-article="compras"]').waitFor();
    await page.locator('[data-help-article="compras"] summary').focus();
    await page.keyboard.press('Enter');
    assert.strictEqual(await page.locator('[data-help-article="compras"]').evaluate((node) => node.open), true, 'Los articulos se abren con teclado.');

    await page.locator('[data-help-back]').click();
    await page.locator('[data-navigation-family="ventas"] summary').click();
    await page.locator('[data-view="ventas"]').click();
    await page.locator('[data-context-help-topic="realizar-venta"]').click();
    await page.locator('[data-help-article="realizar-venta"][open] summary').waitFor();
    assert.strictEqual(await page.locator('[data-help-article="realizar-venta"] summary').evaluate((node) => document.activeElement === node), true, 'La ayuda contextual enfoca el tema correcto.');

    await page.locator('[data-help-welcome]').click();
    await page.locator('.welcome-guide').waitFor();
    assert.strictEqual(await page.locator('.welcome-step').count(), 3, 'HELP reutiliza la guia Welcome existente.');
    assert.deepStrictEqual(session.errors, [], 'HELP mantiene la consola limpia.');
    await session.context.close();

    await assertViewport(browser, baseUrl, { width: 360, height: 800 });
    await assertViewport(browser, baseUrl, { width: 768, height: 1024 });
    await assertViewport(browser, baseUrl, { width: 1366, height: 768 });
    assert(data.state.requests.every((request) => !request.search.includes('idTienda')), 'HELP no envia idTienda en consultas.');
    console.log('test:help-browser OK');
  } finally {
    await browser.close();
    await new Promise((resolve) => data.server.close(resolve));
  }
}

main().catch((error) => {
  console.error(`test:help-browser FAIL: ${error.message}`);
  process.exitCode = 1;
});
