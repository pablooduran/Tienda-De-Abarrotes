const { databaseConfig, logDatabaseTarget } = require('../config/env');
const { createDatabaseConnection } = require('../config/database-connection');

const MIGRATION = '019_stock_vendible_ajustes.sql';
const TABLE = 'ajusteInventario';
const EXPECTED_COLUMNS = Object.freeze([
  'idAjusteInventario', 'idTienda', 'idProducto', 'idMovimientoStock',
  'idLoteProducto', 'tipoAjuste', 'cantidad', 'motivoCodigo', 'observacion',
  'modoLotes', 'clasificacionInventario', 'stockFisicoAnterior',
  'stockFisicoPosterior', 'stockVendibleAnterior', 'stockVendiblePosterior',
  'claveOperacion', 'huellaSolicitud', 'idAdministrador', 'creadoEn'
]);
const EXPECTED_INDEXES = Object.freeze([
  'uq_ajusteInventario_tienda_id',
  'uq_ajusteInventario_tienda_clave',
  'uq_ajusteInventario_tienda_movimiento',
  'idx_ajusteInventario_tienda_fecha',
  'idx_ajusteInventario_tienda_producto_fecha',
  'idx_ajusteInventario_tienda_lote'
]);
const EXPECTED_CHECKS = Object.freeze([
  'chk_ajusteInventario_cantidad',
  'chk_ajusteInventario_stock',
  'chk_ajusteInventario_otro',
  'chk_ajusteInventario_lotes',
  'chk_ajusteInventario_clave'
]);
const EXPECTED_FOREIGN_KEYS = Object.freeze([
  'fk_ajusteInventario_tienda',
  'fk_ajusteInventario_producto',
  'fk_ajusteInventario_movimiento',
  'fk_ajusteInventario_lote',
  'fk_ajusteInventario_administrador'
]);

async function names(connection, sql, params) {
  const [rows] = await connection.query(sql, params);
  return new Set(rows.map((row) => String(Object.values(row)[0]).toLowerCase()));
}

async function scalar(connection, sql, params = []) {
  const [[row]] = await connection.query(sql, params);
  return Number(row.total);
}

async function inspectInventoryAdjustments(connection, { schemaName = databaseConfig().database } = {}) {
  const migrationCount = await scalar(
    connection,
    'SELECT COUNT(*) total FROM schema_migrations WHERE nombre=?',
    [MIGRATION]
  );
  const tableCount = await scalar(
    connection,
    `SELECT COUNT(*) total FROM information_schema.TABLES
     WHERE TABLE_SCHEMA=? AND TABLE_NAME=?`,
    [schemaName, TABLE]
  );
  const lotClassification = await scalar(
    connection,
    `SELECT COUNT(*) total FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA=? AND TABLE_NAME='loteProducto'
       AND COLUMN_NAME='clasificacionInventario'`,
    [schemaName]
  );
  if (!tableCount) {
    return {
      migracion: MIGRATION,
      registrada: migrationCount === 1,
      estructuraCompleta: false,
      datosValidos: false,
      estado: migrationCount === 1 ? 'inconsistente' : 'pre'
    };
  }
  const columns = await names(
    connection,
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA=? AND TABLE_NAME=?`,
    [schemaName, TABLE]
  );
  const indexes = await names(
    connection,
    `SELECT DISTINCT INDEX_NAME FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA=? AND TABLE_NAME=?`,
    [schemaName, TABLE]
  );
  const constraints = await names(
    connection,
    `SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS
     WHERE CONSTRAINT_SCHEMA=? AND TABLE_NAME=?`,
    [schemaName, TABLE]
  );
  const invalid = {
    cantidades: await scalar(connection, `SELECT COUNT(*) total FROM ${TABLE} WHERE cantidad<=0`),
    stocks: await scalar(
      connection,
      `SELECT COUNT(*) total FROM ${TABLE}
       WHERE stockFisicoAnterior<0 OR stockFisicoPosterior<0
          OR stockVendibleAnterior<0 OR stockVendiblePosterior<0
          OR stockVendibleAnterior>stockFisicoAnterior
          OR stockVendiblePosterior>stockFisicoPosterior`
    ),
    referencias: await scalar(
      connection,
      `SELECT COUNT(*) total
       FROM ${TABLE} ai
       LEFT JOIN producto p
         ON p.idTienda=ai.idTienda AND p.idProducto=ai.idProducto
       LEFT JOIN administrador a
         ON a.idTienda=ai.idTienda AND a.idAdministrador=ai.idAdministrador
       WHERE p.idProducto IS NULL OR a.idAdministrador IS NULL`
    ),
    lotesTecnicosVendibles: await scalar(
      connection,
      `SELECT COUNT(*) total FROM loteProducto
       WHERE clasificacionInventario='tecnico'
         AND estadoOperativo='disponible'
         AND cantidadRestante>0`
    )
  };
  const structureComplete = migrationCount === 1
    && lotClassification === 1
    && EXPECTED_COLUMNS.every((name) => columns.has(name.toLowerCase()))
    && EXPECTED_INDEXES.every((name) => indexes.has(name.toLowerCase()))
    && [...EXPECTED_CHECKS, ...EXPECTED_FOREIGN_KEYS]
      .every((name) => constraints.has(name.toLowerCase()));
  const dataValid = Object.values(invalid).every((value) => value === 0);
  return {
    migracion: MIGRATION,
    registrada: migrationCount === 1,
    estructuraCompleta: structureComplete,
    datosValidos: dataValid,
    inconsistencias: invalid,
    estado: structureComplete && dataValid ? 'post' : 'inconsistente'
  };
}

async function main() {
  const config = databaseConfig();
  logDatabaseTarget('Comprobacion de stock vendible y ajustes', config);
  const connection = await createDatabaseConnection(config);
  try {
    const result = await inspectInventoryAdjustments(connection, { schemaName: config.database });
    console.log(JSON.stringify(result, null, 2));
    if (result.estado === 'inconsistente') process.exitCode = 1;
  } finally {
    await connection.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error('No se pudo comprobar stock vendible y ajustes de inventario.');
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  EXPECTED_CHECKS,
  EXPECTED_COLUMNS,
  EXPECTED_FOREIGN_KEYS,
  EXPECTED_INDEXES,
  MIGRATION,
  inspectInventoryAdjustments
};
