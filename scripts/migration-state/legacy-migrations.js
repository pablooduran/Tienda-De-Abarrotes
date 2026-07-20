const LEGACY_MIGRATION_NAMES = Object.freeze([
  '001_mejoras_tienda.sql',
  '002_mejoras_stock_reportes.sql',
  '003_borrado_logico.sql'
]);

const COMPLETE_STATES = new Set(['completa-no-registrada', 'post']);

function identifier(value) {
  return String(value || '').toLocaleLowerCase('en-US');
}

function normalizedObjectKey(...parts) {
  return parts.map(identifier).join('.');
}

function numberValue(value) {
  return value === null || value === undefined ? null : Number(value);
}

function normalizeDefault(value) {
  if (value === null || value === undefined) return null;
  return String(value).replace(/^'(.*)'$/, '$1').toLocaleLowerCase('en-US');
}

function defaultsMatch(actual, expected, dataType) {
  const actualNormalized = normalizeDefault(actual);
  const expectedNormalized = normalizeDefault(expected);
  if (actualNormalized === expectedNormalized) return true;
  if (actualNormalized === null || expectedNormalized === null) return false;
  if (['decimal', 'int', 'tinyint', 'smallint', 'mediumint', 'bigint'].includes(dataType)) {
    const actualNumber = Number(actualNormalized);
    const expectedNumber = Number(expectedNormalized);
    return Number.isFinite(actualNumber)
      && Number.isFinite(expectedNumber)
      && actualNumber === expectedNumber;
  }
  return false;
}

const COLUMN_DEFINITIONS = {
  intNullable: { types: ['int'], nullable: true },
  intDefault0: { types: ['int'], nullable: false, default: '0' },
  intDefault1: { types: ['int'], nullable: false, default: '1' },
  intDefault5: { types: ['int'], nullable: false, default: '5' },
  tinyintDefault1: { types: ['tinyint'], nullable: false, default: '1' },
  decimalCost: {
    types: ['decimal'], nullable: false, default: '0', minimumPrecision: 10, minimumScale: 2,
    minimumIntegerDigits: 8, historicalPrecision: 10, historicalScale: 2
  },
  decimalAmount: {
    types: ['decimal'], nullable: false, default: '0', minimumPrecision: 10, minimumScale: 2,
    minimumIntegerDigits: 8, historicalPrecision: 10, historicalScale: 2
  }
};

const EVOLVED_MIGRATIONS = Object.freeze({
  multiTenant: '004_multitienda_base.sql',
  lotPrecision: '011_lotes_vencimientos.sql'
});

const EVOLVED_INDEX_REQUIREMENTS = Object.freeze({
  'producto.fk_producto_proveedor': {
    migration: EVOLVED_MIGRATIONS.multiTenant,
    columns: ['idTienda', 'idProveedor'],
    description: 'indice compuesto multitienda producto-proveedor'
  },
  'fiado.fk_fiado_venta': {
    migration: EVOLVED_MIGRATIONS.multiTenant,
    columns: ['idTienda', 'idVenta'],
    description: 'indice compuesto multitienda fiado-venta'
  }
});

const EVOLVED_FOREIGN_KEY_REQUIREMENTS = Object.freeze({
  'producto.fk_producto_proveedor': {
    migration: EVOLVED_MIGRATIONS.multiTenant,
    columns: ['idTienda', 'idProveedor'],
    referencedTable: 'proveedor',
    referencedColumns: ['idTienda', 'idProveedor'],
    description: 'fk compuesta multitienda producto-proveedor'
  },
  'fiado.fk_fiado_venta': {
    migration: EVOLVED_MIGRATIONS.multiTenant,
    columns: ['idTienda', 'idVenta'],
    referencedTable: 'venta',
    referencedColumns: ['idTienda', 'idVenta'],
    description: 'fk compuesta multitienda fiado-venta'
  }
});

const EVOLVED_COLUMN_REQUIREMENTS = Object.freeze({
  'producto.ultimopreciocompra': {
    migration: EVOLVED_MIGRATIONS.lotPrecision,
    definition: {
      ...COLUMN_DEFINITIONS.decimalCost,
      minimumPrecision: 14,
      minimumScale: 6,
      minimumIntegerDigits: 8
    },
    description: 'precision ampliada por lotes y vencimientos'
  },
  'detalleventa.costounitario': {
    migration: EVOLVED_MIGRATIONS.lotPrecision,
    definition: {
      ...COLUMN_DEFINITIONS.decimalCost,
      minimumPrecision: 14,
      minimumScale: 6,
      minimumIntegerDigits: 8
    },
    description: 'precision ampliada por lotes y vencimientos'
  }
});

const MIGRATIONS = Object.freeze({
  '001_mejoras_tienda.sql': {
    objetivo: 'Proveedor y categoria por producto, stock entero y relacion entre fiado y venta.',
    dependsOn: [],
    prerequisites: ['producto', 'proveedor', 'venta', 'fiado'],
    addedColumns: [
      ['producto', 'idProveedor'],
      ['producto', 'categoria'],
      ['producto', 'unidadesPorPaquete'],
      ['venta', 'tipo'],
      ['fiado', 'idVenta']
    ],
    pendingColumns: {
      'producto.stock': {
        types: ['decimal'], nullable: false, default: '0', minimumPrecision: 10, minimumScale: 2
      },
      'producto.stockMinimo': {
        types: ['decimal'], nullable: false, default: '5', minimumPrecision: 10, minimumScale: 2
      }
    },
    columns: [
      ['producto', 'idProveedor', COLUMN_DEFINITIONS.intNullable],
      ['producto', 'categoria', {
        types: ['varchar'], nullable: false, default: 'otros', characterMaximumLength: 50
      }],
      ['producto', 'unidadesPorPaquete', COLUMN_DEFINITIONS.intDefault1],
      ['producto', 'stock', COLUMN_DEFINITIONS.intDefault0],
      ['producto', 'stockMinimo', COLUMN_DEFINITIONS.intDefault5],
      ['venta', 'tipo', {
        types: ['enum'], nullable: false, default: 'pagada', enumValues: ['pagada', 'fiada']
      }],
      ['fiado', 'idVenta', COLUMN_DEFINITIONS.intNullable]
    ],
    indexes: [
      ['producto', 'fk_producto_proveedor', ['idProveedor'], false],
      ['fiado', 'fk_fiado_venta', ['idVenta'], false]
    ],
    foreignKeys: [
      ['producto', 'fk_producto_proveedor', ['idProveedor'], 'proveedor', ['idProveedor'], 'restrict', 'restrict'],
      ['fiado', 'fk_fiado_venta', ['idVenta'], 'venta', ['idVenta'], 'restrict', 'restrict']
    ],
    checks: []
  },
  '002_mejoras_stock_reportes.sql': {
    objetivo: 'Presentaciones, saldo en unidades base y costo/ganancia historicos.',
    dependsOn: ['001_mejoras_tienda.sql'],
    prerequisites: ['producto', 'detalleVenta', 'detalleCompra'],
    addedColumns: [
      ['producto', 'paquetesPorCaja'],
      ['producto', 'stockUnidadesTotal'],
      ['producto', 'ultimoPrecioCompra'],
      ['producto', 'permiteVentaPorPaquete'],
      ['producto', 'permiteVentaPorUnidad'],
      ['detalleVenta', 'costoUnitario'],
      ['detalleVenta', 'subtotalCosto'],
      ['detalleVenta', 'ganancia'],
      ['detalleVenta', 'presentacionVenta'],
      ['detalleVenta', 'cantidadEquivalenteUnidades'],
      ['detalleCompra', 'presentacionCompra'],
      ['detalleCompra', 'cantidadEquivalenteUnidades']
    ],
    columns: [
      ['producto', 'paquetesPorCaja', COLUMN_DEFINITIONS.intDefault1],
      ['producto', 'stockUnidadesTotal', COLUMN_DEFINITIONS.intDefault0],
      ['producto', 'ultimoPrecioCompra', COLUMN_DEFINITIONS.decimalCost],
      ['producto', 'permiteVentaPorPaquete', COLUMN_DEFINITIONS.tinyintDefault1],
      ['producto', 'permiteVentaPorUnidad', COLUMN_DEFINITIONS.tinyintDefault1],
      ['detalleVenta', 'costoUnitario', COLUMN_DEFINITIONS.decimalCost],
      ['detalleVenta', 'subtotalCosto', COLUMN_DEFINITIONS.decimalAmount],
      ['detalleVenta', 'ganancia', COLUMN_DEFINITIONS.decimalAmount],
      ['detalleVenta', 'presentacionVenta', {
        types: ['varchar'], nullable: false, default: 'unidad', characterMaximumLength: 30
      }],
      ['detalleVenta', 'cantidadEquivalenteUnidades', COLUMN_DEFINITIONS.intDefault0],
      ['detalleCompra', 'presentacionCompra', {
        types: ['varchar'], nullable: false, default: 'unidad', characterMaximumLength: 30
      }],
      ['detalleCompra', 'cantidadEquivalenteUnidades', COLUMN_DEFINITIONS.intDefault0]
    ],
    indexes: [],
    foreignKeys: [],
    checks: []
  },
  '003_borrado_logico.sql': {
    objetivo: 'Borrado logico de clientes y fiados sin eliminar historial.',
    dependsOn: ['002_mejoras_stock_reportes.sql'],
    prerequisites: ['cliente', 'fiado'],
    addedColumns: [
      ['cliente', 'activo'],
      ['cliente', 'eliminadoEn'],
      ['fiado', 'activo'],
      ['fiado', 'eliminadoEn']
    ],
    columns: [
      ['cliente', 'activo', COLUMN_DEFINITIONS.tinyintDefault1],
      ['cliente', 'eliminadoEn', { types: ['datetime'], nullable: true }],
      ['fiado', 'activo', COLUMN_DEFINITIONS.tinyintDefault1],
      ['fiado', 'eliminadoEn', { types: ['datetime'], nullable: true }]
    ],
    indexes: [],
    foreignKeys: [],
    checks: []
  }
});

function migrationSpec(name) {
  const spec = MIGRATIONS[name];
  if (!spec) throw new Error(`Migracion historica no soportada: ${name}.`);
  return spec;
}

function isLegacyMigration(name) {
  return LEGACY_MIGRATION_NAMES.includes(name);
}

async function count(connection, sql, params = []) {
  const [[row]] = await connection.query(sql, params);
  return Number(row.total || 0);
}

async function requireSelectedSchema(connection, schemaName) {
  const [[row]] = await connection.query('SELECT DATABASE() selectedDatabase');
  if (identifier(row.selectedDatabase) !== identifier(schemaName)) {
    throw new Error(
      `La conexion selecciono ${row.selectedDatabase || '(ninguna)'} y no la base configurada ${schemaName}.`
    );
  }
}

async function readSchemaSnapshot(connection, schemaName) {
  const [tablesRows] = await connection.query(
    `SELECT TABLE_NAME, ENGINE
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA=?`,
    [schemaName]
  );
  const [columnRows] = await connection.query(
    `SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, COLUMN_TYPE, IS_NULLABLE,
            COLUMN_DEFAULT, CHARACTER_MAXIMUM_LENGTH, NUMERIC_PRECISION,
            NUMERIC_SCALE, EXTRA
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA=?`,
    [schemaName]
  );
  const [indexRows] = await connection.query(
    `SELECT TABLE_NAME, INDEX_NAME, COLUMN_NAME, NON_UNIQUE, SEQ_IN_INDEX
     FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA=?
     ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX`,
    [schemaName]
  );
  const [foreignKeyRows] = await connection.query(
    `SELECT k.TABLE_NAME, k.CONSTRAINT_NAME, k.COLUMN_NAME,
            k.REFERENCED_TABLE_NAME, k.REFERENCED_COLUMN_NAME, k.ORDINAL_POSITION,
            r.UPDATE_RULE, r.DELETE_RULE
     FROM information_schema.KEY_COLUMN_USAGE k
     LEFT JOIN information_schema.REFERENTIAL_CONSTRAINTS r
       ON r.CONSTRAINT_SCHEMA=k.CONSTRAINT_SCHEMA
      AND r.TABLE_NAME=k.TABLE_NAME
      AND r.CONSTRAINT_NAME=k.CONSTRAINT_NAME
     WHERE k.TABLE_SCHEMA=? AND k.REFERENCED_TABLE_NAME IS NOT NULL
     ORDER BY k.TABLE_NAME, k.CONSTRAINT_NAME, k.ORDINAL_POSITION`,
    [schemaName]
  );
  const [checkRows] = await connection.query(
    `SELECT TABLE_NAME, CONSTRAINT_NAME
     FROM information_schema.TABLE_CONSTRAINTS
     WHERE CONSTRAINT_SCHEMA=? AND CONSTRAINT_TYPE='CHECK'`,
    [schemaName]
  );

  const tables = new Map();
  const columns = new Map();
  const indexes = new Map();
  const foreignKeys = new Map();
  const checks = new Set();

  for (const row of tablesRows) {
    tables.set(identifier(row.TABLE_NAME), {
      name: row.TABLE_NAME,
      engine: identifier(row.ENGINE)
    });
  }
  for (const row of columnRows) {
    columns.set(normalizedObjectKey(row.TABLE_NAME, row.COLUMN_NAME), {
      table: row.TABLE_NAME,
      name: row.COLUMN_NAME,
      dataType: identifier(row.DATA_TYPE),
      columnType: identifier(row.COLUMN_TYPE),
      nullable: row.IS_NULLABLE === 'YES',
      default: row.COLUMN_DEFAULT,
      characterMaximumLength: numberValue(row.CHARACTER_MAXIMUM_LENGTH),
      numericPrecision: numberValue(row.NUMERIC_PRECISION),
      numericScale: numberValue(row.NUMERIC_SCALE),
      extra: identifier(row.EXTRA)
    });
  }
  for (const row of indexRows) {
    const key = normalizedObjectKey(row.TABLE_NAME, row.INDEX_NAME);
    if (!indexes.has(key)) {
      indexes.set(key, {
        table: row.TABLE_NAME,
        name: row.INDEX_NAME,
        unique: Number(row.NON_UNIQUE) === 0,
        columns: []
      });
    }
    indexes.get(key).columns.push(identifier(row.COLUMN_NAME));
  }
  for (const row of foreignKeyRows) {
    const key = normalizedObjectKey(row.TABLE_NAME, row.CONSTRAINT_NAME);
    if (!foreignKeys.has(key)) {
      foreignKeys.set(key, {
        table: row.TABLE_NAME,
        name: row.CONSTRAINT_NAME,
        columns: [],
        referencedTable: identifier(row.REFERENCED_TABLE_NAME),
        referencedColumns: [],
        updateRule: identifier(row.UPDATE_RULE),
        deleteRule: identifier(row.DELETE_RULE)
      });
    }
    foreignKeys.get(key).columns.push(identifier(row.COLUMN_NAME));
    foreignKeys.get(key).referencedColumns.push(identifier(row.REFERENCED_COLUMN_NAME));
  }
  for (const row of checkRows) {
    checks.add(normalizedObjectKey(row.TABLE_NAME, row.CONSTRAINT_NAME));
  }

  return { tables, columns, indexes, foreignKeys, checks };
}

function columnMatches(actual, expected) {
  if (!actual) return false;
  if (expected.types && !expected.types.includes(actual.dataType)) return false;
  if (typeof expected.nullable === 'boolean' && actual.nullable !== expected.nullable) return false;
  if (Object.prototype.hasOwnProperty.call(expected, 'default')
    && !defaultsMatch(actual.default, expected.default, actual.dataType)) return false;
  if (expected.characterMaximumLength
    && actual.characterMaximumLength !== expected.characterMaximumLength) return false;
  if (expected.minimumPrecision && actual.numericPrecision < expected.minimumPrecision) return false;
  if (expected.minimumScale && actual.numericScale < expected.minimumScale) return false;
  if (expected.minimumIntegerDigits
    && (actual.numericPrecision - actual.numericScale) < expected.minimumIntegerDigits) return false;
  if (expected.enumValues) {
    const expectedEnum = `enum(${expected.enumValues.map((value) => `'${value}'`).join(',')})`;
    if (actual.columnType !== expectedEnum) return false;
  }
  return true;
}

function migrationIsRegistered(registeredMigrations, name) {
  return registeredMigrations.has(identifier(name));
}

function arraysEqual(actual, expected) {
  return actual.length === expected.length
    && expected.every((value, index) => actual[index] === identifier(value));
}

function hasColumnPrefix(actual, expected) {
  return actual.length >= expected.length
    && expected.every((value, index) => actual[index] === identifier(value));
}

function rulesEquivalent(actual, expected) {
  if (!expected) return true;
  const actualRule = identifier(actual);
  const expectedRule = identifier(expected);
  if (actualRule === expectedRule) return true;
  return ['restrict', 'no action'].includes(actualRule)
    && ['restrict', 'no action'].includes(expectedRule);
}

function findIndex(snapshot, table, columns, unique) {
  return [...snapshot.indexes.values()].find((candidate) => (
    identifier(candidate.table) === identifier(table)
    && hasColumnPrefix(candidate.columns, columns)
    && (!unique || candidate.unique)
  )) || null;
}

function findForeignKey(snapshot, requirement) {
  return [...snapshot.foreignKeys.values()].find((candidate) => (
    identifier(candidate.table) === identifier(requirement.table)
    && candidate.referencedTable === identifier(requirement.referencedTable)
    && arraysEqual(candidate.columns, requirement.columns)
    && arraysEqual(candidate.referencedColumns, requirement.referencedColumns)
    && rulesEquivalent(candidate.updateRule, requirement.updateRule)
    && rulesEquivalent(candidate.deleteRule, requirement.deleteRule)
  )) || null;
}

function resolveColumnRequirement(actual, expected, key, registeredMigrations) {
  const evolution = EVOLVED_COLUMN_REQUIREMENTS[normalizedObjectKey(...key.split('.'))];
  const evolved = evolution && migrationIsRegistered(registeredMigrations, evolution.migration);
  const effectiveExpected = evolved ? evolution.definition : expected;
  const valid = columnMatches(actual, effectiveExpected);
  const widenedDecimal = valid && actual?.dataType === 'decimal'
    && expected.historicalPrecision
    && (actual.numericPrecision !== expected.historicalPrecision
      || actual.numericScale !== expected.historicalScale);
  let status = 'historico-exacto';
  let satisfiedBy = 'definicion historica';
  if (!actual) {
    status = 'faltante';
    satisfiedBy = null;
  } else if (!valid) {
    status = evolved ? 'evolucion-registrada-ausente' : 'incompatible';
    satisfiedBy = null;
  } else if (evolved) {
    status = 'equivalente-evolucionado';
    satisfiedBy = evolution.description;
  } else if (widenedDecimal) {
    status = 'equivalente-compatible';
    satisfiedBy = 'decimal ampliado sin perdida de rango ni escala historicos';
  }
  return {
    valid,
    requirement: key,
    requisito: key,
    satisfechoPor: satisfiedBy,
    columnaReal: actual ? `${actual.table}.${actual.name}` : null,
    definicionReal: actual?.columnType || null,
    migracionEvolutiva: evolved ? evolution.migration : null,
    estado: status
  };
}

function resolveIndexRequirement(snapshot, requirement, registeredMigrations) {
  const [table, name, historicalColumns, unique] = requirement;
  const key = `${table}.${name}`;
  const evolution = EVOLVED_INDEX_REQUIREMENTS[normalizedObjectKey(table, name)];
  const evolved = evolution && migrationIsRegistered(registeredMigrations, evolution.migration);
  const expectedColumns = evolved ? evolution.columns : historicalColumns;
  const actual = findIndex(snapshot, table, expectedColumns, unique);
  return {
    valid: Boolean(actual),
    requisito: key,
    satisfechoPor: actual
      ? (evolved ? evolution.description : 'indice historico equivalente por prefijo de columnas')
      : null,
    indiceReal: actual?.name || null,
    columnasReales: actual?.columns || [],
    migracionEvolutiva: evolved ? evolution.migration : null,
    estado: actual ? (evolved ? 'equivalente-evolucionado' : 'historico-valido') : 'faltante'
  };
}

function resolveForeignKeyRequirement(snapshot, requirement, registeredMigrations) {
  const [
    table, name, historicalColumns, referencedTable, historicalReferencedColumns,
    updateRule, deleteRule
  ] = requirement;
  const key = `${table}.${name}`;
  const evolution = EVOLVED_FOREIGN_KEY_REQUIREMENTS[normalizedObjectKey(table, name)];
  const evolved = evolution && migrationIsRegistered(registeredMigrations, evolution.migration);
  const effective = evolved ? {
    table,
    columns: evolution.columns,
    referencedTable: evolution.referencedTable,
    referencedColumns: evolution.referencedColumns,
    updateRule,
    deleteRule
  } : {
    table,
    columns: historicalColumns,
    referencedTable,
    referencedColumns: historicalReferencedColumns,
    updateRule,
    deleteRule
  };
  const actual = findForeignKey(snapshot, effective);
  return {
    valid: Boolean(actual),
    requisito: key,
    satisfechoPor: actual
      ? (evolved ? evolution.description : 'fk historica equivalente por relacion')
      : null,
    constraintReal: actual?.name || null,
    columnasReales: actual?.columns || [],
    referenciaReal: actual
      ? `${actual.referencedTable}(${actual.referencedColumns.join(',')})`
      : null,
    migracionEvolutiva: evolved ? evolution.migration : null,
    estado: actual ? (evolved ? 'equivalente-evolucionado' : 'historico-valido') : 'faltante'
  };
}

function inspectStructure(snapshot, spec, registeredMigrations = new Set()) {
  const tables = {};
  const engines = {};
  const columns = {};
  const details = {};
  const indexes = {};
  const foreignKeys = {};
  const checks = {};
  const requirementResolution = { columnas: {}, indices: {}, clavesForaneas: {} };
  const missing = [];
  const conflicts = [];

  for (const table of spec.prerequisites) {
    const tableDetails = snapshot.tables.get(identifier(table));
    const present = Boolean(tableDetails);
    tables[table] = present;
    engines[table] = tableDetails?.engine || null;
    if (!present) missing.push(`tabla:${table}`);
    else if (tableDetails.engine !== 'innodb') conflicts.push(`motor:${table}`);
  }
  for (const [table, column, expected] of spec.columns) {
    const key = `${table}.${column}`;
    const actual = snapshot.columns.get(normalizedObjectKey(table, column));
    const present = Boolean(actual);
    const resolution = resolveColumnRequirement(actual, expected, key, registeredMigrations);
    const valid = resolution.valid;
    columns[key] = valid;
    details[key] = actual || null;
    requirementResolution.columnas[key] = resolution;
    if (!present) missing.push(`columna:${key}`);
    else if (!valid) {
      const pendingDefinition = spec.pendingColumns?.[key];
      if (!pendingDefinition || !columnMatches(actual, pendingDefinition)) {
        conflicts.push(`columna:${key}`);
      }
    }
  }
  for (const requirement of spec.indexes) {
    const [table, name] = requirement;
    const key = `${table}.${name}`;
    const resolution = resolveIndexRequirement(snapshot, requirement, registeredMigrations);
    indexes[key] = resolution.valid;
    requirementResolution.indices[key] = resolution;
    if (!resolution.valid) missing.push(`indice:${key}`);
  }
  for (const requirement of spec.foreignKeys) {
    const [table, name] = requirement;
    const key = `${table}.${name}`;
    const resolution = resolveForeignKeyRequirement(snapshot, requirement, registeredMigrations);
    foreignKeys[key] = resolution.valid;
    requirementResolution.clavesForaneas[key] = resolution;
    if (!resolution.valid) missing.push(`fk:${key}`);
  }
  for (const [table, name] of spec.checks) {
    const key = `${table}.${name}`;
    const valid = snapshot.checks.has(normalizedObjectKey(table, name));
    checks[key] = valid;
    if (!valid) missing.push(`check:${key}`);
  }

  return {
    tables,
    engines,
    columns,
    details,
    indexes,
    checks,
    foreignKeys,
    requirementResolution,
    missing,
    conflicts,
    complete: missing.length === 0 && conflicts.length === 0
  };
}

function hasSnapshotColumns(snapshot, table, names) {
  return snapshot.tables.has(identifier(table))
    && names.every((name) => snapshot.columns.has(normalizedObjectKey(table, name)));
}

async function inspect001Data(connection, snapshot) {
  const backfill = {
    productosCategoria: null,
    productosUnidadesPaquete: null,
    productosStockRedondear: null,
    productosStockMinimoRedondear: null
  };
  const invalid = {
    productosStockNulo: null,
    productosStockMinimoNulo: null,
    proveedoresDuplicados: null,
    ventasDuplicadas: null,
    proveedorSinClaveUnica: null,
    ventaSinClaveUnica: null
  };
  const broken = {
    proveedoresInexistentes: null,
    ventasInexistentes: null
  };
  const violations = {};
  if (hasSnapshotColumns(snapshot, 'producto', ['stock', 'stockMinimo'])) {
    const [[row]] = await connection.query(
      `SELECT
         SUM(stock IS NOT NULL AND (stock<0 OR stock<>ROUND(stock))) productosStockRedondear,
         SUM(stockMinimo IS NOT NULL AND (stockMinimo<1 OR stockMinimo<>ROUND(stockMinimo))) productosStockMinimoRedondear,
         SUM(stock IS NULL) productosStockNulo,
         SUM(stockMinimo IS NULL) productosStockMinimoNulo
       FROM producto`
    );
    backfill.productosStockRedondear = Number(row.productosStockRedondear || 0);
    backfill.productosStockMinimoRedondear = Number(row.productosStockMinimoRedondear || 0);
    invalid.productosStockNulo = Number(row.productosStockNulo || 0);
    invalid.productosStockMinimoNulo = Number(row.productosStockMinimoNulo || 0);
  }
  if (hasSnapshotColumns(snapshot, 'producto', ['categoria'])) {
    backfill.productosCategoria = await count(
      connection,
      'SELECT COUNT(*) total FROM producto WHERE categoria IS NULL OR CHAR_LENGTH(TRIM(categoria))=0'
    );
  }
  if (hasSnapshotColumns(snapshot, 'producto', ['unidadesPorPaquete'])) {
    backfill.productosUnidadesPaquete = await count(
      connection,
      'SELECT COUNT(*) total FROM producto WHERE unidadesPorPaquete IS NULL OR unidadesPorPaquete<1'
    );
  }
  if (hasSnapshotColumns(snapshot, 'producto', ['idProveedor'])
    && hasSnapshotColumns(snapshot, 'proveedor', ['idProveedor'])) {
    broken.proveedoresInexistentes = await count(
      connection,
      `SELECT COUNT(*) total FROM producto p
       LEFT JOIN proveedor pr ON pr.idProveedor=p.idProveedor
       WHERE p.idProveedor IS NOT NULL AND pr.idProveedor IS NULL`
    );
    invalid.proveedoresDuplicados = await count(
      connection,
      `SELECT COUNT(*) total FROM (
         SELECT idProveedor FROM proveedor GROUP BY idProveedor HAVING COUNT(*)>1
       ) duplicados`
    );
    invalid.proveedorSinClaveUnica = [...snapshot.indexes.values()].some((index) => (
      identifier(index.table) === 'proveedor'
      && index.unique
      && index.columns[0] === 'idproveedor'
    )) ? 0 : 1;
  }
  if (hasSnapshotColumns(snapshot, 'fiado', ['idVenta'])
    && hasSnapshotColumns(snapshot, 'venta', ['idVenta'])) {
    broken.ventasInexistentes = await count(
      connection,
      `SELECT COUNT(*) total FROM fiado f
       LEFT JOIN venta v ON v.idVenta=f.idVenta
       WHERE f.idVenta IS NOT NULL AND v.idVenta IS NULL`
    );
    invalid.ventasDuplicadas = await count(
      connection,
      `SELECT COUNT(*) total FROM (
         SELECT idVenta FROM venta GROUP BY idVenta HAVING COUNT(*)>1
       ) duplicados`
    );
    invalid.ventaSinClaveUnica = [...snapshot.indexes.values()].some((index) => (
      identifier(index.table) === 'venta'
      && index.unique
      && index.columns[0] === 'idventa'
    )) ? 0 : 1;
  }
  for (const [key, value] of Object.entries(backfill)) violations[key] = value;
  return { backfill, invalid, broken, violations };
}

async function inspect002Data(connection, snapshot) {
  const backfill = {
    productos: null,
    detallesVenta: null,
    detallesCompra: null
  };
  const invalid = {
    productos: null,
    detallesVenta: null,
    detallesCompra: null
  };
  const violations = {
    productos: null,
    detallesVenta: null,
    detallesCompra: null
  };
  if (hasSnapshotColumns(snapshot, 'producto', [
    'paquetesPorCaja', 'unidadesPorPaquete', 'stock', 'stockMinimo',
    'stockUnidadesTotal', 'permiteVentaPorPaquete', 'permiteVentaPorUnidad'
  ])) {
    const [[row]] = await connection.query(
      `SELECT
         SUM((stockUnidadesTotal>0 AND stockUnidadesTotal<>stock)
           OR permiteVentaPorPaquete NOT IN (0,1)
           OR permiteVentaPorUnidad NOT IN (0,1)) invalidos,
         SUM(BINARY nombre<>BINARY UPPER(nombre)
           OR BINARY categoria<>BINARY UPPER(COALESCE(NULLIF(categoria,''),'OTROS'))
           OR paquetesPorCaja<1 OR unidadesPorPaquete<1 OR stock<0 OR stockMinimo<1
           OR (stockUnidadesTotal<=0 AND stockUnidadesTotal<>stock)
           OR (unidadesPorPaquete<=1 AND permiteVentaPorPaquete<>0)
           OR (permiteVentaPorPaquete=0 AND permiteVentaPorUnidad=0)) pendientes,
         SUM(paquetesPorCaja<1 OR unidadesPorPaquete<1 OR stock<0 OR stockMinimo<1
           OR (stockUnidadesTotal<=0 AND stockUnidadesTotal<>stock)
           OR (unidadesPorPaquete<=1 AND permiteVentaPorPaquete<>0)
           OR (permiteVentaPorPaquete=0 AND permiteVentaPorUnidad=0)) violaciones
       FROM producto`
    );
    invalid.productos = Number(row.invalidos || 0);
    backfill.productos = Number(row.pendientes || 0);
    violations.productos = Number(row.violaciones || 0);
  }
  if (hasSnapshotColumns(snapshot, 'detalleVenta', [
    'costoUnitario', 'subtotalCosto', 'ganancia', 'presentacionVenta',
    'cantidadEquivalenteUnidades'
  ])) {
    const [[row]] = await connection.query(
      `SELECT
         SUM(costoUnitario<0 OR subtotalCosto<0 OR presentacionVenta IS NULL
           OR CHAR_LENGTH(TRIM(presentacionVenta))=0
           OR cantidadEquivalenteUnidades<0) invalidos,
         SUM(cantidadEquivalenteUnidades<=0 AND ROUND(cantidad)>0) pendientes,
         SUM(cantidadEquivalenteUnidades<=0 AND ROUND(cantidad)>0) violaciones
       FROM detalleVenta`
    );
    invalid.detallesVenta = Number(row.invalidos || 0);
    backfill.detallesVenta = Number(row.pendientes || 0);
    violations.detallesVenta = Number(row.violaciones || 0);
  }
  if (hasSnapshotColumns(snapshot, 'detalleCompra', [
    'presentacionCompra', 'cantidadEquivalenteUnidades'
  ])) {
    const [[row]] = await connection.query(
      `SELECT
         SUM(presentacionCompra IS NULL OR CHAR_LENGTH(TRIM(presentacionCompra))=0
           OR cantidadEquivalenteUnidades<0) invalidos,
         SUM(cantidadEquivalenteUnidades<=0 AND ROUND(cantidad)>0) pendientes,
         SUM(cantidadEquivalenteUnidades<=0 AND ROUND(cantidad)>0) violaciones
       FROM detalleCompra`
    );
    invalid.detallesCompra = Number(row.invalidos || 0);
    backfill.detallesCompra = Number(row.pendientes || 0);
    violations.detallesCompra = Number(row.violaciones || 0);
  }
  return { backfill, invalid, broken: {}, violations };
}

async function inspect003Data(connection, snapshot) {
  const invalid = { clientesActivo: null, fiadosActivo: null };
  if (hasSnapshotColumns(snapshot, 'cliente', ['activo'])) {
    invalid.clientesActivo = await count(
      connection,
      'SELECT COUNT(*) total FROM cliente WHERE activo IS NULL OR activo NOT IN (0,1)'
    );
  }
  if (hasSnapshotColumns(snapshot, 'fiado', ['activo'])) {
    invalid.fiadosActivo = await count(
      connection,
      'SELECT COUNT(*) total FROM fiado WHERE activo IS NULL OR activo NOT IN (0,1)'
    );
  }
  return { backfill: {}, invalid, broken: {}, violations: {} };
}

async function inspectMigrationData(connection, name, snapshot) {
  if (name === '001_mejoras_tienda.sql') return inspect001Data(connection, snapshot);
  if (name === '002_mejoras_stock_reportes.sql') return inspect002Data(connection, snapshot);
  return inspect003Data(connection, snapshot);
}

function positiveValues(object) {
  return Object.entries(object)
    .filter(([, value]) => value !== null && Number(value) > 0)
    .map(([key, value]) => `${key}=${value}`);
}

function nullValues(object) {
  return Object.entries(object)
    .filter(([, value]) => value === null)
    .map(([key]) => key);
}

function addedElementsPresent(snapshot, spec) {
  return spec.addedColumns.filter(
    ([table, column]) => snapshot.columns.has(normalizedObjectKey(table, column))
  ).length;
}

function recommendationFor(state, name, details) {
  if (state === 'post') return 'No se requiere accion.';
  if (state === 'pre') return `Haga respaldo y ejecute db:migrate para aplicar ${name}.`;
  if (state === 'completa-no-registrada') {
    return `La estructura puede adoptarse con db:migrate; se validara antes de registrar ${name}.`;
  }
  if (state === 'parcial-recuperable') {
    return `Haga respaldo y reanude con db:migrate; solo se ejecutaran los pasos faltantes de ${name}.`;
  }
  const causes = [...details.conflicts, ...details.blockers];
  return `Intervencion manual requerida antes de continuar con ${name}: ${causes.join(', ') || 'estado inconsistente'}.`;
}

function diagnosticQueries(name, data) {
  const queries = [];
  if (name === '001_mejoras_tienda.sql') {
    if (positiveValues(data.violations).length) {
      queries.push(
        `SELECT idProducto,categoria,unidadesPorPaquete,stock,stockMinimo FROM producto
         WHERE categoria IS NULL OR CHAR_LENGTH(TRIM(categoria))=0
            OR unidadesPorPaquete IS NULL OR unidadesPorPaquete<1
            OR stock<0 OR stock<>ROUND(stock)
            OR stockMinimo<1 OR stockMinimo<>ROUND(stockMinimo)`
      );
    }
    if (Number(data.invalid.productosStockNulo || 0)
      || Number(data.invalid.productosStockMinimoNulo || 0)) {
      queries.push(
        'SELECT idProducto,stock,stockMinimo FROM producto WHERE stock IS NULL OR stockMinimo IS NULL'
      );
    }
    if (Number(data.invalid.proveedoresDuplicados || 0)) {
      queries.push(
        'SELECT idProveedor,COUNT(*) total FROM proveedor GROUP BY idProveedor HAVING COUNT(*)>1'
      );
    }
    if (Number(data.invalid.ventasDuplicadas || 0)) {
      queries.push('SELECT idVenta,COUNT(*) total FROM venta GROUP BY idVenta HAVING COUNT(*)>1');
    }
    if (Number(data.broken.proveedoresInexistentes || 0)) {
      queries.push(
        `SELECT p.idProducto,p.idProveedor FROM producto p
         LEFT JOIN proveedor pr ON pr.idProveedor=p.idProveedor
         WHERE p.idProveedor IS NOT NULL AND pr.idProveedor IS NULL`
      );
    }
    if (Number(data.broken.ventasInexistentes || 0)) {
      queries.push(
        `SELECT f.idFiado,f.idVenta FROM fiado f
         LEFT JOIN venta v ON v.idVenta=f.idVenta
         WHERE f.idVenta IS NOT NULL AND v.idVenta IS NULL`
      );
    }
  } else if (name === '002_mejoras_stock_reportes.sql') {
    if (positiveValues(data.violations).length) {
      queries.push(
        `SELECT idProducto,paquetesPorCaja,unidadesPorPaquete,stock,stockMinimo,
                stockUnidadesTotal,permiteVentaPorPaquete,permiteVentaPorUnidad
         FROM producto
         WHERE paquetesPorCaja<1 OR unidadesPorPaquete<1 OR stock<0 OR stockMinimo<1
            OR (stockUnidadesTotal<=0 AND stockUnidadesTotal<>stock)
            OR (unidadesPorPaquete<=1 AND permiteVentaPorPaquete<>0)
            OR (permiteVentaPorPaquete=0 AND permiteVentaPorUnidad=0)`
      );
    }
    if (Number(data.invalid.productos || 0)) {
      queries.push(
        `SELECT idProducto,paquetesPorCaja,unidadesPorPaquete,stock,stockMinimo,
                stockUnidadesTotal,permiteVentaPorPaquete,permiteVentaPorUnidad
         FROM producto
         WHERE (stockUnidadesTotal>0 AND stockUnidadesTotal<>stock)
            OR permiteVentaPorPaquete NOT IN (0,1)
            OR permiteVentaPorUnidad NOT IN (0,1)`
      );
    }
    if (Number(data.violations.detallesVenta || 0)) {
      queries.push(
        `SELECT idDetalleVenta,cantidad,cantidadEquivalenteUnidades FROM detalleVenta
         WHERE cantidadEquivalenteUnidades<=0 AND ROUND(cantidad)>0`
      );
    }
    if (Number(data.violations.detallesCompra || 0)) {
      queries.push(
        `SELECT idDetalleCompra,cantidad,cantidadEquivalenteUnidades FROM detalleCompra
         WHERE cantidadEquivalenteUnidades<=0 AND ROUND(cantidad)>0`
      );
    }
    if (Number(data.invalid.detallesVenta || 0)) {
      queries.push(
        `SELECT idDetalleVenta,costoUnitario,subtotalCosto,presentacionVenta,cantidadEquivalenteUnidades
         FROM detalleVenta
         WHERE costoUnitario<0 OR subtotalCosto<0 OR presentacionVenta IS NULL
            OR CHAR_LENGTH(TRIM(presentacionVenta))=0 OR cantidadEquivalenteUnidades<0`
      );
    }
    if (Number(data.invalid.detallesCompra || 0)) {
      queries.push(
        `SELECT idDetalleCompra,presentacionCompra,cantidadEquivalenteUnidades
         FROM detalleCompra
         WHERE presentacionCompra IS NULL OR CHAR_LENGTH(TRIM(presentacionCompra))=0
            OR cantidadEquivalenteUnidades<0`
      );
    }
  } else {
    if (Number(data.invalid.clientesActivo || 0)) {
      queries.push('SELECT idCliente,activo FROM cliente WHERE activo IS NULL OR activo NOT IN (0,1)');
    }
    if (Number(data.invalid.fiadosActivo || 0)) {
      queries.push('SELECT idFiado,activo FROM fiado WHERE activo IS NULL OR activo NOT IN (0,1)');
    }
  }
  return queries;
}

async function migrationRegistration(connection, name, schemaName) {
  const schemaMigrations = await count(
    connection,
    `SELECT COUNT(*) total FROM information_schema.TABLES
     WHERE TABLE_SCHEMA=? AND LOWER(TABLE_NAME)='schema_migrations'`,
    [schemaName]
  ) > 0;
  if (!schemaMigrations) {
    return {
      tablePresent: false,
      registryValid: true,
      count: 0,
      registered: false,
      laterRegistrations: 0,
      registeredNames: new Set()
    };
  }
  const registryValid = await count(
    connection,
    `SELECT COUNT(*) total FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA=? AND LOWER(TABLE_NAME)='schema_migrations'
       AND LOWER(COLUMN_NAME)='nombre'`,
    [schemaName]
  ) === 1;
  if (!registryValid) {
    return {
      tablePresent: true,
      registryValid: false,
      count: 0,
      registered: false,
      laterRegistrations: 0,
      registeredNames: new Set()
    };
  }
  const [registeredRows] = await connection.query('SELECT nombre FROM schema_migrations');
  const registeredNames = new Set(registeredRows.map((row) => identifier(row.nombre)));
  const registrationCount = await count(
    connection,
    'SELECT COUNT(*) total FROM schema_migrations WHERE LOWER(nombre)=LOWER(?)',
    [name]
  );
  const laterRegistrations = await count(
    connection,
    `SELECT COUNT(*) total FROM schema_migrations
     WHERE nombre REGEXP '^[0-9]{3}_' AND LEFT(nombre,3)>?`,
    [name.slice(0, 3)]
  );
  return {
    tablePresent: true,
    registryValid: true,
    count: registrationCount,
    registered: registrationCount === 1,
    laterRegistrations,
    registeredNames
  };
}

async function inspectLegacyMigration(connection, name, options = {}) {
  const schemaName = String(options.schemaName || process.env.DB_NAME || '').trim();
  if (!schemaName) throw new Error('Se requiere el nombre de la base para inspeccionar migraciones historicas.');
  await requireSelectedSchema(connection, schemaName);
  const spec = migrationSpec(name);
  const snapshot = options.snapshot || await readSchemaSnapshot(connection, schemaName);
  const registration = await migrationRegistration(connection, name, schemaName);
  const structure = inspectStructure(snapshot, spec, registration.registeredNames);
  const data = await inspectMigrationData(connection, name, snapshot);
  const presentAddedElements = addedElementsPresent(snapshot, spec);
  const missingPrerequisites = Object.entries(structure.tables)
    .filter(([, present]) => !present)
    .map(([table]) => `tabla-base:${table}`);
  const backfillPending = positiveValues(data.backfill);
  const invalidData = positiveValues(data.invalid);
  const durableViolations = positiveValues(data.violations);
  const brokenReferences = positiveValues(data.broken);
  const unavailableDataChecks = [...new Set([
    ...nullValues(data.invalid),
    ...nullValues(data.broken),
    ...nullValues(data.violations)
  ])];
  const blockers = [
    ...missingPrerequisites,
    ...invalidData,
    ...brokenReferences,
    ...(!registration.registryValid ? ['schema_migrations-sin-columna-nombre'] : []),
    ...(registration.count > 1 ? [`registro-duplicado:${registration.count}`] : [])
  ];
  const backfillMustBeProven = !registration.registered && registration.laterRegistrations === 0;
  if (!backfillMustBeProven && durableViolations.length > 0) {
    blockers.push(...durableViolations.map((item) => `dato-fuera-de-invariante:${item}`));
  }
  const physicallyComplete = structure.complete
    && (!backfillMustBeProven || backfillPending.length === 0);
  const dataValid = blockers.length === 0;

  let state;
  if (registration.registered) {
    state = physicallyComplete && dataValid ? 'post' : 'inconsistente';
  } else if (registration.count > 0) {
    state = 'inconsistente';
  } else if (registration.laterRegistrations > 0 && (!structure.complete || !dataValid)) {
    state = 'inconsistente';
  } else if (physicallyComplete && dataValid) {
    state = 'completa-no-registrada';
  } else if (presentAddedElements === 0 && structure.conflicts.length === 0
    && missingPrerequisites.length === 0) {
    state = blockers.length ? 'parcial-bloqueante' : 'pre';
  } else if (structure.conflicts.length || blockers.length) {
    state = structure.conflicts.length ? 'inconsistente' : 'parcial-bloqueante';
  } else {
    state = 'parcial-recuperable';
  }

  const details = {
    conflicts: structure.conflicts,
    blockers
  };
  return {
    nombre: name,
    objetivo: spec.objetivo,
    dependencias: spec.dependsOn,
    registrada: registration.registered,
    registroMigracionesValido: registration.registryValid,
    registrosEncontrados: registration.count,
    migracionesPosterioresRegistradas: registration.laterRegistrations,
    contextoEvolucionado: registration.laterRegistrations > 0,
    estado: state,
    tablas: structure.tables,
    motores: structure.engines,
    columnas: structure.columns,
    detallesColumnas: structure.details,
    indices: structure.indexes,
    checks: structure.checks,
    clavesForaneas: structure.foreignKeys,
    resolucionRequisitos: structure.requirementResolution,
    equivalenciasEvolucionadas: [
      ...Object.values(structure.requirementResolution.columnas),
      ...Object.values(structure.requirementResolution.indices),
      ...Object.values(structure.requirementResolution.clavesForaneas)
    ].filter((item) => item.estado === 'equivalente-evolucionado'),
    estructuraCompleta: structure.complete,
    elementosFaltantes: structure.missing,
    elementosIncompatibles: structure.conflicts,
    datosQueRequierenBackfill: data.backfill,
    backfillHistoricoExigible: backfillMustBeProven,
    invariantesDeDatosIncumplidas: data.violations,
    datosInvalidos: data.invalid,
    referenciasRotas: data.broken,
    consultasDiagnostico: diagnosticQueries(name, data),
    validacionesNoAplicablesAun: unavailableDataChecks,
    datosValidos: dataValid,
    reparacionFisicaSegura: structure.conflicts.length === 0 && blockers.length === 0,
    recuperableAutomaticamente: ['pre', 'parcial-recuperable', 'completa-no-registrada'].includes(state),
    requiereRespaldo: state !== 'post',
    comandoSugerido: ['pre', 'parcial-recuperable', 'completa-no-registrada'].includes(state)
      ? 'npm.cmd run db:migrate'
      : 'npm.cmd run db:check-legacy-migrations',
    recomendacion: recommendationFor(state, name, details)
  };
}

async function inspectAllLegacyMigrations(connection, options = {}) {
  const schemaName = String(options.schemaName || process.env.DB_NAME || '').trim();
  await requireSelectedSchema(connection, schemaName);
  const snapshot = await readSchemaSnapshot(connection, schemaName);
  const migrations = [];
  for (const name of LEGACY_MIGRATION_NAMES) {
    const migration = await inspectLegacyMigration(connection, name, { schemaName, snapshot });
    const pendingDependencies = migration.dependencias.filter((dependency) => {
      const previous = migrations.find((item) => item.nombre === dependency);
      return !previous || !COMPLETE_STATES.has(previous.estado);
    });
    const blockingDependencies = pendingDependencies.filter((dependency) => {
      const previous = migrations.find((item) => item.nombre === dependency);
      return !previous || ['parcial-bloqueante', 'inconsistente'].includes(previous.estado);
    });
    migration.dependenciasIncompletas = pendingDependencies;
    migration.dependenciasBloqueantes = blockingDependencies;
    if (blockingDependencies.length && migration.estado !== 'pre') {
      migration.estado = migration.registrada ? 'inconsistente' : 'parcial-bloqueante';
      migration.datosValidos = false;
      migration.recuperableAutomaticamente = false;
      migration.requiereRespaldo = true;
      migration.comandoSugerido = 'npm.cmd run db:check-legacy-migrations';
      migration.recomendacion = `Resuelva primero: ${blockingDependencies.join(', ')}.`;
    }
    migrations.push(migration);
  }
  return migrations;
}

async function columnIsValid(connection, schemaName, table, column, expected) {
  const snapshot = await readSchemaSnapshot(connection, schemaName);
  return columnMatches(snapshot.columns.get(normalizedObjectKey(table, column)), expected);
}

async function foreignKeyIsValid(connection, schemaName, migrationName, expected) {
  const snapshot = await readSchemaSnapshot(connection, schemaName);
  const registration = await migrationRegistration(connection, migrationName, schemaName);
  return resolveForeignKeyRequirement(snapshot, expected, registration.registeredNames).valid;
}

function columnStep(id, table, column, definition, sql) {
  return {
    id,
    isComplete: (connection, schemaName) => columnIsValid(connection, schemaName, table, column, definition),
    execute: (connection) => connection.query(sql)
  };
}

function foreignKeyStep(id, migrationName, expected, sql, validate) {
  return {
    id,
    isComplete: (connection, schemaName) => (
      foreignKeyIsValid(connection, schemaName, migrationName, expected)
    ),
    before: validate,
    execute: (connection) => connection.query(sql)
  };
}

async function requireUniqueParentKey(connection, table, column) {
  const total = await count(
    connection,
    `SELECT COUNT(*) total FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA=DATABASE() AND LOWER(TABLE_NAME)=LOWER(?)
       AND LOWER(COLUMN_NAME)=LOWER(?) AND SEQ_IN_INDEX=1 AND NON_UNIQUE=0`,
    [table, column]
  );
  if (!total) throw new Error(`La tabla ${table} no tiene una clave unica iniciada por ${column}.`);
}

function backfillStep(id, pendingKey, sql) {
  return {
    id,
    isComplete: async (connection, schemaName, name) => {
      const state = await inspectLegacyMigration(connection, name, { schemaName });
      const values = state.datosQueRequierenBackfill;
      if (Array.isArray(pendingKey)) return pendingKey.every((key) => Number(values[key] || 0) === 0);
      return Number(values[pendingKey] || 0) === 0;
    },
    execute: (connection) => connection.query(sql)
  };
}

function legacySteps(name) {
  if (name === '001_mejoras_tienda.sql') {
    return [
      columnStep('producto.idProveedor', 'producto', 'idProveedor', COLUMN_DEFINITIONS.intNullable,
        'ALTER TABLE producto ADD COLUMN idProveedor INT NULL AFTER nombre'),
      columnStep('producto.categoria', 'producto', 'categoria', MIGRATIONS[name].columns[1][2],
        "ALTER TABLE producto ADD COLUMN categoria VARCHAR(50) NOT NULL DEFAULT 'otros' AFTER idProveedor"),
      columnStep('producto.unidadesPorPaquete', 'producto', 'unidadesPorPaquete', COLUMN_DEFINITIONS.intDefault1,
        'ALTER TABLE producto ADD COLUMN unidadesPorPaquete INT NOT NULL DEFAULT 1 AFTER unidadMedida'),
      backfillStep('producto.normalizacion', [
        'productosCategoria', 'productosUnidadesPaquete', 'productosStockRedondear',
        'productosStockMinimoRedondear'
      ], `UPDATE producto SET
        categoria=COALESCE(NULLIF(categoria, ''), 'otros'),
        unidadesPorPaquete=CASE WHEN unidadesPorPaquete IS NULL OR unidadesPorPaquete<1 THEN 1 ELSE unidadesPorPaquete END,
        stock=CASE WHEN stock<0 THEN 0 ELSE ROUND(stock) END,
        stockMinimo=CASE WHEN stockMinimo<1 THEN 1 ELSE ROUND(stockMinimo) END`),
      columnStep('producto.stock', 'producto', 'stock', COLUMN_DEFINITIONS.intDefault0,
        'ALTER TABLE producto MODIFY COLUMN stock INT NOT NULL DEFAULT 0'),
      columnStep('producto.stockMinimo', 'producto', 'stockMinimo', COLUMN_DEFINITIONS.intDefault5,
        'ALTER TABLE producto MODIFY COLUMN stockMinimo INT NOT NULL DEFAULT 5'),
      foreignKeyStep('producto.fk_producto_proveedor', name, MIGRATIONS[name].foreignKeys[0],
        `ALTER TABLE producto ADD CONSTRAINT fk_producto_proveedor
         FOREIGN KEY (idProveedor) REFERENCES proveedor(idProveedor)`,
        async (connection) => {
          await requireUniqueParentKey(connection, 'proveedor', 'idProveedor');
          const total = await count(connection,
            `SELECT COUNT(*) total FROM producto p LEFT JOIN proveedor pr ON pr.idProveedor=p.idProveedor
             WHERE p.idProveedor IS NOT NULL AND pr.idProveedor IS NULL`);
          if (total) throw new Error(`Existen ${total} productos con proveedor inexistente.`);
        }),
      columnStep('venta.tipo', 'venta', 'tipo', MIGRATIONS[name].columns[5][2],
        "ALTER TABLE venta ADD COLUMN tipo ENUM('pagada','fiada') NOT NULL DEFAULT 'pagada' AFTER total"),
      columnStep('fiado.idVenta', 'fiado', 'idVenta', COLUMN_DEFINITIONS.intNullable,
        'ALTER TABLE fiado ADD COLUMN idVenta INT NULL AFTER idCliente'),
      foreignKeyStep('fiado.fk_fiado_venta', name, MIGRATIONS[name].foreignKeys[1],
        `ALTER TABLE fiado ADD CONSTRAINT fk_fiado_venta
         FOREIGN KEY (idVenta) REFERENCES venta(idVenta)`,
        async (connection) => {
          await requireUniqueParentKey(connection, 'venta', 'idVenta');
          const total = await count(connection,
            `SELECT COUNT(*) total FROM fiado f LEFT JOIN venta v ON v.idVenta=f.idVenta
             WHERE f.idVenta IS NOT NULL AND v.idVenta IS NULL`);
          if (total) throw new Error(`Existen ${total} fiados con venta inexistente.`);
        })
    ];
  }
  if (name === '002_mejoras_stock_reportes.sql') {
    const productColumns = MIGRATIONS[name].columns.slice(0, 5);
    const saleColumns = MIGRATIONS[name].columns.slice(5, 10);
    const purchaseColumns = MIGRATIONS[name].columns.slice(10);
    return [
      columnStep('producto.paquetesPorCaja', 'producto', 'paquetesPorCaja', productColumns[0][2],
        'ALTER TABLE producto ADD COLUMN paquetesPorCaja INT NOT NULL DEFAULT 1 AFTER unidadesPorPaquete'),
      columnStep('producto.stockUnidadesTotal', 'producto', 'stockUnidadesTotal', productColumns[1][2],
        'ALTER TABLE producto ADD COLUMN stockUnidadesTotal INT NOT NULL DEFAULT 0 AFTER stockMinimo'),
      columnStep('producto.ultimoPrecioCompra', 'producto', 'ultimoPrecioCompra', productColumns[2][2],
        'ALTER TABLE producto ADD COLUMN ultimoPrecioCompra DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER stockUnidadesTotal'),
      columnStep('producto.permiteVentaPorPaquete', 'producto', 'permiteVentaPorPaquete', productColumns[3][2],
        'ALTER TABLE producto ADD COLUMN permiteVentaPorPaquete BOOLEAN NOT NULL DEFAULT TRUE AFTER ultimoPrecioCompra'),
      columnStep('producto.permiteVentaPorUnidad', 'producto', 'permiteVentaPorUnidad', productColumns[4][2],
        'ALTER TABLE producto ADD COLUMN permiteVentaPorUnidad BOOLEAN NOT NULL DEFAULT TRUE AFTER permiteVentaPorPaquete'),
      backfillStep('producto.stock-presentaciones', 'productos', `UPDATE producto SET
        nombre=UPPER(nombre),
        categoria=UPPER(COALESCE(NULLIF(categoria, ''), 'OTROS')),
        paquetesPorCaja=CASE WHEN paquetesPorCaja<1 THEN 1 ELSE paquetesPorCaja END,
        unidadesPorPaquete=CASE WHEN unidadesPorPaquete<1 THEN 1 ELSE unidadesPorPaquete END,
        stock=CASE WHEN stock<0 THEN 0 ELSE stock END,
        stockMinimo=CASE WHEN stockMinimo<1 THEN 1 ELSE stockMinimo END,
        stockUnidadesTotal=CASE WHEN stockUnidadesTotal>0 THEN stockUnidadesTotal ELSE stock END,
        permiteVentaPorPaquete=CASE WHEN unidadesPorPaquete>1 THEN permiteVentaPorPaquete ELSE FALSE END,
        permiteVentaPorUnidad=TRUE`),
      columnStep('detalleVenta.costoUnitario', 'detalleVenta', 'costoUnitario', saleColumns[0][2],
        'ALTER TABLE detalleVenta ADD COLUMN costoUnitario DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER precioVenta'),
      columnStep('detalleVenta.subtotalCosto', 'detalleVenta', 'subtotalCosto', saleColumns[1][2],
        'ALTER TABLE detalleVenta ADD COLUMN subtotalCosto DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER subtotal'),
      columnStep('detalleVenta.ganancia', 'detalleVenta', 'ganancia', saleColumns[2][2],
        'ALTER TABLE detalleVenta ADD COLUMN ganancia DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER subtotalCosto'),
      columnStep('detalleVenta.presentacionVenta', 'detalleVenta', 'presentacionVenta', saleColumns[3][2],
        "ALTER TABLE detalleVenta ADD COLUMN presentacionVenta VARCHAR(30) NOT NULL DEFAULT 'unidad' AFTER ganancia"),
      columnStep('detalleVenta.cantidadEquivalenteUnidades', 'detalleVenta', 'cantidadEquivalenteUnidades', saleColumns[4][2],
        'ALTER TABLE detalleVenta ADD COLUMN cantidadEquivalenteUnidades INT NOT NULL DEFAULT 0 AFTER presentacionVenta'),
      backfillStep('detalleVenta.costos', 'detallesVenta', `UPDATE detalleVenta dv
        JOIN producto p ON p.idProducto=dv.idProducto
        SET dv.costoUnitario=COALESCE(NULLIF(dv.costoUnitario,0),p.ultimoPrecioCompra,0),
            dv.cantidadEquivalenteUnidades=CASE WHEN dv.cantidadEquivalenteUnidades>0
              THEN dv.cantidadEquivalenteUnidades ELSE ROUND(dv.cantidad) END,
            dv.subtotalCosto=COALESCE(NULLIF(dv.subtotalCosto,0),COALESCE(p.ultimoPrecioCompra,0)*ROUND(dv.cantidad)),
            dv.ganancia=dv.subtotal-COALESCE(NULLIF(dv.subtotalCosto,0),COALESCE(p.ultimoPrecioCompra,0)*ROUND(dv.cantidad))`),
      columnStep('detalleCompra.presentacionCompra', 'detalleCompra', 'presentacionCompra', purchaseColumns[0][2],
        "ALTER TABLE detalleCompra ADD COLUMN presentacionCompra VARCHAR(30) NOT NULL DEFAULT 'unidad' AFTER subtotal"),
      columnStep('detalleCompra.cantidadEquivalenteUnidades', 'detalleCompra', 'cantidadEquivalenteUnidades', purchaseColumns[1][2],
        'ALTER TABLE detalleCompra ADD COLUMN cantidadEquivalenteUnidades INT NOT NULL DEFAULT 0 AFTER presentacionCompra'),
      backfillStep('detalleCompra.unidades', 'detallesCompra', `UPDATE detalleCompra
        SET cantidadEquivalenteUnidades=CASE WHEN cantidadEquivalenteUnidades>0
          THEN cantidadEquivalenteUnidades ELSE ROUND(cantidad) END`)
    ];
  }
  return [
    columnStep('cliente.activo', 'cliente', 'activo', COLUMN_DEFINITIONS.tinyintDefault1,
      'ALTER TABLE cliente ADD COLUMN activo TINYINT(1) NOT NULL DEFAULT 1 AFTER telefono'),
    columnStep('cliente.eliminadoEn', 'cliente', 'eliminadoEn', MIGRATIONS[name].columns[1][2],
      'ALTER TABLE cliente ADD COLUMN eliminadoEn DATETIME NULL AFTER activo'),
    columnStep('fiado.activo', 'fiado', 'activo', COLUMN_DEFINITIONS.tinyintDefault1,
      'ALTER TABLE fiado ADD COLUMN activo TINYINT(1) NOT NULL DEFAULT 1 AFTER estado'),
    columnStep('fiado.eliminadoEn', 'fiado', 'eliminadoEn', MIGRATIONS[name].columns[3][2],
      'ALTER TABLE fiado ADD COLUMN eliminadoEn DATETIME NULL AFTER activo')
  ];
}

async function applyLegacyMigration(connection, name, options = {}) {
  const schemaName = String(options.schemaName || process.env.DB_NAME || '').trim();
  const log = typeof options.log === 'function' ? options.log : () => {};
  const initial = await inspectLegacyMigration(connection, name, { schemaName });
  if (!['pre', 'parcial-recuperable'].includes(initial.estado)) {
    throw new Error(
      `No se puede ejecutar ${name} desde el estado ${initial.estado}. ${initial.recomendacion}`
    );
  }
  const steps = legacySteps(name);
  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index];
    if (await step.isComplete(connection, schemaName, name)) {
      log(`Paso historico ${index + 1}/${steps.length} omitido: ${step.id}.`);
    } else {
      if (step.before) await step.before(connection);
      log(`Paso historico ${index + 1}/${steps.length}: ${step.id}.`);
      await step.execute(connection);
      if (!await step.isComplete(connection, schemaName, name)) {
        throw new Error(`El paso ${step.id} de ${name} no cumplio su postcondicion.`);
      }
    }
    if (options.stopAfterStep === index + 1) {
      const error = new Error(`Interrupcion simulada despues de ${step.id}.`);
      error.code = 'LEGACY_MIGRATION_INTERRUPTED';
      throw error;
    }
  }
  const finalState = await inspectLegacyMigration(connection, name, { schemaName });
  if (finalState.estado !== 'completa-no-registrada') {
    throw new Error(
      `${name} termino en estado ${finalState.estado}. ${finalState.recomendacion}`
    );
  }
  return finalState;
}

async function registerLegacyMigration(connection, name, options = {}) {
  const schemaName = String(options.schemaName || process.env.DB_NAME || '').trim();
  const state = await inspectLegacyMigration(connection, name, { schemaName });
  if (state.estado !== 'completa-no-registrada') {
    throw new Error(`No se registrara ${name}: estado fisico ${state.estado}.`);
  }
  const registration = await migrationRegistration(connection, name, schemaName);
  if (registration.count === 0) {
    await connection.query('INSERT IGNORE INTO schema_migrations (nombre) VALUES (?)', [name]);
  }
  const finalState = await inspectLegacyMigration(connection, name, { schemaName });
  if (finalState.estado !== 'post') {
    throw new Error(`No se pudo confirmar el registro final de ${name}.`);
  }
  return finalState;
}

async function migrateLegacyMigration(connection, name, options = {}) {
  const schemaName = String(options.schemaName || process.env.DB_NAME || '').trim();
  let state = await inspectLegacyMigration(connection, name, { schemaName });
  if (state.estado === 'post') return { action: 'ya-registrada', state };
  if (state.estado === 'completa-no-registrada') {
    state = await registerLegacyMigration(connection, name, { schemaName });
    return { action: 'estructura-adoptada', state };
  }
  if (!['pre', 'parcial-recuperable'].includes(state.estado)) {
    throw new Error(`${name} no puede recuperarse automaticamente. ${state.recomendacion}`);
  }
  await applyLegacyMigration(connection, name, {
    schemaName,
    log: options.log,
    stopAfterStep: options.stopAfterStep
  });
  state = await registerLegacyMigration(connection, name, { schemaName });
  return { action: 'aplicada-o-recuperada', state };
}

module.exports = {
  COMPLETE_STATES,
  LEGACY_MIGRATION_NAMES,
  MIGRATIONS,
  applyLegacyMigration,
  inspectAllLegacyMigrations,
  inspectLegacyMigration,
  isLegacyMigration,
  legacySteps,
  migrateLegacyMigration,
  normalizedObjectKey,
  readSchemaSnapshot,
  registerLegacyMigration
};
