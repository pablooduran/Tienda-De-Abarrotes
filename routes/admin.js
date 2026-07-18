const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../config/db');

const router = express.Router();
const STORE_STATES = new Set(['activa', 'suspendida', 'inactiva']);
const PASSWORD_MIN_LENGTH = 12;

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function cleanText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function parseId(value, label) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw httpError(400, `${label} no es valido.`);
  }
  return id;
}

function parseBoolean(value, defaultValue = true) {
  if (value === undefined || value === null || value === '') return defaultValue;
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  if (value === false || value === 0 || value === '0' || value === 'false') return false;
  throw httpError(400, 'El valor de activo no es valido.');
}

function slugify(value) {
  return cleanText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

function validateUsername(value) {
  const usuario = cleanText(value);
  if (usuario.length < 3 || usuario.length > 50) {
    throw httpError(400, 'El usuario debe tener entre 3 y 50 caracteres.');
  }
  if (!/^[A-Za-z0-9._-]+$/.test(usuario)) {
    throw httpError(400, 'El usuario solo puede contener letras, numeros, punto, guion y guion bajo.');
  }
  return usuario;
}

function validatePassword(password, confirmation) {
  if (typeof password !== 'string' || password.length < PASSWORD_MIN_LENGTH) {
    throw httpError(400, `La contrasena debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres.`);
  }
  if (confirmation !== undefined && password !== confirmation) {
    throw httpError(400, 'La confirmacion de contrasena no coincide.');
  }
  return password;
}

function validateStorePayload(body, { partial = false } = {}) {
  const result = {};
  if (!partial || body.nombre !== undefined) {
    result.nombre = cleanText(body.nombre);
    if (result.nombre.length < 2 || result.nombre.length > 120) {
      throw httpError(400, 'El nombre de la tienda debe tener entre 2 y 120 caracteres.');
    }
  }

  if (!partial || body.slug !== undefined || body.nombre !== undefined) {
    result.slug = slugify(body.slug || result.nombre);
    if (!result.slug) throw httpError(400, 'No se pudo generar un slug valido.');
  }

  if (!partial || body.activo !== undefined || body.estado !== undefined) {
    const activo = parseBoolean(body.activo, true);
    const estado = cleanText(body.estado) || (activo ? 'activa' : 'inactiva');
    if (!STORE_STATES.has(estado)) throw httpError(400, 'El estado de la tienda no es valido.');
    if ((estado === 'activa') !== activo) {
      throw httpError(400, 'Una tienda activa debe estar habilitada; una suspendida o inactiva debe estar deshabilitada.');
    }
    result.activo = activo ? 1 : 0;
    result.estado = estado;
  }
  return result;
}

function validateOwnerPayload(body, { passwordRequired = true } = {}) {
  const result = { usuario: validateUsername(body.usuario) };
  if (passwordRequired || body.password !== undefined) {
    result.password = validatePassword(body.password, body.confirmacionPassword);
  }
  result.activo = parseBoolean(body.activo, true) ? 1 : 0;
  return result;
}

async function findStore(connection, idTienda, forUpdate = false) {
  const [rows] = await connection.query(
    `SELECT idTienda, nombre, slug, estado, activo, creadoEn, actualizadoEn
     FROM tienda
     WHERE idTienda=?${forUpdate ? ' FOR UPDATE' : ''}`,
    [idTienda]
  );
  return rows[0] || null;
}

function storeSummaryQuery(whereClause = '') {
  return `SELECT t.idTienda, t.nombre, t.slug, t.estado, t.activo, t.creadoEn, t.actualizadoEn,
      (SELECT COUNT(*) FROM administrador a
       WHERE a.idTienda=t.idTienda AND a.rol='dueno_tienda') AS cantidadPropietarios,
      (SELECT COUNT(*) FROM producto p WHERE p.idTienda=t.idTienda) AS cantidadProductos,
      (SELECT COUNT(*) FROM cliente c WHERE c.idTienda=t.idTienda) AS cantidadClientes,
      NULLIF(GREATEST(
        COALESCE((SELECT MAX(v.fecha) FROM venta v WHERE v.idTienda=t.idTienda), '1000-01-01 00:00:00'),
        COALESCE((SELECT MAX(co.fecha) FROM compra co WHERE co.idTienda=t.idTienda), '1000-01-01 00:00:00'),
        COALESCE((SELECT MAX(pf.fechaPago) FROM pagoFiado pf WHERE pf.idTienda=t.idTienda), '1000-01-01 00:00:00')
      ), '1000-01-01 00:00:00') AS ultimaActividad
    FROM tienda t
    ${whereClause}`;
}

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

router.get('/tiendas', asyncRoute(async (req, res) => {
  const [rows] = await pool.query(`${storeSummaryQuery()} ORDER BY t.creadoEn DESC, t.idTienda DESC`);
  res.json(rows);
}));

router.get('/tiendas/:idTienda', asyncRoute(async (req, res) => {
  const idTienda = parseId(req.params.idTienda, 'La tienda');
  const [rows] = await pool.query(storeSummaryQuery('WHERE t.idTienda=?'), [idTienda]);
  if (!rows.length) throw httpError(404, 'La tienda no existe.');
  res.json(rows[0]);
}));

router.post('/tiendas', asyncRoute(async (req, res) => {
  const tienda = validateStorePayload(req.body || {});
  const propietario = validateOwnerPayload(req.body?.propietario || {});
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [slugRows] = await connection.query('SELECT idTienda FROM tienda WHERE slug=? LIMIT 1', [tienda.slug]);
    if (slugRows.length) throw httpError(409, 'Ya existe una tienda con ese slug.');
    const [userRows] = await connection.query('SELECT idAdministrador FROM administrador WHERE usuario=? LIMIT 1', [propietario.usuario]);
    if (userRows.length) throw httpError(409, 'El usuario indicado ya existe.');

    const [storeResult] = await connection.query(
      'INSERT INTO tienda (nombre, slug, estado, activo) VALUES (?, ?, ?, ?)',
      [tienda.nombre, tienda.slug, tienda.estado, tienda.activo]
    );
    const passwordHash = await bcrypt.hash(propietario.password, 12);
    const [ownerResult] = await connection.query(
      `INSERT INTO administrador (idTienda, usuario, password, rol, activo)
       VALUES (?, ?, ?, 'dueno_tienda', ?)`,
      [storeResult.insertId, propietario.usuario, passwordHash, propietario.activo]
    );
    await connection.commit();
    res.status(201).json({
      message: 'Tienda y propietario creados correctamente.',
      tienda: { idTienda: storeResult.insertId, ...tienda },
      propietario: { idAdministrador: ownerResult.insertId, usuario: propietario.usuario, activo: propietario.activo }
    });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}));

router.put('/tiendas/:idTienda', asyncRoute(async (req, res) => {
  const idTienda = parseId(req.params.idTienda, 'La tienda');
  const tienda = validateStorePayload(req.body || {});
  const [result] = await pool.query(
    `UPDATE tienda SET nombre=?, slug=?, estado=?, activo=?, actualizadoEn=CURRENT_TIMESTAMP
     WHERE idTienda=?`,
    [tienda.nombre, tienda.slug, tienda.estado, tienda.activo, idTienda]
  );
  if (!result.affectedRows) throw httpError(404, 'La tienda no existe.');
  res.json({ message: 'Tienda actualizada correctamente.' });
}));

router.patch('/tiendas/:idTienda/activar', asyncRoute(async (req, res) => {
  const idTienda = parseId(req.params.idTienda, 'La tienda');
  const [result] = await pool.query(
    "UPDATE tienda SET activo=1, estado='activa', actualizadoEn=CURRENT_TIMESTAMP WHERE idTienda=?",
    [idTienda]
  );
  if (!result.affectedRows) throw httpError(404, 'La tienda no existe.');
  res.json({ message: 'Tienda activada correctamente.' });
}));

router.patch('/tiendas/:idTienda/desactivar', asyncRoute(async (req, res) => {
  const idTienda = parseId(req.params.idTienda, 'La tienda');
  const estado = cleanText(req.body?.estado) || 'inactiva';
  if (!['suspendida', 'inactiva'].includes(estado)) {
    throw httpError(400, 'Al desactivar, el estado debe ser suspendida o inactiva.');
  }
  const [result] = await pool.query(
    'UPDATE tienda SET activo=0, estado=?, actualizadoEn=CURRENT_TIMESTAMP WHERE idTienda=?',
    [estado, idTienda]
  );
  if (!result.affectedRows) throw httpError(404, 'La tienda no existe.');
  res.json({ message: 'Tienda desactivada correctamente.' });
}));

router.get('/tiendas/:idTienda/propietarios', asyncRoute(async (req, res) => {
  const idTienda = parseId(req.params.idTienda, 'La tienda');
  const store = await findStore(pool, idTienda);
  if (!store) throw httpError(404, 'La tienda no existe.');
  const [rows] = await pool.query(
    `SELECT idAdministrador, usuario, activo
     FROM administrador
     WHERE idTienda=? AND rol='dueno_tienda'
     ORDER BY activo DESC, usuario ASC`,
    [idTienda]
  );
  res.json(rows);
}));

router.post('/tiendas/:idTienda/propietarios', asyncRoute(async (req, res) => {
  const idTienda = parseId(req.params.idTienda, 'La tienda');
  const propietario = validateOwnerPayload(req.body || {});
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const store = await findStore(connection, idTienda, true);
    if (!store) throw httpError(404, 'La tienda no existe.');
    const [userRows] = await connection.query('SELECT idAdministrador FROM administrador WHERE usuario=? LIMIT 1', [propietario.usuario]);
    if (userRows.length) throw httpError(409, 'El usuario indicado ya existe.');
    const passwordHash = await bcrypt.hash(propietario.password, 12);
    const [result] = await connection.query(
      `INSERT INTO administrador (idTienda, usuario, password, rol, activo)
       VALUES (?, ?, ?, 'dueno_tienda', ?)`,
      [idTienda, propietario.usuario, passwordHash, propietario.activo]
    );
    await connection.commit();
    res.status(201).json({
      message: 'Propietario creado correctamente.',
      propietario: { idAdministrador: result.insertId, usuario: propietario.usuario, activo: propietario.activo }
    });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}));

router.put('/propietarios/:idAdministrador', asyncRoute(async (req, res) => {
  const idAdministrador = parseId(req.params.idAdministrador, 'El propietario');
  const usuario = validateUsername(req.body?.usuario);
  const [result] = await pool.query(
    `UPDATE administrador SET usuario=?
     WHERE idAdministrador=? AND rol='dueno_tienda' AND idTienda IS NOT NULL`,
    [usuario, idAdministrador]
  );
  if (!result.affectedRows) throw httpError(404, 'El propietario no existe.');
  res.json({ message: 'Usuario del propietario actualizado correctamente.' });
}));

router.patch('/propietarios/:idAdministrador/activar', asyncRoute(async (req, res) => {
  const idAdministrador = parseId(req.params.idAdministrador, 'El propietario');
  const [result] = await pool.query(
    `UPDATE administrador SET activo=1
     WHERE idAdministrador=? AND rol='dueno_tienda' AND idTienda IS NOT NULL`,
    [idAdministrador]
  );
  if (!result.affectedRows) throw httpError(404, 'El propietario no existe.');
  res.json({ message: 'Propietario activado correctamente.' });
}));

router.patch('/propietarios/:idAdministrador/desactivar', asyncRoute(async (req, res) => {
  const idAdministrador = parseId(req.params.idAdministrador, 'El propietario');
  const [result] = await pool.query(
    `UPDATE administrador SET activo=0
     WHERE idAdministrador=? AND rol='dueno_tienda' AND idTienda IS NOT NULL`,
    [idAdministrador]
  );
  if (!result.affectedRows) throw httpError(404, 'El propietario no existe.');
  res.json({ message: 'Propietario desactivado correctamente.' });
}));

router.patch('/propietarios/:idAdministrador/restablecer-password', asyncRoute(async (req, res) => {
  const idAdministrador = parseId(req.params.idAdministrador, 'El propietario');
  const password = validatePassword(req.body?.password, req.body?.confirmacionPassword);
  const passwordHash = await bcrypt.hash(password, 12);
  const [result] = await pool.query(
    `UPDATE administrador SET password=?
     WHERE idAdministrador=? AND rol='dueno_tienda' AND idTienda IS NOT NULL`,
    [passwordHash, idAdministrador]
  );
  if (!result.affectedRows) throw httpError(404, 'El propietario no existe.');
  res.json({ message: 'Contrasena restablecida correctamente.' });
}));

router.use((error, req, res, next) => {
  if (error.code === 'ER_DUP_ENTRY') {
    const field = String(error.message).includes('usuario') ? 'usuario' : 'slug';
    return res.status(409).json({ error: `Ya existe un registro con ese ${field}.` });
  }
  if (error.status) return res.status(error.status).json({ error: error.message });
  console.error('Error en administracion de plataforma:', error.message);
  return res.status(500).json({ error: 'No se pudo completar la operacion administrativa.' });
});

module.exports = router;
