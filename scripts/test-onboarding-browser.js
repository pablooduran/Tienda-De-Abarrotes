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
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  ].filter(Boolean);
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) throw new Error('No se encontro Edge o Chrome para la prueba de onboarding.');
  return found;
}

function json(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
}

function state(status = 'pendiente') {
  return {
    estado: status,
    completadoEn: status === 'completado' ? '2026-07-29 12:00:00' : null,
    configuracion: {
      nombreMostrado: 'Tienda de prueba', moneda: 'BOB', zonaHoraria: 'America/La_Paz',
      telefono: null, direccion: null, datoFiscalBasico: null
    },
    camposFaltantes: [], progreso: status === 'completado' ? 100 : 75,
    siguienteAccion: status === 'completado' ? 'ir_al_panel' : 'completar', repetida: false
  };
}

function harness() {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/css/styles.css"><title>Onboarding</title></head><body class="onboarding-page"><main id="root" class="onboarding-root"></main><script src="/js/onboarding-ui.js"></script><script>(() => { window.mode = 'normal'; window.__destination = null; const api = async (url, options = {}) => { const method = String(options.method || 'GET').toUpperCase(); const headers = new Headers(options.headers || {}); if (method !== 'GET') headers.set('X-Requested-With', 'XMLHttpRequest'); const response = await fetch(url, { ...options, method, headers }); const body = await response.json(); if (!response.ok) { const error = new Error(body.error || 'Error seguro.'); error.code = body.code; throw error; } return body; }; window.__onboarding = window.OnboardingUI.create({ root: document.getElementById('root'), api, navigate: (destination) => { window.__destination = destination; } }); window.__ready = window.__onboarding.render(); })();</script></body></html>`;
}

function createServer() {
  let current = state();
  const requests = [];
  let failNext = false;
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    if (url.pathname === '/') {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return response.end(harness());
    }
    if (url.pathname === '/js/onboarding-ui.js') {
      response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' });
      return fs.createReadStream(path.join(PUBLIC, 'js', 'onboarding-ui.js')).pipe(response);
    }
    if (url.pathname === '/css/styles.css') {
      response.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8' });
      return fs.createReadStream(path.join(PUBLIC, 'css', 'styles.css')).pipe(response);
    }
    if (url.pathname === '/favicon.ico') {
      response.writeHead(204);
      return response.end();
    }
    if (url.pathname === '/onboarding' && request.method === 'GET') {
      if (failNext) { failNext = false; return json(response, 500, { error: 'Error seguro.' }); }
      return json(response, 200, current);
    }
    if (url.pathname === '/onboarding' && request.method === 'PATCH') {
      let raw = '';
      request.on('data', (chunk) => { raw += chunk; });
      request.on('end', () => {
        const body = JSON.parse(raw || '{}');
        requests.push({ url: url.pathname, method: request.method, body, requestedWith: request.headers['x-requested-with'] || null });
        current = { ...current, estado: 'en_progreso', configuracion: { ...current.configuracion, ...body }, progreso: 75, siguienteAccion: 'completar' };
        json(response, 200, current);
      });
      return;
    }
    if (url.pathname === '/onboarding/completar' && request.method === 'POST') {
      requests.push({ url: url.pathname, method: request.method, body: {}, requestedWith: request.headers['x-requested-with'] || null });
      current = state('completado');
      return json(response, 200, current);
    }
    if (url.pathname === '/auth/logout') return json(response, 200, { ok: true });
    return json(response, 404, { error: 'No encontrado.' });
  });
  return { server, requests, failOnce: () => { failNext = true; }, reset: () => { current = state(); } };
}

async function assertViewport(browser, baseUrl, viewport) {
  const page = await browser.newPage({ viewport });
  const errors = [];
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(baseUrl);
  await page.evaluate(() => window.__ready);
  await page.locator('[data-onboarding-form]').waitFor();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  assert.strictEqual(overflow, false, `La vista ${viewport.width}x${viewport.height} no debe desbordar.`);
  assert.strictEqual(await page.locator('label').count(), 6);
  assert.deepStrictEqual(errors, [], `La vista ${viewport.width}x${viewport.height} debe tener consola limpia.`);
  await page.close();
}

async function main() {
  const fixture = createServer();
  const browser = await chromium.launch({ executablePath: executable(), headless: true });
  await new Promise((resolve) => fixture.server.listen(0, '127.0.0.1', resolve));
  const { port } = fixture.server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
    const errors = [];
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(baseUrl);
    await page.evaluate(() => window.__ready);
    const form = page.locator('[data-onboarding-form]');
    await form.locator('input[name="nombreMostrado"]').focus();
    assert.strictEqual(await form.locator('input[name="nombreMostrado"]').evaluate((input) => document.activeElement === input), true);
    await form.locator('input[name="telefono"]').fill('70000000');
    await form.locator('[data-onboarding-omit]').click();
    assert.strictEqual(await form.locator('input[name="telefono"]').inputValue(), '');
    await form.locator('[data-onboarding-complete]').evaluate((button) => { button.click(); button.click(); });
    await page.locator('[data-onboarding-completed]').waitFor();
    await page.locator('[data-onboarding-panel]').click();
    assert.strictEqual(await page.evaluate(() => window.__destination), '/app.html');
    assert.strictEqual(fixture.requests.filter((request) => request.method === 'PATCH').length, 1);
    assert.strictEqual(fixture.requests.filter((request) => request.method === 'POST').length, 1);
    assert(fixture.requests.every((request) => !Object.prototype.hasOwnProperty.call(request.body, 'idTienda')));
    assert.strictEqual(
      fixture.requests.find((request) => request.method === 'PATCH').body.nombreMostrado,
      'Tienda de prueba'
    );
    assert(fixture.requests.every((request) => request.requestedWith === 'XMLHttpRequest'));
    assert.deepStrictEqual(errors, [], 'La pantalla debe mantener la consola limpia.');
    await page.close();

    fixture.failOnce();
    const errorPage = await browser.newPage({ viewport: { width: 768, height: 1024 } });
    await errorPage.goto(baseUrl);
    await errorPage.evaluate(() => window.__ready);
    await errorPage.locator('[data-onboarding-retry]').waitFor();
    assert.strictEqual(await errorPage.locator('[data-onboarding-retry]').isVisible(), true);
    await errorPage.close();

    fixture.reset();
    await assertViewport(browser, baseUrl, { width: 360, height: 800 });
    await assertViewport(browser, baseUrl, { width: 768, height: 1024 });
    await assertViewport(browser, baseUrl, { width: 1366, height: 768 });
    console.log('test:onboarding-browser OK');
  } finally {
    await browser.close();
    await new Promise((resolve) => fixture.server.close(resolve));
  }
}

main().catch((error) => {
  console.error(`test:onboarding-browser FAIL: ${error.message}`);
  process.exitCode = 1;
});
