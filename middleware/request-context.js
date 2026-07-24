const crypto = require('crypto');
const { errorCode } = require('../utils/app-error');
const { requestLogContext } = require('../utils/security-logger');

function requestContext(logger) {
  return (req, res, next) => {
    req.requestId = crypto.randomUUID();
    res.setHeader('X-Request-Id', req.requestId);
    const sendJson = res.json.bind(res);
    res.json = (body) => {
      if (res.statusCode >= 500 && res.locals.allowOperationalHealthResponse !== true) {
        return sendJson({
          error: 'Ocurrio un error interno.',
          code: 'INTERNAL_ERROR',
          requestId: req.requestId
        });
      }
      if (res.statusCode >= 400 && body && typeof body === 'object' && !Array.isArray(body)) {
        return sendJson({
          ...body,
          code: body.code || errorCode(res.statusCode),
          requestId: body.requestId || req.requestId
        });
      }
      return sendJson(body);
    };
    const startedAt = process.hrtime.bigint();
    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      const originalPath = String(req.originalUrl || '').split('?', 1)[0];
      if (originalPath === '/health/live' && res.statusCode < 400) return;
      const context = requestLogContext(req, {
        estado: res.statusCode,
        duracionMs: Number(durationMs.toFixed(1))
      });
      if (res.statusCode >= 500) logger.error('http_request_failed', context);
      else if (res.statusCode >= 400) logger.warn('http_request_rejected', context);
      else logger.info('http_request_completed', context);
    });
    next();
  };
}

module.exports = { requestContext };
