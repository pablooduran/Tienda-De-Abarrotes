const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  INITIAL_STAGING_DATABASE,
  INITIAL_TABLES,
  REMOTE_STAGING_DIAGNOSTIC_ARGUMENT,
  STAGING_DATABASE_DIAGNOSTICS,
  diagnoseRemoteStagingDatabase,
  resolveRemoteStagingDiagnosticMode
} = require('../config/staging-database-mutation-guard');
const { DIAGNOSTIC_CAUSES, classifyDiagnosticFailure } = require('./diagnose-staging-remote');

function expectedExitCode(category) {
  return category === STAGING_DATABASE_DIAGNOSTICS.EMPTY ? 0 : 1;
}

function stagingEnvironment(extra = {}) {
  return {
    APP_ENV: 'staging', NODE_ENV: 'production', DB_ENVIRONMENT: 'staging',
    DB_HOST: 'mysql.staging.invalid', DB_NAME: INITIAL_STAGING_DATABASE,
    DB_SSL_ENABLED: 'true', DB_SSL_CA: 'synthetic-ca',
    ...extra
  };
}

function fakeConnection({ tables = [], rowsByTable = {} } = {}) {
  return {
    async query(sql) {
      if (String(sql).includes('information_schema.TABLES')) {
        return [tables.map((TABLE_NAME) => ({ TABLE_NAME }))];
      }
      const table = INITIAL_TABLES.find((name) => String(sql).includes(`\`${name}\``));
      return [rowsByTable[table] ? [{ rowExists: 1 }] : []];
    }
  };
}

async function main() {
  const diagnosticSource = fs.readFileSync(path.join(__dirname, 'diagnose-staging-remote.js'), 'utf8');
  assert(!/\b(?:CREATE|ALTER|INSERT|UPDATE|DELETE|DROP)\b/i.test(diagnosticSource), 'El diagnostico no debe contener mutaciones SQL.');
  assert.match(diagnosticSource, /if \(category !== STAGING_DATABASE_DIAGNOSTICS\.EMPTY\) process\.exitCode = 1/);
  assert.deepStrictEqual(resolveRemoteStagingDiagnosticMode({
    args: [REMOTE_STAGING_DIAGNOSTIC_ARGUMENT], environment: stagingEnvironment()
  }), { type: 'remote-staging-diagnostic' });
  assert.throws(() => resolveRemoteStagingDiagnosticMode({ environment: stagingEnvironment() }), /--remote-staging-diagnose/);
  assert.throws(() => resolveRemoteStagingDiagnosticMode({
    args: [REMOTE_STAGING_DIAGNOSTIC_ARGUMENT], environment: stagingEnvironment({ DB_NAME: 'other_database' })
  }), /DB_NAME=/);
  assert.throws(() => resolveRemoteStagingDiagnosticMode({
    args: [REMOTE_STAGING_DIAGNOSTIC_ARGUMENT], environment: stagingEnvironment({ DB_SSL_ENABLED: 'false' })
  }), /DB_SSL_ENABLED/);

  assert.strictEqual(await diagnoseRemoteStagingDatabase(fakeConnection(), INITIAL_STAGING_DATABASE), STAGING_DATABASE_DIAGNOSTICS.EMPTY);
  assert.strictEqual(await diagnoseRemoteStagingDatabase(
    fakeConnection({ tables: INITIAL_TABLES }), INITIAL_STAGING_DATABASE
  ), STAGING_DATABASE_DIAGNOSTICS.BASELINE_INITIAL);
  assert.strictEqual(await diagnoseRemoteStagingDatabase(
    fakeConnection({ tables: [...INITIAL_TABLES, 'unexpected_table'] }), INITIAL_STAGING_DATABASE
  ), STAGING_DATABASE_DIAGNOSTICS.PARTIAL_OR_UNEXPECTED);
  assert.strictEqual(await diagnoseRemoteStagingDatabase(
    fakeConnection({ tables: INITIAL_TABLES, rowsByTable: { venta: true } }), INITIAL_STAGING_DATABASE
  ), STAGING_DATABASE_DIAGNOSTICS.PARTIAL_OR_UNEXPECTED);
  assert.strictEqual(expectedExitCode(STAGING_DATABASE_DIAGNOSTICS.EMPTY), 0);
  assert.strictEqual(expectedExitCode(STAGING_DATABASE_DIAGNOSTICS.BASELINE_INITIAL), 1);
  assert.strictEqual(expectedExitCode(STAGING_DATABASE_DIAGNOSTICS.PARTIAL_OR_UNEXPECTED), 1);
  assert.strictEqual(expectedExitCode(STAGING_DATABASE_DIAGNOSTICS.CONNECTION_OR_CONFIGURATION_FAILURE), 1);
  assert.strictEqual(classifyDiagnosticFailure({ code: 'HANDSHAKE_SSL_ERROR' }, 'connect'), DIAGNOSTIC_CAUSES.TLS_CA);
  assert.strictEqual(classifyDiagnosticFailure({ code: 'ERR_TLS_CERT_ALTNAME_INVALID' }, 'connect'), DIAGNOSTIC_CAUSES.TLS_CA);
  assert.strictEqual(classifyDiagnosticFailure({ code: 'ER_SSL_CONNECTION_ERROR' }, 'connect'), DIAGNOSTIC_CAUSES.TLS_CA);
  assert.strictEqual(classifyDiagnosticFailure({ code: 'ER_ACCESS_DENIED_ERROR' }, 'connect'), DIAGNOSTIC_CAUSES.AUTHENTICATION);
  assert.strictEqual(classifyDiagnosticFailure({ code: 'ETIMEDOUT' }, 'connect'), DIAGNOSTIC_CAUSES.NETWORK_TIMEOUT_OR_ALLOWLIST);
  assert.strictEqual(classifyDiagnosticFailure({ code: 'ECONNABORTED' }, 'connect'), DIAGNOSTIC_CAUSES.NETWORK_TIMEOUT_OR_ALLOWLIST);
  assert.strictEqual(classifyDiagnosticFailure({ code: 'EPIPE' }, 'connect'), DIAGNOSTIC_CAUSES.NETWORK_TIMEOUT_OR_ALLOWLIST);
  assert.strictEqual(classifyDiagnosticFailure({ code: 'EHOSTUNREACH' }, 'connect'), DIAGNOSTIC_CAUSES.NETWORK_TIMEOUT_OR_ALLOWLIST);
  assert.strictEqual(classifyDiagnosticFailure({ code: 'ER_BAD_DB_ERROR' }, 'connect'), DIAGNOSTIC_CAUSES.DATABASE_NOT_FOUND_OR_PERMISSION);
  assert.strictEqual(classifyDiagnosticFailure({ code: 'ER_HOST_NOT_PRIVILEGED' }, 'connect'), DIAGNOSTIC_CAUSES.DATABASE_NOT_FOUND_OR_PERMISSION);
  assert.strictEqual(classifyDiagnosticFailure({ code: 'ER_SPECIFIC_ACCESS_DENIED_ERROR' }, 'connect'), DIAGNOSTIC_CAUSES.DATABASE_NOT_FOUND_OR_PERMISSION);
  assert.strictEqual(classifyDiagnosticFailure({ code: 'STAGING_PREREQUISITE' }, 'connect'), DIAGNOSTIC_CAUSES.PREREQUISITE_LOCAL);
  assert.strictEqual(classifyDiagnosticFailure(new Error('guard rejection'), 'prerequisite'), DIAGNOSTIC_CAUSES.PREREQUISITE_LOCAL);
  assert.strictEqual(classifyDiagnosticFailure({ code: 'SOMETHING_UNMAPPED' }, 'read'), DIAGNOSTIC_CAUSES.READ_FAILURE);
  assert.strictEqual(classifyDiagnosticFailure({ code: 'SOMETHING_UNMAPPED' }, 'connect'), DIAGNOSTIC_CAUSES.UNKNOWN_SAFE_FAILURE);
  assert.strictEqual(classifyDiagnosticFailure(new Error('configuracion invalida'), 'configuration'), DIAGNOSTIC_CAUSES.PREREQUISITE_LOCAL);
  assert.strictEqual(classifyDiagnosticFailure({ cause: { code: 'ER_SSL_CONNECTION_ERROR' } }, 'connect'), DIAGNOSTIC_CAUSES.TLS_CA);
  assert.strictEqual(classifyDiagnosticFailure({ cause: { code: 'ER_HOST_NOT_PRIVILEGED' } }, 'connect'), DIAGNOSTIC_CAUSES.DATABASE_NOT_FOUND_OR_PERMISSION);

  const sentinelHost = 'mysql-do-not-connect.staging.invalid';
  const result = spawnSync(process.execPath, [
    path.join('scripts', 'diagnose-staging-remote.js'), REMOTE_STAGING_DIAGNOSTIC_ARGUMENT
  ], {
    cwd: path.resolve(__dirname, '..'),
    env: stagingEnvironment({ DB_HOST: sentinelHost, DB_NAME: 'invalid_destination' }),
    encoding: 'utf8'
  });
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  assert.notStrictEqual(result.status, 0, 'La configuracion invalida debe detener el diagnostico antes de conectar.');
  assert.match(output, /^STAGING_REMOTE_DIAGNOSTIC: CONNECTION_OR_CONFIGURATION_FAILURE (?:[A-Z_]+)$/m);
  assert(!output.includes(sentinelHost), 'El diagnostico no debe exponer el host remoto.');
  assert(!/SELECT|TABLE_NAME|schema_migrations/i.test(output), 'El diagnostico no debe exponer SQL ni estructura.');

  console.log(JSON.stringify({
    resultado: 'ok',
    categories: Object.values(STAGING_DATABASE_DIAGNOSTICS),
    remoteConnections: 0,
    mutations: 0
  }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
