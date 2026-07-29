const { isProductionEnvironment, parseBoolean } = require('./database-options');

const LOG_LEVELS = new Set(['off', 'error', 'warn', 'info']);

function integerSetting(environment, name, defaultValue, minimum, maximum) {
  const text = String(environment[name] ?? '').trim();
  if (!text) return defaultValue;
  const value = Number(text);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} debe ser un entero entre ${minimum} y ${maximum}.`);
  }
  return value;
}

function normalizeOrigin(value, { production = false } = {}) {
  const text = String(value || '').trim();
  if (!text || text.includes('*')) throw new Error('TRUSTED_ORIGINS contiene un origen vacio o comodin.');
  let parsed;
  try {
    parsed = new URL(text);
  } catch {
    throw new Error(`TRUSTED_ORIGINS contiene un origen invalido: ${text.slice(0, 120)}.`);
  }
  if (!['http:', 'https:'].includes(parsed.protocol)
    || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new Error(`TRUSTED_ORIGINS debe contener solo origenes HTTP(S), sin rutas: ${text.slice(0, 120)}.`);
  }
  if (production && parsed.protocol !== 'https:') {
    throw new Error('En produccion todos los TRUSTED_ORIGINS deben usar HTTPS.');
  }
  return parsed.origin;
}

function trustedOrigins(environment = process.env) {
  const production = isProductionEnvironment(environment);
  const configured = String(environment.TRUSTED_ORIGINS || '').trim();
  if (!configured) {
    if (production) throw new Error('En produccion TRUSTED_ORIGINS es obligatorio.');
    const port = integerSetting(environment, 'PORT', 3000, 1, 65535);
    return Object.freeze([
      `http://localhost:${port}`,
      `http://127.0.0.1:${port}`
    ]);
  }
  const origins = configured.split(',').map((origin) => normalizeOrigin(origin, { production }));
  if (new Set(origins).size !== origins.length) {
    throw new Error('TRUSTED_ORIGINS contiene origenes duplicados.');
  }
  return Object.freeze(origins);
}

function webSecurityConfig(environment = process.env) {
  const production = isProductionEnvironment(environment);
  const testEnvironment = String(environment.APP_ENV || '').trim().toLowerCase() === 'test';
  const rateLimitEnabled = parseBoolean(
    environment.RATE_LIMIT_ENABLED,
    'RATE_LIMIT_ENABLED',
    !testEnvironment
  );
  if (production && !rateLimitEnabled) {
    throw new Error('En produccion RATE_LIMIT_ENABLED debe ser true.');
  }
  const logLevel = String(environment.SECURITY_LOG_LEVEL || (production ? 'info' : 'warn')).trim().toLowerCase();
  if (!LOG_LEVELS.has(logLevel)) {
    throw new Error('SECURITY_LOG_LEVEL debe ser off, error, warn o info.');
  }
  const windowMs = integerSetting(environment, 'RATE_LIMIT_WINDOW_MS', 15 * 60 * 1000, 1000, 24 * 60 * 60 * 1000);
  const readinessSoftMs = integerSetting(environment, 'HEALTH_READINESS_SOFT_MS', 300, 10, 5000);
  const readinessTimeoutMs = integerSetting(environment, 'HEALTH_READINESS_TIMEOUT_MS', 1500, 100, 10000);
  if (readinessSoftMs >= readinessTimeoutMs) {
    throw new Error('HEALTH_READINESS_SOFT_MS debe ser menor que HEALTH_READINESS_TIMEOUT_MS.');
  }
  const backupWarningHours = integerSetting(environment, 'BACKUP_WARNING_HOURS', 24, 1, 8760);
  const backupCriticalHours = integerSetting(environment, 'BACKUP_CRITICAL_HOURS', 48, 2, 17520);
  if (backupCriticalHours <= backupWarningHours) {
    throw new Error('BACKUP_CRITICAL_HOURS debe ser mayor que BACKUP_WARNING_HOURS.');
  }
  const monitoringWarningReminderMs = integerSetting(
    environment,
    'MONITOR_WARNING_REMINDER_MS',
    43200000,
    60000,
    604800000
  );
  const monitoringErrorReminderMs = integerSetting(
    environment,
    'MONITOR_ERROR_REMINDER_MS',
    1800000,
    60000,
    86400000
  );
  const monitoringCriticalReminderMs = integerSetting(
    environment,
    'MONITOR_CRITICAL_REMINDER_MS',
    900000,
    60000,
    86400000
  );
  return Object.freeze({
    production,
    trustedOrigins: trustedOrigins(environment),
    rateLimit: Object.freeze({
      enabled: rateLimitEnabled,
      windowMs,
      apiMax: integerSetting(environment, 'RATE_LIMIT_MAX', 3000, 10, 100000),
      loginIpMax: integerSetting(environment, 'LOGIN_RATE_LIMIT_MAX', 10, 2, 1000),
      loginIdentityMax: integerSetting(environment, 'LOGIN_IDENTITY_RATE_LIMIT_MAX', 6, 2, 1000),
      publicRegistrationMax: integerSetting(environment, 'PUBLIC_REGISTRATION_RATE_LIMIT_MAX', 5, 1, 1000),
      authMax: integerSetting(environment, 'AUTH_RATE_LIMIT_MAX', 120, 5, 10000),
      adminMax: integerSetting(environment, 'ADMIN_RATE_LIMIT_MAX', 600, 10, 10000),
      exportMax: integerSetting(environment, 'EXPORT_RATE_LIMIT_MAX', 30, 1, 1000),
      whatsappMax: integerSetting(environment, 'WHATSAPP_RATE_LIMIT_MAX', 60, 1, 1000),
      healthMax: integerSetting(environment, 'HEALTH_RATE_LIMIT_MAX', 900, 10, 100000)
    }),
    operationalHealth: Object.freeze({
      softLimitMs: readinessSoftMs,
      timeoutMs: readinessTimeoutMs,
      cacheMs: integerSetting(environment, 'HEALTH_READINESS_CACHE_MS', 4000, 500, 30000),
      shutdownTimeoutMs: integerSetting(environment, 'SHUTDOWN_TIMEOUT_MS', 10000, 1000, 60000)
    }),
    operationalBackup: Object.freeze({
      warningHours: backupWarningHours,
      criticalHours: backupCriticalHours,
      cacheMs: integerSetting(environment, 'BACKUP_STATUS_CACHE_MS', 300000, 1000, 3600000)
    }),
    operationalMonitoring: Object.freeze({
      warningReminderMs: monitoringWarningReminderMs,
      errorReminderMs: monitoringErrorReminderMs,
      criticalReminderMs: monitoringCriticalReminderMs
    }),
    logLevel
  });
}

module.exports = {
  integerSetting,
  normalizeOrigin,
  trustedOrigins,
  webSecurityConfig
};
