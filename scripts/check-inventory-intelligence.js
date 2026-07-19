const { databaseConfig, databaseTarget, logDatabaseTarget } = require('../config/env');
const {
  createConnection,
  hasCheckConstraint,
  hasColumns,
  hasForeignKeyConstraint,
  hasIndex,
  hasTable
} = require('./db-utils');

const MIGRATION = '010_inteligencia_inventario.sql';
const BASIC_FEATURES = Object.freeze([
  'inventario_resumen',
  'alertas_stock',
  'ranking_productos',
  'valor_inventario_basico'
]);
const ADVANCED_FEATURES = Object.freeze([
  ...BASIC_FEATURES,
  'compras_sugeridas',
  'rotacion_inventario',
  'dias_cobertura',
  'inventario_sin_movimiento',
  'exportacion_inventario'
]);
const BASIC_FORBIDDEN_FEATURES = Object.freeze([
  'compras_sugeridas',
  'rotacion_inventario',
  'dias_cobertura',
  'inventario_sin_movimiento',
  'exportacion_inventario',
  'vencimientos_lote'
]);

const REQUIRED_COLUMNS = Object.freeze({
  configuracionInventarioTienda: [
    'idTienda', 'periodoAnalisisDias', 'diasHistorialMinimo', 'diasReposicionDefault',
    'diasCoberturaDefault', 'diasProductoNuevo', 'creadoEn', 'actualizadoEn',
    'idAdministradorActualiza'
  ],
  producto: [
    'diasReposicion', 'diasCoberturaObjetivo', 'presentacionCompraSugerida',
    'fechaInicioSeguimiento'
  ]
});

const COLUMN_DEFINITIONS = Object.freeze({
  configuracionInventarioTienda: {
    idTienda: { dataType: 'int', nullable: false, defaultValue: null },
    periodoAnalisisDias: { dataType: 'int', nullable: false, defaultValue: '30' },
    diasHistorialMinimo: { dataType: 'int', nullable: false, defaultValue: '14' },
    diasReposicionDefault: { dataType: 'int', nullable: false, defaultValue: '3' },
    diasCoberturaDefault: { dataType: 'int', nullable: false, defaultValue: '14' },
    diasProductoNuevo: { dataType: 'int', nullable: false, defaultValue: '30' },
    creadoEn: { dataType: 'datetime', nullable: false, defaultValue: null, extraValue: '' },
    actualizadoEn: { dataType: 'datetime', nullable: false, defaultValue: null, extraValue: '' },
    idAdministradorActualiza: { dataType: 'int', nullable: true, defaultValue: null }
  },
  producto: {
    diasReposicion: { dataType: 'int', nullable: true, defaultValue: null },
    diasCoberturaObjetivo: { dataType: 'int', nullable: true, defaultValue: null },
    presentacionCompraSugerida: {
      dataType: 'enum', columnType: "enum('unidad','paquete')", nullable: true, defaultValue: null
    },
    fechaInicioSeguimiento: { dataType: 'datetime', nullable: false, defaultValue: null, extraValue: '' }
  }
});

const INDEXES = Object.freeze([
  ['configuracionInventarioTienda', 'PRIMARY', ['idTienda'], true],
  ['configuracionInventarioTienda', 'idx_configInventario_tienda_admin', ['idTienda', 'idAdministradorActualiza'], false],
  ['producto', 'idx_producto_tienda_inventario', ['idTienda', 'activo', 'stockUnidadesTotal', 'stockMinimo'], false],
  ['producto', 'idx_producto_tienda_categoria_activo', ['idTienda', 'categoria', 'activo'], false],
  ['producto', 'idx_producto_tienda_proveedor_activo', ['idTienda', 'idProveedor', 'activo'], false],
  ['producto', 'idx_producto_tienda_seguimiento', ['idTienda', 'fechaInicioSeguimiento'], false],
  ['detalleVenta', 'idx_detalleVenta_tienda_producto_venta', ['idTienda', 'idProducto', 'idVenta'], false],
  ['detalleCompra', 'idx_detalleCompra_tienda_producto_compra', ['idTienda', 'idProducto', 'idCompra'], false]
]);

const CHECKS = Object.freeze([
  ['configuracionInventarioTienda', 'chk_configInventario_periodos'],
  ['configuracionInventarioTienda', 'chk_configInventario_reposicion'],
  ['configuracionInventarioTienda', 'chk_configInventario_cobertura'],
  ['configuracionInventarioTienda', 'chk_configInventario_producto_nuevo'],
  ['producto', 'chk_producto_dias_reposicion'],
  ['producto', 'chk_producto_dias_cobertura']
]);

const FOREIGN_KEYS = Object.freeze([
  ['configuracionInventarioTienda', 'fk_configInventario_tienda', ['idTienda'], 'tienda', ['idTienda'], 'RESTRICT', 'RESTRICT'],
  ['configuracionInventarioTienda', 'fk_configInventario_administrador', ['idTienda', 'idAdministradorActualiza'], 'administrador', ['idTienda', 'idAdministrador'], 'RESTRICT', 'RESTRICT']
]);

async function count(connection, sql, params = []) {
  const [[row]] = await connection.query(sql, params);
  return Number(row.total || 0);
}

function normalizedDefault(value) {
  if (value === null || value === undefined) return null;
  return String(value).trim().toLowerCase().replace(/\(\)$/, '');
}

async function columnDetails(connection, table, columns) {
  if (!columns.length) return {};
  const placeholders = columns.map(() => '?').join(',');
  const [rows] = await connection.query(
    `SELECT COLUMN_NAME, DATA_TYPE, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, EXTRA
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND COLUMN_NAME IN (${placeholders})`,
    [process.env.DB_NAME, table, ...columns]
  );
  return Object.fromEntries(rows.map((row) => [row.COLUMN_NAME, {
    tipo: String(row.DATA_TYPE).toLowerCase(),
    tipoCompleto: String(row.COLUMN_TYPE).toLowerCase(),
    nullable: row.IS_NULLABLE === 'YES',
    valorPredeterminado: row.COLUMN_DEFAULT,
    extra: String(row.EXTRA || '').toLowerCase()
  }]));
}

function validateColumnDetails(details) {
  const result = {};
  for (const [table, expectedColumns] of Object.entries(COLUMN_DEFINITIONS)) {
    result[table] = {};
    for (const [column, expected] of Object.entries(expectedColumns)) {
      const actual = details[table]?.[column];
      result[table][column] = Boolean(actual)
        && actual.tipo === expected.dataType
        && (!expected.columnType || actual.tipoCompleto === expected.columnType)
        && actual.nullable === expected.nullable
        && normalizedDefault(actual.valorPredeterminado) === normalizedDefault(expected.defaultValue)
        && (expected.extraValue === undefined || actual.extra === expected.extraValue)
        && (!expected.extraIncludes || actual.extra.includes(expected.extraIncludes));
    }
  }
  return result;
}

async function featureAccessCount(connection, planCode, featureCodes) {
  const placeholders = featureCodes.map(() => '?').join(',');
  return count(connection,
    `SELECT COUNT(DISTINCT f.codigo) total
     FROM planFuncionalidad pf
     JOIN plan p ON p.idPlan=pf.idPlan
     JOIN funcionalidad f ON f.idFuncionalidad=pf.idFuncionalidad
     WHERE p.codigo=? AND p.activo=1 AND f.activo=1 AND pf.habilitada=1
       AND f.codigo IN (${placeholders})`,
    [planCode, ...featureCodes]);
}

async function main() {
  const config = databaseConfig();
  logDatabaseTarget('Comprobacion de inteligencia de inventario', config);
  const connection = await createConnection();
  try {
    const schemaMigrationsExists = await hasTable(connection, 'schema_migrations');
    const migracionRegistrada = schemaMigrationsExists
      ? await count(connection, 'SELECT COUNT(*) total FROM schema_migrations WHERE nombre=?', [MIGRATION]) === 1
      : false;

    const tablas = {};
    for (const table of Object.keys(REQUIRED_COLUMNS)) tablas[table] = await hasTable(connection, table);
    tablas.detalleVenta = await hasTable(connection, 'detalleVenta');
    tablas.detalleCompra = await hasTable(connection, 'detalleCompra');
    tablas.movimientoStock = await hasTable(connection, 'movimientoStock');

    const columnas = {};
    const detallesColumnas = {};
    for (const [table, required] of Object.entries(REQUIRED_COLUMNS)) {
      columnas[table] = tablas[table] && await hasColumns(connection, table, required);
      detallesColumnas[table] = tablas[table] ? await columnDetails(connection, table, required) : {};
    }
    const tiposNulabilidadDefaults = validateColumnDetails(detallesColumnas);

    const indices = {};
    for (const index of INDEXES) indices[`${index[0]}.${index[1]}`] = await hasIndex(connection, ...index);
    const checks = {};
    for (const check of CHECKS) checks[`${check[0]}.${check[1]}`] = await hasCheckConstraint(connection, ...check);
    const clavesForaneas = {};
    for (const relation of FOREIGN_KEYS) {
      clavesForaneas[`${relation[0]}.${relation[1]}`] = await hasForeignKeyConstraint(connection, ...relation);
    }

    const estructuraCompleta = tablas.configuracionInventarioTienda
      && columnas.configuracionInventarioTienda
      && columnas.producto
      && Object.values(tiposNulabilidadDefaults).every((table) => Object.values(table).every(Boolean))
      && Object.values(indices).every(Boolean)
      && Object.values(checks).every(Boolean)
      && Object.values(clavesForaneas).every(Boolean);

    const datos = {
      tiendas: await hasTable(connection, 'tienda') ? await count(connection, 'SELECT COUNT(*) total FROM tienda') : null,
      configuraciones: tablas.configuracionInventarioTienda
        ? await count(connection, 'SELECT COUNT(*) total FROM configuracionInventarioTienda') : null,
      tiendasSinConfiguracion: null,
      configuracionesDuplicadas: null,
      configuracionesHuerfanas: null,
      responsablesConfiguracionInvalidos: null,
      configuracionesFueraDeRango: null,
      productosSinFechaSeguimiento: null,
      productosConDiasReposicionInvalidos: null,
      productosConDiasCoberturaInvalidos: null,
      presentacionesSugeridasInvalidas: null,
      diferenciasStockCompatibilidad: null,
      productosConStockNegativo: null,
      movimientosCruzadosEntreTiendas: null,
      funcionalidadesActivas: null,
      funcionalidadesNuevasActivas: null,
      accesosBasico: null,
      accesosAvanzado: null,
      funcionesAvanzadasEnBasico: null,
      funcionalidadesDuplicadas: null,
      accesosPlanDuplicados: null
    };

    if (tablas.configuracionInventarioTienda && columnas.configuracionInventarioTienda) {
      datos.tiendasSinConfiguracion = await count(connection,
        `SELECT COUNT(*) total FROM tienda t
         WHERE NOT EXISTS (SELECT 1 FROM configuracionInventarioTienda c WHERE c.idTienda=t.idTienda)`);
      datos.configuracionesDuplicadas = await count(connection,
        `SELECT COUNT(*) total FROM (
           SELECT idTienda FROM configuracionInventarioTienda GROUP BY idTienda HAVING COUNT(*)>1
         ) duplicados`);
      datos.configuracionesHuerfanas = await count(connection,
        `SELECT COUNT(*) total FROM configuracionInventarioTienda c
         LEFT JOIN tienda t ON t.idTienda=c.idTienda WHERE t.idTienda IS NULL`);
      datos.responsablesConfiguracionInvalidos = await count(connection,
        `SELECT COUNT(*) total FROM configuracionInventarioTienda c
         LEFT JOIN administrador a
           ON a.idTienda=c.idTienda AND a.idAdministrador=c.idAdministradorActualiza
         WHERE c.idAdministradorActualiza IS NOT NULL AND a.idAdministrador IS NULL`);
      datos.configuracionesFueraDeRango = await count(connection,
        `SELECT COUNT(*) total FROM configuracionInventarioTienda
         WHERE periodoAnalisisDias NOT BETWEEN 7 AND 365
            OR diasHistorialMinimo NOT BETWEEN 1 AND periodoAnalisisDias
            OR diasReposicionDefault NOT BETWEEN 0 AND 365
            OR diasCoberturaDefault NOT BETWEEN 1 AND 365
            OR diasProductoNuevo NOT BETWEEN 1 AND 365`);
    }

    if (columnas.producto) {
      datos.productosSinFechaSeguimiento = await count(connection,
        'SELECT COUNT(*) total FROM producto WHERE fechaInicioSeguimiento IS NULL');
      datos.productosConDiasReposicionInvalidos = await count(connection,
        'SELECT COUNT(*) total FROM producto WHERE diasReposicion IS NOT NULL AND diasReposicion NOT BETWEEN 0 AND 365');
      datos.productosConDiasCoberturaInvalidos = await count(connection,
        'SELECT COUNT(*) total FROM producto WHERE diasCoberturaObjetivo IS NOT NULL AND diasCoberturaObjetivo NOT BETWEEN 1 AND 365');
      datos.presentacionesSugeridasInvalidas = await count(connection,
        `SELECT COUNT(*) total FROM producto
         WHERE presentacionCompraSugerida IS NOT NULL
           AND presentacionCompraSugerida NOT IN ('unidad','paquete')`);
    }
    if (await hasColumns(connection, 'producto', ['stock', 'stockUnidadesTotal'])) {
      datos.diferenciasStockCompatibilidad = await count(connection,
        'SELECT COUNT(*) total FROM producto WHERE stock<>stockUnidadesTotal');
      datos.productosConStockNegativo = await count(connection,
        'SELECT COUNT(*) total FROM producto WHERE stock<0 OR stockUnidadesTotal<0');
    }
    if (tablas.movimientoStock && await hasColumns(connection, 'movimientoStock', ['idTienda', 'idProducto'])) {
      datos.movimientosCruzadosEntreTiendas = await count(connection,
        `SELECT COUNT(*) total FROM movimientoStock m
         LEFT JOIN producto p ON p.idTienda=m.idTienda AND p.idProducto=m.idProducto
         WHERE p.idProducto IS NULL`);
    }

    const featureTablesExist = await hasTable(connection, 'funcionalidad')
      && await hasTable(connection, 'plan') && await hasTable(connection, 'planFuncionalidad');
    if (featureTablesExist) {
      const allFeatures = [...new Set(ADVANCED_FEATURES)];
      const placeholders = allFeatures.map(() => '?').join(',');
      datos.funcionalidadesActivas = await count(connection,
        `SELECT COUNT(DISTINCT codigo) total FROM funcionalidad
         WHERE activo=1 AND codigo IN (${placeholders})`, allFeatures);
      const newFeatures = ADVANCED_FEATURES.filter((code) => code !== 'compras_sugeridas');
      const newFeaturePlaceholders = newFeatures.map(() => '?').join(',');
      datos.funcionalidadesNuevasActivas = await count(connection,
        `SELECT COUNT(DISTINCT codigo) total FROM funcionalidad
         WHERE activo=1 AND codigo IN (${newFeaturePlaceholders})`, newFeatures);
      datos.accesosBasico = await featureAccessCount(connection, 'basico', BASIC_FEATURES);
      datos.accesosAvanzado = await featureAccessCount(connection, 'avanzado', ADVANCED_FEATURES);
      datos.funcionesAvanzadasEnBasico = await featureAccessCount(connection, 'basico', BASIC_FORBIDDEN_FEATURES);
      datos.funcionalidadesDuplicadas = await count(connection,
        `SELECT COUNT(*) total FROM (
           SELECT codigo FROM funcionalidad GROUP BY codigo HAVING COUNT(*)>1
         ) duplicados`);
      datos.accesosPlanDuplicados = await count(connection,
        `SELECT COUNT(*) total FROM (
           SELECT idPlan, idFuncionalidad FROM planFuncionalidad
           GROUP BY idPlan, idFuncionalidad HAVING COUNT(*)>1
         ) duplicados`);
    }

    const requiredDataChecks = [
      'tiendasSinConfiguracion', 'configuracionesDuplicadas', 'configuracionesHuerfanas',
      'responsablesConfiguracionInvalidos', 'configuracionesFueraDeRango',
      'productosSinFechaSeguimiento', 'productosConDiasReposicionInvalidos',
      'productosConDiasCoberturaInvalidos', 'presentacionesSugeridasInvalidas',
      'diferenciasStockCompatibilidad', 'productosConStockNegativo',
      'movimientosCruzadosEntreTiendas', 'funcionalidadesDuplicadas', 'accesosPlanDuplicados'
    ];
    const datosValidos = estructuraCompleta
      && requiredDataChecks.every((key) => datos[key] === 0)
      && datos.funcionalidadesActivas === ADVANCED_FEATURES.length
      && datos.accesosBasico === BASIC_FEATURES.length
      && datos.accesosAvanzado === ADVANCED_FEATURES.length
      && datos.funcionesAvanzadasEnBasico === 0;

    const newProductColumnsPresent = Object.keys(COLUMN_DEFINITIONS.producto)
      .some((column) => Boolean(detallesColumnas.producto[column]));
    const newFeaturesPresent = featureTablesExist && datos.funcionalidadesNuevasActivas > 0;
    const estadoMigracion = migracionRegistrada && estructuraCompleta && datosValidos
      ? 'post-migracion'
      : (!migracionRegistrada && !tablas.configuracionInventarioTienda
          && !newProductColumnsPresent && !newFeaturesPresent)
        ? 'pre-migracion'
        : 'estructura-incompleta-o-migracion-parcial';

    console.log(JSON.stringify({
      destino: {
        entorno: String(process.env.APP_ENV || 'predeterminado'),
        base: config.database,
        conexion: databaseTarget(config)
      },
      estadoMigracion,
      migracionRegistrada,
      tablas,
      columnas,
      detallesColumnas,
      tiposNulabilidadDefaults,
      indices,
      checks,
      clavesForaneas,
      estructuraCompleta,
      datosValidos,
      datos
    }, null, 2));

    const severeExistingInventoryProblem = [
      datos.diferenciasStockCompatibilidad,
      datos.productosConStockNegativo,
      datos.movimientosCruzadosEntreTiendas
    ].some((value) => value !== null && value > 0);
    if (estadoMigracion === 'estructura-incompleta-o-migracion-parcial'
      || severeExistingInventoryProblem
      || (migracionRegistrada && (!estructuraCompleta || !datosValidos))) {
      process.exitCode = 1;
    }
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error('No se pudo comprobar la inteligencia de inventario.');
  console.error(error.message);
  process.exit(1);
});
