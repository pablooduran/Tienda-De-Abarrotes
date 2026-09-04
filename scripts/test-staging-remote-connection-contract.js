const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const tls = require('tls');
const {
  PREFLIGHT_ARGUMENT,
  PREFLIGHT_CONFIRMATION,
  buildPreflightOptions
} = require('./preflight-staging-remote');
const { buildRemoteStagingDatabaseOptions } = require('../config/staging-remote-database-options');

function environment(extra = {}) {
  const certificateAuthority = tls.rootCertificates[0];
  assert(certificateAuthority, 'Node debe proporcionar una CA de confianza para la prueba.');
  return {
    APP_ENV: 'staging', NODE_ENV: 'production', DB_ENVIRONMENT: 'staging',
    DB_HOST: 'mysql.staging.invalid', DB_PORT: '3306', DB_NAME: 'tienda_abarrotes_staging',
    DB_USER: 'synthetic-user', DB_PASSWORD: 'synthetic-password',
    DB_SSL_ENABLED: 'true', DB_SSL_CA: certificateAuthority.replace(/\n/g, '\\n'),
    STAGING_REMOTE_PREFLIGHT_CONFIRMATION: PREFLIGHT_CONFIRMATION,
    ...extra
  };
}

function source(name) {
  return fs.readFileSync(path.join(__dirname, name), 'utf8');
}

function main() {
  const currentEnvironment = environment();
  const preflight = buildPreflightOptions(currentEnvironment, [PREFLIGHT_ARGUMENT]);
  const remote = buildRemoteStagingDatabaseOptions(currentEnvironment);
  assert.deepStrictEqual(preflight, remote);
  assert.strictEqual(preflight.ssl.rejectUnauthorized, true);
  assert.strictEqual(preflight.charset, 'utf8mb4');
  assert.strictEqual(preflight.timezone, '-04:00');
  assert.throws(() => buildRemoteStagingDatabaseOptions(environment({ DB_SSL_ENABLED: 'false' })));
  assert.match(source('init-db.js'), /buildRemoteStagingDatabaseOptions/);
  assert.match(source('migrate-db.js'), /buildRemoteStagingDatabaseOptions/);
  assert.match(source('migrate-db.js'), /createConnection\(config, \{ onPhase:/);
  console.log(JSON.stringify({
    resultado: 'ok',
    sharedConnectionOptions: true,
    tlsValidationPreserved: true,
    remoteConnections: 0,
    mutations: 0
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
