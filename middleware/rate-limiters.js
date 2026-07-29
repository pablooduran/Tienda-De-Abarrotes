const crypto = require('crypto');
const { ipKeyGenerator, rateLimit } = require('express-rate-limit');

function disabledLimiter(req, res, next) {
  next();
}

function normalizedUsername(req) {
  return String(req.body?.usuario || '').trim().toLowerCase().slice(0, 80);
}

function normalizedRegistrationIdentity(req) {
  return String(req.body?.correo || '').trim().toLowerCase().slice(0, 160);
}

function identityKey(req) {
  const identity = normalizedUsername(req) || 'identidad-ausente';
  const ip = ipKeyGenerator(req.ip || req.socket?.remoteAddress || 'ip-ausente');
  return crypto.createHash('sha256').update(`${ip}\0${identity}`).digest('hex').slice(0, 32);
}

function registrationKey(req) {
  const identity = normalizedRegistrationIdentity(req) || 'registro-sin-correo';
  const ip = ipKeyGenerator(req.ip || req.socket?.remoteAddress || 'ip-ausente');
  return crypto.createHash('sha256').update(`${ip}\0${identity}`).digest('hex').slice(0, 32);
}

function limiter(config, {
  identifier,
  limit,
  code,
  message,
  skipSuccessfulRequests = false,
  keyGenerator,
  onLimit
}) {
  if (!config.enabled) return disabledLimiter;
  return rateLimit({
    windowMs: config.windowMs,
    limit,
    identifier,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skipSuccessfulRequests,
    ...(keyGenerator ? { keyGenerator } : {}),
    async handler(req, res) {
      if (!res.getHeader('Retry-After')) {
        res.setHeader('Retry-After', String(Math.ceil(config.windowMs / 1000)));
      }
      if (onLimit) await onLimit(req, code);
      res.status(429).json({
        error: message,
        code,
        requestId: req.requestId
      });
    }
  });
}

function createRateLimiters(config, { onLoginLimited = null } = {}) {
  const commonMessage = 'Se alcanzaron demasiadas solicitudes. Intenta nuevamente mas tarde.';
  return Object.freeze({
    api: limiter(config, {
      identifier: 'api-general', limit: config.apiMax,
      code: 'API_RATE_LIMIT_EXCEEDED', message: commonMessage
    }),
    auth: limiter(config, {
      identifier: 'auth-sensitive', limit: config.authMax,
      code: 'AUTH_RATE_LIMIT_EXCEEDED', message: commonMessage
    }),
    admin: limiter(config, {
      identifier: 'admin-sensitive', limit: config.adminMax,
      code: 'ADMIN_RATE_LIMIT_EXCEEDED', message: commonMessage
    }),
    export: limiter(config, {
      identifier: 'exports', limit: config.exportMax,
      code: 'EXPORT_RATE_LIMIT_EXCEEDED', message: commonMessage
    }),
    whatsapp: limiter(config, {
      identifier: 'whatsapp-prepared', limit: config.whatsappMax,
      code: 'WHATSAPP_RATE_LIMIT_EXCEEDED', message: commonMessage
    }),
    health: limiter(config, {
      identifier: 'health-public', limit: config.healthMax,
      code: 'HEALTH_RATE_LIMIT_EXCEEDED', message: commonMessage
    }),
    loginIp: limiter(config, {
      identifier: 'login-ip', limit: config.loginIpMax,
      code: 'TOO_MANY_LOGIN_ATTEMPTS',
      message: 'Demasiados intentos de inicio de sesion. Intenta nuevamente mas tarde.',
      skipSuccessfulRequests: true,
      onLimit: onLoginLimited
    }),
    loginIdentity: limiter(config, {
      identifier: 'login-identity', limit: config.loginIdentityMax,
      code: 'TOO_MANY_LOGIN_ATTEMPTS',
      message: 'Demasiados intentos de inicio de sesion. Intenta nuevamente mas tarde.',
      skipSuccessfulRequests: true,
      keyGenerator: identityKey,
      onLimit: onLoginLimited
    }),
    publicRegistration: limiter(config, {
      identifier: 'public-registration', limit: config.publicRegistrationMax,
      code: 'PUBLIC_REGISTRATION_RATE_LIMIT_EXCEEDED', message: commonMessage,
      keyGenerator: registrationKey
    })
  });
}

module.exports = { createRateLimiters, identityKey, normalizedRegistrationIdentity, normalizedUsername, registrationKey };
