const mysql = require('mysql2/promise');
const {
  REMOTE_STAGING_DIAGNOSTIC_ARGUMENT,
  STAGING_DATABASE_DIAGNOSTICS,
  diagnoseRemoteStagingDatabase,
  resolveRemoteStagingDiagnosticMode
} = require('../config/staging-database-mutation-guard');
const { buildRemoteStagingDatabaseOptions } = require('../config/staging-remote-database-options');
const { classifyRemoteFailure } = require('../config/staging-remote-failure');

const DIAGNOSTIC_PHASES = Object.freeze({
  AUTHORIZATION: 'AUTHORIZATION',
  CONFIGURATION: 'CONFIGURATION',
  CONNECTION: 'CONNECTION',
  READ: 'READ',
  CLOSE: 'CLOSE'
});

const DIAGNOSTIC_CAUSES = Object.freeze({
  PREREQUISITE_LOCAL: 'PREREQUISITE_LOCAL',
  TLS_CA: 'TLS_CA',
  AUTHENTICATION: 'AUTHENTICATION',
  NETWORK_TIMEOUT_OR_ALLOWLIST: 'NETWORK_TIMEOUT_OR_ALLOWLIST',
  DATABASE_NOT_FOUND_OR_PERMISSION: 'DATABASE_NOT_FOUND_OR_PERMISSION',
  READ_FAILURE: 'READ_FAILURE',
  UNKNOWN_SAFE_FAILURE: 'UNKNOWN_SAFE_FAILURE'
});

function classifyDiagnosticFailure(error, phase = DIAGNOSTIC_PHASES.READ) {
  return classifyRemoteFailure(error, phase).cause;
}

function normalizedDiagnosticCause(cause) {
  return Object.values(DIAGNOSTIC_CAUSES).includes(cause)
    ? cause
    : DIAGNOSTIC_CAUSES.UNKNOWN_SAFE_FAILURE;
}

function writeDiagnostic(category, cause) {
  const allowed = new Set(Object.values(STAGING_DATABASE_DIAGNOSTICS));
  const result = allowed.has(category)
    ? category
    : STAGING_DATABASE_DIAGNOSTICS.CONNECTION_OR_CONFIGURATION_FAILURE;
  if (result === STAGING_DATABASE_DIAGNOSTICS.CONNECTION_OR_CONFIGURATION_FAILURE) {
    console.log(`STAGING_REMOTE_DIAGNOSTIC: ${result} ${normalizedDiagnosticCause(cause)}`);
    return;
  }
  console.log(`STAGING_REMOTE_DIAGNOSTIC: ${result}`);
}

async function runDiagnostic({
  environment = process.env,
  args = process.argv.slice(2),
  buildConfig = buildRemoteStagingDatabaseOptions,
  createConnection = mysql.createConnection
} = {}) {
  let connection;
  let phase = DIAGNOSTIC_PHASES.AUTHORIZATION;
  try {
    resolveRemoteStagingDiagnosticMode({
      args, environment
    });
    phase = DIAGNOSTIC_PHASES.CONFIGURATION;
    const config = buildConfig(environment);
    phase = DIAGNOSTIC_PHASES.CONNECTION;
    connection = await createConnection(config);
    phase = DIAGNOSTIC_PHASES.READ;
    const category = await diagnoseRemoteStagingDatabase(connection, config.database);
    phase = DIAGNOSTIC_PHASES.CLOSE;
    await connection.end();
    connection = null;
    return { category, cause: null };
  } catch (error) {
    return {
      category: STAGING_DATABASE_DIAGNOSTICS.CONNECTION_OR_CONFIGURATION_FAILURE,
      cause: classifyDiagnosticFailure(error, phase)
    };
  } finally {
    if (connection) connection.destroy();
  }
}

async function main() {
  const result = await runDiagnostic();
  writeDiagnostic(result.category, result.cause);
  if (result.category !== STAGING_DATABASE_DIAGNOSTICS.EMPTY) process.exitCode = 1;
}

if (require.main === module) void main();

module.exports = {
  DIAGNOSTIC_CAUSES,
  DIAGNOSTIC_PHASES,
  classifyDiagnosticFailure,
  normalizedDiagnosticCause,
  runDiagnostic,
  writeDiagnostic
};
