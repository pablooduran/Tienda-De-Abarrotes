const mysql = require('mysql2/promise');
const {
  REMOTE_STAGING_DIAGNOSTIC_ARGUMENT,
  STAGING_DATABASE_DIAGNOSTICS,
  diagnoseRemoteStagingDatabase,
  resolveRemoteStagingDiagnosticMode
} = require('../config/staging-database-mutation-guard');
const { buildRemoteStagingDatabaseOptions } = require('../config/staging-remote-database-options');

const DIAGNOSTIC_PHASES = Object.freeze({
  AUTHORIZATION: 'AUTHORIZATION',
  CONFIGURATION: 'CONFIGURATION',
  CONNECTION: 'CONNECTION',
  READ: 'READ'
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

function classifyDiagnosticFailure(error, phase = DIAGNOSTIC_PHASES.READ) {
  if ([DIAGNOSTIC_PHASES.AUTHORIZATION, DIAGNOSTIC_PHASES.CONFIGURATION].includes(phase)) {
    return DIAGNOSTIC_CAUSES.PREREQUISITE_LOCAL;
  }
  let current = error;
  for (let depth = 0; depth < 3 && current; depth += 1) {
    const code = typeof current.code === 'string' ? current.code : '';
    if (code === 'STAGING_PREREQUISITE') return DIAGNOSTIC_CAUSES.PREREQUISITE_LOCAL;
    const mapped = CAUSE_BY_ERROR_CODE.get(code);
    if (mapped) return mapped;
    current = current.cause;
  }
  return phase === DIAGNOSTIC_PHASES.READ
    ? DIAGNOSTIC_CAUSES.READ_FAILURE
    : DIAGNOSTIC_CAUSES.UNKNOWN_SAFE_FAILURE;
}

function writeDiagnostic(category, phase, cause = DIAGNOSTIC_CAUSES.UNKNOWN_SAFE_FAILURE) {
  const allowed = new Set(Object.values(STAGING_DATABASE_DIAGNOSTICS));
  const result = allowed.has(category)
    ? category
    : STAGING_DATABASE_DIAGNOSTICS.CONNECTION_OR_CONFIGURATION_FAILURE;
  if (result === STAGING_DATABASE_DIAGNOSTICS.CONNECTION_OR_CONFIGURATION_FAILURE) {
    const safePhase = Object.values(DIAGNOSTIC_PHASES).includes(phase)
      ? phase : DIAGNOSTIC_PHASES.CONNECTION;
    const safeCause = Object.values(DIAGNOSTIC_CAUSES).includes(cause)
      ? cause : DIAGNOSTIC_CAUSES.UNKNOWN_SAFE_FAILURE;
    console.log(`STAGING_REMOTE_DIAGNOSTIC: ${result} ${safePhase} ${safeCause}`);
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
    return { category, phase: null, cause: null };
  } catch (error) {
    return {
      category: STAGING_DATABASE_DIAGNOSTICS.CONNECTION_OR_CONFIGURATION_FAILURE,
      phase,
      cause: classifyDiagnosticFailure(error, phase)
    };
  } finally {
    if (connection) await connection.end().catch(() => {});
  }
}

async function main() {
  const result = await runDiagnostic();
  writeDiagnostic(result.category, result.phase, result.cause);
  if (result.category !== STAGING_DATABASE_DIAGNOSTICS.EMPTY) process.exitCode = 1;
}

if (require.main === module) void main();

module.exports = {
  DIAGNOSTIC_CAUSES,
  DIAGNOSTIC_PHASES,
  classifyDiagnosticFailure,
  runDiagnostic,
  writeDiagnostic
};
