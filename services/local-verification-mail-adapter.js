function createLocalVerificationMailAdapter() {
  const messages = [];

  async function sendVerification({ recipient, token, expiresAt }) {
    messages.push(Object.freeze({ kind: 'verificacion_correo', recipient, token, expiresAt }));
    return Object.freeze({ accepted: true });
  }

  async function sendPasswordRecovery({ recipient, token, expiresAt }) {
    messages.push(Object.freeze({ kind: 'recuperacion_password', recipient, token, expiresAt }));
    return Object.freeze({ accepted: true });
  }

  function takeLatestForTests() {
    const verification = messages.filter((message) => message.kind === 'verificacion_correo');
    return verification.length ? verification[verification.length - 1] : null;
  }

  function takeLatestRecoveryForTests() {
    const recovery = messages.filter((message) => message.kind === 'recuperacion_password');
    return recovery.length ? recovery[recovery.length - 1] : null;
  }

  function clearForTests() {
    messages.length = 0;
  }

  return Object.freeze({
    clearForTests,
    sendPasswordRecovery,
    sendVerification,
    takeLatestForTests,
    takeLatestRecoveryForTests
  });
}

const localVerificationMailAdapter = createLocalVerificationMailAdapter();

module.exports = { createLocalVerificationMailAdapter, localVerificationMailAdapter };
