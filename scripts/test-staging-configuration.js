const assert = require('assert/strict');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const express = require('express');
const { buildDatabaseOptions } = require('../config/database-options');
const { deploymentConfig, effectiveEnvironment, parseProxyCidrs } = require('../config/deployment');
const { sessionSecret } = require('../config/env');
const { createRateLimitStoreBackend, createRedisBackend } = require('../services/rate-limit-store-service');
const { createOperationalHealthService } = require('../services/operational-health-service');
const { assertLocalDelivery } = require('../services/local-verification-mail-adapter');

const ROOT = path.resolve(__dirname, '..');
const STRONG_SECRET = 'Staging_2026!Session#9qL4vT7mK2pR8xN5wZ3cH6jF_A1sD4';
const OUTPUT_SENTINEL = 'staging-database-password-must-not-leak';

function baseEnvironment(extra = {}) {
  return {
    APP_ENV: 'local',
    DB_HOST: 'localhost',
    DB_NAME: 'tienda_abarrotes_pruebas',
    SESSION_SECRET: STRONG_SECRET,
    ...extra
  };
}

function hostedEnvironment(mode = 'staging', extra = {}) {
  const origin = `https://${mode}.tienda.invalid`;
  return baseEnvironment({
    APP_ENV: mode,
    NODE_ENV: 'production',
    DB_ENVIRONMENT: mode,
    DB_HOST: `mysql.${mode}.internal`,
    DB_NAME: `tienda_abarrotes_${mode}`,
    DB_PORT: '3306',
    DB_USER: `tienda_${mode}`,
    DB_PASSWORD: 'DbSynthetic_2026!9qL4vT7m',
    DB_SSL_ENABLED: 'true',
    DB_SSL_CA: 'synthetic-pem-validated-separately',
    APP_BASE_URL: origin,
    TRUSTED_ORIGINS: origin,
    TRUST_PROXY_CIDRS: '10.40.0.0/24',
    RATE_LIMIT_STORE: 'redis',
    RATE_LIMIT_REDIS_URL: `rediss://default:RedisSynthetic_2026!9qL4v@redis.${mode}.internal:6380`,
    RATE_LIMIT_REDIS_PREFIX: `tienda:${mode}:`,
    PAYMENT_RECEIPT_STORAGE_DRIVER: 'filesystem',
    PAYMENT_RECEIPT_STORAGE_DIR: path.join(os.tmpdir(), `tienda-${mode}-private`),
    EMAIL_DELIVERY_MODE: 'disabled',
    ...extra
  });
}

function testEnvironmentContracts() {
  const local = deploymentConfig(baseEnvironment());
  assert.strictEqual(local.mode, 'local');
  assert.strictEqual(local.trustProxy, false);
  assert.strictEqual(local.rateLimitStore.type, 'memory');
  assert.strictEqual(local.secureCookies, false);

  const ciEnvironment = baseEnvironment({ CI: 'true' });
  const ci = deploymentConfig(ciEnvironment);
  assert.strictEqual(effectiveEnvironment(ciEnvironment), 'ci');
  assert.strictEqual(ci.mode, 'ci');
  assert.strictEqual(ci.rateLimitStore.type, 'memory');

  for (const mode of ['staging', 'production']) {
    const hosted = deploymentConfig(hostedEnvironment(mode));
    assert.strictEqual(hosted.mode, mode);
    assert.strictEqual(hosted.secureCookies, true);
    assert.deepStrictEqual(hosted.trustProxy, ['10.40.0.0/24']);
    assert.strictEqual(hosted.rateLimitStore.type, 'redis');
    assert.strictEqual(hosted.emailDeliveryMode, 'disabled');
  }

  assert.throws(() => deploymentConfig(baseEnvironment({ APP_ENV: 'staging' })), /Configuracion obligatoria/);
  assert.throws(() => deploymentConfig(baseEnvironment({ APP_ENV: 'production' })), /Configuracion obligatoria/);
  assert.throws(() => deploymentConfig(baseEnvironment({ DB_HOST: 'db.remote.invalid' })), /DB_HOST=localhost/);
  assert.throws(() => deploymentConfig(baseEnvironment({ NODE_ENV: 'production' })), /NODE_ENV=production/);
  assert.throws(() => deploymentConfig(baseEnvironment({ RATE_LIMIT_STORE: 'redis' })), /solo admite/);
  assert.throws(() => deploymentConfig(hostedEnvironment('staging', { DB_ENVIRONMENT: 'production' })), /coincidir/);
  assert.throws(() => deploymentConfig(hostedEnvironment('staging', { DB_NAME: 'tienda_abarrotes' })), /identificar/);
  assert.throws(() => deploymentConfig(hostedEnvironment('staging', { DB_PASSWORD: 'replace-me' })), /DB_PASSWORD/);
  assert.throws(() => deploymentConfig(hostedEnvironment('staging', { DB_HOST: 'localhost' })), /base local/);
  assert.throws(() => deploymentConfig(hostedEnvironment('staging', { RATE_LIMIT_STORE: 'memory' })), /exige RATE_LIMIT_STORE=redis/);
  assert.throws(() => deploymentConfig(hostedEnvironment('staging', { RATE_LIMIT_REDIS_URL: '' })), /RATE_LIMIT_REDIS_URL/);
  assert.throws(() => deploymentConfig(hostedEnvironment('staging', {
    RATE_LIMIT_REDIS_URL: 'rediss://redis.staging.internal:6380'
  })), /credencial robusta/);
  assert.throws(() => deploymentConfig(hostedEnvironment('staging', {
    PAYMENT_RECEIPT_STORAGE_DIR: path.join(ROOT, 'private')
  })), /fuera del repositorio/);
  assert.throws(() => deploymentConfig(hostedEnvironment('staging', { EMAIL_DELIVERY_MODE: 'external' })), /disabled/);
  assert.throws(() => sessionSecret({ APP_ENV: 'staging', SESSION_SECRET: 'a'.repeat(64) }), /aleatorio/);
  assert.doesNotThrow(() => sessionSecret({ APP_ENV: 'staging', SESSION_SECRET: STRONG_SECRET }));
  assert.throws(() => buildDatabaseOptions({
    ...hostedEnvironment('staging'),
    DB_PORT: '3306',
    DB_USER: 'synthetic',
    DB_PASSWORD: 'synthetic',
    DB_SSL_ENABLED: 'false'
  }), /DB_SSL_ENABLED/);
  assert.throws(() => assertLocalDelivery({ APP_ENV: 'staging' }), /no esta disponible/);
}

function testProxyContract() {
  assert.deepStrictEqual(parseProxyCidrs('10.0.0.0/8,2001:db8::/64'), ['10.0.0.0/8', '2001:db8::/64']);
  for (const invalid of ['true', '1', '0.0.0.0/0', '::/0', '10.0.0.0/8,10.0.0.0/8']) {
    assert.throws(() => parseProxyCidrs(invalid));
  }
}

async function forwardedIp(trustProxy) {
  const app = express();
  app.set('trust proxy', trustProxy);
  app.get('/ip', (req, res) => res.json({ ip: req.ip }));
  const server = await new Promise((resolve, reject) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
    listener.once('error', reject);
  });
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/ip`, {
      headers: { 'X-Forwarded-For': '198.51.100.77' }
    });
    return (await response.json()).ip;
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

async function testForwardedHeaders() {
  assert.notStrictEqual(await forwardedIp(false), '198.51.100.77');
  assert.notStrictEqual(await forwardedIp(['10.40.0.0/24']), '198.51.100.77');
}

async function testDistributedStoreWithoutNetwork() {
  let unexpectedClientCreation = false;
  const memory = createRateLimitStoreBackend({ type: 'memory' }, {
    createClientImpl: () => { unexpectedClientCreation = true; }
  });
  await memory.ready();
  assert.strictEqual(memory.distributed, false);
  assert.strictEqual(unexpectedClientCreation, false);

  const events = [];
  const client = {
    isOpen: false,
    isReady: false,
    on() {},
    async connect() { this.isOpen = true; this.isReady = true; events.push('connect'); },
    async ping() { events.push('ping'); return 'PONG'; },
    async sendCommand(args) { events.push(['command', ...args]); return 1; },
    async quit() { this.isOpen = false; this.isReady = false; events.push('quit'); }
  };
  class FakeStore {
    constructor(options) { this.options = options; }
  }
  const backend = createRedisBackend({
    url: 'rediss://default:RedisSynthetic_2026!9qL4v@redis.staging.internal:6380',
    prefix: 'tienda:staging:'
  }, {
    createClientImpl: () => client,
    RedisStoreClass: FakeStore
  });
  const loginStore = backend.storeFor('login-ip');
  const apiStore = backend.storeFor('api-general');
  assert.notStrictEqual(loginStore, apiStore);
  assert.strictEqual(loginStore.options.prefix, 'tienda:staging:login-ip:');
  assert.strictEqual(apiStore.options.prefix, 'tienda:staging:api-general:');
  await loginStore.options.sendCommand('INCR', 'key');
  await backend.ready();
  assert.strictEqual(events.filter((entry) => entry === 'connect').length, 1);
  assert.deepStrictEqual(await backend.health(), { status: 'ok' });
  await backend.close();
  assert(events.includes('quit'));
}

function healthPool() {
  return {
    async query({ sql }) {
      if (/SELECT 1/.test(sql)) return [[{ ok: 1 }], []];
      return [[{ nombre: '001_test.sql' }], []];
    }
  };
}

async function testReadinessDependency() {
  const healthy = createOperationalHealthService({
    pool: healthPool(),
    expectedMigrations: ['001_test.sql'],
    dependencyHealth: async () => ({ status: 'ok' }),
    softLimitMs: 50,
    timeoutMs: 200,
    cacheMs: 0
  });
  assert.deepStrictEqual((await healthy.readiness()).checks, {
    database: 'ok', migrations: 'ok', rateLimitStore: 'ok'
  });

  const unavailable = createOperationalHealthService({
    pool: healthPool(),
    expectedMigrations: ['001_test.sql'],
    dependencyHealth: async () => { throw new Error('synthetic redis detail'); },
    softLimitMs: 50,
    timeoutMs: 200,
    cacheMs: 0
  });
  const result = await unavailable.readiness();
  assert.strictEqual(result.status, 'unhealthy');
  assert.strictEqual(result.reason, 'RATE_LIMIT_STORE_UNAVAILABLE');
  assert.strictEqual(result.checks.rateLimitStore, 'unavailable');

  const privateStorageFailure = createOperationalHealthService({
    pool: healthPool(),
    expectedMigrations: ['001_test.sql'],
    dependencyChecks: [
      { name: 'rateLimitStore', check: async () => ({ status: 'ok' }) },
      { name: 'privateStorage', check: async () => { throw new Error('synthetic path'); } }
    ],
    softLimitMs: 50,
    timeoutMs: 200,
    cacheMs: 0
  });
  const privateResult = await privateStorageFailure.readiness();
  assert.strictEqual(privateResult.reason, 'PRIVATE_STORAGE_UNAVAILABLE');
  assert.strictEqual(privateResult.checks.rateLimitStore, 'ok');
  assert.strictEqual(privateResult.checks.privateStorage, 'unavailable');

  const timeout = createOperationalHealthService({
    pool: healthPool(),
    expectedMigrations: ['001_test.sql'],
    dependencyHealth: () => new Promise(() => {}),
    softLimitMs: 5,
    timeoutMs: 20,
    cacheMs: 0
  });
  assert.strictEqual((await timeout.readiness()).reason, 'RATE_LIMIT_STORE_TIMEOUT');
}

function testFailFastDoesNotLeak() {
  const environment = {
    ...process.env,
    ...hostedEnvironment('staging'),
    DB_PASSWORD: OUTPUT_SENTINEL,
    TRUST_PROXY_CIDRS: ''
  };
  const probe = spawnSync(process.execPath, ['-e', [
    "require('./config/deployment').deploymentConfig(process.env);"
  ].join('')], {
    cwd: ROOT,
    env: environment,
    encoding: 'utf8'
  });
  const output = `${probe.stdout || ''}\n${probe.stderr || ''}`;
  assert.notStrictEqual(probe.status, 0);
  assert.match(output, /TRUST_PROXY_CIDRS/);
  assert(!output.includes(OUTPUT_SENTINEL));
  assert(!output.includes(environment.RATE_LIMIT_REDIS_URL));
}

async function main() {
  testEnvironmentContracts();
  testProxyContract();
  await testForwardedHeaders();
  await testDistributedStoreWithoutNetwork();
  await testReadinessDependency();
  testFailFastDoesNotLeak();
  console.log(JSON.stringify({
    resultado: 'ok',
    entornos: ['local', 'ci', 'staging', 'production'],
    redisRealUsado: false,
    mysqlRealUsado: false,
    conexionesRemotas: 0,
    procesosResiduales: 0
  }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
