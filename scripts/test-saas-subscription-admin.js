const assert = require('assert');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { createDatabaseConnection } = require('../config/database-connection');
const { requireLocalhostDatabase } = require('../config/env');
const { formatLocalDate } = require('../utils/local-datetime');
const { applyTestRequestSecurity } = require('./http-test-security');

class Session {
  constructor(baseUrl) { this.baseUrl = baseUrl; this.cookie = ''; this.requestIds = []; }
  async request(path, options = {}, secure = true) {
    const request = { ...options, headers: { ...(options.headers || {}) } };
    if (request.body && typeof request.body !== 'string') {
      request.headers['content-type'] = 'application/json';
      request.body = JSON.stringify(request.body);
    }
    if (secure) applyTestRequestSecurity(this.baseUrl, request);
    if (this.cookie) request.headers.cookie = this.cookie;
    const response = await fetch(`${this.baseUrl}${path}`, { ...request, redirect: 'manual' });
    const cookie = response.headers.get('set-cookie');
    if (cookie) this.cookie = cookie.split(';')[0];
    const requestId = response.headers.get('x-request-id');
    if (requestId) this.requestIds.push(requestId);
    const body = await response.json().catch(() => ({}));
    return { status: response.status, body, headers: response.headers };
  }
}

async function expect(session, path, options, status, label, secure = true) {
  const response = await session.request(path, options, secure);
  assert.strictEqual(response.status, status, `${label}: HTTP ${response.status}`);
  return response;
}

async function cleanup(connection, fixture, sessions) {
  const [stores] = await connection.query(
    "SELECT idTienda FROM tienda WHERE slug IN (?,?) OR slug LIKE 'saas-admin-%'",
    fixture.slugs
  );
  const storeIds = stores.map((row) => Number(row.idTienda));
  const [admins] = await connection.query(
    `SELECT idAdministrador FROM administrador
     WHERE usuario IN (?,?) OR usuario LIKE 'saas_super_%' OR idTienda IN (?)`,
    [fixture.superUsers[0], fixture.superUsers[1], storeIds.length ? storeIds : [0]]
  );
  const adminIds = admins.map((row) => Number(row.idAdministrador));
  const requestIds = sessions.flatMap((session) => session.requestIds);
  await connection.beginTransaction();
  try {
    if (storeIds.length || adminIds.length || requestIds.length) {
      const clauses = [];
      const values = [];
      if (storeIds.length) { clauses.push('idTienda IN (?)'); values.push(storeIds); }
      if (adminIds.length) { clauses.push('idAdministradorActor IN (?)'); values.push(adminIds); }
      if (requestIds.length) { clauses.push('requestId IN (?)'); values.push(requestIds); }
      await connection.query(`DELETE FROM eventoAuditoriaAdministrativa WHERE ${clauses.join(' OR ')}`, values);
    }
    for (const idTienda of storeIds) {
      await connection.query('DELETE FROM operacionSuscripcionTienda WHERE idTienda=?', [idTienda]);
      await connection.query('DELETE FROM historialSuscripcionTienda WHERE idTienda=?', [idTienda]);
      await connection.query('DELETE FROM suscripcionFuncionalidadSnapshot WHERE idTienda=?', [idTienda]);
      await connection.query('DELETE FROM cierreCaja WHERE idTienda=?', [idTienda]);
      await connection.query('DELETE FROM gasto WHERE idTienda=?', [idTienda]);
      await connection.query('DELETE FROM categoriaGasto WHERE idTienda=?', [idTienda]);
      await connection.query('DELETE FROM movimientoStock WHERE idTienda=?', [idTienda]);
      await connection.query('DELETE FROM seguimientoCobranza WHERE idTienda=?', [idTienda]);
      await connection.query('DELETE FROM pagoVenta WHERE idTienda=?', [idTienda]);
      await connection.query('DELETE FROM pagoFiado WHERE idTienda=?', [idTienda]);
      await connection.query('DELETE FROM cobroFiado WHERE idTienda=?', [idTienda]);
      await connection.query('DELETE FROM detalleFiado WHERE idTienda=?', [idTienda]);
      await connection.query('DELETE FROM detalleVenta WHERE idTienda=?', [idTienda]);
      await connection.query('DELETE FROM detalleCompra WHERE idTienda=?', [idTienda]);
      await connection.query('DELETE FROM fiado WHERE idTienda=?', [idTienda]);
      await connection.query('DELETE FROM venta WHERE idTienda=?', [idTienda]);
      await connection.query('DELETE FROM compra WHERE idTienda=?', [idTienda]);
      await connection.query('DELETE FROM producto WHERE idTienda=?', [idTienda]);
      await connection.query('DELETE FROM cliente WHERE idTienda=?', [idTienda]);
      await connection.query('DELETE FROM proveedor WHERE idTienda=?', [idTienda]);
      await connection.query('DELETE FROM plantillaCobranzaTienda WHERE idTienda=?', [idTienda]);
      await connection.query('DELETE FROM suscripcionTienda WHERE idTienda=?', [idTienda]);
      await connection.query('DELETE FROM configuracionTienda WHERE idTienda=?', [idTienda]);
      await connection.query('DELETE FROM configuracionCreditoTienda WHERE idTienda=?', [idTienda]);
      await connection.query('DELETE FROM configuracionInventarioTienda WHERE idTienda=?', [idTienda]);
      await connection.query('DELETE FROM administrador WHERE idTienda=?', [idTienda]);
      await connection.query('DELETE FROM tienda WHERE idTienda=?', [idTienda]);
    }
    await connection.query("DELETE FROM administrador WHERE usuario IN (?,?) OR usuario LIKE 'saas_super_%'", fixture.superUsers);
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  }
}

function assertSafe(value, label) {
  const text = JSON.stringify(value);
  assert(!/idTienda|idSuscripcion|idPlan|claveHash|huellaSolicitud|password|sqlMessage|stack/i.test(text), `${label} expuso datos internos.`);
}

async function createStore(session, marker, suffix) {
  const password = `Owner-${marker}-${suffix}-Password!`;
  const response = await expect(session, '/api/admin/tiendas', {
    method: 'POST', body: {
      nombre: `SaaS admin ${suffix} ${marker}`,
      slug: `saas-admin-${suffix}-${marker}`,
      estado: 'activa', activo: true,
      propietario: {
        usuario: `saas_admin_owner_${suffix}_${marker}`,
        password, confirmacionPassword: password, activo: true
      },
      suscripcion: { planCodigo: 'basico', tipo: 'cortesia', duracionDias: 30 }
    }
  }, 201, `Crear tienda ${suffix}`);
  return response.body;
}

async function main() {
  const config = { ...requireLocalhostDatabase('administracion SaaS de suscripciones'), decimalNumbers: true };
  if (!/(prueba|test)/i.test(config.database)) throw new Error('La prueba requiere una base local de prueba.');
  const connection = await createDatabaseConnection(config);
  const baseUrl = process.env.TEST_BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
  const marker = crypto.randomBytes(6).toString('hex');
  const fixture = {
    slugs: [`saas-admin-a-${marker}`, `saas-admin-b-${marker}`],
    superUsers: [`saas_super_a_${marker}`, `saas_super_b_${marker}`]
  };
  const passwords = [`Super-A-${marker}-Password!`, `Super-B-${marker}-Password!`];
  const sessions = [new Session(baseUrl), new Session(baseUrl), new Session(baseUrl)];
  try {
    for (let index = 0; index < fixture.superUsers.length; index += 1) {
      await connection.query(
        `INSERT INTO administrador (idTienda,usuario,password,rol,activo)
         VALUES (NULL,?,?,'superadmin',1)`,
        [fixture.superUsers[index], await bcrypt.hash(passwords[index], 12)]
      );
      await expect(sessions[index], '/auth/login', {
        method: 'POST', body: { usuario: fixture.superUsers[index], password: passwords[index] }
      }, 200, `Login superadmin ${index + 1}`);
    }
    const first = await createStore(sessions[0], marker, 'a');
    const second = await createStore(sessions[0], marker, 'b');
    const ownerLogin = await expect(sessions[2], '/auth/login', {
      method: 'POST', body: { usuario: `saas_admin_owner_a_${marker}`, password: `Owner-${marker}-a-Password!` }
    }, 200, 'Login propietario');
    assert.strictEqual(ownerLogin.body.admin.rol, 'dueno_tienda');

    const list = await expect(sessions[0], `/api/admin/suscripciones?texto=${marker}&limite=10`, {}, 200, 'Listado global');
    assert.strictEqual(list.body.resultados.length, 2);
    assertSafe(list.body, 'El listado');
    assert.match(list.headers.get('cache-control') || '', /no-store/);
    const filtered = await expect(sessions[0], `/api/admin/suscripciones?texto=${marker}&plan=basico&tipo=cortesia`, {}, 200, 'Filtros');
    assert.strictEqual(filtered.body.resultados.length, 2);
    const summary = await expect(sessions[0], '/api/admin/suscripciones/resumen', {}, 200, 'Resumen');
    assert(summary.body.total >= 2 && summary.body.porPlan.basico >= 2);
    const detail = await expect(sessions[0], `/api/admin/suscripciones/${fixture.slugs[0]}`, {}, 200, 'Detalle');
    assert.strictEqual(detail.body.referencia, fixture.slugs[0]);
    assert(Array.isArray(detail.body.historial.resultados));
    assertSafe(detail.body, 'El detalle');
    await expect(sessions[2], '/api/admin/suscripciones', {}, 403, 'Permiso superadmin');

    const noCsrf = await expect(sessions[0], `/api/admin/suscripciones/${fixture.slugs[0]}/suspender`, {
      method: 'POST', headers: { 'Idempotency-Key': `saas-admin:${marker}:csrf` }, body: { motivo: 'seguridad' }
    }, 403, 'CSRF obligatorio', false);
    assert(noCsrf.body.code);
    await expect(sessions[0], `/api/admin/suscripciones/${fixture.slugs[0]}/suspender`, {
      method: 'POST', headers: { 'Idempotency-Key': `saas-admin:${marker}:forbidden` },
      body: { motivo: 'seguridad', idTienda: second.tienda.idTienda }
    }, 400, 'Campos prohibidos');

    const suspendKey = `saas-admin:${marker}:suspend`;
    const suspended = await expect(sessions[0], `/api/admin/suscripciones/${fixture.slugs[0]}/suspender`, {
      method: 'POST', headers: { 'Idempotency-Key': suspendKey }, body: { motivo: 'seguridad' }
    }, 200, 'Suspension');
    const replay = await expect(sessions[1], `/api/admin/suscripciones/${fixture.slugs[0]}/suspender`, {
      method: 'POST', headers: { 'Idempotency-Key': suspendKey }, body: { motivo: 'seguridad' }
    }, 200, 'Suspension idempotente');
    assert.strictEqual(suspended.body.resultado.estado, 'suspendida');
    assert.strictEqual(replay.body.resultado.replayed, true);
    const today = formatLocalDate(new Date());
    const suspendedDetail = await expect(
      sessions[0],
      `/api/admin/suscripciones/${fixture.slugs[0]}?operacion=suspension&desde=${today}&hasta=${today}`,
      {}, 200, 'Detalle de suspension'
    );
    assert(suspendedDetail.body.suspendidaEn);
    assert.strictEqual(suspendedDetail.body.motivoTransicion, 'suspension_administrativa');
    assert.strictEqual(suspendedDetail.body.historial.resultados.length, 1);
    assert.strictEqual(suspendedDetail.body.historial.resultados[0].motivo, 'suspension_administrativa');
    const suspensionAudit = suspendedDetail.body.accionesAdministrativas.find(
      (item) => item.accion === 'suspension_suscripcion'
    );
    assert.strictEqual(suspensionAudit.metadata.motivoCodigo, 'seguridad');

    await expect(sessions[0], `/api/admin/suscripciones/${fixture.slugs[0]}/reactivar`, {
      method: 'POST', headers: { 'Idempotency-Key': `saas-admin:${marker}:reactivate` }, body: { periodo: 'mensual' }
    }, 200, 'Reactivacion');
    const renewed = await expect(sessions[0], `/api/admin/suscripciones/${fixture.slugs[0]}/renovar`, {
      method: 'POST', headers: { 'Idempotency-Key': `saas-admin:${marker}:renew` }, body: { periodo: 'mensual' }
    }, 200, 'Renovacion tecnica');
    assert.strictEqual(renewed.body.resultado.estado, 'activa');

    const plans = await expect(sessions[0], '/api/admin/planes', {}, 200, 'Planes');
    const advanced = plans.body.find((plan) => plan.codigo === 'avanzado');
    assert(advanced, 'No existe un plan avanzado para probar upgrade.');
    await expect(sessions[0], `/api/admin/suscripciones/${fixture.slugs[0]}/upgrade`, {
      method: 'POST', headers: { 'Idempotency-Key': `saas-admin:${marker}:upgrade` }, body: { codigoPlan: 'avanzado' }
    }, 200, 'Upgrade');
    await expect(sessions[0], `/api/admin/suscripciones/${fixture.slugs[0]}/downgrade`, {
      method: 'POST', headers: { 'Idempotency-Key': `saas-admin:${marker}:downgrade` }, body: { codigoPlan: 'basico' }
    }, 200, 'Downgrade');

    const cancelKey = `saas-admin:${marker}:cancel`;
    await Promise.all([
      expect(sessions[0], `/api/admin/suscripciones/${fixture.slugs[1]}/cancelar`, {
        method: 'POST', headers: { 'Idempotency-Key': cancelKey }, body: { motivo: 'solicitud_administrativa' }
      }, 200, 'Cancelacion concurrente A'),
      expect(sessions[1], `/api/admin/suscripciones/${fixture.slugs[1]}/cancelar`, {
        method: 'POST', headers: { 'Idempotency-Key': cancelKey }, body: { motivo: 'solicitud_administrativa' }
      }, 200, 'Cancelacion concurrente B')
    ]);
    await expect(sessions[0], `/api/admin/suscripciones/${fixture.slugs[1]}/renovar`, {
      method: 'POST', headers: { 'Idempotency-Key': `saas-admin:${marker}:renew-cancelled` }, body: { periodo: 'mensual' }
    }, 409, 'Cancelada no renovable');

    const [[effects]] = await connection.query(
      `SELECT
        SUM(tipoOperacion='suspension') suspensiones,
        SUM(tipoOperacion='reactivacion') reactivaciones,
        SUM(tipoOperacion='renovacion') renovaciones,
        SUM(tipoOperacion='upgrade') upgrades,
        SUM(tipoOperacion='downgrade_programado') downgrades
       FROM historialSuscripcionTienda WHERE idTienda=?`,
      [first.tienda.idTienda]
    );
    assert.deepStrictEqual(
      [effects.suspensiones, effects.reactivaciones, effects.renovaciones, effects.upgrades, effects.downgrades].map(Number),
      [1, 1, 1, 1, 1]
    );
    const [[cancelled]] = await connection.query(
      `SELECT COUNT(*) total FROM historialSuscripcionTienda
       WHERE idTienda=? AND tipoOperacion='cancelacion'`,
      [second.tienda.idTienda]
    );
    assert.strictEqual(Number(cancelled.total), 1);
    const [[audit]] = await connection.query(
      `SELECT
        SUM(accion='suspension_suscripcion') suspensiones,
        SUM(accion='reactivacion_suscripcion') reactivaciones,
        SUM(accion='renovacion_suscripcion') renovaciones,
        SUM(accion='cancelacion_suscripcion') cancelaciones
       FROM eventoAuditoriaAdministrativa WHERE idTienda IN (?,?)`,
      [first.tienda.idTienda, second.tienda.idTienda]
    );
    assert.deepStrictEqual(
      [audit.suspensiones, audit.reactivaciones, audit.renovaciones, audit.cancelaciones].map(Number),
      [1, 1, 1, 1]
    );
    console.log('test:saas-subscription-admin OK');
  } finally {
    for (const session of sessions) {
      try { if (session.cookie) await session.request('/auth/logout', { method: 'POST' }); } catch { /* cleanup continua */ }
    }
    try { await cleanup(connection, fixture, sessions); } finally { await connection.end(); }
  }
}

main().catch((error) => {
  console.error(`test:saas-subscription-admin FAIL: ${error.message}`);
  process.exitCode = 1;
});
