const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../config/db');
const { requireAuth } = require('../middleware/auth');
const {
  clearSessionCookie,
  destroyRequestSession,
  validateSession
} = require('../services/session-validation-service');

const router = express.Router();

function regenerateSession(req) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((error) => (error ? reject(error) : resolve()));
  });
}

function publicAdmin(admin) {
  if (!admin) return null;
  return { id: admin.id ?? admin.idAdministrador, usuario: admin.usuario, rol: admin.rol };
}

function validateNewPassword(password, confirmation) {
  if (typeof password !== 'string' || password.length < 12) {
    const error = new Error('La nueva contrasena debe tener al menos 12 caracteres.');
    error.status = 400;
    throw error;
  }
  if (password !== confirmation) {
    const error = new Error('La confirmacion de contrasena no coincide.');
    error.status = 400;
    throw error;
  }
  return password;
}

router.post('/login', async (req, res, next) => {
  try {
    const { usuario, password } = req.body;
    if (!usuario || !password) {
      return res.status(400).json({ error: 'Usuario y contrasena son obligatorios.' });
    }

    const [rows] = await pool.query(
      `SELECT a.idAdministrador, a.usuario, a.password, a.rol, a.idTienda, a.versionSesion,
        t.activo AS tiendaActiva, t.estado AS estadoTienda
       FROM administrador a
       LEFT JOIN tienda t ON t.idTienda=a.idTienda
       WHERE a.usuario=? AND a.activo=1
       LIMIT 1`,
      [usuario]
    );
    if (rows.length === 0) {
      return res.status(401).json({ error: 'Credenciales incorrectas.' });
    }

    const ok = await bcrypt.compare(password, rows[0].password);
    if (!ok) {
      return res.status(401).json({ error: 'Credenciales incorrectas.' });
    }

    const admin = rows[0];
    if (!['dueno_tienda', 'superadmin'].includes(admin.rol)) {
      return res.status(403).json({ error: 'La cuenta no tiene un rol valido.' });
    }
    if (admin.rol === 'superadmin' && admin.idTienda !== null) {
      return res.status(403).json({ error: 'La cuenta superadmin tiene una configuracion invalida.' });
    }
    if (admin.rol === 'dueno_tienda'
      && (!Number.isInteger(Number(admin.idTienda))
        || Number(admin.idTienda) <= 0
        || !admin.tiendaActiva
        || admin.estadoTienda !== 'activa')) {
      return res.status(403).json({ error: 'La tienda asociada no esta disponible.' });
    }

    await regenerateSession(req);
    req.session.admin = {
      id: admin.idAdministrador,
      usuario: admin.usuario,
      rol: admin.rol,
      idTienda: admin.idTienda === null ? null : Number(admin.idTienda),
      versionSesion: Number(admin.versionSesion)
    };
    res.json({ message: 'Sesion iniciada.', admin: publicAdmin(req.session.admin) });
  } catch (error) {
    next(error);
  }
});

router.get('/status', async (req, res, next) => {
  try {
    const validation = await validateSession(req.session?.admin);
    if (!validation.valid) {
      await destroyRequestSession(req, res);
      return res.json({ authenticated: false, admin: null, code: validation.code });
    }
    req.auth = validation.context;
    return res.json({ authenticated: true, admin: publicAdmin(validation.context) });
  } catch (error) {
    return next(error);
  }
});

router.post('/change-password', requireAuth, async (req, res, next) => {
  const connection = await pool.getConnection();
  try {
    const currentPassword = req.body?.passwordActual;
    const newPassword = validateNewPassword(req.body?.passwordNueva, req.body?.confirmacionPassword);
    if (typeof currentPassword !== 'string' || !currentPassword) {
      const error = new Error('La contrasena actual es obligatoria.');
      error.status = 400;
      throw error;
    }

    await connection.beginTransaction();
    const [rows] = await connection.query(
      `SELECT password, versionSesion FROM administrador
       WHERE idAdministrador=? FOR UPDATE`,
      [req.auth.idAdministrador]
    );
    if (!rows.length || Number(rows[0].versionSesion) !== req.auth.versionSesion) {
      const error = new Error('La sesion ya no es valida.');
      error.status = 401;
      error.code = 'SESSION_REVOKED';
      throw error;
    }
    if (!await bcrypt.compare(currentPassword, rows[0].password)) {
      const error = new Error('La contrasena actual es incorrecta.');
      error.status = 401;
      throw error;
    }
    if (await bcrypt.compare(newPassword, rows[0].password)) {
      const error = new Error('La nueva contrasena debe ser diferente de la actual.');
      error.status = 400;
      throw error;
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await connection.query(
      `UPDATE administrador
       SET password=?, versionSesion=versionSesion+1
       WHERE idAdministrador=?`,
      [passwordHash, req.auth.idAdministrador]
    );
    await connection.commit();
    await destroyRequestSession(req, res);
    return res.json({ message: 'Contrasena actualizada. Inicie sesion nuevamente.' });
  } catch (error) {
    await connection.rollback();
    return next(error);
  } finally {
    connection.release();
  }
});

router.post('/logout', (req, res, next) => {
  clearSessionCookie(res);
  if (!req.session) return res.json({ message: 'Sesion cerrada.' });
  return req.session.destroy((error) => {
    if (error) return next(error);
    return res.json({ message: 'Sesion cerrada.' });
  });
});

module.exports = router;
