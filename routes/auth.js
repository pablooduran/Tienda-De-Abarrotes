const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../config/db');
const { isAuthenticated } = require('../middleware/auth');

const router = express.Router();

function regenerateSession(req) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((error) => (error ? reject(error) : resolve()));
  });
}

function publicAdmin(admin) {
  if (!admin) return null;
  return { id: admin.id, usuario: admin.usuario, rol: admin.rol };
}

router.post('/login', async (req, res, next) => {
  try {
    const { usuario, password } = req.body;
    if (!usuario || !password) {
      return res.status(400).json({ error: 'Usuario y contrasena son obligatorios.' });
    }

    const [rows] = await pool.query(
      `SELECT a.idAdministrador, a.usuario, a.password, a.rol, a.idTienda,
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
      idTienda: admin.idTienda === null ? null : Number(admin.idTienda)
    };
    res.json({ message: 'Sesion iniciada.', admin: publicAdmin(req.session.admin) });
  } catch (error) {
    next(error);
  }
});

router.get('/status', (req, res) => {
  const authenticated = isAuthenticated(req);
  res.json({ authenticated, admin: authenticated ? publicAdmin(req.session.admin) : null });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('tienda.sid');
    res.json({ message: 'Sesion cerrada.' });
  });
});

module.exports = router;
