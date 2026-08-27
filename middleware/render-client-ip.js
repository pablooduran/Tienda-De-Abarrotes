const net = require('net');

const { AppError } = require('../utils/app-error');

function normalizedRenderClientIp(value) {
  const header = String(value || '').trim();
  if (!header || header.includes(',') || net.isIP(header) === 0) return null;
  return header;
}

function createRenderClientIpMiddleware({ enabled = false } = {}) {
  if (!enabled) return (req, res, next) => next();
  return (req, res, next) => {
    const clientIp = normalizedRenderClientIp(req.get('CF-Connecting-IP'));
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
  normalizedRenderClientIp
};
