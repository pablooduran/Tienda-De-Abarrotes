const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { createDatabaseConnection } = require('../config/database-connection');
const { requireLocalhostDatabase } = require('../config/env');
const { formatLocalDateTime } = require('../utils/local-datetime');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function safeValue(value) {
  if (Array.isArray(value)) return value.map(safeValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !/(password|contrasena|cookie|session|token|secret|hash)/i.test(key))
    .map(([key, item]) => [key, safeValue(item)]));
}

class HttpSession {
  constructor(baseUrl, cookie = '') {
    this.baseUrl = baseUrl;
    this.cookie = cookie;
    this.lastSetCookie = '';
  }

  async request(path, options = {}) {
    const request = { ...options, headers: { ...(options.headers || {}) } };
    if (request.body && typeof request.body !== 'string') {
      request.headers['content-type'] = 'application/json';
      request.body = JSON.stringify(request.body);
    }
    if (this.cookie) request.headers.cookie = this.cookie;
    const response = await fetch(`${this.baseUrl}${path}`, { ...request, redirect: 'manual' });
    const setCookie = response.headers.get('set-cookie') || '';
    this.lastSetCookie = setCookie;
    if (setCookie) {
      const pair = setCookie.split(';')[0];
      this.cookie = pair.endsWith('=') ? '' : pair;
    }
    const text = await response.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = text; }
    return { status: response.status, body };
  }
}

async function expect(session, path, options, status, label) {
  const response = await session.request(path, options);
  if (response.status !== status) {
    throw new Error(`${label}: ${JSON.stringify({
      metodo: options?.method || 'GET',
      ruta: path,
      esperado: status,
      recibido: response.status,
      respuesta: safeValue(response.body)
    })}`);
  }
  return response.body;
}

function cookieCleared(session) {
  return /tienda\.sid=;/i.test(session.lastSetCookie)
    || /max-age=0/i.test(session.lastSetCookie)
    || /expires=thu, 01 jan 1970/i.test(session.lastSetCookie);
}

async function expectRevoked(session, expectedStatus = 401, expectedCode = 'SESSION_REVOKED', label = 'Sesion revocada') {
  const body = await expect(session, '/api/productos', {}, expectedStatus, label);
  assert(body?.code === expectedCode, `${label}: no devolvio el codigo estable esperado.`);
  assert(cookieCleared(session), `${label}: no elimino la cookie de sesion.`);
}

async function login(session, usuario, password, label = 'Login') {
  return expect(session, '/auth/login', {
    method: 'POST', body: { usuario, password }
  }, 200, label);
}

async function resolvePlans(connection) {
  const [plans] = await connection.query(
    'SELECT idPlan, codigo FROM plan WHERE activo=1 ORDER BY idPlan'
  );
  assert(plans.length >= 2, 'Se requieren dos planes activos reales para probar downgrade sin IDs fijos.');
  return { initial: plans[plans.length - 1], downgrade: plans[0] };
}

async function createStore(superSession, marker, suffix, planCode) {
  const password = `Owner-${suffix}-${crypto.randomBytes(10).toString('hex')}!`;
  const body = {
    nombre: `Tienda sesiones ${suffix} ${marker}`,
    slug: `tienda-sesiones-${suffix}-${marker}`,
    activo: true,
    estado: 'activa',
    propietario: {
      usuario: `owner_session_${suffix}_${marker}`,
      password,
      confirmacionPassword: password,
      activo: true
    },
    suscripcion: { planCodigo: planCode, tipo: 'prueba', duracionDias: 30 }
  };
  const result = await expect(superSession, '/api/admin/tiendas', {
    method: 'POST', body
  }, 201, `Crear tienda ${suffix}`);
  return {
    idTienda: Number(result.tienda.idTienda),
    idAdministrador: Number(result.propietario.idAdministrador),
    usuario: body.propietario.usuario,
    password,
    slug: body.slug
  };
}

async function cleanupStore(connection, idTienda) {
  if (!idTienda) return;
  for (const table of [
    'seguimientoCobranza', 'pagoVenta', 'pagoFiado', 'cobroFiado', 'detalleFiado',
    'detalleVenta', 'detalleCompra', 'fiado', 'venta', 'compra', 'movimientoLote',
    'loteProducto', 'movimientoStock', 'producto', 'cliente', 'proveedor',
    'plantillaCobranzaTienda', 'configuracionCreditoTienda',
    'configuracionInventarioTienda', 'categoriaGasto', 'suscripcionTienda'
  ]) {
    await connection.query(`DELETE FROM ${table} WHERE idTienda=?`, [idTienda]);
  }
  await connection.query('DELETE FROM administrador WHERE idTienda=?', [idTienda]);
  await connection.query('DELETE FROM tienda WHERE idTienda=?', [idTienda]);
}

async function main() {
  const config = { ...requireLocalhostDatabase('La prueba de revocacion de sesiones'), decimalNumbers: true };
  if (!/(prueba|test)/i.test(config.database)) {
    throw new Error('La prueba solo puede ejecutarse sobre una base cuyo nombre contenga prueba o test.');
  }
  const baseUrl = process.env.TEST_BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
  const marker = crypto.randomBytes(6).toString('hex');
  const superUser = `super_session_${marker}`;
  const superPassword = `Super-${crypto.randomBytes(12).toString('hex')}!`;
  const resetPassword = `Reset-${crypto.randomBytes(12).toString('hex')}!`;
  const ownPassword = `Own-${crypto.randomBytes(12).toString('hex')}!`;
  const renamedUser = `owner_session_renamed_${marker}`;
  const sessions = [];
  let connection;
  let storeA;
  let storeB;
  let deletedUser = null;

  try {
    connection = await createDatabaseConnection(config);
    const plans = await resolvePlans(connection);
    const superHash = await bcrypt.hash(superPassword, 12);
    await connection.query(
      `INSERT INTO administrador (idTienda,usuario,password,rol,activo)
       VALUES (NULL,?,?,'superadmin',1)`,
      [superUser, superHash]
    );

    const superSession = new HttpSession(baseUrl);
    sessions.push(superSession);
    await login(superSession, superUser, superPassword, 'Login valido de superadmin');
    const firstSessionCookie = superSession.cookie;
    await login(superSession, superUser, superPassword, 'Segundo login regenera la sesion');
    assert(firstSessionCookie && superSession.cookie && firstSessionCookie !== superSession.cookie,
      'El login no regenero el identificador de sesion.');
    const fixedSession = new HttpSession(baseUrl, firstSessionCookie);
    sessions.push(fixedSession);
    await expect(fixedSession, '/api/admin/planes', {}, 401, 'La sesion anterior a regenerate queda destruida');
    await expect(superSession, '/api/admin/planes', {}, 200, 'Superadmin conserva acceso administrativo');
    await expect(superSession, '/api/productos', {}, 403, 'Superadmin sin tenant no usa rutas comerciales');

    storeA = await createStore(superSession, marker, 'a', plans.initial.codigo);
    storeB = await createStore(superSession, marker, 'b', plans.initial.codigo);
    const ownerA = new HttpSession(baseUrl);
    const ownerASecond = new HttpSession(baseUrl);
    const ownerB = new HttpSession(baseUrl);
    sessions.push(ownerA, ownerASecond, ownerB);
    await login(ownerA, storeA.usuario, storeA.password, 'Login propietario A');
    await login(ownerASecond, storeA.usuario, storeA.password, 'Segunda sesion propietario A');
    await login(ownerB, storeB.usuario, storeB.password, 'Login propietario B');
    await expect(ownerA, '/api/productos', {}, 200, 'Administrador activo puede operar');

    await expect(superSession, `/api/admin/propietarios/${storeA.idAdministrador}/desactivar`, {
      method: 'PATCH'
    }, 200, 'Desactivar administrador');
    await expectRevoked(ownerA, 401, 'SESSION_REVOKED', 'Desactivar invalida primera sesion');
    await expectRevoked(ownerASecond, 401, 'SESSION_REVOKED', 'Desactivar invalida segunda sesion');
    await expect(ownerB, '/api/productos', {}, 200, 'La sesion de otro usuario no fue afectada');
    await expect(superSession, `/api/admin/propietarios/${storeA.idAdministrador}/activar`, {
      method: 'PATCH'
    }, 200, 'Reactivar administrador');
    await expect(ownerA, '/api/productos', {}, 401, 'Reactivar no revive una sesion antigua');

    await login(ownerA, storeA.usuario, storeA.password, 'Login tras reactivacion');
    await login(ownerASecond, storeA.usuario, storeA.password, 'Segunda sesion tras reactivacion');
    await expect(superSession, `/api/admin/propietarios/${storeA.idAdministrador}/restablecer-password`, {
      method: 'PATCH', body: { password: resetPassword, confirmacionPassword: resetPassword }
    }, 200, 'Restablecer contrasena por superadmin');
    await expectRevoked(ownerA, 401, 'SESSION_REVOKED', 'Reset invalida primera sesion');
    await expectRevoked(ownerASecond, 401, 'SESSION_REVOKED', 'Reset invalida segunda sesion');
    await expect(new HttpSession(baseUrl), '/auth/login', {
      method: 'POST', body: { usuario: storeA.usuario, password: storeA.password }
    }, 401, 'La contrasena anterior deja de funcionar');
    storeA.password = resetPassword;
    await login(ownerA, storeA.usuario, storeA.password, 'La contrasena restablecida permite login');

    await expect(superSession, `/api/admin/tiendas/${storeA.idTienda}/desactivar`, {
      method: 'PATCH', body: { estado: 'suspendida' }
    }, 200, 'Desactivar tienda');
    await expectRevoked(ownerA, 403, 'STORE_UNAVAILABLE', 'Tienda desactivada invalida sesion');
    await expect(superSession, `/api/admin/tiendas/${storeA.idTienda}/activar`, {
      method: 'PATCH'
    }, 200, 'Reactivar tienda');
    await expect(ownerA, '/api/productos', {}, 401, 'Reactivar tienda no revive sesion antigua');
    await login(ownerA, storeA.usuario, storeA.password, 'Login tras reactivar tienda');

    await expect(superSession, `/api/admin/propietarios/${storeA.idAdministrador}`, {
      method: 'PUT', body: { usuario: renamedUser }
    }, 200, 'Cambio de identidad visible');
    await expectRevoked(ownerA, 401, 'SESSION_REVOKED', 'Cambiar usuario invalida sesion');
    storeA.usuario = renamedUser;
    await login(ownerA, storeA.usuario, storeA.password, 'Login con usuario actualizado');

    await expect(ownerA, '/auth/change-password', {
      method: 'POST',
      body: {
        passwordActual: storeA.password,
        passwordNueva: ownPassword,
        confirmacionPassword: ownPassword
      }
    }, 200, 'Cambio de contrasena propio');
    assert(cookieCleared(ownerA), 'El cambio de contrasena propio no elimino la cookie actual.');
    await expect(new HttpSession(baseUrl), '/auth/login', {
      method: 'POST', body: { usuario: storeA.usuario, password: storeA.password }
    }, 401, 'Password anterior rechazado tras cambio propio');
    storeA.password = ownPassword;
    await login(ownerA, storeA.usuario, storeA.password, 'Login tras cambio propio');

    const [[subscriptionBefore]] = await connection.query(
      `SELECT idSuscripcion,idPlan,estado,
         DATE_FORMAT(fechaInicio,'%Y-%m-%d %H:%i:%s') fechaInicio,
         DATE_FORMAT(fechaFin,'%Y-%m-%d %H:%i:%s') fechaFin
       FROM suscripcionTienda
       WHERE idTienda=? ORDER BY idSuscripcion DESC LIMIT 1`,
      [storeA.idTienda]
    );
    await connection.query('UPDATE suscripcionTienda SET idPlan=? WHERE idSuscripcion=?', [
      plans.downgrade.idPlan, subscriptionBefore.idSuscripcion
    ]);
    await expect(ownerA, '/api/contexto', {}, 200, 'Downgrade no revoca identidad');
    const pastStart = formatLocalDateTime(new Date(Date.now() - (4 * 86400000)));
    const pastEnd = formatLocalDateTime(new Date(Date.now() - (2 * 86400000)));
    await connection.query(
      `UPDATE suscripcionTienda SET estado='activa',fechaInicio=?,fechaFin=? WHERE idSuscripcion=?`,
      [pastStart, pastEnd, subscriptionBefore.idSuscripcion]
    );
    await expect(ownerA, '/api/contexto', {}, 200, 'Suscripcion vencida conserva identidad para lectura');
    await connection.query(
      'UPDATE suscripcionTienda SET idPlan=?,estado=?,fechaInicio=?,fechaFin=? WHERE idSuscripcion=?',
      [subscriptionBefore.idPlan, subscriptionBefore.estado, subscriptionBefore.fechaInicio,
        subscriptionBefore.fechaFin, subscriptionBefore.idSuscripcion]
    );

    await connection.query(
      "UPDATE administrador SET rol='superadmin',idTienda=NULL WHERE idAdministrador=?",
      [storeA.idAdministrador]
    );
    await expectRevoked(ownerA, 401, 'SESSION_REVOKED', 'Cambio critico de rol invalida asociacion anterior');
    await connection.query(
      `UPDATE administrador SET rol='dueno_tienda',idTienda=?,versionSesion=versionSesion+1
       WHERE idAdministrador=?`,
      [storeA.idTienda, storeA.idAdministrador]
    );
    await login(ownerA, storeA.usuario, storeA.password, 'Login tras restaurar rol');

    await connection.query(
      'UPDATE administrador SET idTienda=? WHERE idAdministrador=?',
      [storeB.idTienda, storeA.idAdministrador]
    );
    await expectRevoked(ownerA, 401, 'SESSION_REVOKED', 'Cambio de tienda invalida tenant anterior');
    await connection.query(
      'UPDATE administrador SET idTienda=?,versionSesion=versionSesion+1 WHERE idAdministrador=?',
      [storeA.idTienda, storeA.idAdministrador]
    );
    await login(ownerA, storeA.usuario, storeA.password, 'Login tras restaurar asociacion');

    await expect(ownerA, `/api/admin/propietarios/${storeB.idAdministrador}/desactivar`, {
      method: 'PATCH'
    }, 403, 'Una tienda no invalida otra mediante APIs administrativas');
    await expect(ownerB, '/api/productos', {}, 200, 'Aislamiento de sesion entre tiendas');

    const concurrentSessions = Array.from(
      { length: 4 },
      () => new HttpSession(baseUrl, ownerA.cookie)
    );
    sessions.push(...concurrentSessions);
    const concurrentRequests = concurrentSessions.map((session) => session.request('/api/productos'));
    await expect(superSession, `/api/admin/propietarios/${storeA.idAdministrador}/desactivar`, {
      method: 'PATCH'
    }, 200, 'Invalidacion concurrente');
    const concurrentResults = await Promise.all(concurrentRequests);
    assert(concurrentResults.every((result) => [200, 401].includes(result.status)),
      'La concurrencia produjo un estado HTTP inesperado.');
    await expectRevoked(ownerA, 401, 'SESSION_REVOKED', 'Tras confirmar invalidacion no pasan solicitudes nuevas');
    await expect(superSession, `/api/admin/propietarios/${storeA.idAdministrador}/activar`, {
      method: 'PATCH'
    }, 200, 'Reactivar despues de concurrencia');

    const deletedPassword = `Deleted-${crypto.randomBytes(10).toString('hex')}!`;
    const deletedHash = await bcrypt.hash(deletedPassword, 12);
    deletedUser = `deleted_session_${marker}`;
    const [deletedResult] = await connection.query(
      `INSERT INTO administrador (idTienda,usuario,password,rol,activo)
       VALUES (?,?,?,'dueno_tienda',1)`,
      [storeA.idTienda, deletedUser, deletedHash]
    );
    const deletedSession = new HttpSession(baseUrl);
    sessions.push(deletedSession);
    await login(deletedSession, deletedUser, deletedPassword, 'Login administrador temporal');
    await connection.query('DELETE FROM administrador WHERE idAdministrador=?', [deletedResult.insertId]);
    await expectRevoked(deletedSession, 401, 'SESSION_REVOKED', 'Administrador inexistente queda bloqueado');

    await login(ownerA, storeA.usuario, storeA.password, 'Login final para logout');
    await expect(ownerA, '/auth/logout', { method: 'POST' }, 200, 'Logout');
    assert(cookieCleared(ownerA), 'Logout no elimino la cookie.');
    await expect(ownerA, '/api/productos', {}, 401, 'Logout destruye la sesion');

    console.log('Prueba de revocacion de sesiones completada correctamente.');
  } finally {
    for (const session of sessions) {
      try { await session.request('/auth/logout', { method: 'POST' }); } catch { /* Limpieza auxiliar. */ }
    }
    if (connection) {
      try {
        await cleanupStore(connection, storeA?.idTienda);
        await cleanupStore(connection, storeB?.idTienda);
        await connection.query(
          `DELETE FROM administrador
           WHERE usuario IN (?, ?, ?, ?, ?)`,
          [
            superUser,
            storeA?.usuario || '',
            storeB?.usuario || '',
            renamedUser,
            deletedUser || ''
          ]
        );
      } finally {
        await connection.end();
      }
    }
  }
}

main().catch((error) => {
  console.error('La prueba de revocacion de sesiones fallo.');
  console.error(error.message);
  process.exit(1);
});
