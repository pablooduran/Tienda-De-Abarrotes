const mysql = require('mysql2/promise');
const {
  REMOTE_STAGING_DIAGNOSTIC_ARGUMENT,
  STAGING_DATABASE_DIAGNOSTICS,
  diagnoseRemoteStagingDatabase,
  resolveRemoteStagingDiagnosticMode
} = require('../config/staging-database-mutation-guard');

const DIAGNOSTIC_CAUSES = Object.freeze({
  PREREQUISITE_LOCAL: 'PREREQUISITE_LOCAL',
  TLS_CA: 'TLS_CA',
  AUTHENTICATION: 'AUTHENTICATION',
  NETWORK_TIMEOUT_OR_ALLOWLIST: 'NETWORK_TIMEOUT_OR_ALLOWLIST',
  DATABASE_NOT_FOUND_OR_PERMISSION: 'DATABASE_NOT_FOUND_OR_PERMISSION',
  READ_FAILURE: 'READ_FAILURE',
  UNKNOWN_SAFE_FAILURE: 'UNKNOWN_SAFE_FAILURE'
});

const CAUSE_BY_ERROR_CODE = new Map([
  ['HANDSHAKE_SSL_ERROR', DIAGNOSTIC_CAUSES.TLS_CA],
  ['CERT_HAS_EXPIRED', DIAGNOSTIC_CAUSES.TLS_CA],
  ['UNABLE_TO_VERIFY_LEAF_SIGNATURE', DIAGNOSTIC_CAUSES.TLS_CA],
  ['DEPTH_ZERO_SELF_SIGNED_CERT', DIAGNOSTIC_CAUSES.TLS_CA],
  ['ERR_TLS_CERT_ALTNAME_INVALID', DIAGNOSTIC_CAUSES.TLS_CA],
  ['ER_SSL_CONNECTION_ERROR', DIAGNOSTIC_CAUSES.TLS_CA],
  ['ER_ACCESS_DENIED_ERROR', DIAGNOSTIC_CAUSES.AUTHENTICATION],
  ['ER_DBACCESS_DENIED_ERROR', DIAGNOSTIC_CAUSES.DATABASE_NOT_FOUND_OR_PERMISSION],
  ['ER_BAD_DB_ERROR', DIAGNOSTIC_CAUSES.DATABASE_NOT_FOUND_OR_PERMISSION],
  ['ECONNREFUSED', DIAGNOSTIC_CAUSES.NETWORK_TIMEOUT_OR_ALLOWLIST],
  ['ECONNRESET', DIAGNOSTIC_CAUSES.NETWORK_TIMEOUT_OR_ALLOWLIST],
  ['EHOSTUNREACH', DIAGNOSTIC_CAUSES.NETWORK_TIMEOUT_OR_ALLOWLIST],
  ['ENETUNREACH', DIAGNOSTIC_CAUSES.NETWORK_TIMEOUT_OR_ALLOWLIST],
  ['ENOTFOUND', DIAGNOSTIC_CAUSES.NETWORK_TIMEOUT_OR_ALLOWLIST],
  ['EAI_AGAIN', DIAGNOSTIC_CAUSES.NETWORK_TIMEOUT_OR_ALLOWLIST],
  ['ECONNABORTED', DIAGNOSTIC_CAUSES.NETWORK_TIMEOUT_OR_ALLOWLIST],
  ['EPIPE', DIAGNOSTIC_CAUSES.NETWORK_TIMEOUT_OR_ALLOWLIST],
  ['ETIMEDOUT', DIAGNOSTIC_CAUSES.NETWORK_TIMEOUT_OR_ALLOWLIST],
  ['PROTOCOL_CONNECTION_LOST', DIAGNOSTIC_CAUSES.NETWORK_TIMEOUT_OR_ALLOWLIST],
  ['ER_HOST_NOT_PRIVILEGED', DIAGNOSTIC_CAUSES.DATABASE_NOT_FOUND_OR_PERMISSION],
  ['ER_SPECIFIC_ACCESS_DENIED_ERROR', DIAGNOSTIC_CAUSES.DATABASE_NOT_FOUND_OR_PERMISSION]
]);

function classifyDiagnosticFailure(error, phase = 'read') {
  if (phase === 'prerequisite' || phase === 'configuration') return DIAGNOSTIC_CAUSES.PREREQUISITE_LOCAL;
  let current = error;
  for (let depth = 0; depth < 3 && current; depth += 1) {
    const code = typeof current.code === 'string' ? current.code : '';
    if (code === 'STAGING_PREREQUISITE') return DIAGNOSTIC_CAUSES.PREREQUISITE_LOCAL;
    const mapped = CAUSE_BY_ERROR_CODE.get(code);
    if (mapped) return mapped;
    current = current.cause;
  }
  return phase === 'read' ? DIAGNOSTIC_CAUSES.READ_FAILURE : DIAGNOSTIC_CAUSES.UNKNOWN_SAFE_FAILURE;
}

function writeDiagnostic(category, cause = DIAGNOSTIC_CAUSES.UNKNOWN_SAFE_FAILURE) {
  const allowed = new Set(Object.values(STAGING_DATABASE_DIAGNOSTICS));
  const result = allowed.has(category)
    ? category
    : STAGING_DATABASE_DIAGNOSTICS.CONNECTION_OR_CONFIGURATION_FAILURE;
  if (result === STAGING_DATABASE_DIAGNOSTICS.CONNECTION_OR_CONFIGURATION_FAILURE) {
    const safeCause = Object.values(DIAGNOSTIC_CAUSES).includes(cause)
      ? cause : DIAGNOSTIC_CAUSES.UNKNOWN_SAFE_FAILURE;
    console.log(`STAGING_REMOTE_DIAGNOSTIC: ${result} ${safeCause}`);
    return;
  }
  console.log(`STAGING_REMOTE_DIAGNOSTIC: ${result}`);
}

async function main() {
  let connection;
  let phase = 'prerequisite';
  try {
    resolveRemoteStagingDiagnosticMode({
      args: process.argv.slice(2), environment: process.env
    });
    phase = 'configuration';
    const { databaseConfig } = require('../config/env');
    const config = databaseConfig();
    phase = 'connect';
    connection = await mysql.createConnection(config);
    phase = 'read';
    const category = await diagnoseRemoteStagingDatabase(connection, config.database);
    writeDiagnostic(category);
    if (category !== STAGING_DATABASE_DIAGNOSTICS.EMPTY) process.exitCode = 1;
  } catch (error) {
    writeDiagnostic(
      STAGING_DATABASE_DIAGNOSTICS.CONNECTION_OR_CONFIGURATION_FAILURE,
      classifyDiagnosticFailure(error, phase)
    );
    process.exitCode = 1;
  } finally {
    if (connection) await connection.end().catch(() => {});
  }
}

if (require.main === module) void main();

module.exports = { DIAGNOSTIC_CAUSES, classifyDiagnosticFailure, writeDiagnostic };
