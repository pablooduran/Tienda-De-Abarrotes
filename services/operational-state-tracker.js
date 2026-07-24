const { BUSINESS_TIME_ZONE } = require('../config/database-options');

const COMPONENTS = new Set([
  'application',
  'readiness',
  'database',
  'migrations',
  'backup',
  'gracefulShutdown'
]);
const STATUSES = new Set(['healthy', 'degraded', 'unhealthy', 'unknown']);
const SEVERITIES = new Set(['info', 'warn', 'error', 'critical']);

function severityForStatus(status) {
  if (status === 'healthy' || status === 'unknown') return 'info';
  if (status === 'degraded') return 'warn';
  return 'error';
}

function levelForSeverity(severity) {
  if (severity === 'info') return 'info';
  if (severity === 'warn') return 'warn';
  return 'error';
}

function eventForTransition(component, previousStatus, currentStatus) {
  if (currentStatus === 'healthy' && ['degraded', 'unhealthy'].includes(previousStatus)) {
    return component === 'readiness'
      ? 'operational_check_recovered'
      : 'operational_component_recovered';
  }
  if (previousStatus === 'degraded' && currentStatus === 'unhealthy') {
    return 'operational_component_escalated';
  }
  if (currentStatus === 'degraded') return 'operational_component_degraded';
  if (currentStatus === 'unhealthy') {
    return component === 'readiness'
      ? 'operational_check_failed'
      : 'operational_component_failed';
  }
  return 'operational_state_changed';
}

function createOperationalStateTracker(options = {}) {
  const {
    dispatch,
    clock = () => new Date(),
    warningReminderMs = 43200000,
    errorReminderMs = 1800000,
    criticalReminderMs = 900000,
    stateStore = new Map()
  } = options;
  if (typeof dispatch !== 'function' || !(stateStore instanceof Map)) {
    throw new Error('El tracker operativo requiere dispatcher y almacenamiento Map.');
  }
  const reminders = {
    warn: warningReminderMs,
    error: errorReminderMs,
    critical: criticalReminderMs
  };
  if (Object.values(reminders).some((value) => !Number.isFinite(value) || value <= 0)) {
    throw new Error('Los cooldowns operativos no son validos.');
  }

  function emit(observation, previous, eventName, severity, suppressedCount, occurrenceCount) {
    return dispatch({
      timestamp: clock().toISOString(),
      level: eventName === 'operational_state_initialized' ? 'info' : levelForSeverity(severity),
      event: eventName,
      component: observation.component,
      previousStatus: previous?.status || 'unknown',
      currentStatus: observation.status,
      code: observation.code,
      severity: eventName === 'operational_state_initialized' ? 'info' : severity,
      durationMs: observation.durationMs,
      requestId: observation.requestId,
      occurrenceCount,
      suppressedCount,
      timeZone: BUSINESS_TIME_ZONE
    });
  }

  function observe(input = {}) {
    const component = COMPONENTS.has(input.component) ? input.component : 'application';
    const status = STATUSES.has(input.status) ? input.status : 'unknown';
    const code = /^[A-Z][A-Z0-9_]{0,79}$/.test(String(input.code || ''))
      ? String(input.code)
      : 'OPERATIONAL_STATUS_UNKNOWN';
    const severity = SEVERITIES.has(input.severity)
      ? input.severity
      : severityForStatus(status);
    const observation = {
      component,
      status,
      code,
      severity,
      durationMs: input.durationMs,
      requestId: input.requestId
    };
    const now = clock().getTime();
    const previous = stateStore.get(component);

    if (!previous) {
      const current = {
        status,
        code,
        severity,
        lastEmittedAt: now,
        occurrenceCount: 1,
        suppressedCount: 0
      };
      stateStore.set(component, current);
      return emit(observation, null, 'operational_state_initialized', 'info', 0, 1);
    }

    if (previous.status === status && previous.code === code && previous.severity === severity) {
      previous.occurrenceCount += 1;
      if (status === 'healthy' || status === 'unknown') return null;
      const reminderMs = reminders[severity] || reminders.error;
      if (now - previous.lastEmittedAt < reminderMs) {
        previous.suppressedCount += 1;
        return null;
      }
      const suppressedCount = previous.suppressedCount;
      previous.lastEmittedAt = now;
      previous.suppressedCount = 0;
      return emit(
        observation,
        previous,
        'operational_check_failed',
        severity,
        suppressedCount,
        previous.occurrenceCount
      );
    }

    const suppressedCount = previous.suppressedCount;
    const severityEscalated = previous.status === status
      && previous.code === code
      && previous.severity !== 'critical'
      && severity === 'critical';
    const eventName = severityEscalated
      ? 'operational_component_escalated'
      : previous.status === status
        ? 'operational_state_changed'
        : eventForTransition(component, previous.status, status);
    const eventSeverity = eventName === 'operational_component_escalated'
      ? 'critical'
      : severity;
    stateStore.set(component, {
      status,
      code,
      severity,
      lastEmittedAt: now,
      occurrenceCount: 1,
      suppressedCount: 0
    });
    return emit(observation, previous, eventName, eventSeverity, suppressedCount, 1);
  }

  function snapshot() {
    return new Map([...stateStore.entries()].map(([key, value]) => [key, { ...value }]));
  }

  return Object.freeze({ observe, snapshot });
}

function readinessObservations(result, requestId) {
  const reason = String(result?.reason || '');
  const databaseCheck = result?.checks?.database;
  const migrationsCheck = result?.checks?.migrations;
  return [
    {
      component: 'readiness',
      status: result?.status || 'unknown',
      code: reason || (result?.status === 'healthy' ? 'READINESS_OK' : 'READINESS_UNKNOWN'),
      durationMs: result?.durationMs,
      requestId
    },
    {
      component: 'database',
      status: databaseCheck === 'ok' ? 'healthy'
        : databaseCheck === 'slow' ? 'degraded' : 'unhealthy',
      code: reason.startsWith('DATABASE_')
        ? reason
        : databaseCheck === 'ok' ? 'DATABASE_OK'
          : databaseCheck === 'slow' ? 'DATABASE_SLOW' : 'DATABASE_UNAVAILABLE',
      durationMs: result?.durationMs,
      requestId
    },
    {
      component: 'migrations',
      status: migrationsCheck === 'ok'
        ? 'healthy'
        : databaseCheck === 'unavailable' ? 'unknown' : 'unhealthy',
      code: reason.startsWith('MIGRATIONS_')
        ? reason
        : migrationsCheck === 'ok' ? 'MIGRATIONS_OK'
          : databaseCheck === 'unavailable' ? 'MIGRATIONS_NOT_CHECKED' : 'MIGRATIONS_UNAVAILABLE',
      durationMs: result?.durationMs,
      requestId
    }
  ];
}

function diagnosticObservations(diagnostic, requestId) {
  const checks = diagnostic?.checks || {};
  const database = checks.database || {};
  const migrations = checks.migrations || {};
  const backup = checks.backup || {};
  return [
    {
      component: 'application',
      status: 'healthy',
      code: 'APPLICATION_RUNNING',
      durationMs: diagnostic?.durationMs,
      requestId
    },
    {
      component: 'readiness',
      status: diagnostic?.status === 'unhealthy'
        ? 'unhealthy'
        : database.status === 'warning' ? 'degraded' : 'healthy',
      code: database.code || migrations.code
        || (database.status === 'warning' ? 'DATABASE_SLOW' : 'READINESS_OK'),
      durationMs: diagnostic?.durationMs,
      requestId
    },
    {
      component: 'database',
      status: database.status === 'ok' ? 'healthy'
        : database.status === 'warning' ? 'degraded' : 'unhealthy',
      code: database.code || (database.status === 'ok' ? 'DATABASE_OK'
        : database.status === 'warning' ? 'DATABASE_SLOW' : 'DATABASE_UNAVAILABLE'),
      durationMs: database.durationMs,
      requestId
    },
    {
      component: 'migrations',
      status: migrations.status === 'ok'
        ? 'healthy'
        : database.status === 'error' && !migrations.code ? 'unknown' : 'unhealthy',
      code: migrations.code || (migrations.status === 'ok' ? 'MIGRATIONS_OK'
        : database.status === 'error' ? 'MIGRATIONS_NOT_CHECKED' : 'MIGRATIONS_UNAVAILABLE'),
      requestId
    },
    {
      component: 'backup',
      status: backup.status === 'ok' ? 'healthy'
        : backup.status === 'warning' ? 'degraded' : 'unhealthy',
      code: backup.code || 'BACKUP_CHECK_FAILED',
      durationMs: backup.durationMs,
      requestId
    }
  ];
}

function createOperationalMonitor(options = {}) {
  const { tracker, dispatcher } = options;
  if (!tracker || typeof tracker.observe !== 'function'
    || !dispatcher || typeof dispatcher.dispatch !== 'function') {
    throw new Error('El monitor operativo requiere tracker y dispatcher.');
  }

  function observeMany(observations) {
    try {
      return observations.map((observation) => tracker.observe(observation)).filter(Boolean);
    } catch {
      return [];
    }
  }

  return Object.freeze({
    observeApplication(status = 'healthy', code = 'APPLICATION_RUNNING') {
      return observeMany([{ component: 'application', status, code }]);
    },
    observeDiagnostic(diagnostic, requestId) {
      return observeMany(diagnosticObservations(diagnostic, requestId));
    },
    observeReadiness(result, requestId) {
      return observeMany(readinessObservations(result, requestId));
    },
    gracefulShutdown(event, details = {}) {
      try {
        return dispatcher.dispatch({
          timestamp: new Date().toISOString(),
          level: details.severity === 'critical' ? 'error' : details.level || 'info',
          event,
          component: 'gracefulShutdown',
          previousStatus: details.previousStatus || 'healthy',
          currentStatus: details.currentStatus || 'degraded',
          code: details.code || 'SHUTDOWN_STARTED',
          severity: details.severity || 'info',
          durationMs: details.durationMs,
          occurrenceCount: 1,
          suppressedCount: 0
        });
      } catch {
        return null;
      }
    }
  });
}

module.exports = {
  createOperationalMonitor,
  createOperationalStateTracker,
  diagnosticObservations,
  eventForTransition,
  readinessObservations,
  severityForStatus
};
