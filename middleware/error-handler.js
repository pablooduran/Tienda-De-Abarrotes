const { AppError, errorCode } = require('../utils/app-error');
const { requestLogContext } = require('../utils/security-logger');

function normalizedStatus(error) {
  const status = Number(error?.status || error?.statusCode);
  return Number.isInteger(status) && status >= 400 && status <= 599 ? status : 500;
}

function notFoundHandler(req, res, next) {
  next(new AppError(404, 'Ruta no encontrada.', 'ROUTE_NOT_FOUND'));
}

function createErrorHandler({ logger, production }) {
  return (error, req, res, next) => {
    if (res.headersSent) return next(error);
    const status = normalizedStatus(error);
    const code = status >= 500 ? 'INTERNAL_ERROR' : errorCode(status, error?.code);
    if (status >= 500) {
      logger.error('unhandled_application_error', requestLogContext(req, {
        errorName: error?.name || 'Error',
        errorCode: typeof error?.code === 'string' ? error.code.slice(0, 80) : null
      }));
    }
    const response = {
      error: status >= 500 ? 'Ocurrio un error interno.' : String(error?.message || 'No se pudo completar la solicitud.'),
      code,
      requestId: req.requestId
    };
    if (!production && status >= 500) response.detail = 'Revise el registro local usando el identificador de la solicitud.';
    return res.status(status).json(response);
  };
}

module.exports = { createErrorHandler, normalizedStatus, notFoundHandler };
