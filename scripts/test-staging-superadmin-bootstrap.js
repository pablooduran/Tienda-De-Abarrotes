const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  INITIAL_STAGING_DATABASE,
  REMOTE_STAGING_SUPERADMIN_ARGUMENT,
  REMOTE_STAGING_SUPERADMIN_CONFIRMATION,
  resolveSuperadminCreationMode
} = require('../config/staging-database-mutation-guard');

function stagingEnvironment(extra = {}) {
  return {
    APP_ENV: 'staging', NODE_ENV: 'production', DB_ENVIRONMENT: 'staging',
    DB_HOST: 'mysql.staging.invalid', DB_NAME: INITIAL_STAGING_DATABASE,
    DB_SSL_ENABLED: 'true', DB_SSL_CA: 'synthetic-ca',
    STAGING_SUPERADMIN_CONFIRMATION: REMOTE_STAGING_SUPERADMIN_CONFIRMATION,
    ...extra
  };
}

function main() {
  assert.deepStrictEqual(resolveSuperadminCreationMode({
    args: [], environment: { APP_ENV: 'local', DB_HOST: 'localhost' }
  }), { type: 'local' });
  assert.deepStrictEqual(resolveSuperadminCreationMode({
    args: [REMOTE_STAGING_SUPERADMIN_ARGUMENT], environment: stagingEnvironment()
  }), { type: 'remote-staging-superadmin' });
  assert.throws(() => resolveSuperadminCreationMode({
    args: [], environment: stagingEnvironment()
  }), /--remote-staging-superadmin/);
  assert.throws(() => resolveSuperadminCreationMode({
    args: [REMOTE_STAGING_SUPERADMIN_ARGUMENT],
    environment: stagingEnvironment({ STAGING_SUPERADMIN_CONFIRMATION: '' })
  }), /confirmacion explicita/);
  assert.throws(() => resolveSuperadminCreationMode({
    args: [REMOTE_STAGING_SUPERADMIN_ARGUMENT],
    environment: stagingEnvironment({ DB_NAME: 'otra_base' })
  }), /DB_NAME=/);

  const source = fs.readFileSync(path.join(__dirname, 'create-superadmin.js'), 'utf8');
  assert(source.includes("expectedMigrations.length !== 25"));
  assert(source.includes("JSON.stringify(recordedMigrations) !== JSON.stringify(expectedMigrations)"));
  assert(source.includes("WHERE rol='superadmin'"));
  assert(source.includes('GET_LOCK'));
  assert(source.includes('beginTransaction'));
  assert(source.includes('connection.rollback'));
  assert(source.includes('connection.commit'));
  assert(source.includes("VALUES (NULL, ?, ?, 'superadmin', 1)"));
  assert(source.includes("created.rol !== 'superadmin'"));

  const launcher = path.join(__dirname, 'create-staging-superadmin.ps1');
  const launcherSource = fs.readFileSync(launcher, 'utf8');
  assert(launcherSource.includes('Resolve-SafeFailureReason'));
  assert(launcherSource.includes('Aiven rechazo el usuario o la contrasena MySQL.'));
  assert(launcherSource.includes('Motivo: $safeFailureReason'));
  const valid = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', launcher, '-ValidateOnly'], { encoding: 'utf8' });
  assert.strictEqual(valid.status, 0, valid.stderr);
  assert.match(valid.stdout, /STAGING_SUPERADMIN_LAUNCHER_VALIDATION_OK/);
  const invalid = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', launcher, '-ValidateOnly', '-SimulateInvalidDatabase'], { encoding: 'utf8' });
  assert.notStrictEqual(invalid.status, 0);
  assert.match(invalid.stdout, /STAGING_SUPERADMIN_LAUNCHER_VALIDATION_REJECTED/);

  console.log('test:staging-superadmin-bootstrap OK');
}

main();
