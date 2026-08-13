const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright-core');

const root = path.resolve(__dirname, '..');
const publicDir = path.join(root, 'public');
const edge = [process.env.BROWSER_EXECUTABLE_PATH, 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'].find((file) => file && fs.existsSync(file));

function json(response, body) {
  response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
}

function context() {
  return {
    tienda: { nombre: 'Tienda ventas' },
    plan: { nombre: 'Pro' },
    suscripcion: { fechaFin: '2026-12-31 00:00:00', diasRestantes: 120 },
    caracteristicas: ['punto_venta', 'clientes_basico', 'fiados_basico', 'pagos_fiado', 'anulaciones_operativas']
  };
}

function product() {
  return {
    idProducto: 1, nombre: 'Arroz prueba', categoria: 'Granos', proveedor: 'Proveedor prueba', precioVenta: 10,
    stockUnidadesTotal: 8, unidadesPorPaquete: 1, activo: 1, bajoStock: false, controlaLotes: 0,
    permiteVentaPorUnidad: 1, permiteVentaPorPaquete: 0, favoritoPos: 0, unidadMedida: 'unidad'
  };
}

function serverFor(requests) {
  return http.createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    requests.push({ path: url.pathname, search: url.search });
    if (url.pathname.startsWith('/api/')) {
      if (url.pathname === '/api/contexto') return json(response, context());
      if (url.pathname === '/api/lotes/acceso') return json(response, { productosControlados: 0 });
      if (url.pathname === '/api/dashboard') return json(response, { ventasHoy: 0, ventasAyer: 0, ventasMes: 0, ventasMesPasado: 0, gananciaHoy: 0, gananciaMes: 0, bajoStock: 0, fiados: {}, chartVentasDias: [] });
      if (['/api/productos', '/api/proveedores', '/api/fiados', '/api/ventas', '/api/categorias'].includes(url.pathname)) return json(response, []);
      if (url.pathname === '/api/pos/recientes' || url.pathname === '/api/pos/productos') return json(response, { productos: [product()] });
      if (url.pathname === '/api/pos/clientes') return json(response, { clientes: [{ idCliente: 7, nombre: 'Ana Cliente', telefono: '70000000' }], pagina: 1, limite: 15, total: 1, hayMas: false });
      return json(response, { rows: [], resultados: [], paginas: 1, page: 1, pages: 1, resumen: {}, paginacion: { page: 1, totalPages: 1 } });
    }
    if (url.pathname === '/favicon.ico') { response.writeHead(204); return response.end(); }
    const relative = url.pathname === '/' ? 'app.html' : url.pathname.slice(1);
    const file = path.resolve(publicDir, relative);
    if (!file.startsWith(`${publicDir}${path.sep}`) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { response.writeHead(404); return response.end(); }
    const extension = path.extname(file);
    response.writeHead(200, { 'Content-Type': extension === '.html' ? 'text/html; charset=utf-8' : extension === '.css' ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
    fs.createReadStream(file).pipe(response);
  });
}

async function salesView(page, id) {
  const family = page.locator('[data-navigation-family="ventas"]');
  if (!await family.evaluate((node) => node.open)) await family.locator('> summary').click();
  await page.locator(`[data-view="${id}"]`).click();
  await page.locator(`[data-sales-workspace="${id}"].active`).waitFor();
}

async function verifyViewport(browser, baseUrl, viewport) {
  const context = await browser.newContext({ viewport, isMobile: viewport.width === 360, hasTouch: viewport.width !== 1366 });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await page.goto(`${baseUrl}/app.html`);
    await salesView(page, 'ventas');
    assert.strictEqual(await page.locator('#posClient').getAttribute('type'), 'hidden');
    assert.strictEqual(await page.locator('#posClientSearch').getAttribute('role'), 'combobox');
    await page.locator('#posClientSearch').fill('A');
    await page.waitForFunction(() => document.getElementById('posClientStatus').textContent === 'Escribe al menos 2 caracteres para buscar.');
    assert.strictEqual(await page.locator('#posClientStatus').textContent(), 'Escribe al menos 2 caracteres para buscar.');
    await page.locator('#posClientSearch').fill('Ana');
    await page.locator('[data-pos-client-option="0"]').waitFor();
    await page.locator('#posClientSearch').press('ArrowDown');
    await page.locator('#posClientSearch').press('Enter');
    assert.strictEqual(await page.locator('#posClient').inputValue(), '7');
    assert.strictEqual(await page.locator('#posClientClear').isVisible(), true);
    await page.locator('#posClientClear').click();
    assert.strictEqual(await page.locator('#posClient').inputValue(), '');
    await salesView(page, 'historialVentas');
    assert.strictEqual(await page.locator('text=Historial de ventas').count() > 0, true);
    assert.strictEqual(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2), true, `Overflow a ${viewport.width}px.`);
    assert.deepStrictEqual(errors, [], `Consola limpia a ${viewport.width}x${viewport.height}.`);
  } finally {
    await context.close();
  }
}

async function main() {
  if (!edge) throw new Error('No se encontro Edge local para PRODUCTO-1 P4.');
  const requests = [];
  const server = serverFor(requests);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ executablePath: edge, headless: true });
  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    for (const viewport of [{ width: 360, height: 800 }, { width: 768, height: 1024 }, { width: 1366, height: 768 }]) await verifyViewport(browser, baseUrl, viewport);
    const searches = requests.filter((request) => request.path === '/api/pos/clientes');
    assert(searches.length >= 3, 'No se consulto el buscador POS.');
    assert(searches.every((request) => request.search.includes('page=1') && request.search.includes('limit=15') && !request.search.includes('idTienda')), 'Busqueda POS sin paginacion segura.');
    console.log('test:product-sales-clients-browser OK');
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => { console.error(`test:product-sales-clients-browser FAIL: ${error.message}`); process.exitCode = 1; });
