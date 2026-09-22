const assert = require('assert/strict');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright-core');

const ROOT = path.resolve(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const TOKEN = 'A'.repeat(43);

function executable() {
  const candidates = [
    process.env.BROWSER_EXECUTABLE_PATH,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser'
  ].filter(Boolean);
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) throw new Error('No se encontro Edge, Chrome o Chromium para la prueba de acceso publico.');
  return found;
}

function json(response, status, body) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  response.end(JSON.stringify(body));
}

async function body(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

function createFixture() {
  const state = { requests: [] };
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    if (url.pathname === '/favicon.ico') {
      response.writeHead(204);
      return response.end();
    }
    if (request.method === 'POST' && url.pathname.startsWith('/auth/')) {
      const payload = await body(request);
      state.requests.push({
        path: url.pathname,
        search: url.search,
        payload,
        headers: request.headers
      });
      if (url.pathname === '/auth/registro') {
        await new Promise((resolve) => setTimeout(resolve, 120));
        return json(response, 201, { message: 'Cuenta creada. Revisa tu correo.' });
      }
      if (url.pathname === '/auth/verificar-correo') {
        return json(response, 200, { message: 'Correo verificado.' });
      }
      if (url.pathname === '/auth/reenviar-verificacion') {
        return json(response, 202, { message: 'Si la cuenta sigue pendiente, recibirás un nuevo código.' });
      }
      if (url.pathname === '/auth/solicitar-recuperacion') {
        return json(response, 202, { message: 'Si existe una cuenta asociada, recibirás instrucciones.' });
      }
      if (url.pathname === '/auth/restablecer-password') {
        return json(response, 200, { message: 'Contraseña actualizada.' });
      }
      if (url.pathname === '/auth/login' && payload.usuario === 'propietario_demo') {
        return json(response, 200, { destination: '/app.html' });
      }
      return json(response, 401, { error: 'Credenciales incorrectas.' });
    }
    if (url.pathname === '/app.html') {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return response.end('<!doctype html><title>Aplicación</title><main id="app-loaded">Aplicación</main>');
    }
    const relative = url.pathname === '/' ? 'login.html' : url.pathname.slice(1);
    const file = path.resolve(PUBLIC, relative);
    if (!file.startsWith(`${PUBLIC}${path.sep}`) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      response.writeHead(404);
      return response.end('No encontrado');
    }
    const extension = path.extname(file);
    const contentType = extension === '.html' ? 'text/html; charset=utf-8'
      : extension === '.js' ? 'text/javascript; charset=utf-8'
        : extension === '.css' ? 'text/css; charset=utf-8' : 'application/octet-stream';
    response.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-store' });
    fs.createReadStream(file).pipe(response);
  });
  return { server, state };
}

function track(page, errors) {
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
}

async function open(browser, baseUrl, viewport) {
  const context = await browser.newContext({
    viewport,
    hasTouch: viewport.width < 769,
    isMobile: viewport.width < 600
  });
  const page = await context.newPage();
  const errors = [];
  track(page, errors);
  await page.goto(`${baseUrl}/login.html`);
  await page.locator('#loginForm').waitFor();
  return { context, page, errors };
}

async function assertNoPageOverflow(page, label) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  assert.strictEqual(overflow, false, `El acceso publico no debe desbordar en ${label}.`);
}

async function runFlow(browser, baseUrl, state) {
  const session = await open(browser, baseUrl, { width: 1366, height: 768 });
  const { page } = session;
  try {
    await page.getByRole('button', { name: 'Crear cuenta', exact: true }).click();
    await page.locator('#registrationForm').waitFor();
    await page.locator('#register-store').fill('Tienda Pública Sintética');
    await page.locator('#register-user').fill('propietario_demo');
    await page.locator('#register-email').fill('propietario@example.test');
    await page.locator('#register-password').fill('ClaveSegura123');
    await page.locator('#register-confirmation').fill('ClaveSegura123');
    const registrationButton = page.locator('#registrationForm button[type="submit"]');
    await registrationButton.evaluate((button) => {
      button.click();
      button.click();
    });
    await page.locator('[data-auth-panel="verify"]:visible').waitFor();

    const registrationRequests = state.requests.filter((item) => item.path === '/auth/registro');
    assert.strictEqual(registrationRequests.length, 1, 'Dos activaciones no deben duplicar el registro.');
    assert.deepStrictEqual(
      Object.keys(registrationRequests[0].payload).sort(),
      ['correo', 'nombreTienda', 'password', 'usuario'],
      'El registro envia exclusivamente el contrato publico.'
    );
    assert.match(registrationRequests[0].headers['idempotency-key'] || '', /^registro:[a-z0-9]+:/,
      'El registro debe enviar una clave idempotente opaca.');
    assert.strictEqual(registrationRequests[0].headers['x-requested-with'], 'XMLHttpRequest');

    await page.locator('#verification-token').fill(TOKEN);
    await page.locator('#verificationForm button[type="submit"]').click();
    await page.locator('[data-auth-panel="login"]:visible').waitFor();
    assert.match(await page.locator('#loginMessage').textContent(), /correo verificado/i);

    await page.getByRole('button', { name: 'Ya tengo un código de verificación' }).click();
    await page.locator('.auth-secondary-flow summary').click();
    await page.locator('#resend-email').fill('propietario@example.test');
    await page.locator('#resendVerificationForm button[type="submit"]').click();
    await page.locator('[data-auth-feedback="verify"]').getByText(/nuevo código/i).waitFor();

    await page.getByRole('button', { name: 'Volver a iniciar sesión' }).click();
    await page.getByRole('button', { name: 'Olvidé mi contraseña' }).click();
    await page.locator('#recovery-email').fill('propietario@example.test');
    await page.locator('#recoveryRequestForm button[type="submit"]').click();
    await page.locator('[data-auth-panel="reset"]:visible').waitFor();
    assert.match(await page.locator('[data-auth-feedback="reset"]').textContent(), /instrucciones/i);

    await page.locator('#recovery-token').fill(TOKEN);
    await page.locator('#new-password').fill('NuevaClave1234');
    await page.locator('#new-password-confirmation').fill('NuevaClave1234');
    await page.locator('#passwordResetForm button[type="submit"]').click();
    await page.locator('[data-auth-panel="login"]:visible').waitFor();
    assert.match(await page.locator('#loginMessage').textContent(), /contraseña actualizada/i);

    await page.locator('#login-user').fill('propietario_demo');
    await page.locator('#login-password').fill('NuevaClave1234');
    await page.locator('#loginForm button[type="submit"]').focus();
    await page.keyboard.press('Enter');
    await page.waitForURL('**/app.html');
    await page.locator('#app-loaded').waitFor();

    assert(state.requests.every((item) => item.search === ''), 'Los tokens no deben viajar en la URL.');
    assert(state.requests.every((item) => !Object.prototype.hasOwnProperty.call(item.payload, 'idTienda')),
      'El acceso publico no debe aceptar tenant desde el frontend.');
    assert.deepStrictEqual(await page.evaluate(() => [localStorage.length, sessionStorage.length]), [0, 0],
      'El acceso publico no debe persistir tokens ni credenciales.');
    assert.deepStrictEqual(session.errors, [], 'El recorrido publico mantiene la consola limpia.');
  } finally {
    await session.context.close();
  }
}

async function assertViewport(browser, baseUrl, viewport) {
  const session = await open(browser, baseUrl, viewport);
  try {
    await assertNoPageOverflow(session.page, `${viewport.width}x${viewport.height}`);
    await session.page.getByRole('button', { name: 'Crear cuenta', exact: true }).click();
    await session.page.locator('#registrationForm').waitFor();
    await assertNoPageOverflow(session.page, `${viewport.width}x${viewport.height} registro`);
    assert.strictEqual(await session.page.locator('#registrationForm input').count(), 5);
    const targetSize = await session.page.locator('#registrationForm button[type="submit"]').evaluate((node) => {
      const rect = node.getBoundingClientRect();
      return { width: rect.width, height: rect.height };
    });
    assert(targetSize.height >= 44 && targetSize.width >= 44, 'El CTA debe ser utilizable por touch.');
    await session.page.locator('#register-store').focus();
    await session.page.keyboard.press('Tab');
    assert(await session.page.locator('#register-user').evaluate((node) => document.activeElement === node),
      'El orden de foco del registro debe ser logico.');
    assert.deepStrictEqual(session.errors, [], `Consola limpia en ${viewport.width}x${viewport.height}.`);
  } finally {
    await session.context.close();
  }
}

async function assertZoomReflow(browser, baseUrl) {
  const session = await open(browser, baseUrl, { width: 360, height: 800 });
  try {
    await session.page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
    await session.page.getByRole('button', { name: 'Crear cuenta', exact: true }).click();
    await assertNoPageOverflow(session.page, '360x800 con texto al 200%');
    assert.deepStrictEqual(session.errors, [], 'El reflow ampliado mantiene la consola limpia.');
  } finally {
    await session.context.close();
  }
}

async function main() {
  const fixture = createFixture();
  const browser = await chromium.launch({ executablePath: executable(), headless: true });
  await new Promise((resolve) => fixture.server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${fixture.server.address().port}`;
  try {
    await runFlow(browser, baseUrl, fixture.state);
    await assertViewport(browser, baseUrl, { width: 360, height: 800 });
    await assertViewport(browser, baseUrl, { width: 768, height: 1024 });
    await assertViewport(browser, baseUrl, { width: 1366, height: 768 });
    await assertZoomReflow(browser, baseUrl);
    console.log('test:public-auth-ui-browser OK');
  } finally {
    await browser.close();
    await new Promise((resolve) => fixture.server.close(resolve));
  }
}

main().catch((error) => {
  console.error(`test:public-auth-ui-browser FAIL: ${error.message}`);
  process.exitCode = 1;
});
