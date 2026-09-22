const assert = require('assert');

const { emailDeliveryConfig } = require('../config/email-delivery');
const {
  createConfiguredMailDeliveryAdapter,
  createMailDeliveryAdapter
} = require('../services/mail-delivery-adapter');
const { MAILTRAP_SANDBOX_ENDPOINT } = require('../services/mailtrap-sandbox-mail-adapter');

const TOKEN = 'A'.repeat(43);
const API_TOKEN = 'synthetic_mailtrap_token_1234567890';

function hostedEnvironment(extra = {}) {
  return { APP_ENV: 'staging', ...extra };
}

function mailtrapEnvironment(extra = {}) {
  return hostedEnvironment({
    EMAIL_DELIVERY_MODE: 'external',
    EMAIL_DELIVERY_PROVIDER: 'mailtrap-sandbox',
    MAILTRAP_API_TOKEN: API_TOKEN,
    MAILTRAP_INBOX_ID: '4015',
    EMAIL_FROM: 'Tienda Staging <notificaciones@staging.invalid>',
    ...extra
  });
}

async function main() {
  const local = emailDeliveryConfig({ APP_ENV: 'local' });
  assert.deepStrictEqual(local, { mode: 'local', provider: 'local' });

  const disabled = emailDeliveryConfig(hostedEnvironment());
  assert.deepStrictEqual(disabled, { mode: 'disabled', provider: null });
  const disabledWithUnusedMailtrapValues = emailDeliveryConfig(hostedEnvironment({
    MAILTRAP_API_TOKEN: 'not-selected',
    MAILTRAP_INBOX_ID: 'not-selected',
    EMAIL_FROM: 'not-selected'
  }));
  assert.deepStrictEqual(disabledWithUnusedMailtrapValues, disabled);
  const disabledAdapter = createMailDeliveryAdapter(disabled);
  await assert.rejects(
    disabledAdapter.sendVerification({ recipient: 'synthetic@example.test', token: 'hidden' }),
    (error) => error.code === 'EMAIL_DELIVERY_DISABLED'
  );
  await assert.rejects(
    disabledAdapter.sendPasswordRecovery({ recipient: 'synthetic@example.test', token: 'hidden' }),
    (error) => error.code === 'EMAIL_DELIVERY_DISABLED'
  );

  assert.throws(
    () => emailDeliveryConfig(hostedEnvironment({ EMAIL_DELIVERY_MODE: 'external' })),
    /adaptador registrado/
  );
  assert.throws(
    () => emailDeliveryConfig(hostedEnvironment({
      EMAIL_DELIVERY_MODE: 'external',
      EMAIL_DELIVERY_PROVIDER: 'synthetic'
    })),
    /adaptador externo registrado/
  );
  assert.throws(
    () => emailDeliveryConfig(hostedEnvironment({ EMAIL_DELIVERY_PROVIDER: 'synthetic' })),
    /debe estar ausente/
  );
  assert.throws(
    () => emailDeliveryConfig({
      APP_ENV: 'production',
      EMAIL_DELIVERY_MODE: 'external',
      EMAIL_DELIVERY_PROVIDER: 'mailtrap-sandbox'
    }),
    /solo se permite en staging/
  );
  assert.throws(
    () => emailDeliveryConfig(mailtrapEnvironment({ MAILTRAP_API_TOKEN: 'replace-me' })),
    /MAILTRAP_API_TOKEN/
  );
  assert.throws(
    () => emailDeliveryConfig(mailtrapEnvironment({ MAILTRAP_INBOX_ID: '../4015' })),
    /MAILTRAP_INBOX_ID/
  );
  assert.throws(
    () => emailDeliveryConfig(mailtrapEnvironment({ EMAIL_FROM: 'unsafe\r\nBcc: hidden@example.test' })),
    /EMAIL_FROM/
  );
  assert.throws(
    () => emailDeliveryConfig(mailtrapEnvironment({ EMAIL_DELIVERY_TIMEOUT_MS: '999' })),
    /EMAIL_DELIVERY_TIMEOUT_MS/
  );

  const requests = [];
  const configured = createConfiguredMailDeliveryAdapter(mailtrapEnvironment(), {
    fetchImpl: async (url, request) => {
      requests.push({ url, request });
      return { ok: true, async json() { return { success: true, message_ids: ['synthetic-id'] }; } };
    }
  });
  await configured.sendVerification({
    recipient: 'verification@example.test', token: TOKEN, expiresAt: '2026-09-19 10:00:00'
  });
  await configured.sendPasswordRecovery({
    recipient: 'recovery@example.test', token: TOKEN, expiresAt: '2026-09-19 11:00:00'
  });
  assert.strictEqual(requests.length, 2);
  for (const { url, request } of requests) {
    assert.strictEqual(url, `${MAILTRAP_SANDBOX_ENDPOINT}/4015`);
    assert.strictEqual(request.method, 'POST');
    assert.strictEqual(request.headers['Api-Token'], API_TOKEN);
    assert.strictEqual(request.headers['Content-Type'], 'application/json');
    assert.strictEqual(request.redirect, 'error');
    assert(request.signal);
    const body = JSON.parse(request.body);
    assert.deepStrictEqual(body.from, { email: 'notificaciones@staging.invalid', name: 'Tienda Staging' });
    assert.strictEqual(body.to.length, 1);
    assert.match(body.to[0].email, /@(example\.test)$/);
    assert.match(body.text, new RegExp(TOKEN));
    assert.match(body.html, new RegExp(TOKEN));
  }

  await assert.rejects(
    configured.sendVerification({ recipient: 'invalid', token: TOKEN, expiresAt: '2026-09-19 10:00:00' }),
    (error) => error.code === 'EMAIL_DELIVERY_INPUT_INVALID'
  );
  assert.strictEqual(requests.length, 2);

  let providerErrorBodyRead = false;
  const providerRejected = createConfiguredMailDeliveryAdapter(mailtrapEnvironment(), {
    fetchImpl: async () => ({
      ok: false,
      status: 401,
      async text() { providerErrorBodyRead = true; return API_TOKEN; }
    })
  });
  await assert.rejects(
    providerRejected.sendVerification({
      recipient: 'verification@example.test', token: TOKEN, expiresAt: '2026-09-19 10:00:00'
    }),
    (error) => error.code === 'EMAIL_DELIVERY_PROVIDER_REJECTED'
      && !error.message.includes(API_TOKEN)
  );
  assert.strictEqual(providerErrorBodyRead, false);

  const networkFailed = createConfiguredMailDeliveryAdapter(mailtrapEnvironment(), {
    fetchImpl: async () => { throw new Error(`provider detail ${API_TOKEN}`); }
  });
  await assert.rejects(
    networkFailed.sendVerification({
      recipient: 'verification@example.test', token: TOKEN, expiresAt: '2026-09-19 10:00:00'
    }),
    (error) => error.code === 'EMAIL_DELIVERY_NETWORK_FAILURE'
      && !error.message.includes(API_TOKEN)
  );

  const timedOut = createConfiguredMailDeliveryAdapter(mailtrapEnvironment(), {
    setTimeoutImpl(callback) { callback(); return 1; },
    clearTimeoutImpl() {},
    fetchImpl: async (_url, request) => {
      assert.strictEqual(request.signal.aborted, true);
      const error = new Error('hidden timeout detail');
      error.name = 'AbortError';
      throw error;
    }
  });
  await assert.rejects(
    timedOut.sendPasswordRecovery({
      recipient: 'recovery@example.test', token: TOKEN, expiresAt: '2026-09-19 11:00:00'
    }),
    (error) => error.code === 'EMAIL_DELIVERY_TIMEOUT'
      && !error.message.includes('hidden timeout detail')
  );

  assert.throws(
    () => createMailDeliveryAdapter({ mode: 'external', provider: 'invalid' }, {
      externalAdapters: { invalid: { sendVerification() {} } }
    }),
    (error) => error.code === 'EMAIL_DELIVERY_ADAPTER_INVALID'
  );

  console.log(JSON.stringify({
    resultado: 'PASS',
    defaultHosted: 'disabled',
    realNetworkCalls: 0,
    mockedProviderCalls: requests.length,
    providerIntegrated: 'mailtrap-sandbox',
    contracts: ['verification', 'recovery']
  }, null, 2));
}

main().catch((error) => {
  console.error(`Error: ${String(error?.code || 'EMAIL_DELIVERY_TEST_FAILED')}`);
  process.exitCode = 1;
});
