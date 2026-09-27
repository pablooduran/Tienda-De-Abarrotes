const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const pool = require('../config/db');
const { formatLocalDateTime } = require('../utils/local-datetime');
const { bootstrapStore } = require('./store-bootstrap-service');
const { createSubscription } = require('./subscription-service');
const { administrativeAuditService } = require('./administrative-audit-service');
const { businessAnalytics } = require('./product-analytics');
const {
  INITIAL_ONBOARDING_STATUS,
  INITIAL_PLAN_CODE,
  INITIAL_SUBSCRIPTION_TYPE,
  INITIAL_TRIAL_DAYS,
  normalizeEmail,
  normalizeGoogleRegistration,
  registrationError
} = require('../config/public-registration-contract');

function oauthError(status, code, message = 'No se pudo completar el acceso con Google.') {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function normalizeSubject(value) {
  const subject = String(value || '').trim();
  if (!/^[A-Za-z0-9_-]{6,255}$/.test(subject)) throw oauthError(401, 'GOOGLE_IDENTITY_INVALID');
  return subject;
}

function adminSelect(where) {
  return `SELECT a.idAdministrador, a.usuario, a.rol, a.idTienda, a.activo,
      a.estadoAcceso, a.versionSesion, a.correoNormalizado,
      t.activo AS tiendaActiva, t.estado AS estadoTienda, t.estadoOnboarding
    FROM administrador a
    LEFT JOIN tienda t ON t.idTienda=a.idTienda
    ${where}`;
}

function assertOwnerAvailable(admin) {
  if (!admin || admin.rol !== 'dueno_tienda' || !Number(admin.activo)
    || !Number(admin.idTienda) || !Number(admin.tiendaActiva)
    || admin.estadoTienda !== 'activa'
    || !['activo', 'pendiente_verificacion'].includes(admin.estadoAcceso)) {
    throw oauthError(403, 'GOOGLE_ACCOUNT_UNAVAILABLE');
  }
}

function createGoogleIdentityService({
  database = pool,
  bcryptLib = bcrypt,
  bootstrap = bootstrapStore,
  subscriptionCreator = createSubscription,
  auditService = administrativeAuditService,
  analytics = businessAnalytics,
  clock = () => formatLocalDateTime()
} = {}) {
  async function authenticate({ subject, email, mode = 'login', registration = null, requestId = null }) {
    const stableSubject = normalizeSubject(subject);
    const normalizedEmail = normalizeEmail(email);
    if (!['login', 'register'].includes(mode)) throw oauthError(400, 'GOOGLE_FLOW_INVALID');
    const normalizedRegistration = mode === 'register' ? normalizeGoogleRegistration(registration) : null;
    const connection = await database.getConnection();
    let created = false;
    try {
      await connection.beginTransaction();
      const [linkedRows] = await connection.query(
        `${adminSelect(`JOIN identidadOauthAdministrador i ON i.idAdministrador=a.idAdministrador
          WHERE i.proveedor='google' AND i.subjectProveedor=?`)} FOR UPDATE`,
        [stableSubject]
      );
      let admin = linkedRows[0] || null;
      if (admin) assertOwnerAvailable(admin);

      if (!admin) {
        const [emailRows] = await connection.query(
          `${adminSelect('WHERE a.correoNormalizado=?')} FOR UPDATE`,
          [normalizedEmail]
        );
        admin = emailRows[0] || null;
        if (admin?.rol === 'superadmin') throw oauthError(403, 'GOOGLE_SUPERADMIN_DISABLED');
        if (admin) {
          assertOwnerAvailable(admin);
          await connection.query(
            `INSERT INTO identidadOauthAdministrador
             (idAdministrador, proveedor, subjectProveedor, correoNormalizado, creadoEn, ultimoAccesoEn, actualizadoEn)
             VALUES (?, 'google', ?, ?, ?, ?, ?)`,
            [admin.idAdministrador, stableSubject, normalizedEmail, clock(), clock(), clock()]
          );
          await connection.query(
            `UPDATE administrador
             SET correoVerificadoEn=COALESCE(correoVerificadoEn, ?),
                 estadoAcceso=IF(estadoAcceso='pendiente_verificacion', 'activo', estadoAcceso)
             WHERE idAdministrador=?`,
            [clock(), admin.idAdministrador]
          );
          if (admin.estadoAcceso === 'pendiente_verificacion') {
            admin.estadoAcceso = 'activo';
          }
        }
      }

      if (!admin) {
        if (mode !== 'register') throw oauthError(404, 'GOOGLE_ACCOUNT_NOT_FOUND');
        const now = clock();
        await auditService.recordCritical(connection, {
          actorType: 'anonimo', administratorId: null, storeId: null,
          action: 'registro_publico_solicitado', result: 'correcto',
          resultCode: 'PUBLIC_REGISTRATION_REQUESTED', origin: 'web', requestId
        });
        const [storeResult] = await connection.query(
          `INSERT INTO tienda
           (nombre, slug, activo, estado, estadoOnboarding, creadoEn, actualizadoEn)
           VALUES (?, ?, 1, 'activa', ?, ?, ?)`,
          [normalizedRegistration.nombreTienda, normalizedRegistration.slug, INITIAL_ONBOARDING_STATUS, now, now]
        );
        const idTienda = Number(storeResult.insertId);
        await bootstrap(connection, idTienda, now);
        const passwordHash = await bcryptLib.hash(crypto.randomBytes(48).toString('base64url'), 12);
        const [ownerResult] = await connection.query(
          `INSERT INTO administrador
           (idTienda, usuario, correoNormalizado, correoVerificadoEn, password, rol, activo, estadoAcceso)
           VALUES (?, ?, ?, ?, ?, 'dueno_tienda', 1, 'activo')`,
          [idTienda, normalizedRegistration.usuario, normalizedEmail, now, passwordHash]
        );
        const idAdministrador = Number(ownerResult.insertId);
        await connection.query(
          `INSERT INTO identidadOauthAdministrador
           (idAdministrador, proveedor, subjectProveedor, correoNormalizado, creadoEn, ultimoAccesoEn, actualizadoEn)
           VALUES (?, 'google', ?, ?, ?, ?, ?)`,
          [idAdministrador, stableSubject, normalizedEmail, now, now, now]
        );
        const subscription = await subscriptionCreator(connection, {
          idTienda,
          planCodigo: INITIAL_PLAN_CODE,
          tipo: INITIAL_SUBSCRIPTION_TYPE,
          duracionDias: INITIAL_TRIAL_DAYS,
          creadoPor: null,
          actorTipo: 'anonimo'
        });
        await auditService.recordCritical(connection, {
          actorType: 'administrador', administratorId: idAdministrador, storeId: idTienda,
          action: 'registro_publico_completado', result: 'correcto',
          resultCode: 'PUBLIC_REGISTRATION_COMPLETED', origin: 'web',
          reference: `tienda:${idTienda}`, requestId,
          after: { activo: true, estado: 'activo' },
          metadata: { planCodigo: subscription.planCodigo, tipoSuscripcion: subscription.tipo }
        });
        admin = {
          idAdministrador, usuario: normalizedRegistration.usuario, rol: 'dueno_tienda',
          idTienda, activo: 1, estadoAcceso: 'activo', versionSesion: 1,
          correoNormalizado: normalizedEmail, tiendaActiva: 1, estadoTienda: 'activa',
          estadoOnboarding: INITIAL_ONBOARDING_STATUS
        };
        created = true;
      } else {
        await connection.query(
          `UPDATE identidadOauthAdministrador
           SET correoNormalizado=?, ultimoAccesoEn=?, actualizadoEn=?
           WHERE proveedor='google' AND subjectProveedor=?`,
          [normalizedEmail, clock(), clock(), stableSubject]
        );
      }

      await connection.commit();
      if (created) analytics.accountRegistered({ created: true, replayed: false, plan: INITIAL_PLAN_CODE });
      return Object.freeze({ admin, created });
    } catch (error) {
      await connection.rollback();
      if (error?.code === 'ER_DUP_ENTRY') {
        throw registrationError(409, 'REGISTRATION_UNAVAILABLE', 'No se pudo completar el registro con los datos proporcionados.');
      }
      throw error;
    } finally {
      connection.release();
    }
  }

  return Object.freeze({ authenticate });
}

const googleIdentityService = createGoogleIdentityService();

module.exports = { createGoogleIdentityService, googleIdentityService, oauthError };
