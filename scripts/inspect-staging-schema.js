const fs = require('fs');
const mysql = require('mysql2/promise');

const EXPECTED_DATABASE = 'tienda_abarrotes_staging';
const INSPECTION_ARGUMENT = '--staging-schema-inspection';
const INSPECTION_CONFIRMATION = 'INSPECT_STAGING_SCHEMA_ONLY';
const INITIAL_TABLES = Object.freeze([
  'administrador', 'cliente', 'proveedor', 'producto', 'venta', 'detalleVenta',
  'compra', 'detalleCompra', 'fiado', 'detalleFiado', 'pagoFiado'
]);
const INSPECTION_CAUSES = Object.freeze({
  PREREQUISITE_LOCAL: 'PREREQUISITE_LOCAL',
  TLS_CA: 'TLS_CA',
  AUTHENTICATION: 'AUTHENTICATION',
  NETWORK_TIMEOUT_OR_ALLOWLIST: 'NETWORK_TIMEOUT_OR_ALLOWLIST',
  DATABASE_NOT_FOUND_OR_PERMISSION: 'DATABASE_NOT_FOUND_OR_PERMISSION',
  UNKNOWN_SAFE_FAILURE: 'UNKNOWN_SAFE_FAILURE'
});

const CAUSE_BY_ERROR_CODE = new Map([
  ['HANDSHAKE_SSL_ERROR', INSPECTION_CAUSES.TLS_CA],
  ['CERT_HAS_EXPIRED', INSPECTION_CAUSES.TLS_CA],
  ['UNABLE_TO_VERIFY_LEAF_SIGNATURE', INSPECTION_CAUSES.TLS_CA],
  ['DEPTH_ZERO_SELF_SIGNED_CERT', INSPECTION_CAUSES.TLS_CA],
  ['ERR_TLS_CERT_ALTNAME_INVALID', INSPECTION_CAUSES.TLS_CA],
  ['ER_SSL_CONNECTION_ERROR', INSPECTION_CAUSES.TLS_CA],
  ['ER_ACCESS_DENIED_ERROR', INSPECTION_CAUSES.AUTHENTICATION],
  ['ER_DBACCESS_DENIED_ERROR', INSPECTION_CAUSES.DATABASE_NOT_FOUND_OR_PERMISSION],
  ['ER_BAD_DB_ERROR', INSPECTION_CAUSES.DATABASE_NOT_FOUND_OR_PERMISSION],
  ['ER_HOST_NOT_PRIVILEGED', INSPECTION_CAUSES.DATABASE_NOT_FOUND_OR_PERMISSION],
  ['ER_SPECIFIC_ACCESS_DENIED_ERROR', INSPECTION_CAUSES.DATABASE_NOT_FOUND_OR_PERMISSION],
  ['ECONNREFUSED', INSPECTION_CAUSES.NETWORK_TIMEOUT_OR_ALLOWLIST],
  ['ECONNRESET', INSPECTION_CAUSES.NETWORK_TIMEOUT_OR_ALLOWLIST],
  ['ECONNABORTED', INSPECTION_CAUSES.NETWORK_TIMEOUT_OR_ALLOWLIST],
  ['EPIPE', INSPECTION_CAUSES.NETWORK_TIMEOUT_OR_ALLOWLIST],
  ['EHOSTUNREACH', INSPECTION_CAUSES.NETWORK_TIMEOUT_OR_ALLOWLIST],
  ['ENETUNREACH', INSPECTION_CAUSES.NETWORK_TIMEOUT_OR_ALLOWLIST],
  ['ENOTFOUND', INSPECTION_CAUSES.NETWORK_TIMEOUT_OR_ALLOWLIST],
  ['EAI_AGAIN', INSPECTION_CAUSES.NETWORK_TIMEOUT_OR_ALLOWLIST],
  ['ETIMEDOUT', INSPECTION_CAUSES.NETWORK_TIMEOUT_OR_ALLOWLIST],
  ['PROTOCOL_CONNECTION_LOST', INSPECTION_CAUSES.NETWORK_TIMEOUT_OR_ALLOWLIST]
]);

function prerequisiteFailure() {
  const error = new Error('staging schema inspection prerequisite rejected');
  error.code = 'STAGING_SCHEMA_INSPECTION_PREREQUISITE';
  return error;
}

function normalized(value) {
  return String(value || '').trim();
}

function isLocalHost(value) {
  return ['localhost', '127.0.0.1', '::1'].includes(normalized(value).toLowerCase());
}

function classifyInspectionFailure(error) {
  let current = error;
  for (let depth = 0; depth < 3 && current; depth += 1) {
    const code = typeof current.code === 'string' ? current.code : '';
    if (code === 'STAGING_SCHEMA_INSPECTION_PREREQUISITE') return INSPECTION_CAUSES.PREREQUISITE_LOCAL;
    const cause = CAUSE_BY_ERROR_CODE.get(code);
    if (cause) return cause;
    current = current.cause;
  }
  return INSPECTION_CAUSES.UNKNOWN_SAFE_FAILURE;
}

function buildInspectionOptions(environment = process.env, readFile = fs.readFileSync, args = process.argv.slice(2)) {
  if (args.length !== 1 || args[0] !== INSPECTION_ARGUMENT) throw prerequisiteFailure();
  const required = ['APP_ENV', 'NODE_ENV', 'DB_ENVIRONMENT', 'DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD', 'STAGING_SCHEMA_INSPECTION_CA_PATH', 'STAGING_SCHEMA_INSPECTION_CONFIRMATION'];
  if (required.some((name) => !normalized(environment[name]))) throw prerequisiteFailure();
  if (normalized(environment.APP_ENV).toLowerCase() !== 'staging'
    || normalized(environment.NODE_ENV).toLowerCase() !== 'production'
    || normalized(environment.DB_ENVIRONMENT).toLowerCase() !== 'staging'
    || normalized(environment.DB_NAME) !== EXPECTED_DATABASE
    || normalized(environment.STAGING_SCHEMA_INSPECTION_CONFIRMATION) !== INSPECTION_CONFIRMATION
    || isLocalHost(environment.DB_HOST)) throw prerequisiteFailure();
  const port = Number(normalized(environment.DB_PORT));
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw prerequisiteFailure();
  let ca;
  try {
    ca = String(readFile(normalized(environment.STAGING_SCHEMA_INSPECTION_CA_PATH), 'utf8') || '').trim();
  } catch {
    throw prerequisiteFailure();
  }
  if (!ca.includes('-----BEGIN CERTIFICATE-----') || !ca.includes('-----END CERTIFICATE-----')) throw prerequisiteFailure();
  return Object.freeze({
    host: normalized(environment.DB_HOST), user: normalized(environment.DB_USER), password: String(environment.DB_PASSWORD),
    database: EXPECTED_DATABASE, port, ssl: { ca, rejectUnauthorized: true }
  });
}

function classifySchemaTables(rows) {
  const tables = new Set(rows.map((row) => String(row.TABLE_NAME)));
  if (!tables.size) return 'EMPTY';
  if (tables.size !== INITIAL_TABLES.length || INITIAL_TABLES.some((table) => !tables.has(table))) {
    return 'PARTIAL_OR_UNEXPECTED';
  }
  return 'BASELINE_INITIAL';
}

async function inspectSchema(connection, database) {
  const [rows] = await connection.query(
    'SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=? ORDER BY TABLE_NAME',
    [database]
  );
  return classifySchemaTables(rows);
}

async function runInspection({ environment = process.env, createConnection = mysql.createConnection, readFile = fs.readFileSync, args = process.argv.slice(2) } = {}) {
  let connection;
  try {
    const options = buildInspectionOptions(environment, readFile, args);
    connection = await createConnection(options);
    return { state: await inspectSchema(connection, EXPECTED_DATABASE) };
  } catch (error) {
    return { failed: true, cause: classifyInspectionFailure(error) };
  } finally {
    if (connection) await connection.end().catch(() => {});
  }
}

async function main() {
  const result = await runInspection();
  if (result.failed) {
    console.log(`STAGING_SCHEMA_INSPECTION: FAIL ${result.cause}`);
    process.exitCode = 1;
    return;
  }
  console.log(`STAGING_SCHEMA_INSPECTION: ${result.state}`);
  if (result.state !== 'EMPTY') process.exitCode = 1;
}

if (require.main === module) void main();

module.exports = { EXPECTED_DATABASE, INITIAL_TABLES, INSPECTION_ARGUMENT, INSPECTION_CAUSES, INSPECTION_CONFIRMATION, buildInspectionOptions, classifyInspectionFailure, classifySchemaTables, inspectSchema, runInspection };
