const { normalizeEmail } = require('../config/public-registration-contract');
const { validateVerificationToken } = require('../config/email-verification-contract');
const {
  MAILTRAP_SANDBOX_PROVIDER,
  mailtrapSandboxConfig
} = require('../config/email-delivery');

const MAILTRAP_SANDBOX_ENDPOINT = 'https://sandbox.api.mailtrap.io/api/send';
const EXPIRATION = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

function deliveryError(code) {
  const error = new Error('No se pudo entregar el correo.');
  error.code = code;
  return error;
}

function escapedHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function deliveryInput({ recipient, token, expiresAt }) {
  let safeRecipient;
  let safeToken;
  try {
    safeRecipient = normalizeEmail(recipient);
    safeToken = validateVerificationToken(token);
  } catch {
    throw deliveryError('EMAIL_DELIVERY_INPUT_INVALID');
  }
  const safeExpiration = String(expiresAt || '').trim();
  if (!EXPIRATION.test(safeExpiration)) {
    throw deliveryError('EMAIL_DELIVERY_INPUT_INVALID');
  }
  return Object.freeze({
    expiresAt: safeExpiration,
    recipient: safeRecipient,
    token: safeToken
  });
}

function messageContent(kind, input) {
  const verification = kind === 'verification';
  const subject = verification
    ? 'Verifica tu correo en Tienda de Abarrotes'
    : 'Restablece tu contrasena en Tienda de Abarrotes';
  const action = verification ? 'verificacion de correo' : 'recuperacion de contrasena';
  const text = [
    `Codigo de ${action}:`,
    input.token,
    `Vence: ${input.expiresAt}`,
    'Este mensaje pertenece al entorno sintetico de staging.'
  ].join('\n\n');
  const html = [
    `<h1>${escapedHtml(subject)}</h1>`,
    `<p>Codigo de ${escapedHtml(action)}:</p>`,
    `<p><strong>${escapedHtml(input.token)}</strong></p>`,
    `<p>Vence: ${escapedHtml(input.expiresAt)}</p>`,
    '<p>Este mensaje pertenece al entorno sintetico de staging.</p>'
  ].join('');
  return Object.freeze({ html, subject, text });
}

function createMailtrapSandboxMailAdapter(environment = process.env, {
  fetchImpl = globalThis.fetch,
  AbortControllerImpl = globalThis.AbortController,
  setTimeoutImpl = setTimeout,
  clearTimeoutImpl = clearTimeout
} = {}) {
  const config = mailtrapSandboxConfig(environment);
  if (typeof fetchImpl !== 'function' || typeof AbortControllerImpl !== 'function'
    || typeof setTimeoutImpl !== 'function' || typeof clearTimeoutImpl !== 'function') {
    throw deliveryError('EMAIL_DELIVERY_ADAPTER_INVALID');
  }

  async function send(kind, payload) {
    const input = deliveryInput(payload || {});
    const content = messageContent(kind, input);
    const controller = new AbortControllerImpl();
    const timeout = setTimeoutImpl(() => controller.abort(), config.timeoutMs);
    timeout?.unref?.();
    try {
      const response = await fetchImpl(`${MAILTRAP_SANDBOX_ENDPOINT}/${config.inboxId}`, {
        method: 'POST',
        headers: {
          'Api-Token': config.apiToken,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: config.from,
          to: [{ email: input.recipient }],
          subject: content.subject,
          text: content.text,
          html: content.html
        }),
        redirect: 'error',
        signal: controller.signal
      });
      if (controller.signal.aborted) throw deliveryError('EMAIL_DELIVERY_TIMEOUT');
      if (!response || response.ok !== true || typeof response.json !== 'function') {
        throw deliveryError('EMAIL_DELIVERY_PROVIDER_REJECTED');
      }
      let result;
      try {
        result = await response.json();
      } catch {
        throw deliveryError('EMAIL_DELIVERY_PROVIDER_RESPONSE_INVALID');
      }
      if (controller.signal.aborted) throw deliveryError('EMAIL_DELIVERY_TIMEOUT');
      if (!result || result.success !== true) {
        throw deliveryError('EMAIL_DELIVERY_PROVIDER_RESPONSE_INVALID');
      }
      return Object.freeze({ accepted: true, provider: MAILTRAP_SANDBOX_PROVIDER });
    } catch (error) {
      if (String(error?.code || '').startsWith('EMAIL_DELIVERY_')) throw error;
      if (error?.name === 'AbortError' || controller.signal.aborted) {
        throw deliveryError('EMAIL_DELIVERY_TIMEOUT');
      }
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

module.exports = {
  MAILTRAP_SANDBOX_ENDPOINT,
  createMailtrapSandboxMailAdapter,
  deliveryInput,
  messageContent
};
