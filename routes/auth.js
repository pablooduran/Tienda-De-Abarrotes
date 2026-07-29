const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const pool = require('../config/db');
const { requireAuth } = require('../middleware/auth');
const {
  clearSessionCookie,
  destroyRequestSession,
  validateSession
} = require('../services/session-validation-service');
const {
  administrativeAuditService,
  administratorActor
} = require('../services/administrative-audit-service');
const { publicRegistrationService } = require('../services/public-registration-service');
const { emailVerificationService } = require('../services/email-verification-service');
const { passwordRecoveryService } = require('../services/password-recovery-service');

const router = express.Router();
const dummyPasswordHash = bcrypt.hash(crypto.randomBytes(32).toString('hex'), 12);

function invalidCredentials(res) {
  return res.status(401).json({
    error: 'Credenciales incorrectas.',
    code: 'INVALID_CREDENTIALS'
  });
}

async function auditLoginRejected(req, resultCode = 'INVALID_CREDENTIALS') {
  await administrativeAuditService.recordOutcome({
    actorType: 'anonimo',
    administratorId: null,
    storeId: null,
    action: 'inicio_sesion',
    result: 'rechazado',
    resultCode,
    origin: 'web',
    requestId: req.requestId
  });
}

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
    const usuario = String(req.body?.usuario || '').trim().slice(0, 80);
    const password = req.body?.password;
    if (!usuario || !password) {
      await auditLoginRejected(req, 'LOGIN_INPUT_INVALID');
      return res.status(400).json({ error: 'Usuario y contrasena son obligatorios.' });
    }

    const [rows] = await pool.query(
      `SELECT a.idAdministrador, a.usuario, a.password, a.rol, a.idTienda, a.activo, a.estadoAcceso, a.versionSesion,
        t.activo AS tiendaActiva, t.estado AS estadoTienda
       FROM administrador a
       LEFT JOIN tienda t ON t.idTienda=a.idTienda
       WHERE a.usuario=?
       LIMIT 1`,
      [usuario]
    );
    if (rows.length === 0) {
      await bcrypt.compare(password, await dummyPasswordHash);
      await auditLoginRejected(req);
      return invalidCredentials(res);
    }

    const ok = await bcrypt.compare(password, rows[0].password);
    if (!ok || !Number(rows[0].activo) || rows[0].estadoAcceso !== 'activo') {
      await auditLoginRejected(req);
      return invalidCredentials(res);
    }

    const admin = rows[0];
    if (!['dueno_tienda', 'superadmin'].includes(admin.rol)) {
      await auditLoginRejected(req);
      return invalidCredentials(res);
    }
    if (admin.rol === 'superadmin' && admin.idTienda !== null) {
      await auditLoginRejected(req);
      return invalidCredentials(res);
    }
    if (admin.rol === 'dueno_tienda'
      && (!Number.isInteger(Number(admin.idTienda))
        || Number(admin.idTienda) <= 0
        || !admin.tiendaActiva
        || admin.estadoTienda !== 'activa')) {
      await auditLoginRejected(req);
      return invalidCredentials(res);
    }

    await regenerateSession(req);
    req.session.admin = {
      id: admin.idAdministrador,
      usuario: admin.usuario,
      rol: admin.rol,
      idTienda: admin.idTienda === null ? null : Number(admin.idTienda),
      versionSesion: Number(admin.versionSesion)
    };
    try {
      const actor = administratorActor(req.session.admin);
      await administrativeAuditService.recordCritical(pool, {
        ...actor,
        action: 'inicio_sesion',
        result: 'correcto',
        resultCode: 'LOGIN_OK',
        origin: 'web',
        reference: `administrador:${admin.idAdministrador}`,
        requestId: req.requestId,
        metadata: { rol: admin.rol }
      });
    } catch (error) {
      await destroyRequestSession(req, res);
      throw error;
    }
    res.json({ message: 'Sesion iniciada.', admin: publicAdmin(req.session.admin) });
  } catch (error) {
    next(error);
  }
});

router.post('/registro', async (req, res, next) => {
  try {
    const result = await publicRegistrationService.register({
      body: req.body,
      idempotencyKey: req.get('Idempotency-Key'),
      requestId: req.requestId
    });
    return res.status(201).json(result);
  } catch (error) {
    return next(error);
  }
});

router.post('/verificar-correo', async (req, res, next) => {
  try {
    const result = await emailVerificationService.confirm({
      token: req.body?.token,
      requestId: req.requestId
    });
    return res.json(result);
  } catch (error) {
    return next(error);
  }
});

router.post('/reenviar-verificacion', async (req, res, next) => {
  try {
    const result = await emailVerificationService.resend({
      email: req.body?.correo,
      requestId: req.requestId
    });
    return res.status(202).json(result);
  } catch (error) {
    return next(error);
  }
});

router.post('/solicitar-recuperacion', async (req, res, next) => {
  try {
    const result = await passwordRecoveryService.request({
      body: req.body,
      requestId: req.requestId
    });
    return res.status(202).json(result);
  } catch (error) {
    return next(error);
  }
});

router.post('/restablecer-password', async (req, res, next) => {
  try {
    const result = await passwordRecoveryService.reset({
      body: req.body,
      requestId: req.requestId
    });
    return res.json(result);
  } catch (error) {
    return next(error);
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
    const actor = administratorActor(req.auth);
    await administrativeAuditService.recordCritical(connection, {
      ...actor,
      action: 'cambio_password',
      result: 'correcto',
      resultCode: 'PASSWORD_CHANGED',
      origin: 'web',
      reference: `administrador:${req.auth.idAdministrador}`,
      requestId: req.requestId,
      metadata: { versionSesionIncrementada: true }
    });
    await administrativeAuditService.recordCritical(connection, {
      ...actor,
      action: 'revocacion_sesion',
      result: 'correcto',
      resultCode: 'SESSION_REVOKED',
      origin: 'web',
      reference: `administrador:${req.auth.idAdministrador}`,
      requestId: req.requestId,
      metadata: { sesionesRevocadas: 1 }
    });
    await connection.commit();
    await destroyRequestSession(req, res);
    return res.json({ message: 'Contrasena actualizada. Inicie sesion nuevamente.' });
  } catch (error) {
    await connection.rollback();
    const actor = administratorActor(req.auth);
    await administrativeAuditService.recordOutcome({
      ...actor,
      action: 'cambio_password',
      result: Number(error?.status || 500) >= 500 ? 'fallido' : 'rechazado',
      resultCode: 'PASSWORD_CHANGE_REJECTED',
      origin: 'web',
      reference: req.auth?.idAdministrador
        ? `administrador:${req.auth.idAdministrador}`
        : null,
      requestId: req.requestId
    });
    return next(error);
  } finally {
    connection.release();
  }
});

router.post('/logout', async (req, res, next) => {
  try {
    let validation = { valid: false };
    try {
      validation = await validateSession(req.session?.admin);
    } catch {
      validation = { valid: false };
    }
    const actor = validation.valid
      ? administratorActor(validation.context)
      : { actorType: 'anonimo', administratorId: null, storeId: null };
    await destroyRequestSession(req, res);
    await administrativeAuditService.recordOutcome({
      ...actor,
      action: 'cierre_sesion',
      result: 'correcto',
      resultCode: 'LOGOUT_OK',
      origin: 'web',
      reference: validation.valid
        ? `administrador:${validation.context.idAdministrador}`
        : null,
      requestId: req.requestId
    });
    return res.json({ message: 'Sesion cerrada.' });
  } catch (error) {
    clearSessionCookie(res);
    return next(error);
  }
});

module.exports = router;
