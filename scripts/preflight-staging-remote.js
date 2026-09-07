const mysql = require('mysql2/promise');
const { classifyRemoteFailure, sanitizeRemoteFailure } = require('../config/staging-remote-failure');
const { buildRemoteStagingDatabaseOptions } = require('../config/staging-remote-database-options');

const EXPECTED_DATABASE = 'tienda_abarrotes_staging';
const PREFLIGHT_ARGUMENT = '--remote-staging-preflight';
const PREFLIGHT_CONFIRMATION = 'PREFLIGHT_STAGING_TLS_AND_SCHEMA_ONLY';
const MYSQL_SESSION_TIME_ZONE = '-04:00';
const PREFLIGHT_CAUSES = Object.freeze({
  PREREQUISITE_LOCAL: 'PREREQUISITE_LOCAL',
  TLS_CA: 'TLS_CA',
  AUTHENTICATION: 'AUTHENTICATION',
  NETWORK_TIMEOUT_OR_ALLOWLIST: 'NETWORK_TIMEOUT_OR_ALLOWLIST',
  DATABASE_NOT_FOUND_OR_PERMISSION: 'DATABASE_NOT_FOUND_OR_PERMISSION',
  SESSION_TIME_ZONE_FAILED: 'SESSION_TIME_ZONE_FAILED',
  SCHEMA_CREATE_PRIVILEGE_MISSING: 'SCHEMA_CREATE_PRIVILEGE_MISSING',
  UNKNOWN_SAFE_FAILURE: 'UNKNOWN_SAFE_FAILURE'
});

function normalized(value) {
  return String(value || '').trim();
}

function isLocalHost(value) {
  return ['localhost', '127.0.0.1', '::1'].includes(normalized(value).toLowerCase());
}

function prerequisiteFailure() {
  const error = new Error('staging remote preflight prerequisite rejected');
  error.code = 'STAGING_REMOTE_PREFLIGHT_PREREQUISITE';
  return error;
}

function buildPreflightOptions(environment = process.env, args = process.argv.slice(2)) {
  if (args.length !== 1 || args[0] !== PREFLIGHT_ARGUMENT) throw prerequisiteFailure();
  const required = [
    'APP_ENV', 'NODE_ENV', 'DB_ENVIRONMENT', 'DB_HOST', 'DB_PORT', 'DB_NAME',
    'DB_USER', 'DB_PASSWORD', 'DB_SSL_ENABLED', 'DB_SSL_CA',
    'STAGING_REMOTE_PREFLIGHT_CONFIRMATION'
  ];
  if (required.some((name) => !normalized(environment[name]))) throw prerequisiteFailure();
  if (normalized(environment.APP_ENV).toLowerCase() !== 'staging'
    || normalized(environment.NODE_ENV).toLowerCase() !== 'production'
    || normalized(environment.DB_ENVIRONMENT).toLowerCase() !== 'staging'
    || normalized(environment.DB_NAME) !== EXPECTED_DATABASE
    || normalized(environment.DB_SSL_ENABLED).toLowerCase() !== 'true'
    || normalized(environment.STAGING_REMOTE_PREFLIGHT_CONFIRMATION) !== PREFLIGHT_CONFIRMATION
    || isLocalHost(environment.DB_HOST)) throw prerequisiteFailure();
  const port = Number(normalized(environment.DB_PORT));
  const ca = normalized(environment.DB_SSL_CA).replace(/\\n/g, '\n');
  if (!Number.isInteger(port) || port < 1 || port > 65535
    || !ca.includes('-----BEGIN CERTIFICATE-----') || !ca.includes('-----END CERTIFICATE-----')) {
    throw prerequisiteFailure();
  }
  return buildRemoteStagingDatabaseOptions(environment);
}

function classifyPreflightFailure(error, phase = 'connection') {
  const canonicalPhase = { prerequisite: 'AUTHORIZATION', 'session-time-zone': 'SESSION_TIME_ZONE' }[phase]
    || phase.toUpperCase();
  return classifyRemoteFailure(error, canonicalPhase).cause;
}

function grantAllowsCreate(value) {
  const grant = String(value || '').replace(/\s+/g, ' ').trim();
  const match = grant.match(/^GRANT\s+(.+?)\s+ON\s+(.+?)\s+TO\b/i);
  if (!match) return false;
  const scope = String(match[2]).replace(/`/g, '').toLowerCase();
  if (!['*.*', `${EXPECTED_DATABASE.toLowerCase()}.*`].includes(scope)) return false;
  const privileges = String(match[1]).trim().toUpperCase();
  return privileges === 'ALL' || privileges === 'ALL PRIVILEGES'
    || privileges.split(',').map((item) => item.trim()).includes('CREATE');
}

function grantsAllowCreate(rows) {
  return Array.isArray(rows) && rows.some((row) => Object.values(row).some(grantAllowsCreate));
}

async function runPreflight({
  environment = process.env,
  createConnection = mysql.createConnection,
  args = process.argv.slice(2)
} = {}) {
  let connection;
  let phase = 'AUTHORIZATION';
  try {
    const options = buildPreflightOptions(environment, args);
    phase = 'CONNECTION';
    connection = await createConnection(options);
    phase = 'SESSION_TIME_ZONE';
    await connection.query('SET time_zone = ?', [MYSQL_SESSION_TIME_ZONE]);
    phase = 'CREATE_PRIVILEGE';
    const [rows] = await connection.query('SHOW GRANTS');
    if (!grantsAllowCreate(rows)) return { passed: false, ...classifyRemoteFailure(null, phase) };
    phase = 'CLOSE';
    await connection.end();
    connection = null;
    return { passed: true };
  } catch (error) {
    return { passed: false, ...classifyRemoteFailure(error, phase) };
  } finally {
    if (connection) connection.destroy();
  }
}

async function main() {
  const result = await runPreflight();
  const safe = sanitizeRemoteFailure(result);
  console.log(result.passed
    ? 'STAGING_REMOTE_PREFLIGHT: PASS'
    : `STAGING_REMOTE_PREFLIGHT: FAIL ${safe.phase} ${safe.cause} ${safe.reason}`);
  if (!result.passed) process.exitCode = 1;
}

if (require.main === module) void main();

module.exports = {
  EXPECTED_DATABASE,
  PREFLIGHT_ARGUMENT,
  PREFLIGHT_CAUSES,
  PREFLIGHT_CONFIRMATION,
  MYSQL_SESSION_TIME_ZONE,
  buildPreflightOptions,
  classifyPreflightFailure,
  grantAllowsCreate,
  grantsAllowCreate,
  runPreflight
};
