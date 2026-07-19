const { databaseConfig, databaseTarget, logDatabaseTarget } = require('../config/env');
const { createConnection } = require('./db-utils');

const MIGRATION = '011_lotes_vencimientos.sql';
const FEATURES = Object.freeze([
  'vencimientos_lote',
  'control_lotes',
  'alertas_vencimiento',
  'trazabilidad_lotes',
  'exportacion_lotes'
]);

const REQUIRED_COLUMNS = Object.freeze({
  configuracionInventarioTienda: ['diasAlertaVencimientoDefault'],
  producto: ['controlaLotes', 'controlaVencimiento', 'diasAlertaVencimiento', 'lotesActivadosEn'],
  loteProducto: [
    'idLoteProducto', 'idTienda', 'idProducto', 'idProveedor', 'idDetalleCompra',
    'codigoLote', 'origen', 'fechaIngreso', 'fechaVencimiento', 'cantidadInicial',
    'cantidadRestante', 'costoUnitarioBase', 'estadoOperativo', 'claveOperacion',
    'creadoEn', 'actualizadoEn', 'idAdministradorCrea', 'idAdministradorActualiza'
  ],
  movimientoLote: [
    'idMovimientoLote', 'idTienda', 'idProducto', 'idLoteProducto',
    'idMovimientoStock', 'tipoRegistro', 'cantidad', 'cantidadAnterior',
    'cantidadPosterior', 'claveOperacion', 'creadoEn', 'idAdministrador'
  ]
});

const COLUMN_DEFINITIONS = Object.freeze({
  configuracionInventarioTienda: {
    diasAlertaVencimientoDefault: { type: 'int', nullable: false, defaultValue: 30 }
  },
  producto: {
    controlaLotes: { type: 'tinyint(1)', nullable: false, defaultValue: 0 },
    controlaVencimiento: { type: 'tinyint(1)', nullable: false, defaultValue: 0 },
    diasAlertaVencimiento: { type: 'int', nullable: true, defaultValue: null },
    lotesActivadosEn: { type: 'datetime', nullable: true, defaultValue: null, extra: '' },
    ultimoPrecioCompra: { type: 'decimal(14,6)', nullable: false, defaultValue: 0 }
  },
  detalleVenta: {
    costoUnitario: { type: 'decimal(14,6)', nullable: false, defaultValue: 0 }
  },
  loteProducto: {
    idLoteProducto: { type: 'bigint', nullable: false, defaultValue: null, extraIncludes: 'auto_increment' },
    idTienda: { type: 'int', nullable: false, defaultValue: null },
    idProducto: { type: 'int', nullable: false, defaultValue: null },
    idProveedor: { type: 'int', nullable: true, defaultValue: null },
    idDetalleCompra: { type: 'int', nullable: true, defaultValue: null },
    codigoLote: { type: 'varchar(80)', nullable: true, defaultValue: null },
    origen: { type: "enum('compra','distribucion_inicial','ajuste_positivo','reversion')", nullable: false, defaultValue: null },
    fechaIngreso: { type: 'datetime', nullable: false, defaultValue: null, extra: '' },
    fechaVencimiento: { type: 'date', nullable: true, defaultValue: null, extra: '' },
    cantidadInicial: { type: 'int', nullable: false, defaultValue: null },
    cantidadRestante: { type: 'int', nullable: false, defaultValue: null },
    costoUnitarioBase: { type: 'decimal(14,6)', nullable: true, defaultValue: null },
    estadoOperativo: { type: "enum('disponible','bloqueado','anulado')", nullable: false, defaultValue: 'disponible' },
    claveOperacion: { type: 'varchar(160)', nullable: false, defaultValue: null },
    creadoEn: { type: 'datetime', nullable: false, defaultValue: null, extra: '' },
    actualizadoEn: { type: 'datetime', nullable: false, defaultValue: null, extra: '' },
    idAdministradorCrea: { type: 'int', nullable: false, defaultValue: null },
    idAdministradorActualiza: { type: 'int', nullable: true, defaultValue: null }
  },
  movimientoLote: {
    idMovimientoLote: { type: 'bigint', nullable: false, defaultValue: null, extraIncludes: 'auto_increment' },
    idTienda: { type: 'int', nullable: false, defaultValue: null },
    idProducto: { type: 'int', nullable: false, defaultValue: null },
    idLoteProducto: { type: 'bigint', nullable: false, defaultValue: null },
    idMovimientoStock: { type: 'bigint', nullable: true, defaultValue: null },
    tipoRegistro: { type: "enum('movimiento_stock','distribucion_inicial')", nullable: false, defaultValue: null },
    cantidad: { type: 'int', nullable: false, defaultValue: null },
    cantidadAnterior: { type: 'int', nullable: false, defaultValue: null },
    cantidadPosterior: { type: 'int', nullable: false, defaultValue: null },
    claveOperacion: { type: 'varchar(160)', nullable: false, defaultValue: null },
    creadoEn: { type: 'datetime', nullable: false, defaultValue: null, extra: '' },
    idAdministrador: { type: 'int', nullable: false, defaultValue: null }
  }
});

const INDEXES = Object.freeze([
  ['detalleCompra', 'uq_detalleCompra_tienda_producto_id', ['idTienda', 'idProducto', 'idDetalleCompra'], true],
  ['movimientoStock', 'uq_movimiento_tienda_producto_id', ['idTienda', 'idProducto', 'idMovimientoStock'], true],
  ['loteProducto', 'PRIMARY', ['idLoteProducto'], true],
  ['loteProducto', 'uq_lote_tienda_producto_id', ['idTienda', 'idProducto', 'idLoteProducto'], true],
  ['loteProducto', 'uq_lote_tienda_clave', ['idTienda', 'claveOperacion'], true],
  ['loteProducto', 'idx_lote_tienda_producto_estado_vencimiento', ['idTienda', 'idProducto', 'estadoOperativo', 'fechaVencimiento'], false],
  ['loteProducto', 'idx_lote_tienda_producto_ingreso', ['idTienda', 'idProducto', 'fechaIngreso', 'idLoteProducto'], false],
  ['loteProducto', 'idx_lote_tienda_proveedor_ingreso', ['idTienda', 'idProveedor', 'fechaIngreso'], false],
  ['loteProducto', 'idx_lote_tienda_detalleCompra', ['idTienda', 'idDetalleCompra'], false],
  ['loteProducto', 'idx_lote_tienda_codigo', ['idTienda', 'codigoLote'], false],
  ['loteProducto', 'idx_lote_tienda_estado_vencimiento', ['idTienda', 'estadoOperativo', 'fechaVencimiento'], false],
  ['movimientoLote', 'PRIMARY', ['idMovimientoLote'], true],
  ['movimientoLote', 'uq_movimientoLote_tienda_clave', ['idTienda', 'claveOperacion'], true],
  ['movimientoLote', 'idx_movimientoLote_tienda_lote_fecha', ['idTienda', 'idLoteProducto', 'creadoEn'], false],
  ['movimientoLote', 'idx_movimientoLote_tienda_movimiento', ['idTienda', 'idMovimientoStock'], false],
  ['movimientoLote', 'idx_movimientoLote_tienda_producto_fecha', ['idTienda', 'idProducto', 'creadoEn'], false],
  ['movimientoLote', 'idx_movimientoLote_tienda_tipo_fecha', ['idTienda', 'tipoRegistro', 'creadoEn'], false]
]);

const CHECKS = Object.freeze([
  ['configuracionInventarioTienda', 'chk_configInventario_alerta_vencimiento'],
  ['producto', 'chk_producto_controla_lotes'],
  ['producto', 'chk_producto_controla_vencimiento'],
  ['producto', 'chk_producto_vencimiento_requiere_lotes'],
  ['producto', 'chk_producto_dias_alerta_vencimiento'],
  ['producto', 'chk_producto_lotes_activacion'],
  ['loteProducto', 'chk_lote_cantidades'],
  ['loteProducto', 'chk_lote_costo'],
  ['loteProducto', 'chk_lote_fecha_vencimiento'],
  ['loteProducto', 'chk_lote_codigo'],
  ['loteProducto', 'chk_lote_origen_detalle'],
  ['loteProducto', 'chk_lote_anulado_sin_saldo'],
  ['movimientoLote', 'chk_movimientoLote_cantidad'],
  ['movimientoLote', 'chk_movimientoLote_balance'],
  ['movimientoLote', 'chk_movimientoLote_referencia']
]);

const FOREIGN_KEYS = Object.freeze([
  ['loteProducto', 'fk_lote_tienda', ['idTienda'], 'tienda', ['idTienda'], 'RESTRICT', 'RESTRICT'],
  ['loteProducto', 'fk_lote_producto', ['idTienda', 'idProducto'], 'producto', ['idTienda', 'idProducto'], 'RESTRICT', 'RESTRICT'],
  ['loteProducto', 'fk_lote_proveedor', ['idTienda', 'idProveedor'], 'proveedor', ['idTienda', 'idProveedor'], 'RESTRICT', 'RESTRICT'],
  ['loteProducto', 'fk_lote_detalleCompra', ['idTienda', 'idProducto', 'idDetalleCompra'], 'detalleCompra', ['idTienda', 'idProducto', 'idDetalleCompra'], 'RESTRICT', 'RESTRICT'],
  ['loteProducto', 'fk_lote_admin_crea', ['idTienda', 'idAdministradorCrea'], 'administrador', ['idTienda', 'idAdministrador'], 'RESTRICT', 'RESTRICT'],
  ['loteProducto', 'fk_lote_admin_actualiza', ['idTienda', 'idAdministradorActualiza'], 'administrador', ['idTienda', 'idAdministrador'], 'RESTRICT', 'RESTRICT'],
  ['movimientoLote', 'fk_movimientoLote_tienda', ['idTienda'], 'tienda', ['idTienda'], 'RESTRICT', 'RESTRICT'],
  ['movimientoLote', 'fk_movimientoLote_producto', ['idTienda', 'idProducto'], 'producto', ['idTienda', 'idProducto'], 'RESTRICT', 'RESTRICT'],
  ['movimientoLote', 'fk_movimientoLote_lote', ['idTienda', 'idProducto', 'idLoteProducto'], 'loteProducto', ['idTienda', 'idProducto', 'idLoteProducto'], 'RESTRICT', 'RESTRICT'],
  ['movimientoLote', 'fk_movimientoLote_movimientoStock', ['idTienda', 'idProducto', 'idMovimientoStock'], 'movimientoStock', ['idTienda', 'idProducto', 'idMovimientoStock'], 'RESTRICT', 'RESTRICT'],
  ['movimientoLote', 'fk_movimientoLote_administrador', ['idTienda', 'idAdministrador'], 'administrador', ['idTienda', 'idAdministrador'], 'RESTRICT', 'RESTRICT']
]);

function identifier(value) {
  return String(value || '').toLocaleLowerCase('en-US');
}

function normalizedDefault(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim().toLocaleLowerCase('en-US');
  if (/^-?\d+(?:\.\d+)?$/.test(text)) return Number(text);
  return text;
}

async function count(connection, sql, params = []) {
  const [[row]] = await connection.query(sql, params);
  return Number(row.total || 0);
}

async function hasTable(connection, table) {
  return count(connection,
    `SELECT COUNT(*) total FROM information_schema.TABLES
     WHERE TABLE_SCHEMA=? AND LOWER(TABLE_NAME)=LOWER(?)`,
    [process.env.DB_NAME, table]).then((total) => total > 0);
}

async function columnDetails(connection, table, columns) {
  if (!columns.length) return {};
  const placeholders = columns.map(() => 'LOWER(?)').join(',');
  const [rows] = await connection.query(
    `SELECT COLUMN_NAME, DATA_TYPE, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, EXTRA
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA=? AND LOWER(TABLE_NAME)=LOWER(?)
       AND LOWER(COLUMN_NAME) IN (${placeholders})`,
    [process.env.DB_NAME, table, ...columns]
  );
  return Object.fromEntries(rows.map((row) => [identifier(row.COLUMN_NAME), {
    tipo: identifier(row.DATA_TYPE),
    tipoCompleto: identifier(row.COLUMN_TYPE),
    nullable: row.IS_NULLABLE === 'YES',
    valorPredeterminado: row.COLUMN_DEFAULT,
    extra: identifier(row.EXTRA)
  }]));
}

function validateColumnDetails(details) {
  const result = {};
  for (const [table, definitions] of Object.entries(COLUMN_DEFINITIONS)) {
    result[table] = {};
    for (const [column, expected] of Object.entries(definitions)) {
      const actual = details[table]?.[identifier(column)];
      result[table][column] = Boolean(actual)
        && actual.tipoCompleto === identifier(expected.type)
        && actual.nullable === expected.nullable
        && normalizedDefault(actual.valorPredeterminado) === normalizedDefault(expected.defaultValue)
        && (expected.extra === undefined || actual.extra === identifier(expected.extra))
        && (!expected.extraIncludes || actual.extra.includes(identifier(expected.extraIncludes)));
    }
  }
  return result;
}

async function hasIndex(connection, table, name, columns, unique) {
  const [rows] = await connection.query(
    `SELECT COLUMN_NAME, NON_UNIQUE FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA=? AND LOWER(TABLE_NAME)=LOWER(?) AND LOWER(INDEX_NAME)=LOWER(?)
     ORDER BY SEQ_IN_INDEX`,
    [process.env.DB_NAME, table, name]
  );
  return rows.length === columns.length
    && rows.every((row, index) => identifier(row.COLUMN_NAME) === identifier(columns[index])
      && Number(row.NON_UNIQUE) === (unique ? 0 : 1));
}

async function hasCheck(connection, table, name) {
  return count(connection,
    `SELECT COUNT(*) total FROM information_schema.TABLE_CONSTRAINTS
     WHERE CONSTRAINT_SCHEMA=? AND LOWER(TABLE_NAME)=LOWER(?)
       AND LOWER(CONSTRAINT_NAME)=LOWER(?) AND CONSTRAINT_TYPE='CHECK'`,
    [process.env.DB_NAME, table, name]).then((total) => total > 0);
}

async function hasForeignKey(connection, relation) {
  const [table, name, columns, parentTable, parentColumns, updateRule, deleteRule] = relation;
  const [rows] = await connection.query(
    `SELECT COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
     FROM information_schema.KEY_COLUMN_USAGE
     WHERE TABLE_SCHEMA=? AND LOWER(TABLE_NAME)=LOWER(?)
       AND LOWER(CONSTRAINT_NAME)=LOWER(?)
     ORDER BY ORDINAL_POSITION`,
    [process.env.DB_NAME, table, name]
  );
  if (rows.length !== columns.length || !rows.every((row, index) =>
    identifier(row.COLUMN_NAME) === identifier(columns[index])
    && identifier(row.REFERENCED_TABLE_NAME) === identifier(parentTable)
    && identifier(row.REFERENCED_COLUMN_NAME) === identifier(parentColumns[index]))) return false;
  const [rules] = await connection.query(
    `SELECT UPDATE_RULE, DELETE_RULE FROM information_schema.REFERENTIAL_CONSTRAINTS
     WHERE CONSTRAINT_SCHEMA=? AND LOWER(TABLE_NAME)=LOWER(?)
       AND LOWER(CONSTRAINT_NAME)=LOWER(?)`,
    [process.env.DB_NAME, table, name]
  );
  return rules.length === 1 && identifier(rules[0].UPDATE_RULE) === identifier(updateRule)
    && identifier(rules[0].DELETE_RULE) === identifier(deleteRule);
}

async function dataChecks(connection, tables, columns) {
  const data = {
    configuracionesAlertaInvalidas: null,
    productosConfiguracionLotesInvalida: null,
    productosActivacionIncoherente: null,
    productosConLotesActivos: null,
    productosConVencimientoActivo: null,
    lotesInvalidos: null,
    lotesReferenciasInvalidas: null,
    lotesEnProductosSinControl: null,
    lotesSinVencimientoRequerido: null,
    lotesClavesDuplicadas: null,
    lotesSinMovimiento: null,
    lotesSaldoFinalIncoherente: null,
    movimientosLoteInvalidos: null,
    movimientosLoteReferenciasInvalidas: null,
    movimientosLoteClavesDuplicadas: null,
    reconciliacionesInvalidas: null,
    movimientosStockSinCoberturaLote: null,
    funcionalidadesActivas: null,
    accesosAvanzado: null,
    accesosBasico: null,
    funcionalidadesDuplicadas: null,
    accesosPlanDuplicados: null,
    lotes: null,
    movimientosLote: null
  };
  if (columns.configuracionInventarioTienda) {
    data.configuracionesAlertaInvalidas = await count(connection,
      'SELECT COUNT(*) total FROM configuracionInventarioTienda WHERE diasAlertaVencimientoDefault NOT BETWEEN 1 AND 365');
  }
  if (columns.producto) {
    data.productosConfiguracionLotesInvalida = await count(connection,
      `SELECT COUNT(*) total FROM producto
       WHERE controlaLotes NOT IN (0,1) OR controlaVencimiento NOT IN (0,1)
          OR (controlaVencimiento=1 AND controlaLotes=0)
          OR (diasAlertaVencimiento IS NOT NULL AND diasAlertaVencimiento NOT BETWEEN 1 AND 365)`);
    data.productosActivacionIncoherente = await count(connection,
      `SELECT COUNT(*) total FROM producto
       WHERE (controlaLotes=0 AND lotesActivadosEn IS NOT NULL)
          OR (controlaLotes=1 AND lotesActivadosEn IS NULL)`);
    data.productosConLotesActivos = await count(connection,
      'SELECT COUNT(*) total FROM producto WHERE controlaLotes=1');
    data.productosConVencimientoActivo = await count(connection,
      'SELECT COUNT(*) total FROM producto WHERE controlaVencimiento=1');
  }
  if (columns.loteProducto) {
    data.lotes = await count(connection, 'SELECT COUNT(*) total FROM loteProducto');
    data.lotesInvalidos = await count(connection,
      `SELECT COUNT(*) total FROM loteProducto
       WHERE cantidadInicial<=0 OR cantidadRestante<0 OR cantidadRestante>cantidadInicial
          OR costoUnitarioBase<0
          OR (fechaVencimiento IS NOT NULL AND fechaVencimiento<DATE(fechaIngreso))
          OR (codigoLote IS NOT NULL AND CHAR_LENGTH(TRIM(codigoLote))=0)
          OR (origen='compra' AND idDetalleCompra IS NULL)
          OR (origen<>'compra' AND idDetalleCompra IS NOT NULL)
          OR (estadoOperativo='anulado' AND cantidadRestante<>0)`);
    data.lotesReferenciasInvalidas = await count(connection,
      `SELECT COUNT(*) total FROM loteProducto l
       LEFT JOIN tienda t ON t.idTienda=l.idTienda
       LEFT JOIN producto p ON p.idTienda=l.idTienda AND p.idProducto=l.idProducto
       LEFT JOIN proveedor pr ON pr.idTienda=l.idTienda AND pr.idProveedor=l.idProveedor
       LEFT JOIN detalleCompra dc
         ON dc.idTienda=l.idTienda AND dc.idProducto=l.idProducto
        AND dc.idDetalleCompra=l.idDetalleCompra
       LEFT JOIN compra c ON c.idTienda=dc.idTienda AND c.idCompra=dc.idCompra
       LEFT JOIN administrador ac
         ON ac.idTienda=l.idTienda AND ac.idAdministrador=l.idAdministradorCrea
       LEFT JOIN administrador au
         ON au.idTienda=l.idTienda AND au.idAdministrador=l.idAdministradorActualiza
       WHERE t.idTienda IS NULL OR p.idProducto IS NULL OR ac.idAdministrador IS NULL
          OR (l.idProveedor IS NOT NULL AND pr.idProveedor IS NULL)
          OR (l.idDetalleCompra IS NOT NULL AND dc.idDetalleCompra IS NULL)
          OR (l.origen='compra' AND c.idCompra IS NULL)
          OR (l.idProveedor IS NOT NULL AND c.idProveedor IS NOT NULL AND l.idProveedor<>c.idProveedor)
          OR (l.idAdministradorActualiza IS NOT NULL AND au.idAdministrador IS NULL)`);
    data.lotesEnProductosSinControl = await count(connection,
      `SELECT COUNT(*) total FROM loteProducto l
       JOIN producto p ON p.idTienda=l.idTienda AND p.idProducto=l.idProducto
       WHERE p.controlaLotes=0`);
    data.lotesSinVencimientoRequerido = await count(connection,
      `SELECT COUNT(*) total FROM loteProducto l
       JOIN producto p ON p.idTienda=l.idTienda AND p.idProducto=l.idProducto
       WHERE p.controlaVencimiento=1 AND l.estadoOperativo<>'anulado'
         AND l.cantidadRestante>0 AND l.fechaVencimiento IS NULL`);
    data.lotesClavesDuplicadas = await count(connection,
      `SELECT COUNT(*) total FROM (
         SELECT idTienda, claveOperacion FROM loteProducto
         GROUP BY idTienda, claveOperacion HAVING COUNT(*)>1
       ) duplicados`);
  }
  if (columns.movimientoLote) {
    data.movimientosLote = await count(connection, 'SELECT COUNT(*) total FROM movimientoLote');
    data.movimientosLoteInvalidos = await count(connection,
      `SELECT COUNT(*) total FROM movimientoLote
       WHERE cantidad=0 OR cantidadAnterior<0 OR cantidadPosterior<0
          OR cantidadPosterior<>cantidadAnterior+cantidad
          OR (tipoRegistro='distribucion_inicial'
              AND (idMovimientoStock IS NOT NULL OR cantidad<=0))
          OR (tipoRegistro='movimiento_stock' AND idMovimientoStock IS NULL)`);
    data.movimientosLoteReferenciasInvalidas = await count(connection,
      `SELECT COUNT(*) total FROM movimientoLote ml
       LEFT JOIN producto p ON p.idTienda=ml.idTienda AND p.idProducto=ml.idProducto
       LEFT JOIN loteProducto l
         ON l.idTienda=ml.idTienda AND l.idProducto=ml.idProducto
        AND l.idLoteProducto=ml.idLoteProducto
       LEFT JOIN movimientoStock ms
         ON ms.idTienda=ml.idTienda AND ms.idProducto=ml.idProducto
        AND ms.idMovimientoStock=ml.idMovimientoStock
       LEFT JOIN administrador a
         ON a.idTienda=ml.idTienda AND a.idAdministrador=ml.idAdministrador
       WHERE p.idProducto IS NULL OR l.idLoteProducto IS NULL OR a.idAdministrador IS NULL
          OR (ml.idMovimientoStock IS NOT NULL AND ms.idMovimientoStock IS NULL)`);
    data.movimientosLoteClavesDuplicadas = await count(connection,
      `SELECT COUNT(*) total FROM (
         SELECT idTienda, claveOperacion FROM movimientoLote
         GROUP BY idTienda, claveOperacion HAVING COUNT(*)>1
       ) duplicados`);
  }
  if (columns.loteProducto && columns.movimientoLote) {
    data.lotesSinMovimiento = await count(connection,
      `SELECT COUNT(*) total FROM loteProducto l
       WHERE NOT EXISTS (
         SELECT 1 FROM movimientoLote ml
         WHERE ml.idTienda=l.idTienda AND ml.idProducto=l.idProducto
           AND ml.idLoteProducto=l.idLoteProducto
       )`);
    data.lotesSaldoFinalIncoherente = await count(connection,
      `SELECT COUNT(*) total FROM loteProducto l
       JOIN movimientoLote ml ON ml.idMovimientoLote=(
         SELECT MAX(ultimo.idMovimientoLote) FROM movimientoLote ultimo
         WHERE ultimo.idTienda=l.idTienda AND ultimo.idProducto=l.idProducto
           AND ultimo.idLoteProducto=l.idLoteProducto
       )
       WHERE ml.cantidadPosterior<>l.cantidadRestante`);
  }
  if (columns.producto && columns.loteProducto) {
    data.reconciliacionesInvalidas = await count(connection,
      `SELECT COUNT(*) total FROM (
         SELECT p.idTienda, p.idProducto
         FROM producto p
         LEFT JOIN loteProducto l
           ON l.idTienda=p.idTienda AND l.idProducto=p.idProducto
          AND l.estadoOperativo<>'anulado'
         WHERE p.controlaLotes=1
         GROUP BY p.idTienda, p.idProducto, p.stockUnidadesTotal
         HAVING COALESCE(SUM(l.cantidadRestante),0)<>p.stockUnidadesTotal
       ) diferencias`);
  }
  if (columns.producto && columns.movimientoLote && tables.movimientoStock) {
    data.movimientosStockSinCoberturaLote = await count(connection,
      `SELECT COUNT(*) total FROM (
         SELECT ms.idTienda, ms.idProducto, ms.idMovimientoStock, ms.cantidad
         FROM movimientoStock ms
         JOIN producto p ON p.idTienda=ms.idTienda AND p.idProducto=ms.idProducto
         LEFT JOIN movimientoLote ml
           ON ml.idTienda=ms.idTienda AND ml.idProducto=ms.idProducto
          AND ml.idMovimientoStock=ms.idMovimientoStock
          AND ml.tipoRegistro='movimiento_stock'
         WHERE p.controlaLotes=1 AND p.lotesActivadosEn IS NOT NULL
            AND ms.creadoEn>p.lotesActivadosEn
         GROUP BY ms.idTienda, ms.idProducto, ms.idMovimientoStock, ms.cantidad
         HAVING COALESCE(SUM(ml.cantidad),0)<>ms.cantidad
       ) diferencias`);
  }
  const featureTables = await hasTable(connection, 'funcionalidad')
    && await hasTable(connection, 'plan') && await hasTable(connection, 'planFuncionalidad');
  if (featureTables) {
    const placeholders = FEATURES.map(() => '?').join(',');
    data.funcionalidadesActivas = await count(connection,
      `SELECT COUNT(DISTINCT codigo) total FROM funcionalidad
       WHERE activo=1 AND codigo IN (${placeholders})`, FEATURES);
    data.accesosAvanzado = await count(connection,
      `SELECT COUNT(DISTINCT f.codigo) total FROM planFuncionalidad pf
       JOIN plan p ON p.idPlan=pf.idPlan
       JOIN funcionalidad f ON f.idFuncionalidad=pf.idFuncionalidad
       WHERE p.codigo='avanzado' AND p.activo=1 AND f.activo=1 AND pf.habilitada=1
         AND f.codigo IN (${placeholders})`, FEATURES);
    data.accesosBasico = await count(connection,
      `SELECT COUNT(DISTINCT f.codigo) total FROM planFuncionalidad pf
       JOIN plan p ON p.idPlan=pf.idPlan
       JOIN funcionalidad f ON f.idFuncionalidad=pf.idFuncionalidad
       WHERE p.codigo='basico' AND f.activo=1 AND pf.habilitada=1
         AND f.codigo IN (${placeholders})`, FEATURES);
    data.funcionalidadesDuplicadas = await count(connection,
      `SELECT COUNT(*) total FROM (
         SELECT codigo FROM funcionalidad GROUP BY codigo HAVING COUNT(*)>1
       ) duplicados`);
    data.accesosPlanDuplicados = await count(connection,
      `SELECT COUNT(*) total FROM (
         SELECT idPlan, idFuncionalidad FROM planFuncionalidad
         GROUP BY idPlan, idFuncionalidad HAVING COUNT(*)>1
       ) duplicados`);
  }
  return data;
}

function validData(data) {
  const zeroChecks = [
    'configuracionesAlertaInvalidas', 'productosConfiguracionLotesInvalida',
    'productosActivacionIncoherente', 'lotesInvalidos', 'lotesReferenciasInvalidas',
    'lotesEnProductosSinControl', 'lotesSinVencimientoRequerido',
    'lotesClavesDuplicadas', 'lotesSinMovimiento', 'lotesSaldoFinalIncoherente',
    'movimientosLoteInvalidos', 'movimientosLoteReferenciasInvalidas',
    'movimientosLoteClavesDuplicadas', 'reconciliacionesInvalidas',
    'movimientosStockSinCoberturaLote', 'funcionalidadesDuplicadas',
    'accesosPlanDuplicados'
  ];
  return zeroChecks.every((key) => data[key] === 0)
    && data.funcionalidadesActivas === FEATURES.length
    && data.accesosAvanzado === FEATURES.length
    && data.accesosBasico === 0;
}

async function main() {
  const config = databaseConfig();
  logDatabaseTarget('Comprobacion de lotes y vencimientos', config);
  const connection = await createConnection();
  try {
    const schemaMigrationsExists = await hasTable(connection, 'schema_migrations');
    const migracionRegistrada = schemaMigrationsExists
      ? await count(connection, 'SELECT COUNT(*) total FROM schema_migrations WHERE nombre=?', [MIGRATION]) === 1
      : false;
    const tablesToCheck = new Set([
      ...Object.keys(REQUIRED_COLUMNS), ...Object.keys(COLUMN_DEFINITIONS),
      'detalleCompra', 'movimientoStock'
    ]);
    const tablas = {};
    for (const table of tablesToCheck) tablas[table] = await hasTable(connection, table);

    const columnas = {};
    for (const [table, required] of Object.entries(REQUIRED_COLUMNS)) {
      const details = tablas[table] ? await columnDetails(connection, table, required) : {};
      columnas[table] = required.every((column) => Boolean(details[identifier(column)]));
    }
    const detallesColumnas = {};
    for (const [table, definitions] of Object.entries(COLUMN_DEFINITIONS)) {
      detallesColumnas[table] = tablas[table]
        ? await columnDetails(connection, table, Object.keys(definitions)) : {};
    }
    const tiposNulabilidadDefaults = validateColumnDetails(detallesColumnas);

    const indices = {};
    for (const index of INDEXES) indices[`${index[0]}.${index[1]}`] = await hasIndex(connection, ...index);
    const checks = {};
    for (const check of CHECKS) checks[`${check[0]}.${check[1]}`] = await hasCheck(connection, ...check);
    const clavesForaneas = {};
    for (const relation of FOREIGN_KEYS) {
      clavesForaneas[`${relation[0]}.${relation[1]}`] = await hasForeignKey(connection, relation);
    }
    const motores = {};
    for (const table of ['loteProducto', 'movimientoLote']) {
      if (!tablas[table]) {
        motores[table] = false;
        continue;
      }
      const [[row]] = await connection.query(
        `SELECT ENGINE FROM information_schema.TABLES
         WHERE TABLE_SCHEMA=? AND LOWER(TABLE_NAME)=LOWER(?)`,
        [process.env.DB_NAME, table]
      );
      motores[table] = identifier(row?.ENGINE) === 'innodb';
    }

    const estructuraCompleta = Object.values(tablas).every(Boolean)
      && Object.values(columnas).every(Boolean)
      && Object.values(tiposNulabilidadDefaults).every((table) => Object.values(table).every(Boolean))
      && Object.values(indices).every(Boolean)
      && Object.values(checks).every(Boolean)
      && Object.values(clavesForaneas).every(Boolean)
      && Object.values(motores).every(Boolean);
    const datos = await dataChecks(connection, tablas, columnas);
    const datosValidos = estructuraCompleta && validData(datos);

    const newProductColumnsPresent = Object.keys(COLUMN_DEFINITIONS.producto)
      .filter((column) => !['ultimoPrecioCompra'].includes(column))
      .some((column) => Boolean(detallesColumnas.producto[identifier(column)]));
    const newConfigurationColumnPresent = Boolean(
      detallesColumnas.configuracionInventarioTienda[identifier('diasAlertaVencimientoDefault')]
    );
    const newFeaturesPresent = datos.funcionalidadesActivas !== null
      && datos.funcionalidadesActivas > 1;
    const estadoMigracion = migracionRegistrada && estructuraCompleta && datosValidos
      ? 'post-migracion'
      : (!migracionRegistrada && !tablas.loteProducto && !tablas.movimientoLote
          && !newProductColumnsPresent && !newConfigurationColumnPresent && !newFeaturesPresent)
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
      motores,
      estructuraCompleta,
      datosValidos,
      datos
    }, null, 2));

    if (estadoMigracion === 'estructura-incompleta-o-migracion-parcial'
      || (migracionRegistrada && (!estructuraCompleta || !datosValidos))) {
      process.exitCode = 1;
    }
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error('No se pudo comprobar la estructura de lotes y vencimientos.');
  console.error(error.message);
  process.exit(1);
});
