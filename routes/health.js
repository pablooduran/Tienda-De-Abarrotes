const express = require('express');

function sendHealth(req, res, statusCode, payload) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.locals.allowOperationalHealthResponse = true;
  res.status(statusCode);
  if (req.method === 'HEAD') return res.end();
  return res.json({ ...payload, requestId: req.requestId });
}

function createHealthRouter({ healthService, logger }) {
  if (!healthService || !logger) throw new Error('Las rutas health requieren servicio y logger.');
  const router = express.Router();

  function live(req, res) {
    return sendHealth(req, res, 200, healthService.liveness());
  }

  async function ready(req, res, next) {
    try {
      const result = await healthService.readiness();
      if (result.status === 'unhealthy') {
        logger.warn('readiness_failed', {
          requestId: req.requestId,
          reason: result.reason,
          durationMs: result.durationMs
        });
      }
      const payload = {
        status: result.status,
        checks: result.checks,
        durationMs: result.durationMs,
        checkedAt: result.checkedAt
      };
      return sendHealth(req, res, result.status === 'unhealthy' ? 503 : 200, payload);
    } catch (error) {
      return next(error);
    }
  }

  router.head('/live', live);
  router.get('/live', live);
  router.head('/ready', ready);
  router.get('/ready', ready);
  return router;
}

module.exports = { createHealthRouter, sendHealth };
