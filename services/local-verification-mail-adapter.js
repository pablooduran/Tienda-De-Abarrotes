function assertLocalDelivery(environment = process.env) {
  const mode = String(environment.APP_ENV || '').trim().toLowerCase();
  if (mode === 'staging' || mode === 'production') {
    const error = new Error('La entrega de correo local no esta disponible en entornos hospedados.');
    error.code = 'EMAIL_DELIVERY_NOT_CONFIGURED';
    throw error;
  }
}

function createLocalVerificationMailAdapter() {
  const messages = [];

  async function sendVerification({ recipient, token, expiresAt }) {
    assertLocalDelivery();
    messages.push(Object.freeze({ kind: 'verificacion_correo', recipient, token, expiresAt }));
    return Object.freeze({ accepted: true });
  }

  async function sendPasswordRecovery({ recipient, token, expiresAt }) {
    assertLocalDelivery();
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

module.exports = { assertLocalDelivery, createLocalVerificationMailAdapter, localVerificationMailAdapter };
