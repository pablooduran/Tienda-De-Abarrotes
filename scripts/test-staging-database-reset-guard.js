const assert = require('assert');
const {
  CREATE_ARGUMENT,
  CREATE_CONFIRMATION,
  RESET_ARGUMENT,
  RESET_CONFIRMATION,
  STAGING_DATABASE,
  createStagingDatabase,
  resolveAuthorizedMode
} = require('./create-staging-database');

function environment(overrides = {}) {
  return {
    APP_ENV: 'staging',
    NODE_ENV: 'production',
    DB_ENVIRONMENT: 'staging',
    DB_HOST: 'mysql.staging.example',
    DB_PORT: '20987',
    DB_USER: 'staging-user',
    DB_PASSWORD: 'synthetic-password',
    DB_NAME: STAGING_DATABASE,
    DB_SSL_ENABLED: 'true',
    DB_SSL_CA: '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----',
    ...overrides
  };
}

async function captureQueries(env, args) {
  const queries = [];
  let ended = false;
  const mysqlModule = {
    async createConnection() {
      return {
        async query(sql) {
          queries.push(sql);
          if (sql === 'SHOW DATABASES LIKE ?') return [[{ Database: STAGING_DATABASE }]];
          return [[], []];
        },
        async end() { ended = true; }
      };
    }
  };
  await createStagingDatabase(env, args, mysqlModule);
  assert.strictEqual(ended, true);
  return queries;
}

async function main() {
  assert.strictEqual(resolveAuthorizedMode(environment({
    STAGING_DB_CREATE_CONFIRMATION: CREATE_CONFIRMATION
  }), [CREATE_ARGUMENT]), 'create');
  assert.strictEqual(resolveAuthorizedMode(environment({
    STAGING_DB_RESET_CONFIRMATION: RESET_CONFIRMATION
  }), [RESET_ARGUMENT]), 'reset');

  assert.throws(() => resolveAuthorizedMode(environment(), [RESET_ARGUMENT]), /no autorizada/);
  assert.throws(() => resolveAuthorizedMode(environment({
    DB_NAME: 'defaultdb',
    STAGING_DB_RESET_CONFIRMATION: RESET_CONFIRMATION
  }), [RESET_ARGUMENT]), /no autorizada/);
  assert.throws(() => resolveAuthorizedMode(environment({
    APP_ENV: 'production',
    STAGING_DB_RESET_CONFIRMATION: RESET_CONFIRMATION
  }), [RESET_ARGUMENT]), /no autorizada/);

  const createQueries = await captureQueries(environment({
    STAGING_DB_CREATE_CONFIRMATION: CREATE_CONFIRMATION
  }), [CREATE_ARGUMENT]);
  assert.strictEqual(createQueries.some((sql) => sql.startsWith('DROP DATABASE')), false);

  const resetQueries = await captureQueries(environment({
    STAGING_DB_RESET_CONFIRMATION: RESET_CONFIRMATION
  }), [RESET_ARGUMENT]);
  assert.deepStrictEqual(resetQueries, [
    `DROP DATABASE IF EXISTS \`${STAGING_DATABASE}\``,
    `CREATE DATABASE IF NOT EXISTS \`${STAGING_DATABASE}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    'SHOW DATABASES LIKE ?'
  ]);
  console.log('Guarda de reinicio remoto de staging: OK');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
