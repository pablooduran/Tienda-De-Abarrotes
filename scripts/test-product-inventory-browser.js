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
  return { tienda: { nombre: 'Tienda inventario' }, plan: { nombre: 'Pro' }, suscripcion: { fechaFin: '2026-12-31 00:00:00', diasRestantes: 120 }, caracteristicas: ['inventario_resumen', 'historial_stock', 'ajuste_stock', 'control_lotes', 'alertas_vencimiento', 'trazabilidad_lotes', 'gastos'] };
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
      if (url.pathname === '/api/movimientos-stock') {
        if (url.searchParams.get('tipo') === 'ajuste_positivo') { response.writeHead(503, { 'Content-Type': 'application/json' }); return response.end(JSON.stringify({ error: 'Consulta temporalmente no disponible' })); }
        return json(response, { page: 1, pages: 1, rows: [], responsables: [] });
      }
      if (url.pathname === '/api/gastos/categorias') return json(response, []);
      if (url.pathname === '/api/gastos') {
        if (url.searchParams.get('metodoPago') === 'transferencia') { response.writeHead(503, { 'Content-Type': 'application/json' }); return response.end(JSON.stringify({ error: 'Consulta temporalmente no disponible' })); }
        return json(response, { gastos: [], montoVigente: 0, total: 0 });
      }
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
  await page.locator(`[data-navigation-family="inventario"] [data-view="${id}"].active`).waitFor();
}

async function verifyViewport(browser, baseUrl, viewport, requests) {
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
    assert.strictEqual(await page.locator('.inventory-workspace-nav').isVisible(), viewport.width <= 900,
      'La subnavegacion solo debe mostrarse cuando el menu lateral pasa arriba.');
    assert.strictEqual(await page.locator('.row-actions > summary').first().textContent(), 'Más opciones', 'Acciones secundarias agrupadas.');
    await page.locator('.filter-disclosure > summary').click();
    assert.strictEqual(await page.locator('[data-apply-product-filters]').count(), 1, 'Aplicar filtros de Productos.');
    assert.strictEqual(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2), true, `Overflow a ${viewport.width}px.`);
    await inventoryView(page, 'movimientosStock');
    await page.locator('#view h3').filter({ hasText: 'Stock y movimientos' }).waitFor();
    assert.strictEqual(await page.locator('text=Stock y movimientos').count() > 0, true, 'Encabezado de movimientos.');
    assert.strictEqual(await page.locator('#movementSearch').isVisible(), true, 'Buscar producto permanece visible.');
    assert.strictEqual(await page.locator('#movementFilterDialog').isVisible(), false, 'Filtros avanzados cerrados inicialmente.');
    await page.locator('#openMovementFilters').click();
    assert.strictEqual(await page.locator('#movementFilterDialog').isVisible(), true, 'Filtros de movimientos en ventana.');
    await page.locator('#movementType').selectOption('entrada');
    await page.locator('#closeMovementFilters').click();
    await page.waitForFunction(() => document.querySelector('#movementType')?.value === '');
    assert.strictEqual(await page.locator('#movementType').inputValue(), '', 'Cerrar descarta el borrador.');
    await page.locator('#openMovementFilters').click();
    await page.locator('#movementType').selectOption('salida');
    await page.locator('#movementFilters button[type="submit"]').click();
    await page.locator('#movementFilterDialog').waitFor({ state: 'hidden' });
    assert(requests.some((request) => request.path === '/api/movimientos-stock' && request.search.includes('tipo=salida')), 'Aplicar consulta el tipo elegido.');
    assert.strictEqual(await page.evaluate(() => document.activeElement?.id), 'openMovementFilters', 'Al cerrar vuelve el foco.');
    await page.locator('#movementSearch').fill('Arroz');
    await page.locator('#searchMovements').click();
    assert(requests.some((request) => request.path === '/api/movimientos-stock' && request.search.includes('q=Arroz') && request.search.includes('tipo=salida')), 'La búsqueda visible conserva filtros aplicados.');
    const movementResults = await page.locator('#movementResults').innerHTML();
    await page.locator('#openMovementFilters').click();
    await page.locator('#movementType').selectOption('ajuste_positivo');
    await page.locator('#movementFilters button[type="submit"]').click();
    await page.locator('#movementFilterError:visible').waitFor();
    assert.strictEqual(await page.locator('#movementResults').innerHTML(), movementResults, 'El error conserva los resultados previos.');
    await page.locator('#closeMovementFilters').click();
    await page.waitForFunction(() => document.querySelector('#movementType')?.value === 'salida');
    const reportFamily = page.locator('[data-navigation-family="reportes"]');
    if (!await reportFamily.evaluate((node) => node.open)) await reportFamily.locator('> summary').click();
    await page.locator('[data-view="gastos"]').click();
    await page.locator('#expenseList').waitFor();
    assert.strictEqual(await page.locator('#expenseFilterDialog').isVisible(), false, 'Filtros de gastos cerrados inicialmente.');
    await page.locator('#openExpenseFilters').click();
    await page.locator('#expenseFilters [name="metodoPago"]').selectOption('qr');
    await page.locator('#closeExpenseFilters').click();
    await page.waitForFunction(() => document.querySelector('#expenseFilters [name="metodoPago"]')?.value === '');
    assert.strictEqual(await page.locator('#expenseFilters [name="metodoPago"]').inputValue(), '', 'Cancelar gastos no aplica el borrador.');
    await page.locator('#openExpenseFilters').click();
    await page.locator('#expenseFilters [name="metodoPago"]').selectOption('efectivo');
    await page.locator('#expenseFilters button[type="submit"]').click();
    await page.locator('#expenseFilterDialog').waitFor({ state: 'hidden' });
    assert(requests.some((request) => request.path === '/api/gastos' && request.search.includes('metodoPago=efectivo')), 'Gastos consulta filtros aplicados.');
    assert.strictEqual(await page.evaluate(() => document.activeElement?.id), 'openExpenseFilters', 'Gastos devuelve foco al botón.');
    const expenseResults = await page.locator('#expenseList').innerHTML();
    await page.locator('#openExpenseFilters').click();
    await page.locator('#expenseFilters [name="metodoPago"]').selectOption('transferencia');
    await page.locator('#expenseFilters button[type="submit"]').click();
    await page.locator('#expenseFilterError:visible').waitFor();
    assert.strictEqual(await page.locator('#expenseList').innerHTML(), expenseResults, 'El error de gastos conserva la lista previa.');
    await page.locator('#closeExpenseFilters').click();
    await page.waitForFunction(() => document.querySelector('#expenseFilters [name="metodoPago"]')?.value === 'efectivo');
    await inventoryView(page, 'compras');
    await page.locator('#view').getByText('1. Proveedor y productos').waitFor();
    assert.strictEqual(await page.locator('text=1. Proveedor y productos').count(), 1, 'Paso inicial de compra.');
    assert.strictEqual(await page.locator('text=3. Confirmación').count(), 1, 'Paso de confirmacion de compra.');
    assert.strictEqual(errors.filter((error) => error.includes('status of 503')).length, 2, 'Solo fallan las dos consultas simuladas.');
    assert.deepStrictEqual(errors.filter((error) => !error.includes('status of 503')), [], `Sin errores inesperados a ${viewport.width}x${viewport.height}.`);
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
    for (const viewport of [{ width: 360, height: 800 }, { width: 768, height: 1024 }, { width: 1366, height: 768 }]) await verifyViewport(browser, baseUrl, viewport, requests);
    assert(requests.every((request) => !request.search.includes('idTienda')), 'La interfaz envio idTienda.');
    console.log('test:product-inventory-browser OK');
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => { console.error(`test:product-inventory-browser FAIL: ${error.message}`); process.exitCode = 1; });
