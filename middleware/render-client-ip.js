const net = require('net');

const { AppError } = require('../utils/app-error');

const RENDER_INTERNAL_HEALTH_CHECK = Symbol('renderInternalHealthCheck');
const RENDER_INTERNAL_HEALTH_PATHS = new Set(['/health/live', '/health/ready']);

function normalizedRenderClientIp(value) {
  const header = String(value || '').trim();
  if (!header || header.includes(',') || net.isIP(header) === 0) return null;
  return header;
}

function isRenderInternalHealthCheck(req) {
  return req[RENDER_INTERNAL_HEALTH_CHECK] === true;
}

function canOmitRenderClientIp(req, headerValue) {
  return headerValue === undefined
    && (req.method === 'GET' || req.method === 'HEAD')
    && RENDER_INTERNAL_HEALTH_PATHS.has(req.path);
}

function createRenderClientIpMiddleware({ enabled = false } = {}) {
  if (!enabled) return (req, res, next) => next();
  return (req, res, next) => {
    const headerValue = req.get('CF-Connecting-IP');
    if (canOmitRenderClientIp(req, headerValue)) {
      Object.defineProperty(req, RENDER_INTERNAL_HEALTH_CHECK, {
        value: true,
        enumerable: false,
        configurable: false,
        writable: false
      });
      return next();
    }

    const clientIp = normalizedRenderClientIp(headerValue);
    if (!clientIp) {
      return next(new AppError(
        400,
        'No se pudo validar el origen de la solicitud.',
        'CLIENT_IP_UNAVAILABLE'
      ));
    }
    Object.defineProperty(req, 'clientIp', {
      value: clientIp,
      enumerable: false,
      configurable: false,
      writable: false
    });
    return next();
  };
}

module.exports = {
  createRenderClientIpMiddleware,
  isRenderInternalHealthCheck,
  normalizedRenderClientIp
};
