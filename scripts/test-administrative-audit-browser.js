const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright-core');

const ROOT = path.join(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function browserExecutable() {
  const candidates = [
    process.env.BROWSER_EXECUTABLE_PATH,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  ].filter(Boolean);
  const executable = candidates.find((candidate) => fs.existsSync(candidate));
  if (!executable) throw new Error('No se encontro Edge o Chrome para la prueba de auditoria.');
  return executable;
}

function json(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(body));
}

function event(id, overrides = {}) {
  return {
    idEventoAuditoria: id,
    idTienda: 3,
    categoria: 'venta',
    accion: id === 2 ? 'registro_pago_fiado' : 'registro_venta',
    resultado: 'correcto',
    codigoResultado: 'COMMERCIAL_OPERATION_OK',
    actor: { tipo: 'administrador', idAdministrador: 7 },
    origen: 'web',
    entidad: id === 2 ? 'cobro_fiado' : 'venta',
    referencia: id === 2 ? 'cobro_fiado:42' : 'venta:31',
    creadoEn: `2026-07-2${id} 10:30:00`,
    ...overrides
  };
}

function harness(mode) {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <link rel="stylesheet" href="/css/${mode === 'admin' ? 'admin.css' : 'styles.css'}"><title>Auditoria ${mode}</title></head>
    <body><main class="content"><section id="root"></section></main>
    <script src="/js/administrative-audit-ui.js"></script><script>
      (() => {
        const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g,
          (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
        const api = async (url) => {
          const response = await fetch(url);
          const data = await response.json();
          if (!response.ok) throw new Error(data.error || 'Error de prueba.');
          return data;
        };
        window.__audit = window.AdministrativeAuditUI.create({
          api,
          root: document.getElementById('root'),
          mode: '${mode}',
          escapeHtml,
          formatDate: (value) => String(value)
        });
        window.__ready = window.__audit.render();
      })();
    </script></body></html>`;
}

function createServer() {
  const requests = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    requests.push(url.pathname + url.search);
    if (url.pathname === '/tenant' || url.pathname === '/admin') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(harness(url.pathname === '/admin' ? 'admin' : 'tenant'));
    }
    if (url.pathname === '/js/administrative-audit-ui.js') {
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' });
      return fs.createReadStream(path.join(PUBLIC, 'js', 'administrative-audit-ui.js')).pipe(res);
    }
    if (url.pathname === '/css/styles.css' || url.pathname === '/css/admin.css') {
      res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8' });
      return fs.createReadStream(path.join(PUBLIC, 'css', path.basename(url.pathname))).pipe(res);
    }
    const isAdmin = url.pathname.startsWith('/api/admin/auditoria');
    const isTenant = url.pathname.startsWith('/api/auditoria');
    if (!isAdmin && !isTenant) return json(res, 404, { error: 'Ruta no encontrada.' });
    const idMatch = url.pathname.match(/\/auditoria\/(\d+)$/);
    if (idMatch) {
      const item = event(Number(idMatch[1]), {
        ...(isAdmin ? { idTienda: 3 } : {}),
        anteriores: { estado: 'pendiente' },
        posteriores: { estado: 'pagada' },
        metadatos: { metodoPago: 'efectivo' }
      });
      return json(res, 200, item);
    }
    if (url.searchParams.get('categoria') === 'producto') {
      return json(res, 200, {
        resultados: [],
        paginacion: {
          page: 1, pageSize: 25, total: 0, totalPages: 1,
          hasNextPage: false, hasPreviousPage: false
        }
      });
    }
    const page = Number(url.searchParams.get('page') || 1);
    const item = page === 1
      ? event(1, { accion: '<script>window.__xss=1</script>' })
      : event(2);
    return json(res, 200, {
      resultados: [item],
      paginacion: {
        page,
        pageSize: 25,
        total: 2,
        totalPages: 2,
        hasNextPage: page === 1,
        hasPreviousPage: page === 2
      }
    });
  });
  return { server, requests };
}

async function waitReady(page) {
  await page.goto(page.url());
  await page.evaluate(() => window.__ready);
  await page.locator('[data-audit-results]').waitFor({ state: 'visible' });
}

async function testOwner(browser, baseUrl, requests) {
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  await page.goto(`${baseUrl}/tenant`);
  await page.evaluate(() => window.__ready);
  assert(await page.locator('h2').getByText('Auditoria administrativa').isVisible(),
    'La pantalla del dueno no se mostro.');
  assert(await page.locator('input[name="idTienda"]').count() === 0,
    'El dueno no debe elegir tienda.');
  assert(await page.evaluate(() => window.__xss) === undefined,
    'El contenido dinamico ejecuto codigo.');
  assert((await page.locator('[data-audit-results]').textContent()).includes('Administrador')
    && !(await page.locator('[data-audit-results]').textContent()).includes('Administrador #'),
    'La auditoria no expone el numero interno del administrador.');
  assert(await page.locator('script').filter({ hasText: 'window.__xss=1' }).count() === 0,
    'La accion maliciosa se inserto como HTML.');

  const detailButton = page.locator('[data-audit-detail]').first();
  await detailButton.focus();
  await detailButton.press('Enter');
  const dialog = page.locator('dialog[open]');
  await dialog.waitFor({ state: 'visible' });
  assert(await dialog.isVisible() && (await dialog.textContent()).includes('Valores anteriores'),
    'El detalle accesible no se abrio.');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(50);
  assert(await detailButton.evaluate((element) => document.activeElement === element),
    'El foco no regreso al disparador al cerrar.');

  await page.locator('[data-audit-next]').click();
  await page.locator('[data-audit-results]').getByText('registro pago fiado').first().waitFor();
  assert((await page.locator('[data-audit-results]').textContent()).includes('registro pago fiado'),
    'La pagina siguiente no mostro un evento distinto.');
  await page.locator('[data-audit-previous]').click();
  await page.locator('[data-audit-pagination]').getByText('Pagina 1 de 2').waitFor();
  assert((await page.locator('[data-audit-pagination]').textContent()).includes('Pagina 1 de 2'),
    'La navegacion no regreso a la primera pagina.');

  const filterButton = page.locator('[data-audit-open-filters]');
  const beforeCancel = requests.length;
  await filterButton.click();
  await page.locator('[data-audit-filter-dialog][open]').waitFor();
  assert(await page.locator('[data-audit-filter-dialog]').evaluate((node) => node.matches(':modal')),
    'Los filtros deben abrirse como ventana modal.');
  await page.locator('select[name="categoria"]').selectOption('producto');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.querySelector('select[name="categoria"]').value === '');
  assert(requests.length === beforeCancel, 'Cerrar sin aplicar no debe consultar de nuevo.');
  assert(await filterButton.evaluate((node) => document.activeElement === node), 'El foco debe volver a Filtros.');
  await filterButton.click();
  await page.locator('select[name="categoria"]').selectOption('producto');
  await page.locator('[data-audit-filters] button[type="submit"]').click();
  await page.locator('[data-audit-results]').getByText('Sin eventos').waitFor();
  assert((await page.locator('[data-audit-results]').textContent()).includes('Sin eventos'),
    'El estado vacio no se anuncio.');
  assert(await filterButton.textContent() === 'Filtros (1)', 'Debe indicar un filtro activo.');
  await page.evaluate(() => window.__audit.render());
  await page.locator('[data-audit-results]').getByText('Sin eventos').waitFor();
  assert(await filterButton.textContent() === 'Filtros (1)', 'Volver a Auditoría debe conservar el filtro activo.');
  assert(await page.locator('select[name="categoria"]').inputValue() === 'producto',
    'Volver a Auditoría debe restaurar los controles.');
  await filterButton.click();
  await page.locator('[data-audit-filters] button[type="reset"]').click();
  assert((await page.locator('[data-audit-results]').textContent()).includes('Sin eventos'),
    'Limpiar prepara los campos sin cambiar los resultados.');
  await page.locator('[data-audit-filters] button[type="submit"]').click();
  await page.locator('[data-audit-pagination]').getByText('Pagina 1 de 2').waitFor();
  assert(await filterButton.textContent() === 'Filtros', 'La lista vuelve a mostrar todos los eventos.');
  await page.close();
  console.log('OK: dueno, filtros, paginacion, detalle, teclado y XSS.');
}

async function testAdmin(browser, baseUrl, requests) {
  const page = await browser.newPage({ viewport: { width: 768, height: 1024 } });
  await page.goto(`${baseUrl}/admin`);
  await page.evaluate(() => window.__ready);
  await page.locator('[data-audit-open-filters]').click();
  const store = page.locator('input[name="idTienda"]');
  assert(await store.isVisible(), 'El filtro de tienda del superadmin no esta disponible.');
  await store.fill('3');
  await page.locator('[data-audit-filters] button[type="submit"]').click();
  await page.waitForFunction(() => document.querySelector('[data-audit-results]')?.getAttribute('aria-busy') === 'false');
  assert(requests.some((url) => url.startsWith('/api/admin/auditoria?') && url.includes('idTienda=3')),
    'La consulta global no envio el filtro validado de tienda.');
  assert((await page.locator('[data-audit-results]').textContent()).includes('#3'),
    'La vista global no identifica el alcance de tienda.');
  await page.close();
  console.log('OK: superadmin global y filtro de tienda.');
}

async function testFilterFailure(browser, baseUrl) {
  const page = await browser.newPage();
  try {
    await page.goto(`${baseUrl}/tenant`);
    await page.evaluate(() => window.__ready);
    await page.route('**/api/auditoria?*', (route) => route.fulfill({
      status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Servicio temporalmente no disponible.' })
    }));
    await page.locator('[data-audit-open-filters]').click();
    await page.locator('select[name="categoria"]').selectOption('producto');
    await page.locator('[data-audit-filters] button[type="submit"]').click();
    await page.locator('[data-audit-filter-error]:not([hidden])').waitFor();
    assert(await page.locator('[data-audit-filter-dialog]').evaluate((node) => node.open),
      'El error debe dejar abierta la ventana.');
    assert(await page.locator('[data-audit-results] [data-audit-detail]').count() === 2,
      'Una consulta fallida no debe reemplazar los resultados anteriores.');
    await page.locator('[data-audit-close-filters]').click();
    await page.waitForFunction(() => document.querySelector('select[name="categoria"]').value === '');
  } finally {
    await page.close();
  }
}

async function testResponsive(browser, baseUrl) {
  for (const mode of ['tenant', 'admin']) for (const viewport of [
    { width: 360, height: 800 },
    { width: 768, height: 1024 },
    { width: 1366, height: 768 }
  ]) {
    const page = await browser.newPage({ viewport });
    await page.goto(`${baseUrl}/${mode}`);
    await page.evaluate(() => window.__ready);
    await page.locator('[data-audit-open-filters]').click();
    await page.locator('[data-audit-filter-dialog][open]').waitFor();
    const dimensions = await page.evaluate(() => ({
      width: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      visibleButtons: [...document.querySelectorAll('button')].filter((button) => button.offsetParent !== null).every((button) => {
        const rect = button.getBoundingClientRect();
        return rect.width > 0 && rect.height >= 36;
      }),
      labelled: [...document.querySelectorAll('input, select')].every((control) => Boolean(control.closest('label')))
    }));
    assert(dimensions.scrollWidth <= dimensions.width + 2,
      `Existe overflow global en ${mode} ${viewport.width}x${viewport.height}.`);
    assert(dimensions.visibleButtons && dimensions.labelled,
      `Controles inaccesibles en ${mode} ${viewport.width}x${viewport.height}.`);
    await page.locator('[data-audit-close-filters]').click();
    await page.close();
  }
  console.log('OK: responsive de propietario y superadmin en 360x800, 768x1024 y 1366x768.');
}

async function main() {
  const runtime = createServer();
  await new Promise((resolve) => runtime.server.listen(0, '127.0.0.1', resolve));
  const address = runtime.server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const browser = await chromium.launch({
    executablePath: browserExecutable(),
    headless: true
  });
  try {
    await testOwner(browser, baseUrl, runtime.requests);
    await testAdmin(browser, baseUrl, runtime.requests);
    await testFilterFailure(browser, baseUrl);
    await testResponsive(browser, baseUrl);
    console.log('\nPruebas reales de navegador de auditoria completadas.');
  } finally {
    await browser.close();
    await new Promise((resolve) => runtime.server.close(resolve));
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
