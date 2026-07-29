const assert = require('assert');
const {
  EXIT_CODES,
  collectProjectStatus,
  writeStatus
} = require('./codex-project-status');

const SECRET = 'do-not-print-this-secret';

function localConfig() {
  return {
    appEnvironment: 'local', host: 'localhost', database: 'tienda_abarrotes_pruebas',
    user: 'test-user', password: SECRET, port: 3306
  };
}

function cleanGit() {
  return { branch: 'mejora-multitienda', head: 'abc1234', upstream: 'origin/mejora-multitienda', sync: 'synchronized', dirtyFiles: [] };
}

async function status(overrides = {}) {
  return collectProjectStatus({
    config: localConfig(),
    gitReader: cleanGit,
    processInspector: () => ({ processes: [], ports: [] }),
    applicationReader: async () => ({ status: 'healthy' }),
    databaseReader: async () => ({ status: 'healthy', maxMigration: 19 }),
    backupReader: async () => ({ status: 'ok', code: 'BACKUP_OK' }),
    ...overrides
  });
}

async function main() {
  const healthy = await status();
  assert.equal(healthy.exitCode, EXIT_CODES.healthy);
  assert.equal(healthy.status, 'healthy');

  const dirty = await status({ gitReader: () => ({ ...cleanGit(), dirtyFiles: [' M package.json'] }) });
  assert.equal(dirty.exitCode, EXIT_CODES.warning);

  const remote = await status({ config: { ...localConfig(), host: 'db.example.test' } });
  assert.equal(remote.exitCode, EXIT_CODES.blocked);
  assert.equal(remote.environment.target.host, 'remote');

  const nonLocal = await status({ config: { ...localConfig(), appEnvironment: 'production' } });
  assert.equal(nonLocal.exitCode, EXIT_CODES.blocked);

  const unavailable = await status({ databaseReader: async () => ({ status: 'unavailable', maxMigration: null }) });
  assert.equal(unavailable.exitCode, EXIT_CODES.warning);
  assert.equal(unavailable.readiness, 'unavailable');

  const applicationUnavailable = await status({ applicationReader: async () => ({ status: 'not_running' }) });
  assert.equal(applicationUnavailable.exitCode, EXIT_CODES.warning);
  assert.equal(applicationUnavailable.readiness, 'not_running');

  const stale = await status({ backupReader: async () => ({ status: 'warning', code: 'BACKUP_STALE' }) });
  assert.equal(stale.exitCode, EXIT_CODES.warning);

  const lines = [];
  writeStatus(await status(), (line) => lines.push(line));
  assert(!lines.join('\n').includes(SECRET), 'La salida no debe contener secretos.');
  console.log('OK: codex project status cubre estados 0, 1 y 2 sin secretos.');
}

main().catch((error) => {
  console.error(`FAIL: ${error.message}`);
  process.exitCode = 1;
});
