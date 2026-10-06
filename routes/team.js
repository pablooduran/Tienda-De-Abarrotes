const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../config/db');
const { ROLE_DETAILS } = require('../config/team-roles');
const { validPasswordLength } = require('../config/password-policy');
const { administrativeAuditService, administratorActor } = require('../services/administrative-audit-service');

const router = express.Router();
const ASSIGNABLE_ROLES = new Set(['encargado', 'cajero', 'inventario']);

function asyncRoute(handler) { return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next); }
function cleanUser(value) { return String(value || '').trim(); }
function validUser(value) { return /^[A-Za-z0-9._-]{3,50}$/.test(value); }
function memberRole(value) { return ASSIGNABLE_ROLES.has(value) ? value : null; }

router.get('/', asyncRoute(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT idAdministrador, usuario, rol, activo, estadoAcceso
     FROM administrador WHERE idTienda=? AND rol<>'dueno_tienda'
     ORDER BY activo DESC, usuario ASC`,
    [req.tenant.idTienda]
  );
  res.json({ roles: ROLE_DETAILS, miembros: rows.map((row) => ({ ...row, activo: Boolean(row.activo) })) });
}));

router.post('/', asyncRoute(async (req, res) => {
  const usuario = cleanUser(req.body?.usuario);
  const password = String(req.body?.password || '');
  const rol = memberRole(req.body?.rol);
  if (!validUser(usuario)) return res.status(400).json({ error: 'El usuario debe tener entre 3 y 50 caracteres: letras, números, punto, guion o guion bajo.' });
  if (!rol) return res.status(400).json({ error: 'Selecciona un rol de equipo valido.' });
  if (!validPasswordLength(password)) return res.status(400).json({ error: 'La contrasena no cumple los requisitos de longitud.' });
  const passwordHash = await bcrypt.hash(password, 12);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [result] = await connection.query(
      `INSERT INTO administrador (idTienda,usuario,password,rol,activo,estadoAcceso)
       VALUES (?, ?, ?, ?, 1, 'activo')`,
      [req.tenant.idTienda, usuario, passwordHash, rol]
    );
    const idAdministrador = Number(result.insertId);
    await administrativeAuditService.recordCritical(connection, {
      ...administratorActor(req.auth), storeId: req.tenant.idTienda,
      action: 'creacion_colaborador', result: 'correcto', resultCode: 'TEAM_MEMBER_CREATED', origin: 'web',
      reference: `administrador:${idAdministrador}`, requestId: req.requestId,
      after: { activo: true, rol }
    });
    await connection.commit();
    res.status(201).json({ message: 'Miembro agregado al equipo.', miembro: { idAdministrador, usuario, rol, activo: true } });
  } catch (error) {
    await connection.rollback();
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Ese usuario ya está en uso.' });
    throw error;
  } finally { connection.release(); }
}));

router.patch('/:idAdministrador', asyncRoute(async (req, res) => {
  const idAdministrador = Number(req.params.idAdministrador);
  const rol = memberRole(req.body?.rol);
  const activo = req.body?.activo;
  if (!Number.isInteger(idAdministrador) || idAdministrador <= 0) return res.status(400).json({ error: 'Miembro no valido.' });
  if (!rol && typeof activo !== 'boolean') return res.status(400).json({ error: 'Indica un rol o el estado del miembro.' });
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query(
      `SELECT idAdministrador,rol,activo FROM administrador
       WHERE idAdministrador=? AND idTienda=? AND rol<>'dueno_tienda' FOR UPDATE`,
      [idAdministrador, req.tenant.idTienda]
    );
    if (!rows.length) {
      const error = new Error('Miembro no encontrado.');
      error.status = 404;
      throw error;
    }
    const before = rows[0];
    const nextRole = rol || before.rol;
    const nextActive = typeof activo === 'boolean' ? activo : Boolean(before.activo);
    await connection.query('UPDATE administrador SET rol=?, activo=?, versionSesion=versionSesion+1 WHERE idAdministrador=?', [nextRole, nextActive ? 1 : 0, idAdministrador]);
    await administrativeAuditService.recordCritical(connection, {
      ...administratorActor(req.auth), storeId: req.tenant.idTienda,
      action: 'modificacion_colaborador', result: 'correcto', resultCode: 'TEAM_MEMBER_UPDATED', origin: 'web',
      reference: `administrador:${idAdministrador}`, requestId: req.requestId,
      before: { activo: Boolean(before.activo), rol: before.rol }, after: { activo: nextActive, rol: nextRole }
    });
    await connection.commit();
    res.json({ message: nextActive ? 'Permisos actualizados. La sesión anterior se cerró.' : 'Miembro desactivado y sesión revocada.' });
  } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
}));

module.exports = router;
