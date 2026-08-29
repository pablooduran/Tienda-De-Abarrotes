[CmdletBinding()]
param(
  [switch]$ValidateOnly,
  [switch]$SimulateInvalidDatabase
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ExpectedDatabase = 'tienda_abarrotes_staging'
$RemoteStagingFlag = '--remote-staging'
$RemoteStagingConfirmation = 'CONFIRM_EMPTY_STAGING_001_024'
$EnvironmentNames = @(
  'APP_ENV', 'NODE_ENV', 'DB_ENVIRONMENT', 'DB_HOST', 'DB_PORT', 'DB_NAME',
  'DB_USER', 'DB_PASSWORD', 'DB_SSL_ENABLED', 'DB_SSL_CA',
  'STAGING_DB_MUTATION_CONFIRMATION'
)

function Assert-RemoteStagingInputs {
  param(
    [Parameter(Mandatory)] [string]$DatabaseName,
    [Parameter(Mandatory)] [string]$DatabaseHost,
    [Parameter(Mandatory)] [string]$DatabasePort,
    [Parameter(Mandatory)] [string]$CertificateAuthority,
    [Parameter(Mandatory)] [string]$Confirmation
  )

  if ($DatabaseName -cne $ExpectedDatabase) {
    throw 'La base indicada no coincide con el destino de staging autorizado.'
  }
  if ([string]::IsNullOrWhiteSpace($DatabaseHost) -or @('localhost', '127.0.0.1', '::1') -contains $DatabaseHost.Trim().ToLowerInvariant()) {
    throw 'El host indicado no es un destino remoto de staging valido.'
  }
  $port = 0
  if (-not [int]::TryParse($DatabasePort, [ref]$port) -or $port -lt 1 -or $port -gt 65535) {
    throw 'El puerto indicado no es valido.'
  }
  if ($CertificateAuthority -notmatch '-----BEGIN CERTIFICATE-----' -or $CertificateAuthority -notmatch '-----END CERTIFICATE-----') {
    throw 'El certificado CA no tiene el formato PEM esperado.'
  }
  if ($Confirmation -cne $RemoteStagingConfirmation) {
    throw 'La confirmacion de base vacia no coincide.'
  }
}

function Get-TemporaryCertificateAuthority {
  $certificatePath = Read-Host 'Ruta local temporal del certificado CA de Aiven'
  if ([string]::IsNullOrWhiteSpace($certificatePath) -or -not [System.IO.File]::Exists($certificatePath)) {
    throw 'No se encontro el certificado CA temporal.'
  }
  return [System.IO.File]::ReadAllText($certificatePath)
}

function Convert-SecureStringToPlainText {
  param([Parameter(Mandatory)] [System.Security.SecureString]$SecureValue)

  $pointer = [IntPtr]::Zero
  try {
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureValue)
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  } finally {
    if ($pointer -ne [IntPtr]::Zero) {
      [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    }
  }
}

function Save-EnvironmentState {
  $saved = @{}
  foreach ($name in $EnvironmentNames) {
    $item = Get-Item -Path "Env:$name" -ErrorAction SilentlyContinue
    $saved[$name] = if ($null -eq $item) { $null } else { [string]$item.Value }
  }
  return $saved
}

function Restore-EnvironmentState {
  param([Parameter(Mandatory)] [hashtable]$Saved)

  foreach ($name in $EnvironmentNames) {
    if ($null -eq $Saved[$name]) {
      Remove-Item -Path "Env:$name" -ErrorAction SilentlyContinue
    } else {
      Set-Item -Path "Env:$name" -Value $Saved[$name]
    }
  }
}

function Invoke-RemoteStagingCommand {
  param([Parameter(Mandatory)] [string]$NpmScript)

  & npm.cmd run $NpmScript -- $RemoteStagingFlag *> $null
  if ($LASTEXITCODE -ne 0) {
    throw 'La operacion remota se detuvo sin completar el paso actual. No reintente ni comparta valores; revise el destino con la autorizacion correspondiente.'
  }
}

function Invoke-ValidationOnly {
  $database = if ($SimulateInvalidDatabase) { 'base_no_autorizada' } else { $ExpectedDatabase }
  Assert-RemoteStagingInputs -DatabaseName $database -DatabaseHost 'mysql.staging.invalid' -DatabasePort '3306' -CertificateAuthority "-----BEGIN CERTIFICATE-----`nsynthetic`n-----END CERTIFICATE-----" -Confirmation $RemoteStagingConfirmation
  Write-Output 'STAGING_LOCAL_INITIALIZER_VALIDATION_OK'
}

if ($ValidateOnly) {
  try {
    Invoke-ValidationOnly
    exit 0
  } catch {
    Write-Error 'La simulacion de validacion fue rechazada de forma segura.'
    exit 1
  }
}

$savedEnvironment = Save-EnvironmentState
$plainPassword = $null
$certificateAuthority = $null
$originalLocation = Get-Location

try {
  $repositoryRoot = Split-Path -Parent $PSScriptRoot
  if (-not [System.IO.File]::Exists((Join-Path $repositoryRoot 'package.json'))) {
    throw 'El lanzador debe ejecutarse desde una copia valida del repositorio.'
  }
  if ($null -eq (Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
    throw 'No se encontro npm.cmd para ejecutar las guardas versionadas.'
  }

  Push-Location $repositoryRoot
  $databaseName = Read-Host 'Escriba el nombre exacto de la base de staging'
  $databaseHost = Read-Host 'Host MySQL de staging'
  $databasePort = Read-Host 'Puerto MySQL de staging'
  $databaseUser = Read-Host 'Usuario MySQL de staging'
  if ([string]::IsNullOrWhiteSpace($databaseUser)) {
    throw 'El usuario MySQL de staging es obligatorio.'
  }
  $certificateAuthority = Get-TemporaryCertificateAuthority
  $confirmation = Read-Host 'Escriba la confirmacion de base vacia indicada por el runbook'
  Assert-RemoteStagingInputs -DatabaseName $databaseName -DatabaseHost $databaseHost -DatabasePort $databasePort -CertificateAuthority $certificateAuthority -Confirmation $confirmation

  $securePassword = Read-Host 'Contrasena MySQL de staging' -AsSecureString
  $plainPassword = Convert-SecureStringToPlainText -SecureValue $securePassword
  if ([string]::IsNullOrWhiteSpace($plainPassword)) {
    throw 'La contrasena MySQL de staging es obligatoria.'
  }

  $env:APP_ENV = 'staging'
  $env:NODE_ENV = 'production'
  $env:DB_ENVIRONMENT = 'staging'
  $env:DB_HOST = $databaseHost.Trim()
  $env:DB_PORT = $databasePort.Trim()
  $env:DB_NAME = $ExpectedDatabase
  $env:DB_USER = $databaseUser.Trim()
  $env:DB_PASSWORD = $plainPassword
  $env:DB_SSL_ENABLED = 'true'
  $env:DB_SSL_CA = $certificateAuthority
  $env:STAGING_DB_MUTATION_CONFIRMATION = $RemoteStagingConfirmation

  Invoke-RemoteStagingCommand -NpmScript 'db:init'
  Invoke-RemoteStagingCommand -NpmScript 'db:migrate'
  Write-Output 'Inicializacion y migraciones de staging completadas.'
} catch {
  Write-Error 'La inicializacion remota no se completo. No se realizaron reintentos automaticos.'
  exit 1
} finally {
  Restore-EnvironmentState -Saved $savedEnvironment
  $plainPassword = $null
  $certificateAuthority = $null
  Set-Variable -Name securePassword -Value $null -ErrorAction SilentlyContinue
  Set-Location $originalLocation
}
