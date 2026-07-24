const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const { execFileSync, spawn } = require('child_process');
const mysql = require('mysql2/promise');
const { buildDatabaseOptions } = require('../config/database-options');
const { formatLocalDateTime } = require('../utils/local-datetime');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const BACKUP_FORMAT_VERSION = 1;
const TEMP_DATABASE_PREFIX = 'tmp_tienda_restore_';
const DELETE_CONFIRMATION = 'DELETE_VERIFIED_BACKUPS';
const REQUIRED_TABLES = Object.freeze([
  'schema_migrations', 'tienda', 'administrador', 'cliente', 'producto',
  'venta', 'fiado', 'pagoFiado', 'cobroFiado'
]);
const CRITICAL_TABLES = Object.freeze([
  'tienda', 'administrador', 'cliente', 'proveedor', 'producto', 'compra',
  'venta', 'fiado', 'pagoVenta', 'pagoFiado', 'cobroFiado',
  'movimientoStock', 'loteProducto', 'movimientoLote', 'seguimientoCobranza'
]);
const RESTORE_CHECKERS = Object.freeze([
  ['legacy-migrations', 'scripts/check-legacy-migrations.js'],
  ['session-security', 'scripts/check-session-security.js'],
  ['timezone-tls', 'scripts/check-timezone-tls.js'],
  ['customers-credit', 'scripts/check-customers-credit.js']
]);

class BackupError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = 'BackupError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

function fail(code, message, details) {
  throw new BackupError(code, message, details);
}

function normalizedEnvironment(environment = process.env) {
  return String(environment.APP_ENV || '').trim().toLowerCase();
}

function assertLocalRuntime(environment = process.env, operation = 'La operacion de backup') {
  const appEnvironment = normalizedEnvironment(environment);
  const nodeEnvironment = String(environment.NODE_ENV || '').trim().toLowerCase();
  if (!['local', 'test'].includes(appEnvironment) || nodeEnvironment === 'production') {
    fail('BACKUP_ENVIRONMENT_FORBIDDEN', `${operation} solo admite APP_ENV=local o test fuera de produccion.`);
  }
  const config = buildDatabaseOptions(environment);
  if (String(config.host).trim().toLowerCase() !== 'localhost') {
    fail('BACKUP_REMOTE_HOST_FORBIDDEN', `${operation} solo admite DB_HOST=localhost.`);
  }
  if (config.ssl) {
    fail('BACKUP_LOCAL_TLS_UNSUPPORTED', `${operation} local requiere DB_SSL_ENABLED=false.`);
  }
  const localConfig = { ...config, host: 'localhost' };
  Object.defineProperty(localConfig, 'appEnvironment', { value: appEnvironment, enumerable: false });
  return localConfig;
}

function assertSafeTemporaryDatabase(name) {
  const value = String(name || '');
  if (!/^tmp_tienda_restore_[a-z0-9_]{12,80}$/.test(value)
    || value === 'tienda_abarrotes' || value === 'tienda_abarrotes_pruebas') {
    fail('RESTORE_DATABASE_NAME_FORBIDDEN', 'La base temporal no cumple el prefijo y formato de restauracion permitidos.');
  }
  return value;
}

function quoteIdentifier(value) {
  const identifier = String(value || '');
  if (!/^[A-Za-z0-9_$]+$/.test(identifier)) {
    fail('UNSAFE_SQL_IDENTIFIER', 'Se encontro un identificador SQL no permitido.');
  }
  return `\`${identifier}\``;
}

function safeFilePart(value, fallback = 'backup') {
  const normalized = String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^\.+|\.+$/g, '')
    .replace(/_+/g, '_')
    .slice(0, 80);
  return normalized || fallback;
}

function localTimestamp(date = new Date()) {
  return formatLocalDateTime(date).replace(/[-: ]/g, '').replace(/^(\d{8})(\d{6})$/, '$1_$2');
}

function localFileTimestamp(date = new Date()) {
  return formatLocalDateTime(date).replace(' ', '_').replace(/:/g, '');
}

function ensureDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    fail('BACKUP_DIRECTORY_UNSAFE', 'BACKUP_DIR debe ser un directorio real y no un enlace simbolico.');
  }
  try { fs.chmodSync(directory, 0o700); } catch { /* Windows ACLs are inherited from the parent. */ }
  return fs.realpathSync(directory);
}

function resolveBackupDirectoryPath(environment = process.env) {
  const configured = String(environment.BACKUP_DIR || './backups').trim();
  if (!configured || /[\u0000-\u001f]/.test(configured)) {
    fail('BACKUP_DIRECTORY_UNSAFE', 'BACKUP_DIR no es valido.');
  }
  return path.resolve(PROJECT_ROOT, configured);
}

function backupDirectory(environment = process.env, options = {}) {
  const resolved = resolveBackupDirectoryPath(environment);
  if (options.create !== false) return ensureDirectory(resolved);
  let stat;
  try {
    stat = fs.lstatSync(resolved);
  } catch {
    fail('BACKUP_DIRECTORY_NOT_FOUND', 'No existe el directorio de backups configurado.');
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    fail('BACKUP_DIRECTORY_UNSAFE', 'BACKUP_DIR debe ser un directorio real y no un enlace simbolico.');
  }
  return fs.realpathSync(resolved);
}

function isInsideDirectory(filePath, directory) {
  const relative = path.relative(directory, filePath);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function assertRegularFileInside(filePath, directory, extension) {
  const resolved = path.resolve(String(filePath || ''));
  if (!isInsideDirectory(resolved, directory)) {
    fail('BACKUP_PATH_OUTSIDE_ALLOWED_DIRECTORY', 'El archivo debe estar dentro de BACKUP_DIR.');
  }
  if (path.extname(resolved).toLowerCase() !== extension) {
    fail('BACKUP_FILE_EXTENSION_INVALID', `El archivo debe usar la extension ${extension}.`);
  }
  const stat = fs.lstatSync(resolved);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    fail('BACKUP_FILE_UNSAFE', 'El archivo debe ser regular y no un enlace simbolico.');
  }
  const real = fs.realpathSync(resolved);
  if (!isInsideDirectory(real, directory)) {
    fail('BACKUP_PATH_OUTSIDE_ALLOWED_DIRECTORY', 'La ruta real del archivo sale de BACKUP_DIR.');
  }
  return { path: real, stat };
}

function executableCandidates(kind, environment = process.env) {
  const windows = process.platform === 'win32';
  const fileName = kind === 'mysqldump'
    ? (windows ? 'mysqldump.exe' : 'mysqldump')
    : (windows ? 'mysql.exe' : 'mysql');
  const explicitName = kind === 'mysqldump' ? 'MYSQLDUMP_PATH' : 'MYSQL_CLIENT_PATH';
  const explicit = String(environment[explicitName] || '').trim();
  if (explicit) return { explicitName, explicit, candidates: [path.resolve(explicit)] };
  const candidates = [];
  for (const directory of String(environment.PATH || '').split(path.delimiter).filter(Boolean)) {
    candidates.push(path.join(directory, fileName));
  }
  if (windows) {
    for (const root of [environment.ProgramFiles, environment['ProgramFiles(x86)'], 'C:\\Program Files']) {
      if (root) candidates.push(path.join(root, 'MySQL', 'MySQL Server 8.0', 'bin', fileName));
    }
  }
  return { explicitName, explicit: '', candidates };
}

function resolveExecutable(kind, environment = process.env) {
  const { explicitName, explicit, candidates } = executableCandidates(kind, environment);
  for (const candidate of [...new Set(candidates)]) {
    try {
      const stat = fs.lstatSync(candidate);
      if (stat.isFile() && !stat.isSymbolicLink()) return fs.realpathSync(candidate);
    } catch {
      // Continue with the next known location.
    }
  }
  if (explicit) {
    fail('MYSQL_TOOL_NOT_FOUND', `${explicitName} no apunta a un ejecutable existente.`);
  }
  fail('MYSQL_TOOL_NOT_FOUND', `No se encontro ${kind}. Configure ${explicitName}.`);
}

function redactedChildEnvironment(environment, password) {
  const child = { ...environment, MYSQL_PWD: password };
  for (const key of [
    'DB_PASSWORD', 'BACKUP_RESTORE_PASSWORD', 'SESSION_SECRET', 'DB_SSL_CA', 'ADMIN_PASSWORD'
  ]) delete child[key];
  return child;
}

function redact(text, secrets = []) {
  let result = String(text || '');
  for (const secret of secrets.filter(Boolean)) result = result.split(String(secret)).join('[REDACTED]');
  return result;
}

function runProcess(executable, args, options = {}) {
  return new Promise((resolve, reject) => {
    const inputDescriptor = options.stdinFile ? fs.openSync(options.stdinFile, 'r') : null;
    const descriptors = [inputDescriptor ?? 'ignore', 'pipe', 'pipe'];
    const child = spawn(executable, args, {
      cwd: options.cwd || PROJECT_ROOT,
      env: options.env || process.env,
      shell: false,
      windowsHide: true,
      stdio: descriptors
    });
    if (inputDescriptor !== null) fs.closeSync(inputDescriptor);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { if (stdout.length < 131072) stdout += chunk.toString('utf8'); });
    child.stderr.on('data', (chunk) => { if (stderr.length < 131072) stderr += chunk.toString('utf8'); });
    child.once('error', (error) => reject(new BackupError('MYSQL_PROCESS_START_FAILED', `No se pudo iniciar ${path.basename(executable)}: ${error.message}`)));
    child.once('close', (code) => {
      if (code === 0) return resolve({ code, stdout, stderr });
      const safeError = redact(stderr || stdout, options.secrets).trim().slice(0, 2000);
      return reject(new BackupError('MYSQL_PROCESS_FAILED', `${path.basename(executable)} termino con codigo ${code}.${safeError ? ` ${safeError}` : ''}`));
    });
  });
}

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  }
  return value;
}

function manifestDigest(manifest) {
  const payload = { ...manifest };
  delete payload.manifestSha256;
  return crypto.createHash('sha256').update(JSON.stringify(stableValue(payload))).digest('hex');
}

function finalizeManifest(manifest) {
  return { ...manifest, manifestSha256: manifestDigest(manifest) };
}

function writeJsonAtomic(filePath, value) {
  const temporary = `${filePath}.partial-${crypto.randomBytes(6).toString('hex')}`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: 'utf8', flag: 'wx', mode: 0o600
  });
  fs.renameSync(temporary, filePath);
  try { fs.chmodSync(filePath, 0o600); } catch { /* Windows ACLs are inherited from the parent. */ }
}

async function databaseInventory(connection, database) {
  const [tableRows] = await connection.query(
    `SELECT TABLE_NAME, ENGINE FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_SCHEMA=? AND TABLE_TYPE='BASE TABLE' ORDER BY TABLE_NAME`,
    [database]
  );
  const names = new Map(tableRows.map((row) => [String(row.TABLE_NAME).toLowerCase(), row.TABLE_NAME]));
  const criticalRowCounts = {};
  for (const requested of CRITICAL_TABLES) {
    const actual = names.get(requested.toLowerCase());
    if (!actual) continue;
    const [[row]] = await connection.query(`SELECT COUNT(*) total FROM ${quoteIdentifier(actual)}`);
    criticalRowCounts[actual] = Number(row.total);
  }
  const migrationTable = names.get('schema_migrations');
  const migrations = migrationTable
    ? (await connection.query(`SELECT nombre FROM ${quoteIdentifier(migrationTable)} ORDER BY nombre`))[0]
      .map((row) => String(row.nombre))
    : [];
  const [[objects]] = await connection.query(
    `SELECT
       (SELECT COUNT(*) FROM INFORMATION_SCHEMA.TRIGGERS WHERE TRIGGER_SCHEMA=?) triggers,
       (SELECT COUNT(*) FROM INFORMATION_SCHEMA.ROUTINES WHERE ROUTINE_SCHEMA=?) routines,
       (SELECT COUNT(*) FROM INFORMATION_SCHEMA.EVENTS WHERE EVENT_SCHEMA=?) events`,
    [database, database, database]
  );
  return {
    tables: tableRows.map((row) => ({ name: row.TABLE_NAME, engine: row.ENGINE || null })),
    criticalRowCounts,
    migrations,
    objects: { triggers: Number(objects.triggers), routines: Number(objects.routines), events: Number(objects.events) }
  };
}

function gitCommit() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: PROJECT_ROOT, encoding: 'utf8', windowsHide: true }).trim();
  } catch {
    return null;
  }
}

function toolArguments(config, database, resultFile, inventory) {
  const args = [
    `--host=${config.host}`, `--port=${config.port}`, `--user=${config.user}`,
    '--protocol=TCP', '--default-character-set=utf8mb4', '--single-transaction', '--quick',
    '--skip-lock-tables', '--no-tablespaces', '--set-gtid-purged=OFF', '--hex-blob',
    '--ssl-mode=DISABLED', `--result-file=${resultFile}`
  ];
  args.push(inventory.objects.triggers > 0 ? '--triggers' : '--skip-triggers');
  if (inventory.objects.routines > 0) args.push('--routines');
  if (inventory.objects.events > 0) args.push('--events');
  args.push(database);
  return args;
}

function logicalDumpCommand(args) {
  return ['mysqldump', ...args.map((argument) => {
    if (argument.startsWith('--user=')) return '--user=<usuario>';
    if (argument.startsWith('--result-file=')) return '--result-file=<archivo-temporal>';
    return argument;
  })].join(' ');
}

async function createBackup(options = {}) {
  const environment = options.environment || process.env;
  const logger = options.logger || console;
  const config = assertLocalRuntime(environment, 'El backup');
  const directory = backupDirectory(environment);
  const executable = resolveExecutable('mysqldump', environment);
  const now = options.now || new Date();
  const baseName = `${safeFilePart(config.database, 'database')}_${localFileTimestamp(now)}`;
  const sqlPath = path.join(directory, `${baseName}.sql`);
  const manifestPath = path.join(directory, `${baseName}.manifest.json`);
  const partialPath = path.join(directory, `.${baseName}.${crypto.randomBytes(6).toString('hex')}.partial`);
  if (fs.existsSync(sqlPath) || fs.existsSync(manifestPath)) {
    fail('BACKUP_ALREADY_EXISTS', 'Ya existe un backup con la misma marca local.');
  }
  const connection = await mysql.createConnection(config);
  let published = false;
  try {
    const [[versionRow]] = await connection.query('SELECT VERSION() version');
    const inventory = await databaseInventory(connection, config.database);
    const nonTransactional = inventory.tables.filter((table) => String(table.engine || '').toUpperCase() !== 'INNODB');
    const args = toolArguments(config, config.database, partialPath, inventory);
    const runner = options.processRunner || runProcess;
    const versionResult = await runner(executable, ['--version'], {
      env: redactedChildEnvironment(environment, config.password), secrets: [config.password]
    });
    logger.log(`Backup local: entorno=${config.appEnvironment} host=localhost base=${config.database}.`);
    await runner(executable, args, {
      env: redactedChildEnvironment(environment, config.password), secrets: [config.password]
    });
    if (!fs.existsSync(partialPath) || fs.statSync(partialPath).size === 0) {
      fail('BACKUP_EMPTY', 'mysqldump no produjo un archivo util.');
    }
    try { fs.chmodSync(partialPath, 0o600); } catch { /* Windows ACLs are inherited from the parent. */ }
    const scan = await scanSqlBackup(partialPath);
    validateSqlScan(scan);
    const sizeBytes = fs.statSync(partialPath).size;
    const sha256 = await sha256File(partialPath);
    const manifest = finalizeManifest({
      formatVersion: BACKUP_FORMAT_VERSION,
      backup: {
        fileName: path.basename(sqlPath),
        createdLocal: formatLocalDateTime(now),
        createdUtc: now.toISOString(),
        environment: config.appEnvironment,
        host: 'localhost',
        port: config.port,
        database: config.database,
        sizeBytes,
        sha256,
        mysqlVersion: String(versionRow.version),
        mysqldumpVersion: String(versionResult.stdout || versionResult.stderr).trim().slice(0, 500),
        gitCommit: gitCommit(),
        migrations: inventory.migrations,
        tableCount: inventory.tables.length,
        tables: inventory.tables,
        criticalRowCounts: inventory.criticalRowCounts,
        databaseObjects: inventory.objects,
        logicalCommand: logicalDumpCommand(args),
        transactionalConsistency: {
          singleTransaction: true,
          allTablesInnoDB: nonTransactional.length === 0,
          nonInnoDBTables: nonTransactional.map((table) => table.name)
        },
        verification: { status: 'valid', checkedAtLocal: formatLocalDateTime(now) }
      }
    });
    fs.renameSync(partialPath, sqlPath);
    published = true;
    try {
      writeJsonAtomic(manifestPath, manifest);
    } catch (error) {
      fs.rmSync(sqlPath, { force: true });
      published = false;
      throw error;
    }
    logger.log(`Backup completado: archivo=${sqlPath} tamano=${sizeBytes} sha256=${sha256.slice(0, 12)}...`);
    if (nonTransactional.length) {
      logger.warn(`Advertencia: ${nonTransactional.length} tabla(s) no InnoDB impiden afirmar consistencia transaccional total.`);
    }
    return { sqlPath, manifestPath, manifest };
  } finally {
    await connection.end().catch(() => {});
    fs.rmSync(partialPath, { force: true });
    if (!published) fs.rmSync(manifestPath, { force: true });
  }
}

async function scanSqlBackup(filePath) {
  const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
  const tables = new Set();
  let firstContent = '';
  let completed = false;
  let unsafeDatabaseStatement = null;
  for await (const line of lines) {
    const trimmed = line.trim();
    if (!firstContent && trimmed) firstContent = trimmed;
    const create = trimmed.match(/^CREATE TABLE\s+(?:IF NOT EXISTS\s+)?`?([^`\s(]+)`?/i);
    if (create) tables.add(create[1].toLowerCase());
    if (/^-- Dump completed on /i.test(trimmed)) completed = true;
    if (/^(?:CREATE|DROP) DATABASE\b|^USE\s+/i.test(trimmed)) unsafeDatabaseStatement = trimmed.slice(0, 120);
  }
  return { firstContent, completed, tables, unsafeDatabaseStatement };
}

function validateSqlScan(scan) {
  if (!/^-- MySQL dump/i.test(scan.firstContent)) fail('BACKUP_HEADER_INVALID', 'El archivo no tiene un encabezado reconocible de mysqldump.');
  if (!scan.completed) fail('BACKUP_INCOMPLETE', 'El archivo no contiene la marca final de mysqldump.');
  if (scan.unsafeDatabaseStatement) {
    fail('BACKUP_DATABASE_STATEMENT_FORBIDDEN', 'El backup contiene una instruccion de base que impediria una restauracion aislada.');
  }
  const missing = REQUIRED_TABLES.filter((table) => !scan.tables.has(table.toLowerCase()));
  if (missing.length) fail('BACKUP_REQUIRED_TABLES_MISSING', `Faltan tablas esenciales en el SQL: ${missing.join(', ')}.`);
}

function manifestPathFor(sqlPath) {
  return sqlPath.replace(/\.sql$/i, '.manifest.json');
}

function versionMajor(value) {
  const match = String(value || '').match(/\b(\d+)\.(\d+)(?:\.\d+)?\b/);
  return match ? Number(match[1]) : null;
}

async function verifyBackup(filePath, options = {}) {
  const environment = options.environment || process.env;
  const directory = backupDirectory(environment, { create: options.readOnly !== true });
  let sql;
  try {
    sql = assertRegularFileInside(filePath, directory, '.sql');
  } catch (error) {
    if (error instanceof BackupError) throw error;
    fail('BACKUP_FILE_NOT_FOUND', 'No se encontro el archivo SQL indicado.');
  }
  const manifestPath = manifestPathFor(sql.path);
  let manifestFile;
  try {
    manifestFile = assertRegularFileInside(manifestPath, directory, '.json');
  } catch (error) {
    if (error.code === 'BACKUP_FILE_EXTENSION_INVALID') throw error;
    fail('BACKUP_MANIFEST_NOT_FOUND', 'No se encontro el manifiesto correspondiente.');
  }
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestFile.path, 'utf8'));
  } catch {
    fail('BACKUP_MANIFEST_INVALID', 'El manifiesto no contiene JSON valido.');
  }
  if (manifest.formatVersion !== BACKUP_FORMAT_VERSION || !manifest.backup || typeof manifest.manifestSha256 !== 'string') {
    fail('BACKUP_MANIFEST_INVALID', 'El manifiesto no cumple el formato soportado.');
  }
  if (manifestDigest(manifest) !== manifest.manifestSha256) {
    fail('BACKUP_MANIFEST_INTEGRITY_FAILED', 'La integridad del manifiesto no coincide.');
  }
  if (manifest.backup.fileName !== path.basename(sql.path)) {
    fail('BACKUP_MANIFEST_FILE_MISMATCH', 'El manifiesto corresponde a otro archivo SQL.');
  }
  if (manifest.backup.verification?.status !== 'valid') {
    fail('BACKUP_MANIFEST_NOT_VERIFIED', 'El manifiesto no declara una verificacion valida.');
  }
  if (Number(manifest.backup.sizeBytes) !== sql.stat.size) {
    fail('BACKUP_SIZE_MISMATCH', 'El tamano del backup no coincide con el manifiesto.');
  }
  const hash = await sha256File(sql.path);
  if (hash !== manifest.backup.sha256) {
    fail('BACKUP_HASH_MISMATCH', 'El hash SHA-256 del backup no coincide con el manifiesto.');
  }
  const scan = await scanSqlBackup(sql.path);
  validateSqlScan(scan);
  const manifestTables = new Set((manifest.backup.tables || []).map((table) => String(table.name || '').toLowerCase()));
  const missingManifestTables = REQUIRED_TABLES.filter((table) => !manifestTables.has(table.toLowerCase()));
  if (missingManifestTables.length || !Array.isArray(manifest.backup.migrations)) {
    fail('BACKUP_MANIFEST_STRUCTURE_INVALID', 'El manifiesto no describe las tablas y migraciones esenciales.');
  }
  const mysqlMajor = versionMajor(manifest.backup.mysqlVersion);
  const dumpMajor = versionMajor(manifest.backup.mysqldumpVersion);
  if (!mysqlMajor || !dumpMajor || mysqlMajor !== dumpMajor) {
    fail('BACKUP_VERSION_INCOMPATIBLE', 'Las versiones principales de MySQL y mysqldump no son compatibles.');
  }
  return {
    valid: true,
    sqlPath: sql.path,
    manifestPath: manifestFile.path,
    sizeBytes: sql.stat.size,
    sha256: hash,
    database: manifest.backup.database,
    manifest
  };
}

function restoreCredentials(environment) {
  return {
    user: String(environment.BACKUP_RESTORE_USER || '').trim(),
    password: String(environment.BACKUP_RESTORE_PASSWORD || '')
  };
}

async function createAdminConnection(config, credentials) {
  const options = { ...config, user: credentials.user, password: credentials.password };
  delete options.database;
  return mysql.createConnection(options);
}

async function assertRestoredForeignKeys(connection, database) {
  const [rows] = await connection.query(
    `SELECT CONSTRAINT_NAME, TABLE_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME,
            ORDINAL_POSITION
     FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
     WHERE CONSTRAINT_SCHEMA=? AND REFERENCED_TABLE_NAME IS NOT NULL
     ORDER BY TABLE_NAME, CONSTRAINT_NAME, ORDINAL_POSITION`,
    [database]
  );
  const groups = new Map();
  for (const row of rows) {
    const key = `${row.TABLE_NAME}\u0000${row.CONSTRAINT_NAME}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  for (const columns of groups.values()) {
    const first = columns[0];
    const joins = columns.map((column) => `c.${quoteIdentifier(column.COLUMN_NAME)}=p.${quoteIdentifier(column.REFERENCED_COLUMN_NAME)}`).join(' AND ');
    const present = columns.map((column) => `c.${quoteIdentifier(column.COLUMN_NAME)} IS NOT NULL`).join(' AND ');
    const [orphans] = await connection.query(
      `SELECT 1 FROM ${quoteIdentifier(first.TABLE_NAME)} c
       LEFT JOIN ${quoteIdentifier(first.REFERENCED_TABLE_NAME)} p ON ${joins}
       WHERE ${present} AND p.${quoteIdentifier(first.REFERENCED_COLUMN_NAME)} IS NULL LIMIT 1`
    );
    if (orphans.length) {
      fail('RESTORE_FOREIGN_KEY_ORPHANS', `La restauracion contiene referencias huerfanas en ${first.TABLE_NAME}.`);
    }
  }
  return groups.size;
}

async function restoredInventory(connection, database) {
  return databaseInventory(connection, database);
}

function checkerEnvironment(environment, config, database, credentials) {
  const child = {
    ...environment,
    APP_ENV: 'local', NODE_ENV: 'test', DB_HOST: 'localhost', DB_PORT: String(config.port),
    DB_USER: credentials.user, DB_PASSWORD: credentials.password, DB_NAME: database,
    DB_SSL_ENABLED: 'false'
  };
  for (const key of ['BACKUP_RESTORE_PASSWORD', 'DB_SSL_CA', 'SESSION_SECRET', 'ADMIN_PASSWORD']) delete child[key];
  return child;
}

async function runRestoreCheckers(environment, config, database, credentials, runner = runProcess) {
  const results = [];
  for (const [name, script] of RESTORE_CHECKERS) {
    try {
      await runner(process.execPath, [path.join(PROJECT_ROOT, script)], {
        cwd: PROJECT_ROOT,
        env: checkerEnvironment(environment, config, database, credentials),
        secrets: [credentials.password, config.password]
      });
      results.push({ name, status: 'ok' });
    } catch (error) {
      throw new BackupError('RESTORE_CHECKER_FAILED', `El comprobador ${name} fallo sobre la restauracion temporal.`, { cause: error.message });
    }
  }
  return results;
}

function temporaryDatabaseName() {
  return assertSafeTemporaryDatabase(`${TEMP_DATABASE_PREFIX}${localTimestamp().toLowerCase()}_${crypto.randomBytes(5).toString('hex')}`);
}

async function testRestore(filePath, options = {}) {
  const environment = options.environment || process.env;
  const logger = options.logger || console;
  const config = assertLocalRuntime(environment, 'La restauracion de prueba');
  const verification = await verifyBackup(filePath, { environment });
  const mysqlClient = resolveExecutable('mysql', environment);
  const credentials = restoreCredentials(environment);
  if (!credentials.user || !credentials.password) {
    fail('RESTORE_CREDENTIALS_MISSING', 'Configure BACKUP_RESTORE_USER y BACKUP_RESTORE_PASSWORD para el usuario local limitado.');
  }
  const database = options.databaseName ? assertSafeTemporaryDatabase(options.databaseName) : temporaryDatabaseName();
  const adminFactory = options.createAdminConnection || createAdminConnection;
  let admin;
  let created = false;
  let result;
  let failure;
  try {
    const runner = options.processRunner || runProcess;
    const clientVersion = await runner(mysqlClient, ['--version'], {
      env: redactedChildEnvironment(environment, credentials.password),
      secrets: [credentials.password, config.password]
    });
    if (versionMajor(clientVersion.stdout || clientVersion.stderr)
      !== versionMajor(verification.manifest.backup.mysqlVersion)) {
      fail('RESTORE_CLIENT_VERSION_INCOMPATIBLE', 'La version principal de mysql.exe no coincide con el backup.');
    }
    try {
      admin = await adminFactory(config, credentials);
    } catch (error) {
      fail('RESTORE_PRIVILEGES_REQUIRED', 'No se pudo abrir la conexion administrativa local para crear y eliminar la base temporal.', error.code);
    }
    const [existing] = await admin.query('SELECT SCHEMA_NAME FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME=?', [database]);
    if (existing.length) fail('RESTORE_TEMP_DATABASE_EXISTS', 'La base temporal generada ya existe; no se sobrescribira.');
    try {
      await admin.query(`CREATE DATABASE ${quoteIdentifier(database)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
      created = true;
    } catch (error) {
      fail('RESTORE_PRIVILEGES_REQUIRED', 'El usuario local de restauracion necesita CREATE y DROP solo sobre tmp_tienda_restore_%.*.', error.code);
    }
    if (options.afterCreate) await options.afterCreate({ database, admin });
    logger.log(`Restauracion temporal: host=localhost base=${database} archivo=${verification.sqlPath}.`);
    await runner(mysqlClient, [
      `--host=${config.host}`, `--port=${config.port}`, `--user=${credentials.user}`,
      '--protocol=TCP', '--default-character-set=utf8mb4', '--ssl-mode=DISABLED', database
    ], {
      stdinFile: verification.sqlPath,
      env: redactedChildEnvironment(environment, credentials.password),
      secrets: [credentials.password, config.password]
    });
    const restoredConfig = { ...config, database, user: credentials.user, password: credentials.password };
    const restored = await mysql.createConnection(restoredConfig);
    try {
      const inventory = await restoredInventory(restored, database);
      const expectedTables = new Map(verification.manifest.backup.tables.map((table) => [String(table.name).toLowerCase(), table]));
      const actualTables = new Map(inventory.tables.map((table) => [String(table.name).toLowerCase(), table]));
      const missing = [...expectedTables.keys()].filter((table) => !actualTables.has(table));
      if (missing.length || actualTables.size !== expectedTables.size) {
        fail('RESTORE_TABLE_MISMATCH', `La estructura restaurada no coincide. Faltantes: ${missing.join(', ') || 'ninguno'}.`);
      }
      for (const [name, expected] of expectedTables) {
        if (String(actualTables.get(name).engine || '').toUpperCase() !== String(expected.engine || '').toUpperCase()) {
          fail('RESTORE_ENGINE_MISMATCH', `El motor restaurado de ${expected.name} no coincide.`);
        }
      }
      if (JSON.stringify(inventory.migrations) !== JSON.stringify(verification.manifest.backup.migrations)) {
        fail('RESTORE_MIGRATIONS_MISMATCH', 'schema_migrations no coincide con el manifiesto.');
      }
      for (const [table, expected] of Object.entries(verification.manifest.backup.criticalRowCounts || {})) {
        if (Number(inventory.criticalRowCounts[table]) !== Number(expected)) {
          fail('RESTORE_ROW_COUNT_MISMATCH', `El conteo restaurado de ${table} no coincide.`);
        }
      }
      const foreignKeysChecked = await assertRestoredForeignKeys(restored, database);
      const checkers = options.skipCheckers
        ? []
        : await runRestoreCheckers(environment, config, database, credentials, runner);
      result = {
        status: 'ok', database, tableCount: inventory.tables.length,
        migrations: inventory.migrations.length, criticalRowCounts: inventory.criticalRowCounts,
        foreignKeysChecked, checkers
      };
    } finally {
      await restored.end().catch(() => {});
    }
  } catch (error) {
    failure = error;
  } finally {
    if (created && admin) {
      try {
        assertSafeTemporaryDatabase(database);
        await admin.query(`DROP DATABASE ${quoteIdentifier(database)}`);
        created = false;
      } catch (cleanupError) {
        failure = new BackupError('RESTORE_CLEANUP_FAILED', `No se pudo eliminar la base temporal ${database}. Intervencion local requerida.`, {
          original: failure?.message, cleanup: cleanupError.message
        });
      }
    }
    if (admin) await admin.end().catch(() => {});
  }
  if (failure) throw failure;
  logger.log(`Restauracion comprobada y eliminada: base=${database}.`);
  return { ...result, cleaned: true };
}

function retentionNumber(value, fallback, minimum, maximum, label) {
  const number = Number(value ?? fallback);
  if (!Number.isInteger(number) || number < minimum || number > maximum) {
    fail('BACKUP_RETENTION_INVALID', `${label} debe ser un entero entre ${minimum} y ${maximum}.`);
  }
  return number;
}

async function cleanupBackups(options = {}) {
  const environment = options.environment || process.env;
  assertLocalRuntime(environment, 'La limpieza de backups');
  const directory = backupDirectory(environment);
  const days = retentionNumber(options.days ?? environment.BACKUP_RETENTION_DAYS, 30, 0, 3650, 'La retencion en dias');
  const count = retentionNumber(options.count ?? environment.BACKUP_RETENTION_COUNT, 10, 1, 1000, 'La retencion por cantidad');
  const apply = options.apply === true;
  if (apply && options.confirmation !== DELETE_CONFIRMATION) {
    fail('BACKUP_CLEANUP_CONFIRMATION_REQUIRED', `Para borrar use la confirmacion exacta ${DELETE_CONFIRMATION}.`);
  }
  const entries = [];
  for (const name of fs.readdirSync(directory)) {
    if (!name.toLowerCase().endsWith('.sql')) continue;
    const candidate = path.join(directory, name);
    try {
      const verified = await verifyBackup(candidate, { environment });
      entries.push({ ...verified, mtimeMs: fs.statSync(candidate).mtimeMs });
    } catch {
      // Invalid or incomplete files are never deleted automatically.
    }
  }
  entries.sort((left, right) => right.mtimeMs - left.mtimeMs || right.sqlPath.localeCompare(left.sqlPath));
  const cutoff = Date.now() - days * 86400000;
  const candidates = entries.filter((entry, index) => index > 0 && index >= count && entry.mtimeMs < cutoff);
  const deleted = [];
  if (apply) {
    for (const entry of candidates) {
      fs.rmSync(entry.sqlPath);
      fs.rmSync(entry.manifestPath);
      deleted.push(entry.sqlPath);
    }
  }
  return {
    mode: apply ? 'apply' : 'dry-run', directory, retentionDays: days,
    retentionCount: count, validBackups: entries.length,
    latestPreserved: entries[0]?.sqlPath || null,
    candidates: candidates.map((entry) => entry.sqlPath), deleted
  };
}

module.exports = {
  BACKUP_FORMAT_VERSION,
  BackupError,
  CRITICAL_TABLES,
  DELETE_CONFIRMATION,
  PROJECT_ROOT,
  REQUIRED_TABLES,
  RESTORE_CHECKERS,
  TEMP_DATABASE_PREFIX,
  assertLocalRuntime,
  assertSafeTemporaryDatabase,
  backupDirectory,
  cleanupBackups,
  createBackup,
  finalizeManifest,
  manifestDigest,
  resolveExecutable,
  resolveBackupDirectoryPath,
  safeFilePart,
  scanSqlBackup,
  sha256File,
  testRestore,
  verifyBackup
};
