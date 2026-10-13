const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAY_MS = 5000;

function positiveInteger(value, fallback, minimum = 1, maximum = 60000) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback;
}

function normalizeBaseUrl(value) {
  const url = new URL(String(value || '').trim());
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) {
    throw new Error('HOSTED_MONITOR_URL debe usar HTTPS o apuntar a localhost.');
  }
  url.pathname = url.pathname.replace(/\/$/, '');
  url.search = '';
  url.hash = '';
  return url;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function fetchJson(url, { fetchImpl, timeoutMs }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  timeout.unref?.();
  try {
    const response = await fetchImpl(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'Administrau-Hosted-Monitor/1.0' },
      redirect: 'error',
      signal: controller.signal
    });
    const body = await response.json().catch(() => null);
    return { body, ok: response.ok, statusCode: response.status };
  } finally {
    clearTimeout(timeout);
  }
}

function validLive(result) {
  return result?.ok === true
    && result.body?.status === 'healthy'
    && result.body?.checks?.app === 'ok';
}

function validReady(result) {
  const checks = result?.body?.checks || {};
  return result?.ok === true
    && result.body?.status === 'healthy'
    && checks.database === 'ok'
    && checks.migrations === 'ok'
    && checks.rateLimitStore === 'ok';
}

async function runHostedMonitor(options = {}) {
  const environment = options.environment || process.env;
  const baseUrl = normalizeBaseUrl(options.baseUrl || environment.HOSTED_MONITOR_URL);
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('El monitor requiere fetch.');
  const attempts = positiveInteger(options.attempts || environment.HOSTED_MONITOR_ATTEMPTS, DEFAULT_ATTEMPTS, 1, 10);
  const timeoutMs = positiveInteger(options.timeoutMs || environment.HOSTED_MONITOR_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);
  const retryDelayMs = positiveInteger(options.retryDelayMs || environment.HOSTED_MONITOR_RETRY_DELAY_MS, DEFAULT_RETRY_DELAY_MS, 0);
  const pause = options.delayImpl || delay;
  let lastFailure = 'HOSTED_MONITOR_UNAVAILABLE';

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const started = Date.now();
    try {
      const [live, ready] = await Promise.all([
        fetchJson(new URL('/health/live', baseUrl), { fetchImpl, timeoutMs }),
        fetchJson(new URL('/health/ready', baseUrl), { fetchImpl, timeoutMs })
      ]);
      if (validLive(live) && validReady(ready)) {
        return Object.freeze({
          status: 'healthy', attempt, durationMs: Date.now() - started,
          checks: { application: 'ok', database: 'ok', migrations: 'ok', rateLimitStore: 'ok' }
        });
      }
      lastFailure = !validLive(live) ? 'LIVENESS_FAILED' : 'READINESS_FAILED';
    } catch (error) {
      lastFailure = error?.name === 'AbortError' ? 'HOSTED_MONITOR_TIMEOUT' : 'HOSTED_MONITOR_REQUEST_FAILED';
    }
    if (attempt < attempts && retryDelayMs > 0) await pause(retryDelayMs);
  }
  const error = new Error('El entorno hospedado no superó el monitoreo.');
  error.code = lastFailure;
  throw error;
}

async function main() {
  try {
    const result = await runHostedMonitor();
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(JSON.stringify({ status: 'unhealthy', code: error?.code || 'HOSTED_MONITOR_CONFIGURATION_ERROR' }));
    process.exitCode = 1;
  }
}

if (require.main === module) void main();

module.exports = { normalizeBaseUrl, runHostedMonitor, validLive, validReady };
