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

function fixture(catalogQueries) {
  return http.createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    const pathname = url.pathname;
    if (pathname === '/auth/status') return json(response, { authenticated: true, admin: { rol: 'superadmin', usuario: 'admin_sintetico' } });
    if (pathname === '/api/admin/resumen-plataforma') return json(response, {
      tiendas: { total: 2, activas: 1, inactivas: 1 },
      suscripciones: { pruebas: 0, vencidas: 1, pendientes: 0 },
      ventas: { cantidad: 0, total: 0 },
      pagosPendientes: 0
    });
    if (pathname === '/api/admin/planes') return json(response, []);
    if (pathname === '/api/admin/tiendas') return json(response, [store, suspendedStore]);
    if (pathname === '/api/admin/tiendas/1') return json(response, store);
    if (pathname === '/api/admin/tiendas/1/propietarios') return json(response, []);
    if (pathname === '/api/admin/tiendas/1/suscripciones') return json(response, []);
    if (pathname === '/api/admin/catalogo/resumen') return json(response, { productos: 2, productosActivos: 1, categorias: 2, marcas: 2 });
    if (pathname === '/api/admin/catalogo/categorias') return json(response, [
      { idCategoriaMaestra: 1, nombre: 'Abarrotes', activo: 1 },
      { idCategoriaMaestra: 2, nombre: 'Bebidas', activo: 1 }
    ]);
    if (pathname === '/api/admin/catalogo/marcas') return json(response, [
      { idMarcaMaestra: 1, nombre: 'Marca Uno', activo: 1 },
      { idMarcaMaestra: 2, nombre: 'Marca Dos', activo: 1 }
    ]);
    if (pathname === '/api/admin/catalogo/productos') {
      catalogQueries.push(url.searchParams.toString());
      const rows = [
        { idProductoMaestro: 1, nombre: 'Arroz sintético', categoria: 'Abarrotes', marca: 'Marca Uno', idCategoriaMaestra: 1, idMarcaMaestra: 1, activo: 1 },
        { idProductoMaestro: 2, nombre: 'Jugo sintético', categoria: 'Bebidas', marca: 'Marca Dos', idCategoriaMaestra: 2, idMarcaMaestra: 2, activo: 0 }
      ].filter((row) => (!url.searchParams.get('q') || row.nombre.toLowerCase().includes(url.searchParams.get('q').toLowerCase()))
        && (!url.searchParams.get('idCategoriaMaestra') || String(row.idCategoriaMaestra) === url.searchParams.get('idCategoriaMaestra'))
        && (!url.searchParams.get('idMarcaMaestra') || String(row.idMarcaMaestra) === url.searchParams.get('idMarcaMaestra'))
        && (!url.searchParams.has('activo') || String(Boolean(row.activo)) === url.searchParams.get('activo')));
      return json(response, { rows, page: 1, pages: 1 });
    }
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

async function verify(browser, baseUrl, width, catalogQueries) {
  const page = await browser.newPage({ viewport: { width, height: 800 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('response', (response) => { if (response.status() === 404) errors.push(`404 ${response.url()}`); });
  try {
    await page.goto(`${baseUrl}/admin.html#tiendas`);
    const pageWidth = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      widest: [...document.querySelectorAll('body *')].map((node) => {
        const bounds = node.getBoundingClientRect();
        return { tag: node.tagName, className: node.className, id: node.id, left: bounds.left, right: bounds.right, width: bounds.width };
      }).sort((a, b) => b.right - a.right).slice(0, 3)
    }));
    assert(pageWidth.scrollWidth <= pageWidth.clientWidth + 1,
      `La vista administrativa no debe desbordar horizontalmente: ${JSON.stringify(pageWidth)}`);
    if (width <= 900) {
      const responsiveLayout = await page.evaluate(() => ({
        mainWidth: Math.round(document.querySelector('.admin-main').getBoundingClientRect().width),
        sidebarWidth: Math.round(document.querySelector('.admin-sidebar').getBoundingClientRect().width),
        viewportWidth: window.innerWidth
      }));
      assert(responsiveLayout.mainWidth >= responsiveLayout.viewportWidth - 1, 'El contenido debe usar todo el ancho movil.');
      assert.strictEqual(responsiveLayout.sidebarWidth, 0, 'La navegación cerrada no debe quitar ancho al contenido.');
      await page.locator('#adminSidebarToggle').click();
      assert.strictEqual(await page.locator('.admin-shell').evaluate((node) => node.classList.contains('sidebar-expanded')), true);
      await page.waitForFunction(() => document.querySelector('.admin-sidebar').getBoundingClientRect().width > 240);
      await page.locator('#adminSidebarToggle').click();
    }
    const detailButton = page.locator('#storesTableBody .table-action').first();
    await detailButton.waitFor();
    assert.strictEqual(await page.locator('#storesTableBody tr').count(), 2, 'Deben cargarse las dos tiendas de prueba.');
    await detailButton.evaluate((node) => node.scrollIntoView({ block: 'center' }));
    const before = await page.locator('.admin-main').evaluate((node) => node.scrollTop);
    if (width <= 900) {
      await detailButton.focus();
      await detailButton.evaluate((node) => node.click());
    }
    else await detailButton.click();
    await page.locator('#storeDetail[open]').waitFor();
    assert.strictEqual(await page.locator('#storeDetail').evaluate((node) => node.matches(':modal')), true);
    if (width > 760) {
      assert.strictEqual(await page.locator('.admin-main').evaluate((node) => node.scrollTop), before,
        'El detalle no debe desplazar la lista.');
    }
    assert.strictEqual(await page.evaluate(() => document.activeElement.id), 'closeStoreDetail');
    await page.keyboard.press('Escape');
    await page.locator('#storeDetail[open]').waitFor({ state: 'detached' });
    if (width <= 900) {
      const restored = await page.locator('.admin-main').evaluate((node) => node.scrollTop);
      assert(Math.abs(restored - before) < 2,
        `Al cerrar el detalle móvil debe recuperarse la posición de la lista: antes=${before}, después=${restored}.`);
    }
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
    if (width <= 900) await page.locator('#adminSidebarToggle').click();
    await page.locator('.admin-sidebar a[href="#catalogo"]').click();
    assert.strictEqual(await page.locator('#catalogo').isVisible(), true);
    assert.strictEqual(await page.locator('#tiendas').isVisible(), false);
    assert.strictEqual(await page.locator('#masterProductsTableBody tr').count(), 2);
    const catalogFilterButton = page.locator('#openMasterCatalogFilters');
    const beforeCancel = catalogQueries.length;
    await catalogFilterButton.click();
    await page.locator('#masterCatalogFilterDialog[open]').waitFor();
    assert.strictEqual(await page.locator('#masterCatalogFilterDialog').evaluate((node) => node.matches(':modal')), true);
    await page.locator('#masterCategoryFilter').selectOption('1');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.querySelector('#masterCategoryFilter').value === '');
    assert.strictEqual(catalogQueries.length, beforeCancel, 'Cerrar no debe consultar con filtros nuevos.');
    assert.strictEqual(await catalogFilterButton.evaluate((node) => document.activeElement === node), true);
    await catalogFilterButton.click();
    await page.locator('#masterCategoryFilter').selectOption('1');
    await page.locator('#masterBrandFilter').selectOption('1');
    await page.locator('#masterStatusFilter').selectOption('true');
    assert.strictEqual(catalogQueries.length, beforeCancel, 'Cambiar opciones no debe recargar la lista.');
    await page.locator('#masterCatalogFilters button[type="submit"]').click();
    await page.waitForFunction(() => document.activeElement?.id === 'openMasterCatalogFilters');
    assert.strictEqual(await catalogFilterButton.textContent(), 'Filtros (3)');
    assert.strictEqual(await page.locator('#masterProductsTableBody tr').count(), 1);
    assert.match(await page.locator('#masterProductsTableBody').textContent(), /Arroz sintético/);
    const applied = new URLSearchParams(catalogQueries.at(-1));
    assert.strictEqual(applied.get('idCategoriaMaestra'), '1');
    assert.strictEqual(applied.get('idMarcaMaestra'), '1');
    assert.strictEqual(applied.get('activo'), 'true');
    await page.locator('#masterProductSearch').fill('Jugo');
    await page.waitForFunction(() => document.querySelector('#emptyMasterProducts').hidden === false);
    assert.strictEqual(await page.locator('#masterProductsTableBody tr').count(), 0, 'La búsqueda visible debe combinarse con filtros aplicados.');
    assert.strictEqual(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), true);
    assert.deepStrictEqual(errors, []);
  } finally {
    await page.close();
  }
}

async function verifyCatalogFailure(browser, baseUrl) {
  const page = await browser.newPage();
  try {
    await page.goto(`${baseUrl}/admin.html#catalogo`);
    await page.locator('#masterProductsTableBody tr').first().waitFor();
    await page.route('**/api/admin/catalogo/productos?*', (route) => route.fulfill({
      status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Servicio temporalmente no disponible.' })
    }));
    await page.locator('#openMasterCatalogFilters').click();
    await page.locator('#masterStatusFilter').selectOption('false');
    await page.locator('#masterCatalogFilters button[type="submit"]').click();
    await page.locator('#masterCatalogFilterError:not([hidden])').waitFor();
    assert.strictEqual(await page.locator('#masterCatalogFilterDialog').evaluate((node) => node.open), true);
    assert.strictEqual(await page.locator('#masterProductsTableBody tr').count(), 2,
      'La lista anterior debe conservarse si falla la carga.');
    await page.locator('#closeMasterCatalogFilters').click();
    await page.waitForFunction(() => document.querySelector('#masterStatusFilter').value === '');
  } finally {
    await page.close();
  }
}

async function main() {
  const catalogQueries = [];
  const server = fixture(catalogQueries);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ executablePath: browserPath(), headless: true });
  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    await verify(browser, baseUrl, 360, catalogQueries);
    await verify(browser, baseUrl, 768, catalogQueries);
    await verify(browser, baseUrl, 1366, catalogQueries);
    await verifyCatalogFailure(browser, baseUrl);
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
