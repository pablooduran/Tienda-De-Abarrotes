[CmdletBinding()]
param(
  [switch]$ValidateOnly,
  [switch]$SimulateInvalidDatabase
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ExpectedDatabase = 'tienda_abarrotes_staging'
$RemoteArgument = '--remote-staging-superadmin'
$Confirmation = 'CREATE_FIRST_STAGING_SUPERADMIN'
$EnvironmentNames = @(
  'APP_ENV', 'NODE_ENV', 'DB_ENVIRONMENT', 'DB_HOST', 'DB_PORT', 'DB_NAME',
  'DB_USER', 'DB_PASSWORD', 'DB_SSL_ENABLED', 'DB_SSL_CA', 'DB_SSL_CA_PATH',
  'SUPERADMIN_USER', 'SUPERADMIN_PASSWORD', 'STAGING_SUPERADMIN_CONFIRMATION'
)

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

function Assert-Inputs {
  param(
    [Parameter(Mandatory)] [string]$DatabaseName,
    [Parameter(Mandatory)] [string]$DatabaseHost,
    [Parameter(Mandatory)] [string]$DatabasePort,
    [Parameter(Mandatory)] [string]$CertificateAuthority,
    [Parameter(Mandatory)] [string]$ConfirmationValue
  )
  if ($DatabaseName -cne $ExpectedDatabase) { throw 'La base no coincide con staging.' }
  if ([string]::IsNullOrWhiteSpace($DatabaseHost) -or @('localhost', '127.0.0.1', '::1') -contains $DatabaseHost.Trim().ToLowerInvariant()) {
    throw 'El host debe ser el MySQL remoto de staging.'
  }
  $port = 0
  if (-not [int]::TryParse($DatabasePort, [ref]$port) -or $port -lt 1 -or $port -gt 65535) { throw 'Puerto invalido.' }
  if ($CertificateAuthority -notmatch '-----BEGIN CERTIFICATE-----' -or $CertificateAuthority -notmatch '-----END CERTIFICATE-----') {
    throw 'El certificado CA no tiene formato PEM.'
  }
  if ($ConfirmationValue -cne $Confirmation) { throw 'La confirmacion no coincide.' }
}

function Resolve-SafeFailureReason {
  param([Parameter(Mandatory)] [object[]]$CommandOutput)
  $text = (@($CommandOutput | ForEach-Object { [string]$_ }) -join "`n")
  if ($text -match 'Access denied') { return 'Aiven rechazo el usuario o la contrasena MySQL.' }
  if ($text -match 'ENOTFOUND|getaddrinfo') { return 'No se encontro el host MySQL indicado.' }
  if ($text -match 'ECONNREFUSED|ETIMEDOUT|connect timeout') { return 'No se pudo conectar al servicio MySQL de Aiven.' }
  if ($text -match 'certificate|SSL|TLS|self.signed') { return 'El certificado CA o la conexion TLS no fueron aceptados.' }
  if ($text -match 'migraciones 001-025') { return 'La base no contiene exactamente las migraciones 001-025 esperadas.' }
  if ($text -match 'ya tiene un superadmin') { return 'Staging ya tiene una cuenta superadministradora.' }
  if ($text -match 'usuario indicado ya existe') { return 'El nombre de usuario elegido ya existe.' }
  if ($text -match 'Otra creacion de superadmin esta en curso') { return 'Hay otra creacion de superadministrador en curso.' }
  if ($text -match 'estructura multi-tienda no esta completa') { return 'La estructura multi-tienda de staging no esta completa.' }
  return 'No se pudo confirmar la creacion. Revisa los datos de conexion de Aiven.'
}

if ($ValidateOnly) {
  try {
    $database = if ($SimulateInvalidDatabase) { 'base_no_autorizada' } else { $ExpectedDatabase }
    Assert-Inputs -DatabaseName $database -DatabaseHost 'mysql.staging.invalid' -DatabasePort '3306' -CertificateAuthority "-----BEGIN CERTIFICATE-----`nsynthetic`n-----END CERTIFICATE-----" -ConfirmationValue $Confirmation
    Write-Output 'STAGING_SUPERADMIN_LAUNCHER_VALIDATION_OK'
    exit 0
  } catch {
    Write-Output 'STAGING_SUPERADMIN_LAUNCHER_VALIDATION_REJECTED'
    exit 1
  }
}

$savedEnvironment = Save-EnvironmentState
$databasePassword = $null
$superadminPassword = $null
$superadminConfirmation = $null
$safeFailureReason = $null
$originalLocation = Get-Location

try {
  $repositoryRoot = Split-Path -Parent $PSScriptRoot
  Push-Location $repositoryRoot
  if ($null -eq (Get-Command npm.cmd -ErrorAction SilentlyContinue)) { throw 'No se encontro npm.cmd.' }

  $databaseName = Read-Host 'Nombre exacto de la base de staging'
  $databaseHost = Read-Host 'Host MySQL de Aiven'
  $databasePort = Read-Host 'Puerto MySQL de Aiven'
  $databaseUser = Read-Host 'Usuario MySQL de Aiven'
  $certificatePath = Read-Host 'Ruta local del certificado CA de Aiven'
  if (-not [System.IO.File]::Exists($certificatePath)) { throw 'No se encontro el certificado CA.' }
  $certificateAuthority = [System.IO.File]::ReadAllText($certificatePath)
  $confirmationValue = Read-Host "Escribe $Confirmation"
  Assert-Inputs -DatabaseName $databaseName -DatabaseHost $databaseHost -DatabasePort $databasePort -CertificateAuthority $certificateAuthority -ConfirmationValue $confirmationValue

  $databasePassword = Convert-SecureStringToPlainText (Read-Host 'Contrasena MySQL de Aiven' -AsSecureString)
  $superadminUser = Read-Host 'Nuevo usuario superadmin'
  $superadminPassword = Convert-SecureStringToPlainText (Read-Host 'Nueva contrasena superadmin (12 o mas caracteres)' -AsSecureString)
  $superadminConfirmation = Convert-SecureStringToPlainText (Read-Host 'Repite la contrasena superadmin' -AsSecureString)
  if ($superadminPassword -cne $superadminConfirmation) { throw 'Las contrasenas del superadmin no coinciden.' }

  $env:APP_ENV = 'staging'
  $env:NODE_ENV = 'production'
  $env:DB_ENVIRONMENT = 'staging'
  $env:DB_HOST = $databaseHost.Trim()
  $env:DB_PORT = $databasePort.Trim()
  $env:DB_NAME = $ExpectedDatabase
  $env:DB_USER = $databaseUser.Trim()
  $env:DB_PASSWORD = $databasePassword
  $env:DB_SSL_ENABLED = 'true'
  $env:DB_SSL_CA = $certificateAuthority
  Remove-Item -Path Env:DB_SSL_CA_PATH -ErrorAction SilentlyContinue
  $env:SUPERADMIN_USER = $superadminUser.Trim()
  $env:SUPERADMIN_PASSWORD = $superadminPassword
  $env:STAGING_SUPERADMIN_CONFIRMATION = $Confirmation

  $output = @(& npm.cmd run db:create-superadmin -- $RemoteArgument 2>&1)
  if ($LASTEXITCODE -ne 0 -or @($output | Where-Object { $_ -ceq 'STAGING_SUPERADMIN_CREATE: CREATED' }).Count -ne 1) {
    $safeFailureReason = Resolve-SafeFailureReason -CommandOutput $output
    throw 'La creacion fue rechazada o no pudo completarse.'
  }
  Write-Output 'STAGING_SUPERADMIN_CREATE: CREATED'
} catch {
  Write-Output 'STAGING_SUPERADMIN_CREATE: REJECTED'
  if (-not [string]::IsNullOrWhiteSpace($safeFailureReason)) {
    Write-Output "Motivo: $safeFailureReason"
  }
  exit 1
} finally {
  Restore-EnvironmentState -Saved $savedEnvironment
  $databasePassword = $null
  $superadminPassword = $null
  $superadminConfirmation = $null
  Set-Location $originalLocation
}
