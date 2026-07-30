const bcrypt = require('bcryptjs');
const pool = require('../config/db');
const { sessionSecret } = require('../config/env');
const { formatLocalDateTime } = require('../utils/local-datetime');
const { createSubscription } = require('./subscription-service');
const { bootstrapStore } = require('./store-bootstrap-service');
const { administrativeAuditService } = require('./administrative-audit-service');
const { emailVerificationService } = require('./email-verification-service');
const {
  INITIAL_ONBOARDING_STATUS,
  INITIAL_PLAN_CODE,
  INITIAL_SUBSCRIPTION_TYPE,
  INITIAL_TRIAL_DAYS,
  PENDING_ACCESS_STATUS,
  normalizeRegistration,
  registrationError,
  requestFingerprint,
  safeRegistrationResponse,
  sha256,
  validateIdempotencyKey
} = require('../config/public-registration-contract');

function sameHash(left, right) {
  return typeof left === 'string' && typeof right === 'string'
    && left.length === right.length
    && require('crypto').timingSafeEqual(Buffer.from(left), Buffer.from(right));
}

function publicConflict() {
  return registrationError(409, 'REGISTRATION_UNAVAILABLE', 'No se pudo completar el registro con los datos proporcionados.');
}

async function existingRequest(connection, keyHash) {
  const [rows] = await connection.query(
    `SELECT idSolicitudRegistro, huellaSolicitud, estado, idTienda, idAdministrador
     FROM solicitudRegistroPublico
     WHERE claveHash=? FOR UPDATE`,
    [keyHash]
  );
  return rows[0] || null;
}

async function existingRequestReadOnly(connection, keyHash) {
  const [rows] = await connection.query(
    `SELECT huellaSolicitud, estado
     FROM solicitudRegistroPublico
     WHERE claveHash=? LIMIT 1`,
    [keyHash]
  );
  return rows[0] || null;
}

function createPublicRegistrationService({
  database = pool,
  auditService = administrativeAuditService,
  bcryptLib = bcrypt,
  bootstrap = bootstrapStore,
  verificationService = emailVerificationService,
  clock = () => formatLocalDateTime(),
  fingerprintSecret = null
} = {}) {
  const secret = fingerprintSecret || sessionSecret();

  async function auditOutcome(action, result, resultCode, requestId) {
    await auditService.recordOutcome({
      actorType: 'anonimo',
      administratorId: null,
      storeId: null,
      action,
      result,
      resultCode,
      origin: 'web',
      requestId
    });
  }

  async function register({ body, idempotencyKey, requestId = null }) {
    let connection;
    let verificationIssue = null;
    try {
      const registration = normalizeRegistration(body);
      const key = validateIdempotencyKey(idempotencyKey);
      const keyHash = sha256(key);
      const fingerprint = requestFingerprint(registration, secret);
      connection = await database.getConnection();
      await connection.beginTransaction();

      const existing = await existingRequest(connection, keyHash);
      if (existing) {
        if (!sameHash(existing.huellaSolicitud, fingerprint)) {
          throw registrationError(409, 'OPERATION_KEY_CONFLICT');
        }
        if (existing.estado === 'completada') {
          await connection.rollback();
          return safeRegistrationResponse(true);
        }
        throw registrationError(409, 'OPERATION_IN_PROGRESS');
      }
      try {
        await connection.query(
          `INSERT INTO solicitudRegistroPublico
           (claveHash, huellaSolicitud, estado, creadoEn, actualizadoEn)
           VALUES (?, ?, 'en_proceso', ?, ?)`,
          [keyHash, fingerprint, clock(), clock()]
        );
      } catch (error) {
        if (error?.code !== 'ER_DUP_ENTRY') throw error;
        error.code = 'IDEMPOTENCY_RACE';
        throw error;
      }

      await auditService.recordCritical(connection, {
        actorType: 'anonimo', administratorId: null, storeId: null,
        action: 'registro_publico_solicitado', result: 'correcto',
        resultCode: 'PUBLIC_REGISTRATION_REQUESTED', origin: 'web', requestId
      });
      const now = clock();
      const [storeResult] = await connection.query(
        `INSERT INTO tienda
         (nombre, slug, activo, estado, estadoOnboarding, creadoEn, actualizadoEn)
         VALUES (?, ?, 1, 'activa', ?, ?, ?)`,
        [registration.nombreTienda, registration.slug, INITIAL_ONBOARDING_STATUS, now, now]
      );
      const idTienda = Number(storeResult.insertId);
      await bootstrap(connection, idTienda, now);
      const passwordHash = await bcryptLib.hash(registration.password, 12);
      const [ownerResult] = await connection.query(
        `INSERT INTO administrador
         (idTienda, usuario, correoNormalizado, correoVerificadoEn, password, rol, activo, estadoAcceso)
         VALUES (?, ?, ?, NULL, ?, 'dueno_tienda', 1, ?)`,
        [idTienda, registration.usuario, registration.correo, passwordHash, PENDING_ACCESS_STATUS]
      );
      const idAdministrador = Number(ownerResult.insertId);
      const subscription = await createSubscription(connection, {
        idTienda,
        planCodigo: INITIAL_PLAN_CODE,
        tipo: INITIAL_SUBSCRIPTION_TYPE,
        duracionDias: INITIAL_TRIAL_DAYS,
        creadoPor: null,
        actorTipo: 'anonimo'
      });
      verificationIssue = await verificationService.issueWithinTransaction(connection, {
        idAdministrador,
        requestId
      });
      await connection.query(
        `UPDATE solicitudRegistroPublico
         SET estado='completada', idTienda=?, idAdministrador=?, completadaEn=?, actualizadoEn=?
         WHERE claveHash=? AND estado='en_proceso'`,
        [idTienda, idAdministrador, now, now, keyHash]
      );
      await auditService.recordCritical(connection, {
        actorType: 'administrador', administratorId: idAdministrador, storeId: idTienda,
        action: 'registro_publico_completado', result: 'correcto',
        resultCode: 'PUBLIC_REGISTRATION_COMPLETED', origin: 'web',
        reference: `tienda:${idTienda}`, requestId,
        after: { activo: true, estado: PENDING_ACCESS_STATUS },
        metadata: { planCodigo: subscription.planCodigo, tipoSuscripcion: subscription.tipo }
      });
      await connection.commit();
      await verificationService.deliver(verificationIssue, requestId);
      return safeRegistrationResponse(false);
    } catch (error) {
      if (connection) await connection.rollback();
      if (error?.code === 'IDEMPOTENCY_RACE') {
        const retryConnection = await database.getConnection();
        try {
          const existing = await existingRequestReadOnly(retryConnection, sha256(validateIdempotencyKey(idempotencyKey)));
          if (existing && sameHash(existing.huellaSolicitud, requestFingerprint(normalizeRegistration(body), secret))
            && existing.estado === 'completada') {
            return safeRegistrationResponse(true);
          }
        } finally {
          retryConnection?.release?.();
        }
        throw registrationError(409, 'OPERATION_IN_PROGRESS');
      }
      const controlled = Number(error?.status || 500) < 500;
      const code = error?.code;
      const rejection = controlled || error?.code === 'ER_DUP_ENTRY';
      try {
        await auditOutcome(
          rejection ? 'registro_publico_rechazado' : 'registro_publico_fallido',
          rejection ? 'rechazado' : 'fallido',
          rejection ? 'PUBLIC_REGISTRATION_REJECTED' : 'PUBLIC_REGISTRATION_FAILED',
          requestId
        );
      } catch {
        // recordOutcome is already fail-open; preserve the functional result.
      }
      if (code === 'ER_DUP_ENTRY') throw publicConflict();
      if (controlled) throw error;
      const publicError = registrationError(500, 'REGISTRATION_FAILED');
      publicError.cause = error;
      throw publicError;
    } finally {
      connection?.release?.();
    }
  }

  return Object.freeze({ register });
}

const publicRegistrationService = createPublicRegistrationService();

module.exports = { createPublicRegistrationService, publicRegistrationService };
