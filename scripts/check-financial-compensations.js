const { logDatabaseTarget, requireLocalhostDatabase } = require('../config/env');
const { createDatabaseConnection } = require('../config/database-connection');

const MIGRATION = '016_compensaciones_financieras.sql';
const REQUIRED_TABLES = Object.freeze([
  'resolucionLiquidacionVenta',
  'obligacionReembolsoVenta',
  'detalleObligacionReembolsoPago',
  'compensacionCobroFiado',
  'detalleCompensacionCobro',
  'compensacionPagoVenta'
]);

function normalized(value) {
  return String(value || '').toLowerCase();
}

async function metadataSet(connection, select, source) {
  const [rows] = await connection.query(
    `SELECT ${select} nombre
     FROM information_schema.${source}
     WHERE TABLE_SCHEMA=DATABASE()`
  );
  return new Set(rows.map((row) => normalized(row.nombre)));
}

async function inspectFinancialCompensations(connection) {
  const [tableRows] = await connection.query(
    `SELECT TABLE_NAME nombre, ENGINE motor
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA=DATABASE()`
  );
  const tables = new Map(tableRows.map((row) => [
    normalized(row.nombre),
    normalized(row.motor)
  ]));
  const columns = await metadataSet(
    connection,
    'CONCAT(LOWER(TABLE_NAME), ".", LOWER(COLUMN_NAME))',
    'COLUMNS'
  );
  const indexes = await metadataSet(
    connection,
    'CONCAT(LOWER(TABLE_NAME), ".", LOWER(INDEX_NAME))',
    'STATISTICS'
  );
  const constraints = await metadataSet(
    connection,
    'CONCAT(LOWER(TABLE_NAME), ".", LOWER(CONSTRAINT_NAME))',
    'TABLE_CONSTRAINTS'
  );
  const [[migration]] = tables.has('schema_migrations')
    ? await connection.query(
      'SELECT COUNT(*) total FROM schema_migrations WHERE nombre=?',
      [MIGRATION]
    )
    : [[{ total: 0 }]];
  const requiredColumns = [
    'venta.montocompensado',
    'fiado.totalcompensado',
    'cobrofiado.estadooperacion',
    'resolucionliquidacionventa.idliquidacioncompensacionventa',
    'resolucionliquidacionventa.montoreducciondeuda',
    'resolucionliquidacionventa.montoreembolso',
    'obligacionreembolsoventa.estado',
    'detalleobligacionreembolsopago.idpagoventa',
    'detalleobligacionreembolsopago.metodooriginal',
    'compensacioncobrofiado.tipocompensacion',
    'compensacioncobrofiado.metododestino',
    'detallecompensacioncobro.idpagofiadO',
    'detallecompensacioncobro.idpagoventa',
    'compensacionpagoventa.metododestino'
  ].map(normalized);
  const requiredIndexes = [
    'pagoventa.uq_pagoventa_tienda_id',
    'resolucionliquidacionventa.uq_resolucionliquidacion_tienda_operacion',
    'resolucionliquidacionventa.uq_resolucionliquidacion_tienda_liquidacion',
    'obligacionreembolsoventa.uq_obligacionreembolso_tienda_resolucion',
    'detalleobligacionreembolsopago.uq_detallereembolso_tienda_pago',
    'compensacioncobrofiado.uq_compensacioncobro_tienda_operacion',
    'compensacioncobrofiado.uq_compensacioncobro_tienda_tipo',
    'detallecompensacioncobro.uq_detallecompensacioncobro_tienda_pago_fiado',
    'compensacionpagoventa.uq_compensacionpago_tienda_pago'
  ];
  const requiredConstraints = [
    'venta.chk_venta_saldo_pos',
    'venta.chk_venta_estado_pos',
    'venta.chk_venta_monto_compensado',
    'fiado.chk_fiado_compensacion_financiera',
    'cobrofiado.chk_cobrofiado_estado_operacion',
    'resolucionliquidacionventa.fk_resolucionliquidacion_operacion',
    'resolucionliquidacionventa.fk_resolucionliquidacion_liquidacion',
    'obligacionreembolsoventa.fk_obligacionreembolso_resolucion',
    'detalleobligacionreembolsopago.fk_detallereembolso_obligacion',
    'detalleobligacionreembolsopago.fk_detallereembolso_pago',
    'compensacioncobrofiado.fk_compensacioncobro_cobro',
    'detallecompensacioncobro.fk_detallecompensacioncobro_pago_fiado',
    'detallecompensacioncobro.fk_detallecompensacioncobro_pago_venta',
    'compensacionpagoventa.fk_compensacionpago_pago'
  ];
  const structureComplete = REQUIRED_TABLES.every(
    (table) => tables.get(normalized(table)) === 'innodb'
  )
    && requiredColumns.every((column) => columns.has(column))
    && requiredIndexes.every((index) => indexes.has(index))
    && requiredConstraints.every((constraint) => constraints.has(constraint));

  let data = {
    ventasInvalidas: null,
    fiadosInvalidos: null,
    liquidacionesInvalidas: null,
    reembolsosInvalidos: null,
    cobrosInvalidos: null,
    distribucionesInvalidas: null,
    metodosInvalidos: null
  };
  if (structureComplete) {
    const [[row]] = await connection.query(
      `SELECT
         (
           SELECT COUNT(*) FROM venta
           WHERE montoCompensado<0 OR montoCompensado>total+0.01
              OR saldoPendiente<0
              OR ABS(saldoPendiente-GREATEST(total-montoPagado-montoCompensado, 0))>=0.01
         ) ventasInvalidas,
         (
           SELECT COUNT(*) FROM fiado
           WHERE totalCompensado<0 OR saldoPendiente<0
              OR totalPagado+totalCompensado>totalFiado+0.01
              OR ABS(saldoPendiente-(totalFiado-totalPagado-totalCompensado))>=0.01
         ) fiadosInvalidos,
         (
           SELECT COUNT(*) FROM resolucionLiquidacionVenta rlv
           JOIN liquidacionCompensacionVenta lcv
             ON lcv.idTienda=rlv.idTienda
            AND lcv.idLiquidacionCompensacionVenta=rlv.idLiquidacionCompensacionVenta
           JOIN operacionCompensatoria oc
             ON oc.idTienda=rlv.idTienda
            AND oc.idOperacionCompensatoria=rlv.idOperacionCompensatoria
           WHERE lcv.estado<>'resuelta' OR oc.estado<>'aplicada'
              OR ABS(lcv.montoCompensado-rlv.montoReduccionDeuda-rlv.montoReembolso)>=0.01
         ) liquidacionesInvalidas,
         (
           SELECT COUNT(*) FROM (
             SELECT ore.idTienda, ore.idObligacionReembolsoVenta, ore.monto,
                    COALESCE(SUM(dorp.monto),0) distribuido
             FROM obligacionReembolsoVenta ore
             LEFT JOIN detalleObligacionReembolsoPago dorp
               ON dorp.idTienda=ore.idTienda
              AND dorp.idObligacionReembolsoVenta=ore.idObligacionReembolsoVenta
             GROUP BY ore.idTienda, ore.idObligacionReembolsoVenta, ore.monto
             HAVING ABS(ore.monto-distribuido)>=0.01
           ) diferencias
         ) reembolsosInvalidos,
         (
           SELECT COUNT(*) FROM compensacionCobroFiado ccf
           JOIN cobroFiado cf
             ON cf.idTienda=ccf.idTienda AND cf.idCobroFiado=ccf.idCobroFiado
           JOIN operacionCompensatoria oc
             ON oc.idTienda=ccf.idTienda
            AND oc.idOperacionCompensatoria=ccf.idOperacionCompensatoria
           WHERE oc.estado<>'aplicada'
              OR (
                ccf.tipoCompensacion='anulacion_total'
                AND cf.estadoOperacion<>'compensado'
              )
         ) cobrosInvalidos,
         (
           SELECT COUNT(*) FROM (
             SELECT ccf.idTienda, ccf.idCompensacionCobroFiado,
                    ccf.montoCompensado,
                    COALESCE(SUM(dcc.montoCompensado),0) distribuido
             FROM compensacionCobroFiado ccf
             LEFT JOIN detalleCompensacionCobro dcc
               ON dcc.idTienda=ccf.idTienda
              AND dcc.idCompensacionCobroFiado=ccf.idCompensacionCobroFiado
             WHERE ccf.tipoCompensacion='anulacion_total'
             GROUP BY ccf.idTienda, ccf.idCompensacionCobroFiado, ccf.montoCompensado
             HAVING ABS(ccf.montoCompensado-distribuido)>=0.01
           ) diferencias
         ) distribucionesInvalidas,
         (
           SELECT COUNT(*) FROM compensacionPagoVenta cpv
           JOIN operacionCompensatoria oc
             ON oc.idTienda=cpv.idTienda
            AND oc.idOperacionCompensatoria=cpv.idOperacionCompensatoria
           WHERE oc.estado<>'aplicada' OR cpv.metodoOriginal=cpv.metodoDestino
         ) metodosInvalidos`
    );
    data = Object.fromEntries(
      Object.entries(row).map(([key, value]) => [key, Number(value)])
    );
  }
  const dataValid = structureComplete
    && Object.values(data).every((value) => value === 0);
  const migrationRegistered = Number(migration.total) === 1;
  return {
    migracion: MIGRATION,
    estado: structureComplete && dataValid
      ? (migrationRegistered ? 'post-migracion' : 'completa-no-registrada')
      : migrationRegistered ? 'inconsistente' : 'pre-migracion',
    migracionRegistrada: migrationRegistered,
    estructuraCompleta: structureComplete,
    datosValidos: dataValid,
    tablas: Object.fromEntries(
      REQUIRED_TABLES.map((table) => [table, tables.get(normalized(table)) === 'innodb'])
    ),
    datos: data
  };
}

async function main() {
  const config = requireLocalhostDatabase('La comprobacion financiera compensatoria');
  logDatabaseTarget('Comprobacion financiera compensatoria', config);
  const connection = await createDatabaseConnection(config);
  try {
    const state = await inspectFinancialCompensations(connection);
    console.log(JSON.stringify(state, null, 2));
    if (!state.estructuraCompleta || !state.datosValidos) process.exitCode = 1;
  } finally {
    await connection.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error('No se pudo comprobar la estructura financiera compensatoria.');
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = {
  MIGRATION,
  inspectFinancialCompensations
};
