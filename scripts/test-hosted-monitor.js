const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { normalizeBaseUrl, runHostedMonitor, validLive, validReady } = require('./check-hosted-health');

function response(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

async function main() {
  const workflow = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'staging-monitor.yml'), 'utf8');
  assert.match(workflow, /cron:\s*'\*\/15 \* \* \* \*'/);
  assert.match(workflow, /node scripts\/check-hosted-health\.js/);
  assert.match(workflow, /HOSTED_MONITOR_URL:\s*https:\/\/tienda-de-abarrotes-staging\.onrender\.com/);
  assert.equal(normalizeBaseUrl('https://example.test/').href, 'https://example.test/');
  assert.throws(() => normalizeBaseUrl('http://example.test'), /HTTPS/);
  assert.equal(validLive({ ok: true, body: { status: 'healthy', checks: { app: 'ok' } } }), true);
  assert.equal(validReady({ ok: true, body: { status: 'healthy', checks: {
    database: 'ok', migrations: 'ok', rateLimitStore: 'ok'
  } } }), true);

  const paths = [];
  const healthy = await runHostedMonitor({
    baseUrl: 'https://example.test', attempts: 1, retryDelayMs: 0,
    fetchImpl: async (url) => {
      paths.push(new URL(url).pathname);
      return String(url).endsWith('/health/live')
        ? response(200, { status: 'healthy', checks: { app: 'ok' } })
        : response(200, { status: 'healthy', checks: { database: 'ok', migrations: 'ok', rateLimitStore: 'ok' } });
    }
  });
  assert.equal(healthy.status, 'healthy');
  assert.deepEqual(paths.sort(), ['/health/live', '/health/ready']);

  let requests = 0;
  await assert.rejects(runHostedMonitor({
    baseUrl: 'https://example.test', attempts: 2, retryDelayMs: 0,
    delayImpl: async () => {},
    fetchImpl: async (url) => {
      requests += 1;
      return String(url).endsWith('/health/live')
        ? response(200, { status: 'healthy', checks: { app: 'ok' } })
        : response(503, { status: 'unhealthy', checks: { database: 'unavailable' } });
    }
  }), (error) => error.code === 'READINESS_FAILED');
  assert.equal(requests, 4);
  console.log('test:hosted-monitor OK');
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
