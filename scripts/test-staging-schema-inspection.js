const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const {
  EXPECTED_DATABASE, INITIAL_TABLES, INSPECTION_CAUSES, INSPECTION_CONFIRMATION,
  buildInspectionOptions, classifyInspectionFailure, classifySchemaTables, runInspection
} = require('./inspect-staging-schema');

function environment(extra = {}) {
  return {
    APP_ENV: 'staging', NODE_ENV: 'production', DB_ENVIRONMENT: 'staging',
    DB_HOST: 'mysql.staging.invalid', DB_PORT: '3306', DB_NAME: EXPECTED_DATABASE,
    DB_USER: 'synthetic-user', DB_PASSWORD: 'synthetic-password', STAGING_SCHEMA_INSPECTION_CA_PATH: 'synthetic-ca.pem',
    STAGING_SCHEMA_INSPECTION_CONFIRMATION: INSPECTION_CONFIRMATION, ...extra
  };
}

async function main() {
  const source = fs.readFileSync(path.join(__dirname, 'inspect-staging-schema.js'), 'utf8');
  assert.match(source, /FROM information_schema\.TABLES/);
  assert(!/\b(?:CREATE|ALTER|INSERT|UPDATE|DELETE|DROP)\b/i.test(source));
  assert(!/FROM\s+(?:administrador|cliente|proveedor|producto|venta|compra|fiado)\b/i.test(source));
  const args = ['--staging-schema-inspection'];
  const options = buildInspectionOptions(environment(), () => '-----BEGIN CERTIFICATE-----\nsynthetic\n-----END CERTIFICATE-----', args);
  assert.strictEqual(options.ssl.rejectUnauthorized, true);
  assert.throws(() => buildInspectionOptions(environment({ DB_NAME: 'other_database' }), () => '', args));
  assert.strictEqual(classifySchemaTables([]), 'EMPTY');
  assert.strictEqual(classifySchemaTables(INITIAL_TABLES.map((TABLE_NAME) => ({ TABLE_NAME }))), 'BASELINE_INITIAL');
  assert.strictEqual(classifySchemaTables(INITIAL_TABLES.slice(0, -1).map((TABLE_NAME) => ({ TABLE_NAME }))), 'PARTIAL_OR_UNEXPECTED');
  assert.strictEqual(classifySchemaTables([...INITIAL_TABLES, 'schema_migrations'].map((TABLE_NAME) => ({ TABLE_NAME }))), 'PARTIAL_OR_UNEXPECTED');
  assert.strictEqual(classifyInspectionFailure({ code: 'ER_SSL_CONNECTION_ERROR' }), INSPECTION_CAUSES.TLS_CA);
  assert.strictEqual(classifyInspectionFailure({ code: 'ER_ACCESS_DENIED_ERROR' }), INSPECTION_CAUSES.AUTHENTICATION);
  assert.strictEqual(classifyInspectionFailure({ code: 'ETIMEDOUT' }), INSPECTION_CAUSES.NETWORK_TIMEOUT_OR_ALLOWLIST);
  assert.strictEqual(classifyInspectionFailure({ code: 'ER_BAD_DB_ERROR' }), INSPECTION_CAUSES.DATABASE_NOT_FOUND_OR_PERMISSION);
  assert.strictEqual(classifyInspectionFailure({ code: 'UNKNOWN' }), INSPECTION_CAUSES.UNKNOWN_SAFE_FAILURE);
  let closed = false;
  const result = await runInspection({ environment: environment(), args, readFile: () => '-----BEGIN CERTIFICATE-----\nsynthetic\n-----END CERTIFICATE-----', createConnection: async () => ({ query: async (sql, params) => { assert.match(sql, /information_schema\.TABLES/); assert.deepStrictEqual(params, [EXPECTED_DATABASE]); return [INITIAL_TABLES.map((TABLE_NAME) => ({ TABLE_NAME }))]; }, end: async () => { closed = true; } }) });
  assert.deepStrictEqual(result, { state: 'BASELINE_INITIAL' });
  assert.strictEqual(closed, true);
  const failed = await runInspection({ environment: environment(), args, readFile: () => '-----BEGIN CERTIFICATE-----\nsynthetic\n-----END CERTIFICATE-----', createConnection: async () => { const error = new Error('hidden'); error.code = 'ECONNREFUSED'; throw error; } });
  assert.deepStrictEqual(failed, { failed: true, cause: INSPECTION_CAUSES.NETWORK_TIMEOUT_OR_ALLOWLIST });
  console.log(JSON.stringify({ resultado: 'ok', remoteConnections: 0, mutations: 0, informationSchemaOnly: true }, null, 2));
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
