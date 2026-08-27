const crypto = require('crypto');
const { ipKeyGenerator, rateLimit } = require('express-rate-limit');

function disabledLimiter(req, res, next) {
  next();
}

function clientIpKey(req) {
  return ipKeyGenerator(req.clientIp || req.ip || req.socket?.remoteAddress || 'ip-ausente');
}

function normalizedUsername(req) {
  return String(req.body?.usuario || '').trim().toLowerCase().slice(0, 80);
}

function normalizedRegistrationIdentity(req) {
  return String(req.body?.correo || '').trim().toLowerCase().slice(0, 160);
}

function identityKey(req) {
  const identity = normalizedUsername(req) || 'identidad-ausente';
  const ip = clientIpKey(req);
  return crypto.createHash('sha256').update(`${ip}\0${identity}`).digest('hex').slice(0, 32);
}

function registrationKey(req) {
  const identity = normalizedRegistrationIdentity(req) || 'registro-sin-correo';
  const ip = clientIpKey(req);
  return crypto.createHash('sha256').update(`${ip}\0${identity}`).digest('hex').slice(0, 32);
}

function verificationIdentityKey(req) {
  const identity = normalizedRegistrationIdentity(req) || 'verificacion-sin-correo';
  return crypto.createHash('sha256').update(`verificacion\0${identity}`).digest('hex').slice(0, 32);
}

function recoveryIdentityKey(req) {
  const identity = normalizedRegistrationIdentity(req) || 'recuperacion-sin-correo';
  return crypto.createHash('sha256').update(`recuperacion\0${identity}`).digest('hex').slice(0, 32);
}

function recoveryTokenKey(req) {
  const token = String(req.body?.token || '').trim();
  return crypto.createHash('sha256').update(`recuperacion-token\0${token}`).digest('hex').slice(0, 32);
}

function limiter(config, {
  identifier,
  limit,
  code,
  message,
  skipSuccessfulRequests = false,
  keyGenerator,
  onLimit,
  store
}) {
  if (!config.enabled) return disabledLimiter;
  return rateLimit({
    windowMs: config.windowMs,
    limit,
    identifier,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    ...(store ? { store } : {}),
    skipSuccessfulRequests,
    keyGenerator: keyGenerator || clientIpKey,
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

function createRateLimiters(config, { onLoginLimited = null, storeFactory = null } = {}) {
  const commonMessage = 'Se alcanzaron demasiadas solicitudes. Intenta nuevamente mas tarde.';
  const store = (identifier) => storeFactory ? storeFactory(identifier) : undefined;
  return Object.freeze({
    api: limiter(config, {
      identifier: 'api-general', limit: config.apiMax,
      code: 'API_RATE_LIMIT_EXCEEDED', message: commonMessage, store: store('api-general')
    }),
    auth: limiter(config, {
      identifier: 'auth-sensitive', limit: config.authMax,
      code: 'AUTH_RATE_LIMIT_EXCEEDED', message: commonMessage, store: store('auth-sensitive')
    }),
    admin: limiter(config, {
      identifier: 'admin-sensitive', limit: config.adminMax,
      code: 'ADMIN_RATE_LIMIT_EXCEEDED', message: commonMessage, store: store('admin-sensitive')
    }),
    payment: limiter(config, {
      identifier: 'payment-owner', limit: config.paymentMax,
      code: 'PAYMENT_RATE_LIMIT_EXCEEDED', message: commonMessage, store: store('payment-owner')
    }),
    paymentAdmin: limiter(config, {
      identifier: 'payment-admin', limit: config.paymentAdminMax,
      code: 'PAYMENT_ADMIN_RATE_LIMIT_EXCEEDED', message: commonMessage, store: store('payment-admin')
    }),
    receiptUpload: limiter(config, {
      identifier: 'payment-receipt-upload', limit: config.receiptUploadMax,
      code: 'RECEIPT_UPLOAD_RATE_LIMIT_EXCEEDED', message: commonMessage, store: store('payment-receipt-upload')
    }),
    export: limiter(config, {
      identifier: 'exports', limit: config.exportMax,
      code: 'EXPORT_RATE_LIMIT_EXCEEDED', message: commonMessage, store: store('exports')
    }),
    whatsapp: limiter(config, {
      identifier: 'whatsapp-prepared', limit: config.whatsappMax,
      code: 'WHATSAPP_RATE_LIMIT_EXCEEDED', message: commonMessage, store: store('whatsapp-prepared')
    }),
    health: limiter(config, {
      identifier: 'health-public', limit: config.healthMax,
      code: 'HEALTH_RATE_LIMIT_EXCEEDED', message: commonMessage, store: store('health-public')
    }),
    loginIp: limiter(config, {
      identifier: 'login-ip', limit: config.loginIpMax,
      code: 'TOO_MANY_LOGIN_ATTEMPTS',
      message: 'Demasiados intentos de inicio de sesion. Intenta nuevamente mas tarde.',
      skipSuccessfulRequests: true,
      onLimit: onLoginLimited, store: store('login-ip')
    }),
    loginIdentity: limiter(config, {
      identifier: 'login-identity', limit: config.loginIdentityMax,
      code: 'TOO_MANY_LOGIN_ATTEMPTS',
      message: 'Demasiados intentos de inicio de sesion. Intenta nuevamente mas tarde.',
      skipSuccessfulRequests: true,
      keyGenerator: identityKey,
      onLimit: onLoginLimited, store: store('login-identity')
    }),
    publicRegistration: limiter(config, {
      identifier: 'public-registration', limit: config.publicRegistrationMax,
      code: 'PUBLIC_REGISTRATION_RATE_LIMIT_EXCEEDED', message: commonMessage,
      keyGenerator: registrationKey, store: store('public-registration')
    }),
    emailVerificationConfirm: limiter(config, {
      identifier: 'email-verification-confirm', limit: config.emailVerificationConfirmMax,
      code: 'EMAIL_VERIFICATION_RATE_LIMIT_EXCEEDED', message: commonMessage, store: store('email-verification-confirm')
    }),
    emailVerificationResendIp: limiter(config, {
      identifier: 'email-verification-resend-ip', limit: config.emailVerificationResendIpMax,
      code: 'EMAIL_VERIFICATION_RESEND_RATE_LIMIT_EXCEEDED', message: commonMessage, store: store('email-verification-resend-ip')
    }),
    emailVerificationResendIdentity: limiter(config, {
      identifier: 'email-verification-resend-identity', limit: config.emailVerificationResendIdentityMax,
      code: 'EMAIL_VERIFICATION_RESEND_RATE_LIMIT_EXCEEDED', message: commonMessage,
      keyGenerator: verificationIdentityKey, store: store('email-verification-resend-identity')
    }),
    passwordRecoveryRequestIp: limiter(config, {
      identifier: 'password-recovery-request-ip', limit: config.passwordRecoveryRequestIpMax,
      code: 'PASSWORD_RECOVERY_RATE_LIMIT_EXCEEDED', message: commonMessage, store: store('password-recovery-request-ip')
    }),
    passwordRecoveryRequestIdentity: limiter(config, {
      identifier: 'password-recovery-request-identity', limit: config.passwordRecoveryRequestIdentityMax,
      code: 'PASSWORD_RECOVERY_RATE_LIMIT_EXCEEDED', message: commonMessage,
      keyGenerator: recoveryIdentityKey, store: store('password-recovery-request-identity')
    }),
    passwordRecoveryConfirmIp: limiter(config, {
      identifier: 'password-recovery-confirm-ip', limit: config.passwordRecoveryConfirmIpMax,
      code: 'PASSWORD_RESET_RATE_LIMIT_EXCEEDED', message: commonMessage, store: store('password-recovery-confirm-ip')
    }),
    passwordRecoveryConfirmToken: limiter(config, {
      identifier: 'password-recovery-confirm-token', limit: config.passwordRecoveryConfirmTokenMax,
      code: 'PASSWORD_RESET_RATE_LIMIT_EXCEEDED', message: commonMessage,
      keyGenerator: recoveryTokenKey, store: store('password-recovery-confirm-token')
    })
  });
}

module.exports = {
  createRateLimiters,
  clientIpKey,
  identityKey,
  normalizedRegistrationIdentity,
  normalizedUsername,
  registrationKey,
  verificationIdentityKey,
  recoveryIdentityKey,
  recoveryTokenKey
};
