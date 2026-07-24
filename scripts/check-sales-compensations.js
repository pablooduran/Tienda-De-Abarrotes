const { logDatabaseTarget, requireLocalhostDatabase } = require('../config/env');
const { createDatabaseConnection } = require('../config/database-connection');

const MIGRATION = '015_compensaciones_venta_inventario.sql';
const REQUIRED_TABLES = Object.freeze([
  'compensacionVenta',
  'liquidacionCompensacionVenta',
  'detalleCompensacionVenta',
  'detalleCompensacionLote'
]);

async function count(connection, sql, params = []) {
  const [[row]] = await connection.query(sql, params);
  return Number(row.total || 0);
}

async function names(connection, source, table) {
  const [rows] = await connection.query(
    `SELECT ${source} nombre
     FROM information_schema.${table}
     WHERE TABLE_SCHEMA=DATABASE()`
  );
  return new Set(rows.map((row) => String(row.nombre).toLowerCase()));
}

async function inspectSalesCompensations(connection) {
  const [tableRows] = await connection.query(
    `SELECT TABLE_NAME nombre, ENGINE motor
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA=DATABASE()`
  );
  const tables = new Map(tableRows.map((row) => [
    String(row.nombre).toLowerCase(),
    String(row.motor || '').toLowerCase()
  ]));
  const columns = await names(connection, 'CONCAT(LOWER(TABLE_NAME), ".", LOWER(COLUMN_NAME))', 'COLUMNS');
  const indexes = await names(connection, 'CONCAT(LOWER(TABLE_NAME), ".", LOWER(INDEX_NAME))', 'STATISTICS');
  const constraints = await names(
    connection,
    'CONCAT(LOWER(TABLE_NAME), ".", LOWER(CONSTRAINT_NAME))',
    'TABLE_CONSTRAINTS'
  );
  const migrationRegistered = tables.has('schema_migrations')
    && await count(connection, 'SELECT COUNT(*) total FROM schema_migrations WHERE nombre=?', [MIGRATION]) === 1;
  const requiredColumns = [
    'compensacionventa.idoperacioncompensatoria',
    'compensacionventa.idventa',
    'liquidacioncompensacionventa.montoreducciondeudapendiente',
    'liquidacioncompensacionventa.montoreembolsopendiente',
    'detallecompensacionventa.unidadesdevueltas',
    'detallecompensacionventa.tratamientoinventario',
    'detallecompensacionventa.resultadoinventario',
    'detallecompensacionventa.idmovimientostock',
    'detallecompensacionlote.idmovimientolotesalida',
    'detallecompensacionlote.idloteproductodestino',
    'detallecompensacionlote.idmovimientolotecompensatorio'
  ];
  const requiredIndexes = [
    'compensacionventa.uq_compensacionventa_tienda_operacion',
    'liquidacioncompensacionventa.uq_liquidacioncompensacion_tienda_compensacion',
    'detallecompensacionventa.uq_detallecompensacionventa_tienda_detalle',
    'detallecompensacionlote.uq_detallecompensacionlote_tienda_fuente',
    'movimientolote.uq_movimientolote_tienda_producto_id'
  ];
  const requiredConstraints = [
    'compensacionventa.fk_compensacionventa_operacion',
    'compensacionventa.fk_compensacionventa_venta',
    'liquidacioncompensacionventa.fk_liquidacioncompensacion_compensacion',
    'detallecompensacionventa.fk_detallecompensacionventa_compensacion',
    'detallecompensacionventa.fk_detallecompensacionventa_detalle',
    'detallecompensacionventa.fk_detallecompensacionventa_producto',
    'detallecompensacionventa.fk_detallecompensacionventa_movimiento',
    'detallecompensacionlote.fk_detallecompensacionlote_detalle',
    'detallecompensacionlote.fk_detallecompensacionlote_salida',
    'detallecompensacionlote.fk_detallecompensacionlote_lote_origen',
    'detallecompensacionlote.fk_detallecompensacionlote_lote_destino',
    'detallecompensacionlote.fk_detallecompensacionlote_movimiento'
  ];
  const structureComplete = REQUIRED_TABLES.every(
    (table) => tables.get(table.toLowerCase()) === 'innodb'
  )
    && requiredColumns.every((column) => columns.has(column))
    && requiredIndexes.every((index) => indexes.has(index))
    && requiredConstraints.every((constraint) => constraints.has(constraint));
  let data = {
    operacionesInvalidas: null,
    devolucionesExcedidas: null,
    liquidacionesInvalidas: null,
    inventarioInvalido: null,
    lotesInvalidos: null,
    referenciasCruzadas: null
  };
  if (structureComplete) {
    const [[row]] = await connection.query(
      `SELECT
         (
           SELECT COUNT(*) FROM compensacionVenta cv
           JOIN operacionCompensatoria oc
             ON oc.idTienda=cv.idTienda
            AND oc.idOperacionCompensatoria=cv.idOperacionCompensatoria
           WHERE oc.estado<>'aplicada'
              OR (cv.tipoCompensacion='anulacion_total' AND oc.tipoOperacion<>'anulacion_venta')
              OR (cv.tipoCompensacion='devolucion_parcial' AND oc.tipoOperacion<>'devolucion_venta')
         ) operacionesInvalidas,
         (
           SELECT COUNT(*) FROM (
             SELECT dcv.idTienda, dcv.idDetalleVenta
             FROM detalleCompensacionVenta dcv
             JOIN detalleVenta dv
               ON dv.idTienda=dcv.idTienda
              AND dv.idDetalleVenta=dcv.idDetalleVenta
             GROUP BY dcv.idTienda, dcv.idDetalleVenta, dv.cantidadEquivalenteUnidades
             HAVING SUM(dcv.unidadesDevueltas)>dv.cantidadEquivalenteUnidades
           ) excesos
         ) devolucionesExcedidas,
         (
           SELECT COUNT(*) FROM liquidacionCompensacionVenta
           WHERE montoCompensado<0
              OR montoReduccionDeudaPendiente<0
              OR montoReembolsoPendiente<0
              OR ABS(
                montoCompensado
                - montoReduccionDeudaPendiente
                - montoReembolsoPendiente
              )>=0.01
              OR (estado='sin_efecto' AND montoCompensado<>0)
              OR (estado='pendiente_c3' AND montoCompensado<=0)
              OR (estado='resuelta' AND resueltoEn IS NULL)
         ) liquidacionesInvalidas,
         (
           SELECT COUNT(*) FROM detalleCompensacionVenta
           WHERE unidadesDevueltas<=0
              OR (
                resultadoInventario IN ('no_reintegrado','aislado_no_vendible')
                AND idMovimientoStock IS NOT NULL
              )
              OR (
                resultadoInventario NOT IN ('no_reintegrado','aislado_no_vendible')
                AND idMovimientoStock IS NULL
              )
         ) inventarioInvalido,
         (
           SELECT COUNT(*) FROM detalleCompensacionLote
           WHERE unidadesDevueltas<=0
              OR (
                resultadoInventario='no_reintegrado'
                AND (idLoteProductoDestino IS NOT NULL OR idMovimientoLoteCompensatorio IS NOT NULL)
              )
              OR (
                resultadoInventario<>'no_reintegrado'
                AND (idLoteProductoDestino IS NULL OR idMovimientoLoteCompensatorio IS NULL)
              )
         ) lotesInvalidos,
         (
           SELECT COUNT(*) FROM compensacionVenta cv
           LEFT JOIN venta v
             ON v.idTienda=cv.idTienda AND v.idVenta=cv.idVenta
           LEFT JOIN operacionCompensatoria oc
             ON oc.idTienda=cv.idTienda
            AND oc.idOperacionCompensatoria=cv.idOperacionCompensatoria
           WHERE v.idVenta IS NULL OR oc.idOperacionCompensatoria IS NULL
         ) referenciasCruzadas`
    );
    data = Object.fromEntries(Object.entries(row).map(([key, value]) => [key, Number(value)]));
  }
  const dataValid = structureComplete && Object.values(data).every((value) => value === 0);
  return {
    migration: MIGRATION,
    state: structureComplete && dataValid
      ? (migrationRegistered ? 'post-migracion' : 'completa-no-registrada')
      : migrationRegistered ? 'inconsistente' : 'pre-migracion',
    migrationRegistered,
    tables: Object.fromEntries(REQUIRED_TABLES.map((table) => [
      table,
      tables.get(table.toLowerCase()) === 'innodb'
    ])),
    structureComplete,
    dataValid,
    data
  };
}

async function main() {
  const config = requireLocalhostDatabase('La comprobacion de compensaciones de venta');
  logDatabaseTarget('Comprobacion de compensaciones de venta', config);
  const connection = await createDatabaseConnection(config);
  try {
    const state = await inspectSalesCompensations(connection);
    console.log(JSON.stringify(state, null, 2));
    if (!state.structureComplete || !state.dataValid) process.exitCode = 1;
  } finally {
    await connection.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error('No se pudo comprobar la estructura de compensaciones de venta.');
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = {
  MIGRATION,
  inspectSalesCompensations
};
