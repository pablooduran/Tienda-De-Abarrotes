const { BUSINESS_TIME_ZONE } = require('../config/database-options');

const ALLOWED_COMPONENTS = new Set([
  'application',
  'readiness',
  'database',
  'migrations',
  'backup',
  'gracefulShutdown'
]);
const ALLOWED_EVENTS = new Set([
  'operational_state_initialized',
  'operational_state_changed',
  'operational_component_degraded',
  'operational_component_failed',
  'operational_component_recovered',
  'operational_component_escalated',
  'operational_check_failed',
  'operational_check_recovered',
  'graceful_shutdown_started',
  'graceful_shutdown_completed',
  'graceful_shutdown_failed'
]);
const ALLOWED_LEVELS = new Set(['info', 'warn', 'error']);
const ALLOWED_SEVERITIES = new Set(['info', 'warn', 'error', 'critical']);
const ALLOWED_STATUSES = new Set(['healthy', 'degraded', 'unhealthy', 'unknown']);

function safeCode(value) {
  const code = String(value || '').trim().toUpperCase();
  return /^[A-Z][A-Z0-9_]{0,79}$/.test(code) ? code : 'OPERATIONAL_STATUS_UNKNOWN';
}

function safeRequestId(value) {
  const requestId = String(value || '').trim();
  return /^[A-Za-z0-9_-]{1,80}$/.test(requestId) ? requestId : null;
}

function finiteNumber(value) {
  return Number.isFinite(value) ? Number(Math.max(0, value).toFixed(1)) : null;
}

function positiveInteger(value) {
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

function sanitizeOperationalEvent(source = {}) {
  const event = ALLOWED_EVENTS.has(source.event)
    ? source.event
    : 'operational_state_changed';
  const component = ALLOWED_COMPONENTS.has(source.component)
    ? source.component
    : 'application';
  const severity = ALLOWED_SEVERITIES.has(source.severity) ? source.severity : 'error';
  const level = ALLOWED_LEVELS.has(source.level)
    ? source.level
    : severity === 'critical' ? 'error' : severity;
  const currentStatus = ALLOWED_STATUSES.has(source.currentStatus)
    ? source.currentStatus
    : 'unknown';
  const previousStatus = ALLOWED_STATUSES.has(source.previousStatus)
    ? source.previousStatus
    : 'unknown';
  const timestamp = Number.isFinite(Date.parse(source.timestamp))
    ? new Date(source.timestamp).toISOString()
    : new Date().toISOString();
  const sanitized = {
    timestamp,
    level,
    event,
    component,
    previousStatus,
    currentStatus,
    code: safeCode(source.code),
    severity,
    occurrenceCount: positiveInteger(source.occurrenceCount),
    suppressedCount: positiveInteger(source.suppressedCount),
    timeZone: BUSINESS_TIME_ZONE
  };
  const durationMs = finiteNumber(source.durationMs);
  const requestId = safeRequestId(source.requestId);
  if (durationMs !== null) sanitized.durationMs = durationMs;
  if (requestId) sanitized.requestId = requestId;
  return Object.freeze(sanitized);
}

function createOperationalEventDispatcher(options = {}) {
  const {
    logger,
    adapters = [],
    schedule = queueMicrotask
  } = options;
  if (!logger || typeof logger.info !== 'function'
    || typeof logger.warn !== 'function' || typeof logger.error !== 'function') {
    throw new Error('El dispatcher operativo requiere un logger valido.');
  }
  if (!Array.isArray(adapters) || adapters.some((adapter) => typeof adapter !== 'function')) {
    throw new Error('Los adaptadores operativos deben ser funciones.');
  }

  function dispatch(source) {
    const event = sanitizeOperationalEvent(source);
    const context = { ...event };
    delete context.event;
    const method = event.level === 'info' ? 'info' : event.level === 'warn' ? 'warn' : 'error';
    logger[method](event.event, context);
    for (const adapter of adapters) {
      try {
        schedule(() => {
          Promise.resolve()
            .then(() => adapter(event))
            .catch(() => {
              logger.error('operational_event_dispatch_failed', {
                component: event.component,
                code: 'OPERATIONAL_ADAPTER_FAILED',
                severity: 'error'
              });
            });
        });
      } catch {
        logger.error('operational_event_dispatch_failed', {
          component: event.component,
          code: 'OPERATIONAL_ADAPTER_SCHEDULE_FAILED',
          severity: 'error'
        });
      }
    }
    return event;
  }

  return Object.freeze({ dispatch });
}

module.exports = {
  ALLOWED_COMPONENTS,
  ALLOWED_EVENTS,
  createOperationalEventDispatcher,
  sanitizeOperationalEvent
};
