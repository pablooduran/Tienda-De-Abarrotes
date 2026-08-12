const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright-core');

const PUBLIC = path.join(__dirname, '..', 'public');

function executable() {
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

function subscription() {
  return {
    estado: 'activa', estadoEfectivo: 'activa', tipo: 'cortesia',
    periodo: { tipo: 'mensual', duracionDias: 30 },
    fechaInicio: '2026-08-01 00:00:00', fechaFin: '2026-09-01 00:00:00',
    plan: { codigo: 'basico', nombre: 'Basico' },
    acceso: { nivel: 'completo', mensaje: 'Acceso completo.', siguienteAccion: 'continuar' },
    limites: { propietarios: 1, productos: 20, clientes: 20, proveedores: 5 },
    uso: { propietarios: 1, productos: 20, clientes: 22, proveedores: 1 },
    funcionalidades: ['inventario_resumen'], puedeRenovar: false, puedeReactivar: false
  };
}

function plans() {
  const availability = {
    propietarios: { limite: 1, uso: 1, disponible: 0, alcanzado: true, excedido: false, permiteAlta: false },
    productos: { limite: 10, uso: 20, disponible: 0, alcanzado: false, excedido: true, permiteAlta: false },
    clientes: { limite: 10, uso: 22, disponible: 0, alcanzado: false, excedido: true, permiteAlta: false },
    proveedores: { limite: 5, uso: 1, disponible: 4, alcanzado: false, excedido: false, permiteAlta: true }
  };
  return {
    planActual: { codigo: 'basico', nombre: 'Basico' },
    planProgramado: { codigo: 'reducido', nombre: 'Reducido', fechaAplicacion: '2026-09-01 00:00:00' },
    planes: [
      { codigo: 'basico', nombre: 'Basico', tipoCambio: 'mismo_plan', limites: {}, disponibilidad: {}, funcionalidades: [] },
      { codigo: 'avanzado', nombre: 'Avanzado', tipoCambio: 'upgrade', descripcion: 'Mas capacidad.', limites: {}, disponibilidad: {}, funcionalidades: [] },
      { codigo: 'reducido', nombre: 'Reducido', tipoCambio: 'downgrade', descripcion: 'Capacidad menor.', limites: {}, disponibilidad: availability, funcionalidades: [] }
    ]
  };
}

function createServer() {
  const requests = [];
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    if (request.method === 'POST' && /^\/api\/suscripcion\/(upgrade|downgrade)$/.test(url.pathname)) {
      let body = '';
      request.on('data', (chunk) => { body += chunk; });
      request.on('end', () => {
        requests.push({
          path: url.pathname,
          body: JSON.parse(body),
          key: request.headers['idempotency-key']
        });
        json(response, 200, {
          codigo: 'OK',
          fechaAplicacion: url.pathname.endsWith('downgrade') ? '2026-09-01 00:00:00' : null
        });
      });
      return;
    }
    if (url.pathname === '/' || url.pathname === '/suscripcion.html') {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return response.end(fs.readFileSync(path.join(PUBLIC, 'subscription.html')));
    }
    if (url.pathname === '/api/suscripcion') return json(response, 200, subscription());
    if (url.pathname === '/api/suscripcion/planes') return json(response, 200, plans());
    if (url.pathname === '/api/pagos-suscripcion/planes') return json(response, 200, { planes: [] });
    if (url.pathname === '/api/pagos-suscripcion/metodos') return json(response, 200, { disponibles: false, metodos: [] });
    if (url.pathname === '/api/pagos-suscripcion/solicitudes') return json(response, 200, { resultados: [], paginacion: { paginas: 1 } });
    if (url.pathname.startsWith('/js/') || url.pathname.startsWith('/css/')) {
      const file = path.join(PUBLIC, url.pathname.slice(1));
      response.writeHead(200, { 'Content-Type': url.pathname.endsWith('.css') ? 'text/css' : 'text/javascript' });
      return fs.createReadStream(file).pipe(response);
    }
    if (url.pathname === '/favicon.ico') { response.writeHead(204); return response.end(); }
    return json(response, 404, { error: 'No encontrado.' });
  });
  return { server, requests };
}

async function main() {
  const browserPath = executable();
  if (!browserPath) throw new Error('No se encontro Edge local.');
  const fixture = createServer();
  await new Promise((resolve) => fixture.server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${fixture.server.address().port}`;
  const browser = await chromium.launch({ executablePath: browserPath, headless: true });
  try {
    for (const viewport of [
      { width: 360, height: 800 },
      { width: 768, height: 1024 },
      { width: 1366, height: 768 }
    ]) {
      const page = await browser.newPage({ viewport });
      const errors = [];
      page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(`${baseUrl}/suscripcion.html`);
      await page.locator('article[data-plan-code="avanzado"]').waitFor();
      assert.strictEqual(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1), false);
      assert.strictEqual(await page.locator('.subscription-plan-excess').isVisible(), true);
      await page.keyboard.press('Tab');
      const outline = await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle);
      assert.notStrictEqual(outline, 'none');
      assert.deepStrictEqual(errors, []);
      await page.close();
    }
    const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
    await page.goto(`${baseUrl}/suscripcion.html`);
    await Promise.all([
      page.waitForResponse((response) => response.url().endsWith('/api/suscripcion/upgrade')),
      page.locator('[data-plan-action="upgrade"]').click()
    ]);
    await Promise.all([
      page.waitForResponse((response) => response.url().endsWith('/api/suscripcion/downgrade')),
      page.locator('[data-plan-action="downgrade"]').click()
    ]);
    assert.strictEqual(fixture.requests.length, 2);
    assert.deepStrictEqual(fixture.requests.map((item) => item.body), [
      { codigoPlan: 'avanzado' }, { codigoPlan: 'reducido' }
    ]);
    assert(fixture.requests.every((item) => /^plan-change:[0-9a-f-]{36}$/.test(item.key)));
    assert(fixture.requests.every((item) => !JSON.stringify(item).includes('idTienda')));
    await page.close();
    console.log('test:subscription-plan-browser OK');
  } finally {
    await browser.close();
    await new Promise((resolve) => fixture.server.close(resolve));
  }
}

main().catch((error) => {
  console.error(`test:subscription-plan-browser FAIL: ${error.message}`);
  process.exitCode = 1;
});
