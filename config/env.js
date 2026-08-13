const path = require('path');
const dotenv = require('dotenv');
const { buildDatabaseOptions, isHostedEnvironment } = require('./database-options');
const {
  missingEnvironmentWarning,
  normalizeAppEnvironment,
  resolveEnvironmentFile
} = require('./environment-selection');

const activeEnvironment = normalizeAppEnvironment(process.env.APP_ENV);
const isLocalEnvironment = activeEnvironment === 'local';
const environmentFile = resolveEnvironmentFile(activeEnvironment);
const environmentWarning = missingEnvironmentWarning(activeEnvironment);

if (environmentWarning) console.warn(environmentWarning);

dotenv.config({ path: path.join(__dirname, '..', environmentFile) });

function requireEnvironment(names, environment = process.env) {
  const missing = names.filter((name) => !String(environment[name] || '').trim());
  if (missing.length) {
    throw new Error(`Faltan variables de entorno obligatorias: ${missing.join(', ')}.`);
  }
}

function databaseConfig(extra = {}) {
  return buildDatabaseOptions(process.env, extra);
}

function sessionSecret(environment = process.env) {
  requireEnvironment(['SESSION_SECRET'], environment);
  const value = String(environment.SESSION_SECRET);
  if (value.length < 32) {
    throw new Error('SESSION_SECRET debe tener al menos 32 caracteres.');
  }
  if (isHostedEnvironment(environment)) {
    const placeholder = /(reemplazar|replace[-_ ]?me|change[-_ ]?me|placeholder)/i.test(value);
    const diversity = new Set(value).size;
    if (value.length < 48 || diversity < 10 || placeholder) {
      throw new Error('SESSION_SECRET de staging/production debe ser largo, aleatorio y no puede usar valores de ejemplo.');
    }
  }
  return value;
}

function databaseTarget(config = databaseConfig()) {
  return `host=${config.host} puerto=${config.port} base=${config.database}`;
}

function logDatabaseTarget(action, config = databaseConfig()) {
  if (isLocalEnvironment) {
    console.log(`Entorno local activo. ${action}: ${databaseTarget(config)}.`);
  }
}

function requireLocalhostDatabase(action) {
  const config = databaseConfig();
  if (!isLocalEnvironment || String(config.host).trim().toLowerCase() !== 'localhost') {
    throw new Error(`${action} solo puede ejecutarse con APP_ENV=local y DB_HOST=localhost.`);
  }
  return config;
}

module.exports = {
  activeEnvironment,
  databaseConfig,
  databaseTarget,
  environmentFile,
  isLocalEnvironment,
  logDatabaseTarget,
  requireEnvironment,
  requireLocalhostDatabase,
  sessionSecret
};
