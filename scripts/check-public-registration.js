const { createDatabaseConnection } = require('../config/database-connection');
const { databaseConfig } = require('../config/env');

const MIGRATION = '020_registro_publico_onboarding.sql';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function tableExists(connection, table) {
  const [[row]] = await connection.query(
    `SELECT COUNT(*) total FROM information_schema.TABLES
     WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?`,
    [table]
  );
  return Number(row.total) === 1;
}

async function columns(connection, table) {
  const [rows] = await connection.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?`,
    [table]
  );
  return new Set(rows.map((row) => row.COLUMN_NAME));
}

async function indexExists(connection, table, index) {
  const [[row]] = await connection.query(
    `SELECT COUNT(*) total FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND INDEX_NAME=?`,
    [table, index]
  );
  return Number(row.total) > 0;
}

async function inspectPublicRegistration(connection) {
  const [migration] = await connection.query(
    'SELECT nombre FROM schema_migrations WHERE nombre=? LIMIT 1',
    [MIGRATION]
  );
  const [administrator, store, token, request] = await Promise.all([
    columns(connection, 'administrador'), columns(connection, 'tienda'),
    tableExists(connection, 'tokenAccesoAdministrador'), tableExists(connection, 'solicitudRegistroPublico')
  ]);
  const indexes = await Promise.all([
    indexExists(connection, 'administrador', 'uq_administrador_correo_normalizado'),
    indexExists(connection, 'tokenAccesoAdministrador', 'uq_tokenAcceso_hash'),
    indexExists(connection, 'solicitudRegistroPublico', 'uq_solicitudRegistro_clave_hash')
  ]);
  return {
    migrationRegistered: migration.length === 1,
    administrator: ['correoNormalizado', 'correoVerificadoEn', 'estadoAcceso'].every((name) => administrator.has(name)),
    store: ['estadoOnboarding', 'onboardingCompletadoEn'].every((name) => store.has(name)),
    token,
    request,
    indexes: indexes.every(Boolean)
  };
}

async function main() {
  const connection = await createDatabaseConnection(databaseConfig());
  try {
    const state = await inspectPublicRegistration(connection);
    assert(state.migrationRegistered, `${MIGRATION} no esta registrada.`);
    assert(state.administrator && state.store && state.token && state.request && state.indexes,
      'La estructura de registro publico esta incompleta.');
    console.log('Registro publico: estructura 020 valida.');
  } finally {
    await connection.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Error: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { MIGRATION, inspectPublicRegistration };
