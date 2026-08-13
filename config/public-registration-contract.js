const crypto = require('crypto');
const { validPasswordLength } = require('./password-policy');

const INITIAL_PLAN_CODE = 'basico';
const INITIAL_SUBSCRIPTION_TYPE = 'prueba';
const INITIAL_TRIAL_DAYS = 30;
const INITIAL_ONBOARDING_STATUS = 'pendiente';
const PENDING_ACCESS_STATUS = 'pendiente_verificacion';
const RESERVED_SLUGS = new Set(['admin', 'api', 'auth', 'health', 'login', 'registro', 'www']);
const ALLOWED_FIELDS = new Set(['nombreTienda', 'slug', 'usuario', 'correo', 'password']);
const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{16,128}$/;

function registrationError(status, code, message = 'No se pudo completar el registro.') {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function cleanText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeSlug(value) {
  return cleanText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

function normalizeEmail(value) {
  const correo = cleanText(value).toLowerCase();
  if (!correo || correo.length > 160 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) {
    throw registrationError(400, 'REGISTRATION_INPUT_INVALID');
  }
  return correo;
}

function normalizeUsername(value) {
  const usuario = cleanText(value);
  if (usuario.length < 3 || usuario.length > 50 || !/^[A-Za-z0-9._-]+$/.test(usuario)) {
    throw registrationError(400, 'REGISTRATION_INPUT_INVALID');
  }
  return usuario;
}

function validatePassword(value) {
  if (!validPasswordLength(value)) {
    throw registrationError(400, 'REGISTRATION_INPUT_INVALID');
  }
  return value;
}

function validateIdempotencyKey(value) {
  const key = cleanText(value);
  if (!IDEMPOTENCY_KEY.test(key)) throw registrationError(400, 'IDEMPOTENCY_KEY_INVALID');
  return key;
}

function normalizeRegistration(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw registrationError(400, 'REGISTRATION_INPUT_INVALID');
  }
  for (const key of Object.keys(body)) {
    if (!ALLOWED_FIELDS.has(key)) throw registrationError(400, 'REGISTRATION_INPUT_INVALID');
  }
  const nombreTienda = cleanText(body.nombreTienda);
  if (nombreTienda.length < 2 || nombreTienda.length > 120) {
    throw registrationError(400, 'REGISTRATION_INPUT_INVALID');
  }
  const slug = normalizeSlug(body.slug || nombreTienda);
  if (slug.length < 3 || RESERVED_SLUGS.has(slug)) {
    throw registrationError(400, 'REGISTRATION_INPUT_INVALID');
  }
  return Object.freeze({
    nombreTienda,
    slug,
    usuario: normalizeUsername(body.usuario),
    correo: normalizeEmail(body.correo),
    password: validatePassword(body.password)
  });
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function requestFingerprint(registration, secret) {
  const serialized = JSON.stringify({
    nombreTienda: registration.nombreTienda,
    slug: registration.slug,
    usuario: registration.usuario,
    correo: registration.correo,
    password: registration.password
  });
  return crypto.createHmac('sha256', secret).update(serialized, 'utf8').digest('hex');
}

function safeRegistrationResponse(repeated = false) {
  return Object.freeze({
    message: 'Registro recibido correctamente. Debes verificar tu correo antes de ingresar.',
    estado: 'pendiente_verificacion',
    repetida: repeated
  });
}

module.exports = {
  ALLOWED_FIELDS,
  INITIAL_ONBOARDING_STATUS,
  INITIAL_PLAN_CODE,
  INITIAL_SUBSCRIPTION_TYPE,
  INITIAL_TRIAL_DAYS,
  PENDING_ACCESS_STATUS,
  RESERVED_SLUGS,
  normalizeEmail,
  normalizeRegistration,
  normalizeSlug,
  normalizeUsername,
  registrationError,
  requestFingerprint,
  safeRegistrationResponse,
  sha256,
  validateIdempotencyKey,
  validatePassword
};
