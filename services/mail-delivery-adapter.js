const {
  MAILTRAP_SANDBOX_PROVIDER,
  REGISTERED_EMAIL_PROVIDERS,
  emailDeliveryConfig
} = require('../config/email-delivery');
const {
  localVerificationMailAdapter
} = require('./local-verification-mail-adapter');
const { createMailtrapSandboxMailAdapter } = require('./mailtrap-sandbox-mail-adapter');

const REQUIRED_METHODS = Object.freeze(['sendVerification', 'sendPasswordRecovery']);

function deliveryUnavailableError(code) {
  const error = new Error('La entrega de correo no esta disponible.');
  error.code = code;
  return error;
}

function assertMailDeliveryAdapter(adapter) {
  if (!adapter || REQUIRED_METHODS.some((method) => typeof adapter[method] !== 'function')) {
    throw deliveryUnavailableError('EMAIL_DELIVERY_ADAPTER_INVALID');
  }
  return adapter;
}

function createDisabledMailAdapter() {
  async function unavailable() {
    throw deliveryUnavailableError('EMAIL_DELIVERY_DISABLED');
  }
  return Object.freeze({
    sendPasswordRecovery: unavailable,
    sendVerification: unavailable
  });
}

function createMailDeliveryAdapter(config, {
  localAdapter = localVerificationMailAdapter,
  externalAdapters = {}
} = {}) {
  if (config?.mode === 'local') return assertMailDeliveryAdapter(localAdapter);
  if (config?.mode === 'disabled') return createDisabledMailAdapter();
  if (config?.mode === 'external') {
    return assertMailDeliveryAdapter(externalAdapters[config.provider]);
  }
  throw deliveryUnavailableError('EMAIL_DELIVERY_CONFIGURATION_INVALID');
}

function createConfiguredMailDeliveryAdapter(environment = process.env, options = {}) {
  const config = emailDeliveryConfig(environment, {
    registeredProviders: REGISTERED_EMAIL_PROVIDERS
  });
  const externalAdapters = { ...(options.externalAdapters || {}) };
  if (config.mode === 'external' && config.provider === MAILTRAP_SANDBOX_PROVIDER
    && !externalAdapters[MAILTRAP_SANDBOX_PROVIDER]) {
    externalAdapters[MAILTRAP_SANDBOX_PROVIDER] = createMailtrapSandboxMailAdapter(environment, options);
  }
  return createMailDeliveryAdapter(config, { ...options, externalAdapters });
}

const mailDeliveryAdapter = createConfiguredMailDeliveryAdapter();

module.exports = {
  assertMailDeliveryAdapter,
  createConfiguredMailDeliveryAdapter,
  createDisabledMailAdapter,
  createMailDeliveryAdapter,
  mailDeliveryAdapter
};
