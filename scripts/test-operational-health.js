const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const express = require('express');
const { buildDatabaseOptions } = require('../config/database-options');
const { createErrorHandler } = require('../middleware/error-handler');
const { createRateLimiters } = require('../middleware/rate-limiters');
const { requestContext } = require('../middleware/request-context');
const { noStoreSensitiveResponses } = require('../middleware/request-security');
const { createHealthRouter } = require('../routes/health');
const {
  DATABASE_QUERY,
  MIGRATIONS_QUERY,
  createOperationalHealthService,
  loadExpectedMigrations
} = require('../services/operational-health-service');
const {
  announceInitialReadiness,
  createGracefulShutdown,
  installShutdownHandlers
} = require('../services/server-lifecycle-service');

const ROOT = path.join(__dirname, '..');
const EXPECTED = ['001_test.sql', '002_test.sql'];
const SECRET = 'mysql-secret-that-must-not-leak';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function loggerCapture() {
  const entries = [];
  return {
    entries,
    error: (event, context) => entries.push({ level: 'error', event, context }),
    warn: (event, context) => entries.push({ level: 'warn', event, context }),
    info: (event, context) => entries.push({ level: 'info', event, context })
  };
}

function fakePool(handler) {
  const queries = [];
  return {
    queries,
    async query(options) {
      const sql = typeof options === 'string' ? options : options.sql;
      queries.push(sql);
      return handler(sql, queries.length);
    }
  };
}

function healthyPool(options = {}) {
  const migrations = options.migrations || EXPECTED;
  const delayMs = options.delayMs || 0;
  return fakePool(async (sql) => {
    if (delayMs) await sleep(delayMs);
    if (sql === DATABASE_QUERY) return [[{ ok: 1 }], []];
    if (sql === MIGRATIONS_QUERY) return [migrations.map((nombre) => ({ nombre })), []];
    throw new Error('Consulta inesperada.');
  });
}

function service(pool, overrides = {}) {
  return createOperationalHealthService({
    pool,
    expectedMigrations: EXPECTED,
    softLimitMs: 50,
    timeoutMs: 200,
    cacheMs: 100,
    ...overrides
  });
}

function rateConfig(healthMax = 100) {
  return {
    enabled: true,
    windowMs: 60000,
    apiMax: 100,
    loginIpMax: 100,
    loginIdentityMax: 100,
    authMax: 100,
    adminMax: 100,
    exportMax: 100,
    whatsappMax: 100,
    healthMax
  };
}

async function startFixture(healthService, { healthMax = 100, logger = loggerCapture() } = {}) {
  const app = express();
  const limiters = createRateLimiters(rateConfig(healthMax));
  app.use(requestContext(logger));
  app.use(noStoreSensitiveResponses);
  app.use('/health', limiters.health, createHealthRouter({ healthService, logger }));
  app.use(createErrorHandler({ logger, production: true }));
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  const address = server.address();
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    logger,
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  };
}

async function body(response) {
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function testMigrationDiscovery() {
  const directory = path.join(ROOT, 'database', 'migrations');
  const expected = fs.readdirSync(directory)
    .filter((name) => name.toLowerCase().endsWith('.sql'))
    .sort((left, right) => left.localeCompare(right));
  assert.deepStrictEqual([...loadExpectedMigrations(directory)], expected);
  assert(expected.length > 0);
}

async function testServiceStates() {
  const livePool = healthyPool();
  const health = service(livePool);
  assert.strictEqual(health.liveness().status, 'healthy');
  assert.strictEqual(livePool.queries.length, 0, 'Liveness no debe consultar MySQL.');
  const ready = await health.readiness();
  assert.strictEqual(ready.status, 'healthy');
  assert.deepStrictEqual(ready.checks, { database: 'ok', migrations: 'ok' });

  const slow = await service(healthyPool({ delayMs: 35 }), {
    softLimitMs: 20,
    timeoutMs: 200
  }).readiness();
  assert.strictEqual(slow.status, 'degraded');
  assert.strictEqual(slow.checks.database, 'slow');

  const databaseFailure = await service(fakePool(async () => {
    const error = new Error(`Conexion rechazada ${SECRET}`);
    error.code = 'NATIVE_DATABASE_SECRET';
    throw error;
  })).readiness();
  assert.strictEqual(databaseFailure.status, 'unhealthy');
  assert.strictEqual(databaseFailure.reason, 'DATABASE_UNAVAILABLE');

  const timeout = await service(fakePool(() => new Promise(() => {})), {
    softLimitMs: 5,
    timeoutMs: 20
  }).readiness();
  assert.strictEqual(timeout.status, 'unhealthy');
  assert.strictEqual(timeout.reason, 'DATABASE_TIMEOUT');

  const missingTablePool = fakePool(async (sql) => {
    if (sql === DATABASE_QUERY) return [[{ ok: 1 }], []];
    throw new Error('ER_NO_SUCH_TABLE schema_migrations');
  });
  const missingTable = await service(missingTablePool).readiness();
  assert.strictEqual(missingTable.status, 'unhealthy');
  assert.strictEqual(missingTable.reason, 'MIGRATIONS_UNAVAILABLE');

  const incomplete = await service(healthyPool({ migrations: [EXPECTED[0]] })).readiness();
  assert.strictEqual(incomplete.status, 'unhealthy');
  assert.strictEqual(incomplete.reason, 'MIGRATIONS_INCOMPLETE');
}

async function testCacheDeduplicationAndRecovery() {
  let now = 0;
  const cachedPool = healthyPool();
  const cachedHealth = service(cachedPool, { monotonicNow: () => now });
  await cachedHealth.readiness();
  now = 50;
  await cachedHealth.readiness();
  assert.strictEqual(cachedPool.queries.length, 2, 'La segunda solicitud debe reutilizar cache.');
  now = 101;
  await cachedHealth.readiness();
  assert.strictEqual(cachedPool.queries.length, 4, 'La cache vencida debe volver a comprobar.');

  const delayedPool = healthyPool({ delayMs: 15 });
  const deduplicated = service(delayedPool);
  const [first, second] = await Promise.all([deduplicated.readiness(), deduplicated.readiness()]);
  assert.strictEqual(first, second);
  assert.strictEqual(delayedPool.queries.length, 2, 'Solicitudes simultaneas deben compartir comprobacion.');

  let available = false;
  let recoveryNow = 0;
  const recoveryPool = fakePool(async (sql) => {
    if (!available) throw new Error('DB temporalmente no disponible');
    if (sql === DATABASE_QUERY) return [[{ ok: 1 }], []];
    return [EXPECTED.map((nombre) => ({ nombre })), []];
  });
  const recovering = service(recoveryPool, { monotonicNow: () => recoveryNow });
  assert.strictEqual((await recovering.readiness()).status, 'unhealthy');
  available = true;
  recoveryNow = 101;
  assert.strictEqual((await recovering.readiness()).status, 'healthy');
}

async function testHttpContractsAndRateLimit() {
  const pool = healthyPool();
  const fixture = await startFixture(service(pool));
  try {
    const live = await fetch(`${fixture.baseUrl}/health/live`);
    const liveBody = await body(live);
    assert.strictEqual(live.status, 200);
    assert.strictEqual(liveBody.status, 'healthy');
    assert(live.headers.get('x-request-id'));
    assert.match(live.headers.get('cache-control') || '', /no-store/);
    assert.strictEqual(pool.queries.length, 0);

    const head = await fetch(`${fixture.baseUrl}/health/live`, { method: 'HEAD' });
    assert.strictEqual(head.status, 200);
    assert.strictEqual(await head.text(), '');
    assert(head.headers.get('x-request-id'));
    assert.match(head.headers.get('cache-control') || '', /no-store/);
    assert(!fixture.logger.entries.some((entry) => entry.event === 'http_request_completed'),
      'Liveness exitoso no debe generar ruido en logs.');

    const ready = await fetch(`${fixture.baseUrl}/health/ready`);
    const readyBody = await body(ready);
    assert.strictEqual(ready.status, 200);
    assert.strictEqual(readyBody.checks.migrations, 'ok');
    assert(readyBody.requestId);
    assert(!JSON.stringify(readyBody).includes(SECRET));

    const readyHead = await fetch(`${fixture.baseUrl}/health/ready`, { method: 'HEAD' });
    assert.strictEqual(readyHead.status, 200);
    assert.strictEqual(await readyHead.text(), '');
    assert(readyHead.headers.get('x-request-id'));
    assert.match(readyHead.headers.get('cache-control') || '', /no-store/);
  } finally {
    await fixture.close();
  }

  const failedLogger = loggerCapture();
  const failedFixture = await startFixture(service(fakePool(async () => {
    throw new Error(`sqlMessage host base usuario ${SECRET}`);
  })), { logger: failedLogger });
  try {
    const liveResponse = await fetch(`${failedFixture.baseUrl}/health/live`);
    assert.strictEqual(liveResponse.status, 200,
      'Express debe mantener liveness aunque MySQL no este disponible.');
    const response = await fetch(`${failedFixture.baseUrl}/health/ready`);
    const responseBody = await body(response);
    const serialized = JSON.stringify({ responseBody, logs: failedLogger.entries });
    assert.strictEqual(response.status, 503);
    assert.strictEqual(responseBody.status, 'unhealthy');
    assert.strictEqual(responseBody.checks.database, 'unavailable');
    assert(!/sqlMessage|host|usuario|NATIVE|mysql-secret/i.test(serialized));
  } finally {
    await failedFixture.close();
  }

  const limitedPool = healthyPool();
  const limitedFixture = await startFixture(service(limitedPool), { healthMax: 2 });
  try {
    assert.strictEqual((await fetch(`${limitedFixture.baseUrl}/health/live`)).status, 200);
    assert.strictEqual((await fetch(`${limitedFixture.baseUrl}/health/live`, { method: 'HEAD' })).status, 200);
    const rejected = await fetch(`${limitedFixture.baseUrl}/health/ready`);
    assert.strictEqual(rejected.status, 429);
    assert.strictEqual(limitedPool.queries.length, 0, 'El limitador debe rechazar antes de consultar MySQL.');
  } finally {
    await limitedFixture.close();
  }
}

async function testUnexpectedErrorsRemainGeneric() {
  const logger = loggerCapture();
  const malformed = service(fakePool(async () => ({ not: 'mysql2' })));
  const fixture = await startFixture(malformed, { logger });
  try {
    const response = await fetch(`${fixture.baseUrl}/health/ready`);
    const responseBody = await body(response);
    assert.strictEqual(response.status, 500);
    assert.strictEqual(responseBody.code, 'INTERNAL_ERROR');
    assert(!JSON.stringify(responseBody).includes('formato esperado'));
  } finally {
    await fixture.close();
  }
}

function lifecycleFixture({ neverClose = false } = {}) {
  const events = [];
  const exits = [];
  const server = {
    listening: true,
    closeCalls: 0,
    closeAllCalls: 0,
    close(callback) {
      this.closeCalls += 1;
      events.push('server-close');
      if (!neverClose) {
        this.listening = false;
        setImmediate(callback);
      }
    },
    closeAllConnections() {
      this.closeAllCalls += 1;
      events.push('server-force-close');
    }
  };
  const pool = {
    endCalls: 0,
    async end() {
      this.endCalls += 1;
      events.push('pool-end');
    }
  };
  const sessionStore = {
    closeCalls: 0,
    async close() {
      this.closeCalls += 1;
      events.push('session-store-close');
    }
  };
  const logger = loggerCapture();
  const shutdown = createGracefulShutdown({
    server,
    pool,
    sessionStore,
    logger,
    timeoutMs: neverClose ? 20 : 200,
    exit: (code) => exits.push(code)
  });
  return { events, exits, logger, pool, server, sessionStore, shutdown };
}

async function testLifecycle() {
  const normal = lifecycleFixture();
  const first = normal.shutdown('SIGTERM');
  const second = normal.shutdown('SIGINT');
  assert.strictEqual(first, second, 'El cierre debe ser idempotente.');
  const result = await first;
  assert.deepStrictEqual(result, { status: 'completed', exitCode: 0 });
  assert.deepStrictEqual(normal.events, ['server-close', 'session-store-close', 'pool-end']);
  assert.deepStrictEqual(normal.exits, [0]);
  assert.strictEqual(normal.server.closeCalls, 1);
  assert.strictEqual(normal.sessionStore.closeCalls, 1);
  assert.strictEqual(normal.pool.endCalls, 1);

  for (const signal of ['SIGTERM', 'SIGINT']) {
    const fixture = lifecycleFixture();
    const fakeProcess = new EventEmitter();
    const removeHandlers = installShutdownHandlers(fakeProcess, fixture.shutdown);
    fakeProcess.emit(signal);
    await sleep(10);
    assert.deepStrictEqual(fixture.exits, [0], `${signal} debe cerrar con codigo 0.`);
    removeHandlers();
  }

  const timedOut = lifecycleFixture({ neverClose: true });
  const timeoutResult = await timedOut.shutdown('SIGTERM');
  assert.deepStrictEqual(timeoutResult, { status: 'timeout', exitCode: 1 });
  assert.deepStrictEqual(timedOut.exits, [1]);
  assert.strictEqual(timedOut.server.closeAllCalls, 1);

  const readinessLogger = loggerCapture();
  const unavailable = { readiness: async () => ({
    status: 'unhealthy', durationMs: 20, reason: 'DATABASE_UNAVAILABLE'
  }) };
  await announceInitialReadiness(unavailable, readinessLogger);
  assert(readinessLogger.entries.some((entry) => entry.event === 'server_started_not_ready'));
}

function testConfigurationAndSources() {
  assert.throws(() => buildDatabaseOptions({ APP_ENV: 'local' }), /Faltan variables/);
  const serverSource = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  assert(!serverSource.includes("await pool.query('SELECT 1')"),
    'El arranque no debe esperar MySQL antes de escuchar.');
  assert(serverSource.indexOf("app.use('/health'") < serverSource.indexOf('express.urlencoded'),
    'Health debe montarse antes de los body parsers.');
  assert(serverSource.indexOf("app.use('/health'") < serverSource.indexOf('app.use(session('),
    'Health debe montarse antes de sesiones.');
  assert(serverSource.indexOf("app.use('/health'") < serverSource.indexOf('mutationProtection('),
    'Health debe montarse antes de CSRF.');
  assert(serverSource.includes('}, pool);'),
    'El store de sesiones debe reutilizar el pool central para permitir un cierre completo.');
}

async function main() {
  await testMigrationDiscovery();
  await testServiceStates();
  await testCacheDeduplicationAndRecovery();
  await testHttpContractsAndRateLimit();
  await testUnexpectedErrorsRemainGeneric();
  await testLifecycle();
  testConfigurationAndSources();

  const allQueries = [DATABASE_QUERY, MIGRATIONS_QUERY];
  assert(allQueries.every((sql) => /^\s*SELECT\b/i.test(sql)));
  assert(allQueries.every((sql) => !/\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE)\b/i.test(sql)));
  console.log(JSON.stringify({
    resultado: 'ok',
    mysqlRealUsado: false,
    conexionesRemotas: 0,
    escrituras: 0,
    migracionesDerivadasDeArchivos: true,
    cierreOrdenado: ['SIGTERM', 'SIGINT']
  }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
