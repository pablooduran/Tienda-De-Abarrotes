const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function hasHeader(headers, expectedName) {
  const normalized = expectedName.toLowerCase();
  return Object.keys(headers).some((name) => name.toLowerCase() === normalized);
}

function applyTestRequestSecurity(baseUrl, request) {
  request.headers ||= {};
  const method = String(request.method || 'GET').toUpperCase();
  if (!hasHeader(request.headers, 'Origin')) {
    request.headers.Origin = new URL(baseUrl).origin;
  }
  if (!SAFE_METHODS.has(method) && !hasHeader(request.headers, 'X-Requested-With')) {
    request.headers['X-Requested-With'] = 'XMLHttpRequest';
  }
  return request;
}

module.exports = { applyTestRequestSecurity };
