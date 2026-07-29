const crypto = require('crypto');
const { formatLocalDateTime, parseLocalDateTime } = require('../utils/local-datetime');
const { normalizeEmail, registrationError, sha256 } = require('./public-registration-contract');

const EMAIL_VERIFICATION_TYPE = 'verificacion_correo';
const EMAIL_VERIFICATION_TTL_HOURS = 24;
const VERIFICATION_TOKEN = /^[A-Za-z0-9_-]{43}$/;

function verificationError(status, code, message = 'No se pudo verificar el correo.') {
  return registrationError(status, code, message);
}

function verificationTokenTtlHours(environment = process.env) {
  const value = String(environment.EMAIL_VERIFICATION_TOKEN_TTL_HOURS || '').trim();
  if (!value) return EMAIL_VERIFICATION_TTL_HOURS;
  const hours = Number(value);
  if (!Number.isInteger(hours) || hours < 1 || hours > 72) {
    throw new Error('EMAIL_VERIFICATION_TOKEN_TTL_HOURS debe ser un entero entre 1 y 72.');
  }
  return hours;
}

function createVerificationToken(randomBytes = crypto.randomBytes) {
  return randomBytes(32).toString('base64url');
}

function validateVerificationToken(value) {
  const token = typeof value === 'string' ? value.trim() : '';
  if (!VERIFICATION_TOKEN.test(token)) {
    throw verificationError(400, 'EMAIL_VERIFICATION_INVALID', 'No se pudo verificar el correo.');
  }
  return token;
}

function verificationTokenHash(token) {
  return sha256(validateVerificationToken(token));
}

function expirationFrom(now, hours = verificationTokenTtlHours()) {
  const base = now instanceof Date ? now : parseLocalDateTime(now);
  return formatLocalDateTime(new Date(base.getTime() + (hours * 60 * 60 * 1000)));
}

function normalizedVerificationIdentity(value) {
  try {
    return normalizeEmail(value);
  } catch {
    return null;
  }
}

module.exports = {
  EMAIL_VERIFICATION_TTL_HOURS,
  EMAIL_VERIFICATION_TYPE,
  VERIFICATION_TOKEN,
  createVerificationToken,
  expirationFrom,
  normalizedVerificationIdentity,
  verificationError,
  verificationTokenHash,
  verificationTokenTtlHours,
  validateVerificationToken
};
