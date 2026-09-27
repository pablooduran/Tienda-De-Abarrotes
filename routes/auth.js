const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { OAuth2Client } = require('google-auth-library');
const pool = require('../config/db');
const { googleOauthConfig } = require('../config/google-oauth');
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
const { ownerDestination, resolveSubscriptionAccess } = require('../services/subscription-access-service');
const { validPasswordLength } = require('../config/password-policy');
const { normalizedVerificationIdentity } = require('../config/email-verification-contract');
const { normalizeGoogleRegistration } = require('../config/public-registration-contract');
const { googleIdentityService } = require('../services/google-identity-service');

const router = express.Router();
const dummyPasswordHash = bcrypt.hash(crypto.randomBytes(32).toString('hex'), 12);
const googleConfig = googleOauthConfig();
const googleClient = googleConfig.enabled
  ? new OAuth2Client(googleConfig.clientId, googleConfig.clientSecret, googleConfig.redirectUri)
  : null;
const GOOGLE_FLOW_TTL_MS = 10 * 60 * 1000;

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

function saveSession(req) {
  return new Promise((resolve, reject) => req.session.save((error) => (error ? reject(error) : resolve())));
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function googleRedirect(res, code) {
  return res.redirect(`/login.html?google=${encodeURIComponent(code)}`);
}

async function establishGoogleSession(req, res, admin) {
  if (!admin || admin.rol !== 'dueno_tienda' || !Number(admin.activo)
    || admin.estadoAcceso !== 'activo' || !Number(admin.idTienda)
    || !Number(admin.tiendaActiva) || admin.estadoTienda !== 'activa') {
    const error = new Error('La cuenta no esta disponible para acceso con Google.');
    error.status = 403;
    error.code = 'GOOGLE_ACCOUNT_UNAVAILABLE';
    throw error;
  }
  const subscriptionContext = await resolveSubscriptionAccess(pool, Number(admin.idTienda));
  await regenerateSession(req);
  req.session.admin = {
    id: Number(admin.idAdministrador), usuario: admin.usuario, rol: admin.rol,
    idTienda: Number(admin.idTienda), versionSesion: Number(admin.versionSesion)
  };
  try {
    await administrativeAuditService.recordCritical(pool, {
      ...administratorActor(req.session.admin), action: 'inicio_sesion', result: 'correcto',
      resultCode: 'LOGIN_OK', origin: 'web',
      reference: `administrador:${admin.idAdministrador}`, requestId: req.requestId,
      metadata: { rol: admin.rol }
    });
    await saveSession(req);
  } catch (error) {
    await destroyRequestSession(req, res);
    throw error;
  }
  return ownerDestination(subscriptionContext, admin.estadoOnboarding);
}

function publicAdmin(admin) {
  if (!admin) return null;
  return { id: admin.id ?? admin.idAdministrador, usuario: admin.usuario, rol: admin.rol };
}

function validateNewPassword(password, confirmation) {
  if (!validPasswordLength(password)) {
    const error = new Error('La nueva contrasena no cumple los requisitos de longitud.');
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
    const identificador = String(req.body?.usuario || '').trim();
    const password = req.body?.password;
    if (!identificador || identificador.length > 160 || !password) {
      await auditLoginRejected(req, 'LOGIN_INPUT_INVALID');
      return res.status(400).json({ error: 'Usuario o correo y contrasena son obligatorios.' });
    }
    const correo = normalizedVerificationIdentity(identificador);

    const [rows] = await pool.query(
      `SELECT a.idAdministrador, a.usuario, a.password, a.rol, a.idTienda, a.activo, a.estadoAcceso, a.versionSesion,
        t.activo AS tiendaActiva, t.estado AS estadoTienda, t.estadoOnboarding
       FROM administrador a
       LEFT JOIN tienda t ON t.idTienda=a.idTienda
       WHERE a.usuario=? OR (a.correoNormalizado=? AND a.correoVerificadoEn IS NOT NULL)
       ORDER BY (a.usuario=?) DESC
       LIMIT 1`,
      [identificador, correo, identificador]
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

    const subscriptionContext = admin.rol === 'dueno_tienda'
      ? await resolveSubscriptionAccess(pool, Number(admin.idTienda))
      : null;

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
    const destination = admin.rol === 'superadmin'
      ? '/admin.html'
      : ownerDestination(subscriptionContext, admin.estadoOnboarding);
    res.json({ message: 'Sesion iniciada.', admin: publicAdmin(req.session.admin), destination });
  } catch (error) {
    next(error);
  }
});

router.get('/google/status', (req, res) => {
  res.json({ available: googleConfig.enabled });
});

router.post('/google/start', async (req, res, next) => {
  try {
    if (!googleConfig.enabled) {
      return res.status(503).json({ error: 'El acceso con Google no esta disponible.', code: 'GOOGLE_NOT_CONFIGURED' });
    }
    const mode = req.body?.mode === 'register' ? 'register' : 'login';
    const hasRegistration = mode === 'register' && req.body?.usuario !== undefined;
    const registration = hasRegistration
      ? normalizeGoogleRegistration({ usuario: req.body?.usuario })
      : null;
    const state = crypto.randomBytes(32).toString('base64url');
    const nonce = crypto.randomBytes(32).toString('base64url');
    const codeVerifier = crypto.randomBytes(48).toString('base64url');
    const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
    delete req.session.googleRegistration;
    req.session.googleOauth = { state, nonce, codeVerifier, mode, registration, createdAt: Date.now() };
    await saveSession(req);
    return res.json({ authorizationUrl: googleClient.generateAuthUrl({
      access_type: 'online', response_type: 'code', scope: ['openid', 'email'],
      state, nonce, code_challenge: codeChallenge, code_challenge_method: 'S256',
      prompt: 'select_account'
    }) });
  } catch (error) {
    if (Number(error?.status || 500) < 500) {
      return res.status(400).json({
        error: 'Completa tu usuario.',
        code: 'GOOGLE_REGISTRATION_INVALID'
      });
    }
    return next(error);
  }
});

router.get('/google/callback', async (req, res) => {
  const flow = req.session?.googleOauth;
  try {
    delete req.session.googleOauth;
    await saveSession(req);
    if (!googleConfig.enabled || !flow) return googleRedirect(res, 'expired');
    if (req.query?.error) return googleRedirect(res, 'cancelled');
    if (!req.query?.code || !safeEqual(req.query?.state, flow.state)
      || Date.now() - Number(flow.createdAt) > GOOGLE_FLOW_TTL_MS) {
      return googleRedirect(res, 'expired');
    }
    const { tokens } = await googleClient.getToken({
      code: String(req.query.code), codeVerifier: flow.codeVerifier,
      redirect_uri: googleConfig.redirectUri
    });
    if (!tokens.id_token) return googleRedirect(res, 'failed');
    const ticket = await googleClient.verifyIdToken({ idToken: tokens.id_token, audience: googleConfig.clientId });
    const payload = ticket.getPayload();
    if (!payload || !safeEqual(payload.nonce, flow.nonce) || payload.email_verified !== true
      || !payload.email || !payload.sub) return googleRedirect(res, 'failed');
    let result;
    try {
      result = await googleIdentityService.authenticate({
        subject: payload.sub, email: payload.email,
        mode: flow.registration ? 'register' : 'login',
        registration: flow.registration, requestId: req.requestId
      });
    } catch (error) {
      if (error?.code === 'GOOGLE_ACCOUNT_NOT_FOUND' && flow.mode === 'register' && !flow.registration) {
        req.session.googleRegistration = {
          subject: String(payload.sub), email: String(payload.email), createdAt: Date.now()
        };
        await saveSession(req);
        return googleRedirect(res, 'registration_required');
      }
      throw error;
    }
    const destination = await establishGoogleSession(req, res, result.admin);
    return res.redirect(destination);
  } catch (error) {
    try {
      await administrativeAuditService.recordOutcome({
        actorType: 'anonimo', administratorId: null, storeId: null,
        action: 'inicio_sesion', result: 'rechazado', resultCode: 'INVALID_CREDENTIALS',
        origin: 'web', requestId: req.requestId
      });
    } catch { /* La auditoria no reemplaza el resultado del acceso. */ }
    if (error?.code === 'GOOGLE_ACCOUNT_NOT_FOUND') return googleRedirect(res, 'account_not_found');
    if (['REGISTRATION_UNAVAILABLE', 'GOOGLE_SUPERADMIN_DISABLED', 'GOOGLE_ACCOUNT_UNAVAILABLE'].includes(error?.code)) {
      return googleRedirect(res, 'account_unavailable');
    }
    return googleRedirect(res, 'failed');
  }
});

router.post('/google/complete-registration', async (req, res, next) => {
  try {
    const pending = req.session?.googleRegistration;
    if (!pending || Date.now() - Number(pending.createdAt || 0) > GOOGLE_FLOW_TTL_MS) {
      delete req.session.googleRegistration;
      await saveSession(req);
      return res.status(400).json({
        error: 'Tu registro con Google venció. Vuelve a continuar con Google.',
        code: 'GOOGLE_REGISTRATION_EXPIRED'
      });
    }
    const registration = normalizeGoogleRegistration({ usuario: req.body?.usuario });
    const result = await googleIdentityService.authenticate({
      subject: pending.subject, email: pending.email, mode: 'register', registration, requestId: req.requestId
    });
    delete req.session.googleRegistration;
    await saveSession(req);
    const destination = await establishGoogleSession(req, res, result.admin);
    return res.status(201).json({ message: 'Tu cuenta fue creada con Google.', destination });
  } catch (error) {
    return next(error);
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
