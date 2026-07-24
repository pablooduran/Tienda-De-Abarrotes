const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const {
  BackupError,
  REQUIRED_TABLES,
  backupDirectory,
  finalizeManifest,
  verifyBackup
} = require('./backup-utils');
const { createErrorHandler } = require('../middleware/error-handler');
const { createRateLimiters } = require('../middleware/rate-limiters');
const { requestContext } = require('../middleware/request-context');
const { noStoreSensitiveResponses } = require('../middleware/request-security');
const { requireRole } = require('../middleware/roles');
const { createAdminHealthRouter } = require('../routes/admin-health');
const { webSecurityConfig } = require('../config/web-security');
const {
  createBackupStatusService,
  inspectDirectory
} = require('../services/backup-status-service');
const { createOperationalDiagnosticService } = require('../services/operational-health-service');

const ROOT = path.join(__dirname, '..');
const NOW = new Date('2026-07-24T16:00:00.000Z');
const SECRET_PATH = path.join(os.tmpdir(), 'ruta-secreta-backup');
const SECRET_FILE = 'base_privada_2026-07-24_120000.sql';
const SECRET_HASH = 'f'.repeat(64);

function loggerCapture() {
  const entries = [];
  return {
    entries,
    error: (event, context) => entries.push({ level: 'error', event, context }),
    warn: (event, context) => entries.push({ level: 'warn', event, context }),
    info: (event, context) => entries.push({ level: 'info', event, context })
  };
}

function dumpText({ complete = true } = {}) {
  const tables = REQUIRED_TABLES
    .map((table) => `CREATE TABLE \`${table}\` (\`id\` INT);`)
    .join('\n');
  return [
    '-- MySQL dump 8.0',
    tables,
    complete ? '-- Dump completed on 2026-07-24 12:00:00' : '-- Dump interrupted'
  ].join('\n');
}

function writeBackup(directory, options = {}) {
  fs.mkdirSync(directory, { recursive: true });
  const name = options.name || 'tienda_test_2026-07-24_120000.sql';
  const sqlPath = path.join(directory, name);
  const sql = options.sql ?? dumpText();
  fs.writeFileSync(sqlPath, sql, 'utf8');
  const manifest = finalizeManifest({
    formatVersion: 1,
    backup: {
      fileName: name,
      createdLocal: '2026-07-24 12:00:00',
      createdUtc: options.createdUtc || new Date(NOW.getTime() - 60 * 60 * 1000).toISOString(),
      environment: 'test',
      host: 'localhost',
      port: 3306,
      database: 'test_database',
      sizeBytes: fs.statSync(sqlPath).size,
      sha256: crypto.createHash('sha256').update(sql).digest('hex'),
      mysqlVersion: '8.0.42',
      mysqldumpVersion: 'mysqldump Ver 8.0.42',
      migrations: ['001_test.sql'],
      tableCount: REQUIRED_TABLES.length,
      tables: REQUIRED_TABLES.map((table) => ({ name: table, engine: 'InnoDB' })),
      criticalRowCounts: {},
      databaseObjects: { triggers: 0, routines: 0, events: 0 },
      verification: { status: 'valid', checkedAtLocal: '2026-07-24 12:00:00' }
    }
  });
  const manifestPath = sqlPath.replace(/\.sql$/i, '.manifest.json');
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return { manifest, manifestPath, sqlPath };
}

function replaceManifest(manifestPath, mutate) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  mutate(manifest);
  fs.writeFileSync(manifestPath, `${JSON.stringify(finalizeManifest(manifest), null, 2)}\n`, 'utf8');
}

function backupService(directory, options = {}) {
  return createBackupStatusService({
    environment: { BACKUP_DIR: directory },
    warningHours: 24,
    criticalHours: 48,
    cacheMs: 0,
    clock: () => new Date(NOW),
    ...options
  });
}

function healthyReadiness(overrides = {}) {
  return {
    status: 'healthy',
    checks: { database: 'ok', migrations: 'ok' },
    durationMs: 8.5,
    checkedAt: NOW.toISOString(),
    reason: null,
    diagnostics: { expectedMigrations: 13, appliedMigrations: 13 },
    ...overrides
  };
}

function diagnosticService(backup, readiness = healthyReadiness()) {
  return createOperationalDiagnosticService({
    healthService: { readiness: async () => readiness },
    backupStatusService: { status: async () => backup },
    clock: () => new Date(NOW)
  });
}

function rateConfig(adminMax = 100) {
  return {
    enabled: true,
    windowMs: 60000,
    apiMax: 100,
    loginIpMax: 100,
    loginIdentityMax: 100,
    authMax: 100,
    adminMax,
    exportMax: 100,
    whatsappMax: 100,
    healthMax: 100
  };
}

async function startFixture(service, { adminMax = 100 } = {}) {
  const app = express();
  const logger = loggerCapture();
  const limiters = createRateLimiters(rateConfig(adminMax));
  app.use(requestContext(logger));
  app.use(noStoreSensitiveResponses);
  app.use('/api/admin', limiters.admin);
  app.use('/api/admin/health', (req, res, next) => {
    const role = String(req.get('X-Test-Role') || '');
    if (!role) return res.status(401).json({ error: 'Debe iniciar sesion.' });
    req.auth = { idAdministrador: 1, rol: role };
    return next();
  }, requireRole('superadmin'), createAdminHealthRouter({
    diagnosticService: service,
    logger
  }));
  app.use(createErrorHandler({ logger, production: true }));
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    logger,
    close: () => new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    })
  };
}

async function responseJson(response) {
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function testBackupStates(root) {
  const recentDirectory = path.join(root, 'recent');
  writeBackup(recentDirectory);
  const recent = await backupService(recentDirectory).status();
  assert.strictEqual(recent.status, 'ok');
  assert.strictEqual(recent.code, 'BACKUP_OK');

  const staleDirectory = path.join(root, 'stale');
  writeBackup(staleDirectory, {
    createdUtc: new Date(NOW.getTime() - 30 * 3600000).toISOString()
  });
  const stale = await backupService(staleDirectory).status();
  assert.strictEqual(stale.status, 'warning');
  assert.strictEqual(stale.code, 'BACKUP_STALE');

  const oldDirectory = path.join(root, 'old');
  writeBackup(oldDirectory, {
    createdUtc: new Date(NOW.getTime() - 60 * 3600000).toISOString()
  });
  const old = await backupService(oldDirectory).status();
  assert.strictEqual(old.status, 'error');
  assert.strictEqual(old.code, 'BACKUP_TOO_OLD');

  const missingDirectory = path.join(root, 'missing');
  const missing = await backupService(missingDirectory).status();
  assert.strictEqual(missing.code, 'BACKUP_MISSING');
  assert.strictEqual(fs.existsSync(missingDirectory), false, 'La lectura no debe crear BACKUP_DIR.');

  const noFilesDirectory = path.join(root, 'no-files');
  fs.mkdirSync(noFilesDirectory);
  assert.strictEqual((await backupService(noFilesDirectory).status()).code, 'BACKUP_MISSING');

  const noManifestDirectory = path.join(root, 'no-manifest');
  const noManifest = writeBackup(noManifestDirectory);
  fs.unlinkSync(noManifest.manifestPath);
  assert.strictEqual((await backupService(noManifestDirectory).status()).code, 'BACKUP_MANIFEST_MISSING');

  const invalidManifestDirectory = path.join(root, 'invalid-manifest');
  const invalidManifest = writeBackup(invalidManifestDirectory);
  fs.writeFileSync(invalidManifest.manifestPath, '{invalido', 'utf8');
  assert.strictEqual((await backupService(invalidManifestDirectory).status()).code, 'BACKUP_MANIFEST_INVALID');

  const sizeDirectory = path.join(root, 'size');
  const size = writeBackup(sizeDirectory);
  replaceManifest(size.manifestPath, (manifest) => { manifest.backup.sizeBytes += 1; });
  assert.strictEqual((await backupService(sizeDirectory).status()).code, 'BACKUP_SIZE_MISMATCH');

  const checksumDirectory = path.join(root, 'checksum');
  const checksum = writeBackup(checksumDirectory);
  replaceManifest(checksum.manifestPath, (manifest) => { manifest.backup.sha256 = SECRET_HASH; });
  assert.strictEqual((await backupService(checksumDirectory).status()).code, 'BACKUP_CHECKSUM_MISMATCH');

  const incompleteDirectory = path.join(root, 'incomplete');
  writeBackup(incompleteDirectory, { sql: dumpText({ complete: false }) });
  assert.strictEqual((await backupService(incompleteDirectory).status()).code, 'BACKUP_SQL_INCOMPLETE');

  const failedFs = {
    lstatSync() {
      throw new Error(`Acceso denegado en ${SECRET_PATH}`);
    }
  };
  const fsFailure = await backupService(SECRET_PATH, { fsApi: failedFs }).status();
  assert.strictEqual(fsFailure.code, 'BACKUP_CHECK_FAILED');
  assert(!JSON.stringify(fsFailure).includes(SECRET_PATH));
}

function fakeDirectoryEntry(name, type = 'file') {
  return {
    name,
    isFile: () => type === 'file',
    isSymbolicLink: () => type === 'symlink'
  };
}

function testCandidateSafety() {
  const directory = path.resolve('virtual-backups');
  const names = [
    'tienda_2026-07-24_120004.sql',
    'tienda_2026-07-24_120003.sql',
    'tienda_2026-07-24_120002.sql',
    'tienda_2026-07-24_120001.sql'
  ];
  let fileStats = 0;
  const fsApi = {
    lstatSync(filePath) {
      if (filePath === directory) {
        return { isDirectory: () => true, isSymbolicLink: () => false };
      }
      fileStats += 1;
      return {
        isFile: () => true,
        isSymbolicLink: () => false,
        size: 100,
        mtimeMs: Number(path.basename(filePath).match(/(\d{6})\.sql$/)?.[1] || 1)
      };
    },
    readdirSync() {
      return [
        fakeDirectoryEntry('../escape_2026-07-24_120009.sql'),
        fakeDirectoryEntry('tienda_2026-07-24_120010.sql', 'symlink'),
        fakeDirectoryEntry('tienda_2026-07-24_120011.sql', 'directory'),
        ...names.map((name) => fakeDirectoryEntry(name))
      ];
    }
  };
  const snapshot = inspectDirectory({ directory, fsApi, candidateLimit: 2 });
  assert.strictEqual(snapshot.inspectedCandidates, 2);
  assert(fileStats <= 3, 'No deben inspeccionarse mas candidatos que el limite y su manifiesto.');
  assert(!snapshot.candidate.path.includes('escape'));

  const unsafeOnly = {
    lstatSync: fsApi.lstatSync,
    readdirSync: () => [
      fakeDirectoryEntry('../escape_2026-07-24_120009.sql'),
      fakeDirectoryEntry('tienda_2026-07-24_120010.sql', 'symlink')
    ]
  };
  assert.strictEqual(inspectDirectory({
    directory,
    fsApi: unsafeOnly,
    candidateLimit: 2
  }).candidate, null);
}

async function testCache(root) {
  const directory = path.join(root, 'cache');
  const fixture = writeBackup(directory);
  let monotonic = 0;
  let calls = 0;
  const verified = {
    manifest: { backup: { createdUtc: new Date(NOW.getTime() - 3600000).toISOString() } }
  };
  const service = backupService(directory, {
    cacheMs: 100,
    monotonicNow: () => monotonic,
    verifier: async () => {
      calls += 1;
      return verified;
    }
  });
  await service.status();
  await service.status();
  assert.strictEqual(calls, 1, 'La cache debe reutilizar la verificacion.');

  fs.appendFileSync(fixture.sqlPath, 'x');
  await service.status();
  assert.strictEqual(calls, 2, 'Cambiar el tamano debe invalidar la cache.');

  const changedTime = new Date(fs.statSync(fixture.sqlPath).mtimeMs + 60000);
  fs.utimesSync(fixture.sqlPath, changedTime, changedTime);
  await service.status();
  assert.strictEqual(calls, 3, 'Cambiar mtime debe invalidar la cache.');

  monotonic = 101;
  await service.status();
  assert.strictEqual(calls, 4, 'El TTL vencido debe volver a verificar.');

  writeBackup(directory, { name: 'tienda_test_2026-07-24_130000.sql' });
  const newest = path.join(directory, 'tienda_test_2026-07-24_130000.sql');
  const newestTime = new Date(fs.statSync(fixture.sqlPath).mtimeMs + 120000);
  fs.utimesSync(newest, newestTime, newestTime);
  await service.status();
  assert.strictEqual(calls, 5, 'Un candidato mas reciente debe invalidar la cache.');

  let concurrentCalls = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const concurrent = backupService(directory, {
    cacheMs: 100,
    verifier: async () => {
      concurrentCalls += 1;
      await gate;
      return verified;
    }
  });
  const first = concurrent.status();
  const second = concurrent.status();
  release();
  assert.strictEqual(await first, await second);
  assert.strictEqual(concurrentCalls, 1, 'Solicitudes simultaneas deben deduplicarse.');

  let recoveryNow = 0;
  let recoveryCalls = 0;
  const recovering = backupService(directory, {
    cacheMs: 10,
    monotonicNow: () => recoveryNow,
    verifier: async () => {
      recoveryCalls += 1;
      if (recoveryCalls === 1) throw new Error('Fallo temporal');
      return verified;
    }
  });
  assert.strictEqual((await recovering.status()).code, 'BACKUP_CHECK_FAILED');
  recoveryNow = 11;
  assert.strictEqual((await recovering.status()).code, 'BACKUP_OK');
}

async function testDiagnosticComposition() {
  const healthy = await diagnosticService({
    status: 'ok', code: 'BACKUP_OK', durationMs: 2, ageHours: 1
  }).diagnose();
  assert.strictEqual(healthy.status, 'healthy');
  assert.strictEqual(healthy.httpStatus, 200);
  assert.strictEqual(healthy.checks.migrations.expectedCount, 13);

  const degraded = await diagnosticService({
    status: 'warning', code: 'BACKUP_STALE', durationMs: 2, ageHours: 30
  }).diagnose();
  assert.strictEqual(degraded.status, 'degraded');
  assert.strictEqual(degraded.httpStatus, 200);

  const missing = await diagnosticService({
    status: 'error', code: 'BACKUP_MISSING', durationMs: 1
  }).diagnose();
  assert.strictEqual(missing.status, 'degraded');
  assert.strictEqual(missing.httpStatus, 200);

  const databaseDown = await diagnosticService({
    status: 'ok', code: 'BACKUP_OK', durationMs: 2, ageHours: 1
  }, healthyReadiness({
    status: 'unhealthy',
    checks: { database: 'unavailable', migrations: 'unavailable' },
    reason: 'DATABASE_UNAVAILABLE',
    diagnostics: { expectedMigrations: 13, appliedMigrations: null }
  })).diagnose();
  assert.strictEqual(databaseDown.status, 'unhealthy');
  assert.strictEqual(databaseDown.httpStatus, 503);

  const migrationsMissing = await diagnosticService({
    status: 'ok', code: 'BACKUP_OK', durationMs: 2, ageHours: 1
  }, healthyReadiness({
    status: 'unhealthy',
    checks: { database: 'ok', migrations: 'error' },
    reason: 'MIGRATIONS_INCOMPLETE',
    diagnostics: { expectedMigrations: 13, appliedMigrations: 12 }
  })).diagnose();
  assert.strictEqual(migrationsMissing.status, 'unhealthy');
  assert.strictEqual(migrationsMissing.checks.migrations.appliedCount, 12);
}

async function testAuthorizationAndHttp() {
  const safeDiagnostic = diagnosticService({
    status: 'ok', code: 'BACKUP_OK', durationMs: 2, ageHours: 1
  });
  const fixture = await startFixture(safeDiagnostic);
  try {
    const anonymous = await fetch(`${fixture.baseUrl}/api/admin/health`);
    assert.strictEqual(anonymous.status, 401);
    for (const identity of [
      { role: 'administrador', plan: 'interno' },
      { role: 'dueno_tienda', plan: 'basico' },
      { role: 'dueno_tienda', plan: 'avanzado' }
    ]) {
      const denied = await fetch(`${fixture.baseUrl}/api/admin/health`, {
        headers: { 'X-Test-Role': identity.role, 'X-Test-Plan': identity.plan }
      });
      assert.strictEqual(denied.status, 403, `El perfil ${identity.plan} no debe acceder.`);
    }
    const allowed = await fetch(`${fixture.baseUrl}/api/admin/health`, {
      headers: { 'X-Test-Role': 'superadmin' }
    });
    const payload = await responseJson(allowed);
    assert.strictEqual(allowed.status, 200);
    assert.strictEqual(payload.status, 'healthy');
    assert(allowed.headers.get('x-request-id'));
    assert.match(allowed.headers.get('cache-control') || '', /no-store/);
    assert(fixture.logger.entries.some((entry) => entry.event === 'http_request_rejected'),
      'Los accesos denegados deben conservar el registro HTTP existente.');
  } finally {
    await fixture.close();
  }

  const limited = await startFixture(safeDiagnostic, { adminMax: 2 });
  try {
    const headers = { 'X-Test-Role': 'superadmin' };
    assert.strictEqual((await fetch(`${limited.baseUrl}/api/admin/health`, { headers })).status, 200);
    assert.strictEqual((await fetch(`${limited.baseUrl}/api/admin/health`, { headers })).status, 200);
    assert.strictEqual((await fetch(`${limited.baseUrl}/api/admin/health`, { headers })).status, 429);
  } finally {
    await limited.close();
  }

  const unsafeValues = [
    SECRET_PATH, SECRET_FILE, SECRET_HASH, 'db.internal', 'tienda_privada',
    'usuario_privado', 'SELECT 1', 'sqlMessage', 'PRIVATE CERTIFICATE', 'stack'
  ];
  const unhealthyFixture = await startFixture(diagnosticService({
    status: 'error',
    code: 'BACKUP_CHECK_FAILED',
    durationMs: 2,
    fileName: SECRET_FILE,
    path: SECRET_PATH,
    sha256: SECRET_HASH
  }, healthyReadiness({
    status: 'unhealthy',
    checks: { database: 'unavailable', migrations: 'unavailable' },
    reason: 'DATABASE_UNAVAILABLE',
    diagnostics: { expectedMigrations: 13, appliedMigrations: null },
    host: 'db.internal',
    sql: 'SELECT 1'
  })));
  try {
    const response = await fetch(`${unhealthyFixture.baseUrl}/api/admin/health`, {
      headers: { 'X-Test-Role': 'superadmin' }
    });
    const text = await response.text();
    assert.strictEqual(response.status, 503);
    for (const unsafe of unsafeValues) assert(!text.includes(unsafe));
    assert(unhealthyFixture.logger.entries.some((entry) => entry.event === 'operational_backup_degraded'));
    assert(!JSON.stringify(unhealthyFixture.logger.entries).includes(SECRET_PATH));
  } finally {
    await unhealthyFixture.close();
  }
}

function testReadOnlyAndMounting(root) {
  const serviceSource = fs.readFileSync(path.join(ROOT, 'services', 'backup-status-service.js'), 'utf8');
  assert(!/\b(?:writeFile|appendFile|mkdir|chmod|rename|unlink|rmSync|spawn|execFile|mysqldump|mysql\.create)/.test(serviceSource),
    'El servicio de estado debe ser estrictamente de solo lectura.');
  const serverSource = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  const mount = "app.use('/api/admin/health', requireAuth, requireRole('superadmin'), adminHealthRoutes)";
  assert(serverSource.includes(mount));
  assert(serverSource.indexOf(mount) < serverSource.indexOf("app.use('/api/admin/catalogo'"));
  assert(!mount.includes('requireTenant') && !mount.includes('requireActiveSubscription'));

  const defaults = webSecurityConfig({ APP_ENV: 'test' });
  assert.deepStrictEqual(defaults.operationalBackup, {
    warningHours: 24,
    criticalHours: 48,
    cacheMs: 300000
  });
  assert.throws(() => webSecurityConfig({
    APP_ENV: 'test',
    BACKUP_WARNING_HOURS: '48',
    BACKUP_CRITICAL_HOURS: '24'
  }), /debe ser mayor/);
  assert.throws(() => webSecurityConfig({
    APP_ENV: 'test',
    BACKUP_STATUS_CACHE_MS: 'no-numero'
  }), /debe ser un entero/);

  const missing = path.join(root, 'read-only-missing');
  assert.throws(() => backupDirectory({ BACKUP_DIR: missing }, { create: false }), /No existe/);
  assert.strictEqual(fs.existsSync(missing), false);
  const created = backupDirectory({ BACKUP_DIR: missing });
  assert.strictEqual(created, fs.realpathSync(missing),
    'El modo operativo historico debe conservar la creacion explicita del directorio.');
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tienda-operational-backup-health-'));
  try {
    await testBackupStates(root);
    testCandidateSafety();
    await testCache(root);
    await testDiagnosticComposition();
    await testAuthorizationAndHttp();
    testReadOnlyAndMounting(root);

    const valid = writeBackup(path.join(root, 'compatibility'));
    const verified = await verifyBackup(valid.sqlPath, {
      environment: { BACKUP_DIR: path.dirname(valid.sqlPath) },
      readOnly: true
    });
    assert.strictEqual(verified.valid, true);

    console.log(JSON.stringify({
      resultado: 'ok',
      mysqlRealUsado: false,
      procesosExternos: 0,
      escriturasBaseDatos: 0,
      directorioRealBackupsUsado: false,
      autorizacion: ['401', '403', '200'],
      estados: ['healthy', 'degraded', 'unhealthy']
    }, null, 2));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
