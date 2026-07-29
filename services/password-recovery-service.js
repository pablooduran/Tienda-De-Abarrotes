const bcrypt = require('bcryptjs');
const pool = require('../config/db');
const { administrativeAuditService } = require('./administrative-audit-service');
const { localVerificationMailAdapter } = require('./local-verification-mail-adapter');
const { formatLocalDateTime } = require('../utils/local-datetime');
const {
  PASSWORD_RECOVERY_TYPE,
  expirationFrom,
  normalizeRecoveryRequest,
  passwordRecoveryTtlMinutes,
  recoveryError,
  sha256,
  validatePasswordReset,
  validateVerificationToken,
  createVerificationToken
} = require('../config/password-recovery-contract');

const GENERIC_RECOVERY_RESPONSE = Object.freeze({
  message: 'Si existe una cuenta asociada, recibiras instrucciones para continuar.'
});

function nowFrom(clock) {
  const value = clock();
  return typeof value === 'string' ? value : formatLocalDateTime(value);
}

function invalidRecoveryError() {
  return recoveryError(400, 'PASSWORD_RECOVERY_INVALID', 'No se pudo completar la recuperacion.');
}

function createPasswordRecoveryService({
  database = pool,
  auditService = administrativeAuditService,
  mailAdapter = localVerificationMailAdapter,
  bcryptLib = bcrypt,
  clock = () => new Date(),
  tokenFactory = createVerificationToken,
  tokenTtlMinutes = passwordRecoveryTtlMinutes()
} = {}) {
  async function issueWithinTransaction(connection, { idAdministrador, requestId = null }) {
    const now = nowFrom(clock);
    const [owners] = await connection.query(
      `SELECT idAdministrador, correoNormalizado
       FROM administrador
       WHERE idAdministrador=? FOR UPDATE`,
      [idAdministrador]
    );
    const owner = owners[0];
    if (!owner || !owner.correoNormalizado) throw invalidRecoveryError();

    const token = validateVerificationToken(tokenFactory());
    const tokenHash = sha256(token);
    const expiresAt = expirationFrom(now, tokenTtlMinutes / 60);
    await connection.query(
      `UPDATE tokenAccesoAdministrador
       SET invalidadoEn=?
       WHERE idAdministrador=? AND tipo=? AND usadoEn IS NULL AND invalidadoEn IS NULL`,
      [now, owner.idAdministrador, PASSWORD_RECOVERY_TYPE]
    );
    await connection.query(
      `INSERT INTO tokenAccesoAdministrador
       (idAdministrador, tipo, tokenHash, expiraEn, usadoEn, invalidadoEn, creadoEn)
       VALUES (?, ?, ?, ?, NULL, NULL, ?)`,
      [owner.idAdministrador, PASSWORD_RECOVERY_TYPE, tokenHash, expiresAt, now]
    );
    await auditService.recordCritical(connection, {
      actorType: 'anonimo', administratorId: null, storeId: null,
      action: 'token_recuperacion_emitido', result: 'correcto',
      resultCode: 'PASSWORD_RECOVERY_TOKEN_ISSUED', origin: 'web', requestId
    });
    return Object.freeze({
      administratorId: Number(owner.idAdministrador),
      recipient: owner.correoNormalizado,
      token,
      expiresAt
    });
  }

  async function recordDeliveryFailure(requestId) {
    await auditService.recordOutcome({
      actorType: 'anonimo', administratorId: null, storeId: null,
      action: 'recuperacion_entrega_fallida', result: 'fallido',
      resultCode: 'PASSWORD_RECOVERY_DELIVERY_FAILED', origin: 'web', requestId
    });
  }

  async function deliver(issue, requestId = null) {
    try {
      await mailAdapter.sendPasswordRecovery({
        recipient: issue.recipient,
        token: issue.token,
        expiresAt: issue.expiresAt
      });
      return true;
    } catch {
      try { await recordDeliveryFailure(requestId); } catch { /* Keep the response neutral. */ }
      return false;
    }
  }

  async function recordRequested(connection, requestId) {
    await auditService.recordCritical(connection, {
      actorType: 'anonimo', administratorId: null, storeId: null,
      action: 'recuperacion_password_solicitada', result: 'correcto',
      resultCode: 'PASSWORD_RECOVERY_REQUESTED', origin: 'web', requestId
    });
  }

  async function request({ body, requestId = null }) {
    const { correo } = normalizeRecoveryRequest(body);
    let connection;
    let issue = null;
    try {
      connection = await database.getConnection();
      await connection.beginTransaction();
      const [owners] = await connection.query(
        `SELECT idAdministrador
         FROM administrador
         WHERE correoNormalizado=? FOR UPDATE`,
        [correo]
      );
      if (owners.length) {
        await recordRequested(connection, requestId);
        issue = await issueWithinTransaction(connection, {
          idAdministrador: Number(owners[0].idAdministrador), requestId
        });
      }
      await connection.commit();
    } catch {
      if (connection) await connection.rollback();
      return GENERIC_RECOVERY_RESPONSE;
    } finally {
      connection?.release?.();
    }
    if (issue) await deliver(issue, requestId);
    return GENERIC_RECOVERY_RESPONSE;
  }

  async function recordRejected(requestId) {
    await auditService.recordOutcome({
      actorType: 'anonimo', administratorId: null, storeId: null,
      action: 'token_recuperacion_rechazado', result: 'rechazado',
      resultCode: 'PASSWORD_RECOVERY_TOKEN_REJECTED', origin: 'web', requestId
    });
  }

  async function reset({ body, requestId = null }) {
    const resetInput = validatePasswordReset(body);
    const tokenHash = sha256(resetInput.token);
    const now = nowFrom(clock);
    let connection;
    try {
      const passwordHash = await bcryptLib.hash(resetInput.nuevaPassword, 12);
      connection = await database.getConnection();
      await connection.beginTransaction();
      const [tokens] = await connection.query(
        `SELECT idTokenAcceso, idAdministrador, (expiraEn<=?) AS expirado, usadoEn, invalidadoEn
         FROM tokenAccesoAdministrador
         WHERE tokenHash=? AND tipo=? FOR UPDATE`,
        [now, tokenHash, PASSWORD_RECOVERY_TYPE]
      );
      const accessToken = tokens[0];
      if (!accessToken || Number(accessToken.expirado) || accessToken.usadoEn || accessToken.invalidadoEn) {
        throw invalidRecoveryError();
      }
      const [owners] = await connection.query(
        `SELECT idAdministrador, versionSesion
         FROM administrador
         WHERE idAdministrador=? FOR UPDATE`,
        [accessToken.idAdministrador]
      );
      if (!owners.length) throw invalidRecoveryError();
      await connection.query(
        `UPDATE administrador
         SET password=?, versionSesion=versionSesion+1
         WHERE idAdministrador=?`,
        [passwordHash, accessToken.idAdministrador]
      );
      await connection.query(
        `UPDATE tokenAccesoAdministrador
         SET usadoEn=?
         WHERE idTokenAcceso=? AND usadoEn IS NULL AND invalidadoEn IS NULL`,
        [now, accessToken.idTokenAcceso]
      );
      await connection.query(
        `UPDATE tokenAccesoAdministrador
         SET invalidadoEn=?
         WHERE idAdministrador=? AND tipo=? AND idTokenAcceso<>?
           AND usadoEn IS NULL AND invalidadoEn IS NULL`,
        [now, accessToken.idAdministrador, PASSWORD_RECOVERY_TYPE, accessToken.idTokenAcceso]
      );
      await auditService.recordCritical(connection, {
        actorType: 'anonimo', administratorId: null, storeId: null,
        action: 'recuperacion_password_completada', result: 'correcto',
        resultCode: 'PASSWORD_RESET_COMPLETED', origin: 'web', requestId,
        metadata: { versionSesionIncrementada: true }
      });
      await auditService.recordCritical(connection, {
        actorType: 'anonimo', administratorId: null, storeId: null,
        action: 'revocacion_sesion', result: 'correcto', resultCode: 'SESSION_REVOKED',
        origin: 'web', requestId, metadata: { sesionesRevocadas: 1 }
      });
      await connection.commit();
      return Object.freeze({ message: 'Contrasena actualizada. Inicia sesion nuevamente.' });
    } catch (error) {
      if (connection) await connection.rollback();
      try { await recordRejected(requestId); } catch { /* Preserve the functional error. */ }
      if (Number(error?.status) === 400) throw error;
      const safeError = Number(error?.status) ? invalidRecoveryError() : recoveryError(500, 'PASSWORD_RECOVERY_FAILED');
      safeError.cause = error;
      throw safeError;
    } finally {
      connection?.release?.();
    }
  }

  return Object.freeze({ deliver, issueWithinTransaction, request, reset });
}

const passwordRecoveryService = createPasswordRecoveryService();

module.exports = {
  GENERIC_RECOVERY_RESPONSE,
  createPasswordRecoveryService,
  passwordRecoveryService
};
