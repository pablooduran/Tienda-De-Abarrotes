const pool = require('../config/db');
const { administrativeAuditService } = require('./administrative-audit-service');
const { mailDeliveryAdapter } = require('./mail-delivery-adapter');
const { formatLocalDateTime } = require('../utils/local-datetime');
const {
  EMAIL_VERIFICATION_TYPE,
  codeExpirationFrom,
  createVerificationCode,
  normalizedVerificationIdentity,
  validateVerificationCode,
  verificationCodeHash,
  verificationCodeTtlMinutes
} = require('../config/email-verification-contract');

function accountError(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function positiveId(value, label) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw accountError(403, 'ACCOUNT_ACCESS_DENIED', `${label} no es válido.`);
  }
  return parsed;
}

function cleanPhone(value) {
  const phone = String(value || '').trim();
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (phone.length > 30 || digits.length < 7 || digits.length > 15 || !/^\+?[0-9 ()-]+$/.test(phone)) {
    throw accountError(400, 'ACCOUNT_PHONE_INVALID', 'Ingresa un número de teléfono válido.');
  }
  return phone;
}

function publicAccount(row) {
  return Object.freeze({
    usuario: row.usuario,
    rol: row.rol,
    correo: row.correoNormalizado || null,
    correoVerificado: Boolean(row.correoVerificadoEn),
    correoPendiente: row.correoPendiente || null,
    telefono: row.telefono || null
  });
}

function nowFrom(clock) {
  const value = clock();
  return typeof value === 'string' ? value : formatLocalDateTime(value);
}

function createAccountProfileService({
  database = pool,
  audit = administrativeAuditService,
  mail = mailDeliveryAdapter,
  clock = () => new Date(),
  codeFactory = createVerificationCode,
  codeTtlMinutes = verificationCodeTtlMinutes()
} = {}) {
  function contextFrom(input) {
    return Object.freeze({
      idAdministrador: positiveId(input?.idAdministrador, 'El usuario'),
      idTienda: positiveId(input?.idTienda, 'La tienda'),
      requestId: input?.requestId || null
    });
  }

  async function accountRow(connection, context, { lock = false } = {}) {
    const [rows] = await connection.query(
      `SELECT idAdministrador,idTienda,usuario,rol,activo,estadoAcceso,
              correoNormalizado,correoPendiente,correoVerificadoEn,telefono
       FROM administrador
       WHERE idAdministrador=? AND idTienda=?${lock ? ' FOR UPDATE' : ''}`,
      [context.idAdministrador, context.idTienda]
    );
    const account = rows[0];
    if (!account || !Number(account.activo) || account.estadoAcceso !== 'activo') {
      throw accountError(403, 'ACCOUNT_ACCESS_DENIED', 'La cuenta no está disponible.');
    }
    return account;
  }

  async function get(input) {
    const context = contextFrom(input);
    return { cuenta: publicAccount(await accountRow(database, context)) };
  }

  async function savePhone(input, body) {
    const context = contextFrom(input);
    const phone = cleanPhone(body?.telefono);
    const connection = await database.getConnection();
    try {
      await connection.beginTransaction();
      const before = await accountRow(connection, context, { lock: true });
      await connection.query(
        'UPDATE administrador SET telefono=? WHERE idAdministrador=? AND idTienda=?',
        [phone, context.idAdministrador, context.idTienda]
      );
      await audit.recordCritical(connection, {
        actorType: 'administrador', administratorId: context.idAdministrador, storeId: context.idTienda,
        action: 'datos_cuenta_actualizados', result: 'correcto', resultCode: 'ACCOUNT_CONTACT_UPDATED',
        origin: 'web', reference: `administrador:${context.idAdministrador}`, requestId: context.requestId,
        metadata: { telefonoModificado: before.telefono !== phone }
      });
      await connection.commit();
      return { message: 'Teléfono de la cuenta actualizado.', cuenta: publicAccount({ ...before, telefono: phone }) };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async function requestEmail(input, body) {
    const context = contextFrom(input);
    const email = normalizedVerificationIdentity(body?.correo);
    if (!email) throw accountError(400, 'ACCOUNT_EMAIL_INVALID', 'Ingresa un correo electrónico válido.');
    const connection = await database.getConnection();
    let issue;
    try {
      await connection.beginTransaction();
      const account = await accountRow(connection, context, { lock: true });
      const [duplicates] = await connection.query(
        'SELECT idAdministrador FROM administrador WHERE correoNormalizado=? AND idAdministrador<>? LIMIT 1 FOR UPDATE',
        [email, context.idAdministrador]
      );
      if (duplicates.length) throw accountError(409, 'ACCOUNT_EMAIL_IN_USE', 'Ese correo ya está asociado a otra cuenta.');
      if (account.correoNormalizado === email && account.correoVerificadoEn) {
        throw accountError(409, 'ACCOUNT_EMAIL_ALREADY_VERIFIED', 'Ese correo ya está verificado en tu cuenta.');
      }
      const now = nowFrom(clock);
      const code = validateVerificationCode(codeFactory());
      const expiresAt = codeExpirationFrom(now, codeTtlMinutes);
      await connection.query(
        `UPDATE tokenAccesoAdministrador SET invalidadoEn=?
         WHERE idAdministrador=? AND tipo=? AND usadoEn IS NULL AND invalidadoEn IS NULL`,
        [now, context.idAdministrador, EMAIL_VERIFICATION_TYPE]
      );
      await connection.query(
        'UPDATE administrador SET correoPendiente=? WHERE idAdministrador=? AND idTienda=?',
        [email, context.idAdministrador, context.idTienda]
      );
      await connection.query(
        `INSERT INTO tokenAccesoAdministrador
         (idAdministrador,tipo,tokenHash,expiraEn,usadoEn,invalidadoEn,creadoEn)
         VALUES (?,?,?, ?,NULL,NULL,?)`,
        [context.idAdministrador, EMAIL_VERIFICATION_TYPE, verificationCodeHash(code, email), expiresAt, now]
      );
      await audit.recordCritical(connection, {
        actorType: 'administrador', administratorId: context.idAdministrador, storeId: context.idTienda,
        action: 'cambio_correo_solicitado', result: 'correcto', resultCode: 'ACCOUNT_EMAIL_CHANGE_REQUESTED',
        origin: 'web', reference: `administrador:${context.idAdministrador}`, requestId: context.requestId
      });
      await connection.commit();
      issue = { recipient: email, token: code, expiresAt, account: { ...account, correoPendiente: email } };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
    try {
      await mail.sendVerification({ recipient: issue.recipient, token: issue.token, expiresAt: issue.expiresAt });
    } catch (error) {
      throw accountError(503, 'ACCOUNT_EMAIL_DELIVERY_FAILED', 'No pudimos enviar el código. Intenta nuevamente en unos minutos.');
    }
    return {
      message: `Enviamos un código de 6 números a ${email}.`,
      cuenta: publicAccount(issue.account)
    };
  }

  async function confirmEmail(input, body) {
    const context = contextFrom(input);
    const code = validateVerificationCode(body?.codigo);
    const connection = await database.getConnection();
    try {
      await connection.beginTransaction();
      const account = await accountRow(connection, context, { lock: true });
      if (!account.correoPendiente) {
        throw accountError(409, 'ACCOUNT_EMAIL_NOT_PENDING', 'No hay un correo pendiente de verificación.');
      }
      const now = nowFrom(clock);
      const hash = verificationCodeHash(code, account.correoPendiente);
      const [tokens] = await connection.query(
        `SELECT idTokenAcceso,(expiraEn<=?) expirado,usadoEn,invalidadoEn
         FROM tokenAccesoAdministrador
         WHERE idAdministrador=? AND tipo=? AND tokenHash=? FOR UPDATE`,
        [now, context.idAdministrador, EMAIL_VERIFICATION_TYPE, hash]
      );
      const token = tokens[0];
      if (!token || Number(token.expirado) || token.usadoEn || token.invalidadoEn) {
        throw accountError(400, 'ACCOUNT_EMAIL_CODE_INVALID', 'El código es incorrecto o ya venció.');
      }
      const [duplicates] = await connection.query(
        'SELECT idAdministrador FROM administrador WHERE correoNormalizado=? AND idAdministrador<>? LIMIT 1 FOR UPDATE',
        [account.correoPendiente, context.idAdministrador]
      );
      if (duplicates.length) throw accountError(409, 'ACCOUNT_EMAIL_IN_USE', 'Ese correo ya está asociado a otra cuenta.');
      await connection.query(
        `UPDATE administrador
         SET correoNormalizado=correoPendiente,correoVerificadoEn=?,correoPendiente=NULL
         WHERE idAdministrador=? AND idTienda=?`,
        [now, context.idAdministrador, context.idTienda]
      );
      await connection.query(
        'UPDATE tokenAccesoAdministrador SET usadoEn=? WHERE idTokenAcceso=?',
        [now, token.idTokenAcceso]
      );
      await connection.query(
        `UPDATE tokenAccesoAdministrador SET invalidadoEn=?
         WHERE idAdministrador=? AND tipo=? AND idTokenAcceso<>?
           AND usadoEn IS NULL AND invalidadoEn IS NULL`,
        [now, context.idAdministrador, EMAIL_VERIFICATION_TYPE, token.idTokenAcceso]
      );
      await audit.recordCritical(connection, {
        actorType: 'administrador', administratorId: context.idAdministrador, storeId: context.idTienda,
        action: 'correo_cuenta_verificado', result: 'correcto', resultCode: 'ACCOUNT_EMAIL_VERIFIED',
        origin: 'web', reference: `administrador:${context.idAdministrador}`, requestId: context.requestId
      });
      await connection.commit();
      return {
        message: 'Correo verificado y agregado a tu cuenta.',
        cuenta: publicAccount({ ...account, correoNormalizado: account.correoPendiente, correoVerificadoEn: now, correoPendiente: null })
      };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  return Object.freeze({ confirmEmail, get, requestEmail, savePhone });
}

const accountProfileService = createAccountProfileService();

module.exports = { accountProfileService, accountError, cleanPhone, createAccountProfileService, publicAccount };
