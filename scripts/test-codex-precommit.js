const assert = require('assert');
const {
  EXIT_CODES,
  inspectPrecommit,
  writeReport
} = require('./codex-precommit');

const SECRET = 'super-secret-value-should-not-appear';

function snapshot(files = [], overrides = {}) {
  return {
    branch: 'mejora-multitienda', head: 'abc1234', files,
    unresolved: [], diffCheck: true, stagedDiffCheck: true,
    migrationAtHead: () => false,
    ...overrides
  };
}

function inspect(files, contents, overrides = {}) {
  return inspectPrecommit({
    snapshot: snapshot(files, overrides.snapshot),
    allow: overrides.allow || files.map((entry) => entry.file),
    readFile: (file) => contents[file],
    nodeCheck: (file) => overrides.syntax?.[file] !== false,
    readMigrationDirectory: overrides.readMigrationDirectory || (() => ['001_base.sql', '002_next.sql'])
  });
}

function entry(file, options = {}) {
  return { file, staged: false, unstaged: true, untracked: false, ...options };
}

function main() {
  const clean = inspect([], {});
  assert.equal(clean.exitCode, EXIT_CODES.pass);

  const validJs = inspect([entry('scripts/valid.js', { staged: true })], { 'scripts/valid.js': 'module.exports = {};\n' });
  assert.equal(validJs.exitCode, EXIT_CODES.pass);

  const syntax = inspect([entry('scripts/broken.js')], { 'scripts/broken.js': 'const = ;' }, { syntax: { 'scripts/broken.js': false } });
  assert.equal(syntax.exitCode, EXIT_CODES.blocked);

  const json = inspect([entry('package.json')], { 'package.json': '{invalid' });
  assert.equal(json.exitCode, EXIT_CODES.blocked);

  const conflict = inspect([entry('services/conflict.js')], { 'services/conflict.js': '<<<<<<< HEAD\n' });
  assert.equal(conflict.exitCode, EXIT_CODES.blocked);

  const environment = inspect([entry('.env')], { '.env': 'DB_PASSWORD=x' });
  assert.equal(environment.exitCode, EXIT_CODES.blocked);

  const example = inspect([entry('.env.example')], { '.env.example': 'DB_PASSWORD=placeholder' });
  assert.equal(example.exitCode, EXIT_CODES.pass);

  const dump = inspect([entry('backups/tienda_2026-01-01_000000.sql')], { 'backups/tienda_2026-01-01_000000.sql': '' });
  assert.equal(dump.exitCode, EXIT_CODES.blocked);

  const secret = inspect([entry('config/live.js')], { 'config/live.js': `const password = '${SECRET}';` });
  assert.equal(secret.exitCode, EXIT_CODES.blocked);
  const lines = [];
  writeReport(secret, (line) => lines.push(line));
  assert(!lines.join('\n').includes(SECRET), 'El reporte no debe imprimir secretos.');

  const docs = inspect([entry('docs/ejemplo.md')], { 'docs/ejemplo.md': `password=${SECRET}` });
  assert.equal(docs.exitCode, EXIT_CODES.pass, 'La documentacion generica no debe producir falso positivo.');

  const applied = inspect([entry('database/migrations/001_base.sql')], { 'database/migrations/001_base.sql': 'ALTER TABLE x;' }, {
    snapshot: { migrationAtHead: () => true }
  });
  assert.equal(applied.exitCode, EXIT_CODES.blocked);

  const newMigration = inspect([entry('database/migrations/003_new.sql', { staged: true })], { 'database/migrations/003_new.sql': 'ALTER TABLE x;' }, {
    readMigrationDirectory: () => ['001_base.sql', '002_next.sql', '003_new.sql']
  });
  assert.equal(newMigration.exitCode, EXIT_CODES.warning);

  const outsideScope = inspect([entry('scripts/a.js', { staged: true }), entry('package.json')], {
    'scripts/a.js': 'module.exports = {};', 'package.json': '{}'
  }, { allow: ['scripts/a.js'] });
  assert.equal(outsideScope.exitCode, EXIT_CODES.blocked);

  const noScope = inspect([entry('scripts/a.js')], { 'scripts/a.js': 'module.exports = {};' }, { allow: [] });
  assert.equal(noScope.exitCode, EXIT_CODES.warning);
  console.log('OK: codex precommit cubre PASS, WARNING y BLOCKED sin secretos.');
}

try {
  main();
} catch (error) {
  console.error(`FAIL: ${error.message}`);
  process.exitCode = 1;
}
