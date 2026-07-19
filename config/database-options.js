const fs = require('fs');
const tls = require('tls');

const BUSINESS_TIME_ZONE = 'America/La_Paz';
const MYSQL_SESSION_TIME_ZONE = '-04:00';
const BOOLEAN_VALUES = new Map([
  ['true', true],
  ['false', false]
]);

function environmentName(environment = process.env) {
  return String(environment.APP_ENV || '').trim().toLowerCase();
}

function isProductionEnvironment(environment = process.env) {
  return environmentName(environment) === 'production'
    || String(environment.NODE_ENV || '').trim().toLowerCase() === 'production';
}

function parseBoolean(value, name, defaultValue) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized) return defaultValue;
  if (!BOOLEAN_VALUES.has(normalized)) {
    throw new Error(`${name} debe ser true o false.`);
  }
  return BOOLEAN_VALUES.get(normalized);
}

function normalizePem(value) {
  return String(value || '').trim().replace(/\\n/g, '\n');
}

function loadCertificateAuthority(environment = process.env) {
  const inlineCa = normalizePem(environment.DB_SSL_CA);
  const caPath = String(environment.DB_SSL_CA_PATH || '').trim();
  if (inlineCa && caPath) {
    throw new Error('Configure solo una fuente para la CA de MySQL: DB_SSL_CA o DB_SSL_CA_PATH.');
  }
  if (caPath && isProductionEnvironment(environment)) {
    throw new Error('En produccion la CA de MySQL debe proporcionarse mediante DB_SSL_CA.');
  }
  if (inlineCa) return inlineCa;
  if (caPath) {
    try {
      return fs.readFileSync(caPath, 'utf8').trim();
    } catch {
      throw new Error('No se pudo leer el archivo indicado en DB_SSL_CA_PATH.');
    }
  }
  return '';
}

function validateCertificateAuthority(ca) {
  if (!ca) throw new Error('TLS para MySQL requiere una CA en DB_SSL_CA.');
  if (!ca.includes('-----BEGIN CERTIFICATE-----') || !ca.includes('-----END CERTIFICATE-----')) {
    throw new Error('DB_SSL_CA no contiene un certificado PEM valido.');
  }
  try {
    tls.createSecureContext({ ca });
  } catch {
    throw new Error('DB_SSL_CA no contiene una autoridad certificadora PEM valida.');
  }
}

function sslOptions(environment = process.env) {
  const production = isProductionEnvironment(environment);
  const enabled = parseBoolean(environment.DB_SSL_ENABLED, 'DB_SSL_ENABLED', false);
  if (production && !enabled) {
    throw new Error('En produccion DB_SSL_ENABLED debe ser true. No se permite MySQL sin TLS.');
  }
  if (!enabled) return undefined;
  const ca = loadCertificateAuthority(environment);
  validateCertificateAuthority(ca);
  return Object.freeze({ ca, rejectUnauthorized: true });
}

function buildDatabaseOptions(environment = process.env, extra = {}) {
  const required = ['DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME', 'DB_PORT'];
  const missing = required.filter((name) => !String(environment[name] || '').trim());
  if (missing.length) {
    throw new Error(`Faltan variables de entorno obligatorias: ${missing.join(', ')}.`);
  }
  const port = Number(environment.DB_PORT);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error('DB_PORT debe ser un numero entero positivo.');
  }
  const options = {
    ...extra,
    host: environment.DB_HOST,
    user: environment.DB_USER,
    password: environment.DB_PASSWORD,
    database: environment.DB_NAME,
    port,
    charset: 'utf8mb4',
    decimalNumbers: true,
    dateStrings: ['DATE', 'DATETIME'],
    timezone: MYSQL_SESSION_TIME_ZONE
  };
  const ssl = sslOptions(environment);
  if (ssl) options.ssl = ssl;
  else delete options.ssl;
  return options;
}

async function setBusinessSessionTimeZone(connection) {
  await connection.query('SET time_zone = ?', [MYSQL_SESSION_TIME_ZONE]);
  return connection;
}

function installPoolSessionTimeZone(pool) {
  const corePool = pool?.pool || pool;
  if (!corePool || typeof corePool.on !== 'function') {
    throw new Error('No se pudo configurar la zona horaria del pool MySQL.');
  }
  corePool.on('connection', (connection) => {
    connection.query('SET time_zone = ?', [MYSQL_SESSION_TIME_ZONE], (error) => {
      if (error) connection.destroy();
    });
  });
  return pool;
}

module.exports = {
  BUSINESS_TIME_ZONE,
  MYSQL_SESSION_TIME_ZONE,
  buildDatabaseOptions,
  environmentName,
  installPoolSessionTimeZone,
  isProductionEnvironment,
  loadCertificateAuthority,
  normalizePem,
  parseBoolean,
  setBusinessSessionTimeZone,
  sslOptions,
  validateCertificateAuthority
};
