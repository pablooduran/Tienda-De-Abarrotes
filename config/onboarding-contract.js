const ONBOARDING_STATES = Object.freeze(['pendiente', 'en_progreso', 'completado']);
const REQUIRED_FIELDS = Object.freeze(['nombreMostrado', 'moneda', 'zonaHoraria']);
const OPTIONAL_FIELDS = Object.freeze(['telefono', 'direccion', 'datoFiscalBasico']);
const ALLOWED_FIELDS = Object.freeze([...REQUIRED_FIELDS, ...OPTIONAL_FIELDS]);
const ALLOWED_CURRENCIES = Object.freeze(['BOB']);
const ALLOWED_TIME_ZONES = Object.freeze(['America/La_Paz']);

function onboardingError(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function cleanText(value, maximum, field, { required = false } = {}) {
  if (value === null || value === undefined || value === '') {
    if (required) throw onboardingError(400, 'ONBOARDING_INPUT_INVALID', `${field} es obligatorio.`);
    return null;
  }
  if (typeof value !== 'string') {
    throw onboardingError(400, 'ONBOARDING_INPUT_INVALID', `${field} no es valido.`);
  }
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (!normalized || normalized.length > maximum || /[\u0000-\u001f\u007f]/.test(normalized)) {
    throw onboardingError(400, 'ONBOARDING_INPUT_INVALID', `${field} no es valido.`);
  }
  return normalized;
}

function normalizeOnboardingPatch(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw onboardingError(400, 'ONBOARDING_INPUT_INVALID', 'La configuracion no es valida.');
  }
  const keys = Object.keys(body);
  if (!keys.length || keys.some((key) => !ALLOWED_FIELDS.includes(key))) {
    throw onboardingError(400, 'ONBOARDING_INPUT_INVALID', 'La configuracion contiene campos no permitidos.');
  }
  const result = {};
  if (Object.hasOwn(body, 'nombreMostrado')) {
    result.nombreMostrado = cleanText(body.nombreMostrado, 120, 'El nombre mostrado', { required: true });
  }
  if (Object.hasOwn(body, 'moneda')) {
    const moneda = cleanText(body.moneda, 3, 'La moneda', { required: true })?.toUpperCase();
    if (!ALLOWED_CURRENCIES.includes(moneda)) {
      throw onboardingError(400, 'ONBOARDING_INPUT_INVALID', 'La moneda no esta permitida.');
    }
    result.moneda = moneda;
  }
  if (Object.hasOwn(body, 'zonaHoraria')) {
    const zonaHoraria = cleanText(body.zonaHoraria, 64, 'La zona horaria', { required: true });
    if (!ALLOWED_TIME_ZONES.includes(zonaHoraria)) {
      throw onboardingError(400, 'ONBOARDING_INPUT_INVALID', 'La zona horaria no esta permitida.');
    }
    result.zonaHoraria = zonaHoraria;
  }
  if (Object.hasOwn(body, 'telefono')) result.telefono = cleanText(body.telefono, 30, 'El telefono');
  if (Object.hasOwn(body, 'direccion')) result.direccion = cleanText(body.direccion, 255, 'La direccion');
  if (Object.hasOwn(body, 'datoFiscalBasico')) {
    result.datoFiscalBasico = cleanText(body.datoFiscalBasico, 120, 'El dato fiscal basico');
  }
  return Object.freeze(result);
}

function missingRequiredFields(configuration) {
  return REQUIRED_FIELDS.filter((field) => !String(configuration?.[field] || '').trim());
}

module.exports = {
  ALLOWED_CURRENCIES,
  ALLOWED_FIELDS,
  ALLOWED_TIME_ZONES,
  ONBOARDING_STATES,
  OPTIONAL_FIELDS,
  REQUIRED_FIELDS,
  missingRequiredFields,
  normalizeOnboardingPatch,
  onboardingError
};
