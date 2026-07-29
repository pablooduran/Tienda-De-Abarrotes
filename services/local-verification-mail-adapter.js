function createLocalVerificationMailAdapter() {
  const messages = [];

  async function sendVerification({ recipient, token, expiresAt }) {
    messages.push(Object.freeze({ recipient, token, expiresAt }));
    return Object.freeze({ accepted: true });
  }

  function takeLatestForTests() {
    return messages.length ? messages[messages.length - 1] : null;
  }

  function clearForTests() {
    messages.length = 0;
  }

  return Object.freeze({ clearForTests, sendVerification, takeLatestForTests });
}

const localVerificationMailAdapter = createLocalVerificationMailAdapter();

module.exports = { createLocalVerificationMailAdapter, localVerificationMailAdapter };
