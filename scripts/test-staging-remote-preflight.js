const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const {
  EXPECTED_DATABASE,
  PREFLIGHT_ARGUMENT,
  PREFLIGHT_CAUSES,
  PREFLIGHT_CONFIRMATION,
  buildPreflightOptions,
  classifyPreflightFailure,
  grantsAllowCreate,
  runPreflight
} = require('./preflight-staging-remote');

function environment(extra = {}) {
  return {
    APP_ENV: 'staging', NODE_ENV: 'production', DB_ENVIRONMENT: 'staging',
    DB_HOST: 'mysql.staging.invalid', DB_PORT: '3306', DB_NAME: EXPECTED_DATABASE,
    DB_USER: 'synthetic-user', DB_PASSWORD: 'synthetic-password',
    DB_SSL_ENABLED: 'true', DB_SSL_CA: '-----BEGIN CERTIFICATE-----\\nsynthetic\\n-----END CERTIFICATE-----',
    STAGING_REMOTE_PREFLIGHT_CONFIRMATION: PREFLIGHT_CONFIRMATION,
    ...extra
  };
}

function grants(...values) {
  return [values.map((value, index) => ({ [`Grant ${index}`]: value }))];
}

async function main() {
  const source = fs.readFileSync(path.join(__dirname, 'preflight-staging-remote.js'), 'utf8');
  assert.match(source, /connection\.query\('SET time_zone = \?', \[MYSQL_SESSION_TIME_ZONE\]\)/);
  assert.match(source, /connection\.query\('SHOW GRANTS'\)/);
  assert(!/CREATE\s+TABLE|INSERT\s+INTO|UPDATE\s+\w+|DELETE\s+FROM|ALTER\s+TABLE|DROP\s+TABLE/i.test(source));

  const args = [PREFLIGHT_ARGUMENT];
  const options = buildPreflightOptions(environment(), args);
  assert.strictEqual(options.ssl.rejectUnauthorized, true);
  assert.throws(() => buildPreflightOptions(environment({ DB_NAME: 'other_database' }), args));
  assert.throws(() => buildPreflightOptions(environment({ DB_SSL_ENABLED: 'false' }), args));
  assert.throws(() => buildPreflightOptions(environment(), []));

  assert.strictEqual(grantsAllowCreate(grants('GRANT ALL PRIVILEGES ON *.* TO `synthetic`@`%`')[0]), true);
  assert.strictEqual(grantsAllowCreate(grants('GRANT SELECT, CREATE, ALTER ON `tienda_abarrotes_staging`.* TO `synthetic`@`%`')[0]), true);
  assert.strictEqual(grantsAllowCreate(grants('GRANT SELECT, INSERT ON `tienda_abarrotes_staging`.* TO `synthetic`@`%`')[0]), false);
  assert.strictEqual(grantsAllowCreate(grants('GRANT CREATE TEMPORARY TABLES ON `tienda_abarrotes_staging`.* TO `synthetic`@`%`')[0]), false);
  assert.strictEqual(classifyPreflightFailure({ code: 'ER_SSL_CONNECTION_ERROR' }), PREFLIGHT_CAUSES.TLS_CA);
  assert.strictEqual(classifyPreflightFailure({ code: 'ER_ACCESS_DENIED_ERROR' }), PREFLIGHT_CAUSES.AUTHENTICATION);
  assert.strictEqual(classifyPreflightFailure({ code: 'ETIMEDOUT' }), PREFLIGHT_CAUSES.NETWORK_TIMEOUT_OR_ALLOWLIST);
  assert.strictEqual(classifyPreflightFailure(new Error('hidden'), 'session-time-zone'), PREFLIGHT_CAUSES.SESSION_TIME_ZONE_FAILED);

  const events = [];
  let closed = false;
  const passed = await runPreflight({
    environment: environment(), args,
    createConnection: async () => ({
      query: async (sql, params) => {
        events.push([sql, params]);
        if (sql === 'SHOW GRANTS') return grants('GRANT ALL PRIVILEGES ON `tienda_abarrotes_staging`.* TO `synthetic`@`%`');
        return [[]];
      },
      end: async () => { closed = true; }
    })
  });
  assert.deepStrictEqual(passed, { passed: true });
  assert.deepStrictEqual(events, [
    ['SET time_zone = ?', ['-04:00']],
    ['SHOW GRANTS', undefined]
  ]);
  assert.strictEqual(closed, true);

  const missingPrivilege = await runPreflight({
    environment: environment(), args,
    createConnection: async () => ({
      query: async (sql) => (sql === 'SHOW GRANTS'
        ? grants('GRANT SELECT ON `tienda_abarrotes_staging`.* TO `synthetic`@`%`')
        : [[]]),
      end: async () => {}
    })
  });
  assert.deepStrictEqual(missingPrivilege, {
    passed: false, cause: PREFLIGHT_CAUSES.SCHEMA_CREATE_PRIVILEGE_MISSING
  });

  const timezoneFailure = await runPreflight({
    environment: environment(), args,
    createConnection: async () => ({
      query: async () => { throw new Error('hidden'); }, end: async () => {}
    })
  });
  assert.deepStrictEqual(timezoneFailure, {
    passed: false, cause: PREFLIGHT_CAUSES.SESSION_TIME_ZONE_FAILED
  });

  const connectionFailure = await runPreflight({
    environment: environment(), args,
    createConnection: async () => { const error = new Error('hidden'); error.code = 'ECONNREFUSED'; throw error; }
  });
  assert.deepStrictEqual(connectionFailure, {
    passed: false, cause: PREFLIGHT_CAUSES.NETWORK_TIMEOUT_OR_ALLOWLIST
  });

  console.log(JSON.stringify({ resultado: 'ok', remoteConnections: 0, mutations: 0, grantsExposed: false }, null, 2));
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
