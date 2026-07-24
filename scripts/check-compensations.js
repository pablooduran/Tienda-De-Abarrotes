const {
  databaseConfig,
  logDatabaseTarget,
  requireLocalhostDatabase
} = require('../config/env');
const {
  COMPENSATION_FEATURE,
  COMPENSATION_REASONS,
  COMPENSATION_STATES,
  COMPENSATION_TYPES,
  SALE_OPERATION_STATES
} = require('../config/compensation-contract');
const { createDatabaseConnection } = require('../config/database-connection');

const MIGRATION = '014_operaciones_compensatorias.sql';

const EXPECTED_COLUMNS = Object.freeze({
  venta: {
    estadoOperacion: {
      type: `enum('${SALE_OPERATION_STATES.join("','")}')`,
      nullable: false,
      defaultValue: 'vigente'
    }
  },
  operacionCompensatoria: {
    idOperacionCompensatoria: { type: 'bigint', nullable: false, autoIncrement: true },
    idTienda: { type: 'int', nullable: false },
    tipoOperacion: {
      type: `enum('${COMPENSATION_TYPES.join("','")}')`,
      nullable: false
    },
    estado: {
      type: `enum('${COMPENSATION_STATES.join("','")}')`,
      nullable: false,
      defaultValue: 'solicitada'
    },
    motivoCodigo: {
      type: `enum('${COMPENSATION_REASONS.join("','")}')`,
      nullable: false
    },
    observacion: { type: 'varchar(1000)', nullable: true },
    requiereAprobacion: { type: 'tinyint(1)', nullable: false, defaultValue: 0 },
    idAdministradorSolicitante: { type: 'int', nullable: false },
    idAdministradorAprobador: { type: 'int', nullable: true },
    claveOperacion: {
      type: 'varchar(160)',
      nullable: false,
      characterSet: 'ascii',
      collation: 'ascii_bin'
    },
    huellaSolicitud: {
      type: 'char(64)',
      nullable: false,
      characterSet: 'ascii',
      collation: 'ascii_bin'
    },
    fechaSolicitud: { type: 'datetime', nullable: false },
    fechaAprobacion: { type: 'datetime', nullable: true },
    fechaAplicacion: { type: 'datetime', nullable: true },
    creadoEn: { type: 'datetime', nullable: false },
    actualizadoEn: { type: 'datetime', nullable: false }
  }
});

const EXPECTED_INDEXES = Object.freeze([
  ['venta', 'idx_venta_tienda_estado_operacion_fecha', ['idTienda', 'estadoOperacion', 'fecha', 'idVenta'], false],
  ['operacionCompensatoria', 'PRIMARY', ['idOperacionCompensatoria'], true],
  ['operacionCompensatoria', 'uq_operacionCompensatoria_tienda_id', ['idTienda', 'idOperacionCompensatoria'], true],
  ['operacionCompensatoria', 'uq_operacionCompensatoria_tienda_clave', ['idTienda', 'claveOperacion'], true],
  ['operacionCompensatoria', 'idx_operacionCompensatoria_tienda_tipo_estado', ['idTienda', 'tipoOperacion', 'estado'], false],
  ['operacionCompensatoria', 'idx_operacionCompensatoria_tienda_fecha', ['idTienda', 'fechaSolicitud', 'idOperacionCompensatoria'], false],
  ['operacionCompensatoria', 'idx_operacionCompensatoria_tienda_solicitante', ['idTienda', 'idAdministradorSolicitante', 'fechaSolicitud'], false],
  ['operacionCompensatoria', 'idx_operacionCompensatoria_tienda_aprobador', ['idTienda', 'idAdministradorAprobador', 'fechaAprobacion'], false]
]);

const EXPECTED_CHECKS = Object.freeze([
  ['venta', 'chk_venta_estado_operacion'],
  ['operacionCompensatoria', 'chk_operacionCompensatoria_aprobacion'],
  ['operacionCompensatoria', 'chk_operacionCompensatoria_clave'],
  ['operacionCompensatoria', 'chk_operacionCompensatoria_huella'],
  ['operacionCompensatoria', 'chk_operacionCompensatoria_motivo'],
  ['operacionCompensatoria', 'chk_operacionCompensatoria_fechas']
]);

const EXPECTED_FOREIGN_KEYS = Object.freeze([
  ['operacionCompensatoria', 'fk_operacionCompensatoria_tienda', ['idTienda'], 'tienda', ['idTienda']],
  [
    'operacionCompensatoria',
    'fk_operacionCompensatoria_solicitante',
    ['idTienda', 'idAdministradorSolicitante'],
    'administrador',
    ['idTienda', 'idAdministrador']
  ],
  [
    'operacionCompensatoria',
    'fk_operacionCompensatoria_aprobador',
    ['idTienda', 'idAdministradorAprobador'],
    'administrador',
    ['idTienda', 'idAdministrador']
  ]
]);

function normalizeIdentifier(value) {
  return String(value || '').toLocaleLowerCase('en-US');
}

function normalizeDefault(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim().toLocaleLowerCase('en-US');
  if (/^-?\d+(?:\.\d+)?$/.test(text)) return Number(text);
  return text;
}

async function scalar(connection, sql, params = []) {
  const [[row]] = await connection.query(sql, params);
  return Number(row.total || 0);
}

async function tableDetails(connection, schemaName, table) {
  const [rows] = await connection.query(
    `SELECT TABLE_NAME, ENGINE
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA=? AND LOWER(TABLE_NAME)=LOWER(?)`,
    [schemaName, table]
  );
  if (!rows.length) return null;
  return {
    name: rows[0].TABLE_NAME,
    engine: normalizeIdentifier(rows[0].ENGINE)
  };
}

async function columnsForTable(connection, schemaName, table) {
  const [rows] = await connection.query(
    `SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, EXTRA,
            CHARACTER_SET_NAME, COLLATION_NAME
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA=? AND LOWER(TABLE_NAME)=LOWER(?)`,
    [schemaName, table]
  );
  return new Map(rows.map((row) => [normalizeIdentifier(row.COLUMN_NAME), row]));
}

function columnMatches(actual, expected) {
  if (!actual) return false;
  return normalizeIdentifier(actual.COLUMN_TYPE) === normalizeIdentifier(expected.type)
    && (actual.IS_NULLABLE === 'YES') === expected.nullable
    && (expected.defaultValue === undefined
      || normalizeDefault(actual.COLUMN_DEFAULT) === normalizeDefault(expected.defaultValue))
    && (!expected.autoIncrement
      || normalizeIdentifier(actual.EXTRA).includes('auto_increment'))
    && (!expected.characterSet
      || normalizeIdentifier(actual.CHARACTER_SET_NAME) === normalizeIdentifier(expected.characterSet))
    && (!expected.collation
      || normalizeIdentifier(actual.COLLATION_NAME) === normalizeIdentifier(expected.collation));
}

async function indexMatches(connection, schemaName, definition) {
  const [table, name, columns, unique] = definition;
  const [rows] = await connection.query(
    `SELECT COLUMN_NAME, NON_UNIQUE
     FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA=? AND LOWER(TABLE_NAME)=LOWER(?)
       AND LOWER(INDEX_NAME)=LOWER(?)
     ORDER BY SEQ_IN_INDEX`,
    [schemaName, table, name]
  );
  return rows.length === columns.length
    && rows.every((row, index) => normalizeIdentifier(row.COLUMN_NAME) === normalizeIdentifier(columns[index])
      && (!unique || Number(row.NON_UNIQUE) === 0));
}

async function checkExists(connection, schemaName, table, name) {
  return scalar(
    connection,
    `SELECT COUNT(*) total FROM information_schema.TABLE_CONSTRAINTS
     WHERE CONSTRAINT_SCHEMA=? AND LOWER(TABLE_NAME)=LOWER(?)
       AND LOWER(CONSTRAINT_NAME)=LOWER(?) AND CONSTRAINT_TYPE='CHECK'`,
    [schemaName, table, name]
  ).then((total) => total === 1);
}

async function foreignKeyMatches(connection, schemaName, definition) {
  const [table, name, columns, parentTable, parentColumns] = definition;
  const [rows] = await connection.query(
    `SELECT COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
     FROM information_schema.KEY_COLUMN_USAGE
     WHERE TABLE_SCHEMA=? AND LOWER(TABLE_NAME)=LOWER(?)
       AND LOWER(CONSTRAINT_NAME)=LOWER(?)
     ORDER BY ORDINAL_POSITION`,
    [schemaName, table, name]
  );
  if (rows.length !== columns.length) return false;
  const columnsMatch = rows.every((row, index) => (
    normalizeIdentifier(row.COLUMN_NAME) === normalizeIdentifier(columns[index])
    && normalizeIdentifier(row.REFERENCED_TABLE_NAME) === normalizeIdentifier(parentTable)
    && normalizeIdentifier(row.REFERENCED_COLUMN_NAME) === normalizeIdentifier(parentColumns[index])
  ));
  if (!columnsMatch) return false;
  const [rules] = await connection.query(
    `SELECT UPDATE_RULE, DELETE_RULE
     FROM information_schema.REFERENTIAL_CONSTRAINTS
     WHERE CONSTRAINT_SCHEMA=? AND LOWER(TABLE_NAME)=LOWER(?)
       AND LOWER(CONSTRAINT_NAME)=LOWER(?)`,
    [schemaName, table, name]
  );
  return rules.length === 1
    && normalizeIdentifier(rules[0].UPDATE_RULE) === 'restrict'
    && normalizeIdentifier(rules[0].DELETE_RULE) === 'restrict';
}

async function inspectCompensationFoundation(connection, options = {}) {
  const schemaName = String(options.schemaName || process.env.DB_NAME || '').trim();
  if (!schemaName) throw new Error('Se requiere el nombre de la base para comprobar compensaciones.');

  const tables = {};
  for (const table of ['venta', 'operacionCompensatoria', 'tienda', 'administrador', 'funcionalidad', 'plan', 'planFuncionalidad', 'schema_migrations']) {
    tables[table] = await tableDetails(connection, schemaName, table);
  }

  const columns = {};
  const columnDetails = {};
  for (const [table, expectedColumns] of Object.entries(EXPECTED_COLUMNS)) {
    const actualColumns = await columnsForTable(connection, schemaName, table);
    columns[table] = {};
    columnDetails[table] = {};
    for (const [column, expected] of Object.entries(expectedColumns)) {
      const actual = actualColumns.get(normalizeIdentifier(column));
      columns[table][column] = columnMatches(actual, expected);
      columnDetails[table][column] = actual
        ? {
          type: normalizeIdentifier(actual.COLUMN_TYPE),
          nullable: actual.IS_NULLABLE === 'YES',
          defaultValue: actual.COLUMN_DEFAULT,
          characterSet: actual.CHARACTER_SET_NAME,
          collation: actual.COLLATION_NAME
        }
        : null;
    }
  }

  const indexes = {};
  for (const definition of EXPECTED_INDEXES) {
    indexes[`${definition[0]}.${definition[1]}`] = await indexMatches(
      connection,
      schemaName,
      definition
    );
  }
  const checks = {};
  for (const [table, name] of EXPECTED_CHECKS) {
    checks[`${table}.${name}`] = await checkExists(connection, schemaName, table, name);
  }
  const foreignKeys = {};
  for (const definition of EXPECTED_FOREIGN_KEYS) {
    foreignKeys[`${definition[0]}.${definition[1]}`] = await foreignKeyMatches(
      connection,
      schemaName,
      definition
    );
  }

  const migrationRegistered = Boolean(tables.schema_migrations)
    && await scalar(
      connection,
      'SELECT COUNT(*) total FROM schema_migrations WHERE LOWER(nombre)=LOWER(?)',
      [MIGRATION]
    ) === 1;
  const structureComplete = Boolean(tables.venta)
    && tables.operacionCompensatoria?.engine === 'innodb'
    && Object.values(columns).every((table) => Object.values(table).every(Boolean))
    && Object.values(indexes).every(Boolean)
    && Object.values(checks).every(Boolean)
    && Object.values(foreignKeys).every(Boolean);

  const data = {
    ventasSinEstadoOperativoValido: null,
    operacionesInvalidas: null,
    solicitantesCruzados: null,
    aprobadoresCruzados: null,
    funcionalidadActiva: null,
    planesOperativosHabilitados: null
  };
  if (columns.venta.estadoOperacion) {
    data.ventasSinEstadoOperativoValido = await scalar(
      connection,
      `SELECT COUNT(*) total FROM venta
       WHERE estadoOperacion IS NULL OR estadoOperacion NOT IN (?)`,
      [SALE_OPERATION_STATES]
    );
  }
  if (tables.operacionCompensatoria && Object.values(columns.operacionCompensatoria).every(Boolean)) {
    data.operacionesInvalidas = await scalar(
      connection,
      `SELECT COUNT(*) total FROM operacionCompensatoria
       WHERE idTienda IS NULL
          OR idAdministradorSolicitante IS NULL
          OR tipoOperacion NOT IN (?)
          OR estado NOT IN (?)
          OR motivoCodigo NOT IN (?)
          OR CONVERT(claveOperacion USING utf8mb4)
             NOT REGEXP '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
          OR CHAR_LENGTH(claveOperacion)>160
          OR CONVERT(huellaSolicitud USING utf8mb4) NOT REGEXP '^[0-9A-Fa-f]{64}$'
          OR huellaSolicitud<>LOWER(huellaSolicitud)
          OR requiereAprobacion NOT IN (0,1)
          OR (motivoCodigo='otro_controlado'
              AND (observacion IS NULL OR CHAR_LENGTH(TRIM(observacion))<8))
          OR fechaSolicitud<>creadoEn
          OR actualizadoEn<creadoEn
          OR ((idAdministradorAprobador IS NULL)<>(fechaAprobacion IS NULL))
          OR (fechaAprobacion IS NOT NULL AND fechaAprobacion<fechaSolicitud)
          OR (estado='aplicada' AND (fechaAplicacion IS NULL OR fechaAplicacion<fechaSolicitud))
          OR (estado<>'aplicada' AND fechaAplicacion IS NOT NULL)
          OR (estado='aprobada' AND idAdministradorAprobador IS NULL)
          OR (
            requiereAprobacion=1
            AND estado IN ('aprobada','aplicada')
            AND idAdministradorAprobador IS NULL
          )`,
      [COMPENSATION_TYPES, COMPENSATION_STATES, COMPENSATION_REASONS]
    );
    data.solicitantesCruzados = await scalar(
      connection,
      `SELECT COUNT(*) total
       FROM operacionCompensatoria oc
       LEFT JOIN administrador a
         ON a.idTienda=oc.idTienda
        AND a.idAdministrador=oc.idAdministradorSolicitante
       WHERE a.idAdministrador IS NULL`
    );
    data.aprobadoresCruzados = await scalar(
      connection,
      `SELECT COUNT(*) total
       FROM operacionCompensatoria oc
       LEFT JOIN administrador a
         ON a.idTienda=oc.idTienda
        AND a.idAdministrador=oc.idAdministradorAprobador
       WHERE oc.idAdministradorAprobador IS NOT NULL
         AND a.idAdministrador IS NULL`
    );
  }
  if (tables.funcionalidad && tables.plan && tables.planFuncionalidad) {
    data.funcionalidadActiva = await scalar(
      connection,
      'SELECT COUNT(*) total FROM funcionalidad WHERE codigo=? AND activo=1',
      [COMPENSATION_FEATURE]
    );
    data.planesOperativosHabilitados = await scalar(
      connection,
      `SELECT COUNT(DISTINCT p.codigo) total
       FROM planFuncionalidad pf
       JOIN plan p ON p.idPlan=pf.idPlan
       JOIN funcionalidad f ON f.idFuncionalidad=pf.idFuncionalidad
       WHERE p.codigo IN ('basico','avanzado')
         AND f.codigo=?
         AND f.activo=1
         AND pf.habilitada=1`,
      [COMPENSATION_FEATURE]
    );
  }

  const dataValid = structureComplete
    && data.ventasSinEstadoOperativoValido === 0
    && data.operacionesInvalidas === 0
    && data.solicitantesCruzados === 0
    && data.aprobadoresCruzados === 0
    && data.funcionalidadActiva === 1
    && data.planesOperativosHabilitados === 2;
  const cleanPreMigration = !migrationRegistered
    && !tables.operacionCompensatoria
    && !columns.venta.estadoOperacion;
  const state = migrationRegistered && structureComplete && dataValid
    ? 'post-migracion'
    : cleanPreMigration
      ? 'pre-migracion'
      : 'estructura-incompleta-o-migracion-parcial';

  return {
    migration: MIGRATION,
    state,
    migrationRegistered,
    tables: Object.fromEntries(
      Object.entries(tables).map(([name, value]) => [name, Boolean(value)])
    ),
    engines: {
      operacionCompensatoria: tables.operacionCompensatoria?.engine || null
    },
    columns,
    columnDetails,
    indexes,
    checks,
    foreignKeys,
    structureComplete,
    dataValid,
    data
  };
}

async function main() {
  const config = requireLocalhostDatabase('db:check-compensations');
  logDatabaseTarget('Comprobacion de operaciones compensatorias', config);
  const connection = await createDatabaseConnection(databaseConfig());
  try {
    const result = await inspectCompensationFoundation(connection, {
      schemaName: config.database
    });
    console.log(JSON.stringify(result, null, 2));
    if (result.state !== 'post-migracion') process.exitCode = 1;
  } finally {
    await connection.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error('No se pudo comprobar la base de operaciones compensatorias.');
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = {
  EXPECTED_CHECKS,
  EXPECTED_COLUMNS,
  EXPECTED_FOREIGN_KEYS,
  EXPECTED_INDEXES,
  MIGRATION,
  inspectCompensationFoundation
};
