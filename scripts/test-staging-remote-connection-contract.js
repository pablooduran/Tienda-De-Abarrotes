const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const tls = require('tls');
const mysql = require('mysql2/promise');
const net = require('net');
const { buildDatabaseOptions, sslOptions } = require('../config/database-options');
const { classifyRemoteFailure, sanitizeRemoteFailure } = require('../config/staging-remote-failure');
const statusContract = require('../config/staging-remote-status-contract.json');
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

async function assertRealDriverAcceptsOptions(options) {
  const originalConnect = net.Socket.prototype.connect;
  let transportReached = false;
  net.Socket.prototype.connect = function blockedTransport() {
    transportReached = true;
    throw Object.assign(new Error('Offline test transport'), { code: 'OFFLINE_TEST_TRANSPORT' });
  };
  try {
    await assert.rejects(async () => mysql.createConnection(options), (error) =>
      error.code === 'OFFLINE_TEST_TRANSPORT', 'El driver real debe aceptar las opciones antes de alcanzar el transporte bloqueado.');
    assert(transportReached, 'El constructor del driver fallo antes del transporte.');
  } finally {
    net.Socket.prototype.connect = originalConnect;
  }
}

async function main() {
  const currentEnvironment = environment();
  const preflight = buildPreflightOptions(currentEnvironment, [PREFLIGHT_ARGUMENT]);
  const remote = buildRemoteStagingDatabaseOptions(currentEnvironment);
  assert.deepStrictEqual(preflight, remote);
  assert.strictEqual(preflight.ssl.rejectUnauthorized, true);
  assert.strictEqual(preflight.charset, 'utf8mb4');
  assert.strictEqual(preflight.timezone, '-04:00');
  await assertRealDriverAcceptsOptions(preflight);
  await assertRealDriverAcceptsOptions(remote);
  const policy = sslOptions(currentEnvironment);
  assert(Object.isFrozen(policy), 'La politica validada se conserva inmutable.');
  assert(!Object.isFrozen(remote.ssl), 'mysql2 necesita una copia propia mutable.');
  assert.notStrictEqual(remote.ssl, buildRemoteStagingDatabaseOptions(currentEnvironment).ssl);
  for (const APP_ENV of ['local', 'ci', 'production']) {
    await assertRealDriverAcceptsOptions(buildDatabaseOptions({ ...currentEnvironment, APP_ENV }));
  }
  for (const [code, cause] of Object.entries(statusContract.errorCauses)) {
    const error = { code, get message() { throw new Error('No se debe leer texto crudo.'); } };
    assert.deepEqual(classifyRemoteFailure(error, 'CONNECTION'), { phase: 'CONNECTION', cause, reason: code });
    assert.deepEqual(classifyRemoteFailure({ cause: error }, 'CONNECTION'), { phase: 'CONNECTION', cause, reason: code });
  }
  assert.deepEqual(classifyRemoteFailure(new TypeError('synthetic secret'), 'CONNECTION'), {
    phase: 'CONNECTION', cause: 'PREREQUISITE_LOCAL', reason: 'LOCAL_TYPE_ERROR'
  });
  assert.deepEqual(classifyRemoteFailure({ code: 'ER_ACCESS_DENIED_ERROR', cause: { code: 'ETIMEDOUT' } }, 'CONNECTION'), {
    phase: 'CONNECTION', cause: 'UNKNOWN_SAFE_FAILURE', reason: 'CONFLICTING_ERROR_CODES'
  });
  assert.deepEqual(sanitizeRemoteFailure({ phase: 'synthetic secret', cause: 'synthetic secret', reason: 'synthetic secret' }), {
    phase: 'LAUNCHER', cause: 'UNKNOWN_SAFE_FAILURE', reason: 'UNCLASSIFIED_ERROR'
  });
  assert.equal(new Set(statusContract.causes).size, statusContract.causes.length);
  assert.throws(() => buildRemoteStagingDatabaseOptions(environment({ DB_SSL_ENABLED: 'false' })));
  assert.match(source('init-db.js'), /buildRemoteStagingDatabaseOptions/);
  assert.match(source('migrate-db.js'), /buildRemoteStagingDatabaseOptions/);
  assert.match(source('diagnose-staging-remote.js'), /buildRemoteStagingDatabaseOptions/);
  assert.match(source('migrate-db.js'), /createConnection\(config, \{ onPhase:/);
  console.log(JSON.stringify({
    resultado: 'ok',
    sharedConnectionOptions: true,
    tlsValidationPreserved: true,
    remoteConnections: 0,
    mutations: 0
  }, null, 2));
}

main().catch(() => {
  console.error('STAGING_CONNECTION_CONTRACT_TEST_FAILED');
  process.exitCode = 1;
});
