const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../config/db');
const {
  createSubscription,
  enforcePlanLimit
} = require('../services/subscription-service');
const { ensureDefaultExpenseCategories } = require('../services/financial-service');
const { ensureInventoryConfiguration } = require('../services/inventory-intelligence-service');
const { revokeStoreSessions } = require('../services/session-validation-service');
const { formatLocalDateTime } = require('../utils/local-datetime');

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

async function ensureCreditConfiguration(connection, idTienda, localDateTime) {
  await connection.query(
    `INSERT INTO configuracionCreditoTienda
     (idTienda, limiteCreditoDefault, diasCreditoDefault, diasAvisoVencimiento,
      politicaFiadoVencido, requiereTelefonoParaFiado, permiteFiadoSinFecha,
      codigoPaisWhatsApp, creadoEn, actualizadoEn, idAdministradorActualiza)
     VALUES (?, NULL, 30, 3, 'advertir', 0, 1, NULL, ?, ?, NULL)
     ON DUPLICATE KEY UPDATE idTienda=idTienda`,
    [idTienda, localDateTime, localDateTime]
  );
  const templates = [
    ['recordatorio_previo', 'Recordatorio previo', 'Hola {cliente}, {tienda} le recuerda que su saldo de {saldo} vence el {vencimiento}.'],
    ['deuda_vencida', 'Deuda vencida', 'Hola {cliente}, su saldo pendiente con {tienda} es {saldo} y tiene {dias_atraso} dias de atraso.'],
    ['confirmacion_pago', 'Confirmacion de pago', 'Hola {cliente}, {tienda} confirma la recepcion de su pago. Saldo pendiente: {saldo}.'],
    ['estado_cuenta', 'Estado de cuenta', 'Hola {cliente}, su estado de cuenta en {tienda} muestra un saldo pendiente de {saldo}. Comprobante: {comprobante}.']
  ];
  for (const [type, name, content] of templates) {
    await connection.query(
      `INSERT INTO plantillaCobranzaTienda
       (idTienda,tipo,nombre,contenido,activo,creadoEn,actualizadoEn,idAdministradorActualiza)
       VALUES (?, ?, ?, ?, 1, ?, ?, NULL)
       ON DUPLICATE KEY UPDATE idPlantillaCobranza=idPlantillaCobranza`,
      [idTienda, type, name, content, localDateTime, localDateTime]
    );
  }
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
      ), '1000-01-01 00:00:00') AS ultimaActividad,
      p.codigo AS planCodigo, p.nombre AS planNombre,
      s.idSuscripcion, s.tipo AS tipoSuscripcion, s.estado AS estadoSuscripcion,
      CASE
        WHEN s.idSuscripcion IS NULL THEN 'sin_suscripcion'
        WHEN s.estado IN ('activa','pendiente') AND CURRENT_TIMESTAMP>=s.fechaFin THEN 'vencida'
        WHEN s.estado IN ('activa','pendiente') AND CURRENT_TIMESTAMP<s.fechaInicio THEN 'pendiente'
        WHEN s.estado='pendiente' THEN 'activa'
        ELSE s.estado
      END AS estadoSuscripcionEfectivo,
      s.fechaInicio AS fechaInicioSuscripcion, s.fechaFin AS fechaFinSuscripcion
    FROM tienda t
    LEFT JOIN suscripcionTienda s ON s.idSuscripcion=(
      SELECT s2.idSuscripcion FROM suscripcionTienda s2
      WHERE s2.idTienda=t.idTienda
      ORDER BY
        CASE
          WHEN s2.estado IN ('activa','pendiente') AND CURRENT_TIMESTAMP>=s2.fechaInicio AND CURRENT_TIMESTAMP<s2.fechaFin THEN 0
          WHEN s2.estado='pendiente' AND s2.fechaInicio>CURRENT_TIMESTAMP THEN 1
          WHEN s2.estado='suspendida' THEN 2
          ELSE 3
        END,
        CASE WHEN s2.fechaInicio>CURRENT_TIMESTAMP THEN s2.fechaInicio END ASC,
        s2.idSuscripcion DESC
      LIMIT 1
    )
    LEFT JOIN plan p ON p.idPlan=s.idPlan
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

router.get('/planes', asyncRoute(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT idPlan, codigo, nombre, descripcion, activo, precioMensual, duracionDias,
       limitePropietarios, limiteProductos, limiteClientes, limiteProveedores
     FROM plan ORDER BY idPlan`
  );
  res.json(rows);
}));

router.post('/tiendas', asyncRoute(async (req, res) => {
  const tienda = validateStorePayload(req.body || {});
  const propietario = validateOwnerPayload(req.body?.propietario || {});
  const subscriptionInput = req.body?.suscripcion || {};
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
    const localDateTime = formatLocalDateTime();
    await ensureDefaultExpenseCategories(connection, storeResult.insertId);
    await ensureInventoryConfiguration(connection, storeResult.insertId, localDateTime);
    await ensureCreditConfiguration(connection, storeResult.insertId, localDateTime);
    const passwordHash = await bcrypt.hash(propietario.password, 12);
    const [ownerResult] = await connection.query(
      `INSERT INTO administrador (idTienda, usuario, password, rol, activo)
       VALUES (?, ?, ?, 'dueno_tienda', ?)`,
      [storeResult.insertId, propietario.usuario, passwordHash, propietario.activo]
    );
    const suscripcion = await createSubscription(connection, {
      ...subscriptionInput,
      idTienda: storeResult.insertId,
      creadoPor: req.auth.idAdministrador
    });
    if (propietario.activo) {
      await enforcePlanLimit(connection, storeResult.insertId, 'propietarios', 0);
    }
    await connection.commit();
    res.status(201).json({
      message: 'Tienda y propietario creados correctamente.',
      tienda: { idTienda: storeResult.insertId, ...tienda },
      propietario: { idAdministrador: ownerResult.insertId, usuario: propietario.usuario, activo: propietario.activo },
      suscripcion
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
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const current = await findStore(connection, idTienda, true);
    if (!current) throw httpError(404, 'La tienda no existe.');
    await connection.query(
      `UPDATE tienda SET nombre=?, slug=?, estado=?, activo=?, actualizadoEn=CURRENT_TIMESTAMP
       WHERE idTienda=?`,
      [tienda.nombre, tienda.slug, tienda.estado, tienda.activo, idTienda]
    );
    if (Number(current.activo) !== Number(tienda.activo) || current.estado !== tienda.estado) {
      await revokeStoreSessions(connection, idTienda);
    }
    await connection.commit();
    res.json({ message: 'Tienda actualizada correctamente.' });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}));

router.patch('/tiendas/:idTienda/activar', asyncRoute(async (req, res) => {
  const idTienda = parseId(req.params.idTienda, 'La tienda');
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    if (!await findStore(connection, idTienda, true)) throw httpError(404, 'La tienda no existe.');
    await connection.query(
      "UPDATE tienda SET activo=1, estado='activa', actualizadoEn=CURRENT_TIMESTAMP WHERE idTienda=?",
      [idTienda]
    );
    await revokeStoreSessions(connection, idTienda);
    await connection.commit();
    res.json({ message: 'Tienda activada correctamente.' });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}));

router.patch('/tiendas/:idTienda/desactivar', asyncRoute(async (req, res) => {
  const idTienda = parseId(req.params.idTienda, 'La tienda');
  const estado = cleanText(req.body?.estado) || 'inactiva';
  if (!['suspendida', 'inactiva'].includes(estado)) {
    throw httpError(400, 'Al desactivar, el estado debe ser suspendida o inactiva.');
  }
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    if (!await findStore(connection, idTienda, true)) throw httpError(404, 'La tienda no existe.');
    await connection.query(
      'UPDATE tienda SET activo=0, estado=?, actualizadoEn=CURRENT_TIMESTAMP WHERE idTienda=?',
      [estado, idTienda]
    );
    await revokeStoreSessions(connection, idTienda);
    await connection.commit();
    res.json({ message: 'Tienda desactivada correctamente.' });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
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
    if (propietario.activo) await enforcePlanLimit(connection, idTienda, 'propietarios');
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
    `UPDATE administrador SET usuario=?, versionSesion=versionSesion+1
     WHERE idAdministrador=? AND rol='dueno_tienda' AND idTienda IS NOT NULL`,
    [usuario, idAdministrador]
  );
  if (!result.affectedRows) throw httpError(404, 'El propietario no existe.');
  res.json({ message: 'Usuario del propietario actualizado correctamente.' });
}));

router.patch('/propietarios/:idAdministrador/activar', asyncRoute(async (req, res) => {
  const idAdministrador = parseId(req.params.idAdministrador, 'El propietario');
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [owners] = await connection.query(
      `SELECT idTienda, activo FROM administrador
       WHERE idAdministrador=? AND rol='dueno_tienda' AND idTienda IS NOT NULL FOR UPDATE`,
      [idAdministrador]
    );
    if (!owners.length) throw httpError(404, 'El propietario no existe.');
    if (!Number(owners[0].activo)) {
      await findStore(connection, owners[0].idTienda, true);
      await enforcePlanLimit(connection, owners[0].idTienda, 'propietarios');
      await connection.query(
        'UPDATE administrador SET activo=1, versionSesion=versionSesion+1 WHERE idAdministrador=?',
        [idAdministrador]
      );
    }
    await connection.commit();
    res.json({ message: 'Propietario activado correctamente.' });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}));

router.get('/tiendas/:idTienda/suscripciones', asyncRoute(async (req, res) => {
  const idTienda = parseId(req.params.idTienda, 'La tienda');
  if (!await findStore(pool, idTienda)) throw httpError(404, 'La tienda no existe.');
  const [rows] = await pool.query(
    `SELECT s.idSuscripcion, s.tipo, s.estado, s.fechaInicio, s.fechaFin,
       s.renovacionAutomatica, s.observacion, s.creadoEn, s.actualizadoEn,
       p.codigo AS planCodigo, p.nombre AS planNombre,
       a.usuario AS creadoPorUsuario,
       CASE
         WHEN s.estado IN ('activa','pendiente') AND CURRENT_TIMESTAMP>=s.fechaFin THEN 'vencida'
         WHEN s.estado IN ('activa','pendiente') AND CURRENT_TIMESTAMP<s.fechaInicio THEN 'pendiente'
         WHEN s.estado='pendiente' THEN 'activa'
         ELSE s.estado
       END AS estadoEfectivo
     FROM suscripcionTienda s
     JOIN plan p ON p.idPlan=s.idPlan
     LEFT JOIN administrador a ON a.idAdministrador=s.creadoPor
     WHERE s.idTienda=?
     ORDER BY s.idSuscripcion DESC`,
    [idTienda]
  );
  res.json(rows);
}));

router.post('/tiendas/:idTienda/suscripciones', asyncRoute(async (req, res) => {
  const idTienda = parseId(req.params.idTienda, 'La tienda');
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const suscripcion = await createSubscription(connection, {
      ...(req.body || {}),
      idTienda,
      creadoPor: req.auth.idAdministrador
    });
    await connection.commit();
    res.status(201).json({ message: 'Suscripcion registrada correctamente.', suscripcion });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}));

async function changeSubscriptionStatus(req, res, targetStatus) {
  const idSuscripcion = parseId(req.params.idSuscripcion, 'La suscripcion');
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query(
      `SELECT s.idSuscripcion, s.idTienda
       FROM suscripcionTienda s
       WHERE s.idSuscripcion=? FOR UPDATE`,
      [idSuscripcion]
    );
    if (!rows.length) throw httpError(404, 'La suscripcion no existe.');
    await findStore(connection, rows[0].idTienda, true);
    await connection.query(
      'UPDATE suscripcionTienda SET estado=?, actualizadoEn=CURRENT_TIMESTAMP WHERE idSuscripcion=?',
      [targetStatus, idSuscripcion]
    );
    await connection.commit();
    res.json({ message: `Suscripcion ${targetStatus === 'suspendida' ? 'suspendida' : 'cancelada'} correctamente.` });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

router.patch('/suscripciones/:idSuscripcion/suspender', asyncRoute(
  (req, res) => changeSubscriptionStatus(req, res, 'suspendida')
));

router.patch('/suscripciones/:idSuscripcion/cancelar', asyncRoute(
  (req, res) => changeSubscriptionStatus(req, res, 'cancelada')
));

router.patch('/propietarios/:idAdministrador/desactivar', asyncRoute(async (req, res) => {
  const idAdministrador = parseId(req.params.idAdministrador, 'El propietario');
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query(
      `SELECT idAdministrador FROM administrador
       WHERE idAdministrador=? AND rol='dueno_tienda' AND idTienda IS NOT NULL FOR UPDATE`,
      [idAdministrador]
    );
    if (!rows.length) throw httpError(404, 'El propietario no existe.');
    await connection.query(
      'UPDATE administrador SET activo=0, versionSesion=versionSesion+1 WHERE idAdministrador=?',
      [idAdministrador]
    );
    await connection.commit();
    res.json({ message: 'Propietario desactivado correctamente.' });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}));

router.patch('/propietarios/:idAdministrador/restablecer-password', asyncRoute(async (req, res) => {
  const idAdministrador = parseId(req.params.idAdministrador, 'El propietario');
  const password = validatePassword(req.body?.password, req.body?.confirmacionPassword);
  const passwordHash = await bcrypt.hash(password, 12);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query(
      `SELECT idAdministrador FROM administrador
       WHERE idAdministrador=? AND rol='dueno_tienda' AND idTienda IS NOT NULL FOR UPDATE`,
      [idAdministrador]
    );
    if (!rows.length) throw httpError(404, 'El propietario no existe.');
    await connection.query(
      `UPDATE administrador SET password=?, versionSesion=versionSesion+1
       WHERE idAdministrador=?`,
      [passwordHash, idAdministrador]
    );
    await connection.commit();
    res.json({ message: 'Contrasena restablecida correctamente.' });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
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
