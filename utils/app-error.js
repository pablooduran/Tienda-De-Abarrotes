const STATUS_CODES = new Map([
  [400, 'VALIDATION_ERROR'],
  [401, 'AUTHENTICATION_REQUIRED'],
  [403, 'ACCESS_DENIED'],
  [404, 'NOT_FOUND'],
  [409, 'CONFLICT'],
  [422, 'BUSINESS_RULE_VIOLATION'],
  [429, 'RATE_LIMIT_EXCEEDED']
]);

class AppError extends Error {
  constructor(status, message, code, options = {}) {
    super(message, options);
    this.name = 'AppError';
    this.status = status;
    this.code = code || STATUS_CODES.get(status) || 'INTERNAL_ERROR';
    this.expose = status < 500;
  }
}

function errorCode(status, explicitCode) {
  return explicitCode || STATUS_CODES.get(status) || 'INTERNAL_ERROR';
}

module.exports = { AppError, STATUS_CODES, errorCode };
