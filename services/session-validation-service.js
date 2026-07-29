const pool = require('../config/db');

const SESSION_COOKIE_NAME = 'tienda.sid';
const VALID_ROLES = new Set(['dueno_tienda', 'superadmin']);

function invalidResult(reason, status = 401, code = 'SESSION_REVOKED') {
  return Object.freeze({ valid: false, reason, status, code });
}

function sessionIdentity(sessionAdmin) {
  const idAdministrador = Number(sessionAdmin?.id);
  const versionSesion = Number(sessionAdmin?.versionSesion);
  if (!Number.isInteger(idAdministrador) || idAdministrador <= 0
    || !Number.isInteger(versionSesion) || versionSesion <= 0
    || !VALID_ROLES.has(sessionAdmin?.rol)) {
    return null;
  }
  const idTienda = sessionAdmin.idTienda === null ? null : Number(sessionAdmin.idTienda);
  if (sessionAdmin.rol === 'superadmin' && idTienda !== null) return null;
  if (sessionAdmin.rol === 'dueno_tienda' && (!Number.isInteger(idTienda) || idTienda <= 0)) return null;
  return { idAdministrador, idTienda, rol: sessionAdmin.rol, versionSesion };
}

async function validateSession(sessionAdmin, connection = pool) {
  if (!sessionAdmin) return invalidResult('sesion_ausente', 401, 'AUTH_REQUIRED');
  const identity = sessionIdentity(sessionAdmin);
  if (!identity) return invalidResult('sesion_incompleta');

  const [rows] = await connection.query(
    `SELECT a.idAdministrador, a.usuario, a.rol, a.idTienda, a.activo AS administradorActivo, a.estadoAcceso,
       a.versionSesion, t.idTienda AS tiendaEncontrada, t.activo AS tiendaActiva,
       t.estado AS estadoTienda
     FROM administrador a
     LEFT JOIN tienda t ON t.idTienda=a.idTienda
     WHERE a.idAdministrador=?
     LIMIT 1`,
    [identity.idAdministrador]
  );
  if (!rows.length) return invalidResult('administrador_inexistente');

  const current = rows[0];
  const currentStore = current.idTienda === null ? null : Number(current.idTienda);
  if (!Number(current.administradorActivo) || current.estadoAcceso !== 'activo') return invalidResult('administrador_inactivo');
  if (!VALID_ROLES.has(current.rol)) return invalidResult('rol_invalido');
  if (current.rol !== identity.rol || currentStore !== identity.idTienda) {
    return invalidResult('asociacion_modificada');
  }
  if (current.rol === 'superadmin') {
    if (currentStore !== null) return invalidResult('superadmin_con_tienda');
  } else {
    if (!Number.isInteger(currentStore) || currentStore <= 0 || current.tiendaEncontrada === null) {
      return invalidResult('tienda_inexistente');
    }
    if (!Number(current.tiendaActiva) || current.estadoTienda !== 'activa') {
      return invalidResult('tienda_inactiva', 403, 'STORE_UNAVAILABLE');
    }
  }
  if (Number(current.versionSesion) !== identity.versionSesion) return invalidResult('version_revocada');

  return Object.freeze({
    valid: true,
    context: Object.freeze({
      idAdministrador: Number(current.idAdministrador),
      usuario: current.usuario,
      rol: current.rol,
      idTienda: currentStore,
      versionSesion: Number(current.versionSesion),
      administradorActivo: true,
      tiendaActiva: current.rol === 'superadmin' ? null : true
    })
  });
}

function clearSessionCookie(res) {
  res.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
}

function destroyRequestSession(req, res) {
  clearSessionCookie(res);
  if (!req.session) return Promise.resolve();
  return new Promise((resolve) => {
    req.session.destroy(() => resolve());
  });
}

async function revokeAdministratorSessions(connection, idAdministrador) {
  const [result] = await connection.query(
    'UPDATE administrador SET versionSesion=versionSesion+1 WHERE idAdministrador=?',
    [idAdministrador]
  );
  return result.affectedRows;
}

async function revokeStoreSessions(connection, idTienda) {
  const [result] = await connection.query(
    'UPDATE administrador SET versionSesion=versionSesion+1 WHERE idTienda=?',
    [idTienda]
  );
  return result.affectedRows;
}

module.exports = {
  SESSION_COOKIE_NAME,
  clearSessionCookie,
  destroyRequestSession,
  revokeAdministratorSessions,
  revokeStoreSessions,
  sessionIdentity,
  validateSession
};
