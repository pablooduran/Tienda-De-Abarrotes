const {
  normalizeEmail,
  registrationError,
  sha256
} = require('./public-registration-contract');
const { validPasswordLength } = require('./password-policy');
const {
  createVerificationToken,
  expirationFrom,
  validateVerificationToken
} = require('./email-verification-contract');

const PASSWORD_RECOVERY_TYPE = 'recuperacion_password';
const PASSWORD_RECOVERY_TTL_MINUTES = 60;
const PASSWORD_RECOVERY_FIELDS = new Set(['correo']);
const PASSWORD_RESET_FIELDS = new Set(['token', 'nuevaPassword', 'confirmacionPassword']);

function recoveryError(status, code, message = 'No se pudo restablecer la contrasena.') {
  return registrationError(status, code, message);
}

function passwordRecoveryTtlMinutes(environment = process.env) {
  const value = String(environment.PASSWORD_RECOVERY_TOKEN_TTL_MINUTES || '').trim();
  if (!value) return PASSWORD_RECOVERY_TTL_MINUTES;
  const minutes = Number(value);
  if (!Number.isInteger(minutes) || minutes < 5 || minutes > 240) {
    throw new Error('PASSWORD_RECOVERY_TOKEN_TTL_MINUTES debe ser un entero entre 5 y 240.');
  }
  return minutes;
}

function normalizeRecoveryEmail(value) {
  try { return normalizeEmail(value); } catch { return null; }
}

function normalizeRecoveryRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)
    || Object.keys(body).some((key) => !PASSWORD_RECOVERY_FIELDS.has(key))) {
    throw recoveryError(400, 'PASSWORD_RECOVERY_INPUT_INVALID');
  }
  const correo = normalizeRecoveryEmail(body.correo);
  if (!correo) throw recoveryError(400, 'PASSWORD_RECOVERY_INPUT_INVALID');
  return Object.freeze({ correo });
}

function validatePasswordReset(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)
    || Object.keys(body).some((key) => !PASSWORD_RESET_FIELDS.has(key))) {
    throw recoveryError(400, 'PASSWORD_RESET_INPUT_INVALID');
  }
  const token = validateVerificationToken(body.token);
  if (!validPasswordLength(body.nuevaPassword)
    || body.nuevaPassword !== body.confirmacionPassword) {
    throw recoveryError(400, 'PASSWORD_RESET_INPUT_INVALID', 'La contrasena no cumple los requisitos.');
  }
  return Object.freeze({ token, nuevaPassword: body.nuevaPassword });
}

module.exports = {
  PASSWORD_RECOVERY_FIELDS,
  PASSWORD_RECOVERY_TTL_MINUTES,
  PASSWORD_RECOVERY_TYPE,
  PASSWORD_RESET_FIELDS,
  createVerificationToken,
  expirationFrom,
  normalizeRecoveryEmail,
  normalizeRecoveryRequest,
  passwordRecoveryTtlMinutes,
  recoveryError,
  sha256,
  validatePasswordReset,
  validateVerificationToken
};
