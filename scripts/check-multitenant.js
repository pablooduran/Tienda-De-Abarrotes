const mysql = require('mysql2/promise');
const { databaseTarget, requireLocalhostDatabase } = require('../config/env');

const tenantTables = [
  'administrador',
  'cliente',
  'proveedor',
  'producto',
  'venta',
  'detalleVenta',
  'compra',
  'detalleCompra',
  'fiado',
  'detalleFiado',
  'pagoFiado'
];
const commercialTenantTables = tenantTables.filter((table) => table !== 'administrador');

async function tableExists(connection, table) {
  const [[row]] = await connection.query(
    `SELECT COUNT(*) total
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA=? AND TABLE_NAME=?`,
    [process.env.DB_NAME, table]
  );
  return Number(row.total) > 0;
}

async function columnExists(connection, table, column) {
  const [[row]] = await connection.query(
    `SELECT COUNT(*) total
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND COLUMN_NAME=?`,
    [process.env.DB_NAME, table, column]
  );
  return Number(row.total) > 0;
}

async function tableSummary(connection, table) {
  if (!await tableExists(connection, table)) {
    return { existe: false, registros: 0, tieneIdTienda: false, sinIdTienda: null };
  }
  const [[count]] = await connection.query(`SELECT COUNT(*) total FROM ${table}`);
  const hasTenant = await columnExists(connection, table, 'idTienda');
  let withoutTenant = null;
  if (hasTenant && table !== 'administrador') {
    const [[missing]] = await connection.query(`SELECT COUNT(*) total FROM ${table} WHERE idTienda IS NULL`);
    withoutTenant = Number(missing.total);
  }
  return {
    existe: true,
    registros: Number(count.total),
    tieneIdTienda: hasTenant,
    sinIdTienda: withoutTenant
  };
}

async function administratorValidation(connection) {
  if (!await tableExists(connection, 'administrador')) {
    return {
      validacionDisponible: false,
      propietariosSinTienda: null,
      superadminConTienda: null,
      administradoresConRolInvalido: null
    };
  }

  const [hasTenant, hasRole] = await Promise.all([
    columnExists(connection, 'administrador', 'idTienda'),
    columnExists(connection, 'administrador', 'rol')
  ]);
  if (!hasTenant || !hasRole) {
    return {
      validacionDisponible: false,
      propietariosSinTienda: null,
      superadminConTienda: null,
      administradoresConRolInvalido: null
    };
  }

  const [[row]] = await connection.query(
    `SELECT
       SUM(CASE WHEN rol='dueno_tienda' AND idTienda IS NULL THEN 1 ELSE 0 END) AS propietariosSinTienda,
       SUM(CASE WHEN rol='superadmin' AND idTienda IS NOT NULL THEN 1 ELSE 0 END) AS superadminConTienda,
       SUM(CASE WHEN rol IS NULL OR rol NOT IN ('dueno_tienda', 'superadmin') THEN 1 ELSE 0 END) AS administradoresConRolInvalido
     FROM administrador`
  );
  return {
    validacionDisponible: true,
    propietariosSinTienda: Number(row.propietariosSinTienda || 0),
    superadminConTienda: Number(row.superadminConTienda || 0),
    administradoresConRolInvalido: Number(row.administradoresConRolInvalido || 0)
  };
}

async function aggregate(connection, table, sumColumn) {
  if (!await tableExists(connection, table)) return { registros: 0, total: 0 };
  const [[row]] = await connection.query(
    `SELECT COUNT(*) registros, COALESCE(SUM(${sumColumn}), 0) total FROM ${table}`
  );
  return { registros: Number(row.registros), total: Number(row.total) };
}

async function migration004Structure(connection, hasStoreTable) {
  let recorded = false;
  if (await tableExists(connection, 'schema_migrations')) {
    const [[row]] = await connection.query(
      "SELECT COUNT(*) total FROM schema_migrations WHERE nombre='004_multitienda_base.sql'"
    );
    recorded = Number(row.total) > 0;
  }

  let deisyStores = 0;
  if (hasStoreTable) {
    const [[row]] = await connection.query("SELECT COUNT(*) total FROM tienda WHERE slug='tienda-deisy'");
    deisyStores = Number(row.total);
  }

  const [indexRows] = await connection.query(
    `SELECT DISTINCT TABLE_NAME tabla, INDEX_NAME nombre
     FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA=?
       AND (INDEX_NAME='uq_tienda_slug' OR INDEX_NAME LIKE '%\\_tienda\\_%')
     ORDER BY TABLE_NAME, INDEX_NAME`,
    [process.env.DB_NAME]
  );
  const [constraintRows] = await connection.query(
    `SELECT TABLE_NAME tabla, CONSTRAINT_NAME nombre, CONSTRAINT_TYPE tipo
     FROM information_schema.TABLE_CONSTRAINTS
     WHERE CONSTRAINT_SCHEMA=?
       AND (CONSTRAINT_NAME LIKE 'fk\\_%\\_tienda%'
         OR CONSTRAINT_NAME='chk_administrador_rol_tienda')
     ORDER BY TABLE_NAME, CONSTRAINT_NAME`,
    [process.env.DB_NAME]
  );

  return {
    registradaEnSchemaMigrations: recorded,
    tiendasConSlugDeisy: deisyStores,
    indicesPresentes: indexRows,
    restriccionesPresentes: constraintRows
  };
}

async function main() {
  const config = { ...requireLocalhostDatabase('La comprobacion multi-tienda'), decimalNumbers: true };
  const connection = await mysql.createConnection(config);
  try {
    const tables = {};
    for (const table of tenantTables) tables[table] = await tableSummary(connection, table);

    const hasStoreTable = await tableExists(connection, 'tienda');
    const existingTables = Object.values(tables).filter((table) => table.existe).length;
    const tablesWithTenant = Object.values(tables).filter((table) => table.tieneIdTienda).length;
    const commercialRecordsWithoutTenant = commercialTenantTables
      .reduce((total, table) => total + (tables[table].sinIdTienda || 0), 0);
    const administradores = await administratorValidation(connection);
    const recordsWithoutTenant = commercialRecordsWithoutTenant + (administradores.propietariosSinTienda || 0);
    const shops = hasStoreTable
      ? Number((await connection.query('SELECT COUNT(*) total FROM tienda'))[0][0].total)
      : 0;
    const migration004 = await migration004Structure(connection, hasStoreTable);
    const administratorRulesValid = administradores.validacionDisponible
      && administradores.propietariosSinTienda === 0
      && administradores.superadminConTienda === 0
      && administradores.administradoresConRolInvalido === 0;
    const migrationState = !hasStoreTable
      && existingTables === tenantTables.length
      && tablesWithTenant === 0
      ? 'pre-migracion'
        : hasStoreTable
          && shops > 0
          && tablesWithTenant === tenantTables.length
          && migration004.registradaEnSchemaMigrations
          && migration004.tiendasConSlugDeisy === 1
          && recordsWithoutTenant === 0
          && administratorRulesValid
        ? 'post-migracion'
        : 'estructura-incompleta-o-migracion-parcial';

    const snapshot = {
      destino: databaseTarget(config),
      estadoMigracion: migrationState,
      estructuraMultitienda: {
        tablaTienda: hasStoreTable,
        tablasExistentes: existingTables,
        tablasConIdTienda: tablesWithTenant,
        tablasEsperadas: tenantTables.length,
        registrosSinIdTienda: recordsWithoutTenant,
        registrosComercialesSinIdTienda: commercialRecordsWithoutTenant
      },
      administradores,
      migracion004: migration004,
      tiendas: shops,
      tablas: tables,
      ventas: await aggregate(connection, 'venta', 'total'),
      compras: await aggregate(connection, 'compra', 'total'),
      fiados: await aggregate(connection, 'fiado', 'totalFiado'),
      stock: await aggregate(connection, 'producto', 'stockUnidadesTotal'),
      pagosFiado: await aggregate(connection, 'pagoFiado', 'monto')
    };

    console.log(JSON.stringify(snapshot, null, 2));
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error('No se pudo comprobar la estructura multi-tienda.');
  console.error(error.message);
  process.exit(1);
});
