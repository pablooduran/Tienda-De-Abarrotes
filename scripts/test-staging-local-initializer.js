const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const launcher = path.join(root, 'scripts', 'initialize-staging-remote.ps1');

function runPowerShell(args) {
  return spawnSync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', launcher, ...args
  ], { cwd: root, encoding: 'utf8' });
}

function outputOf(result) {
  return `${result.stdout || ''}\n${result.stderr || ''}`;
}

function main() {
  const source = fs.readFileSync(launcher, 'utf8');
  assert.match(source, /Read-Host 'Contrasena MySQL de staging' -AsSecureString/);
  assert.match(source, /\$ExpectedDatabase = 'tienda_abarrotes_staging'/);
  assert.match(source, /\$RemoteStagingFlag = '--remote-staging'/);
  assert.match(source, /\$RemoteStagingDiagnosticFlag = '--remote-staging-diagnose'/);
  assert.match(source, /\$env:DB_SSL_ENABLED = 'true'/);
  assert.match(source, /Restore-EnvironmentState -Saved \$savedEnvironment/);
  assert.match(source, /\*> \$null/);
  assert.match(source, /STAGING_REMOTE_INITIALIZATION: \$failureCategory/);
  assert.match(source, /db:diagnose-staging/);
  assert.match(source, /Invoke-RemoteStagingDiagnostic -ExitCode \(\[ref\]\$diagnosticExitCode\)/);
  assert(!source.includes('$diagnosticExitCode = Invoke-RemoteStagingDiagnostic'), 'La categoria no debe quedar capturada con el codigo de salida.');
  assert(!source.includes('Start-Process'), 'El lanzador no debe crear procesos desacoplados.');
  assert(!source.includes('Set-Content'), 'El lanzador no debe guardar secretos en archivos.');

  const accepted = runPowerShell(['-ValidateOnly']);
  assert.strictEqual(accepted.status, 0, outputOf(accepted));
  assert.match(outputOf(accepted), /STAGING_LOCAL_INITIALIZER_VALIDATION_OK/);

  const rejected = runPowerShell(['-ValidateOnly', '-SimulateInvalidDatabase']);
  assert.notStrictEqual(rejected.status, 0, 'Un destino distinto debe rechazarse.');
  assert.match(outputOf(rejected), /rechazada de forma segura/);
  assert(!outputOf(rejected).includes('mysql.staging.invalid'), 'La simulacion no debe revelar el host.');

  console.log(JSON.stringify({
    resultado: 'ok',
    syntaxValidated: true,
    exactDatabaseRequired: true,
    tlsRequired: true,
    remoteFlagRequired: true,
    secretsPersisted: false,
    remoteConnections: 0
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
