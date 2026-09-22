const assert = require('assert/strict');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright-core');

const publicDir = path.resolve(__dirname, '..', 'public');
const store = {
  idTienda: 1, nombre: 'Tienda sintética', slug: 'tienda-sintetica', activo: 1,
  estado: 'activa', planNombre: 'Basic', estadoSuscripcionEfectivo: 'activa',
  cantidadPropietarios: 0, cantidadProductos: 0, cantidadClientes: 0
};
const suspendedStore = {
  idTienda: 2, nombre: 'Mercado sintético', slug: 'mercado-sintetico', activo: 0,
  estado: 'suspendida', planNombre: 'Standard', estadoSuscripcionEfectivo: 'vencida',
  cantidadPropietarios: 0, cantidadProductos: 0, cantidadClientes: 0
};

function browserPath() {
  const candidates = [process.env.BROWSER_EXECUTABLE_PATH,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'].filter(Boolean);
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) throw new Error('Se requiere Edge o Chromium local.');
  return found;
}

function json(response, data) {
  response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(data));
}

function fixture() {
  return http.createServer((request, response) => {
    const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
    if (pathname === '/auth/status') return json(response, { authenticated: true, admin: { rol: 'superadmin', usuario: 'admin_sintetico' } });
    if (pathname === '/api/admin/planes') return json(response, []);
    if (pathname === '/api/admin/tiendas') return json(response, [store, suspendedStore]);
    if (pathname === '/api/admin/tiendas/1') return json(response, store);
    if (pathname === '/api/admin/tiendas/1/propietarios') return json(response, []);
    if (pathname === '/api/admin/tiendas/1/suscripciones') return json(response, []);
    if (pathname === '/api/admin/catalogo/resumen') return json(response, { productos: 0, productosActivos: 0, categorias: 0, marcas: 0 });
    if (pathname === '/api/admin/catalogo/categorias' || pathname === '/api/admin/catalogo/marcas') return json(response, []);
    if (pathname === '/api/admin/catalogo/productos') return json(response, { rows: [], page: 1, pages: 1 });
    if (pathname === '/favicon.ico') { response.writeHead(204); return response.end(); }
    const file = path.resolve(publicDir, pathname.slice(1));
    if (!file.startsWith(`${publicDir}${path.sep}`) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      response.writeHead(404); return response.end('No encontrado');
    }
    const ext = path.extname(file);
    response.writeHead(200, { 'Content-Type': ext === '.js' ? 'text/javascript' : ext === '.css' ? 'text/css' : 'text/html' });
    fs.createReadStream(file).pipe(response);
  });
}

async function verify(browser, baseUrl, width) {
  const page = await browser.newPage({ viewport: { width, height: 800 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  try {
    await page.goto(`${baseUrl}/admin.html#tiendas`);
    const detailButton = page.locator('#storesTableBody .table-action').first();
    await detailButton.waitFor();
    assert.strictEqual(await page.locator('#storesTableBody tr').count(), 2);
    const before = await page.locator('.admin-main').evaluate((node) => node.scrollTop);
    await detailButton.click();
    await page.locator('#storeDetail[open]').waitFor();
    assert.strictEqual(await page.locator('#storeDetail').evaluate((node) => node.matches(':modal')), true);
    assert.strictEqual(await page.locator('.admin-main').evaluate((node) => node.scrollTop), before,
      'El detalle no debe desplazar la lista.');
    assert.strictEqual(await page.evaluate(() => document.activeElement.id), 'closeStoreDetail');
    await page.keyboard.press('Escape');
    await page.locator('#storeDetail[open]').waitFor({ state: 'detached' });
    assert.strictEqual(await detailButton.evaluate((node) => document.activeElement === node), true,
      'El foco debe volver al boton Ver detalle.');
    await detailButton.click();
    await page.locator('#closeStoreDetail').click();
    assert.strictEqual(await page.locator('#storeDetail').evaluate((node) => node.open), false);
    const filterButton = page.locator('#openStoreFilters');
    await filterButton.click();
    await page.locator('#storeFilterDialog[open]').waitFor();
    assert.strictEqual(await page.locator('#storeFilterDialog').evaluate((node) => node.matches(':modal')), true);
    await page.locator('#storeFilters select[name="estado"]').selectOption('suspendida');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.querySelector('#storeFilters select[name="estado"]').value === '');
    assert.strictEqual(await page.locator('#storesTableBody tr').count(), 2, 'Cerrar no debe aplicar filtros.');
    assert.strictEqual(await filterButton.evaluate((node) => document.activeElement === node), true);
    await filterButton.click();
    await page.locator('#storeFilters select[name="estado"]').selectOption('suspendida');
    await page.locator('#storeFilters select[name="suscripcion"]').selectOption('vencida');
    await page.locator('#storeFilters button[type="submit"]').click();
    await page.waitForFunction(() => document.activeElement?.id === 'openStoreFilters');
    assert.strictEqual(await filterButton.textContent(), 'Filtros (2)');
    assert.strictEqual(await page.locator('#storesTableBody tr').count(), 1);
    assert.match(await page.locator('#storesTableBody').textContent(), /Mercado sintético/);
    await page.locator('#storeSearch').fill('tienda');
    assert.strictEqual(await page.locator('#storesTableBody tr').count(), 0, 'La búsqueda visible debe combinarse con los filtros.');
    await page.locator('#storeSearch').fill('');
    assert.strictEqual(await page.locator('#storesTableBody tr').count(), 1);
    await page.locator('.admin-sidebar a[href="#catalogo"]').click();
    assert.strictEqual(await page.locator('#catalogo').isVisible(), true);
    assert.strictEqual(await page.locator('#tiendas').isVisible(), false);
    assert.strictEqual(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), true);
    assert.deepStrictEqual(errors, []);
  } finally {
    await page.close();
  }
}

async function main() {
  const server = fixture();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ executablePath: browserPath(), headless: true });
  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    await verify(browser, baseUrl, 360);
    await verify(browser, baseUrl, 768);
    await verify(browser, baseUrl, 1366);
    console.log('test:admin-store-detail-browser OK');
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error(`test:admin-store-detail-browser FAIL: ${error.message}`);
  process.exitCode = 1;
});
