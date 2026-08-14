const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright-core');

const PUBLIC = path.join(__dirname, '..', 'public');

function edgePath() {
  return [
    process.env.BROWSER_EXECUTABLE_PATH,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
  ].filter(Boolean).find((candidate) => fs.existsSync(candidate));
}

function json(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
}

function list() {
  return {
    resultados: [{
      referencia: 'tienda-browser', tienda: 'Tienda Browser', estado: 'gracia', estadoEfectivo: 'gracia',
      acceso: 'solo_lectura', tipo: 'prueba', plan: { codigo: 'basico', nombre: 'Basico' },
      fechaFin: '2026-08-01 00:00:00', excesos: ['productos']
    }],
    paginacion: { pagina: 1, limite: 20, total: 1, paginas: 1 }
  };
}

function detail() {
  return {
    ...list().resultados[0], fechaInicio: '2026-07-01 00:00:00', fechaFinGracia: '2026-08-08 00:00:00',
    planProgramado: { codigo: 'basico', nombre: 'Basico', fechaAplicacion: '2026-09-01 00:00:00' },
    disponibilidad: {
      propietarios: { limite: 1, uso: 1, excedido: false },
      productos: { limite: 10, uso: 12, excedido: true }
    },
    planes: [
      { codigo: 'basico', nombre: 'Basico', tipoCambio: 'mismo_plan' },
      { codigo: 'avanzado', nombre: 'Avanzado', tipoCambio: 'upgrade' }
    ],
    historial: { resultados: [{
      operacion: 'entrada_gracia', estadoAnterior: 'activa', estadoNuevo: 'gracia',
      actor: 'sistema', fecha: '2026-08-01 00:00:00'
    }], paginacion: { pagina: 1, paginas: 1, total: 1 } },
    accionesAdministrativas: []
  };
}

function fixtureServer() {
  const mutations = [];
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    if (url.pathname === '/admin.html' || url.pathname === '/') {
      const html = fs.readFileSync(path.join(PUBLIC, 'admin.html'), 'utf8')
        .replace('<script src="/js/administrative-audit-ui.js" defer></script>', '')
        .replace('<script src="/js/admin.js" defer></script>', '')
        .replace('<header class="page-header">', '<header class="page-header" hidden>')
        .replace('<section class="summary-grid" aria-label="Resumen de tiendas">', '<section class="summary-grid" aria-label="Resumen de tiendas" hidden>')
        .replace('<section class="content-section" aria-labelledby="storesHeading">', '<section class="content-section" aria-labelledby="storesHeading" hidden>')
        .replace('<section id="catalogo" class="content-section catalog-section"', '<section id="catalogo" class="content-section catalog-section" hidden')
        .replace('<section id="auditoria" class="content-section audit-admin-section"', '<section id="auditoria" class="content-section audit-admin-section" hidden');
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return response.end(html);
    }
    if (url.pathname === '/api/admin/planes') return json(response, 200, [
      { codigo: 'basico', nombre: 'Basico', activo: 1 },
      { codigo: 'avanzado', nombre: 'Avanzado', activo: 1 }
    ]);
    if (url.pathname === '/api/admin/suscripciones/resumen') return json(response, 200, {
      total: 1, activas: 0, gracia: 1, suspendidas: 0, canceladas: 0, limitesExcedidos: 1
    });
    if (url.pathname === '/api/admin/suscripciones/tienda-browser' && request.method === 'GET') return json(response, 200, detail());
    if (url.pathname === '/api/admin/suscripciones' && request.method === 'GET') return json(response, 200, list());
    if (/^\/api\/admin\/suscripciones\/tienda-browser\/(suspender|reactivar|renovar|cancelar|upgrade|downgrade)$/.test(url.pathname)) {
      let body = '';
      request.on('data', (chunk) => { body += chunk; });
      request.on('end', () => {
        mutations.push({ path: url.pathname, key: request.headers['idempotency-key'], body: JSON.parse(body) });
        json(response, 200, { message: 'Actualizada.', resultado: { codigo: 'OK' } });
      });
      return;
    }
    if (url.pathname.startsWith('/js/') || url.pathname.startsWith('/css/')) {
      const file = path.join(PUBLIC, url.pathname.slice(1));
      response.writeHead(200, { 'Content-Type': url.pathname.endsWith('.css') ? 'text/css' : 'text/javascript' });
      return fs.createReadStream(file).pipe(response);
    }
    if (url.pathname === '/favicon.ico') { response.writeHead(204); return response.end(); }
    return json(response, 404, { error: 'No encontrado.' });
  });
  return { server, mutations };
}

async function main() {
  const executablePath = edgePath();
  if (!executablePath) throw new Error('No se encontro Edge local.');
  const fixture = fixtureServer();
  await new Promise((resolve) => fixture.server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${fixture.server.address().port}`;
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    for (const viewport of [{ width: 360, height: 800 }, { width: 768, height: 1024 }, { width: 1366, height: 768 }]) {
      const page = await browser.newPage({ viewport });
      const errors = [];
      page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(`${baseUrl}/admin.html#suscripciones-saas`);
      await page.locator('#saasSubscriptionsTableBody tr').waitFor();
      const overflow = await page.evaluate(() => ({
        document: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
        sizes: {
          document: [document.documentElement.clientWidth, document.documentElement.scrollWidth],
          section: [document.getElementById('suscripciones-saas').clientWidth, document.getElementById('suscripciones-saas').scrollWidth],
          wrap: [document.querySelector('#suscripciones-saas .table-wrap').clientWidth, document.querySelector('#suscripciones-saas .table-wrap').scrollWidth]
        },
        elements: Array.from(document.querySelectorAll('body *'))
          .filter((element) => {
            const box = element.getBoundingClientRect();
            return box.right > window.innerWidth + 1 || box.left < -1;
          })
          .slice(0, 8)
          .map((element) => `${element.closest('section')?.id || 'none'}:${element.tagName.toLowerCase()}#${element.id}.${element.className}`)
      }));
      assert.strictEqual(overflow.document, false, `Overflow en ${viewport.width} ${JSON.stringify(overflow.sizes)}: ${overflow.elements.join(', ')}`);
      await page.locator('#saasSubscriptionsTableBody .table-action').click();
      await page.locator('#saasSubscriptionDetail:not([hidden])').waitFor();
      assert.strictEqual(await page.locator('.saas-limit-exceeded').isVisible(), true);
      await page.keyboard.press('Tab');
      const outline = await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle);
      assert.notStrictEqual(outline, 'none');
      assert.deepStrictEqual(errors, []);
      await page.close();
    }
    const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
    await page.goto(`${baseUrl}/admin.html#suscripciones-saas`);
    await page.locator('#saasSubscriptionsTableBody .table-action').click();
    await page.locator('#saasDetailActions .saas-more-actions summary').click();
    await page.locator('#saasDetailActions button', { hasText: 'Suspender' }).click();
    await page.locator('#saasSubscriptionActionDialog[open]').waitFor();
    await Promise.all([
      page.waitForResponse((response) => response.url().endsWith('/suspender')),
      page.locator('#submitSaasAction').click()
    ]);
    assert.strictEqual(fixture.mutations.length, 1);
    assert.deepStrictEqual(fixture.mutations[0].body, { motivo: 'falta_pago' });
    assert(/^saas-admin:[0-9a-f-]{36}$/.test(fixture.mutations[0].key));
    assert(!JSON.stringify(fixture.mutations).includes('idTienda'));
    await page.close();
    console.log('test:saas-subscription-admin-browser OK');
  } finally {
    await browser.close();
    await new Promise((resolve) => fixture.server.close(resolve));
  }
}

main().catch((error) => {
  console.error(`test:saas-subscription-admin-browser FAIL: ${error.message}`);
  process.exitCode = 1;
});
