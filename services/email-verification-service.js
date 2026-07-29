const pool = require('../config/db');
const { administrativeAuditService } = require('./administrative-audit-service');
const { localVerificationMailAdapter } = require('./local-verification-mail-adapter');
const { formatLocalDateTime } = require('../utils/local-datetime');
const {
  EMAIL_VERIFICATION_TYPE,
  createVerificationToken,
  expirationFrom,
  normalizedVerificationIdentity,
  verificationError,
  verificationTokenHash,
  verificationTokenTtlHours,
  validateVerificationToken
} = require('../config/email-verification-contract');

const GENERIC_RESEND_RESPONSE = Object.freeze({
  message: 'Si la cuenta puede recibir verificaciones, se enviara un enlace.',
  estado: 'pendiente_verificacion'
});

function nowFrom(clock) {
  const value = clock();
  return typeof value === 'string' ? value : formatLocalDateTime(value);
}

function safeVerificationError() {
  return verificationError(400, 'EMAIL_VERIFICATION_INVALID', 'No se pudo verificar el correo.');
}

function verificationFailure() {
  return verificationError(500, 'EMAIL_VERIFICATION_FAILED', 'No se pudo verificar el correo.');
}

function createEmailVerificationService({
  database = pool,
  auditService = administrativeAuditService,
  mailAdapter = localVerificationMailAdapter,
  clock = () => new Date(),
  tokenFactory = createVerificationToken,
  tokenTtlHours = verificationTokenTtlHours()
} = {}) {
  async function issueWithinTransaction(connection, { idAdministrador, requestId = null }) {
    const now = nowFrom(clock);
    const [owners] = await connection.query(
      `SELECT a.idAdministrador, a.idTienda, a.correoNormalizado, a.estadoAcceso,
              a.activo, t.activo AS tiendaActiva, t.estado AS estadoTienda
       FROM administrador a
       JOIN tienda t ON t.idTienda=a.idTienda
       WHERE a.idAdministrador=? FOR UPDATE`,
      [idAdministrador]
    );
    const owner = owners[0];
    if (!owner || !Number(owner.activo) || owner.estadoAcceso !== 'pendiente_verificacion'
      || !owner.correoNormalizado || !Number(owner.tiendaActiva) || owner.estadoTienda !== 'activa') {
      throw verificationError(409, 'EMAIL_VERIFICATION_UNAVAILABLE', 'No se pudo preparar la verificacion.');
    }
    const token = validateVerificationToken(tokenFactory());
    const tokenHash = verificationTokenHash(token);
    const expiresAt = expirationFrom(now, tokenTtlHours);
    await connection.query(
      `UPDATE tokenAccesoAdministrador
       SET invalidadoEn=?
       WHERE idAdministrador=? AND tipo=? AND usadoEn IS NULL AND invalidadoEn IS NULL`,
      [now, owner.idAdministrador, EMAIL_VERIFICATION_TYPE]
    );
    await connection.query(
      `INSERT INTO tokenAccesoAdministrador
       (idAdministrador, tipo, tokenHash, expiraEn, usadoEn, invalidadoEn, creadoEn)
       VALUES (?, ?, ?, ?, NULL, NULL, ?)`,
      [owner.idAdministrador, EMAIL_VERIFICATION_TYPE, tokenHash, expiresAt, now]
    );
    await auditService.recordCritical(connection, {
      actorType: 'administrador', administratorId: Number(owner.idAdministrador), storeId: Number(owner.idTienda),
      action: 'verificacion_correo_emitida', result: 'correcto', resultCode: 'EMAIL_VERIFICATION_ISSUED',
      origin: 'web', reference: `administrador:${owner.idAdministrador}`, requestId
    });
    return Object.freeze({
      administratorId: Number(owner.idAdministrador),
      storeId: Number(owner.idTienda),
      recipient: owner.correoNormalizado,
      token,
      expiresAt
    });
  }

  async function recordDeliveryFailure(issue, requestId) {
    await auditService.recordOutcome({
      actorType: 'administrador', administratorId: issue.administratorId, storeId: issue.storeId,
      action: 'verificacion_correo_entrega_fallida', result: 'fallido', resultCode: 'EMAIL_VERIFICATION_DELIVERY_FAILED',
      origin: 'web', reference: `administrador:${issue.administratorId}`, requestId
    });
  }

  async function deliver(issue, requestId = null) {
    try {
      await mailAdapter.sendVerification({
        recipient: issue.recipient,
        token: issue.token,
        expiresAt: issue.expiresAt
      });
      return true;
    } catch {
      try { await recordDeliveryFailure(issue, requestId); } catch { /* Preserve the public flow. */ }
      return false;
    }
  }

  async function auditRejected(requestId) {
    await auditService.recordOutcome({
      actorType: 'anonimo', administratorId: null, storeId: null,
      action: 'verificacion_correo_rechazada', result: 'rechazado', resultCode: 'EMAIL_VERIFICATION_REJECTED',
      origin: 'web', requestId
    });
  }

  async function confirm({ token, requestId = null }) {
    let connection;
    try {
      const tokenHash = verificationTokenHash(token);
      const now = nowFrom(clock);
      connection = await database.getConnection();
      await connection.beginTransaction();
      const [tokens] = await connection.query(
        `SELECT idTokenAcceso, idAdministrador,
                (expiraEn<=?) AS expirado, usadoEn, invalidadoEn
         FROM tokenAccesoAdministrador
         WHERE tokenHash=? AND tipo=? FOR UPDATE`,
        [now, tokenHash, EMAIL_VERIFICATION_TYPE]
      );
      const accessToken = tokens[0];
      if (!accessToken || Number(accessToken.expirado) || accessToken.usadoEn || accessToken.invalidadoEn) {
        throw safeVerificationError();
      }
      const [owners] = await connection.query(
        `SELECT a.idAdministrador, a.idTienda, a.activo, a.estadoAcceso,
                t.activo AS tiendaActiva, t.estado AS estadoTienda
         FROM administrador a
         JOIN tienda t ON t.idTienda=a.idTienda
         WHERE a.idAdministrador=? FOR UPDATE`,
        [accessToken.idAdministrador]
      );
      const owner = owners[0];
      if (!owner || !Number(owner.activo) || owner.estadoAcceso !== 'pendiente_verificacion'
        || !Number(owner.tiendaActiva) || owner.estadoTienda !== 'activa') {
        throw safeVerificationError();
      }
      await connection.query(
        `UPDATE administrador
         SET correoVerificadoEn=?, estadoAcceso='activo'
         WHERE idAdministrador=? AND estadoAcceso='pendiente_verificacion'`,
        [now, owner.idAdministrador]
      );
      await connection.query(
        `UPDATE tienda SET activo=1, estado='activa'
         WHERE idTienda=? AND activo=1 AND estado='activa'`,
        [owner.idTienda]
      );
      await connection.query(
        `UPDATE tokenAccesoAdministrador
         SET usadoEn=? WHERE idTokenAcceso=? AND usadoEn IS NULL AND invalidadoEn IS NULL`,
        [now, accessToken.idTokenAcceso]
      );
      await connection.query(
        `UPDATE tokenAccesoAdministrador
         SET invalidadoEn=?
         WHERE idAdministrador=? AND tipo=? AND idTokenAcceso<>?
           AND usadoEn IS NULL AND invalidadoEn IS NULL`,
        [now, owner.idAdministrador, EMAIL_VERIFICATION_TYPE, accessToken.idTokenAcceso]
      );
      await auditService.recordCritical(connection, {
        actorType: 'administrador', administratorId: Number(owner.idAdministrador), storeId: Number(owner.idTienda),
        action: 'correo_verificado', result: 'correcto', resultCode: 'EMAIL_VERIFIED', origin: 'web',
        reference: `administrador:${owner.idAdministrador}`, requestId,
        after: { estado: 'activo' }
      });
      await connection.commit();
      return Object.freeze({ message: 'Correo verificado. Ya puedes iniciar sesion.' });
    } catch (error) {
      if (connection) await connection.rollback();
      try { await auditRejected(requestId); } catch { /* Preserve the safe response. */ }
      if (Number(error?.status) === 400) throw error;
      const safeError = Number(error?.status) ? safeVerificationError() : verificationFailure();
      safeError.cause = error;
      throw safeError;
    } finally {
      connection?.release?.();
    }
  }

  async function resend({ email, requestId = null }) {
    const normalizedEmail = normalizedVerificationIdentity(email);
    if (!normalizedEmail) {
      await auditService.recordOutcome({
        actorType: 'anonimo', administratorId: null, storeId: null,
        action: 'reenvio_verificacion_solicitado', result: 'correcto', resultCode: 'EMAIL_VERIFICATION_RESEND_REQUESTED',
        origin: 'web', requestId
      });
      return GENERIC_RESEND_RESPONSE;
    }
    let connection;
    let issue = null;
    try {
      connection = await database.getConnection();
      await connection.beginTransaction();
      const [owners] = await connection.query(
        `SELECT a.idAdministrador, a.estadoAcceso, a.correoVerificadoEn,
                t.activo AS tiendaActiva, t.estado AS estadoTienda
         FROM administrador a
         JOIN tienda t ON t.idTienda=a.idTienda
         WHERE a.correoNormalizado=? FOR UPDATE`,
        [normalizedEmail]
      );
      const owner = owners[0];
      await auditService.recordCritical(connection, {
        actorType: 'anonimo', administratorId: null, storeId: null,
        action: 'reenvio_verificacion_solicitado', result: 'correcto', resultCode: 'EMAIL_VERIFICATION_RESEND_REQUESTED',
        origin: 'web', requestId
      });
      if (owner && owner.estadoAcceso === 'pendiente_verificacion' && !owner.correoVerificadoEn
        && Number(owner.tiendaActiva) && owner.estadoTienda === 'activa') {
        issue = await issueWithinTransaction(connection, { idAdministrador: Number(owner.idAdministrador), requestId });
      }
      await connection.commit();
    } catch {
      if (connection) await connection.rollback();
      return GENERIC_RESEND_RESPONSE;
    } finally {
      connection?.release?.();
    }
    if (issue) await deliver(issue, requestId);
    return GENERIC_RESEND_RESPONSE;
  }

  return Object.freeze({ confirm, deliver, issueWithinTransaction, resend });
}

const emailVerificationService = createEmailVerificationService();

module.exports = {
  GENERIC_RESEND_RESPONSE,
  createEmailVerificationService,
  emailVerificationService
};
