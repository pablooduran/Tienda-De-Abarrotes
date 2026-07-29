const assert = require('assert');
const {
  EXIT_CODES,
  collectCleanupCheck,
  inspectBackupDirectory,
  writeCleanup
} = require('./codex-cleanup-check');

const SECRET = 'do-not-print-this-cleanup-secret';

function localConfig() {
  return {
    appEnvironment: 'local', host: 'localhost', database: 'tienda_abarrotes_pruebas',
    user: 'test-user', password: SECRET, port: 3306
  };
}

async function check(overrides = {}) {
  return collectCleanupCheck({
    config: localConfig(),
    gitStatus: () => [],
    trackedEnvironment: () => [],
    fileInspector: () => [],
    processInspector: () => ({ processes: [], ports: [] }),
    fixtureInspector: async () => ({ temporaryDatabases: [], fixtures: [] }),
    ...overrides
  });
}

async function main() {
  const clean = await check();
  assert.equal(clean.exitCode, EXIT_CODES.clean);

  const dirty = await check({ gitStatus: () => [' M package.json'] });
  assert.equal(dirty.exitCode, EXIT_CODES.warning);
  assert(dirty.findings.some((item) => item.code === 'WORKING_TREE_DIRTY'));

  const temporaryDatabase = await check({
    fixtureInspector: async () => ({ temporaryDatabases: ['tmp_tienda_restore_fixture'], fixtures: [] })
  });
  assert.equal(temporaryDatabase.exitCode, EXIT_CODES.authorization);

  const port = await check({ processInspector: () => ({ processes: [], ports: [3100] }) });
  assert.equal(port.exitCode, EXIT_CODES.warning);

  const ignoredProcess = await check({ processInspector: () => ({ processes: [], ports: [] }) });
  assert.equal(ignoredProcess.exitCode, EXIT_CODES.clean, 'Un proceso sin evidencia debe ignorarse.');

  const remote = await check({ config: { ...localConfig(), host: 'db.example.test' } });
  assert.equal(remote.exitCode, EXIT_CODES.authorization);

  const backupEntries = [
    'tienda_abarrotes_pruebas_2026-07-28_193554.sql.partial',
    'tienda_abarrotes_pruebas_2026-07-28_193555.manifest.json'
  ].map((name) => ({ name, isFile: () => true, isSymbolicLink: () => false }));
  const backupFindings = inspectBackupDirectory('virtual-backups', {
    lstatSync: () => ({ isDirectory: () => true, isSymbolicLink: () => false }),
    readdirSync: () => backupEntries
  });
  assert(backupFindings.includes('BACKUP_PARTIAL'));
  assert(backupFindings.includes('BACKUP_MANIFEST_ORPHAN'));

  const lines = [];
  writeCleanup(await check(), (line) => lines.push(line));
  assert(!lines.join('\n').includes(SECRET), 'La salida no debe contener secretos.');
  console.log('OK: codex cleanup check cubre hallazgos y codigos 0, 1 y 2 sin secretos.');
}

main().catch((error) => {
  console.error(`FAIL: ${error.message}`);
  process.exitCode = 1;
});
