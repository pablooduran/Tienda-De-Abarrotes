const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { webSecurityConfig } = require('../config/web-security');
const {
  createOperationalEventDispatcher,
  sanitizeOperationalEvent
} = require('../services/operational-event-dispatcher');
const {
  createOperationalMonitor,
  createOperationalStateTracker,
  diagnosticObservations,
  readinessObservations
} = require('../services/operational-state-tracker');
const { createGracefulShutdown } = require('../services/server-lifecycle-service');
const {
  EXIT_CODES,
  publicSummary,
  runOperationalCheck,
  validateCheckEnvironment
} = require('./check-operational-health');

const ROOT = path.join(__dirname, '..');
const SECRET_VALUES = [
  'super-secret-password',
  'C:\\private\\backups\\real.sql',
  'real-backup.sql',
  'a'.repeat(64),
  'db.internal',
  'tienda_produccion',
  'usuario_mysql',
  'SELECT * FROM administrador',
  'sqlMessage'
];

function loggerCapture() {
  const entries = [];
  return {
    entries,
    error: (event, context) => entries.push({ level: 'error', event, context }),
    warn: (event, context) => entries.push({ level: 'warn', event, context }),
    info: (event, context) => entries.push({ level: 'info', event, context })
  };
}

function trackerFixture(options = {}) {
  let now = 0;
  const events = [];
  const tracker = createOperationalStateTracker({
    dispatch: (event) => {
      events.push(event);
      return event;
    },
    clock: () => new Date(now),
    warningReminderMs: 43200000,
    errorReminderMs: 1800000,
    criticalReminderMs: 900000,
    ...options
  });
  return {
    events,
    tracker,
    setNow(value) {
      now = value;
    }
  };
}

function testTransitions() {
  const fixture = trackerFixture();
  const observe = (status, code, extra = {}) => fixture.tracker.observe({
    component: 'database',
    status,
    code,
    ...extra
  });

  assert.strictEqual(observe('healthy', 'DATABASE_OK').event, 'operational_state_initialized');
  assert.strictEqual(observe('healthy', 'DATABASE_OK'), null);

  const degraded = observe('degraded', 'DATABASE_SLOW');
  assert.strictEqual(degraded.event, 'operational_component_degraded');
  assert.strictEqual(degraded.severity, 'warn');
  assert.strictEqual(observe('degraded', 'DATABASE_SLOW'), null);

  const changedCause = observe('degraded', 'DATABASE_QUEUE_SLOW');
  assert.strictEqual(changedCause.event, 'operational_state_changed');
  assert.strictEqual(changedCause.suppressedCount, 1);

  const escalated = observe('unhealthy', 'DATABASE_UNAVAILABLE');
  assert.strictEqual(escalated.event, 'operational_component_escalated');
  assert.strictEqual(escalated.severity, 'critical');
  assert.strictEqual(observe('unhealthy', 'DATABASE_UNAVAILABLE'), null);

  const recovered = observe('healthy', 'DATABASE_OK');
  assert.strictEqual(recovered.event, 'operational_component_recovered');
  assert.strictEqual(recovered.suppressedCount, 1);
  const failedDirectly = observe('unhealthy', 'DATABASE_TIMEOUT');
  assert.strictEqual(failedDirectly.event, 'operational_component_failed');
  const returnedToDegraded = observe('degraded', 'DATABASE_SLOW');
  assert.strictEqual(returnedToDegraded.event, 'operational_component_degraded');

  const severityFixture = trackerFixture();
  severityFixture.tracker.observe({
    component: 'backup',
    status: 'unhealthy',
    code: 'BACKUP_TOO_OLD',
    severity: 'error'
  });
  const severityEscalated = severityFixture.tracker.observe({
    component: 'backup',
    status: 'unhealthy',
    code: 'BACKUP_TOO_OLD',
    severity: 'critical'
  });
  assert.strictEqual(severityEscalated.event, 'operational_component_escalated');
  assert.strictEqual(severityEscalated.severity, 'critical');

  const readinessFixture = trackerFixture();
  readinessFixture.tracker.observe({
    component: 'readiness',
    status: 'healthy',
    code: 'READINESS_OK'
  });
  const failed = readinessFixture.tracker.observe({
    component: 'readiness',
    status: 'unhealthy',
    code: 'DATABASE_TIMEOUT'
  });
  assert.strictEqual(failed.event, 'operational_check_failed');
  const checkRecovered = readinessFixture.tracker.observe({
    component: 'readiness',
    status: 'healthy',
    code: 'READINESS_OK'
  });
  assert.strictEqual(checkRecovered.event, 'operational_check_recovered');

  const directRecovery = trackerFixture();
  directRecovery.tracker.observe({
    component: 'backup',
    status: 'healthy',
    code: 'BACKUP_OK'
  });
  directRecovery.tracker.observe({
    component: 'backup',
    status: 'degraded',
    code: 'BACKUP_STALE'
  });
  assert.strictEqual(directRecovery.tracker.observe({
    component: 'backup',
    status: 'healthy',
    code: 'BACKUP_OK'
  }).event, 'operational_component_recovered');
}

function testCooldowns() {
  const warning = trackerFixture();
  warning.tracker.observe({ component: 'backup', status: 'degraded', code: 'BACKUP_STALE' });
  assert.strictEqual(warning.tracker.observe({
    component: 'backup', status: 'degraded', code: 'BACKUP_STALE'
  }), null);
  warning.setNow(43199999);
  assert.strictEqual(warning.tracker.observe({
    component: 'backup', status: 'degraded', code: 'BACKUP_STALE'
  }), null);
  warning.setNow(43200000);
  const warningReminder = warning.tracker.observe({
    component: 'backup', status: 'degraded', code: 'BACKUP_STALE'
  });
  assert.strictEqual(warningReminder.event, 'operational_check_failed');
  assert.strictEqual(warningReminder.suppressedCount, 2);
  assert.strictEqual(warningReminder.occurrenceCount, 4);

  const error = trackerFixture();
  error.tracker.observe({ component: 'database', status: 'unhealthy', code: 'DATABASE_UNAVAILABLE' });
  error.tracker.observe({ component: 'database', status: 'unhealthy', code: 'DATABASE_UNAVAILABLE' });
  error.setNow(1800000);
  const errorReminder = error.tracker.observe({
    component: 'database', status: 'unhealthy', code: 'DATABASE_UNAVAILABLE'
  });
  assert.strictEqual(errorReminder.event, 'operational_check_failed');
  assert.strictEqual(errorReminder.suppressedCount, 1);

  const critical = trackerFixture();
  critical.tracker.observe({
    component: 'gracefulShutdown',
    status: 'unhealthy',
    code: 'SHUTDOWN_TIMEOUT',
    severity: 'critical'
  });
  critical.tracker.observe({
    component: 'gracefulShutdown',
    status: 'unhealthy',
    code: 'SHUTDOWN_TIMEOUT',
    severity: 'critical'
  });
  critical.setNow(900000);
  const criticalReminder = critical.tracker.observe({
    component: 'gracefulShutdown',
    status: 'unhealthy',
    code: 'SHUTDOWN_TIMEOUT',
    severity: 'critical'
  });
  assert.strictEqual(criticalReminder.event, 'operational_check_failed');
  assert.strictEqual(criticalReminder.severity, 'critical');
}

async function testDispatcherSafety() {
  const logger = loggerCapture();
  const scheduled = [];
  const dispatcher = createOperationalEventDispatcher({
    logger,
    adapters: [
      () => {
        throw new Error(SECRET_VALUES.join(' '));
      }
    ],
    schedule: (work) => scheduled.push(work)
  });
  const event = dispatcher.dispatch({
    event: 'operational_component_failed',
    component: 'database',
    previousStatus: 'healthy',
    currentStatus: 'unhealthy',
    code: 'DATABASE_UNAVAILABLE',
    severity: 'error',
    occurrenceCount: 1,
    suppressedCount: 0,
    requestId: 'request-safe-1',
    path: SECRET_VALUES[1],
    fileName: SECRET_VALUES[2],
    hash: SECRET_VALUES[3],
    host: SECRET_VALUES[4],
    database: SECRET_VALUES[5],
    user: SECRET_VALUES[6],
    sql: SECRET_VALUES[7],
    sqlMessage: SECRET_VALUES[8]
  });
  assert.deepStrictEqual(Object.keys(event).sort(), [
    'code', 'component', 'currentStatus', 'event', 'level', 'occurrenceCount',
    'previousStatus', 'requestId', 'severity', 'suppressedCount', 'timeZone', 'timestamp'
  ].sort());
  assert.strictEqual(scheduled.length, 1);
  scheduled[0]();
  await new Promise((resolve) => setImmediate(resolve));
  assert(logger.entries.some((entry) => entry.event === 'operational_event_dispatch_failed'));
  const serialized = JSON.stringify(logger.entries);
  for (const secret of SECRET_VALUES) assert(!serialized.includes(secret));

  const sanitized = sanitizeOperationalEvent({
    event: 'evento-inventado',
    component: SECRET_VALUES[1],
    code: SECRET_VALUES[7],
    currentStatus: 'inventado'
  });
  assert.strictEqual(sanitized.component, 'application');
  assert.strictEqual(sanitized.code, 'OPERATIONAL_STATUS_UNKNOWN');
  assert.strictEqual(sanitized.currentStatus, 'unknown');

  const schedulerLogger = loggerCapture();
  const schedulerFailure = createOperationalEventDispatcher({
    logger: schedulerLogger,
    adapters: [() => null],
    schedule: () => {
      throw new Error(SECRET_VALUES[0]);
    }
  });
  assert.doesNotThrow(() => schedulerFailure.dispatch({
    event: 'operational_component_failed',
    component: 'database',
    currentStatus: 'unhealthy',
    code: 'DATABASE_UNAVAILABLE',
    severity: 'error'
  }));
  assert(schedulerLogger.entries.some((entry) => entry.event === 'operational_event_dispatch_failed'));
  assert(!JSON.stringify(schedulerLogger.entries).includes(SECRET_VALUES[0]));
}

function testMappingsAndMonitor() {
  const healthy = readinessObservations({
    status: 'healthy',
    checks: { database: 'ok', migrations: 'ok' },
    reason: null,
    durationMs: 4
  }, 'request-1');
  assert.deepStrictEqual(healthy.map((item) => item.status), ['healthy', 'healthy', 'healthy']);

  const slow = readinessObservations({
    status: 'degraded',
    checks: { database: 'slow', migrations: 'ok' },
    reason: 'DATABASE_SLOW',
    durationMs: 400
  });
  assert.strictEqual(slow[1].status, 'degraded');

  const unavailable = readinessObservations({
    status: 'unhealthy',
    checks: { database: 'unavailable', migrations: 'unavailable' },
    reason: 'DATABASE_UNAVAILABLE'
  });
  assert.deepStrictEqual(unavailable.map((item) => item.status), [
    'unhealthy', 'unhealthy', 'unknown'
  ]);
  assert.strictEqual(unavailable[2].code, 'MIGRATIONS_NOT_CHECKED');

  for (const [code, expected] of [
    ['BACKUP_OK', 'healthy'],
    ['BACKUP_STALE', 'degraded'],
    ['BACKUP_TOO_OLD', 'unhealthy'],
    ['BACKUP_MISSING', 'unhealthy'],
    ['BACKUP_CHECKSUM_MISMATCH', 'unhealthy']
  ]) {
    const observations = diagnosticObservations({
      status: 'degraded',
      checks: {
        database: { status: 'ok' },
        migrations: { status: 'ok' },
        backup: {
          status: expected === 'healthy' ? 'ok' : expected === 'degraded' ? 'warning' : 'error',
          code
        }
      }
    });
    assert.strictEqual(observations.find((item) => item.component === 'backup').status, expected);
  }

  const logger = loggerCapture();
  const dispatcher = createOperationalEventDispatcher({ logger });
  const tracker = createOperationalStateTracker({ dispatch: dispatcher.dispatch });
  const monitor = createOperationalMonitor({ tracker, dispatcher });
  assert.doesNotThrow(() => monitor.observeReadiness({
    status: 'healthy',
    checks: { database: 'ok', migrations: 'ok' },
    reason: null,
    durationMs: 2
  }, 'request-safe'));
  assert(logger.entries.some((entry) => entry.context.component === 'readiness'));
}

function lifecycleFixture({ failClose = false, timeout = false } = {}) {
  const logger = loggerCapture();
  const events = [];
  const exits = [];
  const server = {
    listening: true,
    close(callback) {
      if (timeout) return;
      callback(failClose ? new Error('Fallo privado') : null);
    },
    closeAllConnections() {
      events.push('forced-close');
    }
  };
  const pool = { end: async () => events.push('pool-close') };
  const sessionStore = { close: async () => events.push('store-close') };
  const dispatcher = createOperationalEventDispatcher({ logger });
  const tracker = createOperationalStateTracker({ dispatch: dispatcher.dispatch });
  const monitor = createOperationalMonitor({ tracker, dispatcher });
  const timers = timeout
    ? {
      setTimeout: (callback) => {
        queueMicrotask(callback);
        return 1;
      },
      clearTimeout() {}
    }
    : { setTimeout, clearTimeout };
  const shutdown = createGracefulShutdown({
    server,
    pool,
    sessionStore,
    logger,
    monitor,
    timeoutMs: 10,
    exit: (code) => exits.push(code),
    timers
  });
  return { events, exits, logger, shutdown };
}

async function testLifecycleEvents() {
  const completed = lifecycleFixture();
  const first = completed.shutdown('SIGTERM');
  const second = completed.shutdown('SIGINT');
  assert.strictEqual(first, second, 'El cierre debe seguir siendo idempotente.');
  assert.strictEqual((await first).status, 'completed');
  assert.deepStrictEqual(completed.exits, [0]);
  assert(completed.logger.entries.some((entry) => entry.event === 'graceful_shutdown_started'));
  assert(completed.logger.entries.some((entry) => entry.event === 'graceful_shutdown_completed'));

  const failed = lifecycleFixture({ failClose: true });
  assert.strictEqual((await failed.shutdown('SIGTERM')).status, 'failed');
  assert(failed.logger.entries.some((entry) => entry.event === 'graceful_shutdown_failed'
    && entry.context.code === 'SHUTDOWN_FAILED'));

  const timedOut = lifecycleFixture({ timeout: true });
  assert.strictEqual((await timedOut.shutdown('SIGTERM')).status, 'timeout');
  assert(timedOut.logger.entries.some((entry) => entry.event === 'graceful_shutdown_failed'
    && entry.context.code === 'SHUTDOWN_TIMEOUT'
    && entry.context.severity === 'critical'));
}

async function testOperationalChecker() {
  const diagnostic = (status) => ({
    diagnose: async () => ({
      status,
      checks: {
        app: { status: 'ok' },
        database: { status: status === 'unhealthy' ? 'error' : 'ok' },
        migrations: { status: status === 'unhealthy' ? 'error' : 'ok' },
        backup: {
          status: status === 'healthy' ? 'ok' : 'error',
          code: status === 'healthy' ? 'BACKUP_OK' : 'BACKUP_MISSING',
          fileName: SECRET_VALUES[2],
          sha256: SECRET_VALUES[3]
        }
      },
      checkedAt: '2026-07-24T16:00:00.000Z',
      durationMs: 4,
      host: SECRET_VALUES[4],
      sql: SECRET_VALUES[7]
    })
  });
  for (const [status, exitCode] of [
    ['healthy', EXIT_CODES.healthy],
    ['degraded', EXIT_CODES.degraded],
    ['unhealthy', EXIT_CODES.unhealthy]
  ]) {
    const output = [];
    const result = await runOperationalCheck({
      environment: { APP_ENV: 'local' },
      diagnosticService: diagnostic(status),
      write: (value) => output.push(value)
    });
    assert.strictEqual(result, exitCode);
    const serialized = JSON.stringify(output);
    for (const secret of SECRET_VALUES) assert(!serialized.includes(secret));
  }
  assert.throws(() => validateCheckEnvironment({}), /APP_ENV/);
  assert.throws(() => validateCheckEnvironment({ APP_ENV: 'production' }), /solo esta habilitado/);
  assert.throws(() => validateCheckEnvironment({ APP_ENV: 'test' }), /solo esta habilitado/);
  assert.strictEqual(validateCheckEnvironment({ APP_ENV: 'local' }), 'local');
  const safe = publicSummary((await diagnostic('healthy').diagnose()));
  assert.deepStrictEqual(Object.keys(safe.checks).sort(), [
    'application', 'backup', 'database', 'migrations'
  ]);
}

function testConfigurationAndStaticSafety() {
  const defaults = webSecurityConfig({ APP_ENV: 'test' });
  assert.deepStrictEqual(defaults.operationalMonitoring, {
    warningReminderMs: 43200000,
    errorReminderMs: 1800000,
    criticalReminderMs: 900000
  });
  for (const [name, value] of [
    ['MONITOR_WARNING_REMINDER_MS', '-1'],
    ['MONITOR_ERROR_REMINDER_MS', 'NaN'],
    ['MONITOR_CRITICAL_REMINDER_MS', '999999999999']
  ]) {
    assert.throws(() => webSecurityConfig({ APP_ENV: 'test', [name]: value }), /debe ser un entero/);
  }

  const sources = [
    'services/operational-state-tracker.js',
    'services/operational-event-dispatcher.js',
    'scripts/check-operational-health.js'
  ].map((file) => fs.readFileSync(path.join(ROOT, file), 'utf8')).join('\n');
  assert(!/\b(?:writeFile|appendFile|mkdir|chmod|rename|unlink|rmSync|spawn|execFile|mysqldump)\b/.test(sources));
  assert(!/\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE)\b/.test(sources));
  assert(!/\bsetInterval\b/.test(sources));
  assert(!/https?:\/\/(?!localhost|127\.0\.0\.1)/.test(sources));
}

async function main() {
  testTransitions();
  testCooldowns();
  await testDispatcherSafety();
  testMappingsAndMonitor();
  await testLifecycleEvents();
  await testOperationalChecker();
  testConfigurationAndStaticSafety();
  console.log(JSON.stringify({
    resultado: 'ok',
    transiciones: 11,
    cooldowns: {
      warningMs: 43200000,
      errorMs: 1800000,
      criticalMs: 900000
    },
    proveedoresExternos: 0,
    procesosExternos: 0,
    mysqlRealUsado: false,
    escriturasBaseDatos: 0,
    codigosSalida: EXIT_CODES
  }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
