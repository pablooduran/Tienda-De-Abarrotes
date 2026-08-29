const INITIAL_STAGING_DATABASE = 'tienda_abarrotes_staging';
const REMOTE_STAGING_ARGUMENT = '--remote-staging';
const REMOTE_STAGING_DIAGNOSTIC_ARGUMENT = '--remote-staging-diagnose';
const REMOTE_STAGING_CONFIRMATION = 'CONFIRM_EMPTY_STAGING_001_024';
const STAGING_DATABASE_DIAGNOSTICS = Object.freeze({
  EMPTY: 'EMPTY',
  BASELINE_INITIAL: 'BASELINE_INITIAL',
  PARTIAL_OR_UNEXPECTED: 'PARTIAL_OR_UNEXPECTED',
  CONNECTION_OR_CONFIGURATION_FAILURE: 'CONNECTION_OR_CONFIGURATION_FAILURE'
});
const INITIAL_TABLES = Object.freeze([
  'administrador', 'cliente', 'proveedor', 'producto', 'venta', 'detalleVenta',
  'compra', 'detalleCompra', 'fiado', 'detalleFiado', 'pagoFiado'
]);

function normalized(value) {
  return String(value || '').trim().toLowerCase();
}

function isLocalHost(value) {
  return ['localhost', '127.0.0.1', '::1'].includes(normalized(value));
}

function assertRemoteStagingArguments(args = []) {
  if (args.length !== 1 || args[0] !== REMOTE_STAGING_ARGUMENT) {
    throw new Error(`El destino remoto exige el argumento explicito ${REMOTE_STAGING_ARGUMENT}.`);
  }
}

function assertRemoteStagingConnectionAuthorization(environment = process.env) {
  if (normalized(environment.APP_ENV) !== 'staging') {
    throw new Error('La mutacion remota solo se permite con APP_ENV=staging.');
  }
  if (normalized(environment.NODE_ENV) !== 'production') {
    throw new Error('La mutacion remota de staging exige NODE_ENV=production.');
  }
  if (normalized(environment.DB_ENVIRONMENT) !== 'staging') {
    throw new Error('La mutacion remota de staging exige DB_ENVIRONMENT=staging.');
  }
  if (normalized(environment.DB_NAME) !== INITIAL_STAGING_DATABASE) {
    throw new Error(`La mutacion remota solo autoriza DB_NAME=${INITIAL_STAGING_DATABASE}.`);
  }
  if (isLocalHost(environment.DB_HOST)) {
    throw new Error('La mutacion remota de staging exige una base no local.');
  }
  if (normalized(environment.DB_SSL_ENABLED) !== 'true' || !String(environment.DB_SSL_CA || '').trim()) {
    throw new Error('La mutacion remota de staging exige DB_SSL_ENABLED=true y DB_SSL_CA.');
  }
}

function assertRemoteStagingAuthorization(environment = process.env) {
  assertRemoteStagingConnectionAuthorization(environment);
  if (String(environment.STAGING_DB_MUTATION_CONFIRMATION || '').trim() !== REMOTE_STAGING_CONFIRMATION) {
    throw new Error('Falta la confirmacion explicita STAGING_DB_MUTATION_CONFIRMATION para staging vacio.');
  }
}

function assertRemoteStagingDiagnosticArguments(args = []) {
  if (args.length !== 1 || args[0] !== REMOTE_STAGING_DIAGNOSTIC_ARGUMENT) {
    throw new Error(`El diagnostico remoto exige el argumento explicito ${REMOTE_STAGING_DIAGNOSTIC_ARGUMENT}.`);
  }
}

function resolveRemoteStagingDiagnosticMode({ args = [], environment = process.env } = {}) {
  assertRemoteStagingDiagnosticArguments(args);
  assertRemoteStagingConnectionAuthorization(environment);
  return Object.freeze({ type: 'remote-staging-diagnostic' });
}

function resolveDatabaseMutationMode({ args = [], environment = process.env } = {}) {
  const remoteRequested = args.includes(REMOTE_STAGING_ARGUMENT);
  const appEnvironment = normalized(environment.APP_ENV);
  if (remoteRequested) {
    assertRemoteStagingArguments(args);
    assertRemoteStagingAuthorization(environment);
    return Object.freeze({ type: 'remote-staging' });
  }
  if (!isLocalHost(environment.DB_HOST)) {
    throw new Error(`Un destino remoto exige ${REMOTE_STAGING_ARGUMENT} y la autorizacion explicita de staging.`);
  }
  if (!['local', 'test'].includes(appEnvironment)) {
    throw new Error('Las mutaciones locales solo se permiten con APP_ENV=local o test y DB_HOST=localhost.');
  }
  return Object.freeze({ type: 'local' });
}

async function tableNames(connection, database) {
  const [rows] = await connection.query(
    `SELECT TABLE_NAME
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA=?
     ORDER BY TABLE_NAME`,
    [database]
  );
  return rows.map((row) => String(row.TABLE_NAME));
}

async function assertEmptyRemoteStagingDatabase(connection, database) {
  const tables = await tableNames(connection, database);
  if (tables.length) {
    throw new Error('La base staging remota no esta vacia; db:init se detuvo sin cambios.');
  }
}

function quotedTable(table) {
  if (!INITIAL_TABLES.includes(table)) throw new Error('Tabla inicial de staging no permitida.');
  return `\`${table}\``;
}

async function assertRemoteStagingMigrationBaseline(connection, database) {
  const tables = await tableNames(connection, database);
  const expected = new Set(INITIAL_TABLES);
  if (tables.length !== expected.size || tables.some((table) => !expected.has(table))) {
    throw new Error('La base staging no coincide con la estructura inicial vacia; db:migrate se detuvo sin cambios.');
  }
  for (const table of INITIAL_TABLES) {
    const [rows] = await connection.query(`SELECT 1 AS rowExists FROM ${quotedTable(table)} LIMIT 1`);
    if (rows.length) {
      throw new Error('La base staging inicial contiene datos; db:migrate se detuvo sin cambios.');
    }
  }
}

async function diagnoseRemoteStagingDatabase(connection, database) {
  const tables = await tableNames(connection, database);
  if (!tables.length) return STAGING_DATABASE_DIAGNOSTICS.EMPTY;
  const expected = new Set(INITIAL_TABLES);
  if (tables.length !== expected.size || tables.some((table) => !expected.has(table))) {
    return STAGING_DATABASE_DIAGNOSTICS.PARTIAL_OR_UNEXPECTED;
  }
  for (const table of INITIAL_TABLES) {
    const [rows] = await connection.query(`SELECT 1 AS rowExists FROM ${quotedTable(table)} LIMIT 1`);
    if (rows.length) return STAGING_DATABASE_DIAGNOSTICS.PARTIAL_OR_UNEXPECTED;
  }
  return STAGING_DATABASE_DIAGNOSTICS.BASELINE_INITIAL;
}

module.exports = {
  INITIAL_STAGING_DATABASE,
  INITIAL_TABLES,
  REMOTE_STAGING_ARGUMENT,
  REMOTE_STAGING_DIAGNOSTIC_ARGUMENT,
  REMOTE_STAGING_CONFIRMATION,
  STAGING_DATABASE_DIAGNOSTICS,
  assertEmptyRemoteStagingDatabase,
  assertRemoteStagingMigrationBaseline,
  assertRemoteStagingAuthorization,
  assertRemoteStagingConnectionAuthorization,
  diagnoseRemoteStagingDatabase,
  isLocalHost,
  resolveDatabaseMutationMode,
  resolveRemoteStagingDiagnosticMode
};
