[CmdletBinding()]
param([switch]$ValidateOnly)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ExpectedDatabase = 'tienda_abarrotes_staging'
$InspectionArgument = '--staging-schema-inspection'
$InspectionConfirmation = 'INSPECT_STAGING_SCHEMA_ONLY'
$EnvironmentNames = @('APP_ENV', 'NODE_ENV', 'DB_ENVIRONMENT', 'DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD', 'STAGING_SCHEMA_INSPECTION_CA_PATH', 'STAGING_SCHEMA_INSPECTION_CONFIRMATION')

function Assert-InspectionInputs {
  param([string]$DatabaseName, [string]$DatabaseHost, [string]$DatabasePort, [string]$DatabaseUser, [string]$CertificatePath)
  if ($DatabaseName -cne $ExpectedDatabase -or [string]::IsNullOrWhiteSpace($DatabaseHost) -or @('localhost', '127.0.0.1', '::1') -contains $DatabaseHost.Trim().ToLowerInvariant()) { throw 'Inspection rejected.' }
  $port = 0
  if (-not [int]::TryParse($DatabasePort, [ref]$port) -or $port -lt 1 -or $port -gt 65535 -or [string]::IsNullOrWhiteSpace($DatabaseUser) -or -not [System.IO.File]::Exists($CertificatePath)) { throw 'Inspection rejected.' }
}

function Convert-SecureStringToPlainText {
  param([System.Security.SecureString]$SecureValue)
  $pointer = [IntPtr]::Zero
  try { $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureValue); return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
  finally { if ($pointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) } }
}

function Save-EnvironmentState {
  $saved = @{}
  foreach ($name in $EnvironmentNames) { $item = Get-Item -Path "Env:$name" -ErrorAction SilentlyContinue; $saved[$name] = if ($null -eq $item) { $null } else { [string]$item.Value } }
  return $saved
}

function Restore-EnvironmentState {
  param([hashtable]$Saved)
  foreach ($name in $EnvironmentNames) { if ($null -eq $Saved[$name]) { Remove-Item -Path "Env:$name" -ErrorAction SilentlyContinue } else { Set-Item -Path "Env:$name" -Value $Saved[$name] } }
}

if ($ValidateOnly) {
  try { Assert-InspectionInputs -DatabaseName $ExpectedDatabase -DatabaseHost 'mysql.staging.invalid' -DatabasePort '3306' -DatabaseUser 'synthetic' -CertificatePath $PSCommandPath; Write-Output 'STAGING_SCHEMA_INSPECTION_VALIDATION_OK'; exit 0 }
  catch { Write-Output 'STAGING_SCHEMA_INSPECTION: FAIL PREREQUISITE_LOCAL'; exit 1 }
}

$savedEnvironment = Save-EnvironmentState
$plainPassword = $null
$originalLocation = Get-Location
try {
  $repositoryRoot = Split-Path -Parent $PSScriptRoot
  if (-not [System.IO.File]::Exists((Join-Path $repositoryRoot 'package.json')) -or $null -eq (Get-Command npm.cmd -ErrorAction SilentlyContinue)) { throw 'Inspection rejected.' }
  Push-Location $repositoryRoot
  $databaseName = Read-Host 'Escriba el nombre exacto de la base de staging'
  $databaseHost = Read-Host 'Host MySQL de staging'
  $databasePort = Read-Host 'Puerto MySQL de staging'
  $databaseUser = Read-Host 'Usuario MySQL de staging'
  $certificatePath = Read-Host 'Ruta local temporal del certificado CA de Aiven'
  Assert-InspectionInputs -DatabaseName $databaseName -DatabaseHost $databaseHost -DatabasePort $databasePort -DatabaseUser $databaseUser -CertificatePath $certificatePath
  $securePassword = Read-Host 'Contrasena MySQL de staging' -AsSecureString
  $plainPassword = Convert-SecureStringToPlainText -SecureValue $securePassword
  if ([string]::IsNullOrWhiteSpace($plainPassword)) { throw 'Inspection rejected.' }
  $env:APP_ENV = 'staging'; $env:NODE_ENV = 'production'; $env:DB_ENVIRONMENT = 'staging'
  $env:DB_HOST = $databaseHost.Trim(); $env:DB_PORT = $databasePort.Trim(); $env:DB_NAME = $ExpectedDatabase; $env:DB_USER = $databaseUser.Trim(); $env:DB_PASSWORD = $plainPassword
  $env:STAGING_SCHEMA_INSPECTION_CA_PATH = $certificatePath.Trim(); $env:STAGING_SCHEMA_INSPECTION_CONFIRMATION = $InspectionConfirmation
  $output = @(& npm.cmd run db:inspect-staging-schema -- $InspectionArgument 2>$null)
  $result = $output | Where-Object { $_ -match '^STAGING_SCHEMA_INSPECTION: (EMPTY|BASELINE_INITIAL|PARTIAL_OR_UNEXPECTED|FAIL (?:PREREQUISITE_LOCAL|TLS_CA|AUTHENTICATION|NETWORK_TIMEOUT_OR_ALLOWLIST|DATABASE_NOT_FOUND_OR_PERMISSION|UNKNOWN_SAFE_FAILURE))$' } | Select-Object -Last 1
  if ($null -eq $result) { Write-Output 'STAGING_SCHEMA_INSPECTION: FAIL UNKNOWN_SAFE_FAILURE'; exit 1 }
  Write-Output $result
  if ($result -eq 'STAGING_SCHEMA_INSPECTION: EMPTY') { exit 0 }
  exit 1
} catch {
  Write-Output 'STAGING_SCHEMA_INSPECTION: FAIL PREREQUISITE_LOCAL'
  exit 1
} finally {
  Restore-EnvironmentState -Saved $savedEnvironment
  $plainPassword = $null
  Set-Variable -Name securePassword -Value $null -ErrorAction SilentlyContinue
  Set-Location $originalLocation
}
