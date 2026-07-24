const path = require('path');
const dotenv = require('dotenv');
const { buildDatabaseOptions } = require('./database-options');
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

function requireEnvironment(names) {
  const missing = names.filter((name) => !String(process.env[name] || '').trim());
  if (missing.length) {
    throw new Error(`Faltan variables de entorno obligatorias: ${missing.join(', ')}.`);
  }
}

function databaseConfig(extra = {}) {
  return buildDatabaseOptions(process.env, extra);
}

function sessionSecret() {
  requireEnvironment(['SESSION_SECRET']);
  if (process.env.SESSION_SECRET.length < 32) {
    throw new Error('SESSION_SECRET debe tener al menos 32 caracteres.');
  }
  return process.env.SESSION_SECRET;
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
