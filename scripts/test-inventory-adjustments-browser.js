const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright-core');

const ROOT = path.join(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');

function check(condition, message) {
  if (!condition) throw new Error(message);
  console.log(`OK: ${message}`);
}

function executable() {
  const candidates = [
    process.env.BROWSER_EXECUTABLE_PATH,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  ].filter(Boolean);
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) throw new Error('No se encontro Edge o Chrome para la prueba de inventario.');
  return found;
}

function json(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(body));
}

function reconciliation(status = 'warning') {
  return {
    checkedAt: '2026-07-26',
    resumen: {
      productos: 1, stockFisico: 10, stockVendible: 6,
      stockNoVendible: 4, ok: status === 'ok' ? 1 : 0,
      warning: status === 'warning' ? 1 : 0, error: status === 'error' ? 1 : 0
    },
    resultados: [{
      idProducto: 1,
      nombre: '<script>window.__inventoryXss=1</script>',
      activo: true,
      controlaLotes: true,
      stockFisico: 10,
      stockVendible: 6,
      stockNoVendible: 4,
      desgloseNoVendible: { vencido: 1, bloqueado: 1, aislado: 1, tecnico: 1 },
      conciliacion: {
        estado: status,
        stockLotesFisico: 10,
        stockSegunMovimientos: 10,
        hallazgos: status === 'ok' ? [] : [{
          code: status === 'error' ? 'LOT_PHYSICAL_MISMATCH' : 'UNSELLABLE_STOCK_PRESENT',
          severity: status
        }]
      }
    }],
    paginacion: {
      page: 1, pageSize: 25, total: 1, totalPages: 1,
      hasNextPage: false, hasPreviousPage: false
    }
  };
}

function harness() {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <link rel="stylesheet" href="/css/styles.css"><title>Inventario</title></head>
    <body><main class="content"><section id="root"></section><div id="message" aria-live="polite"></div></main>
    <script src="/js/inventory-adjustment-ui.js"></script><script>
    (() => {
      const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g,
        (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
      const api = async (url, options = {}) => {
        const response = await fetch(url, options);
        const body = await response.json();
        if (!response.ok) { const error = new Error(body.error); error.code = body.code; throw error; }
        return body;
      };
      window.__inventory = window.InventoryAdjustmentUI.create({
        api,
        root: document.getElementById('root'),
        getProducts: () => [
          { idProducto: 1, nombre: 'Producto con lotes', activo: 1, controlaLotes: 1, controlaVencimiento: 1 },
          { idProducto: 2, nombre: 'Producto simple', activo: 1, controlaLotes: 0, controlaVencimiento: 0 }
        ],
        hasFeature: () => true,
        isReadOnly: () => false,
        escapeHtml,
        formatDate: (value) => String(value),
        newOperationKey: () => 'browser-operation-key-0001',
        showSuccess: async (message) => { document.getElementById('message').textContent = message; },
        patterns: {
          skeleton: (kind, count) => '<div class="ui-skeleton ui-skeleton-' + kind + '">' + '<span></span>'.repeat(count) + '</div>',
          messageFor: () => 'No pudimos completar la operación. Inténtalo nuevamente.',
          empty: (title, description) => '<div class="ui-empty"><strong>' + title + '</strong><p>' + description + '</p></div>'
        }
      });
      window.__ready = window.__inventory.render();
    })();</script></body></html>`;
}

function createServer() {
  let postCount = 0;
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(harness());
    }
    if (url.pathname === '/js/inventory-adjustment-ui.js') {
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' });
      return fs.createReadStream(path.join(PUBLIC, 'js', 'inventory-adjustment-ui.js')).pipe(res);
    }
    if (url.pathname === '/css/styles.css') {
      res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8' });
      return fs.createReadStream(path.join(PUBLIC, 'css', 'styles.css')).pipe(res);
    }
    if (url.pathname === '/api/inventario/conciliacion') {
      const status = url.searchParams.get('estado');
      await new Promise((resolve) => setTimeout(resolve, status === 'warning' ? 120 : 15));
      return json(res, 200, reconciliation(status === 'todos' ? 'warning' : status));
    }
    if (url.pathname === '/api/inventario/ajustes' && req.method === 'GET') {
      return json(res, 200, {
        resultados: [], paginacion: {
          page: 1, pageSize: 25, total: 0, totalPages: 1,
          hasNextPage: false, hasPreviousPage: false
        }
      });
    }
    if (url.pathname === '/api/inventario/ajustes' && req.method === 'POST') {
      postCount += 1;
      await new Promise((resolve) => setTimeout(resolve, 100));
      return json(res, 201, {
        message: 'Ajuste aplicado.',
        ajuste: { idAjusteInventario: 1 }
      });
    }
    if (url.pathname === '/api/productos/1/lotes-disponibles') {
      return json(res, 200, {
        lotes: [{
          idLoteProducto: 3, codigoLote: 'L-1', cantidadRestante: 4,
          estadoOperativo: 'disponible', clasificacionInventario: 'vendible'
        }]
      });
    }
    return json(res, 404, { error: 'No encontrado.' });
  });
  return { server, getPostCount: () => postCount };
}

async function testViewport(browser, baseUrl, viewport) {
  const page = await browser.newPage({ viewport });
  await page.goto(baseUrl);
  await page.evaluate(() => window.__ready);
  await page.locator('[data-inventory-content] table').waitFor();
  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  check(!overflow, `La vista ${viewport.width}x${viewport.height} no tiene overflow global.`);
  check(await page.locator('table caption').count() >= 1,
    `La vista ${viewport.width}x${viewport.height} conserva tablas accesibles.`);
  await page.close();
}

async function main() {
  const { server, getPostCount } = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const browser = await chromium.launch({ executablePath: executable(), headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
    await page.goto(baseUrl);
    await page.evaluate(() => window.__ready);
    const adjustmentButton = page.locator('[data-new-inventory-adjustment]');
    await adjustmentButton.focus();
    await adjustmentButton.press('Enter');
    const dialog = page.locator('dialog[open]');
    await dialog.waitFor();
    check(await dialog.getAttribute('aria-labelledby') === 'inventoryAdjustmentTitle',
      'El dialogo tiene titulo accesible.');
    check(await page.locator('input[tabindex^="+"]').count() === 0,
      'La interfaz no usa tabindex positivo.');
    await dialog.locator('select[name="idProducto"]').selectOption('2');
    await dialog.locator('input[name="cantidad"]').fill('2');
    await dialog.locator('input[name="confirmado"]').check();
    await dialog.locator('button[type="submit"]').evaluate((button) => {
      button.click();
      button.click();
    });
    await page.locator('#message').getByText('Ajuste aplicado.').waitFor();
    check(getPostCount() === 1, 'El doble clic genera una sola solicitud.');
    check(await adjustmentButton.evaluate((element) => document.activeElement === element),
      'El foco vuelve al boton que abrio el dialogo.');
    check(await page.evaluate(() => window.__inventoryXss) === undefined,
      'El nombre dinamico malicioso se muestra como texto.');

    const filters = page.locator('[data-inventory-filters]');
    await filters.locator('select[name="estado"]').selectOption('warning');
    await filters.locator('button[type="submit"]').click();
    await filters.locator('select[name="estado"]').selectOption('error');
    await filters.locator('button[type="submit"]').click();
    await page.locator('.inventory-reconciliation-status.error').waitFor();
    await page.waitForTimeout(150);
    check(await page.locator('.inventory-reconciliation-status.error').isVisible(),
      'Una respuesta obsoleta no reemplaza el filtro mas reciente.');
    await page.close();

    await testViewport(browser, baseUrl, { width: 360, height: 800 });
    await testViewport(browser, baseUrl, { width: 768, height: 1024 });
    await testViewport(browser, baseUrl, { width: 1366, height: 768 });
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error('La prueba de navegador de inventario fallo.');
  console.error(error.message);
  process.exitCode = 1;
});
