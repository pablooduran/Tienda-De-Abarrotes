const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright-core');

const ROOT = path.join(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');

function executable() {
  const candidates = [
    process.env.BROWSER_EXECUTABLE_PATH,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
  ].filter(Boolean);
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) throw new Error('No se encontro Edge local para la prueba de suscripcion.');
  return found;
}

function state(status) {
  const access = status === 'gracia' ? 'solo_lectura' : (['suspendida', 'cancelada'].includes(status) ? 'restringido' : 'completo');
  const effectiveStatus = status === 'prueba' ? 'activa' : status;
  return {
    estado: effectiveStatus,
    estadoEfectivo: effectiveStatus,
    tipo: status === 'prueba' ? 'prueba' : 'cortesia',
    periodo: { tipo: 'mensual', duracionDias: 30 },
    fechaInicio: '2026-07-01 00:00:00',
    fechaFin: '2026-08-01 00:00:00',
    fechaFinGracia: status === 'gracia' ? '2026-08-08 00:00:00' : null,
    diasRestantes: status === 'activa' || status === 'prueba' ? 5 : 0,
    diasGraciaRestantes: status === 'gracia' ? 7 : null,
    plan: { codigo: 'basico', nombre: 'Basico' },
    acceso: {
      nivel: access,
      mensaje: access === 'completo'
        ? 'La suscripcion permite el acceso normal segun el plan.'
        : (access === 'solo_lectura'
          ? 'El periodo termino y la tienda esta en gracia. Los datos pueden consultarse, pero no modificarse.'
          : 'La suscripcion no permite acceso comercial. Los datos permanecen conservados.'),
      siguienteAccion: access === 'completo' ? 'continuar' : (status === 'cancelada' ? 'contactar_soporte' : 'reactivar')
    },
    limites: { propietarios: 1, productos: 500, clientes: 500, proveedores: 100 },
    uso: { propietarios: 1, productos: 12, clientes: 8, proveedores: 3 },
    funcionalidades: ['inventario_resumen', 'clientes_basico', 'fiados_basico'],
    puedeRenovar: ['gracia', 'suspendida'].includes(status),
    puedeReactivar: status === 'suspendida'
  };
}

function json(response, status, body) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store, max-age=0'
  });
  response.end(JSON.stringify(body));
}

function createServer() {
  let mode = 'activa';
  const requests = [];
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    requests.push({ method: request.method, path: url.pathname, search: url.search });
    if (url.pathname.startsWith('/__mode/')) {
      mode = url.pathname.split('/').pop();
      response.writeHead(204);
      return response.end();
    }
    if (url.pathname === '/' || url.pathname === '/suscripcion.html') {
      const harnessQuery = url.searchParams.get('fail') === '1' ? '?fail=1' : '';
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return response.end(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Estado de suscripcion</title><link rel="stylesheet" href="/css/styles.css"></head><body class="subscription-page"><main id="subscriptionRoot" class="subscription-root" aria-live="polite"></main><script src="/js/http-security.js"></script><script src="/js/subscription-harness.js${harnessQuery}"></script><script src="/js/subscription-ui.js"></script></body></html>`);
    }
    if (url.pathname === '/js/subscription-harness.js') {
      const shouldFail = url.searchParams.get('fail') === '1';
      response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
      return response.end(`(() => { const original = window.fetch.bind(window); let fail = ${shouldFail}; window.fetch = async (url, options) => { if (fail && url === '/api/suscripcion') { fail = false; return new Response(JSON.stringify({ error: 'No se pudo consultar la suscripcion.' }), { status: 500, headers: { 'Content-Type': 'application/json' } }); } return original(url, options); }; })();`);
    }
    if (url.pathname === '/js/http-security.js' || url.pathname === '/js/subscription-ui.js') {
      response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' });
      return fs.createReadStream(path.join(PUBLIC, url.pathname.slice(1))).pipe(response);
    }
    if (url.pathname === '/css/styles.css') {
      response.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8' });
      return fs.createReadStream(path.join(PUBLIC, url.pathname.slice(1))).pipe(response);
    }
    if (url.pathname === '/api/suscripcion') {
      return json(response, 200, state(mode));
    }
    if (url.pathname === '/api/suscripcion/planes') {
      return json(response, 200, { planActual: { codigo: 'basico', nombre: 'Basico' }, planProgramado: null, planes: [] });
    }
    if (url.pathname === '/auth/logout') return json(response, 200, { ok: true });
    if (url.pathname === '/login.html' || url.pathname === '/app.html') {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return response.end('<!doctype html><html lang="es"><title>Destino</title><body>Destino</body></html>');
    }
    if (url.pathname === '/favicon.ico') {
      response.writeHead(204);
      return response.end();
    }
    return json(response, 404, { error: 'No encontrado.' });
  });
  return { server, requests };
}

async function selectMode(baseUrl, mode) {
  const response = await fetch(`${baseUrl}/__mode/${mode}`);
  assert.strictEqual(response.status, 204);
}

async function openState(browser, baseUrl, mode, viewport) {
  await selectMode(baseUrl, mode);
  const page = await browser.newPage({ viewport });
  const errors = [];
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${baseUrl}/suscripcion.html`);
  await page.locator('[data-subscription-view]').waitFor();
  assert.strictEqual(await page.locator('[data-subscription-view]').getAttribute('data-access'),
    mode === 'gracia' ? 'solo_lectura' : (['suspendida', 'cancelada'].includes(mode) ? 'restringido' : 'completo'));
  assert.strictEqual(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1), false);
  assert.deepStrictEqual(errors, [], `${mode} ${viewport.width}x${viewport.height} debe mantener consola limpia.`);
  return { page, errors };
}

async function main() {
  const fixture = createServer();
  await new Promise((resolve) => fixture.server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${fixture.server.address().port}`;
  const browser = await chromium.launch({ executablePath: executable(), headless: true });
  try {
    for (const viewport of [
      { width: 360, height: 800 },
      { width: 768, height: 1024 },
      { width: 1366, height: 768 }
    ]) {
      const { page } = await openState(browser, baseUrl, 'gracia', viewport);
      assert.strictEqual(await page.locator('.subscription-notice').isVisible(), true);
      assert.strictEqual(await page.locator('button:disabled').count(), 1);
      await page.keyboard.press('Tab');
      const focus = await page.evaluate(() => ({
        tag: document.activeElement?.tagName,
        outline: getComputedStyle(document.activeElement).outlineStyle
      }));
      assert(['A', 'BUTTON'].includes(focus.tag), 'La navegacion por teclado no alcanzo un control.');
      assert.notStrictEqual(focus.outline, 'none', 'El foco visible no esta definido.');
      await page.close();
    }

    for (const mode of ['activa', 'prueba', 'suspendida', 'cancelada']) {
      const { page } = await openState(browser, baseUrl, mode, { width: 1366, height: 768 });
      const panelLinks = await page.locator('[data-subscription-panel]').count();
      assert.strictEqual(panelLinks, ['activa', 'prueba'].includes(mode) ? 1 : 0);
      if (mode === 'prueba') assert.strictEqual(await page.locator('.subscription-status').textContent(), 'prueba');
      await page.close();
    }

    const errorPage = await browser.newPage({ viewport: { width: 768, height: 1024 } });
    const errors = [];
    errorPage.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    errorPage.on('pageerror', (error) => errors.push(error.message));
    await errorPage.goto(`${baseUrl}/suscripcion.html?fail=1`);
    await errorPage.locator('[data-subscription-retry]').waitFor();
    assert.strictEqual(await errorPage.locator('[role="alert"]').isVisible(), true);
    await errorPage.locator('[data-subscription-retry]').click();
    await errorPage.locator('[data-subscription-view]').waitFor();
    assert.deepStrictEqual(errors, []);
    await errorPage.locator('[data-subscription-logout]').click();
    await errorPage.waitForURL(`${baseUrl}/login.html`);
    await errorPage.close();

    assert(fixture.requests.every((request) => !request.search.includes('idTienda')),
      'El frontend envio idTienda en una solicitud.');
    assert(fixture.requests.some((request) => request.path === '/auth/logout' && request.method === 'POST'));
    console.log('test:subscription-access-browser OK');
  } finally {
    await browser.close();
    await new Promise((resolve) => fixture.server.close(resolve));
  }
}

main().catch((error) => {
  console.error(`test:subscription-access-browser FAIL: ${error.message}`);
  process.exitCode = 1;
});
