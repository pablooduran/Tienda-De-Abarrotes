const {
  databaseConfig,
  logDatabaseTarget,
  requireLocalhostDatabase
} = require('../config/env');
const {
  AUDIT_ACTION_RESULT_CODES,
  AUDIT_ACTIONS,
  AUDIT_RESULTS,
  AUDIT_RESULTS_BY_CODE
} = require('../config/administrative-audit-contract');
const { createDatabaseConnection } = require('../config/database-connection');

const MIGRATION = '018_auditoria_administrativa_critica.sql';
const TABLE = 'eventoAuditoriaAdministrativa';

const EXPECTED_COLUMNS = Object.freeze([
  'idEventoAuditoria', 'idTienda', 'actorTipo', 'idAdministradorActor',
  'categoria', 'accion', 'resultado', 'codigoResultado', 'origen',
  'entidadTipo', 'referenciaSegura', 'requestId', 'datosAnteriores',
  'datosPosteriores', 'metadatos', 'creadoEn'
]);

const EXPECTED_INDEXES = Object.freeze([
  ['uq_eventoAuditoria_request_accion_resultado', ['requestId', 'accion', 'resultado'], true],
  ['idx_eventoAuditoria_tienda_fecha', ['idTienda', 'creadoEn', 'idEventoAuditoria'], false],
  ['idx_eventoAuditoria_actor_fecha', ['idAdministradorActor', 'creadoEn', 'idEventoAuditoria'], false],
  ['idx_eventoAuditoria_categoria_accion_fecha', ['categoria', 'accion', 'creadoEn', 'idEventoAuditoria'], false],
  ['idx_eventoAuditoria_resultado_fecha', ['resultado', 'creadoEn', 'idEventoAuditoria'], false]
]);

const EXPECTED_CHECKS = Object.freeze([
  'chk_eventoAuditoria_actor',
  'chk_eventoAuditoria_categoria_accion',
  'chk_eventoAuditoria_codigo',
  'chk_eventoAuditoria_referencia',
  'chk_eventoAuditoria_request'
]);

const EXPECTED_FOREIGN_KEYS = Object.freeze([
  ['fk_eventoAuditoria_tienda', ['idTienda'], 'tienda', ['idTienda']],
  ['fk_eventoAuditoria_actor', ['idAdministradorActor'], 'administrador', ['idAdministrador']]
]);

function normalize(value) {
  return String(value || '').toLocaleLowerCase('en-US');
}

async function scalar(connection, sql, params = []) {
  const [[row]] = await connection.query(sql, params);
  return Number(row.total || 0);
}

async function hasTable(connection, schemaName) {
  return (await scalar(
    connection,
    `SELECT COUNT(*) total FROM information_schema.TABLES
     WHERE TABLE_SCHEMA=? AND LOWER(TABLE_NAME)=LOWER(?)`,
    [schemaName, TABLE]
  )) === 1;
}

async function presentColumns(connection, schemaName) {
  const [rows] = await connection.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA=? AND LOWER(TABLE_NAME)=LOWER(?)`,
    [schemaName, TABLE]
  );
  const actual = new Set(rows.map((row) => normalize(row.COLUMN_NAME)));
  return Object.fromEntries(EXPECTED_COLUMNS.map((column) => [column, actual.has(normalize(column))]));
}

async function indexMatches(connection, schemaName, name, columns, unique) {
  const [rows] = await connection.query(
    `SELECT COLUMN_NAME, NON_UNIQUE FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA=? AND LOWER(TABLE_NAME)=LOWER(?) AND LOWER(INDEX_NAME)=LOWER(?)
     ORDER BY SEQ_IN_INDEX`,
    [schemaName, TABLE, name]
  );
  return rows.length === columns.length
    && rows.every((row, index) => normalize(row.COLUMN_NAME) === normalize(columns[index])
      && Number(row.NON_UNIQUE) === (unique ? 0 : 1));
}

async function constraintPresent(connection, schemaName, name, type) {
  return (await scalar(
    connection,
    `SELECT COUNT(*) total FROM information_schema.TABLE_CONSTRAINTS
     WHERE CONSTRAINT_SCHEMA=? AND LOWER(TABLE_NAME)=LOWER(?)
       AND LOWER(CONSTRAINT_NAME)=LOWER(?) AND CONSTRAINT_TYPE=?`,
    [schemaName, TABLE, name, type]
  )) === 1;
}

async function foreignKeyMatches(connection, schemaName, definition) {
  const [name, columns, parentTable, parentColumns] = definition;
  const [rows] = await connection.query(
    `SELECT COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
     FROM information_schema.KEY_COLUMN_USAGE
     WHERE TABLE_SCHEMA=? AND LOWER(TABLE_NAME)=LOWER(?)
       AND LOWER(CONSTRAINT_NAME)=LOWER(?)
     ORDER BY ORDINAL_POSITION`,
    [schemaName, TABLE, name]
  );
  if (rows.length !== columns.length) return false;
  const columnsMatch = rows.every((row, index) => (
    normalize(row.COLUMN_NAME) === normalize(columns[index])
    && normalize(row.REFERENCED_TABLE_NAME) === normalize(parentTable)
    && normalize(row.REFERENCED_COLUMN_NAME) === normalize(parentColumns[index])
  ));
  if (!columnsMatch) return false;
  const [rules] = await connection.query(
    `SELECT UPDATE_RULE, DELETE_RULE FROM information_schema.REFERENTIAL_CONSTRAINTS
     WHERE CONSTRAINT_SCHEMA=? AND LOWER(TABLE_NAME)=LOWER(?)
       AND LOWER(CONSTRAINT_NAME)=LOWER(?)`,
    [schemaName, TABLE, name]
  );
  return rules.length === 1
    && rules[0].UPDATE_RULE === 'RESTRICT'
    && rules[0].DELETE_RULE === 'RESTRICT';
}

function allowedContractTuples() {
  const tuples = [];
  for (const [action, definition] of Object.entries(AUDIT_ACTIONS)) {
    for (const resultCode of AUDIT_ACTION_RESULT_CODES[action]) {
      for (const result of AUDIT_RESULTS_BY_CODE[resultCode]) {
        tuples.push([action, definition.category, definition.entity, resultCode, result]);
      }
    }
  }
  return tuples;
}

async function contractViolations(connection) {
  const tuples = allowedContractTuples();
  const clause = tuples.map(
    () => '(accion=? AND categoria=? AND entidadTipo=? AND codigoResultado=? AND resultado=?)'
  ).join(' OR ');
  return scalar(
    connection,
    `SELECT COUNT(*) total FROM ${TABLE}
     WHERE resultado NOT IN (${AUDIT_RESULTS.map(() => '?').join(',')})
       OR NOT (${clause})`,
    [...AUDIT_RESULTS, ...tuples.flat()]
  );
}

async function forbiddenJsonKeys(connection, column, section) {
  const clauses = [];
  const params = [];
  for (const [action, definition] of Object.entries(AUDIT_ACTIONS)) {
    const allowed = definition.allowed[section];
    if (!allowed.length) continue;
    clauses.push(`(e.accion=? AND keysTable.keyName IN (${allowed.map(() => '?').join(',')}))`);
    params.push(action, ...allowed);
  }
  const allowedClause = clauses.length ? clauses.join(' OR ') : 'FALSE';
  return scalar(
    connection,
    `SELECT COUNT(*) total
     FROM ${TABLE} e
     JOIN JSON_TABLE(
       COALESCE(JSON_KEYS(e.${column}), JSON_ARRAY()),
       '$[*]' COLUMNS(keyName VARCHAR(80) PATH '$')
     ) keysTable
     WHERE NOT (${allowedClause})`,
    params
  );
}

async function inspectAdministrativeAudit(connection, { schemaName = databaseConfig().database } = {}) {
  const migrationRegistered = (await scalar(
    connection,
    'SELECT COUNT(*) total FROM schema_migrations WHERE nombre=?',
    [MIGRATION]
  )) === 1;
  const tablePresent = await hasTable(connection, schemaName);
  if (!tablePresent) {
    return {
      migracion: MIGRATION,
      registrada: migrationRegistered,
      tablaPresente: false,
      estructuraCompleta: false,
      datosValidos: false,
      estado: migrationRegistered ? 'inconsistente' : 'pre'
    };
  }

  const columns = await presentColumns(connection, schemaName);
  const indexes = {};
  for (const [name, indexColumns, unique] of EXPECTED_INDEXES) {
    indexes[name] = await indexMatches(connection, schemaName, name, indexColumns, unique);
  }
  const checks = {};
  for (const name of EXPECTED_CHECKS) {
    checks[name] = await constraintPresent(connection, schemaName, name, 'CHECK');
  }
  const foreignKeys = {};
  for (const definition of EXPECTED_FOREIGN_KEYS) {
    foreignKeys[definition[0]] = await foreignKeyMatches(connection, schemaName, definition);
  }
  const data = {
    contratoInvalido: await contractViolations(connection),
    actorInvalido: await scalar(
      connection,
      `SELECT COUNT(*) total
       FROM ${TABLE} e
       LEFT JOIN administrador a ON a.idAdministrador=e.idAdministradorActor
       WHERE (e.actorTipo='administrador' AND a.idAdministrador IS NULL)
          OR (e.actorTipo<>'administrador' AND e.idAdministradorActor IS NOT NULL)
          OR (e.actorTipo='anonimo' AND e.idTienda IS NOT NULL)
          OR (a.rol='dueno_tienda' AND NOT (a.idTienda <=> e.idTienda))
          OR (a.rol='superadmin' AND a.idTienda IS NOT NULL)`
    ),
    clavesAnterioresNoPermitidas: await forbiddenJsonKeys(connection, 'datosAnteriores', 'before'),
    clavesPosterioresNoPermitidas: await forbiddenJsonKeys(connection, 'datosPosteriores', 'after'),
    metadatosNoPermitidos: await forbiddenJsonKeys(connection, 'metadatos', 'metadata')
  };
  const structureComplete = [
    ...Object.values(columns),
    ...Object.values(indexes),
    ...Object.values(checks),
    ...Object.values(foreignKeys)
  ].every(Boolean);
  const dataValid = Object.values(data).every((value) => value === 0);
  return {
    migracion: MIGRATION,
    registrada: migrationRegistered,
    tablaPresente: true,
    columnas: columns,
    indices: indexes,
    checks,
    clavesForaneas: foreignKeys,
    datos: data,
    estructuraCompleta: structureComplete,
    datosValidos: dataValid,
    estado: migrationRegistered && structureComplete && dataValid
      ? 'post'
      : 'inconsistente'
  };
}

async function main() {
  const config = {
    ...requireLocalhostDatabase('La comprobacion de auditoria administrativa'),
    decimalNumbers: true
  };
  logDatabaseTarget('Comprobacion de auditoria administrativa', config);
  const connection = await createDatabaseConnection(config);
  try {
    const result = await inspectAdministrativeAudit(connection, { schemaName: config.database });
    console.log(JSON.stringify(result, null, 2));
    if (result.estado !== 'post') process.exitCode = 1;
  } finally {
    await connection.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error('La comprobacion de auditoria administrativa fallo.');
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
  inspectAdministrativeAudit
};
