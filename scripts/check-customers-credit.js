const { databaseConfig, databaseTarget, logDatabaseTarget } = require('../config/env');
const { createConnection } = require('./db-utils');

const MIGRATION = '012_clientes_fiados_comunicacion.sql';
const CORE_FEATURES = Object.freeze([
  'clientes_basico', 'fiados_basico', 'pagos_fiado', 'estado_cuenta_basico'
]);
const ADVANCED_FEATURES = Object.freeze([
  'limites_credito', 'seguimiento_cobranza', 'segmentacion_clientes',
  'exportacion_clientes_fiados', 'recordatorios_fiado'
]);
const NEW_FEATURES = Object.freeze([...CORE_FEATURES, ...ADVANCED_FEATURES.filter((code) => code !== 'recordatorios_fiado')]);
const ALL_FEATURES = Object.freeze([...CORE_FEATURES, ...ADVANCED_FEATURES]);
const DEFAULT_TEMPLATES = Object.freeze([
  ['recordatorio_previo', 'Recordatorio previo'],
  ['deuda_vencida', 'Deuda vencida'],
  ['confirmacion_pago', 'Confirmacion de pago'],
  ['estado_cuenta', 'Estado de cuenta']
]);
const ALLOWED_TEMPLATE_VARIABLES = new Set([
  'tienda', 'cliente', 'saldo', 'vencimiento', 'dias_atraso', 'comprobante'
]);
let activeDatabaseName = null;

const REQUIRED_COLUMNS = Object.freeze({
  cliente: [
    'direccion', 'telefonoAlternativo', 'telefonoNormalizado', 'documentoIdentidad',
    'documentoNormalizado', 'correo', 'notas', 'limiteCredito', 'permiteFiado',
    'diasCreditoDefault', 'canalPreferido', 'aceptaRecordatorios', 'horarioPreferido',
    'creadoEn', 'actualizadoEn', 'idAdministradorCrea', 'idAdministradorActualiza'
  ],
  fiado: [
    'fechaVencimiento', 'fechaPrometidaPago', 'observacionCredito', 'cerradoEn',
    'idAdministradorCrea'
  ],
  pagoFiado: ['idCobroFiado', 'claveDistribucion'],
  configuracionCreditoTienda: [
    'idTienda', 'limiteCreditoDefault', 'diasCreditoDefault', 'diasAvisoVencimiento',
    'politicaFiadoVencido', 'requiereTelefonoParaFiado', 'permiteFiadoSinFecha',
    'codigoPaisWhatsApp', 'creadoEn', 'actualizadoEn', 'idAdministradorActualiza'
  ],
  cobroFiado: [
    'idCobroFiado', 'idTienda', 'idCliente', 'fechaCobro', 'montoTotal', 'metodoPago',
    'montoRecibido', 'cambio', 'referencia', 'observacion', 'claveOperacion',
    'creadoEn', 'idAdministrador', 'esLegado'
  ],
  seguimientoCobranza: [
    'idSeguimientoCobranza', 'idTienda', 'idCliente', 'idFiado', 'tipo', 'canal',
    'detalle', 'fechaCompromiso', 'creadoEn', 'idAdministrador'
  ],
  plantillaCobranzaTienda: [
    'idPlantillaCobranza', 'idTienda', 'tipo', 'nombre', 'contenido', 'activo',
    'creadoEn', 'actualizadoEn', 'idAdministradorActualiza'
  ]
});

const COLUMN_DEFINITIONS = Object.freeze({
  cliente: {
    direccion: { type: 'varchar(255)', nullable: true, defaultValue: null },
    telefonoAlternativo: { type: 'varchar(30)', nullable: true, defaultValue: null },
    telefonoNormalizado: { type: 'varchar(30)', nullable: true, defaultValue: null },
    documentoIdentidad: { type: 'varchar(50)', nullable: true, defaultValue: null },
    documentoNormalizado: { type: 'varchar(50)', nullable: true, defaultValue: null },
    correo: { type: 'varchar(160)', nullable: true, defaultValue: null },
    notas: { type: 'varchar(1000)', nullable: true, defaultValue: null },
    limiteCredito: { type: 'decimal(12,2)', nullable: true, defaultValue: null },
    permiteFiado: { type: 'tinyint(1)', nullable: false, defaultValue: 1 },
    diasCreditoDefault: { type: 'int', nullable: true, defaultValue: null },
    canalPreferido: {
      type: "enum('ninguno','whatsapp','telefono','correo','presencial')",
      nullable: false,
      defaultValue: 'ninguno'
    },
    aceptaRecordatorios: { type: 'tinyint(1)', nullable: false, defaultValue: 1 },
    horarioPreferido: { type: 'varchar(120)', nullable: true, defaultValue: null },
    creadoEn: { type: 'datetime', nullable: false, defaultValue: null, extra: '' },
    actualizadoEn: { type: 'datetime', nullable: false, defaultValue: null, extra: '' },
    idAdministradorCrea: { type: 'int', nullable: true, defaultValue: null },
    idAdministradorActualiza: { type: 'int', nullable: true, defaultValue: null }
  },
  fiado: {
    fechaVencimiento: { type: 'date', nullable: true, defaultValue: null, extra: '' },
    fechaPrometidaPago: { type: 'date', nullable: true, defaultValue: null, extra: '' },
    observacionCredito: { type: 'varchar(1000)', nullable: true, defaultValue: null },
    cerradoEn: { type: 'datetime', nullable: true, defaultValue: null, extra: '' },
    idAdministradorCrea: { type: 'int', nullable: true, defaultValue: null }
  },
  pagoFiado: {
    idCobroFiado: { type: 'bigint', nullable: false, defaultValue: null },
    claveDistribucion: { type: 'varchar(160)', nullable: false, defaultValue: null }
  },
  configuracionCreditoTienda: {
    idTienda: { type: 'int', nullable: false, defaultValue: null },
    limiteCreditoDefault: { type: 'decimal(12,2)', nullable: true, defaultValue: null },
    diasCreditoDefault: { type: 'int', nullable: false, defaultValue: 30 },
    diasAvisoVencimiento: { type: 'int', nullable: false, defaultValue: 3 },
    politicaFiadoVencido: {
      type: "enum('permitir','advertir','bloquear')", nullable: false, defaultValue: 'advertir'
    },
    requiereTelefonoParaFiado: { type: 'tinyint(1)', nullable: false, defaultValue: 0 },
    permiteFiadoSinFecha: { type: 'tinyint(1)', nullable: false, defaultValue: 1 },
    codigoPaisWhatsApp: { type: 'varchar(8)', nullable: true, defaultValue: null },
    creadoEn: { type: 'datetime', nullable: false, defaultValue: null, extra: '' },
    actualizadoEn: { type: 'datetime', nullable: false, defaultValue: null, extra: '' },
    idAdministradorActualiza: { type: 'int', nullable: true, defaultValue: null }
  },
  cobroFiado: {
    idCobroFiado: { type: 'bigint', nullable: false, defaultValue: null, extraIncludes: 'auto_increment' },
    idTienda: { type: 'int', nullable: false, defaultValue: null },
    idCliente: { type: 'int', nullable: false, defaultValue: null },
    fechaCobro: { type: 'datetime', nullable: false, defaultValue: null, extra: '' },
    montoTotal: { type: 'decimal(12,2)', nullable: false, defaultValue: null },
    metodoPago: {
      type: "enum('efectivo','qr','transferencia','tarjeta','otro','no_especificado')",
      nullable: false,
      defaultValue: null
    },
    montoRecibido: { type: 'decimal(12,2)', nullable: true, defaultValue: null },
    cambio: { type: 'decimal(12,2)', nullable: false, defaultValue: 0 },
    referencia: { type: 'varchar(160)', nullable: true, defaultValue: null },
    observacion: { type: 'varchar(1000)', nullable: true, defaultValue: null },
    claveOperacion: { type: 'varchar(160)', nullable: false, defaultValue: null },
    creadoEn: { type: 'datetime', nullable: false, defaultValue: null, extra: '' },
    idAdministrador: { type: 'int', nullable: true, defaultValue: null },
    esLegado: { type: 'tinyint(1)', nullable: false, defaultValue: 0 }
  },
  seguimientoCobranza: {
    idSeguimientoCobranza: { type: 'bigint', nullable: false, defaultValue: null, extraIncludes: 'auto_increment' },
    idTienda: { type: 'int', nullable: false, defaultValue: null },
    idCliente: { type: 'int', nullable: false, defaultValue: null },
    idFiado: { type: 'int', nullable: true, defaultValue: null },
    tipo: {
      type: "enum('nota','recordatorio_preparado','llamada','mensaje_enviado_manual','compromiso_pago','visita')",
      nullable: false,
      defaultValue: null
    },
    canal: {
      type: "enum('ninguno','whatsapp','telefono','presencial','correo')",
      nullable: false,
      defaultValue: 'ninguno'
    },
    detalle: { type: 'varchar(2000)', nullable: false, defaultValue: null },
    fechaCompromiso: { type: 'date', nullable: true, defaultValue: null },
    creadoEn: { type: 'datetime', nullable: false, defaultValue: null, extra: '' },
    idAdministrador: { type: 'int', nullable: false, defaultValue: null }
  },
  plantillaCobranzaTienda: {
    idPlantillaCobranza: { type: 'bigint', nullable: false, defaultValue: null, extraIncludes: 'auto_increment' },
    idTienda: { type: 'int', nullable: false, defaultValue: null },
    tipo: {
      type: "enum('recordatorio_previo','deuda_vencida','confirmacion_pago','estado_cuenta')",
      nullable: false,
      defaultValue: null
    },
    nombre: { type: 'varchar(100)', nullable: false, defaultValue: null },
    contenido: { type: 'varchar(2000)', nullable: false, defaultValue: null },
    activo: { type: 'tinyint(1)', nullable: false, defaultValue: 1 },
    creadoEn: { type: 'datetime', nullable: false, defaultValue: null, extra: '' },
    actualizadoEn: { type: 'datetime', nullable: false, defaultValue: null, extra: '' },
    idAdministradorActualiza: { type: 'int', nullable: true, defaultValue: null }
  }
});

const INDEXES = Object.freeze([
  ['cliente', 'idx_cliente_tienda_activo_nombre', ['idTienda', 'activo', 'nombre'], false],
  ['cliente', 'uq_cliente_tienda_documento_normalizado', ['idTienda', 'documentoNormalizado'], true],
  ['cliente', 'idx_cliente_tienda_telefono_normalizado', ['idTienda', 'telefonoNormalizado'], false],
  ['cliente', 'idx_cliente_tienda_permite_fiado_activo', ['idTienda', 'permiteFiado', 'activo'], false],
  ['cliente', 'idx_cliente_tienda_admin_crea', ['idTienda', 'idAdministradorCrea'], false],
  ['cliente', 'idx_cliente_tienda_admin_actualiza', ['idTienda', 'idAdministradorActualiza'], false],
  ['fiado', 'uq_fiado_tienda_cliente_id', ['idTienda', 'idCliente', 'idFiado'], true],
  ['fiado', 'idx_fiado_tienda_cliente_saldo', ['idTienda', 'idCliente', 'saldoPendiente'], false],
  ['fiado', 'idx_fiado_tienda_vencimiento_saldo', ['idTienda', 'fechaVencimiento', 'saldoPendiente'], false],
  ['fiado', 'idx_fiado_tienda_promesa_saldo', ['idTienda', 'fechaPrometidaPago', 'saldoPendiente'], false],
  ['fiado', 'idx_fiado_tienda_estado_activo', ['idTienda', 'estado', 'activo'], false],
  ['fiado', 'idx_fiado_tienda_venta', ['idTienda', 'idVenta'], false],
  ['fiado', 'idx_fiado_tienda_admin_crea', ['idTienda', 'idAdministradorCrea'], false],
  ['configuracionCreditoTienda', 'PRIMARY', ['idTienda'], true],
  ['configuracionCreditoTienda', 'idx_configCredito_tienda_admin', ['idTienda', 'idAdministradorActualiza'], false],
  ['cobroFiado', 'PRIMARY', ['idCobroFiado'], true],
  ['cobroFiado', 'uq_cobroFiado_tienda_id', ['idTienda', 'idCobroFiado'], true],
  ['cobroFiado', 'uq_cobroFiado_tienda_clave', ['idTienda', 'claveOperacion'], true],
  ['cobroFiado', 'idx_cobroFiado_tienda_cliente_fecha', ['idTienda', 'idCliente', 'fechaCobro'], false],
  ['cobroFiado', 'idx_cobroFiado_tienda_fecha_metodo', ['idTienda', 'fechaCobro', 'metodoPago'], false],
  ['cobroFiado', 'idx_cobroFiado_tienda_admin_fecha', ['idTienda', 'idAdministrador', 'fechaCobro'], false],
  ['pagoFiado', 'uq_pagoFiado_tienda_clave_distribucion', ['idTienda', 'claveDistribucion'], true],
  ['pagoFiado', 'idx_pagoFiado_tienda_cobro_fiado', ['idTienda', 'idCobroFiado', 'idFiado'], false],
  ['seguimientoCobranza', 'PRIMARY', ['idSeguimientoCobranza'], true],
  ['seguimientoCobranza', 'idx_seguimientoCobranza_tienda_cliente_fecha', ['idTienda', 'idCliente', 'creadoEn'], false],
  ['seguimientoCobranza', 'idx_seguimientoCobranza_tienda_fiado_fecha', ['idTienda', 'idFiado', 'creadoEn'], false],
  ['seguimientoCobranza', 'idx_seguimientoCobranza_tienda_tipo_fecha', ['idTienda', 'tipo', 'creadoEn'], false],
  ['seguimientoCobranza', 'idx_seguimientoCobranza_tienda_compromiso', ['idTienda', 'fechaCompromiso'], false],
  ['seguimientoCobranza', 'idx_seguimientoCobranza_tienda_admin', ['idTienda', 'idAdministrador'], false],
  ['plantillaCobranzaTienda', 'PRIMARY', ['idPlantillaCobranza'], true],
  ['plantillaCobranzaTienda', 'uq_plantillaCobranza_tienda_tipo_nombre', ['idTienda', 'tipo', 'nombre'], true],
  ['plantillaCobranzaTienda', 'idx_plantillaCobranza_tienda_activo_tipo', ['idTienda', 'activo', 'tipo'], false],
  ['plantillaCobranzaTienda', 'idx_plantillaCobranza_tienda_admin', ['idTienda', 'idAdministradorActualiza'], false]
]);

const CHECKS = Object.freeze([
  ['cliente', 'chk_cliente_limite_credito'],
  ['cliente', 'chk_cliente_permite_fiado'],
  ['cliente', 'chk_cliente_acepta_recordatorios'],
  ['cliente', 'chk_cliente_dias_credito'],
  ['cliente', 'chk_cliente_contacto_normalizado'],
  ['fiado', 'chk_fiado_cierre_credito'],
  ['configuracionCreditoTienda', 'chk_configCredito_limite'],
  ['configuracionCreditoTienda', 'chk_configCredito_dias'],
  ['configuracionCreditoTienda', 'chk_configCredito_booleanos'],
  ['configuracionCreditoTienda', 'chk_configCredito_codigo_pais'],
  ['cobroFiado', 'chk_cobroFiado_monto'],
  ['cobroFiado', 'chk_cobroFiado_cambio'],
  ['cobroFiado', 'chk_cobroFiado_legado'],
  ['seguimientoCobranza', 'chk_seguimientoCobranza_detalle'],
  ['seguimientoCobranza', 'chk_seguimientoCobranza_compromiso'],
  ['plantillaCobranzaTienda', 'chk_plantillaCobranza_texto'],
  ['plantillaCobranzaTienda', 'chk_plantillaCobranza_activo']
]);

const FOREIGN_KEYS = Object.freeze([
  ['cliente', 'fk_cliente_admin_crea', ['idTienda', 'idAdministradorCrea'], 'administrador', ['idTienda', 'idAdministrador'], 'RESTRICT', 'RESTRICT'],
  ['cliente', 'fk_cliente_admin_actualiza', ['idTienda', 'idAdministradorActualiza'], 'administrador', ['idTienda', 'idAdministrador'], 'RESTRICT', 'RESTRICT'],
  ['fiado', 'fk_fiado_admin_crea', ['idTienda', 'idAdministradorCrea'], 'administrador', ['idTienda', 'idAdministrador'], 'RESTRICT', 'RESTRICT'],
  ['configuracionCreditoTienda', 'fk_configCredito_tienda', ['idTienda'], 'tienda', ['idTienda'], 'RESTRICT', 'RESTRICT'],
  ['configuracionCreditoTienda', 'fk_configCredito_administrador', ['idTienda', 'idAdministradorActualiza'], 'administrador', ['idTienda', 'idAdministrador'], 'RESTRICT', 'RESTRICT'],
  ['cobroFiado', 'fk_cobroFiado_tienda', ['idTienda'], 'tienda', ['idTienda'], 'RESTRICT', 'RESTRICT'],
  ['cobroFiado', 'fk_cobroFiado_cliente', ['idTienda', 'idCliente'], 'cliente', ['idTienda', 'idCliente'], 'RESTRICT', 'RESTRICT'],
  ['cobroFiado', 'fk_cobroFiado_administrador', ['idTienda', 'idAdministrador'], 'administrador', ['idTienda', 'idAdministrador'], 'RESTRICT', 'RESTRICT'],
  ['pagoFiado', 'fk_pagoFiado_cobro', ['idTienda', 'idCobroFiado'], 'cobroFiado', ['idTienda', 'idCobroFiado'], 'RESTRICT', 'RESTRICT'],
  ['seguimientoCobranza', 'fk_seguimientoCobranza_tienda', ['idTienda'], 'tienda', ['idTienda'], 'RESTRICT', 'RESTRICT'],
  ['seguimientoCobranza', 'fk_seguimientoCobranza_cliente', ['idTienda', 'idCliente'], 'cliente', ['idTienda', 'idCliente'], 'RESTRICT', 'RESTRICT'],
  ['seguimientoCobranza', 'fk_seguimientoCobranza_fiado', ['idTienda', 'idCliente', 'idFiado'], 'fiado', ['idTienda', 'idCliente', 'idFiado'], 'RESTRICT', 'RESTRICT'],
  ['seguimientoCobranza', 'fk_seguimientoCobranza_administrador', ['idTienda', 'idAdministrador'], 'administrador', ['idTienda', 'idAdministrador'], 'RESTRICT', 'RESTRICT'],
  ['plantillaCobranzaTienda', 'fk_plantillaCobranza_tienda', ['idTienda'], 'tienda', ['idTienda'], 'RESTRICT', 'RESTRICT'],
  ['plantillaCobranzaTienda', 'fk_plantillaCobranza_administrador', ['idTienda', 'idAdministradorActualiza'], 'administrador', ['idTienda', 'idAdministrador'], 'RESTRICT', 'RESTRICT']
]);

function identifier(value) {
  return String(value || '').toLocaleLowerCase('en-US');
}

function activeSchema() {
  if (!activeDatabaseName) {
    throw new Error('No se pudo determinar la base activa para consultar INFORMATION_SCHEMA.');
  }
  return activeDatabaseName;
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
  return (await count(connection,
    `SELECT COUNT(*) total FROM information_schema.TABLES
     WHERE LOWER(TABLE_SCHEMA)=LOWER(?) AND LOWER(TABLE_NAME)=LOWER(?)`,
    [activeSchema(), identifier(table)])) > 0;
}

async function columnDetails(connection, table, columns) {
  if (!columns.length) return {};
  const placeholders = columns.map(() => 'LOWER(?)').join(',');
  const [rows] = await connection.query(
    `SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, EXTRA
     FROM information_schema.COLUMNS
     WHERE LOWER(TABLE_SCHEMA)=LOWER(?) AND LOWER(TABLE_NAME)=LOWER(?)
       AND LOWER(COLUMN_NAME) IN (${placeholders})`,
    [activeSchema(), identifier(table), ...columns.map(identifier)]
  );
  return Object.fromEntries(rows.map((row) => [identifier(row.COLUMN_NAME), {
    tipo: identifier(row.COLUMN_TYPE),
    nullable: row.IS_NULLABLE === 'YES',
    valorPredeterminado: row.COLUMN_DEFAULT,
    extra: identifier(row.EXTRA)
  }]));
}

function definitionMatches(actual, expected) {
  return Boolean(actual)
    && actual.tipo === identifier(expected.type)
    && actual.nullable === expected.nullable
    && normalizedDefault(actual.valorPredeterminado) === normalizedDefault(expected.defaultValue)
    && (expected.extra === undefined || actual.extra === identifier(expected.extra))
    && (!expected.extraIncludes || actual.extra.includes(identifier(expected.extraIncludes)));
}

async function hasIndex(connection, table, name, columns, unique) {
  const [rows] = await connection.query(
    `SELECT COLUMN_NAME, NON_UNIQUE FROM information_schema.STATISTICS
     WHERE LOWER(TABLE_SCHEMA)=LOWER(?) AND LOWER(TABLE_NAME)=LOWER(?)
       AND LOWER(INDEX_NAME)=LOWER(?)
     ORDER BY SEQ_IN_INDEX`,
    [activeSchema(), identifier(table), identifier(name)]
  );
  return rows.length === columns.length
    && rows.every((row, index) => identifier(row.COLUMN_NAME) === identifier(columns[index])
      && Number(row.NON_UNIQUE) === (unique ? 0 : 1));
}

async function hasCheck(connection, table, name) {
  return (await count(connection,
    `SELECT COUNT(*) total
     FROM information_schema.TABLE_CONSTRAINTS tc
     JOIN information_schema.CHECK_CONSTRAINTS cc
       ON LOWER(cc.CONSTRAINT_SCHEMA)=LOWER(tc.CONSTRAINT_SCHEMA)
      AND LOWER(cc.CONSTRAINT_NAME)=LOWER(tc.CONSTRAINT_NAME)
     WHERE LOWER(tc.CONSTRAINT_SCHEMA)=LOWER(?)
       AND LOWER(tc.TABLE_NAME)=LOWER(?)
       AND LOWER(tc.CONSTRAINT_NAME)=LOWER(?)
       AND UPPER(tc.CONSTRAINT_TYPE)='CHECK'`,
    [activeSchema(), identifier(table), identifier(name)])) > 0;
}

async function hasForeignKey(connection, relation) {
  const [table, name, columns, parentTable, parentColumns, updateRule, deleteRule] = relation;
  const [rows] = await connection.query(
    `SELECT COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
     FROM information_schema.KEY_COLUMN_USAGE
     WHERE LOWER(TABLE_SCHEMA)=LOWER(?) AND LOWER(TABLE_NAME)=LOWER(?)
       AND LOWER(CONSTRAINT_NAME)=LOWER(?)
     ORDER BY ORDINAL_POSITION`,
    [activeSchema(), identifier(table), identifier(name)]
  );
  if (rows.length !== columns.length) return false;
  if (!rows.every((row, index) => identifier(row.COLUMN_NAME) === identifier(columns[index])
    && identifier(row.REFERENCED_TABLE_NAME) === identifier(parentTable)
    && identifier(row.REFERENCED_COLUMN_NAME) === identifier(parentColumns[index]))) return false;
  const [rules] = await connection.query(
    `SELECT UPDATE_RULE, DELETE_RULE FROM information_schema.REFERENTIAL_CONSTRAINTS
     WHERE LOWER(CONSTRAINT_SCHEMA)=LOWER(?) AND LOWER(TABLE_NAME)=LOWER(?)
       AND LOWER(CONSTRAINT_NAME)=LOWER(?)`,
    [activeSchema(), identifier(table), identifier(name)]
  );
  return rules.length === 1 && identifier(rules[0].UPDATE_RULE) === identifier(updateRule)
    && identifier(rules[0].DELETE_RULE) === identifier(deleteRule);
}

async function featureAccess(connection, planCode, codes) {
  const placeholders = codes.map(() => '?').join(',');
  return count(connection,
    `SELECT COUNT(DISTINCT f.codigo) total FROM planFuncionalidad pf
     JOIN plan p ON p.idPlan=pf.idPlan
     JOIN funcionalidad f ON f.idFuncionalidad=pf.idFuncionalidad
     WHERE p.codigo=? AND p.activo=1 AND f.activo=1 AND pf.habilitada=1
       AND f.codigo IN (${placeholders})`,
    [planCode, ...codes]);
}

function invalidTemplateVariables(rows) {
  let invalid = 0;
  for (const row of rows) {
    const tokens = String(row.contenido || '').match(/\{[^{}]+\}/g) || [];
    if (tokens.some((token) => !ALLOWED_TEMPLATE_VARIABLES.has(token.slice(1, -1)))) invalid += 1;
  }
  return invalid;
}

async function inspectData(connection, ready) {
  const data = {
    tiendas: await hasTable(connection, 'tienda') ? await count(connection, 'SELECT COUNT(*) total FROM tienda') : null,
    configuraciones: null,
    tiendasSinConfiguracion: null,
    configuracionesHuerfanas: null,
    configuracionesInvalidas: null,
    responsablesConfiguracionCruzados: null,
    plantillas: null,
    tiendasSinPlantillasDefault: null,
    plantillasDuplicadas: null,
    plantillasInvalidas: null,
    variablesPlantillaInvalidas: null,
    plantillasCruzadas: null,
    clientesInvalidos: null,
    documentosNormalizadosDuplicados: null,
    responsablesClienteCruzados: null,
    fiadosInvalidos: null,
    fiadosSaldoNoReconciliado: null,
    fiadosPagosNoReconciliados: null,
    fiadosFechasIncoherentes: null,
    fiadosCierreIncoherente: null,
    responsablesFiadoCruzados: null,
    fiadosConVencimiento: null,
    cobrosInvalidos: null,
    cobrosReferenciasCruzadas: null,
    clavesCobroDuplicadas: null,
    cobrosSinDistribucion: null,
    cobrosSumaDistribucionInvalida: null,
    pagosSinCobro: null,
    pagosSinClaveDistribucion: null,
    clavesDistribucionDuplicadas: null,
    pagosCruzados: null,
    cabecerasLegadoInvalidas: null,
    pagosLegadoSinCabeceraDeterministica: null,
    cabecerasLegadoSinPago: null,
    pagosVentaDuplicadosPorPagoFiado: null,
    seguimientos: null,
    seguimientosInvalidos: null,
    seguimientosCruzados: null,
    funcionalidadesActivas: null,
    funcionalidadesNuevasActivas: null,
    accesosBasicoCore: null,
    accesosAvanzadoCore: null,
    accesosAvanzadoExclusivos: null,
    funcionesAvanzadasEnBasico: null,
    funcionalidadesDuplicadas: null,
    accesosPlanDuplicados: null
  };

  if (ready.configuracioncreditotienda) {
    data.configuraciones = await count(connection, 'SELECT COUNT(*) total FROM configuracionCreditoTienda');
    data.tiendasSinConfiguracion = await count(connection,
      `SELECT COUNT(*) total FROM tienda t WHERE NOT EXISTS (
         SELECT 1 FROM configuracionCreditoTienda c WHERE c.idTienda=t.idTienda
       )`);
    data.configuracionesHuerfanas = await count(connection,
      `SELECT COUNT(*) total FROM configuracionCreditoTienda c
       LEFT JOIN tienda t ON t.idTienda=c.idTienda WHERE t.idTienda IS NULL`);
    data.configuracionesInvalidas = await count(connection,
      `SELECT COUNT(*) total FROM configuracionCreditoTienda
       WHERE (limiteCreditoDefault IS NOT NULL AND limiteCreditoDefault<0)
          OR diasCreditoDefault NOT BETWEEN 1 AND 365
          OR diasAvisoVencimiento NOT BETWEEN 0 AND 90
          OR politicaFiadoVencido NOT IN ('permitir','advertir','bloquear')
          OR requiereTelefonoParaFiado NOT IN (0,1)
          OR permiteFiadoSinFecha NOT IN (0,1)
          OR (codigoPaisWhatsApp IS NOT NULL AND codigoPaisWhatsApp NOT REGEXP '^[0-9]{1,8}$')`);
    data.responsablesConfiguracionCruzados = await count(connection,
      `SELECT COUNT(*) total FROM configuracionCreditoTienda c
       LEFT JOIN administrador a ON a.idTienda=c.idTienda AND a.idAdministrador=c.idAdministradorActualiza
       WHERE c.idAdministradorActualiza IS NOT NULL AND a.idAdministrador IS NULL`);
  }

  if (ready.plantillacobranzatienda) {
    data.plantillas = await count(connection, 'SELECT COUNT(*) total FROM plantillaCobranzaTienda');
    const requiredTemplateSql = DEFAULT_TEMPLATES.map(() => '(p.tipo=? AND p.nombre=?)').join(' OR ');
    data.tiendasSinPlantillasDefault = await count(connection,
      `SELECT COUNT(*) total FROM tienda t WHERE (
         SELECT COUNT(*) FROM plantillaCobranzaTienda p
         WHERE p.idTienda=t.idTienda AND (${requiredTemplateSql})
       )<>?`, [...DEFAULT_TEMPLATES.flat(), DEFAULT_TEMPLATES.length]);
    data.plantillasDuplicadas = await count(connection,
      `SELECT COUNT(*) total FROM (
         SELECT idTienda, tipo, nombre FROM plantillaCobranzaTienda
         GROUP BY idTienda, tipo, nombre HAVING COUNT(*)>1
       ) duplicadas`);
    data.plantillasInvalidas = await count(connection,
      `SELECT COUNT(*) total FROM plantillaCobranzaTienda
       WHERE CHAR_LENGTH(TRIM(nombre))=0 OR CHAR_LENGTH(TRIM(contenido))=0 OR activo NOT IN (0,1)`);
    data.plantillasCruzadas = await count(connection,
      `SELECT COUNT(*) total FROM plantillaCobranzaTienda p
       LEFT JOIN tienda t ON t.idTienda=p.idTienda
       LEFT JOIN administrador a ON a.idTienda=p.idTienda AND a.idAdministrador=p.idAdministradorActualiza
       WHERE t.idTienda IS NULL
          OR (p.idAdministradorActualiza IS NOT NULL AND a.idAdministrador IS NULL)`);
    const [templates] = await connection.query('SELECT contenido FROM plantillaCobranzaTienda');
    data.variablesPlantillaInvalidas = invalidTemplateVariables(templates);
  }

  if (ready.cliente) {
    data.clientesInvalidos = await count(connection,
      `SELECT COUNT(*) total FROM cliente
       WHERE creadoEn IS NULL OR actualizadoEn IS NULL
          OR (limiteCredito IS NOT NULL AND limiteCredito<0)
          OR permiteFiado NOT IN (0,1) OR aceptaRecordatorios NOT IN (0,1)
          OR (diasCreditoDefault IS NOT NULL AND diasCreditoDefault NOT BETWEEN 1 AND 365)
          OR (correo IS NOT NULL AND CHAR_LENGTH(TRIM(correo))=0)
          OR (documentoNormalizado IS NOT NULL AND CHAR_LENGTH(TRIM(documentoNormalizado))=0)
          OR (telefonoNormalizado IS NOT NULL AND CHAR_LENGTH(TRIM(telefonoNormalizado))=0)`);
    data.documentosNormalizadosDuplicados = await count(connection,
      `SELECT COUNT(*) total FROM (
         SELECT idTienda, documentoNormalizado FROM cliente
         WHERE documentoNormalizado IS NOT NULL
         GROUP BY idTienda, documentoNormalizado HAVING COUNT(*)>1
       ) duplicados`);
    data.responsablesClienteCruzados = await count(connection,
      `SELECT COUNT(*) total FROM cliente c
       LEFT JOIN administrador ac ON ac.idTienda=c.idTienda AND ac.idAdministrador=c.idAdministradorCrea
       LEFT JOIN administrador au ON au.idTienda=c.idTienda AND au.idAdministrador=c.idAdministradorActualiza
       WHERE (c.idAdministradorCrea IS NOT NULL AND ac.idAdministrador IS NULL)
          OR (c.idAdministradorActualiza IS NOT NULL AND au.idAdministrador IS NULL)`);
  }

  if (ready.fiado) {
    data.fiadosInvalidos = await count(connection,
      `SELECT COUNT(*) total FROM fiado
       WHERE totalFiado<0 OR totalPagado<0 OR saldoPendiente<0 OR totalPagado>totalFiado`);
    data.fiadosSaldoNoReconciliado = await count(connection,
      `SELECT COUNT(*) total FROM fiado
       WHERE ABS((totalFiado-totalPagado)-saldoPendiente)>=0.01`);
    data.fiadosPagosNoReconciliados = await count(connection,
      `SELECT COUNT(*) total FROM (
         SELECT f.idTienda, f.idFiado, f.totalFiado, f.totalPagado, f.saldoPendiente
         FROM fiado f
         LEFT JOIN pagoFiado pf ON pf.idTienda=f.idTienda AND pf.idFiado=f.idFiado
         GROUP BY f.idTienda, f.idFiado, f.totalFiado, f.totalPagado, f.saldoPendiente
         HAVING ABS(COALESCE(SUM(pf.monto),0)-f.totalPagado)>=0.01
            OR ABS((f.totalFiado-COALESCE(SUM(pf.monto),0))-f.saldoPendiente)>=0.01
       ) diferencias`);
    data.fiadosFechasIncoherentes = await count(connection,
      `SELECT COUNT(*) total FROM fiado f
       JOIN venta v ON v.idTienda=f.idTienda AND v.idVenta=f.idVenta
       WHERE f.fechaVencimiento IS NOT NULL AND f.fechaVencimiento<DATE(v.fecha)`);
    data.fiadosCierreIncoherente = await count(connection,
      `SELECT COUNT(*) total FROM fiado
       WHERE (saldoPendiente>0 AND cerradoEn IS NOT NULL)
          OR (saldoPendiente=0 AND cerradoEn IS NULL)`);
    data.responsablesFiadoCruzados = await count(connection,
      `SELECT COUNT(*) total FROM fiado f
       LEFT JOIN administrador a ON a.idTienda=f.idTienda AND a.idAdministrador=f.idAdministradorCrea
       WHERE f.idAdministradorCrea IS NOT NULL AND a.idAdministrador IS NULL`);
    data.fiadosConVencimiento = await count(connection,
      'SELECT COUNT(*) total FROM fiado WHERE fechaVencimiento IS NOT NULL OR fechaPrometidaPago IS NOT NULL');
  }

  if (ready.cobrofiado && ready.pagofiado) {
    data.cobrosInvalidos = await count(connection,
      `SELECT COUNT(*) total FROM cobroFiado
       WHERE montoTotal<=0 OR cambio<0 OR esLegado NOT IN (0,1)
          OR (montoRecibido IS NULL AND cambio<>0)
          OR (montoRecibido IS NOT NULL AND (
                montoRecibido<montoTotal OR ABS((montoRecibido-montoTotal)-cambio)>=0.01
              ))`);
    data.cobrosReferenciasCruzadas = await count(connection,
      `SELECT COUNT(*) total FROM cobroFiado c
       LEFT JOIN cliente cl ON cl.idTienda=c.idTienda AND cl.idCliente=c.idCliente
       LEFT JOIN administrador a ON a.idTienda=c.idTienda AND a.idAdministrador=c.idAdministrador
       WHERE cl.idCliente IS NULL OR (c.idAdministrador IS NOT NULL AND a.idAdministrador IS NULL)`);
    data.clavesCobroDuplicadas = await count(connection,
      `SELECT COUNT(*) total FROM (
         SELECT idTienda, claveOperacion FROM cobroFiado
         GROUP BY idTienda, claveOperacion HAVING COUNT(*)>1
       ) duplicados`);
    data.cobrosSinDistribucion = await count(connection,
      `SELECT COUNT(*) total FROM cobroFiado c WHERE NOT EXISTS (
         SELECT 1 FROM pagoFiado pf
         WHERE pf.idTienda=c.idTienda AND pf.idCobroFiado=c.idCobroFiado
       )`);
    data.cobrosSumaDistribucionInvalida = await count(connection,
      `SELECT COUNT(*) total FROM (
         SELECT c.idTienda, c.idCobroFiado, c.montoTotal
         FROM cobroFiado c
         LEFT JOIN pagoFiado pf ON pf.idTienda=c.idTienda AND pf.idCobroFiado=c.idCobroFiado
         GROUP BY c.idTienda, c.idCobroFiado, c.montoTotal
         HAVING ABS(COALESCE(SUM(pf.monto),0)-c.montoTotal)>=0.01
       ) diferencias`);
    data.pagosSinCobro = await count(connection,
      'SELECT COUNT(*) total FROM pagoFiado WHERE idCobroFiado IS NULL');
    data.pagosSinClaveDistribucion = await count(connection,
      `SELECT COUNT(*) total FROM pagoFiado
       WHERE claveDistribucion IS NULL OR CHAR_LENGTH(TRIM(claveDistribucion))=0`);
    data.clavesDistribucionDuplicadas = await count(connection,
      `SELECT COUNT(*) total FROM (
         SELECT idTienda, claveDistribucion FROM pagoFiado
         GROUP BY idTienda, claveDistribucion HAVING COUNT(*)>1
       ) duplicados`);
    data.pagosCruzados = await count(connection,
      `SELECT COUNT(*) total FROM pagoFiado pf
       LEFT JOIN fiado f ON f.idTienda=pf.idTienda AND f.idFiado=pf.idFiado
       LEFT JOIN cobroFiado c ON c.idTienda=pf.idTienda AND c.idCobroFiado=pf.idCobroFiado
       WHERE f.idFiado IS NULL OR c.idCobroFiado IS NULL OR f.idCliente<>c.idCliente`);
    data.cabecerasLegadoInvalidas = await count(connection,
      `SELECT COUNT(*) total FROM cobroFiado c
       WHERE c.esLegado=1 AND (
         c.claveOperacion NOT REGEXP '^legado:pago-fiado:[0-9]+$'
         OR c.montoRecibido IS NOT NULL OR c.cambio<>0
       )`);
    data.pagosLegadoSinCabeceraDeterministica = await count(connection,
      `SELECT COUNT(*) total FROM pagoFiado pf
       LEFT JOIN cobroFiado c ON c.idTienda=pf.idTienda AND c.idCobroFiado=pf.idCobroFiado
       LEFT JOIN pagoVenta pv ON pv.idTienda=pf.idTienda AND pv.idPagoFiado=pf.idPagoFiado
       WHERE pf.claveDistribucion=CONCAT('legado:distribucion:',pf.idPagoFiado)
         AND (c.idCobroFiado IS NULL OR c.esLegado<>1
              OR c.claveOperacion<>CONCAT('legado:pago-fiado:',pf.idPagoFiado)
              OR c.montoTotal<>pf.monto OR c.fechaCobro<>pf.fechaPago
              OR c.metodoPago<>COALESCE(pv.metodoPago,'no_especificado')
              OR NOT (c.idAdministrador <=> pv.idAdministrador)
              OR NOT (c.referencia <=> pv.referencia))`);
    data.cabecerasLegadoSinPago = await count(connection,
      `SELECT COUNT(*) total FROM cobroFiado c
       WHERE c.esLegado=1 AND NOT EXISTS (
         SELECT 1 FROM pagoFiado pf
         WHERE pf.idTienda=c.idTienda AND pf.idCobroFiado=c.idCobroFiado
           AND c.claveOperacion=CONCAT('legado:pago-fiado:',pf.idPagoFiado)
       )`);
  }

  if (await hasTable(connection, 'pagoVenta')) {
    data.pagosVentaDuplicadosPorPagoFiado = await count(connection,
      `SELECT COUNT(*) total FROM (
         SELECT idTienda, idPagoFiado FROM pagoVenta
         WHERE idPagoFiado IS NOT NULL
         GROUP BY idTienda, idPagoFiado HAVING COUNT(*)>1
       ) duplicados`);
  }

  if (ready.seguimientocobranza) {
    data.seguimientos = await count(connection, 'SELECT COUNT(*) total FROM seguimientoCobranza');
    data.seguimientosInvalidos = await count(connection,
      `SELECT COUNT(*) total FROM seguimientoCobranza
       WHERE CHAR_LENGTH(TRIM(detalle))=0
          OR (tipo='compromiso_pago' AND fechaCompromiso IS NULL)`);
    data.seguimientosCruzados = await count(connection,
      `SELECT COUNT(*) total FROM seguimientoCobranza s
       LEFT JOIN cliente c ON c.idTienda=s.idTienda AND c.idCliente=s.idCliente
       LEFT JOIN fiado f ON f.idTienda=s.idTienda AND f.idCliente=s.idCliente AND f.idFiado=s.idFiado
       LEFT JOIN administrador a ON a.idTienda=s.idTienda AND a.idAdministrador=s.idAdministrador
       WHERE c.idCliente IS NULL OR a.idAdministrador IS NULL
          OR (s.idFiado IS NOT NULL AND f.idFiado IS NULL)`);
  }

  const featureTables = await hasTable(connection, 'funcionalidad')
    && await hasTable(connection, 'plan') && await hasTable(connection, 'planFuncionalidad');
  if (featureTables) {
    const allPlaceholders = ALL_FEATURES.map(() => '?').join(',');
    const newPlaceholders = NEW_FEATURES.map(() => '?').join(',');
    data.funcionalidadesActivas = await count(connection,
      `SELECT COUNT(DISTINCT codigo) total FROM funcionalidad
       WHERE activo=1 AND codigo IN (${allPlaceholders})`, ALL_FEATURES);
    data.funcionalidadesNuevasActivas = await count(connection,
      `SELECT COUNT(DISTINCT codigo) total FROM funcionalidad
       WHERE activo=1 AND codigo IN (${newPlaceholders})`, NEW_FEATURES);
    data.accesosBasicoCore = await featureAccess(connection, 'basico', CORE_FEATURES);
    data.accesosAvanzadoCore = await featureAccess(connection, 'avanzado', CORE_FEATURES);
    data.accesosAvanzadoExclusivos = await featureAccess(connection, 'avanzado', ADVANCED_FEATURES);
    data.funcionesAvanzadasEnBasico = await featureAccess(connection, 'basico', ADVANCED_FEATURES);
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

function dataIsValid(data) {
  const zeroChecks = [
    'tiendasSinConfiguracion', 'configuracionesHuerfanas', 'configuracionesInvalidas',
    'responsablesConfiguracionCruzados', 'tiendasSinPlantillasDefault',
    'plantillasDuplicadas', 'plantillasInvalidas', 'variablesPlantillaInvalidas',
    'plantillasCruzadas', 'clientesInvalidos', 'documentosNormalizadosDuplicados',
    'responsablesClienteCruzados', 'fiadosInvalidos', 'fiadosSaldoNoReconciliado',
    'fiadosPagosNoReconciliados',
    'fiadosFechasIncoherentes', 'fiadosCierreIncoherente', 'responsablesFiadoCruzados',
    'cobrosInvalidos', 'cobrosReferenciasCruzadas', 'clavesCobroDuplicadas',
    'cobrosSinDistribucion', 'cobrosSumaDistribucionInvalida', 'pagosSinCobro',
    'pagosSinClaveDistribucion', 'clavesDistribucionDuplicadas', 'pagosCruzados',
    'cabecerasLegadoInvalidas', 'pagosLegadoSinCabeceraDeterministica',
    'cabecerasLegadoSinPago', 'pagosVentaDuplicadosPorPagoFiado',
    'seguimientosInvalidos', 'seguimientosCruzados', 'funcionesAvanzadasEnBasico',
    'funcionalidadesDuplicadas', 'accesosPlanDuplicados'
  ];
  return zeroChecks.every((key) => data[key] === 0)
    && data.funcionalidadesActivas === ALL_FEATURES.length
    && data.funcionalidadesNuevasActivas === NEW_FEATURES.length
    && data.accesosBasicoCore === CORE_FEATURES.length
    && data.accesosAvanzadoCore === CORE_FEATURES.length
    && data.accesosAvanzadoExclusivos === ADVANCED_FEATURES.length;
}

async function main() {
  const config = databaseConfig();
  logDatabaseTarget('Comprobacion de clientes, fiados y comunicacion', config);
  const connection = await createConnection();
  try {
    const [[databaseRow]] = await connection.query('SELECT DATABASE() baseActiva');
    activeDatabaseName = String(databaseRow?.baseActiva || '').trim();
    if (!activeDatabaseName) {
      throw new Error('La conexion no tiene una base activa seleccionada.');
    }
    if (identifier(activeDatabaseName) !== identifier(config.database)) {
      throw new Error(
        `La base activa (${activeDatabaseName}) no coincide con la base configurada (${config.database}).`
      );
    }
    const migrationTable = await hasTable(connection, 'schema_migrations');
    const migracionRegistrada = migrationTable
      ? await count(
        connection,
        'SELECT COUNT(*) total FROM schema_migrations WHERE LOWER(nombre)=LOWER(?)',
        [identifier(MIGRATION)]
      ) === 1
      : false;

    const tablas = {};
    for (const table of Object.keys(REQUIRED_COLUMNS)) {
      tablas[identifier(table)] = await hasTable(connection, table);
    }
    const columnas = {};
    const detallesColumnas = {};
    const tiposNulabilidadDefaults = {};
    for (const [table, required] of Object.entries(REQUIRED_COLUMNS)) {
      const tableKey = identifier(table);
      const details = tablas[tableKey] ? await columnDetails(connection, table, required) : {};
      detallesColumnas[tableKey] = details;
      columnas[tableKey] = required.every((column) => Boolean(details[identifier(column)]));
      tiposNulabilidadDefaults[tableKey] = {};
      for (const [column, expected] of Object.entries(COLUMN_DEFINITIONS[table])) {
        tiposNulabilidadDefaults[tableKey][identifier(column)] = definitionMatches(
          details[identifier(column)], expected
        );
      }
    }

    const indices = {};
    for (const index of INDEXES) {
      indices[identifier(`${index[0]}.${index[1]}`)] = await hasIndex(connection, ...index);
    }
    const checks = {};
    for (const check of CHECKS) {
      checks[identifier(`${check[0]}.${check[1]}`)] = await hasCheck(connection, ...check);
    }
    const clavesForaneas = {};
    for (const relation of FOREIGN_KEYS) {
      clavesForaneas[identifier(`${relation[0]}.${relation[1]}`)]
        = await hasForeignKey(connection, relation);
    }
    const motores = {};
    for (const table of [
      'cliente', 'fiado', 'pagoFiado', 'configuracionCreditoTienda', 'cobroFiado',
      'seguimientoCobranza', 'plantillaCobranzaTienda'
    ]) {
      const tableKey = identifier(table);
      if (!tablas[tableKey]) {
        motores[tableKey] = false;
        continue;
      }
      const [[row]] = await connection.query(
        `SELECT ENGINE FROM information_schema.TABLES
         WHERE LOWER(TABLE_SCHEMA)=LOWER(?) AND LOWER(TABLE_NAME)=LOWER(?)`,
        [activeSchema(), tableKey]
      );
      motores[tableKey] = identifier(row?.ENGINE) === 'innodb';
    }

    const estructuraCompleta = Object.values(tablas).every(Boolean)
      && Object.values(columnas).every(Boolean)
      && Object.values(tiposNulabilidadDefaults).every((table) => Object.values(table).every(Boolean))
      && Object.values(indices).every(Boolean)
      && Object.values(checks).every(Boolean)
      && Object.values(clavesForaneas).every(Boolean)
      && Object.values(motores).every(Boolean);
    const ready = Object.fromEntries(Object.entries(tablas).map(([table, exists]) => [table, exists && columnas[table]]));
    const datos = await inspectData(connection, ready);
    const datosValidos = estructuraCompleta && dataIsValid(datos);

    const newColumnPresent = ['direccion', 'fechaVencimiento', 'idCobroFiado'].some((column) =>
      Object.values(detallesColumnas).some((table) => Boolean(table[identifier(column)])));
    const newTablePresent = ['configuracionCreditoTienda', 'cobroFiado', 'seguimientoCobranza', 'plantillaCobranzaTienda']
      .some((table) => tablas[identifier(table)]);
    const newFeaturePresent = Number(datos.funcionalidadesNuevasActivas || 0) > 0;
    const estadoMigracion = migracionRegistrada && estructuraCompleta && datosValidos
      ? 'post-migracion'
      : (!migracionRegistrada && !newColumnPresent && !newTablePresent && !newFeaturePresent)
        ? 'pre-migracion'
        : 'estructura-incompleta-o-migracion-parcial';

    console.log(JSON.stringify({
      destino: {
        entorno: String(process.env.APP_ENV || 'predeterminado'),
        base: activeDatabaseName,
        baseConfigurada: config.database,
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
      funcionalidades: {
        requeridas: ALL_FEATURES,
        nuevas: NEW_FEATURES
      },
      accesos: {
        basico: CORE_FEATURES,
        avanzado: ALL_FEATURES
      },
      inconsistencias: datos,
      conteos: {
        tiendas: datos.tiendas,
        configuraciones: datos.configuraciones,
        plantillas: datos.plantillas,
        fiadosConVencimiento: datos.fiadosConVencimiento,
        seguimientos: datos.seguimientos
      },
      garantiasEstaticasMigracion: {
        actualizaSaldoPendiente: false,
        insertaPagoVenta: false,
        inventaFechaVencimiento: false,
        creaSeguimientosAutomaticos: false
      }
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
  console.error('No se pudo comprobar la estructura de clientes, fiados y comunicacion.');
  console.error(error.message);
  process.exit(1);
});
