const assert = require('assert');
const path = require('path');
const { spawnSync } = require('child_process');
const packageJson = require('../package.json');
const {
  missingEnvironmentWarning,
  resolveEnvironmentFile
} = require('../config/environment-selection');
const { createLocalEnvironment } = require('./start-local');

const root = path.join(__dirname, '..');
const sentinelPassword = 'startup-test-password-secret';
const sentinelSession = 'startup-test-session-secret';
const sentinelCa = 'startup-test-ca-secret';

function safeTestEnvironment(extra = {}) {
  return {
    ...process.env,
    APP_ENV: 'production',
    DB_HOST: 'localhost',
    DB_PORT: '3306',
    DB_USER: 'startup_test_user',
    DB_PASSWORD: sentinelPassword,
    DB_NAME: 'tienda_abarrotes_pruebas',
    DB_SSL_ENABLED: 'false',
    SESSION_SECRET: sentinelSession,
    DB_SSL_CA: sentinelCa,
    ...extra
  };
}

function outputOf(result) {
  return `${result.stdout || ''}\n${result.stderr || ''}`;
}

function assertNoSecrets(output) {
  for (const secret of [sentinelPassword, sentinelSession, sentinelCa]) {
    assert(!output.includes(secret), 'La salida no debe exponer secretos.');
  }
}

function runNpmLocalCheck() {
  const windows = process.platform === 'win32';
  const command = windows ? process.env.ComSpec || 'cmd.exe' : 'npm';
  const args = windows
    ? ['/d', '/s', '/c', 'npm.cmd run start:local -- --check']
    : ['run', 'start:local', '--', '--check'];
  return spawnSync(command, args, {
    cwd: root,
    env: safeTestEnvironment(),
    encoding: 'utf8'
  });
}

function runEnvironmentProbe(appEnv) {
  const script = [
    "const env = require('./config/env');",
    'console.log(JSON.stringify({',
    'activeEnvironment: env.activeEnvironment,',
    'environmentFile: env.environmentFile,',
    'isLocalEnvironment: env.isLocalEnvironment',
    '}));'
  ].join('');
  const environment = safeTestEnvironment();
  if (appEnv === undefined) delete environment.APP_ENV;
  else environment.APP_ENV = appEnv;
  return spawnSync(process.execPath, ['-e', script], {
    cwd: root,
    env: environment,
    encoding: 'utf8'
  });
}

function main() {
  assert.strictEqual(resolveEnvironmentFile('local'), '.env.local');
  assert.strictEqual(resolveEnvironmentFile(' LOCAL '), '.env.local');
  assert.strictEqual(resolveEnvironmentFile('production'), '.env');
  assert.strictEqual(resolveEnvironmentFile(undefined), '.env');
  assert.match(missingEnvironmentWarning(undefined), /npm run start:local/);
  assert.strictEqual(missingEnvironmentWarning('production'), null);

  const localEnvironment = createLocalEnvironment({ APP_ENV: 'production', KEEP_ME: 'yes' });
  assert.strictEqual(localEnvironment.APP_ENV, 'local');
  assert.strictEqual(localEnvironment.KEEP_ME, 'yes');
  assert.strictEqual(packageJson.scripts['start:local'], 'node scripts/start-local.js');
  assert.strictEqual(packageJson.scripts.start, 'node server.js');

  const localCheck = runNpmLocalCheck();
  const localOutput = outputOf(localCheck);
  assert.strictEqual(localCheck.status, 0, localOutput);
  assert.match(localOutput, /APP_ENV=local/);
  assert.match(localOutput, /configuracion=\.env\.local/);
  assert.match(localOutput, /host=localhost/);
  assertNoSecrets(localOutput);

  const productionProbe = runEnvironmentProbe('production');
  const productionOutput = outputOf(productionProbe);
  assert.strictEqual(productionProbe.status, 0, productionOutput);
  assert.match(productionOutput, /"environmentFile":"\.env"/);
  assert.match(productionOutput, /"isLocalEnvironment":false/);
  assertNoSecrets(productionOutput);

  const undefinedProbe = runEnvironmentProbe(undefined);
  const undefinedOutput = outputOf(undefinedProbe);
  assert.strictEqual(undefinedProbe.status, 0, undefinedOutput);
  assert.match(undefinedOutput, /APP_ENV no esta definido/);
  assert.match(undefinedOutput, /"environmentFile":"\.env"/);
  assertNoSecrets(undefinedOutput);

  console.log(JSON.stringify({
    localEnvironmentFile: '.env.local',
    productionEnvironmentFile: '.env',
    undefinedEnvironmentFile: '.env',
    startLocalSetsLocalEnvironment: true,
    npmStartUnchanged: true,
    secretsExposed: false
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
