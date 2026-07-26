const { logDatabaseTarget, requireLocalhostDatabase } = require('../config/env');
const { createDatabaseConnection } = require('../config/database-connection');

const MIGRATION = '017_integracion_compensaciones.sql';
const REQUIRED_COLUMNS = Object.freeze({
  movimientoLiquidacionCompensacion: [
    'idMovimientoLiquidacionCompensacion',
    'idTienda',
    'idOperacionCompensatoria',
    'idObligacionReembolsoVenta',
    'tipoLiquidacion',
    'metodoLiquidacion',
    'monto',
    'referencia',
    'observacion',
    'periodoOriginalCerrado',
    'fechaMovimiento',
    'idAdministrador'
  ],
  cierreCaja: [
    'compensacionesEfectivo',
    'reembolsosEfectivo',
    'compensacionesCobroTotal',
    'reembolsosTotal',
    'compensacionesVenta',
    'liquidacionesOtroMedio'
  ]
});

function normalized(value) {
  return String(value || '').toLowerCase();
}

async function inspectCompensationIntegration(connection) {
  const [tables] = await connection.query(
    `SELECT TABLE_NAME, ENGINE
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA=DATABASE()`
  );
  const tableMap = new Map(tables.map((row) => [
    normalized(row.TABLE_NAME),
    normalized(row.ENGINE)
  ]));
  const [columns] = await connection.query(
    `SELECT TABLE_NAME, COLUMN_NAME
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA=DATABASE()`
  );
  const columnSet = new Set(columns.map((row) =>
    `${normalized(row.TABLE_NAME)}.${normalized(row.COLUMN_NAME)}`));
  const [indexes] = await connection.query(
    `SELECT TABLE_NAME, INDEX_NAME
     FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA=DATABASE()`
  );
  const indexSet = new Set(indexes.map((row) =>
    `${normalized(row.TABLE_NAME)}.${normalized(row.INDEX_NAME)}`));
  const [constraints] = await connection.query(
    `SELECT TABLE_NAME, CONSTRAINT_NAME
     FROM information_schema.TABLE_CONSTRAINTS
     WHERE CONSTRAINT_SCHEMA=DATABASE()`
  );
  const constraintSet = new Set(constraints.map((row) =>
    `${normalized(row.TABLE_NAME)}.${normalized(row.CONSTRAINT_NAME)}`));
  const [[migration]] = tableMap.has('schema_migrations')
    ? await connection.query(
      'SELECT COUNT(*) total FROM schema_migrations WHERE nombre=?',
      [MIGRATION]
    )
    : [[{ total: 0 }]];
  const structureComplete = tableMap.get('movimientoliquidacioncompensacion')
      === 'innodb'
    && Object.entries(REQUIRED_COLUMNS).every(([table, names]) =>
      names.every((name) => columnSet.has(
        `${normalized(table)}.${normalized(name)}`
      )))
    && [
      'uq_movimientoLiquidacion_tienda_operacion',
      'idx_movimientoLiquidacion_tienda_obligacion',
      'idx_movimientoLiquidacion_tienda_fecha_metodo'
    ].every((name) => indexSet.has(
      `movimientoliquidacioncompensacion.${normalized(name)}`
    ))
    && [
      'chk_movimientoLiquidacion_monto',
      'chk_movimientoLiquidacion_periodo',
      'chk_movimientoLiquidacion_referencia',
      'fk_movimientoLiquidacion_operacion',
      'fk_movimientoLiquidacion_obligacion',
      'fk_movimientoLiquidacion_administrador'
    ].every((name) => constraintSet.has(
      `movimientoliquidacioncompensacion.${normalized(name)}`
    ))
    && constraintSet.has('cierrecaja.chk_cierrecaja_compensaciones');
  const structureAbsent = !tableMap.has('movimientoliquidacioncompensacion')
    && REQUIRED_COLUMNS.cierreCaja.every((name) => !columnSet.has(
      `cierrecaja.${normalized(name)}`
    ))
    && ![...indexSet].some((key) =>
      key.startsWith('movimientoliquidacioncompensacion.'))
    && ![...constraintSet].some((key) =>
      key.startsWith('movimientoliquidacioncompensacion.')
      || key === 'cierrecaja.chk_cierrecaja_compensaciones');

  let data = {
    obligacionesExcedidas: null,
    obligacionesFinalesIncompletas: null,
    obligacionesPendientesCubiertas: null,
    operacionesNoAplicadas: null,
    cierresInvalidos: null
  };
  if (structureComplete) {
    const [[row]] = await connection.query(
      `SELECT
       (
         SELECT COUNT(*) FROM (
           SELECT ore.idTienda, ore.idObligacionReembolsoVenta, ore.monto,
                  COALESCE(SUM(mlc.monto),0) liquidado
           FROM obligacionReembolsoVenta ore
           LEFT JOIN movimientoLiquidacionCompensacion mlc
             ON mlc.idTienda=ore.idTienda
            AND mlc.idObligacionReembolsoVenta=ore.idObligacionReembolsoVenta
           GROUP BY ore.idTienda, ore.idObligacionReembolsoVenta, ore.monto
           HAVING liquidado>ore.monto+0.01
         ) excesos
       ) obligacionesExcedidas,
       (
         SELECT COUNT(*) FROM (
           SELECT ore.idTienda, ore.idObligacionReembolsoVenta,
                  ore.monto, ore.estado, COALESCE(SUM(mlc.monto),0) liquidado
           FROM obligacionReembolsoVenta ore
           LEFT JOIN movimientoLiquidacionCompensacion mlc
             ON mlc.idTienda=ore.idTienda
            AND mlc.idObligacionReembolsoVenta=ore.idObligacionReembolsoVenta
           WHERE ore.estado IN ('reembolsado','compensado')
           GROUP BY ore.idTienda, ore.idObligacionReembolsoVenta,
                    ore.monto, ore.estado
           HAVING ABS(liquidado-ore.monto)>=0.01
         ) incompletas
       ) obligacionesFinalesIncompletas,
       (
         SELECT COUNT(*) FROM (
           SELECT ore.idTienda, ore.idObligacionReembolsoVenta,
                  ore.monto, COALESCE(SUM(mlc.monto),0) liquidado
           FROM obligacionReembolsoVenta ore
           LEFT JOIN movimientoLiquidacionCompensacion mlc
             ON mlc.idTienda=ore.idTienda
            AND mlc.idObligacionReembolsoVenta=ore.idObligacionReembolsoVenta
           WHERE ore.estado='pendiente'
           GROUP BY ore.idTienda, ore.idObligacionReembolsoVenta, ore.monto
           HAVING liquidado>=ore.monto-0.01
         ) cubiertas
       ) obligacionesPendientesCubiertas,
       (
         SELECT COUNT(*)
         FROM movimientoLiquidacionCompensacion mlc
         JOIN operacionCompensatoria oc
           ON oc.idTienda=mlc.idTienda
          AND oc.idOperacionCompensatoria=mlc.idOperacionCompensatoria
         WHERE oc.estado<>'aplicada'
       ) operacionesNoAplicadas,
       (
         SELECT COUNT(*) FROM cierreCaja
         WHERE compensacionesEfectivo<0 OR reembolsosEfectivo<0
            OR compensacionesCobroTotal<0 OR reembolsosTotal<0
            OR compensacionesVenta<0 OR liquidacionesOtroMedio<0
       ) cierresInvalidos`
    );
    data = Object.fromEntries(
      Object.entries(row).map(([key, value]) => [key, Number(value)])
    );
  }
  const dataValid = structureComplete
    ? Object.values(data).every((value) => value === 0)
    : null;
  const migrationRegistered = Number(migration.total) === 1;
  const state = structureComplete && dataValid
    ? (migrationRegistered ? 'post-migracion' : 'completa-no-registrada')
    : (!migrationRegistered && structureAbsent)
      ? 'pre-migracion'
      : 'inconsistente';
  return {
    migracion: MIGRATION,
    estado: state,
    migracionRegistrada: migrationRegistered,
    estructuraCompleta: structureComplete,
    datosValidos: dataValid,
    datos: data
  };
}

async function main() {
  const config = requireLocalhostDatabase('La comprobacion de integracion compensatoria');
  logDatabaseTarget('Comprobacion de integracion compensatoria', config);
  const connection = await createDatabaseConnection(config);
  try {
    const state = await inspectCompensationIntegration(connection);
    console.log(JSON.stringify(state, null, 2));
    if (!['pre-migracion', 'post-migracion'].includes(state.estado)) {
      process.exitCode = 1;
    }
  } finally {
    await connection.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error('No se pudo comprobar la integracion compensatoria.');
    if (process.env.APP_ENV !== 'production') console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { inspectCompensationIntegration };
