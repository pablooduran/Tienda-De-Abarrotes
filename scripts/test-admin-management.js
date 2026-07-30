const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const { createDatabaseConnection } = require('../config/database-connection');
const { requireLocalhostDatabase } = require('../config/env');
const { applyTestRequestSecurity } = require('./http-test-security');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

let capturedAuditRequestIds = null;

class HttpSession {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
    this.cookie = '';
  }

  async request(path, options = {}) {
    const request = { ...options, headers: { ...(options.headers || {}) } };
    if (request.body && typeof request.body !== 'string') {
      request.headers['content-type'] = 'application/json';
      request.body = JSON.stringify(request.body);
    }
    applyTestRequestSecurity(this.baseUrl, request);
    if (this.cookie) request.headers.cookie = this.cookie;
    const response = await fetch(`${this.baseUrl}${path}`, { ...request, redirect: 'manual' });
    const requestId = response.headers.get('x-request-id');
    if (capturedAuditRequestIds && requestId) capturedAuditRequestIds.add(requestId);
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) this.cookie = setCookie.split(';')[0];
    const text = await response.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    return { status: response.status, body };
  }
}

async function expect(session, path, options, status, label) {
  const response = await session.request(path, options);
  assert(response.status === status, `${label}: se esperaba HTTP ${status} y se obtuvo ${response.status}.`);
  return response.body;
}

function containsSensitivePassword(value) {
  if (Array.isArray(value)) return value.some(containsSensitivePassword);
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(([key, item]) => (
    ['password', 'passwordHash', 'hash'].includes(key) || containsSensitivePassword(item)
  ));
}

function assertUniformLoginRejection(body, label, referenceBody = null, forbiddenValues = []) {
  assert(body?.code === 'INVALID_CREDENTIALS', `${label}: no devolvio INVALID_CREDENTIALS.`);
  assert(body?.error === 'Credenciales incorrectas.', `${label}: expuso un mensaje de autenticacion diferente.`);
  const unexpectedKeys = Object.keys(body || {}).filter((key) => !['error', 'code', 'requestId'].includes(key));
  assert(unexpectedKeys.length === 0, `${label}: expuso campos internos: ${unexpectedKeys.join(', ')}.`);
  if (referenceBody) {
    assert(body.error === referenceBody.error && body.code === referenceBody.code,
      `${label}: no coincide con el rechazo por contrasena incorrecta.`);
  }
  const serialized = JSON.stringify({ error: body?.error, code: body?.code }).toLowerCase();
  for (const value of forbiddenValues.filter(Boolean)) {
    assert(!serialized.includes(String(value).toLowerCase()), `${label}: expuso informacion sobre ${value}.`);
  }
}

async function cleanup(connection, fixture) {
  if (!connection) return;
  await connection.beginTransaction();
  try {
    const [stores] = await connection.query(
      'SELECT idTienda FROM tienda WHERE slug IN (?, ?)',
      [fixture.slug, fixture.duplicateUserSlug]
    );
    const storeIds = stores.map((store) => Number(store.idTienda));
    const [administrators] = await connection.query(
      `SELECT idAdministrador FROM administrador
       WHERE usuario=? OR idTienda IN (?)`,
      [fixture.superUser, storeIds.length ? storeIds : [0]]
    );
    const administratorIds = administrators.map((row) => Number(row.idAdministrador));
    const auditPredicates = [];
    const auditParameters = [];
    if (storeIds.length) {
      auditPredicates.push('idTienda IN (?)');
      auditParameters.push(storeIds);
    }
    if (administratorIds.length) {
      auditPredicates.push('idAdministradorActor IN (?)');
      auditParameters.push(administratorIds);
    }
    const requestIds = [...(capturedAuditRequestIds || [])];
    if (requestIds.length) {
      auditPredicates.push('requestId IN (?)');
      auditParameters.push(requestIds);
    }
    if (auditPredicates.length) {
      await connection.query(
        `DELETE FROM eventoAuditoriaAdministrativa WHERE ${auditPredicates.join(' OR ')}`,
        auditParameters
      );
    }
    for (const store of stores) {
      const idTienda = store.idTienda;
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
      await connection.query('DELETE FROM configuracionCreditoTienda WHERE idTienda=?', [idTienda]);
      await connection.query('DELETE FROM configuracionInventarioTienda WHERE idTienda=?', [idTienda]);
      await connection.query('DELETE FROM configuracionTienda WHERE idTienda=?', [idTienda]);
      await connection.query('DELETE FROM suscripcionTienda WHERE idTienda=?', [idTienda]);
      await connection.query('DELETE FROM administrador WHERE idTienda=?', [idTienda]);
      await connection.query('DELETE FROM tienda WHERE idTienda=?', [idTienda]);
    }
    if (fixture.superUser) {
      await connection.query('DELETE FROM administrador WHERE usuario=?', [fixture.superUser]);
    }
    await connection.commit();
  } catch (error) {
    try { await connection.rollback(); } catch { /* La conexion puede estar cerrada. */ }
    throw error;
  }
}

async function main() {
  const config = { ...requireLocalhostDatabase('La prueba de administracion multi-tienda'), decimalNumbers: true };
  if (!/(prueba|test)/i.test(config.database)) {
    throw new Error('La prueba solo puede ejecutarse sobre una base cuyo nombre contenga prueba o test.');
  }

  const baseUrl = process.env.TEST_BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
  const marker = crypto.randomBytes(6).toString('hex');
  const fixture = {
    slug: `tienda-admin-test-${marker}`,
    duplicateUserSlug: `slug-distinto-${marker}`,
    superUser: `super_admin_test_${marker}`,
    ownerUser: `owner_admin_test_${marker}`,
    secondOwnerUser: `owner_extra_test_${marker}`
  };
  const superPassword = `Super-${crypto.randomBytes(12).toString('hex')}!`;
  const ownerPassword = `Owner-${crypto.randomBytes(12).toString('hex')}!`;
  const newOwnerPassword = `Nuevo-${crypto.randomBytes(12).toString('hex')}!`;
  const secondOwnerPassword = `Extra-${crypto.randomBytes(12).toString('hex')}!`;
  const sessions = [];
  let connection;
  capturedAuditRequestIds = new Set();

  try {
    connection = await createDatabaseConnection(config);
    const superHash = await bcrypt.hash(superPassword, 12);
    await connection.query(
      `INSERT INTO administrador (idTienda, usuario, password, rol, activo)
       VALUES (NULL, ?, ?, 'superadmin', 1)`,
      [fixture.superUser, superHash]
    );

    const superSession = new HttpSession(baseUrl);
    const ownerSession = new HttpSession(baseUrl);
    const oldPasswordSession = new HttpSession(baseUrl);
    sessions.push(superSession, ownerSession, oldPasswordSession);

    const superLogin = await expect(superSession, '/auth/login', {
      method: 'POST', body: { usuario: fixture.superUser, password: superPassword }
    }, 200, 'Login de superadmin');
    assert(superLogin.admin?.rol === 'superadmin', 'El login no devolvio el rol superadmin.');
    assert(!containsSensitivePassword(superLogin), 'El login expuso informacion de contrasena.');
    await expect(superSession, '/api/productos', {}, 403, 'Bloqueo operativo de superadmin');

    const created = await expect(superSession, '/api/admin/tiendas', {
      method: 'POST',
      body: {
        nombre: `Tienda administrativa ${marker}`,
        slug: fixture.slug,
        estado: 'activa',
        activo: true,
        propietario: {
          usuario: fixture.ownerUser,
          password: ownerPassword,
          confirmacionPassword: ownerPassword,
          activo: true
        },
        suscripcion: {
          planCodigo: 'avanzado',
          tipo: 'prueba',
          duracionDias: 14
        }
      }
    }, 201, 'Creacion transaccional de tienda');
    assert(!containsSensitivePassword(created), 'La creacion de tienda expuso informacion de contrasena.');
    fixture.idTienda = created.tienda.idTienda;
    fixture.idOwner = created.propietario.idAdministrador;

    await expect(superSession, '/api/admin/tiendas', {
      method: 'POST',
      body: {
        nombre: 'Slug duplicado',
        slug: fixture.slug,
        propietario: {
          usuario: `otro_${marker}`,
          password: ownerPassword,
          confirmacionPassword: ownerPassword
        },
        suscripcion: {
          planCodigo: 'avanzado',
          tipo: 'prueba',
          duracionDias: 14
        }
      }
    }, 409, 'Rechazo de slug duplicado');
    await expect(superSession, '/api/admin/tiendas', {
      method: 'POST',
      body: {
        nombre: 'Usuario duplicado',
        slug: fixture.duplicateUserSlug,
        propietario: {
          usuario: fixture.ownerUser,
          password: ownerPassword,
          confirmacionPassword: ownerPassword
        },
        suscripcion: {
          planCodigo: 'avanzado',
          tipo: 'prueba',
          duracionDias: 14
        }
      }
    }, 409, 'Rechazo de usuario duplicado');

    const stores = await expect(superSession, '/api/admin/tiendas', {}, 200, 'Listado administrativo de tiendas');
    assert(stores.some((store) => Number(store.idTienda) === Number(fixture.idTienda)), 'La tienda creada no aparece en administracion.');
    assert(!containsSensitivePassword(stores), 'El listado de tiendas expuso informacion de contrasena.');

    const owners = await expect(
      superSession,
      `/api/admin/tiendas/${fixture.idTienda}/propietarios`,
      {},
      200,
      'Listado de propietarios'
    );
    assert(owners.length === 1 && owners[0].usuario === fixture.ownerUser, 'El propietario no quedo asociado correctamente.');
    assert(!containsSensitivePassword(owners), 'El listado de propietarios expuso informacion de contrasena.');

    const secondOwnerCreated = await expect(superSession, `/api/admin/tiendas/${fixture.idTienda}/propietarios`, {
      method: 'POST',
      body: {
        usuario: fixture.secondOwnerUser,
        password: secondOwnerPassword,
        confirmacionPassword: secondOwnerPassword,
        activo: true
      }
    }, 201, 'Creacion de propietario adicional');

    const wrongPasswordLogin = await expect(oldPasswordSession, '/auth/login', {
      method: 'POST', body: { usuario: fixture.ownerUser, password: `${ownerPassword}-incorrecta` }
    }, 401, 'Contrasena incorrecta usa respuesta uniforme');
    assertUniformLoginRejection(wrongPasswordLogin, 'Contrasena incorrecta');

    const missingUserLogin = await expect(oldPasswordSession, '/auth/login', {
      method: 'POST', body: { usuario: `usuario_inexistente_${marker}`, password: ownerPassword }
    }, 401, 'Usuario inexistente usa respuesta uniforme');
    assertUniformLoginRejection(missingUserLogin, 'Usuario inexistente', wrongPasswordLogin, [
      `usuario_inexistente_${marker}`, 'usuario', 'existente'
    ]);

    assert(secondOwnerCreated.propietario.idAdministrador, 'El propietario adicional no devolvio identificador.');
    const authSource = fs.readFileSync(path.resolve(__dirname, '..', 'routes', 'auth.js'), 'utf8');
    assert(authSource.includes("admin.rol === 'superadmin' && admin.idTienda !== null")
      && authSource.includes("admin.rol === 'dueno_tienda'")
      && (authSource.match(/return invalidCredentials\(res\);/g) || []).length >= 4,
    'Las asociaciones invalidas de login no usan la respuesta uniforme.');

    await expect(ownerSession, '/auth/login', {
      method: 'POST', body: { usuario: fixture.ownerUser, password: ownerPassword }
    }, 200, 'Login del propietario creado');
    await expect(ownerSession, '/api/admin/tiendas', {}, 403, 'Bloqueo administrativo de propietario');
    const ownerProducts = await expect(ownerSession, '/api/productos', {}, 200, 'Productos de la tienda nueva');
    assert(ownerProducts.length === 0, 'La tienda nueva recibio productos pertenecientes a otra tienda.');

    const [[storedOwner]] = await connection.query(
      'SELECT idTienda, rol, activo FROM administrador WHERE idAdministrador=?',
      [fixture.idOwner]
    );
    assert(Number(storedOwner.idTienda) === Number(fixture.idTienda), 'El propietario se guardo en una tienda incorrecta.');
    assert(storedOwner.rol === 'dueno_tienda', 'El endpoint administrativo creo un rol no permitido.');

    await expect(superSession, `/api/admin/tiendas/${fixture.idTienda}/desactivar`, {
      method: 'PATCH', body: { estado: 'suspendida' }
    }, 200, 'Desactivacion de tienda');
    const disabledStoreSession = await expect(
      ownerSession, '/api/productos', {}, 403, 'Invalidacion de sesion por tienda inactiva'
    );
    assert(disabledStoreSession.code === 'STORE_UNAVAILABLE', 'La tienda inactiva no devolvio el codigo estable.');
    const disabledStoreLogin = await expect(ownerSession, '/auth/login', {
      method: 'POST', body: { usuario: fixture.ownerUser, password: ownerPassword }
    }, 401, 'Login nuevo bloqueado por tienda inactiva');
    assertUniformLoginRejection(disabledStoreLogin, 'Tienda inactiva durante login', wrongPasswordLogin, [
      fixture.ownerUser, fixture.slug, marker, 'tienda', 'suspendida', 'store_unavailable'
    ]);

    await expect(superSession, `/api/admin/tiendas/${fixture.idTienda}/activar`, {
      method: 'PATCH'
    }, 200, 'Reactivacion de tienda');
    await expect(ownerSession, '/api/productos', {}, 401, 'La reactivacion no revive la sesion anterior');
    await expect(ownerSession, '/auth/login', {
      method: 'POST', body: { usuario: fixture.ownerUser, password: ownerPassword }
    }, 200, 'Login despues de reactivar tienda');

    await expect(superSession, `/api/admin/propietarios/${fixture.idOwner}/desactivar`, {
      method: 'PATCH'
    }, 200, 'Desactivacion de propietario');
    const disabledOwnerSession = await expect(
      ownerSession, '/api/productos', {}, 401, 'Invalidacion de sesion por propietario inactivo'
    );
    assert(disabledOwnerSession.code === 'SESSION_REVOKED', 'El propietario inactivo no devolvio SESSION_REVOKED.');
    const disabledOwnerLogin = await expect(ownerSession, '/auth/login', {
      method: 'POST', body: { usuario: fixture.ownerUser, password: ownerPassword }
    }, 401, 'Bloqueo de propietario inactivo');
    assertUniformLoginRejection(disabledOwnerLogin, 'Administrador inactivo durante login', wrongPasswordLogin, [
      fixture.ownerUser, 'administrador', 'inactivo', 'session_revoked'
    ]);

    await expect(superSession, `/api/admin/propietarios/${fixture.idOwner}/activar`, {
      method: 'PATCH'
    }, 200, 'Reactivacion de propietario');
    await expect(ownerSession, '/auth/login', {
      method: 'POST', body: { usuario: fixture.ownerUser, password: ownerPassword }
    }, 200, 'Login antes del restablecimiento');
    const passwordReset = await expect(superSession, `/api/admin/propietarios/${fixture.idOwner}/restablecer-password`, {
      method: 'PATCH',
      body: { password: newOwnerPassword, confirmacionPassword: newOwnerPassword }
    }, 200, 'Restablecimiento de contrasena');
    assert(!containsSensitivePassword(passwordReset), 'El restablecimiento expuso informacion de contrasena.');
    const resetSession = await expect(
      ownerSession, '/api/productos', {}, 401, 'Restablecimiento invalida sesion existente'
    );
    assert(resetSession.code === 'SESSION_REVOKED', 'El restablecimiento no devolvio SESSION_REVOKED.');

    const rejectedOldPassword = await expect(oldPasswordSession, '/auth/login', {
      method: 'POST', body: { usuario: fixture.ownerUser, password: ownerPassword }
    }, 401, 'Rechazo de contrasena antigua');
    assertUniformLoginRejection(rejectedOldPassword, 'Contrasena anterior', wrongPasswordLogin);
    await expect(ownerSession, '/auth/login', {
      method: 'POST', body: { usuario: fixture.ownerUser, password: newOwnerPassword }
    }, 200, 'Aceptacion de contrasena nueva');

    console.log('Prueba de administracion multi-tienda completada correctamente.');
  } finally {
    for (const session of sessions) {
      try {
        await session.request('/auth/logout', { method: 'POST' });
      } catch {
        // La limpieza directa no depende de que el servidor siga disponible.
      }
    }
    try {
      await cleanup(connection, fixture);
    } finally {
      capturedAuditRequestIds = null;
      if (connection) await connection.end();
    }
  }
}

main().catch((error) => {
  console.error('La prueba de administracion multi-tienda fallo.');
  console.error(error.message);
  process.exit(1);
});
