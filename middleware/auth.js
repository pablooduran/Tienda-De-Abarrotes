const { destroyRequestSession, validateSession } = require('../services/session-validation-service');
const { administrativeAuditService } = require('../services/administrative-audit-service');

function expectsJson(req) {
  return req.originalUrl.startsWith('/api') || req.originalUrl.startsWith('/auth');
}

async function requireAuth(req, res, next) {
  try {
    if (req.auth) return next();
    const validation = await validateSession(req.session?.admin);
    if (validation.valid) {
      req.auth = validation.context;
      return next();
    }

    const invalidSessionAdmin = req.session?.admin;
    await destroyRequestSession(req, res);
    if (['SESSION_REVOKED', 'STORE_UNAVAILABLE'].includes(validation.code)) {
      const sessionAdministratorId = Number(invalidSessionAdmin?.idAdministrador);
      const rawStoreId = invalidSessionAdmin?.idTienda;
      const sessionStoreId = rawStoreId === null || rawStoreId === undefined
        ? null
        : Number(rawStoreId);
      await administrativeAuditService.recordOutcome({
        actorType: 'sistema',
        administratorId: null,
        storeId: Number.isInteger(sessionStoreId) && sessionStoreId > 0
          ? sessionStoreId
          : null,
        action: 'revocacion_sesion',
        result: 'rechazado',
        resultCode: validation.code,
        origin: 'sistema',
        reference: Number.isInteger(sessionAdministratorId) && sessionAdministratorId > 0
          ? `administrador:${sessionAdministratorId}`
          : null,
        requestId: req.requestId
      });
    }
    if (expectsJson(req)) {
      return res.status(validation.status).json({
        error: validation.code === 'STORE_UNAVAILABLE'
          ? 'La tienda asociada no esta disponible.'
          : 'La sesion ya no es valida. Inicie sesion nuevamente.',
        code: validation.code
      });
    }
    return res.redirect('/login.html');
  } catch (error) {
    return next(error);
  }
}

module.exports = { requireAuth };
