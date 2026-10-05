const mysql = require('mysql2/promise');
const { loadCertificateAuthority } = require('../config/database-options');

const STAGING_DATABASE = 'tienda_abarrotes_staging';
const CREATE_ARGUMENT = '--remote-staging-create';
const CREATE_CONFIRMATION = 'CREATE_EMPTY_STAGING_DATABASE_001';
const RESET_ARGUMENT = '--remote-staging-reset';
const RESET_CONFIRMATION = 'RESET_PARTIAL_STAGING_DATABASE_001';

function normalized(value) {
  return String(value || '').trim().toLowerCase();
}

function resolveAuthorizedMode(environment = process.env, args = process.argv.slice(2)) {
  const required = ['DB_HOST', 'DB_PORT', 'DB_USER', 'DB_PASSWORD', 'DB_SSL_CA'];
  if (args.length !== 1
    || ![CREATE_ARGUMENT, RESET_ARGUMENT].includes(args[0])
    || required.some((name) => !String(environment[name] || '').trim())
    || normalized(environment.APP_ENV) !== 'staging'
    || normalized(environment.NODE_ENV) !== 'production'
    || normalized(environment.DB_ENVIRONMENT) !== 'staging'
    || String(environment.DB_NAME || '').trim() !== STAGING_DATABASE
    || normalized(environment.DB_SSL_ENABLED) !== 'true') {
    throw new Error('Creacion remota de staging no autorizada o incompleta.');
  }
  if (args[0] === CREATE_ARGUMENT
    && String(environment.STAGING_DB_CREATE_CONFIRMATION || '').trim() === CREATE_CONFIRMATION) {
    return 'create';
  }
  if (args[0] === RESET_ARGUMENT
    && String(environment.STAGING_DB_RESET_CONFIRMATION || '').trim() === RESET_CONFIRMATION) {
    return 'reset';
  }
  throw new Error('Creacion remota de staging no autorizada o incompleta.');
}

function assertAuthorized(environment = process.env, args = process.argv.slice(2)) {
  resolveAuthorizedMode(environment, args);
}

async function createStagingDatabase(
  environment = process.env,
  args = process.argv.slice(2),
  mysqlModule = mysql
) {
  const mode = resolveAuthorizedMode(environment, args);
  const port = Number(environment.DB_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('DB_PORT invalido.');
  }
  const connection = await mysqlModule.createConnection({
    host: environment.DB_HOST,
    port,
    user: environment.DB_USER,
    password: environment.DB_PASSWORD,
    ssl: { ca: loadCertificateAuthority(environment), rejectUnauthorized: true }
  });
  try {
    if (mode === 'reset') {
      await connection.query(`DROP DATABASE IF EXISTS \`${STAGING_DATABASE}\``);
    }
    await connection.query(`CREATE DATABASE IF NOT EXISTS \`${STAGING_DATABASE}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    const [rows] = await connection.query('SHOW DATABASES LIKE ?', [STAGING_DATABASE]);
    if (!rows.length) throw new Error('No se pudo verificar la base de staging.');
  } finally {
    await connection.end();
  }
}

if (require.main === module) {
  createStagingDatabase()
    .then(() => console.log('Base vacia de staging preparada.'))
    .catch((error) => {
      console.error('No se pudo preparar la base de staging.');
      console.error(error.message);
      process.exit(1);
    });
}

module.exports = {
  CREATE_ARGUMENT,
  CREATE_CONFIRMATION,
  RESET_ARGUMENT,
  RESET_CONFIRMATION,
  STAGING_DATABASE,
  assertAuthorized,
  createStagingDatabase,
  resolveAuthorizedMode
};
