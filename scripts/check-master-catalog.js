const mysql = require('mysql2/promise');
const { databaseTarget, requireLocalhostDatabase } = require('../config/env');
const { hasColumns, hasForeignKeyConstraint, hasIndex, hasTable } = require('./db-utils');

const tables = ['categoriaMaestra', 'marcaMaestra', 'productoMaestro', 'auditoriaCatalogo'];
const columns = {
  categoriaMaestra: ['idCategoriaMaestra', 'nombre', 'nombreNormalizado', 'activo', 'creadoEn', 'actualizadoEn'],
  marcaMaestra: ['idMarcaMaestra', 'nombre', 'nombreNormalizado', 'activo', 'creadoEn', 'actualizadoEn'],
  productoMaestro: [
    'idProductoMaestro', 'nombre', 'nombreNormalizado', 'descripcion', 'idCategoriaMaestra',
    'idMarcaMaestra', 'codigoBarras', 'presentacion', 'contenidoCantidad', 'contenidoUnidad',
    'unidadesPorPaquete', 'permiteVentaPorUnidad', 'permiteVentaPorPaquete', 'huellaDuplicado',
    'activo', 'creadoEn', 'actualizadoEn'
  ],
  auditoriaCatalogo: [
    'idAuditoriaCatalogo', 'idAdministrador', 'accion', 'entidad', 'idEntidad', 'detalle', 'creadoEn'
  ],
  producto: ['idProductoMaestro']
};
const indexes = [
  ['categoriaMaestra', 'uq_categoriaMaestra_normalizada', ['nombreNormalizado'], true],
  ['categoriaMaestra', 'idx_categoriaMaestra_activo_nombre', ['activo', 'nombre'], false],
  ['marcaMaestra', 'uq_marcaMaestra_normalizada', ['nombreNormalizado'], true],
  ['marcaMaestra', 'idx_marcaMaestra_activo_nombre', ['activo', 'nombre'], false],
  ['productoMaestro', 'uq_productoMaestro_codigoBarras', ['codigoBarras'], true],
  ['productoMaestro', 'idx_productoMaestro_busqueda', ['activo', 'nombreNormalizado'], false],
  ['productoMaestro', 'idx_productoMaestro_categoria', ['idCategoriaMaestra', 'activo'], false],
  ['productoMaestro', 'idx_productoMaestro_marca', ['idMarcaMaestra', 'activo'], false],
  ['productoMaestro', 'idx_productoMaestro_huella', ['huellaDuplicado'], false],
  ['auditoriaCatalogo', 'idx_auditoriaCatalogo_admin_fecha', ['idAdministrador', 'creadoEn'], false],
  ['auditoriaCatalogo', 'idx_auditoriaCatalogo_entidad', ['entidad', 'idEntidad', 'creadoEn'], false],
  ['producto', 'idx_producto_productoMaestro', ['idProductoMaestro'], false],
  ['producto', 'uq_producto_tienda_maestro', ['idTienda', 'idProductoMaestro'], true]
];
const foreignKeys = [
  ['productoMaestro', 'fk_productoMaestro_categoria', ['idCategoriaMaestra'], 'categoriaMaestra', ['idCategoriaMaestra'], 'CASCADE', 'RESTRICT'],
  ['productoMaestro', 'fk_productoMaestro_marca', ['idMarcaMaestra'], 'marcaMaestra', ['idMarcaMaestra'], 'CASCADE', 'RESTRICT'],
  ['auditoriaCatalogo', 'fk_auditoriaCatalogo_admin', ['idAdministrador'], 'administrador', ['idAdministrador'], 'CASCADE', 'RESTRICT'],
  ['producto', 'fk_producto_productoMaestro', ['idProductoMaestro'], 'productoMaestro', ['idProductoMaestro'], 'CASCADE', 'RESTRICT']
];

async function scalar(connection, sql, params = []) {
  const [[row]] = await connection.query(sql, params);
  return Number(row.total || 0);
}

async function foreignKeyDiagnostic(connection, relation) {
  const [childTable, constraintName, childColumns, parentTable, parentColumns, updateRule, deleteRule] = relation;
  const childColumn = childColumns[0];
  const parentColumn = parentColumns[0];
  const [childRows, parentRows, engineRows] = await Promise.all([
    connection.query(
      `SELECT COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY, CHARACTER_SET_NAME, COLLATION_NAME
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND COLUMN_NAME=?`,
      [process.env.DB_NAME, childTable, childColumn]
    ),
    connection.query(
      `SELECT COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY, CHARACTER_SET_NAME, COLLATION_NAME
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND COLUMN_NAME=?`,
      [process.env.DB_NAME, parentTable, parentColumn]
    ),
    connection.query(
      `SELECT TABLE_NAME, ENGINE FROM information_schema.TABLES
       WHERE TABLE_SCHEMA=? AND TABLE_NAME IN (?, ?)`,
      [process.env.DB_NAME, childTable, parentTable]
    )
  ]);
  const child = childRows[0][0] || null;
  const parent = parentRows[0][0] || null;
  const engines = Object.fromEntries(engineRows[0].map((row) => [String(row.TABLE_NAME).toLowerCase(), row.ENGINE]));
  return {
    restriccion: constraintName,
    hijo: {
      columna: `${childTable}.${childColumn}`,
      tipo: child?.COLUMN_TYPE || null,
      nullable: child?.IS_NULLABLE || null,
      clave: child?.COLUMN_KEY || null,
      charset: child?.CHARACTER_SET_NAME || null,
      collation: child?.COLLATION_NAME || null,
      motor: engines[String(childTable).toLowerCase()] || null
    },
    padre: {
      columna: `${parentTable}.${parentColumn}`,
      tipo: parent?.COLUMN_TYPE || null,
      nullable: parent?.IS_NULLABLE || null,
      clave: parent?.COLUMN_KEY || null,
      charset: parent?.CHARACTER_SET_NAME || null,
      collation: parent?.COLLATION_NAME || null,
      motor: engines[String(parentTable).toLowerCase()] || null
    },
    tiposCompatibles: Boolean(child && parent
      && String(child.COLUMN_TYPE).toLowerCase() === String(parent.COLUMN_TYPE).toLowerCase()),
    reglasEsperadas: { onUpdate: updateRule, onDelete: deleteRule }
  };
}

async function main() {
  const config = { ...requireLocalhostDatabase('La comprobacion del catalogo maestro'), decimalNumbers: true };
  const connection = await mysql.createConnection(config);
  try {
    const tableState = {};
    for (const table of tables) tableState[table] = await hasTable(connection, table);
    const migrationTable = await hasTable(connection, 'schema_migrations');
    const migrationRecorded = migrationTable
      ? await scalar(connection, "SELECT COUNT(*) total FROM schema_migrations WHERE nombre='006_catalogo_maestro.sql'") === 1
      : false;
    const columnState = {};
    for (const [table, expected] of Object.entries(columns)) {
      columnState[table] = await hasTable(connection, table)
        ? await hasColumns(connection, table, expected)
        : false;
    }
    const noCatalogTables = Object.values(tableState).every((value) => !value);
    const noProductCatalogColumns = !columnState.producto;
    const allTables = Object.values(tableState).every(Boolean);
    const allColumns = Object.values(columnState).every(Boolean);

    if (!allTables || !allColumns) {
      console.log(JSON.stringify({
        destino: databaseTarget(config),
        estado: noCatalogTables && noProductCatalogColumns
          ? 'pre-migracion'
          : 'estructura-parcial',
        migracion006Registrada: migrationRecorded,
        tablas: tableState,
        columnas: columnState
      }, null, 2));
      return;
    }

    const indexState = {};
    for (const [table, name, expected, unique] of indexes) {
      indexState[`${table}.${name}`] = await hasIndex(connection, table, name, expected, unique);
    }
    const foreignKeyState = {};
    const foreignKeyDiagnostics = {};
    for (const relation of foreignKeys) {
      foreignKeyState[`${relation[0]}.${relation[1]}`] = await hasForeignKeyConstraint(connection, ...relation);
      foreignKeyDiagnostics[`${relation[0]}.${relation[1]}`] = await foreignKeyDiagnostic(connection, relation);
    }

    const duplicateBarcodes = await scalar(connection,
      `SELECT COUNT(*) total FROM (
         SELECT codigoBarras FROM productoMaestro
         WHERE codigoBarras IS NOT NULL
         GROUP BY codigoBarras HAVING COUNT(*)>1
       ) duplicados`);
    const invalidMasterReferences = await scalar(connection,
      `SELECT COUNT(*) total FROM productoMaestro p
       LEFT JOIN categoriaMaestra c ON c.idCategoriaMaestra=p.idCategoriaMaestra
       LEFT JOIN marcaMaestra m ON m.idMarcaMaestra=p.idMarcaMaestra
       WHERE (p.idCategoriaMaestra IS NOT NULL AND c.idCategoriaMaestra IS NULL)
          OR (p.idMarcaMaestra IS NOT NULL AND m.idMarcaMaestra IS NULL)`);
    const invalidLocalLinks = await scalar(connection,
      `SELECT COUNT(*) total FROM producto p
       LEFT JOIN productoMaestro pm ON pm.idProductoMaestro=p.idProductoMaestro
       WHERE p.idProductoMaestro IS NOT NULL AND pm.idProductoMaestro IS NULL`);
    const localLinksWithoutStore = await scalar(connection,
      'SELECT COUNT(*) total FROM producto WHERE idProductoMaestro IS NOT NULL AND idTienda IS NULL');
    const duplicateStoreLinks = await scalar(connection,
      `SELECT COUNT(*) total FROM (
         SELECT idTienda, idProductoMaestro FROM producto
         WHERE idProductoMaestro IS NOT NULL
         GROUP BY idTienda, idProductoMaestro HAVING COUNT(*)>1
       ) duplicados`);
    const invalidTaxonomies = await scalar(connection,
      `SELECT
         (SELECT COUNT(*) FROM categoriaMaestra WHERE TRIM(nombre)='' OR TRIM(nombreNormalizado)='') +
         (SELECT COUNT(*) FROM marcaMaestra WHERE TRIM(nombre)='' OR TRIM(nombreNormalizado)='') total`);
    const invalidMasterNames = await scalar(connection,
      "SELECT COUNT(*) total FROM productoMaestro WHERE TRIM(nombre)='' OR TRIM(nombreNormalizado)='' OR codigoBarras=''");
    const catalogFeaturePlans = await scalar(connection,
      `SELECT COUNT(DISTINCT p.codigo) total
       FROM planFuncionalidad pf
       JOIN plan p ON p.idPlan=pf.idPlan
       JOIN funcionalidad f ON f.idFuncionalidad=pf.idFuncionalidad
       WHERE f.codigo='catalogo_maestro' AND pf.habilitada=1
         AND f.activo=1
         AND p.codigo IN ('basico','avanzado')`);
    const counts = {
      categorias: await scalar(connection, 'SELECT COUNT(*) total FROM categoriaMaestra'),
      marcas: await scalar(connection, 'SELECT COUNT(*) total FROM marcaMaestra'),
      productosMaestros: await scalar(connection, 'SELECT COUNT(*) total FROM productoMaestro'),
      productosLocalesVinculados: await scalar(connection, 'SELECT COUNT(*) total FROM producto WHERE idProductoMaestro IS NOT NULL'),
      auditorias: await scalar(connection, 'SELECT COUNT(*) total FROM auditoriaCatalogo')
    };
    const structureComplete = Object.values(columnState).every(Boolean)
      && Object.values(indexState).every(Boolean)
      && Object.values(foreignKeyState).every(Boolean);
    const inconsistencies = duplicateBarcodes + invalidMasterReferences + invalidLocalLinks
      + localLinksWithoutStore + duplicateStoreLinks + invalidTaxonomies + invalidMasterNames;

    console.log(JSON.stringify({
      destino: databaseTarget(config),
      estado: migrationRecorded && structureComplete && inconsistencies === 0 && catalogFeaturePlans === 2
        ? 'post-migracion'
        : 'estructura-incompleta-o-inconsistente',
      migracion006Registrada: migrationRecorded,
      tablas: tableState,
      columnas: columnState,
      indices: indexState,
      clavesForaneas: foreignKeyState,
      diagnosticoClavesForaneas: foreignKeyDiagnostics,
      planesConCatalogoMaestro: catalogFeaturePlans,
      codigosBarrasDuplicados: duplicateBarcodes,
      referenciasMaestrasInvalidas: invalidMasterReferences,
      vinculosLocalesInvalidos: invalidLocalLinks,
      vinculosLocalesSinTienda: localLinksWithoutStore,
      vinculosDuplicadosPorTienda: duplicateStoreLinks,
      taxonomiasInvalidas: invalidTaxonomies,
      productosMaestrosConNombreInvalido: invalidMasterNames,
      conteos: counts
    }, null, 2));
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error('No se pudo comprobar el catalogo maestro.');
  console.error(error.message);
  process.exit(1);
});
