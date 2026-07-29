const assert = require('assert/strict');
const express = require('express');
const fs = require('fs');
const path = require('path');
const { webSecurityConfig } = require('../config/web-security');
const { createErrorHandler, notFoundHandler } = require('../middleware/error-handler');
const { createRateLimiters } = require('../middleware/rate-limiters');
const { requestContext } = require('../middleware/request-context');
const { mutationProtection, noStoreSensitiveResponses } = require('../middleware/request-security');
const { permissionsPolicy, securityHeaders } = require('../middleware/security-headers');
const { createSecurityLogger, safeValue } = require('../utils/security-logger');

const TRUSTED_ORIGIN = 'http://allowed.test';
const checks = [];

function check(name, condition, detail = '') {
  assert.ok(condition, detail || name);
  checks.push(name);
}

function rateConfig(overrides = {}) {
  return {
    enabled: true,
    windowMs: 60_000,
    apiMax: 100,
    loginIpMax: 100,
    loginIdentityMax: 3,
    publicRegistrationMax: 100,
    authMax: 100,
    adminMax: 100,
    exportMax: 100,
    whatsappMax: 100,
    healthMax: 100,
    ...overrides
  };
}

async function startFixture({ production = false, limits = {}, trustProxy = false, loginMode = 'both' } = {}) {
  const app = express();
  const logger = createSecurityLogger('off');
  const rateLimiters = createRateLimiters(rateConfig(limits));
  app.set('trust proxy', trustProxy);
  app.use(requestContext(logger));
  app.use(securityHeaders({ production }));
  app.use(permissionsPolicy);
  app.use(noStoreSensitiveResponses);
  app.use(express.json());
  app.use(mutationProtection([TRUSTED_ORIGIN]));

  const loginLimiters = loginMode === 'ip'
    ? [rateLimiters.loginIp]
    : [rateLimiters.loginIp, rateLimiters.loginIdentity];
  app.post('/auth/login', ...loginLimiters, (req, res) => {
    if (req.body?.usuario === 'usuario_valido' && req.body?.password === 'clave_valida') {
      return res.json({ message: 'Sesion iniciada.' });
    }
    return res.status(401).json({ error: 'Credenciales incorrectas.', code: 'INVALID_CREDENTIALS' });
  });
  app.post('/auth/logout', rateLimiters.auth, (req, res) => res.json({ message: 'Sesion cerrada.' }));
  app.post('/auth/registro', rateLimiters.publicRegistration, (req, res) => res.status(202).json({
    message: 'Registro recibido correctamente.', estado: 'pendiente_verificacion'
  }));
  app.use('/api/exportaciones', rateLimiters.export);
  app.use('/api/cobranza/mensaje-whatsapp/preparar', rateLimiters.whatsapp);
  app.use('/api', rateLimiters.api);
  app.get('/api/read', (req, res) => res.json({ ok: true }));
  app.post('/api/write', (req, res) => res.json({ ok: true }));
  app.delete('/api/write', (req, res) => res.json({ ok: true }));
  app.get('/api/error', (req, res, next) => next(new Error('ER_PARSE_ERROR SELECT secreto FROM /ruta/privada')));
  app.get('/api/exportaciones/demo.xlsx', (req, res) => res.json({ ok: true }));
  app.post('/api/cobranza/mensaje-whatsapp/preparar', (req, res) => res.json({ ok: true }));
  app.use(notFoundHandler);
  app.use(createErrorHandler({ logger, production }));

  const server = await new Promise((resolve, reject) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
    listener.once('error', reject);
  });
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  };
}

async function request(fixture, path, { method = 'GET', body, origin = TRUSTED_ORIGIN,
  requestedWith = true, headers = {} } = {}) {
  const finalHeaders = { ...headers };
  if (origin !== null) finalHeaders.Origin = origin;
  if (requestedWith && !['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    finalHeaders['X-Requested-With'] = 'XMLHttpRequest';
  }
  if (body !== undefined) finalHeaders['Content-Type'] = 'application/json';
  const response = await fetch(`${fixture.baseUrl}${path}`, {
    method,
    headers: finalHeaders,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'manual'
  });
  const text = await response.text();
  let parsed;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
  return { body: parsed, headers: response.headers, status: response.status };
}

function comparableAuthenticationBody(body) {
  return { error: body.error, code: body.code };
}

async function withFixture(options, callback) {
  const fixture = await startFixture(options);
  try {
    await callback(fixture);
  } finally {
    await fixture.close();
  }
}

async function testConfiguration() {
  const local = webSecurityConfig({ APP_ENV: 'local', PORT: '3000', RATE_LIMIT_ENABLED: 'false' });
  check('Configuracion local acepta limites desactivados', local.rateLimit.enabled === false);
  check('Origen local predeterminado es explicito', local.trustedOrigins.includes('http://localhost:3000'));
  const test = webSecurityConfig({ APP_ENV: 'test', PORT: '3000' });
  check('APP_ENV test permite limites controlados', test.rateLimit.enabled === false);
  const normalLocal = webSecurityConfig({ APP_ENV: 'local', PORT: '3000' });
  check('Limite general permite uso normal del POS', normalLocal.rateLimit.apiMax >= 1000);
  assert.throws(
    () => webSecurityConfig({ APP_ENV: 'production', DB_SSL_ENABLED: 'true', RATE_LIMIT_ENABLED: 'false', TRUSTED_ORIGINS: 'https://tienda.test' }),
    /RATE_LIMIT_ENABLED/
  );
  checks.push('Produccion no permite desactivar limites');
  assert.throws(
    () => webSecurityConfig({ APP_ENV: 'production', RATE_LIMIT_ENABLED: 'true' }),
    /TRUSTED_ORIGINS/
  );
  checks.push('Produccion exige origen confiable');
  assert.throws(
    () => webSecurityConfig({ APP_ENV: 'production', RATE_LIMIT_ENABLED: 'true', TRUSTED_ORIGINS: '*' }),
    /comodin/
  );
  checks.push('No se acepta comodin de origen');
  const serverSource = fs.readFileSync(path.resolve(__dirname, '..', 'server.js'), 'utf8');
  check('Cookie conserva SameSite Lax', /sameSite:\s*['"]lax['"]/.test(serverSource));
  check('Proteccion global precede rutas autenticadas',
    serverSource.indexOf('mutationProtection(appSecurityConfig.trustedOrigins)')
      < serverSource.indexOf("app.use('/auth', authRoutes)"));
}

async function testHeadersCsrfErrorsAndIdentityLimit() {
  await withFixture({ production: false, limits: { loginIdentityMax: 2 } }, async (fixture) => {
    const read = await request(fixture, '/api/read');
    check('GET de lectura permitido sin encabezado personalizado', read.status === 200);
    check('Request ID presente', Boolean(read.headers.get('x-request-id')));
    const externalRequestId = await request(fixture, '/api/read', {
      headers: { 'X-Request-Id': 'identificador-no-confiable' }
    });
    check('Request ID externo no se reutiliza',
      externalRequestId.headers.get('x-request-id') !== 'identificador-no-confiable');
    check('Datos sensibles sin cache', /no-store/.test(read.headers.get('cache-control') || ''));
    check('CSP presente', Boolean(read.headers.get('content-security-policy')));
    const csp = read.headers.get('content-security-policy') || '';
    check('CSP script-src solo propio', /script-src 'self'/.test(csp));
    check('CSP sin unsafe-inline de scripts', !/script-src[^;]*unsafe-inline/.test(csp));
    check('CSP sin unsafe-eval', !/unsafe-eval/.test(csp));
    check('CSP bloquea marcos', /frame-ancestors 'none'/.test(csp));
    check('CSP bloquea objetos', /object-src 'none'/.test(csp));
    check('Nosniff presente', read.headers.get('x-content-type-options') === 'nosniff');
    check('Politica de referencia presente', read.headers.get('referrer-policy') === 'strict-origin-when-cross-origin');
    check('Permissions-Policy presente', /camera=\(\)/.test(read.headers.get('permissions-policy') || ''));
    check('HSTS ausente en local', !read.headers.has('strict-transport-security'));
    check('CORS permisivo ausente', read.headers.get('access-control-allow-origin') !== '*');

    const allowedWrite = await request(fixture, '/api/write', { method: 'POST', body: {} });
    check('POST same-origin permitido', allowedWrite.status === 200);
    const missingHeader = await request(fixture, '/api/write', {
      method: 'POST', body: {}, requestedWith: false
    });
    check('POST sin encabezado CSRF rechazado', missingHeader.status === 403
      && missingHeader.body.code === 'CSRF_VALIDATION_FAILED');
    const foreignOrigin = await request(fixture, '/api/write', {
      method: 'POST', body: {}, origin: 'https://externo.test'
    });
    check('Origin externo rechazado', foreignOrigin.status === 403
      && foreignOrigin.body.code === 'ORIGIN_NOT_ALLOWED');
    const foreignDelete = await request(fixture, '/api/write', {
      method: 'DELETE', origin: 'https://externo.test'
    });
    check('DELETE externo rechazado', foreignDelete.status === 403);
    const loginWithoutProtection = await request(fixture, '/auth/login', {
      method: 'POST', body: { usuario: 'x', password: 'x' }, requestedWith: false
    });
    check('Login tambien protegido por origen', loginWithoutProtection.status === 403);

    const validLogin = await request(fixture, '/auth/login', {
      method: 'POST', body: { usuario: 'usuario_valido', password: 'clave_valida' }
    });
    check('Login normal permitido', validLogin.status === 200);
    const existingWrong = await request(fixture, '/auth/login', {
      method: 'POST', body: { usuario: 'usuario_valido', password: 'incorrecta' }
    });
    const missingWrong = await request(fixture, '/auth/login', {
      method: 'POST', body: { usuario: 'usuario_inexistente', password: 'incorrecta' }
    });
    check('Usuario existente e inexistente responden igual', existingWrong.status === 401
      && missingWrong.status === 401
      && JSON.stringify(comparableAuthenticationBody(existingWrong.body))
        === JSON.stringify(comparableAuthenticationBody(missingWrong.body)));

    for (let attempt = 0; attempt < 2; attempt += 1) {
      await request(fixture, '/auth/login', {
        method: 'POST', body: { usuario: 'objetivo_fuerza_bruta', password: 'incorrecta' }
      });
    }
    const blockedIdentity = await request(fixture, '/auth/login', {
      method: 'POST', body: { usuario: 'objetivo_fuerza_bruta', password: 'incorrecta' }
    });
    check('Fuerza bruta por usuario recibe 429', blockedIdentity.status === 429
      && blockedIdentity.body.code === 'TOO_MANY_LOGIN_ATTEMPTS');
    check('Respuesta 429 incluye Retry-After', Number(blockedIdentity.headers.get('retry-after')) > 0);
    const otherIdentity = await request(fixture, '/auth/login', {
      method: 'POST', body: { usuario: 'otro_usuario', password: 'incorrecta' }
    });
    check('Otro usuario no queda bloqueado por contador de identidad', otherIdentity.status === 401);

    const internalError = await request(fixture, '/api/error');
    check('Error 500 no expone SQL ni rutas', internalError.status === 500
      && internalError.body.error === 'Ocurrio un error interno.'
      && !JSON.stringify(internalError.body).includes('SELECT')
      && !JSON.stringify(internalError.body).includes('/ruta/privada'));
    check('Error 500 incluye requestId', Boolean(internalError.body.requestId));
    const missing = await request(fixture, '/ruta-inexistente');
    check('404 consistente', missing.status === 404 && missing.body.code === 'ROUTE_NOT_FOUND');
  });
}

async function testIpAndSpecificLimits() {
  const trustedProxy = (ip) => ip === '127.0.0.1' || ip === '::ffff:127.0.0.1';
  await withFixture({ limits: { loginIpMax: 2, loginIdentityMax: 100 }, trustProxy: trustedProxy, loginMode: 'ip' }, async (fixture) => {
    const options = {
      method: 'POST', body: { usuario: 'a', password: 'x' }, headers: { 'X-Forwarded-For': '198.51.100.10' }
    };
    await request(fixture, '/auth/login', options);
    await request(fixture, '/auth/login', options);
    const blocked = await request(fixture, '/auth/login', options);
    check('Limite de login por IP responde 429', blocked.status === 429);
    const anotherIp = await request(fixture, '/auth/login', {
      ...options, headers: { 'X-Forwarded-For': '198.51.100.11' }
    });
    check('Otra IP logica conserva su propio limite', anotherIp.status === 401);
  });

  await withFixture({ limits: { apiMax: 2 } }, async (fixture) => {
    await request(fixture, '/api/read');
    await request(fixture, '/api/read');
    const blocked = await request(fixture, '/api/read');
    check('API general tiene limite independiente', blocked.status === 429
      && blocked.body.code === 'API_RATE_LIMIT_EXCEEDED');
  });

  await withFixture({ limits: { exportMax: 1 } }, async (fixture) => {
    const first = await request(fixture, '/api/exportaciones/demo.xlsx');
    const second = await request(fixture, '/api/exportaciones/demo.xlsx');
    check('Exportaciones tienen limite especifico', first.status === 200 && second.status === 429
      && second.body.code === 'EXPORT_RATE_LIMIT_EXCEEDED');
  });

  await withFixture({ limits: { whatsappMax: 1 } }, async (fixture) => {
    const options = { method: 'POST', body: {} };
    const first = await request(fixture, '/api/cobranza/mensaje-whatsapp/preparar', options);
    const second = await request(fixture, '/api/cobranza/mensaje-whatsapp/preparar', options);
    check('WhatsApp preparado tiene limite especifico', first.status === 200 && second.status === 429);
  });

  await withFixture({ limits: { publicRegistrationMax: 1 } }, async (fixture) => {
    const body = { correo: 'registro@example.test' };
    const first = await request(fixture, '/auth/registro', { method: 'POST', body });
    const second = await request(fixture, '/auth/registro', { method: 'POST', body });
    check('Registro publico tiene limite independiente', first.status === 202 && second.status === 429
      && second.body.code === 'PUBLIC_REGISTRATION_RATE_LIMIT_EXCEEDED');
    check('Registro publico limitado conserva respuesta sanitizada', !JSON.stringify(second.body).includes('registro@example.test'));
  });
}

async function testProductionHeadersAndRedaction() {
  await withFixture({ production: true }, async (fixture) => {
    const response = await request(fixture, '/api/read');
    check('HSTS presente solo en configuracion de produccion', /max-age=31536000/.test(
      response.headers.get('strict-transport-security') || ''
    ));
    check('CSP de produccion eleva solicitudes inseguras', /upgrade-insecure-requests/.test(
      response.headers.get('content-security-policy') || ''
    ));
  });
  const redacted = safeValue({
    password: 'secreto', cookie: 'tienda.sid=secreto', DB_SSL_CA: 'pem', detalle: 'seguro'
  });
  check('Contrasena redactada', redacted.password === '[REDACTED]');
  check('Cookie redactada', redacted.cookie === '[REDACTED]');
  check('CA redactada', redacted.DB_SSL_CA === '[REDACTED]');
  check('Contexto no sensible se conserva', redacted.detalle === 'seguro');
}

async function main() {
  await testConfiguration();
  await testHeadersCsrfErrorsAndIdentityLimit();
  await testIpAndSpecificLimits();
  await testProductionHeadersAndRedaction();
  check('Cobertura minima de seguridad web', checks.length >= 40, `Solo se ejecutaron ${checks.length} comprobaciones.`);
  console.log(`Prueba de seguridad web completada correctamente (${checks.length} comprobaciones).`);
}

main().catch((error) => {
  console.error('La prueba de seguridad web fallo.');
  console.error(error.message);
  process.exit(1);
});
