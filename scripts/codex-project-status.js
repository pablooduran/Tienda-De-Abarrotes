const childProcess = require('child_process');
const fs = require('fs');
const http = require('http');
const path = require('path');
const dotenv = require('dotenv');

const ROOT = path.join(__dirname, '..');
const AUTHORIZED_DATABASE = 'tienda_abarrotes_pruebas';
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1']);
const EXIT_CODES = Object.freeze({ healthy: 0, warning: 1, blocked: 2 });

function loadEnvironment(environment = process.env, fsApi = fs) {
  const appEnvironment = String(environment.APP_ENV || '').trim().toLowerCase();
  const fileName = appEnvironment === 'local' ? '.env.local' : '.env';
  let fileValues = {};
  try {
    fileValues = dotenv.parse(fsApi.readFileSync(path.join(ROOT, fileName)));
  } catch {
    fileValues = {};
  }
  const values = { ...fileValues, ...environment };
  return {
    appEnvironment,
    host: String(values.DB_HOST || '').trim().toLowerCase(),
    database: String(values.DB_NAME || '').trim(),
    user: String(values.DB_USER || '').trim(),
    password: String(values.DB_PASSWORD || '').trim(),
    port: Number(values.DB_PORT || 3306)
  };
}

function databaseSafety(config) {
  if (config.appEnvironment !== 'local') return { allowed: false, code: 'APP_ENV_NOT_LOCAL' };
  if (!LOCAL_HOSTS.has(config.host)) return { allowed: false, code: 'REMOTE_DATABASE_BLOCKED' };
  if (config.database !== AUTHORIZED_DATABASE) return { allowed: false, code: 'DATABASE_NOT_AUTHORIZED' };
  if (!config.user || !config.password || !Number.isInteger(config.port) || config.port <= 0) {
    return { allowed: false, code: 'DATABASE_CONFIGURATION_INCOMPLETE' };
  }
  return { allowed: true, code: 'LOCAL_DATABASE_AUTHORIZED' };
}

function sanitizedTarget(config) {
  return {
    host: LOCAL_HOSTS.has(config.host) ? config.host : config.host ? 'remote' : 'missing',
    database: config.database === AUTHORIZED_DATABASE ? AUTHORIZED_DATABASE : config.database ? 'not_authorized' : 'missing'
  };
}

function safeGit(execFile = childProcess.execFileSync) {
  const run = (args) => {
    try {
      return String(execFile('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })).trim();
    } catch {
      return '';
    }
  };
  const branch = run(['branch', '--show-current']) || 'unknown';
  const head = run(['rev-parse', '--short', 'HEAD']) || 'unknown';
  const upstream = run(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']);
  const workingTree = run(['status', '--short']);
  let sync = 'unknown';
  if (upstream) {
    const counts = run(['rev-list', '--left-right', '--count', `${upstream}...HEAD`]).split(/\s+/).map(Number);
    if (counts.length === 2 && counts.every(Number.isFinite)) {
      sync = counts[0] === 0 && counts[1] === 0 ? 'synchronized'
        : counts[0] > 0 && counts[1] > 0 ? 'diverged'
          : counts[0] > 0 ? 'behind' : 'ahead';
    }
  }
  return { branch, head, upstream: upstream || 'none', sync, dirtyFiles: workingTree ? workingTree.split(/\r?\n/).filter(Boolean) : [] };
}

async function readLocalDatabase(config) {
  const mysql = require('mysql2/promise');
  let connection;
  try {
    connection = await mysql.createConnection({
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.password,
      database: config.database,
      connectTimeout: 1500
    });
    await connection.query({ sql: 'SELECT 1 AS ok', timeout: 1500 });
    const [rows] = await connection.query({
      sql: 'SELECT MAX(CAST(SUBSTRING(nombre, 1, 3) AS UNSIGNED)) AS maxMigration FROM schema_migrations',
      timeout: 1500
    });
    return { status: 'healthy', maxMigration: Number(rows[0]?.maxMigration || 0) || null };
  } catch {
    return { status: 'unavailable', maxMigration: null };
  } finally {
    if (connection) await connection.end().catch(() => {});
  }
}

async function readBackupStatus(environment = process.env) {
  try {
    const { createBackupStatusService } = require('../services/backup-status-service');
    const result = await createBackupStatusService({ environment, cacheMs: 0 }).status();
    return { status: result.status, code: result.code };
  } catch {
    return { status: 'error', code: 'BACKUP_CHECK_UNAVAILABLE' };
  }
}

function defaultProcessInspector() {
  if (process.platform !== 'win32') return { processes: [], ports: [] };
  try {
    const script = "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress";
    const raw = childProcess.execFileSync('powershell.exe', ['-NoProfile', '-Command', script], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
    const rows = raw ? JSON.parse(raw) : [];
    const normalizedRoot = ROOT.toLowerCase();
    const projectRows = (Array.isArray(rows) ? rows : [rows]).filter((row) =>
      String(row.CommandLine || '').toLowerCase().includes(normalizedRoot));
    const pids = projectRows.map((row) => Number(row.ProcessId)).filter(Number.isInteger);
    if (!pids.length) return { processes: [], ports: [] };
    const portsScript = "Get-NetTCPConnection -State Listen | Select-Object LocalPort,OwningProcess | ConvertTo-Json -Compress";
    const portsRaw = childProcess.execFileSync('powershell.exe', ['-NoProfile', '-Command', portsScript], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
    const listeners = portsRaw ? JSON.parse(portsRaw) : [];
    const temporaryPorts = new Set([3000, 3001, 3002, 3003, 3100, 3101, 3200, 3201]);
    const ports = (Array.isArray(listeners) ? listeners : [listeners])
      .filter((row) => pids.includes(Number(row.OwningProcess)) && temporaryPorts.has(Number(row.LocalPort)))
      .map((row) => Number(row.LocalPort));
    return { processes: pids, ports: [...new Set(ports)].sort((a, b) => a - b) };
  } catch {
    return { processes: [], ports: [] };
  }
}

function readApplicationStatus(processInfo) {
  const port = processInfo.ports.includes(3000) ? 3000 : null;
  if (!port) return Promise.resolve({ status: 'not_running' });
  return new Promise((resolve) => {
    const request = http.get({ host: '127.0.0.1', port, path: '/health/ready', timeout: 1500 }, (response) => {
      response.resume();
      resolve({ status: response.statusCode === 200 ? 'healthy' : 'unavailable' });
    });
    request.on('timeout', () => request.destroy());
    request.on('error', () => resolve({ status: 'unavailable' }));
  });
}

function statusFromChecks(checks) {
  if (checks.safety !== 'LOCAL_DATABASE_AUTHORIZED') return 'blocked';
  if (checks.application !== 'healthy' || checks.database !== 'healthy' || checks.backup !== 'ok' || checks.gitDirty
    || checks.projectProcesses || checks.temporaryPorts) return 'warning';
  return 'healthy';
}

async function collectProjectStatus(options = {}) {
  const environment = options.environment || process.env;
  const config = options.config || loadEnvironment(environment, options.fsApi || fs);
  const safety = databaseSafety(config);
  const git = (options.gitReader || safeGit)();
  const processInfo = (options.processInspector || defaultProcessInspector)();
  const application = await (options.applicationReader || readApplicationStatus)(processInfo);
  const database = safety.allowed
    ? await (options.databaseReader || readLocalDatabase)(config)
    : { status: 'not_checked', maxMigration: null };
  const backup = safety.allowed
    ? await (options.backupReader || readBackupStatus)(environment)
    : { status: 'not_checked', code: safety.code };
  const checks = {
    safety: safety.code,
    application: application.status,
    database: database.status,
    backup: backup.status,
    gitDirty: git.dirtyFiles.length > 0,
    projectProcesses: processInfo.processes.length > 0,
    temporaryPorts: processInfo.ports.length > 0
  };
  const status = statusFromChecks(checks);
  return {
    status,
    git: { branch: git.branch, head: git.head, upstream: git.upstream, sync: git.sync, dirtyFiles: git.dirtyFiles.length },
    environment: { appEnvironment: config.appEnvironment || 'missing', target: sanitizedTarget(config), safety: safety.code },
    database,
    readiness: application.status !== 'healthy'
      ? application.status
      : database.status === 'healthy' ? 'healthy' : database.status,
    application,
    backup,
    projectProcesses: processInfo.processes.length,
    temporaryPorts: processInfo.ports,
    exitCode: EXIT_CODES[status]
  };
}

function writeStatus(result, write = console.log) {
  write(`Codex project status: ${result.status.toUpperCase()}`);
  write(`Git: ${result.git.branch} ${result.git.head} ${result.git.sync} (${result.git.upstream})${result.git.dirtyFiles ? `; dirty=${result.git.dirtyFiles}` : ''}`);
  write(`Environment: APP_ENV=${result.environment.appEnvironment}; host=${result.environment.target.host}; database=${result.environment.target.database}; safety=${result.environment.safety}`);
  write(`Application: ${result.application.status}; readiness=${result.readiness}; maxMigration=${result.database.maxMigration || 'not_available'}; backup=${result.backup.status}/${result.backup.code || 'not_checked'}`);
  write(`Project processes: ${result.projectProcesses}; temporaryPorts=${result.temporaryPorts.join(',') || 'none'}`);
}

async function main() {
  try {
    const result = await collectProjectStatus();
    writeStatus(result);
    process.exitCode = result.exitCode;
  } catch {
    console.log('Codex project status: BLOCKED');
    console.log('Safety: STATUS_CHECK_UNAVAILABLE');
    process.exitCode = EXIT_CODES.blocked;
  }
}

if (require.main === module) void main();

module.exports = {
  AUTHORIZED_DATABASE,
  EXIT_CODES,
  LOCAL_HOSTS,
  collectProjectStatus,
  databaseSafety,
  defaultProcessInspector,
  loadEnvironment,
  readApplicationStatus,
  sanitizedTarget,
  statusFromChecks,
  writeStatus
};
