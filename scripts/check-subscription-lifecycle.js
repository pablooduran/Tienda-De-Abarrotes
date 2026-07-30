const { createDatabaseConnection } = require('../config/database-connection');
const { databaseConfig, databaseTarget } = require('../config/env');

const MIGRATION = '022_ciclo_vida_suscripciones.sql';
const TABLES = Object.freeze([
  'suscripcionTienda',
  'suscripcionFuncionalidadSnapshot',
  'historialSuscripcionTienda',
  'operacionSuscripcionTienda'
]);
const SUBSCRIPTION_COLUMNS = Object.freeze([
  'fechaFinGracia',
  'suspendidaEn',
  'reactivadaEn',
  'canceladaEn',
  'motivoTransicion',
  'idPlanSiguiente',
  'fechaAplicacionPlanSiguiente',
  'planCodigoSnapshot',
  'planNombreSnapshot',
  'tipoPeriodoSnapshot',
  'duracionDiasSnapshot',
  'precioReferenciaSnapshot',
  'limitePropietariosSnapshot',
  'limiteProductosSnapshot',
  'limiteClientesSnapshot',
  'limiteProveedoresSnapshot'
]);
const REQUIRED_INDEXES = Object.freeze([
  ['suscripcionTienda', 'uq_suscripcion_tienda_id'],
  ['suscripcionTienda', 'idx_suscripcion_tienda_gracia'],
  ['suscripcionTienda', 'idx_suscripcion_plan_siguiente'],
  ['suscripcionFuncionalidadSnapshot', 'idx_suscripcionFuncionalidad_codigo'],
  ['historialSuscripcionTienda', 'idx_historialSuscripcion_tienda_fecha'],
  ['historialSuscripcionTienda', 'idx_historialSuscripcion_suscripcion_fecha'],
  ['operacionSuscripcionTienda', 'uq_operacionSuscripcion_clave'],
  ['operacionSuscripcionTienda', 'idx_operacionSuscripcion_estado_expira']
]);
const REQUIRED_CONSTRAINTS = Object.freeze([
  ['suscripcionTienda', 'chk_suscripcion_fechas_ciclo'],
  ['suscripcionTienda', 'chk_suscripcion_plan_siguiente'],
  ['suscripcionTienda', 'chk_suscripcion_snapshot'],
  ['suscripcionTienda', 'fk_suscripcion_plan_siguiente'],
  ['suscripcionFuncionalidadSnapshot', 'chk_suscripcionFuncionalidad_codigo'],
  ['suscripcionFuncionalidadSnapshot', 'fk_suscripcionFuncionalidad_suscripcion'],
  ['historialSuscripcionTienda', 'chk_historialSuscripcion_actor'],
  ['historialSuscripcionTienda', 'fk_historialSuscripcion_suscripcion'],
  ['historialSuscripcionTienda', 'fk_historialSuscripcion_actor'],
  ['operacionSuscripcionTienda', 'chk_operacionSuscripcion_hashes'],
  ['operacionSuscripcionTienda', 'chk_operacionSuscripcion_fechas'],
  ['operacionSuscripcionTienda', 'fk_operacionSuscripcion_tienda'],
  ['operacionSuscripcionTienda', 'fk_operacionSuscripcion_resultado'],
  ['operacionSuscripcionTienda', 'fk_operacionSuscripcion_historial']
]);

async function existingNames(connection, table, source, column) {
  const [rows] = await connection.query(
    `SELECT ${column} nombre FROM information_schema.${source}
     WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?`,
    [table]
  );
  return new Set(rows.map((row) => row.nombre));
}

async function inspectSubscriptionLifecycle(connection) {
  const [[migration]] = await connection.query(
    'SELECT COUNT(*) total FROM schema_migrations WHERE nombre=?',
    [MIGRATION]
  );
  const [tableRows] = await connection.query(
    `SELECT TABLE_NAME FROM information_schema.TABLES
     WHERE TABLE_SCHEMA=DATABASE() AND LOWER(TABLE_NAME) IN (?)`,
    [TABLES.map((table) => table.toLowerCase())]
  );
  const tableNames = new Set(tableRows.map((row) => String(row.TABLE_NAME).toLowerCase()));
  const tables = Object.fromEntries(
    TABLES.map((table) => [table, tableNames.has(table.toLowerCase())])
  );
  if (!Object.values(tables).every(Boolean)) {
    return {
      migration: Number(migration.total),
      tables,
      columns: false,
      indexes: false,
      constraints: false,
      subscriptions: null,
      missingSnapshots: null,
      invalidSubscriptions: null,
      orphanFeatures: null,
      invalidHistory: null,
      invalidOperations: null,
      operationalOverlaps: null
    };
  }

  const columns = await existingNames(connection, 'suscripcionTienda', 'COLUMNS', 'COLUMN_NAME');
  let indexesComplete = true;
  for (const [table, name] of REQUIRED_INDEXES) {
    const indexes = await existingNames(connection, table, 'STATISTICS', 'INDEX_NAME');
    if (!indexes.has(name)) indexesComplete = false;
  }
  let constraintsComplete = true;
  for (const [table, name] of REQUIRED_CONSTRAINTS) {
    const constraints = await existingNames(
      connection,
      table,
      'TABLE_CONSTRAINTS',
      'CONSTRAINT_NAME'
    );
    if (!constraints.has(name)) constraintsComplete = false;
  }
  const [[counts]] = await connection.query(
    `SELECT
       (SELECT COUNT(*) FROM suscripcionTienda) subscriptions,
       (SELECT COUNT(*) FROM suscripcionTienda
        WHERE planCodigoSnapshot IS NULL
           OR planNombreSnapshot IS NULL
           OR tipoPeriodoSnapshot IS NULL
           OR duracionDiasSnapshot<1
           OR precioReferenciaSnapshot<0
       ) missingSnapshots,
       (SELECT COUNT(*) FROM suscripcionTienda
        WHERE fechaFin<=fechaInicio
           OR (fechaFinGracia IS NOT NULL AND fechaFinGracia<=fechaFin)
           OR (estado='gracia' AND fechaFinGracia IS NULL)
           OR ((idPlanSiguiente IS NULL)<>(fechaAplicacionPlanSiguiente IS NULL))
       ) invalidSubscriptions,
       (SELECT COUNT(*) FROM suscripcionFuncionalidadSnapshot sf
        LEFT JOIN suscripcionTienda s
          ON s.idTienda=sf.idTienda AND s.idSuscripcion=sf.idSuscripcion
        WHERE s.idSuscripcion IS NULL
       ) orphanFeatures,
       (SELECT COUNT(*) FROM historialSuscripcionTienda h
        LEFT JOIN suscripcionTienda s
          ON s.idTienda=h.idTienda AND s.idSuscripcion=h.idSuscripcion
        WHERE s.idSuscripcion IS NULL
           OR (h.actorTipo='administrador' AND h.idAdministradorActor IS NULL)
           OR (h.actorTipo<>'administrador' AND h.idAdministradorActor IS NOT NULL)
       ) invalidHistory,
       (SELECT COUNT(*) FROM operacionSuscripcionTienda
        WHERE claveHash NOT REGEXP '^[0-9a-f]{64}$'
           OR huellaSolicitud NOT REGEXP '^[0-9a-f]{64}$'
       ) invalidOperations,
       (SELECT COUNT(*) FROM suscripcionTienda a
        JOIN suscripcionTienda b
          ON b.idTienda=a.idTienda AND b.idSuscripcion>a.idSuscripcion
        WHERE a.estado IN ('pendiente','activa','gracia')
          AND b.estado IN ('pendiente','activa','gracia')
          AND a.fechaInicio<b.fechaFin AND b.fechaInicio<a.fechaFin
       ) operationalOverlaps`
  );
  return {
    migration: Number(migration.total),
    tables,
    columns: SUBSCRIPTION_COLUMNS.every((column) => columns.has(column)),
    indexes: indexesComplete,
    constraints: constraintsComplete,
    subscriptions: Number(counts.subscriptions),
    missingSnapshots: Number(counts.missingSnapshots),
    invalidSubscriptions: Number(counts.invalidSubscriptions),
    orphanFeatures: Number(counts.orphanFeatures),
    invalidHistory: Number(counts.invalidHistory),
    invalidOperations: Number(counts.invalidOperations),
    operationalOverlaps: Number(counts.operationalOverlaps)
  };
}

async function main() {
  const config = databaseConfig();
  const connection = await createDatabaseConnection(config);
  try {
    const state = await inspectSubscriptionLifecycle(connection);
    if (state.migration !== 1
      || !Object.values(state.tables).every(Boolean)
      || !state.columns
      || !state.indexes
      || !state.constraints
      || state.missingSnapshots !== 0
      || state.invalidSubscriptions !== 0
      || state.orphanFeatures !== 0
      || state.invalidHistory !== 0
      || state.invalidOperations !== 0
      || state.operationalOverlaps !== 0) {
      throw new Error('El ciclo de vida de suscripciones esta incompleto o inconsistente.');
    }
    console.log(JSON.stringify({
      destino: databaseTarget(config),
      migracion: MIGRATION,
      suscripciones: state.subscriptions,
      estado: 'SUBSCRIPTION_LIFECYCLE_OK'
    }, null, 2));
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
  REQUIRED_CONSTRAINTS,
  REQUIRED_INDEXES,
  SUBSCRIPTION_COLUMNS,
  TABLES,
  inspectSubscriptionLifecycle
};
