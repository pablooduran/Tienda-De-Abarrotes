const express = require('express');

function createAdminHealthRouter({ diagnosticService, logger, slowLogMs = 1000 }) {
  if (!diagnosticService || typeof diagnosticService.diagnose !== 'function' || !logger) {
    throw new Error('La ruta de diagnostico requiere servicio y logger.');
  }
  const router = express.Router();

  router.get('/', async (req, res, next) => {
    try {
      const diagnostic = await diagnosticService.diagnose();
      const backup = diagnostic.checks.backup;
      if (backup.status !== 'ok') {
        logger.warn('operational_backup_degraded', {
          requestId: req.requestId,
          component: 'backup',
          code: backup.code,
          status: backup.status,
          durationMs: backup.durationMs
        });
      }
      if (diagnostic.status === 'unhealthy') {
        logger.warn('operational_diagnostic_unhealthy', {
          requestId: req.requestId,
          component: diagnostic.checks.database.status === 'error' ? 'database' : 'migrations',
          status: diagnostic.status,
          durationMs: diagnostic.durationMs
        });
      } else if (diagnostic.durationMs > slowLogMs) {
        logger.warn('operational_diagnostic_slow', {
          requestId: req.requestId,
          component: 'diagnostic',
          status: diagnostic.status,
          durationMs: diagnostic.durationMs
        });
      }
      res.locals.allowOperationalHealthResponse = true;
      return res.status(diagnostic.httpStatus).json({
        status: diagnostic.status,
        checks: diagnostic.checks,
        durationMs: diagnostic.durationMs,
        checkedAt: diagnostic.checkedAt,
        requestId: req.requestId
      });
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

module.exports = { createAdminHealthRouter };
