const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const net = require('net');
const path = require('path');
const { fork } = require('child_process');
const bcrypt = require('bcryptjs');
const mysql = require('mysql2/promise');
const { chromium } = require('playwright-core');
const { buildDatabaseOptions, setBusinessSessionTimeZone } = require('../config/database-options');
const { requireLocalhostDatabase } = require('../config/env');
const { readSqlStatements } = require('./db-utils');

const ROOT = path.resolve(__dirname, '..');
const SCHEMA_FILE = path.join(ROOT, 'database', 'tienda_abarrotes.sql');
const MIGRATIONS_DIR = path.join(ROOT, 'database', 'migrations');
const TEMP_PREFIX = 'tmp_tienda_restore_saas_a5_';

function quoteIdentifier(value) {
  if (!new RegExp(`^${TEMP_PREFIX}[a-f0-9]{12}$`).test(value)) {
    throw new Error('Nombre temporal invalido.');
  }
  return `\`${value}\``;
}

function migrationNames() {
  return fs.readdirSync(MIGRATIONS_DIR)
    .filter((name) => /^\d{3}_[a-z0-9_]+\.sql$/.test(name))
    .sort();
}

async function connect(options) {
  return setBusinessSessionTimeZone(await mysql.createConnection(options));
}

function temporaryEnvironment(database = null) {
  const user = String(process.env.BACKUP_RESTORE_USER || '').trim();
  const password = String(process.env.BACKUP_RESTORE_PASSWORD || '');
  if (!user || !password) {
    throw new Error('test:saas-a-e2e requiere credenciales temporales locales configuradas.');
  }
  return {
    ...process.env,
    APP_ENV: 'local',
    DB_HOST: 'localhost',
    DB_USER: user,
    DB_PASSWORD: password,
    ...(database ? { DB_NAME: database } : {})
  };
}

function databaseOptions(database = null) {
  return buildDatabaseOptions(temporaryEnvironment(database));
}

async function primaryFingerprint(options) {
  const connection = await connect(options);
  try {
    const [[row]] = await connection.query(
      `SELECT
        (SELECT COUNT(*) FROM schema_migrations) AS migraciones,
        (SELECT MAX(nombre) FROM schema_migrations) AS ultimaMigracion,
        (SELECT COUNT(*) FROM tienda) AS tiendas,
        (SELECT COUNT(*) FROM administrador) AS administradores,
        (SELECT COUNT(*) FROM suscripcionTienda) AS suscripciones,
        (SELECT COUNT(*) FROM tokenAccesoAdministrador) AS tokens,
        (SELECT COUNT(*) FROM solicitudRegistroPublico) AS solicitudes,
        (SELECT COUNT(*) FROM venta) AS ventas,
        (SELECT COALESCE(SUM(total),0) FROM venta) AS totalVentas,
        (SELECT COUNT(*) FROM fiado) AS fiados,
        (SELECT COALESCE(SUM(saldoPendiente),0) FROM fiado) AS deuda,
        (SELECT COUNT(*) FROM producto) AS productos,
        (SELECT COALESCE(SUM(stock),0) FROM producto) AS stock`
    );
    return JSON.stringify(row);
  } finally {
    await connection.end();
  }
}

async function temporaryDatabases(connection) {
  const [rows] = await connection.query(
    `SELECT SCHEMA_NAME
     FROM information_schema.SCHEMATA
     WHERE SCHEMA_NAME LIKE 'tmp\\_tienda\\_restore\\_%' ESCAPE '\\\\'
     ORDER BY SCHEMA_NAME`
  );
  return rows.map((row) => row.SCHEMA_NAME);
}

async function createTemporarySchema(connection) {
  for (const statement of readSqlStatements(SCHEMA_FILE)) {
    await connection.query(statement);
  }
  await connection.query(
    `CREATE TABLE schema_migrations (
      nombre VARCHAR(255) NOT NULL PRIMARY KEY,
      aplicadaEn DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB`
  );
  for (const name of migrationNames()) {
    await connection.query('INSERT INTO schema_migrations (nombre) VALUES (?)', [name]);
  }
}

function browserExecutable() {
  const candidates = [
    process.env.BROWSER_EXECUTABLE_PATH,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  ].filter(Boolean);
  const executable = candidates.find((candidate) => fs.existsSync(candidate));
  if (!executable) throw new Error('No se encontro Edge o Chrome para SAAS-A5.');
  return executable;
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}

async function waitForServer(baseUrl, child) {
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error('Express termino antes de readiness.');
    try {
      const response = await fetch(`${baseUrl}/health/ready`);
      if (response.status === 200) return;
    } catch {
      // The server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Express no alcanzo readiness healthy.');
}

function childRequest(child, type) {
  return new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID();
    const timeout = setTimeout(() => {
      child.off('message', onMessage);
      reject(new Error('El adaptador local no respondio al arnes.'));
    }, 5000);
    function onMessage(message) {
      if (message?.requestId !== requestId) return;
      clearTimeout(timeout);
      child.off('message', onMessage);
      resolve(message.payload || null);
    }
    child.on('message', onMessage);
    child.send({ type, requestId });
  });
}

function hasInternalIdentifier(value) {
  if (Array.isArray(value)) return value.some(hasInternalIdentifier);
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(([key, item]) =>
    ['idTienda', 'idAdministrador', 'idSuscripcion', 'idRol', 'token', 'tokenHash'].includes(key)
      || hasInternalIdentifier(item));
}

class HttpSession {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
    this.cookie = '';
  }

  async request(route, { method = 'GET', body, headers = {}, secure = true } = {}) {
    const requestHeaders = { ...headers };
    if (body !== undefined) requestHeaders['Content-Type'] = 'application/json';
    if (secure) {
      requestHeaders.Origin ||= this.baseUrl;
      if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
        requestHeaders['X-Requested-With'] ||= 'XMLHttpRequest';
      }
    }
    if (this.cookie) requestHeaders.Cookie = this.cookie;
    const response = await fetch(`${this.baseUrl}${route}`, {
      method,
      headers: requestHeaders,
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'manual'
    });
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) this.cookie = setCookie.split(';')[0];
    const text = await response.text();
    let payload = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = text;
    }
    return {
      status: response.status,
      body: payload,
      cacheControl: response.headers.get('cache-control'),
      location: response.headers.get('location')
    };
  }
}

function registration(marker, suffix = '') {
  return {
    nombreTienda: `Tienda SaaS A5 ${marker}${suffix}`,
    slug: `tienda-saas-a5-${marker}${suffix}`,
    usuario: `saas_a5_${marker}${suffix}`,
    correo: `saas-a5-${marker}${suffix}@example.test`,
    password: `SaaS-A5-${marker}${suffix}-segura!`
  };
}

async function expectStatus(session, route, options, expected, label) {
  const response = await session.request(route, options);
  assert.strictEqual(response.status, expected, `${label}: HTTP ${response.status}`);
  return response;
}

async function runBrowserFlow(baseUrl, account) {
  const browser = await chromium.launch({ executablePath: browserExecutable(), headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
    await context.route('**/favicon.ico', (route) => route.fulfill({ status: 204, body: '' }));
    const page = await context.newPage();
    const browserErrors = [];
    const onboardingPayloadKeys = [];
    page.on('console', (message) => {
      if (message.type() === 'error') browserErrors.push(message.text());
    });
    page.on('pageerror', (error) => browserErrors.push(error.message));
    page.on('response', (response) => {
      if (response.status() >= 400) {
        browserErrors.push(`HTTP ${response.status()} ${new URL(response.url()).pathname}`);
      }
    });
    page.on('request', (request) => {
      if (!request.url().endsWith('/onboarding') || request.method() !== 'PATCH') return;
      try {
        onboardingPayloadKeys.push(Object.keys(JSON.parse(request.postData() || '{}')).sort());
      } catch {
        onboardingPayloadKeys.push(['invalid_json']);
      }
    });
    await page.goto(`${baseUrl}/login.html`);
    await page.locator('input[name="usuario"]').fill(account.usuario);
    await page.locator('input[name="password"]').fill(account.password);
    await page.locator('button[type="submit"]').focus();
    assert.strictEqual(
      await page.locator('button[type="submit"]').evaluate((button) => document.activeElement === button),
      true
    );
    await page.locator('button[type="submit"]').press('Enter');
    await page.waitForURL('**/onboarding.html');
    await page.locator('[data-onboarding-form]').waitFor();
    await page.locator('input[name="nombreMostrado"]').fill(`${account.nombreTienda} Configurada`);
    await page.locator('input[name="telefono"]').fill('70000000');
    await page.locator('[data-onboarding-save]').click();
    await page.locator(
      '[data-onboarding-message]:not(:empty), [data-onboarding-error]:not(:empty)'
    ).waitFor();
    const saveError = await page.locator('[data-onboarding-error]').textContent();
    assert.strictEqual(
      saveError,
      '',
      `El guardado de onboarding fallo: ${saveError}; campos=${JSON.stringify(onboardingPayloadKeys)}`
    );
    assert.strictEqual(
      await page.locator('[data-onboarding-message]').textContent(),
      'Configuracion guardada.'
    );
    await page.locator('[data-onboarding-complete]').click();
    await page.locator('[data-onboarding-completed]').waitFor();
    await page.locator('[data-onboarding-panel]').click();
    await page.waitForURL('**/app.html');
    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    assert.strictEqual(overflow, false);
    assert.deepStrictEqual(browserErrors, []);
    const cookies = await context.cookies();
    return {
      cookie: cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; '),
      context,
      browser
    };
  } catch (error) {
    await browser.close();
    throw error;
  }
}

async function main() {
  const primary = requireLocalhostDatabase('La regresion E2E de SAAS-A');
  if (primary.host !== 'localhost' || !/(prueba|test)/i.test(primary.database)) {
    throw new Error('SAAS-A5 requiere la base principal local de pruebas.');
  }
  assert.deepStrictEqual(migrationNames().slice(-2), [
    '020_registro_publico_onboarding.sql',
    '021_configuracion_base_tienda.sql'
  ]);
  const primaryBefore = await primaryFingerprint(primary);
  const serverConnection = await connect({ ...databaseOptions(), database: undefined });
  const temporaryBefore = await temporaryDatabases(serverConnection);
  const marker = crypto.randomBytes(6).toString('hex');
  const temporaryDatabase = `${TEMP_PREFIX}${marker}`;
  let connection;
  let child;
  let browserFlow;
  let childOutput = '';
  try {
    await serverConnection.query(
      `CREATE DATABASE ${quoteIdentifier(temporaryDatabase)}
       CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
    connection = await connect(databaseOptions(temporaryDatabase));
    await createTemporarySchema(connection);
    const port = await freePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    child = fork(__filename, ['--server'], {
      cwd: ROOT,
      env: {
        ...temporaryEnvironment(temporaryDatabase),
        PORT: String(port),
        SESSION_SECRET: crypto.randomBytes(32).toString('hex'),
        TRUSTED_ORIGINS: baseUrl,
        RATE_LIMIT_ENABLED: 'true',
        RATE_LIMIT_WINDOW_MS: '60000',
        RATE_LIMIT_MAX: '5000',
        AUTH_RATE_LIMIT_MAX: '1000',
        LOGIN_RATE_LIMIT_MAX: '100',
        LOGIN_IDENTITY_RATE_LIMIT_MAX: '100',
        PUBLIC_REGISTRATION_RATE_LIMIT_MAX: '100',
        EMAIL_VERIFICATION_CONFIRM_RATE_LIMIT_MAX: '100',
        EMAIL_VERIFICATION_RESEND_IP_RATE_LIMIT_MAX: '100',
        EMAIL_VERIFICATION_RESEND_IDENTITY_RATE_LIMIT_MAX: '100',
        PASSWORD_RECOVERY_REQUEST_IP_RATE_LIMIT_MAX: '100',
        PASSWORD_RECOVERY_REQUEST_IDENTITY_RATE_LIMIT_MAX: '100',
        PASSWORD_RECOVERY_CONFIRM_IP_RATE_LIMIT_MAX: '100',
        PASSWORD_RECOVERY_CONFIRM_TOKEN_RATE_LIMIT_MAX: '100'
      },
      windowsHide: true,
      silent: true
    });
    child.stdout.on('data', (chunk) => { childOutput += chunk.toString(); });
    child.stderr.on('data', (chunk) => { childOutput += chunk.toString(); });
    await waitForServer(baseUrl, child);

    const account = registration(marker);
    const anonymous = new HttpSession(baseUrl);
    const registrationKey = `saas-a5:${marker}:registro`;
    const created = await expectStatus(anonymous, '/auth/registro', {
      method: 'POST',
      headers: { 'Idempotency-Key': registrationKey },
      body: account
    }, 201, 'Registro publico');
    assert.strictEqual(created.body.estado, 'pendiente_verificacion');
    assert.strictEqual(created.body.repetida, false);
    assert.strictEqual(created.cacheControl, 'no-store, max-age=0');
    assert.strictEqual(hasInternalIdentifier(created.body), false);

    const repeated = await expectStatus(anonymous, '/auth/registro', {
      method: 'POST',
      headers: { 'Idempotency-Key': registrationKey },
      body: account
    }, 201, 'Registro idempotente');
    assert.strictEqual(repeated.body.repetida, true);
    await expectStatus(anonymous, '/auth/registro', {
      method: 'POST',
      headers: { 'Idempotency-Key': registrationKey },
      body: { ...account, slug: `${account.slug}-conflicto` }
    }, 409, 'Conflicto idempotente');
    await expectStatus(anonymous, '/auth/registro', {
      method: 'POST',
      headers: { 'Idempotency-Key': `saas-a5:${marker}:prohibido` },
      body: { ...registration(marker, 'x'), idTienda: 999 }
    }, 400, 'Tenant prohibido');
    await expectStatus(anonymous, '/auth/registro', {
      method: 'POST',
      headers: { 'Idempotency-Key': `saas-a5:${marker}:csrf` },
      body: registration(marker, 'csrf'),
      secure: false
    }, 403, 'Origen y CSRF publico');

    const pendingLogin = await expectStatus(new HttpSession(baseUrl), '/auth/login', {
      method: 'POST', body: { usuario: account.usuario, password: account.password }
    }, 401, 'Login pendiente');
    assert.strictEqual(hasInternalIdentifier(pendingLogin.body), false);
    const verificationMessage = await childRequest(child, 'verification');
    assert(verificationMessage?.token && verificationMessage.recipient === account.correo);
    await expectStatus(anonymous, '/auth/verificar-correo', {
      method: 'POST', body: { token: 'token-invalido-seguro-0000000000000000000000000000' }
    }, 400, 'Token de verificacion invalido');
    await expectStatus(anonymous, '/auth/verificar-correo', {
      method: 'POST', body: { token: verificationMessage.token }
    }, 200, 'Verificacion de correo');
    await expectStatus(anonymous, '/auth/verificar-correo', {
      method: 'POST', body: { token: verificationMessage.token }
    }, 400, 'Token de verificacion usado');

    browserFlow = await runBrowserFlow(baseUrl, account);
    const ownerSession = new HttpSession(baseUrl);
    ownerSession.cookie = browserFlow.cookie;
    const onboardingState = await expectStatus(ownerSession, '/onboarding', {}, 200, 'Onboarding completado');
    assert.strictEqual(onboardingState.body.estado, 'completado');
    assert.strictEqual(hasInternalIdentifier(onboardingState.body), false);
    const repeatedCompletion = await Promise.all([
      ownerSession.request('/onboarding/completar', { method: 'POST', body: {} }),
      ownerSession.request('/onboarding/completar', { method: 'POST', body: {} })
    ]);
    assert(repeatedCompletion.every((response) => response.status === 200));
    assert(repeatedCompletion.every((response) => response.body.estado === 'completado'));

    const secondAccount = registration(marker, 'b');
    await expectStatus(anonymous, '/auth/registro', {
      method: 'POST',
      headers: { 'Idempotency-Key': `saas-a5:${marker}:segunda` },
      body: secondAccount
    }, 201, 'Segunda tienda');
    const secondVerification = await childRequest(child, 'verification');
    await expectStatus(anonymous, '/auth/verificar-correo', {
      method: 'POST', body: { token: secondVerification.token }
    }, 200, 'Verificacion segunda tienda');
    const secondSession = new HttpSession(baseUrl);
    const secondLogin = await expectStatus(secondSession, '/auth/login', {
      method: 'POST', body: { usuario: secondAccount.usuario, password: secondAccount.password }
    }, 200, 'Login segunda tienda');
    assert.strictEqual(secondLogin.body.destination, '/onboarding.html');
    const secondOnboarding = await expectStatus(secondSession, '/onboarding', {}, 200, 'Onboarding segunda tienda');
    assert.strictEqual(secondOnboarding.body.configuracion.nombreMostrado, secondAccount.nombreTienda);
    assert.notStrictEqual(secondOnboarding.body.configuracion.nombreMostrado, `${account.nombreTienda} Configurada`);
    await expectStatus(secondSession, '/onboarding', {
      method: 'PATCH', body: { idTienda: 1 }
    }, 400, 'Tenant rechazado en onboarding');
    await expectStatus(secondSession, '/onboarding', {
      method: 'PATCH', body: { moneda: 'USD' }
    }, 400, 'Moneda invalida');
    await expectStatus(secondSession, '/onboarding', {
      method: 'PATCH', body: { zonaHoraria: 'UTC' }
    }, 400, 'Zona horaria invalida');
    await expectStatus(new HttpSession(baseUrl), '/onboarding', {}, 401, 'Onboarding sin sesion');

    const superPassword = `SaaS-A5-Super-${marker}!`;
    const [superResult] = await connection.query(
      `INSERT INTO administrador
       (idTienda,usuario,correoNormalizado,correoVerificadoEn,password,rol,activo,estadoAcceso,versionSesion)
       VALUES (NULL,?,NULL,NULL,?,'superadmin',1,'activo',1)`,
      [`saas_a5_super_${marker}`, await bcrypt.hash(superPassword, 12)]
    );
    assert(Number(superResult.insertId) > 0);
    const superSession = new HttpSession(baseUrl);
    await expectStatus(superSession, '/auth/login', {
      method: 'POST', body: { usuario: `saas_a5_super_${marker}`, password: superPassword }
    }, 200, 'Login superadmin sintetico');
    await expectStatus(superSession, '/onboarding', {}, 403, 'Superadmin sin tenant');

    await expectStatus(anonymous, '/auth/reenviar-verificacion', {
      method: 'POST', body: { correo: 'inexistente@example.test' }
    }, 202, 'Reenvio neutro');
    const unknownRecovery = await expectStatus(anonymous, '/auth/solicitar-recuperacion', {
      method: 'POST', body: { correo: 'inexistente@example.test' }
    }, 202, 'Recuperacion neutra');
    assert.strictEqual(hasInternalIdentifier(unknownRecovery.body), false);
    await expectStatus(anonymous, '/auth/solicitar-recuperacion', {
      method: 'POST', body: { correo: account.correo }
    }, 202, 'Solicitud de recuperacion');
    const recoveryMessage = await childRequest(child, 'recovery');
    assert(recoveryMessage?.token && recoveryMessage.recipient === account.correo);
    await expectStatus(anonymous, '/auth/restablecer-password', {
      method: 'POST',
      body: {
        token: 'token-invalido-seguro-0000000000000000000000000000',
        nuevaPassword: `SaaS-A5-Nueva-${marker}!`,
        confirmacionPassword: `SaaS-A5-Nueva-${marker}!`
      }
    }, 400, 'Token de recuperacion invalido');
    const newPassword = `SaaS-A5-Nueva-${marker}!`;
    await expectStatus(anonymous, '/auth/restablecer-password', {
      method: 'POST',
      body: {
        token: recoveryMessage.token,
        nuevaPassword: newPassword,
        confirmacionPassword: newPassword
      }
    }, 200, 'Restablecimiento de password');
    await expectStatus(anonymous, '/auth/restablecer-password', {
      method: 'POST',
      body: {
        token: recoveryMessage.token,
        nuevaPassword: newPassword,
        confirmacionPassword: newPassword
      }
    }, 400, 'Token de recuperacion usado');
    const revoked = await ownerSession.request('/auth/status');
    assert.strictEqual(revoked.status, 200);
    assert.strictEqual(revoked.body.authenticated, false);
    await expectStatus(new HttpSession(baseUrl), '/auth/login', {
      method: 'POST', body: { usuario: account.usuario, password: account.password }
    }, 401, 'Password anterior');
    const newLogin = await expectStatus(new HttpSession(baseUrl), '/auth/login', {
      method: 'POST', body: { usuario: account.usuario, password: newPassword }
    }, 200, 'Password nuevo');
    assert.strictEqual(newLogin.body.destination, '/app.html');

    const [[state]] = await connection.query(
      `SELECT a.estadoAcceso,a.correoVerificadoEn,a.versionSesion,t.estadoOnboarding,
              t.onboardingCompletadoEn,c.moneda,c.zonaHoraria,p.codigo planCodigo,
              s.tipo, DATEDIFF(s.fechaFin,s.fechaInicio) AS diasPrueba
       FROM administrador a
       JOIN tienda t ON t.idTienda=a.idTienda
       JOIN configuracionTienda c ON c.idTienda=t.idTienda
       JOIN suscripcionTienda s ON s.idTienda=t.idTienda
       JOIN plan p ON p.idPlan=s.idPlan
       WHERE a.usuario=?`,
      [account.usuario]
    );
    assert.strictEqual(state.estadoAcceso, 'activo');
    assert(state.correoVerificadoEn);
    assert.strictEqual(Number(state.versionSesion), 2);
    assert.strictEqual(state.estadoOnboarding, 'completado');
    assert(state.onboardingCompletadoEn);
    assert.strictEqual(state.moneda, 'BOB');
    assert.strictEqual(state.zonaHoraria, 'America/La_Paz');
    assert.strictEqual(state.planCodigo, 'basico');
    assert.strictEqual(state.tipo, 'prueba');
    assert.strictEqual(Number(state.diasPrueba), 30);
    const [[completionAudits]] = await connection.query(
      `SELECT COUNT(*) total
       FROM eventoAuditoriaAdministrativa e
       JOIN administrador a ON a.idAdministrador=e.idAdministradorActor
       WHERE a.usuario=? AND e.accion='onboarding_completado' AND e.resultado='correcto'`,
      [account.usuario]
    );
    assert.strictEqual(Number(completionAudits.total), 1);
    const [[commercial]] = await connection.query(
      `SELECT
        (SELECT COUNT(*) FROM venta WHERE idTienda=(SELECT idTienda FROM administrador WHERE usuario=?)) ventas,
        (SELECT COUNT(*) FROM producto WHERE idTienda=(SELECT idTienda FROM administrador WHERE usuario=?)) productos,
        (SELECT COUNT(*) FROM cliente WHERE idTienda=(SELECT idTienda FROM administrador WHERE usuario=?)) clientes`,
      [account.usuario, account.usuario, account.usuario]
    );
    assert.deepStrictEqual(commercial, { ventas: 0, productos: 0, clientes: 0 });
    const auditText = JSON.stringify((await connection.query(
      `SELECT datosAnteriores,datosPosteriores,metadatos
       FROM eventoAuditoriaAdministrativa`
    ))[0]).toLowerCase();
    assert(!auditText.includes(account.correo.toLowerCase()));
    assert(!auditText.includes(account.password.toLowerCase()));
    assert(!auditText.includes(newPassword.toLowerCase()));
    assert(!childOutput.toLowerCase().includes(account.password.toLowerCase()));
    console.log('SAAS-A5: flujo HTTP, browser, tenant, recuperacion y auditoria verificados.');
  } finally {
    if (browserFlow?.browser) await browserFlow.browser.close().catch(() => {});
    if (child && child.exitCode === null) {
      child.kill('SIGTERM');
      await new Promise((resolve) => {
        const timeout = setTimeout(resolve, 10000);
        child.once('exit', () => {
          clearTimeout(timeout);
          resolve();
        });
      });
    }
    await connection?.end().catch(() => {});
    await serverConnection.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(temporaryDatabase)}`).catch(() => {});
    const temporaryAfter = await temporaryDatabases(serverConnection);
    assert.deepStrictEqual(temporaryAfter, temporaryBefore, 'La base temporal debe eliminarse en finally.');
    await serverConnection.end().catch(() => {});
  }
  assert.strictEqual(await primaryFingerprint(primary), primaryBefore, 'La base principal debe conservar su huella.');
}

function runServerChild() {
  const { localVerificationMailAdapter } = require('../services/local-verification-mail-adapter');
  localVerificationMailAdapter.clearForTests();
  process.on('message', (message) => {
    const payload = message?.type === 'verification'
      ? localVerificationMailAdapter.takeLatestForTests()
      : (message?.type === 'recovery'
        ? localVerificationMailAdapter.takeLatestRecoveryForTests()
        : null);
    process.send?.({
      requestId: message?.requestId,
      payload: payload
        ? { recipient: payload.recipient, token: payload.token, expiresAt: payload.expiresAt }
        : null
    });
  });
  require('../server');
}

if (process.argv.includes('--server')) {
  runServerChild();
} else {
  main().catch((error) => {
    console.error(`test:saas-a-e2e FAIL: ${error.message}`);
    process.exitCode = 1;
  });
}
