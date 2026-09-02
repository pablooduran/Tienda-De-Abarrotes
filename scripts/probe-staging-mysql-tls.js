const fs = require('fs');
const mysql = require('mysql2/promise');

const EXPECTED_DATABASE = 'tienda_abarrotes_staging';
const PROBE_ARGUMENT = '--staging-tls-probe';
const PROBE_CONFIRMATION = 'PROBE_STAGING_TLS_ONLY';
const PROBE_CAUSES = Object.freeze({
  PREREQUISITE_LOCAL: 'PREREQUISITE_LOCAL',
  TLS_CA: 'TLS_CA',
  AUTHENTICATION: 'AUTHENTICATION',
  NETWORK_TIMEOUT_OR_ALLOWLIST: 'NETWORK_TIMEOUT_OR_ALLOWLIST',
  DATABASE_NOT_FOUND_OR_PERMISSION: 'DATABASE_NOT_FOUND_OR_PERMISSION',
  UNKNOWN_SAFE_FAILURE: 'UNKNOWN_SAFE_FAILURE'
});

const CAUSE_BY_ERROR_CODE = new Map([
  ['HANDSHAKE_SSL_ERROR', PROBE_CAUSES.TLS_CA],
  ['CERT_HAS_EXPIRED', PROBE_CAUSES.TLS_CA],
  ['UNABLE_TO_VERIFY_LEAF_SIGNATURE', PROBE_CAUSES.TLS_CA],
  ['DEPTH_ZERO_SELF_SIGNED_CERT', PROBE_CAUSES.TLS_CA],
  ['ERR_TLS_CERT_ALTNAME_INVALID', PROBE_CAUSES.TLS_CA],
  ['ER_SSL_CONNECTION_ERROR', PROBE_CAUSES.TLS_CA],
  ['ER_ACCESS_DENIED_ERROR', PROBE_CAUSES.AUTHENTICATION],
  ['ER_DBACCESS_DENIED_ERROR', PROBE_CAUSES.DATABASE_NOT_FOUND_OR_PERMISSION],
  ['ER_BAD_DB_ERROR', PROBE_CAUSES.DATABASE_NOT_FOUND_OR_PERMISSION],
  ['ER_HOST_NOT_PRIVILEGED', PROBE_CAUSES.DATABASE_NOT_FOUND_OR_PERMISSION],
  ['ER_SPECIFIC_ACCESS_DENIED_ERROR', PROBE_CAUSES.DATABASE_NOT_FOUND_OR_PERMISSION],
  ['ECONNREFUSED', PROBE_CAUSES.NETWORK_TIMEOUT_OR_ALLOWLIST],
  ['ECONNRESET', PROBE_CAUSES.NETWORK_TIMEOUT_OR_ALLOWLIST],
  ['ECONNABORTED', PROBE_CAUSES.NETWORK_TIMEOUT_OR_ALLOWLIST],
  ['EPIPE', PROBE_CAUSES.NETWORK_TIMEOUT_OR_ALLOWLIST],
  ['EHOSTUNREACH', PROBE_CAUSES.NETWORK_TIMEOUT_OR_ALLOWLIST],
  ['ENETUNREACH', PROBE_CAUSES.NETWORK_TIMEOUT_OR_ALLOWLIST],
  ['ENOTFOUND', PROBE_CAUSES.NETWORK_TIMEOUT_OR_ALLOWLIST],
  ['EAI_AGAIN', PROBE_CAUSES.NETWORK_TIMEOUT_OR_ALLOWLIST],
  ['ETIMEDOUT', PROBE_CAUSES.NETWORK_TIMEOUT_OR_ALLOWLIST],
  ['PROTOCOL_CONNECTION_LOST', PROBE_CAUSES.NETWORK_TIMEOUT_OR_ALLOWLIST]
]);

function prerequisiteFailure() {
  const error = new Error('staging tls probe prerequisite rejected');
  error.code = 'STAGING_TLS_PROBE_PREREQUISITE';
  return error;
}

function normalize(value) {
  return String(value || '').trim();
}

function isLocalHost(value) {
  return ['localhost', '127.0.0.1', '::1'].includes(normalize(value).toLowerCase());
}

function classifyProbeFailure(error) {
  let current = error;
  for (let depth = 0; depth < 3 && current; depth += 1) {
    const code = typeof current.code === 'string' ? current.code : '';
    if (code === 'STAGING_TLS_PROBE_PREREQUISITE') return PROBE_CAUSES.PREREQUISITE_LOCAL;
    const cause = CAUSE_BY_ERROR_CODE.get(code);
    if (cause) return cause;
    current = current.cause;
  }
  return PROBE_CAUSES.UNKNOWN_SAFE_FAILURE;
}

function buildProbeOptions(environment = process.env, readFile = fs.readFileSync, args = process.argv.slice(2)) {
  if (args.length !== 1 || args[0] !== PROBE_ARGUMENT) {
    throw prerequisiteFailure();
  }
  const required = ['APP_ENV', 'NODE_ENV', 'DB_ENVIRONMENT', 'DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD', 'STAGING_TLS_PROBE_CA_PATH', 'STAGING_TLS_PROBE_CONFIRMATION'];
  if (required.some((name) => !normalize(environment[name]))) throw prerequisiteFailure();
  if (normalize(environment.APP_ENV).toLowerCase() !== 'staging'
    || normalize(environment.NODE_ENV).toLowerCase() !== 'production'
    || normalize(environment.DB_ENVIRONMENT).toLowerCase() !== 'staging'
    || normalize(environment.DB_NAME) !== EXPECTED_DATABASE
    || normalize(environment.STAGING_TLS_PROBE_CONFIRMATION) !== PROBE_CONFIRMATION
    || isLocalHost(environment.DB_HOST)) throw prerequisiteFailure();
  const port = Number(normalize(environment.DB_PORT));
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw prerequisiteFailure();
  let ca;
  try {
    ca = String(readFile(normalize(environment.STAGING_TLS_PROBE_CA_PATH), 'utf8') || '').trim();
  } catch {
    throw prerequisiteFailure();
  }
  if (!ca.includes('-----BEGIN CERTIFICATE-----') || !ca.includes('-----END CERTIFICATE-----')) {
    throw prerequisiteFailure();
  }
  return Object.freeze({
    host: normalize(environment.DB_HOST), user: normalize(environment.DB_USER), password: String(environment.DB_PASSWORD),
    database: EXPECTED_DATABASE, port, ssl: { ca, rejectUnauthorized: true }
  });
}

async function runProbe({ environment = process.env, createConnection = mysql.createConnection, readFile = fs.readFileSync, args = process.argv.slice(2) } = {}) {
  let connection;
  try {
    const options = buildProbeOptions(environment, readFile, args);
    connection = await createConnection(options);
    await connection.query('SELECT 1');
    return { passed: true };
  } catch (error) {
    return { passed: false, cause: classifyProbeFailure(error) };
  } finally {
    if (connection) await connection.end().catch(() => {});
  }
}

async function main() {
  const result = await runProbe();
  if (result.passed) {
    console.log('STAGING_TLS_PROBE: PASS');
    return;
  }
  console.log(`STAGING_TLS_PROBE: FAIL ${result.cause}`);
  process.exitCode = 1;
}

if (require.main === module) void main();

module.exports = { EXPECTED_DATABASE, PROBE_ARGUMENT, PROBE_CAUSES, PROBE_CONFIRMATION, buildProbeOptions, classifyProbeFailure, runProbe };
