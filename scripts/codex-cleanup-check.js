const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');
const {
  AUTHORIZED_DATABASE,
  databaseSafety,
  defaultProcessInspector,
  loadEnvironment
} = require('./codex-project-status');
const { BACKUP_NAME_PATTERN } = require('../services/backup-status-service');

const ROOT = path.join(__dirname, '..');
const EXIT_CODES = Object.freeze({ clean: 0, warning: 1, authorization: 2 });
const FIXTURE_PREFIXES = Object.freeze([
  'tienda-admin-test-', 'tienda-backup-test-', 'tienda-browser-', 'tienda-c2-',
  'tienda-c3-', 'tienda-c4a-', 'tienda-catalogo-', 'tienda-credito-',
  'tienda-finanzas-', 'tienda-inventario-', 'tienda-lotes-', 'tienda-pos-',
  'tienda-sesiones-', 'tienda-stock-', 'tienda-sus-', 'tienda-aislamiento-'
]);
const TEMPORARY_DATABASE_PREFIXES = Object.freeze(['tmp_tienda_restore_', 'tmp_tienda_legacy_']);

function safeGitStatus(execFile = childProcess.execFileSync) {
  try {
    const output = String(execFile('git', ['status', '--short'], {
      cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']
    })).trim();
    return output ? output.split(/\r?\n/).filter(Boolean) : [];
  } catch {
    return ['GIT_STATUS_UNAVAILABLE'];
  }
}

function safeTrackedEnvironmentFiles(execFile = childProcess.execFileSync) {
  try {
    const output = String(execFile('git', ['ls-files', '--', '.env', '.env.local'], {
      cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']
    })).trim();
    return output ? output.split(/\r?\n/).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function inspectBackupDirectory(directory, fsApi = fs) {
  try {
    const stat = fsApi.lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) return [];
    const names = fsApi.readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && !entry.isSymbolicLink())
      .map((entry) => entry.name);
    const findings = [];
    for (const name of names) {
      const backupSql = name.endsWith('.sql') && BACKUP_NAME_PATTERN.test(name);
      const backupManifest = name.endsWith('.manifest.json')
        && BACKUP_NAME_PATTERN.test(name.replace(/\.manifest\.json$/i, '.sql'));
      const partialBase = name.replace(/\.(?:partial.*|tmp)$/i, '');
      if (/\.(?:partial.*|tmp)$/i.test(name) && BACKUP_NAME_PATTERN.test(partialBase)) {
        findings.push('BACKUP_PARTIAL');
      }
      if (backupManifest) {
        const sqlName = name.replace(/\.manifest\.json$/i, '.sql');
        if (!names.includes(sqlName)) findings.push('BACKUP_MANIFEST_ORPHAN');
      }
      if (backupSql) {
        const manifestName = name.replace(/\.sql$/i, '.manifest.json');
        if (!names.includes(manifestName)) findings.push('BACKUP_SQL_ORPHAN');
      }
    }
    return [...new Set(findings)];
  } catch (error) {
    return error?.code === 'ENOENT' ? [] : ['BACKUP_DIRECTORY_UNREADABLE'];
  }
}

function inspectTemporaryFiles(root = ROOT, fsApi = fs) {
  const findings = [];
  for (const relative of ['tmp', 'backups', path.join('database', 'backups')]) {
    const directory = path.join(root, relative);
    const backupFindings = inspectBackupDirectory(directory, fsApi);
    findings.push(...backupFindings);
    try {
      const stat = fsApi.lstatSync(directory);
      if (relative === 'tmp' && stat.isDirectory() && !stat.isSymbolicLink()
        && fsApi.readdirSync(directory).length) findings.push('PROJECT_TEMP_FILES');
    } catch {
      // Ausencia esperada: la comprobacion nunca crea directorios.
    }
  }
  return [...new Set(findings)];
}

async function inspectLocalFixtures(config) {
  const mysql = require('mysql2/promise');
  let connection;
  try {
    connection = await mysql.createConnection({
      host: config.host, port: config.port, user: config.user,
      password: config.password, database: config.database, connectTimeout: 1500
    });
    const [databases] = await connection.query({
      sql: "SELECT SCHEMA_NAME AS name FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME LIKE 'tmp_tienda\\_%' ESCAPE '\\\\'",
      timeout: 1500
    });
    const rows = [];
    for (const prefix of FIXTURE_PREFIXES) {
      const [matches] = await connection.query({
        sql: 'SELECT nombre FROM tienda WHERE nombre LIKE ? LIMIT 101', timeout: 1500
      }, [`${prefix}%`]);
      rows.push(...matches.map((row) => String(row.nombre)));
    }
    return {
      temporaryDatabases: databases.map((row) => String(row.name)),
      fixtures: [...new Set(rows)]
    };
  } catch {
    return { temporaryDatabases: [], fixtures: [], unavailable: true };
  } finally {
    if (connection) await connection.end().catch(() => {});
  }
}

function classify(findings) {
  if (findings.some((item) => item.level === 'authorization')) return 'authorization';
  if (findings.length) return 'warning';
  return 'clean';
}

async function collectCleanupCheck(options = {}) {
  const environment = options.environment || process.env;
  const config = options.config || loadEnvironment(environment, options.fsApi || fs);
  const safety = databaseSafety(config);
  const findings = [];
  const dirtyFiles = (options.gitStatus || safeGitStatus)();
  if (dirtyFiles.length) findings.push({ level: 'warning', code: 'WORKING_TREE_DIRTY', count: dirtyFiles.length });
  const trackedEnvironment = (options.trackedEnvironment || safeTrackedEnvironmentFiles)();
  if (trackedEnvironment.length) findings.push({ level: 'authorization', code: 'TRACKED_ENVIRONMENT_FILE', count: trackedEnvironment.length });
  for (const code of (options.fileInspector || inspectTemporaryFiles)(options.root || ROOT, options.fsApi || fs)) {
    findings.push({ level: 'warning', code });
  }
  const inspectedProcesses = (options.processInspector || defaultProcessInspector)();
  const processInfo = {
    projectProcesses: inspectedProcesses.processes || inspectedProcesses.projectProcesses || [],
    temporaryPorts: inspectedProcesses.ports || inspectedProcesses.temporaryPorts || []
  };
  if (processInfo.projectProcesses.length) findings.push({ level: 'warning', code: 'PROJECT_NODE_PROCESS', count: processInfo.projectProcesses.length });
  if (processInfo.temporaryPorts.length) findings.push({ level: 'warning', code: 'TEMPORARY_PORT_LISTENING_PORT', count: processInfo.temporaryPorts.length });
  let database = { temporaryDatabases: [], fixtures: [] };
  if (safety.allowed) {
    database = await (options.fixtureInspector || inspectLocalFixtures)(config);
    if (database.unavailable) findings.push({ level: 'warning', code: 'FIXTURE_CHECK_UNAVAILABLE' });
    if (database.temporaryDatabases.length) findings.push({ level: 'authorization', code: 'TEMPORARY_DATABASE_FOUND', count: database.temporaryDatabases.length });
    if (database.fixtures.length) findings.push({ level: 'authorization', code: 'FIXTURE_STORE_FOUND', count: database.fixtures.length });
  } else {
    findings.push({ level: 'authorization', code: safety.code });
  }
  const status = classify(findings);
  return {
    status,
    exitCode: EXIT_CODES[status],
    database: safety.allowed ? 'checked' : 'not_checked',
    findings,
    temporaryDatabases: database.temporaryDatabases.length,
    fixtures: database.fixtures.length,
    projectProcesses: processInfo.projectProcesses.length,
    temporaryPorts: processInfo.temporaryPorts.length,
    authorizedDatabase: config.database === AUTHORIZED_DATABASE
  };
}

function writeCleanup(result, write = console.log) {
  write(`Codex cleanup check: ${result.status === 'clean' ? 'CLEAN' : result.status.toUpperCase()}`);
  write(`Database: ${result.database}; temporaryDatabases=${result.temporaryDatabases}; fixtures=${result.fixtures}`);
  write(`Processes: ${result.projectProcesses}; temporaryPorts=${result.temporaryPorts}`);
  write(`Findings: ${result.findings.length ? result.findings.map((item) => item.code).join(',') : 'none'}`);
}

async function main() {
  try {
    const result = await collectCleanupCheck();
    writeCleanup(result);
    process.exitCode = result.exitCode;
  } catch {
    console.log('Codex cleanup check: REQUIRES_AUTHORIZATION');
    console.log('Findings: CLEANUP_CHECK_UNAVAILABLE');
    process.exitCode = EXIT_CODES.authorization;
  }
}

if (require.main === module) void main();

module.exports = {
  AUTHORIZED_DATABASE,
  EXIT_CODES,
  FIXTURE_PREFIXES,
  TEMPORARY_DATABASE_PREFIXES,
  classify,
  collectCleanupCheck,
  inspectBackupDirectory,
  inspectTemporaryFiles,
  writeCleanup
};
