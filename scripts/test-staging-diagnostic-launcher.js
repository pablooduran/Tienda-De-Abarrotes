const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const tls = require('tls');

const root = path.resolve(__dirname, '..');
const launcher = path.join(root, 'scripts', 'initialize-staging-remote.ps1');
const expectedDatabase = 'tienda_abarrotes_staging';

function writeWrapper(directory) {
  const wrapperPath = path.join(directory, 'invoke-diagnose.ps1');
  const source = `
param(
  [Parameter(Mandatory)] [string]$Launcher,
  [Parameter(Mandatory)] [string]$CertificatePath,
  [Parameter(Mandatory)] [string]$DiagnosticResult,
  [Parameter(Mandatory)] [string]$MarkerPath,
  [Parameter(Mandatory)] [string]$StubDirectory
)

$env:PATH = "$StubDirectory;$env:PATH"
$env:STAGING_TEST_DIAGNOSTIC_RESULT = $DiagnosticResult
$env:STAGING_TEST_MARKER = $MarkerPath

$global:answers = @(
  '${expectedDatabase}',
  'diagnostic-host.invalid',
  '3306',
  'diagnostic-user',
  $CertificatePath
)
$global:answerIndex = 0

function global:Read-Host {
  param([string]$Prompt, [switch]$AsSecureString)
  if ($AsSecureString) {
    Add-Content -LiteralPath $MarkerPath -Value 'READ_PASSWORD'
    $secureValue = New-Object System.Security.SecureString
    foreach ($character in 'diagnostic-password'.ToCharArray()) {
      $secureValue.AppendChar($character)
    }
    $secureValue.MakeReadOnly()
    Write-Output -NoEnumerate $secureValue
    return
  }
  Add-Content -LiteralPath $MarkerPath -Value 'READ_INPUT'
  $answer = $global:answers[$global:answerIndex]
  $global:answerIndex += 1
  return $answer
}

& $Launcher -Diagnose
exit $LASTEXITCODE
`;
  fs.writeFileSync(wrapperPath, source.trimStart(), 'utf8');
  return wrapperPath;
}

function writeNpmStub(directory) {
  const source = [
    '@echo off',
    'if not "%~1"=="run" exit /b 91',
    'if not "%~2"=="db:diagnose-staging" exit /b 92',
    'if not "%~3"=="--" exit /b 93',
    'if not "%~4"=="--remote-staging-diagnose" exit /b 94',
    'if not "%APP_ENV%"=="staging" exit /b 95',
    'if not "%NODE_ENV%"=="production" exit /b 96',
    'if not "%DB_ENVIRONMENT%"=="staging" exit /b 97',
    `if not "%DB_NAME%"=="${expectedDatabase}" exit /b 98`,
    'if not "%DB_SSL_ENABLED%"=="true" exit /b 99',
    'if not defined DB_HOST exit /b 100',
    'if not defined DB_PORT exit /b 101',
    'if not defined DB_USER exit /b 102',
    'if not defined DB_PASSWORD exit /b 103',
    'if not defined DB_SSL_CA exit /b 104',
    'echo NPM_CONTRACT_ACCEPTED>>"%STAGING_TEST_MARKER%"',
    'echo %STAGING_TEST_DIAGNOSTIC_RESULT%',
    'if "%STAGING_TEST_DIAGNOSTIC_RESULT%"=="STAGING_REMOTE_DIAGNOSTIC: EMPTY" exit /b 0',
    'exit /b 1'
  ].join('\r\n');
  fs.writeFileSync(path.join(directory, 'npm.cmd'), source, 'ascii');
}

function runWrapper(wrapperPath, certificatePath, markerPath, diagnosticResult) {
  const result = spawnSync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', wrapperPath,
    '-Launcher', launcher,
    '-CertificatePath', certificatePath,
    '-DiagnosticResult', diagnosticResult,
    '-MarkerPath', markerPath,
    '-StubDirectory', path.dirname(wrapperPath)
  ], { cwd: root, encoding: 'utf8' });
  const markers = fs.existsSync(markerPath)
    ? fs.readFileSync(markerPath, 'utf8').split(/\r?\n/).filter(Boolean)
    : [];
  return { result, markers };
}

function outputOf(result) {
  return `${result.stdout || ''}\n${result.stderr || ''}`;
}

function main() {
  const certificate = tls.rootCertificates[0];
  assert(certificate, 'Node debe proporcionar una CA de confianza para la prueba local.');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tienda-diagnose-launcher-'));
  const certificatePath = path.join(directory, 'ca.pem');
  const markerPath = path.join(directory, 'markers.txt');
  const wrapperPath = writeWrapper(directory);
  try {
    fs.writeFileSync(certificatePath, certificate, 'utf8');
    writeNpmStub(directory);

    const emptyRun = runWrapper(wrapperPath, certificatePath, markerPath, 'STAGING_REMOTE_DIAGNOSTIC: EMPTY');
    const empty = emptyRun.result;
    assert.strictEqual(empty.status, 0, `${outputOf(empty)}\n${emptyRun.markers.join(',')}`);
    assert.match(
      outputOf(empty),
      /^STAGING_REMOTE_DIAGNOSTIC: EMPTY$/m,
      `El lanzador no preservo EMPTY: ${emptyRun.markers.join(',')}`
    );
    assert.deepStrictEqual(emptyRun.markers, [
      'READ_INPUT', 'READ_INPUT', 'READ_INPUT', 'READ_INPUT', 'READ_INPUT',
      'READ_PASSWORD', 'NPM_CONTRACT_ACCEPTED'
    ]);

    fs.rmSync(markerPath, { force: true });
    const blockedRun = runWrapper(
      wrapperPath,
      certificatePath,
      markerPath,
      'STAGING_REMOTE_DIAGNOSTIC: CONNECTION_OR_CONFIGURATION_FAILURE CONNECTION UNKNOWN_SAFE_FAILURE'
    );
    const blocked = blockedRun.result;
    assert.notStrictEqual(blocked.status, 0, 'Solo EMPTY puede terminar con codigo 0.');
    assert.match(
      outputOf(blocked),
      /^STAGING_REMOTE_DIAGNOSTIC: CONNECTION_OR_CONFIGURATION_FAILURE CONNECTION UNKNOWN_SAFE_FAILURE$/m
    );
    assert.strictEqual(blockedRun.markers.at(-1), 'NPM_CONTRACT_ACCEPTED');

    const output = `${outputOf(empty)}\n${outputOf(blocked)}`;
    for (const forbidden of ['diagnostic-host.invalid', 'diagnostic-user', 'diagnostic-password', certificatePath]) {
      assert(!output.includes(forbidden), 'El lanzador no debe exponer entradas efimeras.');
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }

  console.log(JSON.stringify({
    resultado: 'ok',
    launcherMode: 'Diagnose',
    interactiveFlowSimulated: true,
    childContractVerified: true,
    remoteConnections: 0,
    mutations: 0,
    temporariesCleaned: true
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
