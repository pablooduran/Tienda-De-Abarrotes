const { createDatabaseConnection } = require('../config/database-connection');
const { databaseConfig, databaseTarget } = require('../config/env');
const {
  BASIC_FEATURES,
  EXCLUDED_PUBLIC_FEATURES,
  PLAN_CATALOG,
  PRO_FEATURES,
  STANDARD_FEATURES
} = require('../config/saas-c-payment-contract');

const MIGRATION = '023_estructura_pagos_suscripcion.sql';
const TABLES = Object.freeze([
  'precioPlanPeriodo',
  'tipoCambioSuscripcion',
  'metodoPagoSuscripcion',
  'solicitudPagoSuscripcion',
  'solicitudPagoFuncionalidadSnapshot',
  'comprobantePagoSuscripcion',
  'revisionPagoSuscripcion',
  'historialSolicitudPagoSuscripcion',
  'aplicacionPagoSuscripcion',
  'operacionPagoSuscripcion'
]);
const PLAN_COLUMNS = Object.freeze(['visiblePublicamente', 'esLegado', 'ordenComercial']);
const REQUIRED_INDEXES = Object.freeze([
  ['plan', 'idx_plan_catalogo_publico'],
  ['precioPlanPeriodo', 'uq_precioPlan_version'],
  ['precioPlanPeriodo', 'uq_precioPlan_activo'],
  ['tipoCambioSuscripcion', 'uq_tipoCambio_activo'],
  ['solicitudPagoSuscripcion', 'uq_solicitudPago_abierta'],
  ['solicitudPagoSuscripcion', 'idx_solicitudPago_cola'],
  ['comprobantePagoSuscripcion', 'uq_comprobantePago_version'],
  ['comprobantePagoSuscripcion', 'uq_comprobantePago_activo'],
  ['aplicacionPagoSuscripcion', 'uq_aplicacionPago_solicitud'],
  ['operacionPagoSuscripcion', 'uq_operacionPago_clave']
]);
const REQUIRED_CONSTRAINTS = Object.freeze([
  ['plan', 'chk_plan_presentacion'],
  ['precioPlanPeriodo', 'chk_precioPlan_valores'],
  ['precioPlanPeriodo', 'fk_precioPlan_plan'],
  ['tipoCambioSuscripcion', 'chk_tipoCambio_valores'],
  ['metodoPagoSuscripcion', 'chk_metodoPago_flags'],
  ['solicitudPagoSuscripcion', 'chk_solicitudPago_importes'],
  ['solicitudPagoSuscripcion', 'fk_solicitudPago_suscripcion'],
  ['solicitudPagoSuscripcion', 'fk_solicitudPago_precio'],
  ['solicitudPagoFuncionalidadSnapshot', 'fk_solicitudPagoFuncion_solicitud'],
  ['comprobantePagoSuscripcion', 'chk_comprobantePago_archivo'],
  ['comprobantePagoSuscripcion', 'fk_comprobantePago_solicitud'],
  ['revisionPagoSuscripcion', 'fk_revisionPago_solicitud'],
  ['historialSolicitudPagoSuscripcion', 'chk_historialSolicitudPago_actor'],
  ['aplicacionPagoSuscripcion', 'fk_aplicacionPago_solicitud'],
  ['aplicacionPagoSuscripcion', 'fk_aplicacionPago_operacion'],
  ['operacionPagoSuscripcion', 'chk_operacionPago_hashes'],
  ['operacionPagoSuscripcion', 'fk_operacionPago_solicitud']
]);

async function existingNames(connection, table, source, column) {
  const [rows] = await connection.query(
    `SELECT ${column} nombre FROM information_schema.${source}
     WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?`,
    [table]
  );
  return new Set(rows.map((row) => String(row.nombre)));
}

async function inspectSaasC(connection) {
  const [[migration]] = await connection.query(
    'SELECT COUNT(*) total FROM schema_migrations WHERE nombre=?',
    [MIGRATION]
  );
  const [tableRows] = await connection.query(
    `SELECT TABLE_NAME FROM information_schema.TABLES
     WHERE TABLE_SCHEMA=DATABASE() AND LOWER(TABLE_NAME) IN (?)`,
    [TABLES.map((table) => table.toLowerCase())]
  );
  const existingTables = new Set(
    tableRows.map((row) => String(row.TABLE_NAME).toLowerCase())
  );
  const tables = Object.fromEntries(
    TABLES.map((table) => [table, existingTables.has(table.toLowerCase())])
  );
  if (!Object.values(tables).every(Boolean)) {
    return { migration: Number(migration.total), tables, complete: false };
  }

  const planColumns = await existingNames(connection, 'plan', 'COLUMNS', 'COLUMN_NAME');
  let indexes = true;
  for (const [table, name] of REQUIRED_INDEXES) {
    const names = await existingNames(connection, table, 'STATISTICS', 'INDEX_NAME');
    if (!names.has(name)) indexes = false;
  }
  let constraints = true;
  for (const [table, name] of REQUIRED_CONSTRAINTS) {
    const names = await existingNames(connection, table, 'TABLE_CONSTRAINTS', 'CONSTRAINT_NAME');
    if (!names.has(name)) constraints = false;
  }

  const [plans] = await connection.query(
    `SELECT codigo,nombre,activo,visiblePublicamente,esLegado,ordenComercial,
            precioMensual,limitePropietarios,limiteProductos,limiteClientes,
            limiteProveedores
     FROM plan WHERE codigo IN ('basico','standard','pro','avanzado')`
  );
  const planMap = new Map(plans.map((plan) => [plan.codigo, plan]));
  const [featureRows] = await connection.query(
    `SELECT p.codigo,COUNT(*) total
     FROM plan p
     JOIN planFuncionalidad pf ON pf.idPlan=p.idPlan AND pf.habilitada=1
     JOIN funcionalidad f ON f.idFuncionalidad=pf.idFuncionalidad AND f.activo=1
     WHERE p.codigo IN ('basico','standard','pro')
     GROUP BY p.codigo`
  );
  const featureCounts = Object.fromEntries(
    featureRows.map((row) => [row.codigo, Number(row.total)])
  );
  const [[counts]] = await connection.query(
    `SELECT
      (SELECT COUNT(*) FROM precioPlanPeriodo) prices,
      (SELECT COUNT(*) FROM tipoCambioSuscripcion) rates,
      (SELECT COUNT(*) FROM metodoPagoSuscripcion) methods,
      (SELECT COUNT(*) FROM solicitudPagoSuscripcion) requests,
      (SELECT COUNT(*) FROM comprobantePagoSuscripcion) receipts,
      (SELECT COUNT(*) FROM revisionPagoSuscripcion) reviews,
      (SELECT COUNT(*) FROM historialSolicitudPagoSuscripcion) history,
      (SELECT COUNT(*) FROM aplicacionPagoSuscripcion) applications,
      (SELECT COUNT(*) FROM operacionPagoSuscripcion) operations,
      (SELECT COUNT(*) FROM precioPlanPeriodo pp JOIN plan p ON p.idPlan=pp.idPlan
       WHERE p.codigo IN ('basico','standard','pro') AND pp.versionPrecio=1
         AND pp.monedaBase='USD') seededPrices,
      (SELECT COUNT(*) FROM plan p
       JOIN planFuncionalidad pf ON pf.idPlan=p.idPlan AND pf.habilitada=1
       JOIN funcionalidad f ON f.idFuncionalidad=pf.idFuncionalidad
       WHERE p.codigo IN ('basico','standard','pro')
         AND f.codigo IN ('portal_clientes','reportes_avanzados')) excludedFeatures,
      (SELECT COUNT(*) FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='comprobantePagoSuscripcion'
         AND DATA_TYPE IN ('binary','varbinary','blob','tinyblob','mediumblob','longblob')) binaryColumns,
      (SELECT COUNT(*) FROM information_schema.REFERENTIAL_CONSTRAINTS
       WHERE CONSTRAINT_SCHEMA=DATABASE()
         AND TABLE_NAME IN (${TABLES.map(() => '?').join(',')})
         AND DELETE_RULE<>'RESTRICT') destructiveForeignKeys`,
    TABLES
  );
  const [methods] = await connection.query(
    `SELECT codigo,configurado,visiblePropietario,activo,
            requiereComprobante,soloAdministracion
     FROM metodoPagoSuscripcion ORDER BY orden,codigo`
  );

  const publicPlansValid = Object.entries(PLAN_CATALOG).every(([code, expected]) => {
    const plan = planMap.get(code);
    return plan
      && Number(plan.activo) === 1
      && Number(plan.visiblePublicamente) === 1
      && Number(plan.esLegado) === 0
      && Number(plan.ordenComercial) === expected.order
      && Number(plan.precioMensual) === expected.pricesUsd.mensual
      && Number(plan.limitePropietarios) === Number(expected.limits.owners)
      && Number(plan.limiteProductos) === Number(expected.limits.products)
      && Number(plan.limiteClientes) === Number(expected.limits.customers)
      && Number(plan.limiteProveedores) === Number(expected.limits.suppliers);
  });
  const pro = planMap.get('pro');
  const proUnlimited = pro && [
    pro.limitePropietarios,
    pro.limiteProductos,
    pro.limiteClientes,
    pro.limiteProveedores
  ].every((value) => value === null);
  const legacy = planMap.get('avanzado');
  const legacyValid = legacy
    && Number(legacy.activo) === 1
    && Number(legacy.visiblePublicamente) === 0
    && Number(legacy.esLegado) === 1;
  const methodsValid = methods.length === 3
    && methods.filter((method) => method.codigo !== 'efectivo_administrativo')
      .every((method) => Number(method.activo) === 0
        && Number(method.visiblePropietario) === 0
        && Number(method.configurado) === 0
        && Number(method.requiereComprobante) === 1)
    && methods.some((method) => method.codigo === 'efectivo_administrativo'
      && Number(method.activo) === 1
      && Number(method.visiblePropietario) === 0
      && Number(method.soloAdministracion) === 1
      && Number(method.requiereComprobante) === 0);

  return {
    migration: Number(migration.total),
    tables,
    planColumns: PLAN_COLUMNS.every((column) => planColumns.has(column)),
    indexes,
    constraints,
    publicPlansValid: publicPlansValid && proUnlimited,
    legacyValid,
    featureCounts,
    featuresValid: featureCounts.basico === BASIC_FEATURES.length
      && featureCounts.standard === STANDARD_FEATURES.length
      && featureCounts.pro === PRO_FEATURES.length
      && Number(counts.excludedFeatures) === 0,
    methodsValid,
    prices: Number(counts.prices),
    seededPrices: Number(counts.seededPrices),
    rates: Number(counts.rates),
    methods: Number(counts.methods),
    requests: Number(counts.requests),
    receipts: Number(counts.receipts),
    reviews: Number(counts.reviews),
    history: Number(counts.history),
    applications: Number(counts.applications),
    operations: Number(counts.operations),
    excludedFeatures: Number(counts.excludedFeatures),
    binaryColumns: Number(counts.binaryColumns),
    destructiveForeignKeys: Number(counts.destructiveForeignKeys),
    complete: true
  };
}

function isValidState(state) {
  return state.migration === 1
    && state.complete
    && Object.values(state.tables).every(Boolean)
    && state.planColumns
    && state.indexes
    && state.constraints
    && state.publicPlansValid
    && state.legacyValid
    && state.featuresValid
    && state.methodsValid
    && state.prices === 9
    && state.seededPrices === 9
    && state.excludedFeatures === 0
    && state.binaryColumns === 0
    && state.destructiveForeignKeys === 0;
}

async function main() {
  const config = databaseConfig();
  const connection = await createDatabaseConnection(config);
  try {
    const state = await inspectSaasC(connection);
    if (!isValidState(state)) {
      throw new Error('La estructura SAAS-C1 esta incompleta o es inconsistente.');
    }
    console.log(JSON.stringify({
      destino: databaseTarget(config),
      migracion: MIGRATION,
      planesPublicos: Object.keys(PLAN_CATALOG).length,
      funcionalidades: state.featureCounts,
      precios: state.prices,
      tasasRegistradas: state.rates,
      solicitudes: state.requests,
      estado: 'SAAS_C_SCHEMA_OK'
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
  TABLES,
  inspectSaasC,
  isValidState
};
