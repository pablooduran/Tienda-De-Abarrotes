function closeHttpServer(server) {
  if (!server || !server.listening) return Promise.resolve();
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function createGracefulShutdown(options) {
  const {
    server,
    pool,
    sessionStore,
    logger,
    timeoutMs = 10000,
    exit = (code) => process.exit(code),
    timers = { setTimeout, clearTimeout }
  } = options || {};
  if (!pool || typeof pool.end !== 'function' || !logger) {
    throw new Error('El cierre ordenado requiere servidor, pool y logger.');
  }
  let closing = null;

  return function shutdown(signal = 'UNKNOWN') {
    if (closing) return closing;
    closing = (async () => {
      logger.info('server_shutdown_started', { signal });
      let timeout;
      const deadline = new Promise((resolve) => {
        timeout = timers.setTimeout(() => resolve('timeout'), timeoutMs);
      });
      const graceful = (async () => {
        await closeHttpServer(server);
        if (sessionStore && typeof sessionStore.close === 'function') {
          await sessionStore.close();
        }
        await pool.end();
        return 'completed';
      })();
      try {
        const outcome = await Promise.race([graceful, deadline]);
        if (outcome === 'timeout') {
          logger.error('server_shutdown_timeout', { signal, timeoutMs });
          if (typeof server?.closeAllConnections === 'function') server.closeAllConnections();
          exit(1);
          return { status: 'timeout', exitCode: 1 };
        }
        timers.clearTimeout(timeout);
        logger.info('server_shutdown_completed', { signal });
        exit(0);
        return { status: 'completed', exitCode: 0 };
      } catch (error) {
        timers.clearTimeout(timeout);
        logger.error('server_shutdown_failed', {
          signal,
          errorName: error?.name || 'Error',
          errorCode: typeof error?.code === 'string' ? error.code.slice(0, 80) : null
        });
        if (typeof server?.closeAllConnections === 'function') server.closeAllConnections();
        exit(1);
        return { status: 'failed', exitCode: 1 };
      }
    })();
    return closing;
  };
}

function installShutdownHandlers(processObject, shutdown) {
  const handlers = new Map([
    ['SIGTERM', () => void shutdown('SIGTERM')],
    ['SIGINT', () => void shutdown('SIGINT')]
  ]);
  for (const [signal, handler] of handlers) processObject.once(signal, handler);
  return () => {
    for (const [signal, handler] of handlers) processObject.removeListener(signal, handler);
  };
}

async function announceInitialReadiness(healthService, logger) {
  try {
    const readiness = await healthService.readiness({ bypassCache: true });
    const context = { status: readiness.status, durationMs: readiness.durationMs };
    if (readiness.status === 'unhealthy') {
      logger.warn('server_started_not_ready', { ...context, reason: readiness.reason });
    } else {
      logger.info('server_started_ready', context);
    }
    return readiness;
  } catch (error) {
    logger.error('initial_readiness_failed', {
      errorName: error?.name || 'Error',
      errorCode: typeof error?.code === 'string' ? error.code.slice(0, 80) : null
    });
    return null;
  }
}

module.exports = {
  announceInitialReadiness,
  closeHttpServer,
  createGracefulShutdown,
  installShutdownHandlers
};
