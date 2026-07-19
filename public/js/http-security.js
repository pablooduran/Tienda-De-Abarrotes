(function initializeSecureHttp(global) {
  'use strict';

  const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

  function secureFetch(resource, options = {}) {
    const method = String(options.method || 'GET').toUpperCase();
    const headers = new Headers(options.headers || {});
    if (!SAFE_METHODS.has(method)) headers.set('X-Requested-With', 'XMLHttpRequest');
    return global.fetch(resource, {
      ...options,
      method,
      headers,
      credentials: options.credentials || 'same-origin'
    });
  }

  function errorFromResponse(response, body = {}, fallback = 'No se pudo completar la operacion.') {
    const requestId = body.requestId || response.headers.get('X-Request-Id') || null;
    const retryAfter = response.headers.get('Retry-After');
    let message = body.error || fallback;
    if (response.status === 429 && retryAfter) {
      message = `${message} Reintenta en aproximadamente ${retryAfter} segundos.`;
    } else if (body.code === 'SESSION_REVOKED') {
      message = 'La sesion fue revocada. Inicia sesion nuevamente.';
    } else if (body.code === 'CSRF_VALIDATION_FAILED' || body.code === 'ORIGIN_NOT_ALLOWED') {
      message = 'La solicitud fue rechazada por seguridad. Recarga la pagina e intenta nuevamente.';
    }
    if (response.status >= 500 && requestId) message = `${message} Referencia: ${requestId}.`;
    const error = new Error(message);
    error.status = response.status;
    error.code = body.code || null;
    error.requestId = requestId;
    return error;
  }

  global.SecurityHttp = Object.freeze({ errorFromResponse, secureFetch });
}(window));
