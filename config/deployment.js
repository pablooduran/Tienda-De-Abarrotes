const net = require('net');
const path = require('path');

const HOSTED_ENVIRONMENTS = new Set(['staging', 'production']);
const SUPPORTED_ENVIRONMENTS = new Set(['local', 'ci', 'staging', 'production', 'test']);
const PLACEHOLDER = /(reemplazar|replace[-_ ]?me|change[-_ ]?me|placeholder|example|ejemplo)/i;

function normalized(value) {
  return String(value || '').trim().toLowerCase();
}

function effectiveEnvironment(environment = process.env) {
  const appEnvironment = normalized(environment.APP_ENV);
  if (!SUPPORTED_ENVIRONMENTS.has(appEnvironment)) {
    throw new Error('APP_ENV debe ser local, ci, staging o production.');
  }
  if ((appEnvironment === 'local' || appEnvironment === 'test')
    && normalized(environment.CI) === 'true') return 'ci';
  return appEnvironment === 'test' ? 'ci' : appEnvironment;
}

function required(environment, names) {
  const missing = names.filter((name) => !String(environment[name] || '').trim());
  if (missing.length) throw new Error(`Configuracion obligatoria ausente: ${missing.join(', ')}.`);
}

function parseHttpsUrl(value, name) {
  let parsed;
  try {
    parsed = new URL(String(value || '').trim());
  } catch {
    throw new Error(`${name} debe ser una URL HTTPS valida.`);
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password
    || parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new Error(`${name} debe ser un origen HTTPS sin credenciales, ruta, query ni fragmento.`);
  }
  return parsed.origin;
}

function parseProxyCidrs(value) {
  const entries = String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
  if (!entries.length) throw new Error('TRUST_PROXY_CIDRS es obligatorio en staging/production.');
  const cidrs = entries.map((entry) => {
    const match = entry.match(/^([^/]+)\/(\d{1,3})$/);
    if (!match) throw new Error('TRUST_PROXY_CIDRS solo admite redes CIDR explicitas.');
    const family = net.isIP(match[1]);
    const prefix = Number(match[2]);
    const maximum = family === 4 ? 32 : family === 6 ? 128 : -1;
    if (maximum < 0 || prefix <= 0 || prefix > maximum) {
      throw new Error('TRUST_PROXY_CIDRS contiene una red o prefijo invalido.');
    }
    return `${match[1]}/${prefix}`;
  });
  if (new Set(cidrs).size !== cidrs.length) {
    throw new Error('TRUST_PROXY_CIDRS contiene redes duplicadas.');
  }
  return Object.freeze(cidrs);
}

function rateLimitStoreConfig(environment, mode) {
  const configured = normalized(environment.RATE_LIMIT_STORE);
  if (!HOSTED_ENVIRONMENTS.has(mode)) {
    if (configured && configured !== 'memory') {
      throw new Error('Local/CI solo admite RATE_LIMIT_STORE=memory.');
    }
    return Object.freeze({ type: 'memory' });
  }
  if (configured !== 'redis') {
    throw new Error('Staging/production exige RATE_LIMIT_STORE=redis.');
  }
  required(environment, ['RATE_LIMIT_REDIS_URL']);
  let url;
  try {
    url = new URL(String(environment.RATE_LIMIT_REDIS_URL).trim());
  } catch {
    throw new Error('RATE_LIMIT_REDIS_URL no es valida.');
  }
  if (url.protocol !== 'rediss:' || !url.hostname || !url.password
    || url.password.length < 16 || PLACEHOLDER.test(url.href)) {
    throw new Error('RATE_LIMIT_REDIS_URL debe usar rediss://, incluir credencial robusta y no ser un placeholder.');
  }
  const prefix = String(environment.RATE_LIMIT_REDIS_PREFIX || `tienda:${mode}:`).trim();
  if (!/^[a-z0-9:_-]{4,80}$/i.test(prefix) || !prefix.includes(mode)) {
    throw new Error('RATE_LIMIT_REDIS_PREFIX debe ser seguro e identificar el entorno.');
  }
  return Object.freeze({ type: 'redis', url: url.href, prefix });
}

function privateStorageConfig(environment, mode, cwd) {
  const receiptMode = normalized(environment.PAYMENT_RECEIPT_MODE || 'enabled');
  if (!['enabled', 'disabled'].includes(receiptMode)) {
    throw new Error('PAYMENT_RECEIPT_MODE solo admite enabled o disabled.');
  }
  if (receiptMode === 'disabled') {
    if (mode !== 'staging') {
      throw new Error('PAYMENT_RECEIPT_MODE=disabled solo se permite en staging.');
    }
    return Object.freeze({ enabled: false, driver: 'disabled', root: null });
  }
  if (!HOSTED_ENVIRONMENTS.has(mode)) return Object.freeze({ enabled: true, driver: 'local', root: null });
  required(environment, ['PAYMENT_RECEIPT_STORAGE_DIR', 'PAYMENT_RECEIPT_STORAGE_DRIVER']);
  if (normalized(environment.PAYMENT_RECEIPT_STORAGE_DRIVER) !== 'filesystem') {
    throw new Error('El driver privado soportado actualmente es filesystem.');
  }
  const root = path.resolve(String(environment.PAYMENT_RECEIPT_STORAGE_DIR));
  if (!path.isAbsolute(String(environment.PAYMENT_RECEIPT_STORAGE_DIR))) {
    throw new Error('PAYMENT_RECEIPT_STORAGE_DIR debe ser una ruta absoluta.');
  }
  const relative = path.relative(cwd, root);
  if (!relative || (!relative.startsWith('..') && !path.isAbsolute(relative))) {
    throw new Error('PAYMENT_RECEIPT_STORAGE_DIR debe estar fuera del repositorio.');
  }
  return Object.freeze({ enabled: true, driver: 'filesystem', root });
}

function deploymentConfig(environment = process.env, { cwd = process.cwd() } = {}) {
  const mode = effectiveEnvironment(environment);
  const hosted = HOSTED_ENVIRONMENTS.has(mode);
  required(environment, ['DB_HOST', 'DB_NAME', 'SESSION_SECRET']);
  const host = normalized(environment.DB_HOST);
  if (!host) throw new Error('DB_HOST es obligatorio.');
  if (!hosted && host !== 'localhost') {
    throw new Error('Local/CI solo puede usar DB_HOST=localhost.');
  }
  if (!hosted && normalized(environment.NODE_ENV) === 'production') {
    throw new Error('Local/CI no puede ejecutarse con NODE_ENV=production.');
  }

  if (!hosted) {
    return Object.freeze({
      mode,
      hosted: false,
      secureCookies: false,
      trustProxy: false,
      appBaseUrl: null,
      rateLimitStore: rateLimitStoreConfig(environment, mode),
      privateStorage: privateStorageConfig(environment, mode, cwd),
      emailDeliveryMode: 'local'
    });
  }

  required(environment, [
    'APP_BASE_URL',
    'DB_PORT',
    'DB_USER',
    'DB_PASSWORD',
    'DB_SSL_ENABLED',
    'DB_SSL_CA',
    'DB_ENVIRONMENT',
    'NODE_ENV',
    'TRUSTED_ORIGINS',
    'TRUST_PROXY_CIDRS',
    'EMAIL_DELIVERY_MODE'
  ]);
  if (normalized(environment.NODE_ENV) !== 'production') {
    throw new Error('Staging/production exige NODE_ENV=production.');
  }
  if (normalized(environment.DB_ENVIRONMENT) !== mode) {
    throw new Error('DB_ENVIRONMENT debe coincidir exactamente con APP_ENV.');
  }
  if (!normalized(environment.DB_NAME).includes(mode)) {
    throw new Error('DB_NAME debe identificar explicitamente el entorno hospedado.');
  }
  if (String(environment.DB_PASSWORD).length < 16 || PLACEHOLDER.test(environment.DB_PASSWORD)) {
    throw new Error('DB_PASSWORD hospedado debe ser robusto y no puede ser un placeholder.');
  }
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') {
    throw new Error('Staging/production no puede usar la base local.');
  }
  if (normalized(environment.EMAIL_DELIVERY_MODE) !== 'disabled') {
    throw new Error('Staging/production exige EMAIL_DELIVERY_MODE=disabled hasta configurar un adaptador externo.');
  }
  const appBaseUrl = parseHttpsUrl(environment.APP_BASE_URL, 'APP_BASE_URL');
  const origins = String(environment.TRUSTED_ORIGINS).split(',')
    .map((item) => parseHttpsUrl(item, 'TRUSTED_ORIGINS'));
  if (!origins.includes(appBaseUrl)) {
    throw new Error('TRUSTED_ORIGINS debe incluir APP_BASE_URL.');
  }
  return Object.freeze({
    mode,
    hosted: true,
    secureCookies: true,
    trustProxy: parseProxyCidrs(environment.TRUST_PROXY_CIDRS),
    appBaseUrl,
    rateLimitStore: rateLimitStoreConfig(environment, mode),
    privateStorage: privateStorageConfig(environment, mode, cwd),
    emailDeliveryMode: 'disabled'
  });
}

module.exports = {
  HOSTED_ENVIRONMENTS,
  deploymentConfig,
  effectiveEnvironment,
  parseHttpsUrl,
  parseProxyCidrs,
  privateStorageConfig,
  rateLimitStoreConfig
};
