const HOSTED_ENVIRONMENTS = new Set(['staging', 'production']);
const PLACEHOLDER = /(reemplazar|replace[-_ ]?me|change[-_ ]?me|placeholder|example|ejemplo)/i;
const PROVIDER_CODE = /^[a-z0-9][a-z0-9_-]{1,38}[a-z0-9]$/;
const SIMPLE_EMAIL = /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/;
const MAILTRAP_SANDBOX_PROVIDER = 'mailtrap-sandbox';
const REGISTERED_EMAIL_PROVIDERS = Object.freeze([MAILTRAP_SANDBOX_PROVIDER]);
const DEFAULT_EMAIL_DELIVERY_TIMEOUT_MS = 8000;

function normalized(value) {
  return String(value || '').trim().toLowerCase();
}

function parseEmailFrom(value) {
  const configured = String(value || '').trim();
  if (!configured || configured.length > 320 || /[\r\n\0]/.test(configured)) {
    throw new Error('EMAIL_FROM debe ser un remitente seguro.');
  }
  const named = configured.match(/^([^<>]{1,100})\s*<([^<>]+)>$/);
  const name = named ? named[1].trim().replace(/^"|"$/g, '') : '';
  const email = (named ? named[2] : configured).trim().toLowerCase();
  if (!SIMPLE_EMAIL.test(email) || email.length > 254 || (named && !name)) {
    throw new Error('EMAIL_FROM debe contener un correo valido.');
  }
  return Object.freeze(name ? { email, name } : { email });
}

function mailtrapSandboxConfig(environment = process.env) {
  const apiToken = String(environment.MAILTRAP_API_TOKEN || '').trim();
  const inboxId = String(environment.MAILTRAP_INBOX_ID || '').trim();
  if (apiToken.length < 24 || apiToken.length > 512 || /\s|[\0\r\n]/.test(apiToken)
    || PLACEHOLDER.test(apiToken)) {
    throw new Error('MAILTRAP_API_TOKEN debe ser robusto y no puede ser un placeholder.');
  }
  if (!/^[1-9]\d{0,18}$/.test(inboxId)) {
    throw new Error('MAILTRAP_INBOX_ID debe ser un identificador numerico positivo.');
  }
  const rawTimeout = String(environment.EMAIL_DELIVERY_TIMEOUT_MS || '').trim();
  const timeoutMs = rawTimeout ? Number(rawTimeout) : DEFAULT_EMAIL_DELIVERY_TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 30000) {
    throw new Error('EMAIL_DELIVERY_TIMEOUT_MS debe ser un entero entre 1000 y 30000.');
  }
  return Object.freeze({
    apiToken,
    from: parseEmailFrom(environment.EMAIL_FROM),
    inboxId,
    timeoutMs
  });
}

function emailDeliveryConfig(environment = process.env, {
  registeredProviders = REGISTERED_EMAIL_PROVIDERS
} = {}) {
  const appEnvironment = normalized(environment.APP_ENV);
  const hosted = HOSTED_ENVIRONMENTS.has(appEnvironment);
  const mode = normalized(environment.EMAIL_DELIVERY_MODE || (hosted ? 'disabled' : 'local'));
  const provider = normalized(environment.EMAIL_DELIVERY_PROVIDER);

  if (!hosted) {
    if (mode !== 'local') {
      throw new Error('Local/CI solo admite EMAIL_DELIVERY_MODE=local.');
    }
    if (provider) {
      throw new Error('EMAIL_DELIVERY_PROVIDER no se admite con entrega local.');
    }
    return Object.freeze({ mode: 'local', provider: 'local' });
  }

  if (mode === 'disabled') {
    if (provider) {
      throw new Error('EMAIL_DELIVERY_PROVIDER debe estar ausente cuando el correo esta deshabilitado.');
    }
    return Object.freeze({ mode: 'disabled', provider: null });
  }

  if (mode !== 'external') {
    throw new Error('EMAIL_DELIVERY_MODE solo admite disabled o external en entornos hospedados.');
  }
  if (appEnvironment !== 'staging') {
    throw new Error('EMAIL_DELIVERY_MODE=external solo se permite en staging hasta aprobar produccion.');
  }
  if (!PROVIDER_CODE.test(provider) || PLACEHOLDER.test(provider)) {
    throw new Error('EMAIL_DELIVERY_PROVIDER debe identificar un adaptador registrado.');
  }
  const providers = new Set(registeredProviders.map(normalized).filter(Boolean));
  if (!providers.has(provider)) {
    throw new Error('EMAIL_DELIVERY_PROVIDER no corresponde a un adaptador externo registrado.');
  }
  if (provider === MAILTRAP_SANDBOX_PROVIDER) mailtrapSandboxConfig(environment);
  return Object.freeze({ mode: 'external', provider });
}

module.exports = {
  DEFAULT_EMAIL_DELIVERY_TIMEOUT_MS,
  MAILTRAP_SANDBOX_PROVIDER,
  REGISTERED_EMAIL_PROVIDERS,
  emailDeliveryConfig,
  mailtrapSandboxConfig,
  parseEmailFrom
};
