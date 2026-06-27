const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../config/db');

const router = express.Router();

router.post('/login', async (req, res, next) => {
  try {
    const { usuario, password } = req.body;
    if (!usuario || !password) {
      return res.status(400).json({ error: 'Usuario y contrasena son obligatorios.' });
    }

    const [rows] = await pool.query('SELECT * FROM administrador WHERE usuario = ?', [usuario]);
    if (rows.length === 0) {
      return res.status(401).json({ error: 'Credenciales incorrectas.' });
    }

    const ok = await bcrypt.compare(password, rows[0].password);
    if (!ok) {
      return res.status(401).json({ error: 'Credenciales incorrectas.' });
    }

    req.session.admin = { id: rows[0].idAdministrador, usuario: rows[0].usuario };
    res.json({ message: 'Sesion iniciada.', admin: req.session.admin });
  } catch (error) {
    next(error);
  }
});

router.get('/status', (req, res) => {
  res.json({ authenticated: Boolean(req.session.admin), admin: req.session.admin || null });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('tienda.sid');
    res.json({ message: 'Sesion cerrada.' });
  });
});

module.exports = router;
