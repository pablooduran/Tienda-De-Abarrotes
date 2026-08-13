const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright-core');

const root = path.resolve(__dirname, '..');
const publicDir = path.join(root, 'public');

function executable() {
  const candidates = [
    process.env.BROWSER_EXECUTABLE_PATH,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
  ].filter(Boolean);
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) throw new Error('No se encontro Edge local para la prueba de navegacion.');
  return found;
}

function json(response, body) {
  response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
}

function context() {
  return {
    tienda: { nombre: 'Tienda navegacion' },
    plan: { nombre: 'Pro' },
    suscripcion: { fechaFin: '2026-12-31 00:00:00', diasRestantes: 120 },
    caracteristicas: [
      'gastos', 'reportes_financieros', 'anulaciones_operativas', 'cierre_caja',
      'inventario_resumen', 'historial_stock', 'ajuste_stock', 'control_lotes',
      'clientes_basico', 'fiados_basico', 'pagos_fiado'
    ]
  };
}

function dashboard() {
  return {
    ventasHoy: 0, ventasAyer: 0, ventasMes: 0, ventasMesPasado: 0,
    gananciaHoy: 0, gananciaMes: 0, bajoStock: 0, fiados: {}, chartVentasDias: []
  };
}

function createServer(requests) {
  return http.createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    requests.push({ method: request.method, path: url.pathname, search: url.search });
    if (url.pathname.startsWith('/api/')) {
      if (url.pathname === '/api/contexto') return json(response, context());
      if (url.pathname === '/api/lotes/acceso') return json(response, { productosControlados: 0 });
      if (url.pathname === '/api/dashboard') return json(response, dashboard());
      if (['/api/productos', '/api/clientes', '/api/proveedores', '/api/fiados', '/api/ventas', '/api/categorias'].includes(url.pathname)) return json(response, []);
      return json(response, { rows: [], resultados: [], paginas: 1 });
    }
    if (url.pathname === '/favicon.ico') {
      response.writeHead(204);
      return response.end();
    }
    const relative = url.pathname === '/' ? 'app.html' : url.pathname.slice(1);
    const file = path.resolve(publicDir, relative);
    if (!file.startsWith(`${publicDir}${path.sep}`) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      response.writeHead(404);
      return response.end('No encontrado');
    }
    const extension = path.extname(file);
    const contentType = extension === '.html' ? 'text/html; charset=utf-8'
      : extension === '.js' ? 'text/javascript; charset=utf-8'
        : extension === '.css' ? 'text/css; charset=utf-8' : 'application/octet-stream';
    response.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-store' });
    fs.createReadStream(file).pipe(response);
  });
}

async function verifyViewport(browser, baseUrl, viewport, includeKeyboard) {
  const browserContext = await browser.newContext({
    viewport,
    hasTouch: !includeKeyboard,
    isMobile: !includeKeyboard
  });
  const page = await browserContext.newPage();
  const errors = [];
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await page.goto(`${baseUrl}/app.html`);
    await page.locator('[data-navigation-family="inicio"]').waitFor();
    assert.strictEqual(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2), true,
      `La navegacion genera overflow a ${viewport.width}px.`);

    const families = await page.locator('[data-navigation-family]').evaluateAll((nodes) => nodes.map((node) => node.dataset.navigationFamily));
    assert.deepStrictEqual(families, ['inicio', 'ventas', 'inventario', 'clientes', 'reportes', 'administracion', 'plan']);
    assert.strictEqual(await page.locator('[data-navigation-family="ventas"] [data-view="compensaciones"]').textContent(), 'Devoluciones y anulaciones');
    assert.strictEqual(await page.locator('[data-navigation-family="plan"] a[href="/suscripcion.html"]').count(), 1);
    assert.strictEqual(await page.locator('#subscriptionSummary').evaluate((element) => element.tagName), 'P');

    const sales = page.locator('[data-navigation-family="ventas"] > summary');
    if (includeKeyboard) {
      await sales.focus();
      await page.keyboard.press('Enter');
    } else {
      await sales.tap();
    }
    assert.strictEqual(await page.locator('[data-navigation-family="ventas"]').evaluate((node) => node.open), true);
    await page.locator('[data-navigation-family="ventas"] [data-view="ventas"]').click();
    await page.locator('#viewTitle').waitFor({ state: 'visible' });
    assert.strictEqual(await page.locator('#viewTitle').textContent(), 'Punto de venta');
    assert.strictEqual(await page.locator('[data-navigation-family="ventas"] [data-view="ventas"]').evaluate((node) => node.classList.contains('active')), true);

    await page.locator('[data-navigation-family="reportes"] > summary').click();
    await page.locator('[data-navigation-family="reportes"] [data-view="reportes"]').click();
    assert.strictEqual(await page.locator('#viewTitle').textContent(), 'Reportes');
    assert.deepStrictEqual(errors, [], `Consola limpia a ${viewport.width}x${viewport.height}.`);
  } finally {
    await browserContext.close();
  }
}

async function main() {
  const requests = [];
  const server = createServer(requests);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ executablePath: executable(), headless: true });
  try {
    await verifyViewport(browser, baseUrl, { width: 360, height: 800 }, true);
    await verifyViewport(browser, baseUrl, { width: 768, height: 1024 }, false);
    await verifyViewport(browser, baseUrl, { width: 1366, height: 768 }, false);
    assert(requests.every((request) => !request.search.includes('idTienda')), 'La navegacion envio idTienda.');
    assert(requests.every((request) => request.path.startsWith('/api/') || request.path.startsWith('/js/') || request.path.startsWith('/css/') || request.path === '/app.html' || request.path === '/favicon.ico'), 'El arnes uso una ruta inesperada.');
    console.log('test:product-navigation-browser OK');
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error(`test:product-navigation-browser FAIL: ${error.message}`);
  process.exitCode = 1;
});
