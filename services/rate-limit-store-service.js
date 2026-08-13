const { RedisStore } = require('rate-limit-redis');
const { createClient } = require('redis');

function createMemoryBackend() {
  return Object.freeze({
    distributed: false,
    storeFor: () => undefined,
    ready: async () => {},
    health: async () => ({ status: 'ok' }),
    close: async () => {}
  });
}

function createRedisBackend(config, { createClientImpl = createClient, RedisStoreClass = RedisStore, logger = null } = {}) {
  const client = createClientImpl({
    url: config.url,
    socket: {
      connectTimeout: 5000,
      reconnectStrategy: (retries) => retries >= 5 ? false : Math.min(100 * (retries + 1), 2000)
    }
  });
  if (!client || typeof client.connect !== 'function' || typeof client.sendCommand !== 'function') {
    throw new Error('No se pudo crear el cliente del store distribuido.');
  }
  if (typeof client.on === 'function') {
    client.on('error', (error) => logger?.warn('rate_limit_store_error', {
      errorName: error?.name || 'Error',
      errorCode: typeof error?.code === 'string' ? error.code.slice(0, 80) : null
    }));
  }
  let connection = null;
  function ready() {
    if (!connection) {
      connection = Promise.resolve(client.connect())
        .then(() => client.ping())
        .then(() => undefined);
    }
    return connection;
  }
  function storeFor(identifier) {
    return new RedisStoreClass({
      prefix: `${config.prefix}${identifier}:`,
      sendCommand: (...args) => ready().then(() => client.sendCommand(args))
    });
  }
  async function health() {
    await ready();
    const result = await client.ping();
    if (result !== 'PONG') throw new Error('El store distribuido no respondio correctamente.');
    return Object.freeze({ status: 'ok' });
  }
  async function close() {
    if (!client.isOpen) return;
    if (client.isReady) await client.quit();
    else if (typeof client.destroy === 'function') client.destroy();
  }
  return Object.freeze({ distributed: true, storeFor, ready, health, close });
}

function createRateLimitStoreBackend(config, dependencies = {}) {
  if (!config || config.type === 'memory') return createMemoryBackend();
  if (config.type !== 'redis') throw new Error('RATE_LIMIT_STORE no es compatible.');
  return createRedisBackend(config, dependencies);
}

module.exports = {
  createMemoryBackend,
  createRateLimitStoreBackend,
  createRedisBackend
};
