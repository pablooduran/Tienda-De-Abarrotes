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
  return { tienda: { nombre: 'Tienda inventario' }, plan: { nombre: 'Pro' }, suscripcion: { fechaFin: '2026-12-31 00:00:00', diasRestantes: 120 }, caracteristicas: ['inventario_resumen', 'historial_stock', 'ajuste_stock', 'control_lotes', 'alertas_vencimiento', 'trazabilidad_lotes'] };
}

function serverFor(requests) {
  return http.createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    requests.push({ path: url.pathname, search: url.search });
    if (url.pathname.startsWith('/api/')) {
      if (url.pathname === '/api/contexto') return json(response, context());
      if (url.pathname === '/api/lotes/acceso') return json(response, { productosControlados: 0 });
      if (url.pathname === '/api/dashboard') return json(response, { ventasHoy: 0, ventasAyer: 0, ventasMes: 0, ventasMesPasado: 0, gananciaHoy: 0, gananciaMes: 0, bajoStock: 0, fiados: {}, chartVentasDias: [] });
      if (url.pathname === '/api/productos') return json(response, [{ idProducto: 1, nombre: 'Arroz prueba', categoria: 'Granos', proveedor: 'Proveedor prueba', precioVenta: 10, stockUnidadesTotal: 8, unidadesPorPaquete: 1, activo: 1, bajoStock: false, controlaLotes: 0 }]);
      if (['/api/clientes', '/api/proveedores', '/api/fiados', '/api/ventas', '/api/categorias'].includes(url.pathname)) return json(response, []);
      if (url.pathname === '/api/movimientos-stock') return json(response, { page: 1, pages: 1, rows: [], responsables: [] });
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

async function inventoryView(page, id) {
  const inventoryFamily = page.locator('[data-navigation-family="inventario"]');
  if (!await inventoryFamily.evaluate((node) => node.open)) await inventoryFamily.locator('> summary').click();
  await page.locator(`[data-view="${id}"]`).click();
  await page.locator(`[data-inventory-workspace="${id}"].active`).waitFor();
}

async function verifyViewport(browser, baseUrl, viewport) {
  const context = await browser.newContext({ viewport, isMobile: viewport.width === 360, hasTouch: viewport.width !== 1366 });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await page.goto(`${baseUrl}/app.html`);
    await inventoryView(page, 'productos');
    assert.strictEqual(await page.locator('#addProduct').textContent(), 'Agregar producto', 'Accion primaria de Productos.');
    assert.strictEqual(await page.locator('.inventory-workspace-nav button').count() >= 5, true, 'Subnavegacion de inventario.');
    assert.strictEqual(await page.locator('.row-actions > summary').first().textContent(), 'Más opciones', 'Acciones secundarias agrupadas.');
    await page.locator('.filter-disclosure > summary').click();
    assert.strictEqual(await page.locator('[data-apply-product-filters]').count(), 1, 'Aplicar filtros de Productos.');
    assert.strictEqual(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2), true, `Overflow a ${viewport.width}px.`);
    await inventoryView(page, 'movimientosStock');
    assert.strictEqual(await page.locator('text=Stock y movimientos').count() > 0, true, 'Encabezado de movimientos.');
    assert.strictEqual(await page.locator('.filter-disclosure').count(), 1, 'Filtros compactos de movimientos.');
    await inventoryView(page, 'compras');
    assert.strictEqual(await page.locator('text=1. Proveedor y productos').count(), 1, 'Paso inicial de compra.');
    assert.strictEqual(await page.locator('text=3. Confirmación').count(), 1, 'Paso de confirmacion de compra.');
    assert.deepStrictEqual(errors, [], `Consola limpia a ${viewport.width}x${viewport.height}.`);
  } finally { await context.close(); }
}

async function main() {
  if (!edge) throw new Error('No se encontro Edge local para PRODUCTO-1 P3.');
  const requests = [];
  const server = serverFor(requests);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ executablePath: edge, headless: true });
  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    for (const viewport of [{ width: 360, height: 800 }, { width: 768, height: 1024 }, { width: 1366, height: 768 }]) await verifyViewport(browser, baseUrl, viewport);
    assert(requests.every((request) => !request.search.includes('idTienda')), 'La interfaz envio idTienda.');
    console.log('test:product-inventory-browser OK');
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => { console.error(`test:product-inventory-browser FAIL: ${error.message}`); process.exitCode = 1; });
