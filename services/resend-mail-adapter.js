const { RESEND_PROVIDER, resendConfig } = require('../config/email-delivery');
const { deliveryInput, messageContent } = require('./mailtrap-sandbox-mail-adapter');

const RESEND_EMAIL_ENDPOINT = 'https://api.resend.com/emails';

function deliveryError(code) {
  const error = new Error('No se pudo entregar el correo.');
  error.code = code;
  return error;
}

function sender(from) {
  return from.name ? `${from.name} <${from.email}>` : from.email;
}

function createResendMailAdapter(environment = process.env, {
  fetchImpl = globalThis.fetch,
  AbortControllerImpl = globalThis.AbortController,
  setTimeoutImpl = setTimeout,
  clearTimeoutImpl = clearTimeout
} = {}) {
  const config = resendConfig(environment);
  if (typeof fetchImpl !== 'function' || typeof AbortControllerImpl !== 'function') {
    throw deliveryError('EMAIL_DELIVERY_ADAPTER_INVALID');
  }

  async function send(kind, payload) {
    const input = deliveryInput(payload || {}, kind);
    const content = messageContent(kind, input);
    const controller = new AbortControllerImpl();
    const timeout = setTimeoutImpl(() => controller.abort(), config.timeoutMs);
    timeout?.unref?.();
    try {
      const response = await fetchImpl(RESEND_EMAIL_ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: sender(config.from),
          to: [input.recipient],
          subject: content.subject,
          text: content.text,
          html: content.html,
          tags: [{ name: 'category', value: kind === 'verification' ? 'verify_email' : 'password_reset' }]
        }),
        redirect: 'error',
        signal: controller.signal
      });
      if (!response?.ok) throw deliveryError('EMAIL_DELIVERY_PROVIDER_REJECTED');
      const result = await response.json().catch(() => null);
      if (!result?.id) throw deliveryError('EMAIL_DELIVERY_PROVIDER_RESPONSE_INVALID');
      return Object.freeze({ accepted: true, provider: RESEND_PROVIDER, id: String(result.id) });
    } catch (error) {
      if (String(error?.code || '').startsWith('EMAIL_DELIVERY_')) throw error;
      if (error?.name === 'AbortError' || controller.signal.aborted) throw deliveryError('EMAIL_DELIVERY_TIMEOUT');
      throw deliveryError('EMAIL_DELIVERY_NETWORK_FAILURE');
    } finally {
      clearTimeoutImpl(timeout);
    }
  }

  return Object.freeze({
    sendPasswordRecovery: (payload) => send('recovery', payload),
    sendVerification: (payload) => send('verification', payload)
  });
}

module.exports = { RESEND_EMAIL_ENDPOINT, createResendMailAdapter };
