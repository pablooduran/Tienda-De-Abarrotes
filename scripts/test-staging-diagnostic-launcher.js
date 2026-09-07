const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const tls = require('tls');
const contract = require('../config/staging-remote-status-contract.json');

const root = path.resolve(__dirname, '..');
const launcher = path.join(root, 'scripts', 'initialize-staging-remote.ps1');
const preload = path.join(__dirname, 'test-support', 'staging-offline-driver.js');

function writeWrapper(directory) {
  const wrapperPath = path.join(directory, 'invoke-launcher.ps1');
  const source = [
    'param([string]$Launcher, [string]$CertificatePath, [string]$TracePath, [string]$Mode)',
    '$global:answers = @("tienda_abarrotes_staging", "offline-staging.invalid", "3306", "offline-user", $CertificatePath, "CONFIRM_EMPTY_STAGING_001_024")',
    '$global:answerIndex = 0',
    'function global:Read-Host {',
    '  param([string]$Prompt, [switch]$AsSecureString)',
    '  if ($AsSecureString) {',
    '    $value = New-Object System.Security.SecureString',
    "    foreach ($character in 'synthetic-Pa$$%&!value'.ToCharArray()) { $value.AppendChar($character) }",
    '    $value.MakeReadOnly()',
    '    Write-Output -NoEnumerate $value',
    '    return',
    '  }',
    '  $answer = $global:answers[$global:answerIndex]',
    '  $global:answerIndex += 1',
    '  return $answer',
    '}',
    '$names = @("APP_ENV", "NODE_ENV", "DB_ENVIRONMENT", "DB_HOST", "DB_PORT", "DB_NAME", "DB_USER", "DB_PASSWORD", "DB_SSL_ENABLED", "DB_SSL_CA", "DB_SSL_CA_PATH", "STAGING_DB_MUTATION_CONFIRMATION", "STAGING_REMOTE_PREFLIGHT_CONFIRMATION")',
    '$saved = @{}',
    'foreach ($name in $names) { $saved[$name] = [Environment]::GetEnvironmentVariable($name, "Process") }',
    '$beforeLocation = (Get-Location).Path',
    'if ($Mode -eq "Flow") { & $Launcher } elseif ($Mode -eq "Preflight") { & $Launcher -Preflight } else { & $Launcher -Diagnose }',
    '$resultCode = $LASTEXITCODE',
    '$restored = (Get-Location).Path -eq $beforeLocation',
    'foreach ($name in $names) { if ([Environment]::GetEnvironmentVariable($name, "Process") -cne $saved[$name]) { $restored = $false } }',
    'if (-not $restored) { Write-Output "OFFLINE_ENVIRONMENT_RESTORE_FAILED"; exit 90 }',
    'Add-Content -LiteralPath $TracePath -Value \'{"entry":"powershell","event":"ENVIRONMENT_RESTORED"}\'',
    'exit $resultCode'
  ].join('\r\n');
  fs.writeFileSync(wrapperPath, source, 'utf8');
  return wrapperPath;
}

function safeEnvironment(directory, tracePath, scenario) {
  const environment = {};
  for (const name of ['PATH', 'Path', 'SystemRoot', 'WINDIR', 'COMSPEC', 'ComSpec', 'PATHEXT', 'TEMP', 'TMP']) {
    if (process.env[name]) environment[name] = process.env[name];
  }
  return {
    ...environment,
    NODE_OPTIONS: '--require ' + JSON.stringify(preload),
    STAGING_OFFLINE_TEST: 'SYNTHETIC_NO_NETWORK',
    STAGING_TEST_TRACE: tracePath,
    STAGING_TEST_SCENARIO: scenario,
    npm_config_userconfig: path.join(directory, 'unused-npmrc'),
    npm_config_audit: 'false',
    npm_config_fund: 'false',
    npm_config_offline: 'true',
    npm_config_update_notifier: 'false',
    DB_SSL_CA_PATH: 'synthetic-inherited-ca-path',
    STAGING_DB_MUTATION_CONFIRMATION: 'synthetic-inherited-confirmation'
  };
}

function runCase(directory, wrapper, certificatePath, scenario, mode = 'Diagnose') {
  const tracePath = path.join(directory, 'trace-' + scenario.replace(/[^a-z0-9]/gi, '-') + '-' + mode + '.jsonl');
  const result = spawnSync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', wrapper,
    '-Launcher', launcher, '-CertificatePath', certificatePath, '-TracePath', tracePath, '-Mode', mode
  ], {
    cwd: directory,
    env: safeEnvironment(directory, tracePath, scenario),
    encoding: 'utf8', timeout: 45000, maxBuffer: 1024 * 1024
  });
  assert.equal(result.error, undefined, 'El lanzador no termino dentro de su limite local.');
  const output = (result.stdout || '').trim();
  assert.equal((result.stderr || '').trim(), '', 'El lanzador no debe emitir errores crudos.');
  const trace = fs.existsSync(tracePath)
    ? fs.readFileSync(tracePath, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line))
    : [];
  const violations = trace.filter((item) => ['NETWORK_ATTEMPT', 'ENV_FILE_READ', 'UNEXPECTED_QUERY'].includes(item.event));
  assert.equal(violations.length, 0, 'Contrato aislado: ' + violations.map((item) => item.entry + '/' + item.event).join(','));
  assert(trace.some((item) => item.event === 'ENVIRONMENT_RESTORED'), 'No se verifico la restauracion del entorno.');
  for (const value of ['offline-staging.invalid', 'offline-user', 'synthetic-Pa$$%&!value', 'synthetic-secret-that-must-not-leak', certificatePath, 'BEGIN CERTIFICATE', 'SELECT ', 'TypeError:', ' at ']) {
    assert(!output.includes(value), 'La salida expuso una entrada o detalle no permitido.');
  }
  return { result, output, trace };
}

function main() {
  if (process.platform !== 'win32') {
    console.log('STAGING_POWERSHELL_TEST_NOT_APPLICABLE: Windows launcher; driver contract is tested separately.');
    return;
  }
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tienda-staging-real-launcher-'));
  const certificatePath = path.join(directory, 'ca.pem');
  let cases = 0;
  try {
    const wrapper = writeWrapper(directory);
    fs.writeFileSync(certificatePath, tls.rootCertificates[0], 'utf8');
    const check = (scenario, suffix, exitCode = 1, mode = 'Diagnose') => {
      const run = runCase(directory, wrapper, certificatePath, scenario, mode);
      const prefix = mode === 'Preflight' ? 'STAGING_REMOTE_PREFLIGHT: ' : 'STAGING_REMOTE_DIAGNOSTIC: ';
      assert.equal(run.output, prefix + suffix, 'Resultado inesperado en caso ' + scenario + '/' + mode + ': ' + run.output + '; pasos=' + run.trace.map((item) => item.event + (item.kind ? '/' + item.kind + '/' + item.line : '')).join(','));
      assert.equal(run.result.status, exitCode, 'Codigo de salida incorrecto en caso ' + scenario);
      assert(!run.trace.some((item) => item.event === 'SIMULATED_DDL'), 'Lectura no debe intentar DDL.');
      cases += 1;
      return run;
    };
    check('empty', 'EMPTY', 0);
    check('baseline', 'BASELINE_INITIAL');
    check('partial', 'PARTIAL_OR_UNEXPECTED');
    check('frozen-regression', 'CONNECTION_OR_CONFIGURATION_FAILURE CONNECTION PREREQUISITE_LOCAL LOCAL_TYPE_ERROR');
    check('read-failure', 'CONNECTION_OR_CONFIGURATION_FAILURE READ DATABASE_NOT_FOUND_OR_PERMISSION ER_TABLEACCESS_DENIED_ERROR');
    check('close-failure', 'CONNECTION_OR_CONFIGURATION_FAILURE CLOSE NETWORK_TIMEOUT_OR_ALLOWLIST ECONNRESET');
    for (const [code, cause] of Object.entries({
      ER_ACCESS_DENIED_ERROR: 'AUTHENTICATION',
      ER_BAD_DB_ERROR: 'DATABASE_NOT_FOUND_OR_PERMISSION',
      ER_SSL_CONNECTION_ERROR: 'TLS_CA',
      ETIMEDOUT: 'NETWORK_TIMEOUT_OR_ALLOWLIST',
      ENOTFOUND: 'NETWORK_TIMEOUT_OR_ALLOWLIST'
    })) {
      check('connection:' + code, 'CONNECTION_OR_CONFIGURATION_FAILURE CONNECTION ' + cause + ' ' + code);
    }
    check('connection:TYPE_ERROR', 'CONNECTION_OR_CONFIGURATION_FAILURE CONNECTION PREREQUISITE_LOCAL LOCAL_TYPE_ERROR');
    check('connection:UNLISTED_ERROR', 'CONNECTION_OR_CONFIGURATION_FAILURE CONNECTION UNKNOWN_SAFE_FAILURE UNCLASSIFIED_ERROR');
    for (const scenario of ['protocol-missing', 'protocol-unknown', 'protocol-duplicate', 'protocol-mixed']) {
      check(scenario, 'CONNECTION_OR_CONFIGURATION_FAILURE LAUNCHER PREREQUISITE_LOCAL CHILD_PROTOCOL_INVALID');
    }
    for (const scenario of ['protocol-exit', 'protocol-success-exit']) {
      check(scenario, 'CONNECTION_OR_CONFIGURATION_FAILURE LAUNCHER PREREQUISITE_LOCAL CHILD_EXIT_INCONSISTENT');
    }
    check('empty', 'PASS', 0, 'Preflight');
    check('frozen-regression', 'FAIL CONNECTION PREREQUISITE_LOCAL LOCAL_TYPE_ERROR', 1, 'Preflight');
    check('session-failure', 'FAIL SESSION_TIME_ZONE SESSION_TIME_ZONE_FAILED ER_SPECIFIC_ACCESS_DENIED_ERROR', 1, 'Preflight');
    check('no-create-privilege', 'FAIL CREATE_PRIVILEGE SCHEMA_CREATE_PRIVILEGE_MISSING CREATE_PRIVILEGE_NOT_GRANTED', 1, 'Preflight');
    const stopped = runCase(directory, wrapper, certificatePath, 'init-failure', 'Flow');
    assert.equal(stopped.result.status, 1);
    assert(stopped.output.includes('STAGING_REMOTE_DB_INIT: FAIL CONNECTION AUTHENTICATION ER_ACCESS_DENIED_ERROR'));
    assert(!stopped.trace.some((item) => item.entry === 'migrate-db.js'), 'No migrar tras init fallido.');
    cases += 1;
    const flow = runCase(directory, wrapper, certificatePath, 'flow', 'Flow');
    assert.equal(flow.result.status, 1);
    assert(flow.output.includes('STAGING_REMOTE_PREFLIGHT: PASS'));
    assert(flow.output.includes('STAGING_REMOTE_DB_INIT: PASS'));
    assert(flow.output.includes('STAGING_REMOTE_DB_MIGRATE: FAIL MIGRATION_BASELINE DATABASE_NOT_FOUND_OR_PERMISSION ER_TABLEACCESS_DENIED_ERROR'));
    const normalized = flow.trace.filter((item) => item.event === 'DRIVER_NORMALIZED');
    assert.deepEqual(normalized.map((item) => item.entry), ['preflight-staging-remote.js', 'init-db.js', 'migrate-db.js']);
    assert.equal(new Set(normalized.map((item) => item.fingerprint)).size, 1, 'Divergencia de configuracion o ejecutable entre fases.');
    const diagnostic = runCase(directory, wrapper, certificatePath, 'same-config', 'Diagnose');
    assert.equal(diagnostic.result.status, 0);
    assert.equal(diagnostic.trace.find((item) => item.event === 'DRIVER_NORMALIZED').fingerprint, normalized[0].fingerprint);
    assert.equal(flow.trace.filter((item) => item.event === 'SIMULATED_DDL').length, 11);
    assert(!flow.trace.some((item) => item.entry === 'migrate-db.js' && item.event === 'SIMULATED_DDL'));
    cases += 2;
    assert.equal(new Set(contract.phases).size, contract.phases.length);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
  console.log(JSON.stringify({ resultado: 'ok', cases, realPowerShellNpmNode: true, realMysqlNormalizer: true,
    identicalEffectiveConfig: true, environmentFilesRead: 0, remoteConnections: 0, databaseMutations: 0, temporariesCleaned: true }, null, 2));
}

try { main(); } catch (error) {
  console.error('STAGING_REAL_LAUNCHER_TEST_FAILED: ' + (error.code === 'ERR_ASSERTION' ? error.message.split('\n')[0] : 'LOCAL_TEST_FAILURE'));
  process.exitCode = 1;
}
