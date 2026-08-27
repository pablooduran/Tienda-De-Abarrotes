const fs = require('fs');
const path = require('path');
const { performance } = require('perf_hooks');

const DATABASE_QUERY = 'SELECT 1 AS ok';
const MIGRATIONS_QUERY = 'SELECT nombre FROM schema_migrations ORDER BY nombre';

class DependencyFailure extends Error {
  constructor(component) {
    super(`La dependencia ${component} no esta disponible.`);
    this.name = 'DependencyFailure';
    this.component = component;
  }
}

class HealthTimeout extends Error {
  constructor() {
    super('La comprobacion de disponibilidad excedio el tiempo permitido.');
    this.name = 'HealthTimeout';
  }
}

function loadExpectedMigrations(directory = path.join(__dirname, '..', 'database', 'migrations')) {
  const migrations = fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.sql'))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
  if (!migrations.length || new Set(migrations.map((name) => name.toLowerCase())).size !== migrations.length) {
    throw new Error('No se pudo determinar un conjunto valido de migraciones esperadas.');
  }
  return Object.freeze(migrations);
}

function withTimeout(work, timeoutMs, timers) {
  let timeout;
  const deadline = new Promise((resolve, reject) => {
    timeout = timers.setTimeout(() => reject(new HealthTimeout()), timeoutMs);
  });
  return Promise.race([work, deadline]).finally(() => timers.clearTimeout(timeout));
}

async function dependencyQuery(pool, sql, timeoutMs, component) {
  let result;
  try {
    result = await pool.query({ sql, timeout: timeoutMs });
  } catch {
    throw new DependencyFailure(component);
  }
  if (!Array.isArray(result) || !Array.isArray(result[0])) {
    throw new Error(`La respuesta interna de ${component} no tiene el formato esperado.`);
  }
  return result[0];
}

function publicResult(status, checks, durationMs, checkedAt, reason = null, diagnostics = {}) {
  return Object.freeze({
    status,
    checks: Object.freeze(checks),
    durationMs: Number(durationMs.toFixed(1)),
    checkedAt,
    reason,
    diagnostics: Object.freeze(diagnostics)
  });
}

function dependencyCode(name, suffix) {
  const normalized = String(name).replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase();
  return `${normalized}_${suffix}`;
}

function createOperationalHealthService(options) {
  const {
    pool,
    expectedMigrations = loadExpectedMigrations(),
    softLimitMs = 300,
    timeoutMs = 1500,
    cacheMs = 4000,
    dependencyHealth = null,
    dependencyChecks = [],
    monotonicNow = () => performance.now(),
    clock = () => new Date(),
    timers = { setTimeout, clearTimeout }
  } = options || {};
  if (!pool || typeof pool.query !== 'function') throw new Error('El healthcheck requiere un pool MySQL.');
  if (!Array.isArray(expectedMigrations) || !expectedMigrations.length) {
    throw new Error('El healthcheck requiere migraciones esperadas.');
  }
  if (!(softLimitMs > 0 && timeoutMs > softLimitMs && cacheMs >= 0)) {
    throw new Error('Los tiempos del healthcheck no son validos.');
  }
  if (dependencyHealth !== null && typeof dependencyHealth !== 'function') {
    throw new Error('La dependencia adicional de readiness no es valida.');
  }
  if (!Array.isArray(dependencyChecks)) {
    throw new Error('Las dependencias de readiness no son validas.');
  }
  const dependencies = [
    ...(dependencyHealth ? [{ name: 'rateLimitStore', check: dependencyHealth }] : []),
    ...dependencyChecks
  ];
  for (const dependency of dependencies) {
    const declaredStatus = dependency?.status === undefined ? null : String(dependency.status);
    if (!/^[a-z][a-zA-Z0-9]{1,39}$/.test(String(dependency?.name || ''))
      || (declaredStatus !== null && declaredStatus !== 'disabled')
      || (declaredStatus !== 'disabled' && typeof dependency?.check !== 'function')) {
      throw new Error('Las dependencias de readiness no son validas.');
    }
  }
  if (new Set(dependencies.map(({ name }) => name)).size !== dependencies.length) {
    throw new Error('Las dependencias de readiness no pueden repetirse.');
  }

  const expected = new Set(expectedMigrations.map((name) => String(name).toLowerCase()));
  let cached = null;
  let inFlight = null;

  function liveness() {
    return Object.freeze({
      status: 'healthy',
      checks: Object.freeze({ app: 'ok' }),
      checkedAt: clock().toISOString()
    });
  }

  async function performReadiness() {
    const startedAt = monotonicNow();
    let databasePassed = false;
    let migrationsPassed = false;
    let slowComponent = null;
    const dependencyStates = Object.fromEntries(dependencies.map(({ name, status }) => [
      name,
      status === 'disabled' ? 'disabled' : 'unavailable'
    ]));
    let migrationRows;
    try {
      const work = (async () => {
        let componentStartedAt = monotonicNow();
        await dependencyQuery(pool, DATABASE_QUERY, timeoutMs, 'database');
        databasePassed = true;
        if (monotonicNow() - componentStartedAt > softLimitMs) slowComponent = 'database';
        componentStartedAt = monotonicNow();
        migrationRows = await dependencyQuery(pool, MIGRATIONS_QUERY, timeoutMs, 'migrations');
        migrationsPassed = true;
        if (!slowComponent && monotonicNow() - componentStartedAt > softLimitMs) slowComponent = 'migrations';
        for (const dependency of dependencies) {
          if (dependency.status === 'disabled') continue;
          try {
            componentStartedAt = monotonicNow();
            await dependency.check();
            dependencyStates[dependency.name] = 'ok';
            if (!slowComponent && monotonicNow() - componentStartedAt > softLimitMs) {
              slowComponent = dependency.name;
            }
          } catch {
            throw new DependencyFailure(dependency.name);
          }
        }
      })();
      await withTimeout(work, timeoutMs, timers);
    } catch (error) {
      const durationMs = monotonicNow() - startedAt;
      const checkedAt = clock().toISOString();
      if (error instanceof HealthTimeout) {
        return publicResult('unhealthy', {
          database: databasePassed ? 'ok' : 'unavailable',
          migrations: migrationsPassed ? 'ok' : 'unavailable',
          ...dependencyStates
        }, durationMs, checkedAt, !databasePassed
          ? 'DATABASE_TIMEOUT'
          : !migrationsPassed ? 'MIGRATIONS_TIMEOUT' : dependencyCode(
            Object.entries(dependencyStates).find(([, state]) => state !== 'ok')?.[0] || 'dependency',
            'TIMEOUT'
          ), {
          expectedMigrations: expected.size,
          appliedMigrations: null
        });
      }
      if (error instanceof DependencyFailure) {
        return publicResult('unhealthy', {
          database: error.component === 'database' ? 'unavailable' : 'ok',
          migrations: error.component === 'migrations' || error.component === 'database' ? 'unavailable' : 'ok',
          ...dependencyStates
        }, durationMs, checkedAt, error.component === 'database'
          ? 'DATABASE_UNAVAILABLE'
          : error.component === 'migrations'
            ? 'MIGRATIONS_UNAVAILABLE'
            : dependencyCode(error.component, 'UNAVAILABLE'), {
          expectedMigrations: expected.size,
          appliedMigrations: null
        });
      }
      throw error;
    }

    const applied = new Set(migrationRows.map((row) => String(row.nombre || '').toLowerCase()));
    const missingCount = [...expected].filter((name) => !applied.has(name)).length;
    const durationMs = monotonicNow() - startedAt;
    const checkedAt = clock().toISOString();
    if (missingCount) {
      return publicResult('unhealthy', {
        database: 'ok',
        migrations: 'error',
        ...dependencyStates
      }, durationMs, checkedAt, 'MIGRATIONS_INCOMPLETE', {
        expectedMigrations: expected.size,
        appliedMigrations: applied.size
      });
    }
    if (slowComponent) {
      const slowDependencies = Object.fromEntries(Object.entries(dependencyStates)
        .map(([name, status]) => [name, name === slowComponent ? 'slow' : status]));
      return publicResult('degraded', {
        database: slowComponent === 'database' ? 'slow' : 'ok',
        migrations: slowComponent === 'migrations' ? 'slow' : 'ok',
        ...slowDependencies
      }, durationMs, checkedAt, dependencyCode(slowComponent, 'SLOW'), {
        expectedMigrations: expected.size,
        appliedMigrations: applied.size
      });
    }
    return publicResult('healthy', {
      database: 'ok',
      migrations: 'ok',
      ...dependencyStates
    }, durationMs, checkedAt, null, {
      expectedMigrations: expected.size,
      appliedMigrations: applied.size
    });
  }

  function readiness({ bypassCache = false } = {}) {
    const now = monotonicNow();
    if (!bypassCache && cached && now < cached.expiresAt) return Promise.resolve(cached.result);
    if (inFlight) return inFlight;
    inFlight = performReadiness()
      .then((result) => {
        cached = { result, expiresAt: monotonicNow() + cacheMs };
        return result;
      })
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  }

  function clearCache() {
    cached = null;
  }

  return Object.freeze({
    clearCache,
    expectedMigrationCount: expected.size,
    liveness,
    readiness
  });
}

function createOperationalDiagnosticService(options = {}) {
  const {
    healthService,
    backupStatusService,
    clock = () => new Date(),
    monotonicNow = () => performance.now()
  } = options;
  if (!healthService || typeof healthService.readiness !== 'function'
    || !backupStatusService || typeof backupStatusService.status !== 'function') {
    throw new Error('El diagnostico operativo requiere los servicios de readiness y backup.');
  }

  async function diagnose() {
    const startedAt = monotonicNow();
    const [readiness, backup] = await Promise.all([
      healthService.readiness(),
      backupStatusService.status()
    ]);
    const unhealthy = readiness.status === 'unhealthy';
    const degraded = !unhealthy && (readiness.status === 'degraded' || backup.status !== 'ok');
    const databaseStatus = readiness.checks.database === 'ok'
      ? 'ok'
      : readiness.checks.database === 'slow' ? 'warning' : 'error';
    const migrationsStatus = readiness.checks.migrations === 'ok'
      ? 'ok'
      : readiness.checks.migrations === 'slow' ? 'warning' : 'error';
    const dependencyResults = Object.fromEntries(
      Object.entries(readiness.checks)
        .filter(([name]) => !['database', 'migrations'].includes(name))
        .map(([name, status]) => [name, Object.freeze({
          status: status === 'ok' ? 'ok' : status === 'slow' ? 'warning' : status === 'disabled' ? 'disabled' : 'error',
          ...(readiness.reason?.startsWith(`${dependencyCode(name, '')}`)
            ? { code: readiness.reason } : {})
        })])
    );
    const backupCheck = {
      status: backup.status,
      code: backup.code,
      durationMs: backup.durationMs
    };
    if (Number.isFinite(backup.ageHours)) backupCheck.ageHours = backup.ageHours;
    return Object.freeze({
      status: unhealthy ? 'unhealthy' : degraded ? 'degraded' : 'healthy',
      httpStatus: unhealthy ? 503 : 200,
      checks: Object.freeze({
        app: Object.freeze({ status: 'ok' }),
        database: Object.freeze({
          status: databaseStatus,
          durationMs: readiness.durationMs,
          ...(readiness.reason?.startsWith('DATABASE_') ? { code: readiness.reason } : {})
        }),
        migrations: Object.freeze({
          status: migrationsStatus,
          expectedCount: readiness.diagnostics.expectedMigrations,
          appliedCount: readiness.diagnostics.appliedMigrations,
          ...(readiness.reason?.startsWith('MIGRATIONS_') ? { code: readiness.reason } : {})
        }),
        ...dependencyResults,
        backup: Object.freeze(backupCheck)
      }),
      checkedAt: clock().toISOString(),
      durationMs: Number((monotonicNow() - startedAt).toFixed(1))
    });
  }

  return Object.freeze({ diagnose });
}

module.exports = {
  DATABASE_QUERY,
  MIGRATIONS_QUERY,
  createOperationalDiagnosticService,
  createOperationalHealthService,
  loadExpectedMigrations
};
