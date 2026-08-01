const assert = require('assert');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { createDatabaseConnection } = require('../config/database-connection');
const { requireLocalhostDatabase } = require('../config/env');
const { createSubscription } = require('../services/subscription-service');
const { addLocalDays, formatLocalDateTime, getLocalNow } = require('../utils/local-datetime');
const { applyTestRequestSecurity } = require('./http-test-security');
const {
  ACCESS_LEVELS,
  accessLevelForStatus,
  subscriptionRequestDecision
} = require('../config/subscription-access-policy');

class HttpSession {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
    this.cookie = '';
  }

  async request(path, options = {}) {
    const request = { ...options, headers: { ...(options.headers || {}) }, redirect: 'manual' };
    if (request.body && typeof request.body !== 'string') {
      request.headers['content-type'] = 'application/json';
      request.body = JSON.stringify(request.body);
    }
    applyTestRequestSecurity(this.baseUrl, request);
    if (this.cookie) request.headers.cookie = this.cookie;
    const response = await fetch(`${this.baseUrl}${path}`, request);
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) this.cookie = setCookie.split(';')[0];
    const text = await response.text();
    let body = text;
    try { body = text ? JSON.parse(text) : null; } catch { /* Las redirecciones no devuelven JSON. */ }
    return { status: response.status, body, headers: response.headers };
  }
}

async function expect(session, path, options, status, label) {
  const response = await session.request(path, options);
  assert.strictEqual(response.status, status, `${label}: ${response.status} ${JSON.stringify(response.body)}`);
  return response;
}

async function createFixture(connection, marker, suffix, { withHistory = false } = {}) {
  const now = formatLocalDateTime();
  const password = `Access-${crypto.randomBytes(12).toString('hex')}!`;
  const [store] = await connection.query(
    `INSERT INTO tienda (nombre,slug,activo,estado,estadoOnboarding,creadoEn,actualizadoEn)
     VALUES (?, ?, 1, 'activa', 'completado', ?, ?)`,
    [`Acceso ${suffix} ${marker}`, `access-${suffix}-${marker}`, now, now]
  );
  const idTienda = Number(store.insertId);
  await connection.query(
    `INSERT INTO configuracionTienda
      (idTienda,nombreMostrado,moneda,zonaHoraria,creadoEn,actualizadoEn)
     VALUES (?, ?, 'BOB', 'America/La_Paz', ?, ?)`,
    [idTienda, `Acceso ${suffix}`, now, now]
  );
  const usuario = `access_${suffix}_${marker}`;
  const [admin] = await connection.query(
    `INSERT INTO administrador
      (idTienda,usuario,password,rol,activo,estadoAcceso,correoVerificadoEn,versionSesion)
     VALUES (?, ?, ?, 'dueno_tienda', 1, 'activo', ?, 1)`,
    [idTienda, usuario, await bcrypt.hash(password, 12), now]
  );
  if (withHistory) {
    const historical = await createSubscription(connection, {
      idTienda,
      planCodigo: 'basico',
      tipo: 'cortesia',
      fechaInicio: formatLocalDateTime(addLocalDays(getLocalNow(), -90)),
      fechaFin: formatLocalDateTime(addLocalDays(getLocalNow(), -60)),
      creadoPor: Number(admin.insertId),
      actorTipo: 'administrador'
    });
    await connection.query(
      `UPDATE suscripcionTienda SET estado='suspendida', suspendidaEn=?, motivoTransicion='fin_gracia'
       WHERE idTienda=? AND idSuscripcion=?`,
      [formatLocalDateTime(addLocalDays(getLocalNow(), -53)), idTienda, historical.idSuscripcion]
    );
  }
  const subscription = await createSubscription(connection, {
    idTienda,
    planCodigo: 'basico',
    tipo: 'prueba',
    fechaInicio: now,
    fechaFin: formatLocalDateTime(addLocalDays(getLocalNow(), 30)),
    creadoPor: Number(admin.insertId),
    actorTipo: 'administrador'
  });
  return { idTienda, idAdministrador: Number(admin.insertId), idSuscripcion: subscription.idSuscripcion, usuario, password };
}

async function cleanup(connection, fixtures) {
  const stores = fixtures.map((fixture) => fixture.idTienda).filter(Boolean);
  const admins = fixtures.map((fixture) => fixture.idAdministrador).filter(Boolean);
  if (!stores.length) return;
  await connection.beginTransaction();
  try {
    if (admins.length) {
      await connection.query(
        'DELETE FROM eventoAuditoriaAdministrativa WHERE idTienda IN (?) OR idAdministradorActor IN (?)',
        [stores, admins]
      );
    }
    await connection.query('DELETE FROM operacionSuscripcionTienda WHERE idTienda IN (?)', [stores]);
    await connection.query('DELETE FROM historialSuscripcionTienda WHERE idTienda IN (?)', [stores]);
    await connection.query('DELETE FROM suscripcionFuncionalidadSnapshot WHERE idTienda IN (?)', [stores]);
    await connection.query('DELETE FROM suscripcionTienda WHERE idTienda IN (?)', [stores]);
    await connection.query('DELETE FROM configuracionTienda WHERE idTienda IN (?)', [stores]);
    await connection.query('DELETE FROM administrador WHERE idTienda IN (?)', [stores]);
    await connection.query('DELETE FROM tienda WHERE idTienda IN (?)', [stores]);
    await connection.commit();
  } catch (error) {
    try { await connection.rollback(); } catch { /* La conexion puede estar cerrada. */ }
    throw error;
  }
}

function assertPurePolicy() {
  assert.strictEqual(accessLevelForStatus('activa'), ACCESS_LEVELS.FULL);
  assert.strictEqual(accessLevelForStatus('gracia'), ACCESS_LEVELS.READ_ONLY);
  assert.strictEqual(accessLevelForStatus('suspendida'), ACCESS_LEVELS.RESTRICTED);
  assert(subscriptionRequestDecision({ method: 'GET', path: '/api/productos', accessLevel: 'solo_lectura' }).allowed);
  assert(!subscriptionRequestDecision({ method: 'POST', path: '/api/productos', accessLevel: 'solo_lectura' }).allowed);
  assert(!subscriptionRequestDecision({ method: 'GET', path: '/api/exportaciones/ventas.xlsx', accessLevel: 'solo_lectura' }).allowed);
  assert(subscriptionRequestDecision({ method: 'GET', path: '/api/suscripcion', accessLevel: 'restringido' }).allowed);
  assert(!subscriptionRequestDecision({ method: 'GET', path: '/api/productos', accessLevel: 'restringido' }).allowed);
}

async function main() {
  assertPurePolicy();
  const config = { ...requireLocalhostDatabase('test:subscription-access'), decimalNumbers: true };
  if (!/(prueba|test)/i.test(config.database)) throw new Error('La prueba requiere una base local de pruebas.');
  const connection = await createDatabaseConnection(config);
  const baseUrl = process.env.TEST_BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
  const marker = crypto.randomBytes(6).toString('hex');
  const fixtures = [];
  const sessions = [];
  try {
    const first = await createFixture(connection, marker, 'one', { withHistory: true });
    const second = await createFixture(connection, marker, 'two');
    fixtures.push(first, second);
    const firstSession = new HttpSession(baseUrl);
    const secondSession = new HttpSession(baseUrl);
    sessions.push(firstSession, secondSession);

    const activeLogin = await expect(firstSession, '/auth/login', {
      method: 'POST', body: { usuario: first.usuario, password: first.password }
    }, 200, 'Login activo');
    assert.strictEqual(activeLogin.body.destination, '/app.html');
    const active = await expect(firstSession, `/api/suscripcion?idTienda=${second.idTienda}`, {}, 200, 'Consulta activa');
    assert.strictEqual(active.body.estadoEfectivo, 'activa');
    assert.strictEqual(active.body.acceso.nivel, 'completo');
    assert(!/idTienda|idSuscripcion|idPlan/.test(JSON.stringify(active.body)), 'La consulta expuso identificadores internos.');
    assert.match(active.headers.get('cache-control') || '', /no-store/);

    await expect(secondSession, '/auth/login', {
      method: 'POST', body: { usuario: second.usuario, password: second.password }
    }, 200, 'Login segundo tenant');
    const secondActive = await expect(secondSession, '/api/productos', {}, 200, 'Segundo tenant activo');
    assert(Array.isArray(secondActive.body));

    const expiredAt = addLocalDays(getLocalNow(), -1);
    await connection.query(
      `UPDATE suscripcionTienda
       SET estado='activa', fechaInicio=?, fechaFin=?, fechaFinGracia=NULL,
           suspendidaEn=NULL, canceladaEn=NULL, motivoTransicion=NULL
       WHERE idTienda=? AND idSuscripcion=?`,
      [formatLocalDateTime(addLocalDays(expiredAt, -30)), formatLocalDateTime(expiredAt), first.idTienda, first.idSuscripcion]
    );
    const concurrentGrace = await Promise.all([
      firstSession.request('/api/suscripcion'),
      firstSession.request('/api/suscripcion')
    ]);
    assert(concurrentGrace.every((response) => response.status === 200));
    assert(concurrentGrace.every((response) => response.body.estadoEfectivo === 'gracia'));
    const [[graceHistory]] = await connection.query(
      "SELECT COUNT(*) total FROM historialSuscripcionTienda WHERE idTienda=? AND idSuscripcion=? AND tipoOperacion='entrada_gracia'",
      [first.idTienda, first.idSuscripcion]
    );
    assert.strictEqual(Number(graceHistory.total), 1, 'La materializacion concurrente duplico el historial.');
    await expect(firstSession, '/api/productos', {}, 200, 'Lectura permitida en gracia');
    const blockedWrite = await expect(firstSession, '/api/productos', {
      method: 'POST', body: { nombre: 'No debe crearse' }
    }, 403, 'Escritura bloqueada en gracia');
    assert.strictEqual(blockedWrite.body.code, 'SUBSCRIPTION_GRACE_READ_ONLY');
    await expect(firstSession, '/api/exportaciones/ventas.xlsx', {}, 403, 'Exportacion bloqueada en gracia');
    await expect(firstSession, '/onboarding', {}, 403, 'Onboarding bloqueado en gracia');
    const secondStillActive = await expect(secondSession, '/api/productos', {}, 200, 'Aislamiento del segundo tenant');
    assert(Array.isArray(secondStillActive.body));

    await connection.query(
      `UPDATE suscripcionTienda SET estado='suspendida', suspendidaEn=?, motivoTransicion='fin_gracia'
       WHERE idTienda=? AND idSuscripcion=?`,
      [formatLocalDateTime(), first.idTienda, first.idSuscripcion]
    );
    const suspended = await expect(firstSession, '/api/suscripcion', {}, 200, 'Consulta suspendida');
    assert.strictEqual(suspended.body.acceso.nivel, 'restringido');
    const suspendedRead = await expect(firstSession, '/api/productos', {}, 403, 'Lectura comercial suspendida');
    assert.strictEqual(suspendedRead.body.code, 'SUBSCRIPTION_SUSPENDED');
    await expect(firstSession, '/api/contexto', {}, 200, 'Contexto minimo suspendido');
    const pageRedirect = await expect(firstSession, '/app.html', {}, 302, 'Panel redirige a suscripcion');
    assert.strictEqual(pageRedirect.headers.get('location'), '/suscripcion.html');

    await connection.query(
      `UPDATE suscripcionTienda SET estado='cancelada', canceladaEn=?, motivoTransicion='cancelacion_administrativa'
       WHERE idTienda=? AND idSuscripcion=?`,
      [formatLocalDateTime(), first.idTienda, first.idSuscripcion]
    );
    await expect(firstSession, '/auth/logout', { method: 'POST', body: {} }, 200, 'Logout permitido');
    const cancelledLogin = await expect(firstSession, '/auth/login', {
      method: 'POST', body: { usuario: first.usuario, password: first.password }
    }, 200, 'Login cancelado permitido');
    assert.strictEqual(cancelledLogin.body.destination, '/suscripcion.html');
    const cancelled = await expect(firstSession, '/api/suscripcion', {}, 200, 'Consulta cancelada');
    assert.strictEqual(cancelled.body.estadoEfectivo, 'cancelada');
    await expect(firstSession, '/api/dashboard', {}, 403, 'Dashboard cancelado bloqueado');

    const [[commercialWrites]] = await connection.query(
      'SELECT COUNT(*) total FROM producto WHERE idTienda IN (?, ?)',
      [first.idTienda, second.idTienda]
    );
    assert.strictEqual(Number(commercialWrites.total), 0, 'La prueba creo datos comerciales.');
    console.log('test:subscription-access OK');
  } finally {
    for (const session of sessions) {
      try { await session.request('/auth/logout', { method: 'POST', body: {} }); } catch { /* El servidor puede estar detenido. */ }
    }
    try { await cleanup(connection, fixtures); } finally { await connection.end(); }
  }
}

main().catch((error) => {
  console.error(`test:subscription-access FAIL: ${error.message}`);
  process.exitCode = 1;
});
