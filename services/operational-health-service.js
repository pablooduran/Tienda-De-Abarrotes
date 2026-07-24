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

function publicResult(status, checks, durationMs, checkedAt, reason = null) {
  return Object.freeze({
    status,
    checks: Object.freeze(checks),
    durationMs: Number(durationMs.toFixed(1)),
    checkedAt,
    reason
  });
}

function createOperationalHealthService(options) {
  const {
    pool,
    expectedMigrations = loadExpectedMigrations(),
    softLimitMs = 300,
    timeoutMs = 1500,
    cacheMs = 4000,
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
    let migrationRows;
    try {
      const work = (async () => {
        await dependencyQuery(pool, DATABASE_QUERY, timeoutMs, 'database');
        databasePassed = true;
        migrationRows = await dependencyQuery(pool, MIGRATIONS_QUERY, timeoutMs, 'migrations');
      })();
      await withTimeout(work, timeoutMs, timers);
    } catch (error) {
      const durationMs = monotonicNow() - startedAt;
      const checkedAt = clock().toISOString();
      if (error instanceof HealthTimeout) {
        return publicResult('unhealthy', {
          database: databasePassed ? 'ok' : 'unavailable',
          migrations: 'unavailable'
        }, durationMs, checkedAt, databasePassed ? 'MIGRATIONS_TIMEOUT' : 'DATABASE_TIMEOUT');
      }
      if (error instanceof DependencyFailure) {
        return publicResult('unhealthy', {
          database: error.component === 'database' ? 'unavailable' : 'ok',
          migrations: 'unavailable'
        }, durationMs, checkedAt, error.component === 'database'
          ? 'DATABASE_UNAVAILABLE'
          : 'MIGRATIONS_UNAVAILABLE');
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
        migrations: 'error'
      }, durationMs, checkedAt, 'MIGRATIONS_INCOMPLETE');
    }
    if (durationMs > softLimitMs) {
      return publicResult('degraded', {
        database: 'slow',
        migrations: 'ok'
      }, durationMs, checkedAt, 'DATABASE_SLOW');
    }
    return publicResult('healthy', {
      database: 'ok',
      migrations: 'ok'
    }, durationMs, checkedAt);
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

module.exports = {
  DATABASE_QUERY,
  MIGRATIONS_QUERY,
  createOperationalHealthService,
  loadExpectedMigrations
};
