const { formatLocalDateTime } = require('./local-datetime');

const LEVEL_PRIORITY = Object.freeze({ off: 0, error: 1, warn: 2, info: 3 });
const SENSITIVE_KEY = /(password|contrasena|contraseña|hash|authorization|cookie|set-cookie|session|token|secret|db_ssl_ca|mensaje|whatsapp|body)/i;

function normalizedIp(value) {
  const text = String(value || '').trim();
  return text.startsWith('::ffff:') ? text.slice(7) : text || null;
}

function safeValue(value, key = '') {
  if (SENSITIVE_KEY.test(key)) return '[REDACTED]';
  if (value === null || value === undefined || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') return value.replace(/[\r\n\t]/g, ' ').slice(0, 300);
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => safeValue(item));
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).slice(0, 30).map(([name, item]) => [name, safeValue(item, name)]));
  }
  return String(value).slice(0, 100);
}

function createSecurityLogger(level = 'warn') {
  const threshold = LEVEL_PRIORITY[level] ?? LEVEL_PRIORITY.warn;
  function emit(messageLevel, event, context = {}) {
    if (!threshold || LEVEL_PRIORITY[messageLevel] > threshold) return;
    const entry = JSON.stringify({
      timestamp: formatLocalDateTime(),
      level: messageLevel,
      event: String(event || 'security_event').slice(0, 80),
      ...safeValue(context)
    });
    if (messageLevel === 'error') console.error(entry);
    else if (messageLevel === 'warn') console.warn(entry);
    else console.log(entry);
  }
  return Object.freeze({
    error: (event, context) => emit('error', event, context),
    warn: (event, context) => emit('warn', event, context),
    info: (event, context) => emit('info', event, context)
  });
}

function requestLogContext(req, extra = {}) {
  return {
    requestId: req.requestId,
    metodo: req.method,
    ruta: req.path,
    ip: normalizedIp(req.ip || req.socket?.remoteAddress),
    idAdministrador: req.auth?.idAdministrador || null,
    idTienda: req.auth?.idTienda || null,
    ...extra
  };
}

module.exports = { createSecurityLogger, normalizedIp, requestLogContext, safeValue };
