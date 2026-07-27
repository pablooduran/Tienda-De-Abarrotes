const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
require('../config/env');
const {
  buildDatabaseOptions,
  isProductionEnvironment,
  setBusinessSessionTimeZone
} = require('../config/database-options');
const {
  createInventoryAdjustmentService,
  normalizeRequest
} = require('../services/inventory-adjustment-service');
const {
  inventoryReconciliation
} = require('../services/inventory-reconciliation-service');
const {
  MIGRATION,
  inspectInventoryAdjustments
} = require('./check-inventory-adjustments');

const ROOT = path.join(__dirname, '..');
const SCHEMA_FILE = path.join(ROOT, 'database', 'tienda_abarrotes.sql');
const MIGRATIONS_DIR = path.join(ROOT, 'database', 'migrations');
const TEMP_PREFIX = 'tmp_tienda_restore_';
const PRIMARY_DATABASE = 'tienda_abarrotes_pruebas';
const PROTECTED = new Set([
  'tienda_abarrotes', PRIMARY_DATABASE, 'mysql',
  'information_schema', 'performance_schema', 'sys'
]);
const FINGERPRINT_TABLES = Object.freeze([
  'tienda', 'administrador', 'producto', 'movimientoStock', 'loteProducto',
  'movimientoLote', 'venta', 'pagoVenta', 'fiado', 'pagoFiado', 'cobroFiado',
  'eventoAuditoriaAdministrativa'
]);

function check(condition, message) {
  if (!condition) throw new Error(message);
  console.log(`OK: ${message}`);
}

function safeDatabase(name) {
  const normalized = String(name || '').trim().toLowerCase();
  if (!new RegExp(`^${TEMP_PREFIX}[a-f0-9]{12}$`).test(normalized) || PROTECTED.has(normalized)) {
    throw new Error('La guarda rechazo el nombre de la base temporal de inventario.');
  }
  return normalized;
}

function quotedDatabase(name) {
  return `\`${safeDatabase(name)}\``;
}

function assertRuntime() {
  const environment = String(process.env.APP_ENV || '').trim().toLowerCase();
  const host = String(process.env.DB_HOST || '').trim().toLowerCase();
  const database = String(process.env.DB_NAME || '').trim().toLowerCase();
  if (!['local', 'test'].includes(environment) || isProductionEnvironment(process.env)) {
    throw new Error('test:inventory-adjustments exige APP_ENV local o test.');
  }
  if (host !== 'localhost' || database !== PRIMARY_DATABASE) {
    throw new Error('test:inventory-adjustments solo usa localhost/tienda_abarrotes_pruebas.');
  }
  if (!String(process.env.BACKUP_RESTORE_USER || '').trim()
    || !String(process.env.BACKUP_RESTORE_PASSWORD || '')) {
    throw new Error('Faltan las credenciales locales limitadas a tmp_tienda_restore_%.*.');
  }
}

function restoreEnvironment(database = null) {
  return {
    ...process.env,
    APP_ENV: 'local',
    DB_HOST: 'localhost',
    DB_USER: String(process.env.BACKUP_RESTORE_USER || '').trim(),
    DB_PASSWORD: String(process.env.BACKUP_RESTORE_PASSWORD || ''),
    ...(database ? { DB_NAME: safeDatabase(database) } : {})
  };
}

async function connect(environment, includeDatabase = true) {
  const options = buildDatabaseOptions(environment, { decimalNumbers: true });
  if (!includeDatabase) delete options.database;
  return setBusinessSessionTimeZone(await mysql.createConnection(options));
}

function statements(sql) {
  return sql.split(';').map((part) => part.split(/\r?\n/)
    .filter((line) => !line.trim().startsWith('--')).join('\n').trim())
    .filter(Boolean)
    .filter((statement) => !/^(USE|CREATE\s+DATABASE|DROP\s+)/i.test(statement));
}

async function executeSql(connection, sql) {
  for (const statement of statements(sql)) await connection.query(statement);
}

function schemaBeforeInventoryAdjustment() {
  return fs.readFileSync(SCHEMA_FILE, 'utf8')
    .replace(/-- INVENTORY_ADJUSTMENT_TABLE_START[\s\S]*?-- INVENTORY_ADJUSTMENT_TABLE_END/g, '')
    .replace(/-- INVENTORY_SELLABLE_LOT_CLASSIFICATION_START[\s\S]*?-- INVENTORY_SELLABLE_LOT_CLASSIFICATION_END/g, '')
    .replace(/-- INVENTORY_SELLABLE_LOT_INDEX_START[\s\S]*?-- INVENTORY_SELLABLE_LOT_INDEX_END/g, '')
    .replace(/-- INVENTORY_SELLABLE_LOT_CHECKS_START[\s\S]*?-- INVENTORY_SELLABLE_LOT_CHECKS_END/g, '');
}

function migrationNames() {
  return fs.readdirSync(MIGRATIONS_DIR)
    .filter((name) => /^\d{3}_.+\.sql$/i.test(name))
    .sort();
}

async function registerPriorMigrations(connection) {
  await connection.query(
    `CREATE TABLE schema_migrations (
       nombre VARCHAR(255) PRIMARY KEY,
       aplicadaEn DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
     ) ENGINE=InnoDB`
  );
  for (const name of migrationNames().filter((name) => name < MIGRATION)) {
    await connection.query('INSERT INTO schema_migrations (nombre) VALUES (?)', [name]);
  }
}

async function applyInventoryMigration(connection) {
  await executeSql(
    connection,
    fs.readFileSync(path.join(MIGRATIONS_DIR, MIGRATION), 'utf8')
  );
  await connection.query('INSERT INTO schema_migrations (nombre) VALUES (?)', [MIGRATION]);
  check(true, '019 se aplica directamente sobre la base temporal post-018.');
}

async function aggregate(connection, table) {
  const [columns] = await connection.query(
    `SELECT COLUMN_NAME, DATA_TYPE
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?
     ORDER BY ORDINAL_POSITION`,
    [table]
  );
  if (!columns.length) return null;
  const numeric = columns
    .filter((column) => /^(tinyint|smallint|mediumint|int|bigint|decimal|float|double)$/.test(column.DATA_TYPE))
    .slice(0, 8)
    .map((column) => `COALESCE(SUM(\`${column.COLUMN_NAME}\`),0) \`${column.COLUMN_NAME}\``);
  const [[row]] = await connection.query(
    `SELECT COUNT(*) total${numeric.length ? `, ${numeric.join(', ')}` : ''} FROM \`${table}\``
  );
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, String(value)]));
}

async function fingerprint(connection) {
  const [migrations] = await connection.query(
    `SELECT nombre, DATE_FORMAT(aplicadaEn, '%Y-%m-%d %H:%i:%s') aplicadaEn
     FROM schema_migrations ORDER BY nombre`
  );
  const tables = {};
  for (const table of FINGERPRINT_TABLES) tables[table] = await aggregate(connection, table);
  const [structure] = await connection.query(
    `SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA=DATABASE()
       AND TABLE_NAME IN ('producto','loteProducto','movimientoStock','movimientoLote')
     ORDER BY TABLE_NAME, ORDINAL_POSITION`
  );
  return { migrations, tables, structure };
}

function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

async function seed(connection) {
  const marker = crypto.randomBytes(4).toString('hex');
  const [store] = await connection.query(
    `INSERT INTO tienda (nombre, slug, activo, estado)
     VALUES (?, ?, 1, 'activa')`,
    [`Inventario A ${marker}`, `inventario-a-${marker}`]
  );
  const [storeB] = await connection.query(
    `INSERT INTO tienda (nombre, slug, activo, estado)
     VALUES (?, ?, 1, 'activa')`,
    [`Inventario B ${marker}`, `inventario-b-${marker}`]
  );
  const [admin] = await connection.query(
    `INSERT INTO administrador (idTienda, usuario, password, rol, activo)
     VALUES (?, ?, 'no-usado', 'dueno_tienda', 1)`,
    [store.insertId, `inv_a_${marker}`]
  );
  const [adminB] = await connection.query(
    `INSERT INTO administrador (idTienda, usuario, password, rol, activo)
     VALUES (?, ?, 'no-usado', 'dueno_tienda', 1)`,
    [storeB.insertId, `inv_b_${marker}`]
  );
  const now = '2026-07-26 10:00:00';
  async function product(idTienda, name, stock, lots, expiration = false) {
    const [row] = await connection.query(
      `INSERT INTO producto
       (idTienda, nombre, categoria, unidadMedida, unidadesPorPaquete,
        paquetesPorCaja, precioVenta, stock, stockMinimo, stockUnidadesTotal,
        fechaInicioSeguimiento, controlaLotes, controlaVencimiento, lotesActivadosEn)
       VALUES (?, ?, 'PRUEBA', 'unidad', 1, 1, 10, ?, 1, ?, ?, ?, ?, ?)`,
      [idTienda, name, stock, stock, now, lots ? 1 : 0, expiration ? 1 : 0, lots ? now : null]
    );
    return Number(row.insertId);
  }
  const simple = await product(store.insertId, `Simple ${marker}`, 10, false);
  const controlled = await product(store.insertId, `Lotes ${marker}`, 10, true, true);
  const foreign = await product(storeB.insertId, `Ajeno ${marker}`, 5, false);
  async function initialMovement(idTienda, idProducto, idAdministrador, stock) {
    await connection.query(
      `INSERT INTO movimientoStock
       (idTienda,idProducto,tipoMovimiento,origen,cantidad,stockAnterior,stockPosterior,
        cantidadOperacion,unidadOperacion,motivo,claveOperacion,idAdministrador,creadoEn)
       VALUES (?,?,'inventario_inicial','alta_producto',?,0,?,?,'unidad_base',
        'Fixture temporal',?, ?, ?)`,
      [idTienda, idProducto, stock, stock, stock, `fixture:${marker}:${idProducto}`, idAdministrador, now]
    );
  }
  await initialMovement(store.insertId, simple, admin.insertId, 10);
  await initialMovement(store.insertId, controlled, admin.insertId, 10);
  await initialMovement(storeB.insertId, foreign, adminB.insertId, 5);
  const lotDefinitions = [
    ['VEND', 'vendible', 'disponible', 'ajuste_positivo', '2026-08-20', 3],
    ['EXP', 'vendible', 'disponible', 'ajuste_positivo', '2026-07-20', 2],
    ['BLOCK', 'bloqueado', 'bloqueado', 'ajuste_positivo', '2026-08-20', 2],
    ['ISOLATE', 'aislado', 'bloqueado', 'ajuste_positivo', '2026-08-20', 1],
    ['TECH', 'tecnico', 'bloqueado', 'reversion', '2026-08-20', 2]
  ];
  const lotIngreso = '2026-07-01 10:00:00';
  for (let index = 0; index < lotDefinitions.length; index += 1) {
    const [code, classification, state, origin, expirationDate, quantity] = lotDefinitions[index];
    const [lot] = await connection.query(
      `INSERT INTO loteProducto
       (idTienda,idProducto,codigoLote,origen,fechaIngreso,fechaVencimiento,
        cantidadInicial,cantidadRestante,costoUnitarioBase,estadoOperativo,
        clasificacionInventario,claveOperacion,creadoEn,actualizadoEn,idAdministradorCrea)
       VALUES (?,?,?,?,?,?,?,?,2,?,?,?, ?, ?, ?)`,
      [
        store.insertId, controlled, code, origin, lotIngreso, expirationDate,
        quantity, quantity, state, classification,
        `fixture-lot:${marker}:${index}`, now, now, admin.insertId
      ]
    );
    await connection.query(
      `INSERT INTO movimientoLote
       (idTienda,idProducto,idLoteProducto,idMovimientoStock,tipoRegistro,cantidad,
        cantidadAnterior,cantidadPosterior,claveOperacion,creadoEn,idAdministrador)
       VALUES (?,?,?,NULL,'distribucion_inicial',?,0,?,?,?,?)`,
      [
        store.insertId, controlled, lot.insertId, quantity, quantity,
        `fixture-ml:${marker}:${index}`, now, admin.insertId
      ]
    );
  }
  return {
    storeA: Number(store.insertId),
    storeB: Number(storeB.insertId),
    adminA: Number(admin.insertId),
    simple,
    controlled,
    foreign
  };
}

function auditDouble(connection) {
  return {
    recordCritical: (transaction, input) => {
      const action = input.action;
      return transaction.query(
        `INSERT INTO eventoAuditoriaAdministrativa
         (idTienda,actorTipo,idAdministradorActor,categoria,accion,resultado,
          codigoResultado,origen,entidadTipo,referenciaSegura,requestId,creadoEn)
         VALUES (?,'administrador',?,'inventario',?,?,?,'web',?,?,?,?)`,
        [
          input.storeId, input.administratorId, action, input.result,
          input.resultCode, action.includes('aplicado') ? 'ajuste_inventario' : 'ajuste_inventario',
          input.reference, input.requestId || crypto.randomUUID(), '2026-07-26 10:00:00'
        ]
      );
    },
    recordOutcome: () => Promise.resolve({ recorded: true })
  };
}

async function count(connection, sql, params = []) {
  const [[row]] = await connection.query(sql, params);
  return Number(row.total);
}

async function main() {
  assertRuntime();
  const tempName = `${TEMP_PREFIX}${crypto.randomBytes(6).toString('hex')}`;
  const primary = await connect(process.env);
  const server = await connect(restoreEnvironment(), false);
  let temporary;
  let before;
  try {
    before = await fingerprint(primary);
    console.log(`Huella principal inicial: ${digest(before)}`);
    await server.query(
      `CREATE DATABASE ${quotedDatabase(tempName)}
       CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
    temporary = await connect(restoreEnvironment(tempName));
    await executeSql(temporary, schemaBeforeInventoryAdjustment());
    await registerPriorMigrations(temporary);
    await applyInventoryMigration(temporary);
    const state = await inspectInventoryAdjustments(temporary, { schemaName: tempName });
    check(state.estado === 'post', '019 queda completa y valida en la base temporal.');
    check(await count(temporary, 'SELECT COUNT(*) total FROM ajusteInventario') === 0,
      'La migracion no crea ajustes automaticos.');

    const fixture = await seed(temporary);
    const reconciliation = await inventoryReconciliation(temporary, fixture.storeA, {
      page: 1, pageSize: 25
    });
    const lotRow = reconciliation.resultados.find((row) => row.idProducto === fixture.controlled);
    check(lotRow.stockFisico === 10 && lotRow.stockVendible === 3 && lotRow.stockNoVendible === 7,
      'Stock fisico, vendible y no vendible se distinguen por lote.');
    check(lotRow.desgloseNoVendible.vencido === 2
      && lotRow.desgloseNoVendible.bloqueado === 2
      && lotRow.desgloseNoVendible.aislado === 1
      && lotRow.desgloseNoVendible.tecnico === 2,
    'El desglose vencido, bloqueado, aislado y tecnico es reproducible.');

    const audit = auditDouble(temporary);
    const service = createInventoryAdjustmentService({
      database: {
        getConnection: async () => temporary
      },
      audit,
      clock: () => new Date('2026-07-26T10:00:00-04:00')
    });
    const originalRelease = temporary.release;
    temporary.release = () => {};
    const context = {
      idTienda: fixture.storeA,
      idAdministrador: fixture.adminA,
      idProducto: fixture.simple,
      requestId: crypto.randomUUID()
    };
    const positiveBody = {
      tipoAjuste: 'positivo', cantidad: 2, motivoCodigo: 'conteo_fisico',
      confirmado: true, claveOperacion: `inv-${crypto.randomUUID()}`,
      modoLotes: 'no_aplica', clasificacionInventario: 'vendible'
    };
    const positive = await service.applyAdjustment(context, positiveBody);
    check(positive.stockFisicoAnterior === 10 && positive.stockFisicoPosterior === 12,
      'El ajuste positivo sin lotes conserva saldos anterior y posterior.');
    const repeated = await service.applyAdjustment(
      { ...context, requestId: crypto.randomUUID() },
      positiveBody
    );
    check(repeated.repetida === true && repeated.idAjusteInventario === positive.idAjusteInventario,
      'La misma clave y huella devuelve el ajuste existente.');
    let conflict = null;
    try {
      await service.applyAdjustment(
        { ...context, requestId: crypto.randomUUID() },
        { ...positiveBody, cantidad: 3 }
      );
    } catch (error) {
      conflict = error;
    }
    check(conflict?.code === 'OPERATION_KEY_CONFLICT', 'Una clave con otra huella produce conflicto.');

    const isolated = await service.applyAdjustment({
      ...context, idProducto: fixture.controlled, requestId: crypto.randomUUID()
    }, {
      tipoAjuste: 'positivo', cantidad: 2, motivoCodigo: 'danio',
      confirmado: true, claveOperacion: `inv-${crypto.randomUUID()}`,
      modoLotes: 'lote_nuevo', clasificacionInventario: 'aislado',
      lote: { codigoLote: 'AISLADO-NUEVO', fechaVencimiento: '2026-08-30', costoUnitarioBase: '2' }
    });
    check(isolated.stockFisicoPosterior === 12 && isolated.stockVendiblePosterior === 3,
      'Un ajuste aislado aumenta fisico sin volver vendible la mercancia.');
    const negative = await service.applyAdjustment({
      ...context, idProducto: fixture.controlled, requestId: crypto.randomUUID()
    }, {
      tipoAjuste: 'negativo', cantidad: 1, motivoCodigo: 'merma',
      confirmado: true, claveOperacion: `inv-${crypto.randomUUID()}`,
      modoLotes: 'fefo_fifo', clasificacionInventario: 'vendible'
    });
    check(negative.stockFisicoPosterior === 11 && negative.stockVendiblePosterior === 2,
      'El ajuste negativo FEFO/FIFO consume solamente stock vendible.');
    const [[technicalLot]] = await temporary.query(
      `SELECT idLoteProducto
       FROM loteProducto
       WHERE idTienda=? AND idProducto=? AND clasificacionInventario='tecnico'
       LIMIT 1`,
      [fixture.storeA, fixture.controlled]
    );
    const technicalExit = await service.applyAdjustment({
      ...context, idProducto: fixture.controlled, requestId: crypto.randomUUID()
    }, {
      tipoAjuste: 'negativo', cantidad: 1, motivoCodigo: 'correccion_registro',
      confirmado: true, claveOperacion: `inv-${crypto.randomUUID()}`,
      modoLotes: 'lote_explicito', clasificacionInventario: 'vendible',
      idLoteProducto: Number(technicalLot.idLoteProducto)
    });
    check(technicalExit.stockFisicoPosterior === 10 && technicalExit.stockVendiblePosterior === 2,
      'La salida explicita de un lote tecnico reduce fisico sin reducir vendible.');

    const concurrentKey = `inv-${crypto.randomUUID()}`;
    const concurrentPool = mysql.createPool(buildDatabaseOptions(
      restoreEnvironment(tempName),
      { decimalNumbers: true }
    ));
    try {
      const concurrentService = createInventoryAdjustmentService({
        database: concurrentPool,
        audit,
        clock: () => new Date('2026-07-26T10:00:00-04:00')
      });
      const concurrentBody = {
        ...positiveBody,
        cantidad: 1,
        claveOperacion: concurrentKey
      };
      const concurrentResults = await Promise.all([
        concurrentService.applyAdjustment({
          ...context, requestId: crypto.randomUUID()
        }, concurrentBody),
        concurrentService.applyAdjustment({
          ...context, requestId: crypto.randomUUID()
        }, concurrentBody)
      ]);
      check(concurrentResults.filter((item) => item.repetida).length === 1
        && await count(
          temporary,
          'SELECT COUNT(*) total FROM ajusteInventario WHERE idTienda=? AND claveOperacion=?',
          [fixture.storeA, concurrentKey]
        ) === 1,
      'Dos solicitudes concurrentes con la misma clave producen un solo ajuste.');
    } finally {
      await concurrentPool.end();
    }

    let excess = null;
    try {
      await service.applyAdjustment({
        ...context, idProducto: fixture.simple, requestId: crypto.randomUUID()
      }, {
        tipoAjuste: 'negativo', cantidad: 999, motivoCodigo: 'conteo_fisico',
        confirmado: true, claveOperacion: `inv-${crypto.randomUUID()}`,
        modoLotes: 'no_aplica', clasificacionInventario: 'vendible'
      });
    } catch (error) {
      excess = error;
    }
    check(excess?.code === 'INSUFFICIENT_PHYSICAL_STOCK', 'Se rechaza el ajuste que produciria stock negativo.');

    let foreign = null;
    try {
      await service.applyAdjustment({
        ...context, idProducto: fixture.foreign, requestId: crypto.randomUUID()
      }, {
        ...positiveBody,
        claveOperacion: `inv-${crypto.randomUUID()}`
      });
    } catch (error) {
      foreign = error;
    }
    check(foreign?.status === 404, 'Una tienda no ajusta productos de otra tienda.');

    const beforeRollback = await count(
      temporary,
      'SELECT stockUnidadesTotal total FROM producto WHERE idTienda=? AND idProducto=?',
      [fixture.storeA, fixture.simple]
    );
    const failingService = createInventoryAdjustmentService({
      database: { getConnection: async () => temporary },
      audit: {
        recordCritical: async () => { throw new Error('Fallo controlado de auditoria.'); },
        recordOutcome: async () => ({ recorded: false })
      },
      clock: () => new Date('2026-07-26T10:00:00-04:00')
    });
    let rollbackError;
    try {
      await failingService.applyAdjustment({
        ...context, requestId: crypto.randomUUID()
      }, {
        ...positiveBody,
        claveOperacion: `inv-${crypto.randomUUID()}`
      });
    } catch (error) {
      rollbackError = error;
    }
    check(Boolean(rollbackError), 'Un fallo transaccional se propaga de forma controlada.');
    check(await count(
      temporary,
      'SELECT stockUnidadesTotal total FROM producto WHERE idTienda=? AND idProducto=?',
      [fixture.storeA, fixture.simple]
    ) === beforeRollback, 'El rollback revierte producto, movimiento, ajuste y auditoria.');

    check(await count(
      temporary,
      `SELECT COUNT(*) total FROM eventoAuditoriaAdministrativa
       WHERE idTienda=? AND accion='ajuste_inventario_aplicado'`,
      [fixture.storeA]
    ) >= 3, 'Los ajustes aplicados generan auditoria allowlisted.');
    check(await count(
      temporary,
      `SELECT COUNT(*) total FROM ajusteInventario
       WHERE claveOperacion LIKE '%password%' OR huellaSolicitud=''`
    ) === 0, 'Los ajustes no almacenan secretos ni huellas vacias.');
    check(!/DELETE\s+FROM/i.test(fs.readFileSync(path.join(ROOT, 'services', 'inventory-adjustment-service.js'), 'utf8')),
      'El servicio no contiene DELETE fisicos.');
    check(normalizeRequest({
      ...positiveBody,
      observacion: 'Texto seguro'
    }).cantidad === 2, 'El contrato acepta una solicitud valida y explicita.');
    temporary.release = originalRelease;
  } finally {
    if (temporary) await temporary.end();
    await server.query(`DROP DATABASE IF EXISTS ${quotedDatabase(tempName)}`);
    const after = await fingerprint(primary);
    check(digest(after) === digest(before), 'La huella de la base principal permanece intacta.');
    const [remaining] = await server.query(
      `SELECT SCHEMA_NAME FROM information_schema.SCHEMATA
       WHERE SCHEMA_NAME=?`,
      [tempName]
    );
    check(remaining.length === 0, 'La base temporal se elimina en finally.');
    await primary.end();
    await server.end();
  }
}

main().catch((error) => {
  console.error('La prueba de stock vendible y ajustes fallo.');
  console.error(String(error.message || error).replace(/password|secret|token|hash/gi, '[REDACTED]'));
  process.exitCode = 1;
});
