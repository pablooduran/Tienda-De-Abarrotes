const assert = require('assert/strict');
const {
  REMOTE_OPERATION_CAUSES,
  classifyRemoteOperationFailure,
  remoteOperationStatus
} = require('../config/staging-remote-operation-status');
const { runInitialization } = require('./init-db');

function remoteMode() {
  return { type: 'remote-staging' };
}

function remoteConfiguration() {
  return { database: 'tienda_abarrotes_staging' };
}

async function main() {
  assert.strictEqual(
    classifyRemoteOperationFailure({ code: 'ER_TABLEACCESS_DENIED_ERROR' }, 'BASE_SCHEMA'),
    REMOTE_OPERATION_CAUSES.SCHEMA_CREATE_PRIVILEGE_MISSING
  );
  assert.strictEqual(
    classifyRemoteOperationFailure({ code: 'ER_CANT_CREATE_TABLE' }, 'BASE_SCHEMA'),
    REMOTE_OPERATION_CAUSES.BASE_SCHEMA_DDL_FAILED
  );
  assert.strictEqual(
    classifyRemoteOperationFailure(new Error('hidden'), 'SESSION_TIME_ZONE'),
    REMOTE_OPERATION_CAUSES.SESSION_TIME_ZONE_FAILED
  );
  assert.strictEqual(
    remoteOperationStatus('INIT', { passed: false, phase: 'BASE_SCHEMA', cause: REMOTE_OPERATION_CAUSES.SCHEMA_CREATE_PRIVILEGE_MISSING }),
    'STAGING_REMOTE_DB_INIT: FAIL BASE_SCHEMA SCHEMA_CREATE_PRIVILEGE_MISSING'
  );
  assert.strictEqual(
    remoteOperationStatus('MIGRATE', { passed: true }),
    'STAGING_REMOTE_DB_MIGRATE: PASS'
  );

  const denied = await runInitialization({
    args: ['--remote-staging'],
    resolveMode: remoteMode,
    buildConfig: remoteConfiguration,
    logTarget: () => {},
    assertEmpty: async () => {},
    connect: async () => ({
      query: async () => {
        const error = new Error('hidden');
        error.code = 'ER_TABLEACCESS_DENIED_ERROR';
        throw error;
      },
      end: async () => {}
    })
  });
  assert.deepStrictEqual(denied, {
    remote: true,
    passed: false,
    phase: 'BASE_SCHEMA',
    cause: REMOTE_OPERATION_CAUSES.SCHEMA_CREATE_PRIVILEGE_MISSING
  });

  const timezoneFailure = await runInitialization({
    args: ['--remote-staging'],
    resolveMode: remoteMode,
    buildConfig: remoteConfiguration,
    logTarget: () => {},
    assertEmpty: async () => {},
    connect: async (_config, { onPhase }) => {
      onPhase('CONNECTION');
      onPhase('SESSION_TIME_ZONE');
      throw new Error('hidden');
    }
  });
  assert.deepStrictEqual(timezoneFailure, {
    remote: true,
    passed: false,
    phase: 'SESSION_TIME_ZONE',
    cause: REMOTE_OPERATION_CAUSES.SESSION_TIME_ZONE_FAILED
  });

  console.log(JSON.stringify({ resultado: 'ok', remoteConnections: 0, mutations: 0, errorsSanitized: true }, null, 2));
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
