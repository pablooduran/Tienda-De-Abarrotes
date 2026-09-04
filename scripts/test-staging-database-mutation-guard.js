const assert = require('assert/strict');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  INITIAL_STAGING_DATABASE,
  INITIAL_TABLES,
  REMOTE_STAGING_ARGUMENT,
  REMOTE_STAGING_CONFIRMATION,
  assertEmptyRemoteStagingDatabase,
  assertRemoteStagingMigrationBaseline,
  resolveDatabaseMutationMode
} = require('../config/staging-database-mutation-guard');

function localEnvironment(extra = {}) {
  return { APP_ENV: 'local', DB_HOST: 'localhost', ...extra };
}

function stagingEnvironment(extra = {}) {
  return {
    APP_ENV: 'staging', NODE_ENV: 'production', DB_ENVIRONMENT: 'staging',
    DB_HOST: 'mysql.staging.invalid', DB_NAME: INITIAL_STAGING_DATABASE,
    DB_SSL_ENABLED: 'true', DB_SSL_CA: 'synthetic-ca',
    STAGING_DB_MUTATION_CONFIRMATION: REMOTE_STAGING_CONFIRMATION,
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

function assertScriptFailsBeforeRemoteConnection(script) {
  const remoteHostSentinel = 'mysql-do-not-connect.staging.invalid';
  const result = spawnSync(process.execPath, [path.join('scripts', script), REMOTE_STAGING_ARGUMENT], {
    cwd: path.resolve(__dirname, '..'),
    env: {
      ...process.env,
      APP_ENV: 'staging', NODE_ENV: 'production', DB_ENVIRONMENT: 'staging',
      DB_HOST: remoteHostSentinel, DB_NAME: INITIAL_STAGING_DATABASE,
      DB_SSL_ENABLED: 'true', DB_SSL_CA: 'synthetic-ca'
    },
    encoding: 'utf8'
  });
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  assert.notStrictEqual(result.status, 0, `${script} debio bloquear staging incompleto.`);
  assert.match(output, /STAGING_REMOTE_DB_(?:INIT|MIGRATE): FAIL AUTHORIZATION PREREQUISITE_LOCAL/);
  assert(!output.includes(remoteHostSentinel), `${script} no debe revelar ni usar el host remoto.`);
}

async function main() {
  assert.deepStrictEqual(resolveDatabaseMutationMode({ environment: localEnvironment() }), { type: 'local' });
  assert.deepStrictEqual(resolveDatabaseMutationMode({
    args: [REMOTE_STAGING_ARGUMENT], environment: stagingEnvironment()
  }), { type: 'remote-staging' });

  assert.throws(() => resolveDatabaseMutationMode({ environment: stagingEnvironment() }), /--remote-staging/);
  assert.throws(() => resolveDatabaseMutationMode({
    args: [REMOTE_STAGING_ARGUMENT], environment: stagingEnvironment({ STAGING_DB_MUTATION_CONFIRMATION: '' })
  }), /STAGING_DB_MUTATION_CONFIRMATION/);
  assert.throws(() => resolveDatabaseMutationMode({
    args: [REMOTE_STAGING_ARGUMENT], environment: stagingEnvironment({ APP_ENV: 'production', DB_ENVIRONMENT: 'production' })
  }), /APP_ENV=staging/);
  assert.throws(() => resolveDatabaseMutationMode({
    args: [REMOTE_STAGING_ARGUMENT], environment: stagingEnvironment({ DB_NAME: 'another_staging_database' })
  }), /DB_NAME=/);
  assert.throws(() => resolveDatabaseMutationMode({
    args: [REMOTE_STAGING_ARGUMENT], environment: stagingEnvironment({ DB_SSL_ENABLED: 'false' })
  }), /DB_SSL_ENABLED/);
  assert.throws(() => resolveDatabaseMutationMode({
    args: ['--only', '024_corregir_idempotencia_y_snapshot_pagos.sql'],
    environment: stagingEnvironment()
  }), /--remote-staging/);

  await assert.doesNotReject(() => assertEmptyRemoteStagingDatabase(fakeConnection(), INITIAL_STAGING_DATABASE));
  await assert.rejects(
    () => assertEmptyRemoteStagingDatabase(fakeConnection({ tables: ['unexpected_table'] }), INITIAL_STAGING_DATABASE),
    /no esta vacia/
  );
  await assert.doesNotReject(() => assertRemoteStagingMigrationBaseline(
    fakeConnection({ tables: INITIAL_TABLES }), INITIAL_STAGING_DATABASE
  ));
  await assert.rejects(
    () => assertRemoteStagingMigrationBaseline(fakeConnection({ tables: [...INITIAL_TABLES, 'schema_migrations'] }), INITIAL_STAGING_DATABASE),
    /no coincide/
  );
  await assert.rejects(
    () => assertRemoteStagingMigrationBaseline(
      fakeConnection({ tables: INITIAL_TABLES, rowsByTable: { venta: true } }), INITIAL_STAGING_DATABASE
    ),
    /contiene datos/
  );
  assertScriptFailsBeforeRemoteConnection('init-db.js');
  assertScriptFailsBeforeRemoteConnection('migrate-db.js');

  console.log(JSON.stringify({
    resultado: 'ok', remoteRequiresExplicitFlag: true, stagingOnly: true,
    tlsRequired: true, emptyDatabaseVerifiedBeforeMutation: true, remoteConnections: 0
  }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
