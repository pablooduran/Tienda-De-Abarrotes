const { createDatabaseConnection } = require('../config/database-connection');
const { databaseConfig } = require('../config/env');

const MIGRATION = '021_configuracion_base_tienda.sql';
const TABLE = 'configuracionTienda';
const REQUIRED_COLUMNS = Object.freeze([
  'idConfiguracionTienda',
  'idTienda',
  'nombreMostrado',
  'moneda',
  'zonaHoraria',
  'telefono',
  'direccion',
  'datoFiscalBasico',
  'creadoEn',
  'actualizadoEn'
]);
const REQUIRED_CHECKS = Object.freeze([
  'chk_configuracionTienda_nombre',
  'chk_configuracionTienda_moneda',
  'chk_configuracionTienda_zona',
  'chk_configuracionTienda_opcionales'
]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function tableExists(connection) {
  const [[row]] = await connection.query(
    `SELECT COUNT(*) total FROM information_schema.TABLES
     WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?`,
    [TABLE]
  );
  return Number(row.total) === 1;
}

async function columnsAreComplete(connection) {
  const [rows] = await connection.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?`,
    [TABLE]
  );
  const present = new Set(rows.map((row) => row.COLUMN_NAME));
  return REQUIRED_COLUMNS.every((column) => present.has(column));
}

async function indexMatches(connection, name, columns, unique) {
  const [rows] = await connection.query(
    `SELECT COLUMN_NAME, NON_UNIQUE FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND INDEX_NAME=?
     ORDER BY SEQ_IN_INDEX`,
    [TABLE, name]
  );
  return rows.length === columns.length
    && rows.every((row, index) => row.COLUMN_NAME === columns[index]
      && Number(row.NON_UNIQUE) === (unique ? 0 : 1));
}

async function constraintsAreComplete(connection) {
  const [rows] = await connection.query(
    `SELECT CONSTRAINT_NAME, CONSTRAINT_TYPE
     FROM information_schema.TABLE_CONSTRAINTS
     WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME=?`,
    [TABLE]
  );
  const constraints = new Map(rows.map((row) => [row.CONSTRAINT_NAME, row.CONSTRAINT_TYPE]));
  if (!REQUIRED_CHECKS.every((name) => constraints.get(name) === 'CHECK')) return false;
  if (constraints.get('fk_configuracionTienda_tienda') !== 'FOREIGN KEY') return false;
  const [foreignKeys] = await connection.query(
    `SELECT k.COLUMN_NAME, k.REFERENCED_TABLE_NAME, k.REFERENCED_COLUMN_NAME,
            r.UPDATE_RULE, r.DELETE_RULE
     FROM information_schema.KEY_COLUMN_USAGE k
     JOIN information_schema.REFERENTIAL_CONSTRAINTS r
       ON r.CONSTRAINT_SCHEMA=k.CONSTRAINT_SCHEMA
      AND r.TABLE_NAME=k.TABLE_NAME
      AND r.CONSTRAINT_NAME=k.CONSTRAINT_NAME
     WHERE k.TABLE_SCHEMA=DATABASE() AND k.TABLE_NAME=?
       AND k.CONSTRAINT_NAME='fk_configuracionTienda_tienda'`,
    [TABLE]
  );
  return foreignKeys.length === 1
    && foreignKeys[0].COLUMN_NAME === 'idTienda'
    && foreignKeys[0].REFERENCED_TABLE_NAME === 'tienda'
    && foreignKeys[0].REFERENCED_COLUMN_NAME === 'idTienda'
    && foreignKeys[0].UPDATE_RULE === 'RESTRICT'
    && foreignKeys[0].DELETE_RULE === 'RESTRICT';
}

async function inspectStoreConfiguration(connection) {
  const [[migration]] = await connection.query(
    'SELECT COUNT(*) total FROM schema_migrations WHERE nombre=?',
    [MIGRATION]
  );
  const table = await tableExists(connection);
  if (!table) {
    return {
      migrationRegistered: Number(migration.total) === 1,
      table: false,
      columns: false,
      indexes: false,
      constraints: false,
      stores: null,
      configurations: null,
      missing: null,
      duplicates: null,
      invalid: null
    };
  }
  const [columns, primary, unique, constraints] = await Promise.all([
    columnsAreComplete(connection),
    indexMatches(connection, 'PRIMARY', ['idConfiguracionTienda'], true),
    indexMatches(connection, 'uq_configuracionTienda_tienda', ['idTienda'], true),
    constraintsAreComplete(connection)
  ]);
  const [[counts]] = await connection.query(
    `SELECT
       (SELECT COUNT(*) FROM tienda) stores,
       (SELECT COUNT(*) FROM configuracionTienda) configurations,
       (SELECT COUNT(*) FROM tienda t
          WHERE NOT EXISTS (
            SELECT 1 FROM configuracionTienda c WHERE c.idTienda=t.idTienda
          )) missing,
       (SELECT COUNT(*) FROM (
          SELECT idTienda FROM configuracionTienda
          GROUP BY idTienda HAVING COUNT(*)>1
        ) duplicates) duplicates,
       (SELECT COUNT(*) FROM configuracionTienda c
          LEFT JOIN tienda t ON t.idTienda=c.idTienda
          WHERE t.idTienda IS NULL
             OR CHAR_LENGTH(TRIM(c.nombreMostrado))=0
             OR c.moneda<>'BOB'
             OR c.zonaHoraria<>'America/La_Paz'
             OR (c.telefono IS NOT NULL AND CHAR_LENGTH(TRIM(c.telefono))=0)
             OR (c.direccion IS NOT NULL AND CHAR_LENGTH(TRIM(c.direccion))=0)
             OR (
               c.datoFiscalBasico IS NOT NULL
               AND CHAR_LENGTH(TRIM(c.datoFiscalBasico))=0
             )) invalid`
  );
  return {
    migrationRegistered: Number(migration.total) === 1,
    table,
    columns,
    indexes: primary && unique,
    constraints,
    stores: Number(counts.stores),
    configurations: Number(counts.configurations),
    missing: Number(counts.missing),
    duplicates: Number(counts.duplicates),
    invalid: Number(counts.invalid)
  };
}

async function main() {
  const connection = await createDatabaseConnection(databaseConfig());
  try {
    const state = await inspectStoreConfiguration(connection);
    assert(state.migrationRegistered, `${MIGRATION} no esta registrada.`);
    assert(state.table && state.columns && state.indexes && state.constraints,
      'La estructura de configuracion base de tienda esta incompleta.');
    assert(state.stores === state.configurations && state.missing === 0,
      'No existe exactamente una configuracion por tienda.');
    assert(state.duplicates === 0 && state.invalid === 0,
      'La configuracion base contiene duplicados o valores invalidos.');
    console.log(`Configuracion base de tienda: ${state.configurations} tiendas conciliadas.`);
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

module.exports = {
  MIGRATION,
  REQUIRED_CHECKS,
  REQUIRED_COLUMNS,
  TABLE,
  inspectStoreConfiguration
};
