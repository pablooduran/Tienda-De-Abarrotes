const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const {
  EXPECTED_DATABASE, PROBE_CAUSES, PROBE_CONFIRMATION, buildProbeOptions, classifyProbeFailure, runProbe
} = require('./probe-staging-mysql-tls');

function environment(extra = {}) {
  return {
    APP_ENV: 'staging', NODE_ENV: 'production', DB_ENVIRONMENT: 'staging',
    DB_HOST: 'mysql.staging.invalid', DB_PORT: '3306', DB_NAME: EXPECTED_DATABASE,
    DB_USER: 'synthetic-user', DB_PASSWORD: 'synthetic-password', STAGING_TLS_PROBE_CA_PATH: 'synthetic-ca.pem',
    STAGING_TLS_PROBE_CONFIRMATION: PROBE_CONFIRMATION, ...extra
  };
}

async function main() {
  const source = fs.readFileSync(path.join(__dirname, 'probe-staging-mysql-tls.js'), 'utf8');
  assert.match(source, /connection\.query\('SELECT 1'\)/);
  assert(!/\b(?:CREATE|ALTER|INSERT|UPDATE|DELETE|DROP)\b/i.test(source));
  const args = ['--staging-tls-probe'];
  const options = buildProbeOptions(environment(), () => '-----BEGIN CERTIFICATE-----\nsynthetic\n-----END CERTIFICATE-----', args);
  assert.strictEqual(options.ssl.rejectUnauthorized, true);
  assert.throws(() => buildProbeOptions(environment({ DB_NAME: 'other_database' }), () => '', args), /staging tls probe prerequisite rejected/);
  assert.throws(() => buildProbeOptions(environment(), () => '', []), /staging tls probe prerequisite rejected/);
  assert.strictEqual(classifyProbeFailure({ code: 'ER_SSL_CONNECTION_ERROR' }), PROBE_CAUSES.TLS_CA);
  assert.strictEqual(classifyProbeFailure({ code: 'ER_ACCESS_DENIED_ERROR' }), PROBE_CAUSES.AUTHENTICATION);
  assert.strictEqual(classifyProbeFailure({ code: 'ETIMEDOUT' }), PROBE_CAUSES.NETWORK_TIMEOUT_OR_ALLOWLIST);
  assert.strictEqual(classifyProbeFailure({ code: 'ER_HOST_NOT_PRIVILEGED' }), PROBE_CAUSES.DATABASE_NOT_FOUND_OR_PERMISSION);
  assert.strictEqual(classifyProbeFailure({ cause: { code: 'ERR_TLS_CERT_ALTNAME_INVALID' } }), PROBE_CAUSES.TLS_CA);
  assert.strictEqual(classifyProbeFailure({ code: 'UNMAPPED' }), PROBE_CAUSES.UNKNOWN_SAFE_FAILURE);
  let closed = false;
  const passed = await runProbe({ environment: environment(), args, readFile: () => '-----BEGIN CERTIFICATE-----\nsynthetic\n-----END CERTIFICATE-----', createConnection: async () => ({ query: async () => [[{ ok: 1 }]], end: async () => { closed = true; } }) });
  assert.deepStrictEqual(passed, { passed: true });
  assert.strictEqual(closed, true);
  const failed = await runProbe({ environment: environment(), args, readFile: () => '-----BEGIN CERTIFICATE-----\nsynthetic\n-----END CERTIFICATE-----', createConnection: async () => { const error = new Error('hidden'); error.code = 'ECONNREFUSED'; throw error; } });
  assert.deepStrictEqual(failed, { passed: false, cause: PROBE_CAUSES.NETWORK_TIMEOUT_OR_ALLOWLIST });
  console.log(JSON.stringify({ resultado: 'ok', remoteConnections: 0, mutations: 0, tlsRequired: true }, null, 2));
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
