const SESSION_IDLE_MS = 2 * 60 * 60 * 1000;
const REMEMBER_SESSION_MS = 30 * 24 * 60 * 60 * 1000;

function rememberRequested(value) {
  return value === true || value === 'true' || value === 'on' || value === '1';
}

function configureAuthenticatedSession(req, remember, now = Date.now()) {
  const persistent = Boolean(remember);
  req.session.sessionSecurity = {
    authenticatedAt: now,
    lastActivityAt: now,
    remember: persistent
  };
  if (persistent) {
    req.session.cookie.maxAge = REMEMBER_SESSION_MS;
  } else {
    req.session.cookie.expires = false;
    req.session.cookie.maxAge = null;
  }
}

function sessionExpired(req, now = Date.now()) {
  const security = req.session?.sessionSecurity;
  if (!req.session?.admin || !security) return false;
  const reference = security.remember ? security.authenticatedAt : security.lastActivityAt;
  const limit = security.remember ? REMEMBER_SESSION_MS : SESSION_IDLE_MS;
  return !Number.isFinite(Number(reference)) || now - Number(reference) > limit;
}

function touchSession(req, now = Date.now()) {
  if (req.session?.sessionSecurity && !req.session.sessionSecurity.remember) {
    req.session.sessionSecurity.lastActivityAt = now;
  }
}

module.exports = {
  REMEMBER_SESSION_MS,
  SESSION_IDLE_MS,
  configureAuthenticatedSession,
  rememberRequested,
  sessionExpired,
  touchSession
};
