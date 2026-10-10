const assert = require('assert/strict');
const {
  REMEMBER_SESSION_MS,
  SESSION_IDLE_MS,
  configureAuthenticatedSession,
  rememberRequested,
  sessionExpired,
  touchSession
} = require('../config/session-persistence');

function request() {
  return { session: { admin: { id: 1 }, cookie: { maxAge: 1234 } } };
}

const temporary = request();
configureAuthenticatedSession(temporary, false, 1000);
assert.strictEqual(temporary.session.cookie.maxAge, null);
assert.strictEqual(temporary.session.cookie.expires, false);
assert.strictEqual(sessionExpired(temporary, 1000 + SESSION_IDLE_MS), false);
assert.strictEqual(sessionExpired(temporary, 1001 + SESSION_IDLE_MS), true);
touchSession(temporary, 5000);
assert.strictEqual(temporary.session.sessionSecurity.lastActivityAt, 5000);

const remembered = request();
configureAuthenticatedSession(remembered, true, 1000);
assert.strictEqual(remembered.session.cookie.maxAge, REMEMBER_SESSION_MS);
touchSession(remembered, 5000);
assert.strictEqual(remembered.session.sessionSecurity.lastActivityAt, 1000);
assert.strictEqual(sessionExpired(remembered, 1001 + REMEMBER_SESSION_MS), true);

assert.strictEqual(rememberRequested('on'), true);
assert.strictEqual(rememberRequested(true), true);
assert.strictEqual(rememberRequested('false'), false);

console.log('test:session-persistence OK');
