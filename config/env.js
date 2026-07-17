require('dotenv').config();

function requireEnvironment(names) {
  const missing = names.filter((name) => !String(process.env[name] || '').trim());
  if (missing.length) {
    throw new Error(`Faltan variables de entorno obligatorias: ${missing.join(', ')}.`);
  }
}

function databaseConfig(extra = {}) {
  requireEnvironment(['DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME', 'DB_PORT']);

  const port = Number(process.env.DB_PORT);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error('DB_PORT debe ser un numero entero positivo.');
  }

  const useSsl = String(process.env.DB_SSL || '').toLowerCase() === 'true'
    || /aivencloud\.com$/i.test(process.env.DB_HOST);

  return {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port,
    ssl: useSsl ? { rejectUnauthorized: false } : undefined,
    ...extra
  };
}

function sessionSecret() {
  requireEnvironment(['SESSION_SECRET']);
  if (process.env.SESSION_SECRET.length < 32) {
    throw new Error('SESSION_SECRET debe tener al menos 32 caracteres.');
  }
  return process.env.SESSION_SECRET;
}

module.exports = { databaseConfig, requireEnvironment, sessionSecret };
