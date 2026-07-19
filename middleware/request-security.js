const { AppError } = require('../utils/app-error');

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const REQUESTED_WITH = 'XMLHttpRequest';

function sourceOrigin(req) {
  const origin = String(req.get('Origin') || '').trim();
  if (origin) return origin;
  const referer = String(req.get('Referer') || '').trim();
  if (!referer) return '';
  try {
    return new URL(referer).origin;
  } catch {
    return '';
  }
}

function mutationProtection(trustedOrigins) {
  const allowed = new Set(trustedOrigins);
  return (req, res, next) => {
    if (SAFE_METHODS.has(req.method)) return next();
    if (req.get('X-Requested-With') !== REQUESTED_WITH) {
      return next(new AppError(403, 'La solicitud no supero la validacion de seguridad.', 'CSRF_VALIDATION_FAILED'));
    }
    const origin = sourceOrigin(req);
    if (!origin || !allowed.has(origin)) {
      return next(new AppError(403, 'El origen de la solicitud no esta permitido.', 'ORIGIN_NOT_ALLOWED'));
    }
    return next();
  };
}

function noStoreSensitiveResponses(req, res, next) {
  if (req.path.startsWith('/api') || req.path.startsWith('/auth')
    || ['/app.html', '/admin.html', '/'].includes(req.path)) {
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
  next();
}

module.exports = {
  REQUESTED_WITH,
  SAFE_METHODS,
  mutationProtection,
  noStoreSensitiveResponses,
  sourceOrigin
};
