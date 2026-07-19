const { destroyRequestSession, validateSession } = require('../services/session-validation-service');

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

    await destroyRequestSession(req, res);
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
