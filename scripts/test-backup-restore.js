const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const mysql = require('mysql2/promise');
require('../config/env');
const {
  BackupError,
  CRITICAL_TABLES,
  DELETE_CONFIRMATION,
  assertLocalRuntime,
  assertSafeTemporaryDatabase,
  cleanupBackups,
  createBackup,
  finalizeManifest,
  resolveExecutable,
  testRestore,
  verifyBackup
} = require('./backup-utils');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function expectCode(action, code, message) {
  try {
    await action();
  } catch (error) {
    assert(error.code === code, `${message} Codigo recibido: ${error.code || 'sin codigo'}.`);
    return;
  }
  throw new Error(`${message} No se produjo el rechazo esperado.`);
}

function cloneManifest(source, sqlPath, mutate = () => {}) {
  const manifest = JSON.parse(JSON.stringify(source));
  manifest.backup.fileName = path.basename(sqlPath);
  mutate(manifest);
  const final = finalizeManifest(manifest);
  fs.writeFileSync(sqlPath.replace(/\.sql$/i, '.manifest.json'), `${JSON.stringify(final, null, 2)}\n`);
  return final;
}

async function sourceFingerprint(config) {
  const connection = await mysql.createConnection(config);
  try {
    const [tables] = await connection.query(
      `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_SCHEMA=? AND TABLE_TYPE='BASE TABLE' ORDER BY TABLE_NAME`,
      [config.database]
    );
    const [[migrations]] = await connection.query('SELECT COUNT(*) total FROM schema_migrations');
    const tableNames = new Map(tables.map((row) => [String(row.TABLE_NAME).toLowerCase(), row.TABLE_NAME]));
    const counts = {};
    for (const requested of CRITICAL_TABLES) {
      const actual = tableNames.get(requested.toLowerCase());
      if (!actual) continue;
      const safeName = `\`${String(actual).replace(/`/g, '``')}\``;
      const [[row]] = await connection.query(`SELECT COUNT(*) total FROM ${safeName}`);
      counts[actual] = Number(row.total);
    }
    return { tables: tables.map((row) => row.TABLE_NAME), migrations: Number(migrations.total), counts };
  } finally {
    await connection.end();
  }
}

async function temporaryRestoreDatabases(config) {
  const adminConfig = { ...config };
  delete adminConfig.database;
  const connection = await mysql.createConnection(adminConfig);
  try {
    const [rows] = await connection.query(
      "SELECT SCHEMA_NAME FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME LIKE 'tmp\\_tienda\\_restore\\_%' ESCAPE '\\\\'"
    );
    return rows.map((row) => row.SCHEMA_NAME);
  } finally {
    await connection.end();
  }
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tienda-backup-test-'));
  const backupDir = path.join(root, 'backups con espacios');
  const outsideFile = path.join(root, 'fuera.sql');
  const environment = {
    ...process.env,
    APP_ENV: 'local',
    NODE_ENV: 'test',
    DB_HOST: 'localhost',
    DB_SSL_ENABLED: 'false',
    BACKUP_DIR: backupDir
  };
  const config = assertLocalRuntime(environment, 'La prueba de backup');
  const dedicatedRestoreConfigured = Boolean(
    String(environment.BACKUP_RESTORE_USER || '').trim()
    && String(environment.BACKUP_RESTORE_PASSWORD || '')
  );
  const deniedRestoreEnvironment = {
    ...environment,
    BACKUP_RESTORE_USER: `restore_denied_${crypto.randomBytes(4).toString('hex')}`,
    BACKUP_RESTORE_PASSWORD: crypto.randomBytes(24).toString('base64url')
  };
  assert(/(prueba|test)/i.test(config.database), 'test:backup-restore exige una base local cuyo nombre contenga prueba o test.');
  const initialTemporary = await temporaryRestoreDatabases(config);
  assert(initialTemporary.length === 0, `Existen bases temporales previas sin limpiar: ${initialTemporary.join(', ')}.`);
  const initialFingerprint = await sourceFingerprint(config);
  const logs = [];
  const logger = { log: (value) => logs.push(String(value)), warn: (value) => logs.push(String(value)) };
  let backup;
  let checks = 0;
  const check = (condition, message) => {
    assert(condition, message);
    checks += 1;
    console.log(`OK ${checks}: ${message}`);
  };

  try {
    await expectCode(
      () => Promise.resolve(assertLocalRuntime({ ...environment, DB_HOST: 'db.example.com' }, 'Backup remoto')),
      'BACKUP_REMOTE_HOST_FORBIDDEN', 'El host remoto no fue rechazado.'
    );
    check(true, 'Host remoto rechazado.');
    await expectCode(
      () => Promise.resolve(assertLocalRuntime({ ...environment, APP_ENV: 'production' }, 'Backup de produccion')),
      'BACKUP_ENVIRONMENT_FORBIDDEN', 'Produccion no fue rechazada.'
    );
    check(true, 'Produccion rechazada.');
    await expectCode(
      () => Promise.resolve(assertSafeTemporaryDatabase('tienda_abarrotes_pruebas')),
      'RESTORE_DATABASE_NAME_FORBIDDEN', 'El nombre principal peligroso no fue rechazado.'
    );
    check(true, 'Nombre de restauracion peligroso rechazado.');

    backup = await createBackup({ environment, logger });
    check(fs.existsSync(backup.sqlPath), 'Backup local creado en una ruta con espacios.');
    check(fs.existsSync(backup.manifestPath), 'Manifiesto creado.');
    const verification = await verifyBackup(backup.sqlPath, { environment });
    check(verification.valid && verification.sha256 === backup.manifest.backup.sha256, 'Hash y manifiesto verificados.');
    check(verification.manifest.backup.migrations.length === initialFingerprint.migrations, 'schema_migrations registrado en el manifiesto.');
    check(verification.manifest.backup.tableCount === initialFingerprint.tables.length, 'Cantidad de tablas registrada.');

    const tamperedSql = path.join(backupDir, 'backup_modificado.sql');
    fs.copyFileSync(backup.sqlPath, tamperedSql);
    cloneManifest(backup.manifest, tamperedSql);
    fs.appendFileSync(tamperedSql, '\n-- alteracion de prueba\n');
    await expectCode(() => verifyBackup(tamperedSql, { environment }), 'BACKUP_SIZE_MISMATCH', 'La alteracion del SQL no fue detectada.');
    check(true, 'Modificacion del SQL detectada.');

    const manifestSql = path.join(backupDir, 'manifiesto_modificado.sql');
    fs.copyFileSync(backup.sqlPath, manifestSql);
    cloneManifest(backup.manifest, manifestSql);
    const manifestPath = manifestSql.replace(/\.sql$/i, '.manifest.json');
    const changedManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    changedManifest.backup.host = 'host-alterado';
    fs.writeFileSync(manifestPath, `${JSON.stringify(changedManifest, null, 2)}\n`);
    await expectCode(() => verifyBackup(manifestSql, { environment }), 'BACKUP_MANIFEST_INTEGRITY_FAILED', 'La alteracion del manifiesto no fue detectada.');
    check(true, 'Modificacion del manifiesto detectada.');

    let restoreValidated = false;
    if (dedicatedRestoreConfigured) {
      const restore = await testRestore(backup.sqlPath, { environment, logger });
      check(restore.cleaned && restore.checkers.length === 4, 'Restauracion temporal y cuatro comprobadores completados.');
      check(restore.migrations === initialFingerprint.migrations, 'Migraciones restauradas coinciden.');
      check(restore.foreignKeysChecked > 0, 'Integridad minima de claves foraneas comprobada.');
      check((await temporaryRestoreDatabases(config)).length === 0, 'Base temporal eliminada despues del exito.');

      await expectCode(
        () => testRestore(backup.sqlPath, {
          environment, logger,
          afterCreate: async () => { throw new BackupError('SIMULATED_RESTORE_FAILURE', 'Fallo simulado despues de CREATE DATABASE.'); }
        }),
        'SIMULATED_RESTORE_FAILURE', 'El fallo posterior a CREATE no se propago.'
      );
      check((await temporaryRestoreDatabases(config)).length === 0, 'Base temporal eliminada despues del fallo.');
      restoreValidated = true;
    } else {
      await expectCode(
        () => testRestore(backup.sqlPath, { environment, logger }),
        'RESTORE_CREDENTIALS_MISSING', 'La ausencia de una cuenta de restauracion limitada no se informo.'
      );
      check((await temporaryRestoreDatabases(config)).length === 0, 'El intento sin credenciales de restauracion no dejo una base temporal.');
    }

    await expectCode(
      () => testRestore(backup.sqlPath, {
        environment: deniedRestoreEnvironment, logger,
        createAdminConnection: async () => {
          const error = new Error('denied');
          error.code = 'ER_DBACCESS_DENIED_ERROR';
          throw error;
        }
      }),
      'RESTORE_PRIVILEGES_REQUIRED', 'La falta de permisos no produjo un error claro.'
    );
    check(true, 'Falta de permisos CREATE/DROP informada claramente.');

    const beforeFailedBackup = new Set(fs.readdirSync(backupDir));
    await expectCode(
      () => createBackup({
        environment,
        logger,
        now: new Date(Date.now() + 60000),
        processRunner: async (_executable, args) => {
          if (args.includes('--version')) return { stdout: 'mysqldump test 8.0', stderr: '' };
          throw new BackupError('SIMULATED_DUMP_FAILURE', 'Fallo simulado de mysqldump.');
        }
      }),
      'SIMULATED_DUMP_FAILURE', 'El fallo parcial de mysqldump no se propago.'
    );
    const afterFailedBackup = fs.readdirSync(backupDir);
    check(afterFailedBackup.every((name) => beforeFailedBackup.has(name)), 'Un dump parcial no publico SQL, manifiesto ni temporal.');

    fs.writeFileSync(outsideFile, '-- MySQL dump\n');
    await expectCode(() => verifyBackup(outsideFile, { environment }), 'BACKUP_PATH_OUTSIDE_ALLOWED_DIRECTORY', 'La ruta externa no fue rechazada.');
    check(true, 'Traversal y archivo fuera de BACKUP_DIR rechazados.');
    await expectCode(
      () => Promise.resolve(resolveExecutable('mysqldump', { ...environment, MYSQLDUMP_PATH: path.join(root, 'no-mysqldump.exe') })),
      'MYSQL_TOOL_NOT_FOUND', 'mysqldump ausente no fue detectado.'
    );
    check(true, 'mysqldump ausente produce error claro.');
    await expectCode(
      () => Promise.resolve(resolveExecutable('mysql', { ...environment, MYSQL_CLIENT_PATH: path.join(root, 'no-mysql.exe') })),
      'MYSQL_TOOL_NOT_FOUND', 'mysql ausente no fue detectado.'
    );
    check(true, 'mysql.exe ausente produce error claro.');

    const oldSql = path.join(backupDir, 'backup_antiguo.sql');
    const latestSql = path.join(backupDir, 'backup_reciente.sql');
    fs.copyFileSync(backup.sqlPath, oldSql);
    fs.copyFileSync(backup.sqlPath, latestSql);
    cloneManifest(backup.manifest, oldSql);
    cloneManifest(backup.manifest, latestSql);
    const oldDate = new Date(Date.now() - 10 * 86400000);
    fs.utimesSync(oldSql, oldDate, oldDate);
    fs.utimesSync(oldSql.replace(/\.sql$/i, '.manifest.json'), oldDate, oldDate);
    const latestDate = new Date(Date.now() + 1000);
    fs.utimesSync(latestSql, latestDate, latestDate);
    fs.utimesSync(latestSql.replace(/\.sql$/i, '.manifest.json'), latestDate, latestDate);
    const dryRun = await cleanupBackups({ environment, days: 0, count: 1 });
    check(dryRun.mode === 'dry-run' && dryRun.candidates.length > 0 && fs.existsSync(oldSql), 'Retencion dry-run no borra archivos.');
    const applied = await cleanupBackups({
      environment, days: 0, count: 1, apply: true, confirmation: DELETE_CONFIRMATION
    });
    check(applied.deleted.length > 0 && fs.existsSync(latestSql), 'Retencion preserva siempre el backup mas reciente.');

    const finalFingerprint = await sourceFingerprint(config);
    check(JSON.stringify(finalFingerprint) === JSON.stringify(initialFingerprint), 'La base principal no fue modificada.');
    check(!logs.join('\n').includes(config.password), 'La contrasena no aparece en logs.');
    check((await temporaryRestoreDatabases(config)).length === 0, 'No quedan bases tmp_tienda_restore_.');
    check(fs.readdirSync(backupDir).every((name) => !name.includes('.partial')), 'No quedan archivos parciales.');
    console.log(JSON.stringify({
      resultado: restoreValidated ? 'ok' : 'bloqueado-configuracion',
      comprobaciones: checks,
      restauracionReal: restoreValidated
    }, null, 2));
    if (!restoreValidated) {
      throw new BackupError(
        'RESTORE_TEST_CREDENTIALS_REQUIRED',
        'Configure BACKUP_RESTORE_USER y BACKUP_RESTORE_PASSWORD con permisos limitados a tmp_tienda_restore_%.* para completar la restauracion real.'
      );
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`Fallo test:backup-restore (${error.code || 'TEST_ERROR'}): ${error.message}`);
  process.exitCode = 1;
});
