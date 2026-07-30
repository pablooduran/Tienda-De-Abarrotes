const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const mysql = require('mysql2/promise');
const {
  buildDatabaseOptions,
  setBusinessSessionTimeZone
} = require('../config/database-options');
const { requireLocalhostDatabase } = require('../config/env');
const { readSqlStatements } = require('./db-utils');
const {
  inspectSubscriptionLifecycle
} = require('./check-subscription-lifecycle');
const {
  SUBSCRIPTION_GRACE_DAYS,
  periodTypeForDuration,
  sanitizeLifecycleMetadata,
  sha256,
  snapshotFromPlan
} = require('../config/subscription-lifecycle-contract');
const {
  createSubscription,
  resolveSubscriptionContext
} = require('../services/subscription-service');

const ROOT = path.resolve(__dirname, '..');
const SCHEMA_FILE = path.join(ROOT, 'database', 'tienda_abarrotes.sql');
const MIGRATIONS_DIR = path.join(ROOT, 'database', 'migrations');
const MIGRATION = '022_ciclo_vida_suscripciones.sql';
const TEMP_PREFIX = 'tmp_tienda_restore_saas_b1_';

const PRE_022_SUBSCRIPTION_SCHEMA = `
CREATE TABLE IF NOT EXISTS suscripcionTienda (
  idSuscripcion INT AUTO_INCREMENT PRIMARY KEY,
  idTienda INT NOT NULL,
  idPlan INT NOT NULL,
  tipo ENUM('prueba','pagada','cortesia') NOT NULL,
  estado ENUM('pendiente','activa','vencida','suspendida','cancelada') NOT NULL DEFAULT 'pendiente',
  fechaInicio DATETIME NOT NULL,
  fechaFin DATETIME NOT NULL,
  renovacionAutomatica TINYINT(1) NOT NULL DEFAULT 0,
  observacion VARCHAR(500) NULL,
  creadoPor INT NULL,
  creadoEn DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizadoEn DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_suscripcion_tienda_estado_fechas (idTienda, estado, fechaInicio, fechaFin),
  KEY idx_suscripcion_plan (idPlan),
  KEY idx_suscripcion_creadoPor (creadoPor),
  CONSTRAINT fk_suscripcion_tienda FOREIGN KEY (idTienda) REFERENCES tienda(idTienda),
  CONSTRAINT fk_suscripcion_plan FOREIGN KEY (idPlan) REFERENCES plan(idPlan),
  CONSTRAINT fk_suscripcion_creadoPor FOREIGN KEY (creadoPor) REFERENCES administrador(idAdministrador)
);
`;

const PRE_022_SUBSCRIPTION_SEED = `
INSERT INTO suscripcionTienda
  (idTienda,idPlan,tipo,estado,fechaInicio,fechaFin,renovacionAutomatica,observacion,creadoPor)
SELECT t.idTienda,p.idPlan,'cortesia','activa',@fecha_local_instalacion,
       DATE_ADD(@fecha_local_instalacion, INTERVAL 3650 DAY),0,
       'Suscripcion inicial de cortesia para conservar el acceso durante la migracion.',NULL
FROM tienda t
JOIN plan p ON p.codigo='avanzado'
WHERE NOT EXISTS (
  SELECT 1 FROM suscripcionTienda s WHERE s.idTienda=t.idTienda
);
`;

function quoteIdentifier(value) {
  if (!new RegExp(`^${TEMP_PREFIX}[a-z0-9_]+$`).test(value)) {
    throw new Error('Nombre de base temporal invalido.');
  }
  return `\`${value}\``;
}

async function connect(options) {
  return setBusinessSessionTimeZone(await mysql.createConnection(options));
}

function temporaryEnvironment(database = null) {
  const user = String(process.env.BACKUP_RESTORE_USER || '').trim();
  const password = String(process.env.BACKUP_RESTORE_PASSWORD || '');
  if (!user || !password) {
    throw new Error('La prueba de ciclo de vida requiere credenciales temporales locales.');
  }
  return {
    ...process.env,
    APP_ENV: 'local',
    DB_HOST: 'localhost',
    DB_USER: user,
    DB_PASSWORD: password,
    ...(database ? { DB_NAME: database } : {})
  };
}

function temporaryOptions(database = null) {
  return buildDatabaseOptions(temporaryEnvironment(database));
}

function pre022Schema() {
  const source = fs.readFileSync(SCHEMA_FILE, 'utf8');
  const withoutLifecycle = source
    .replace(
      /-- SUBSCRIPTION_LIFECYCLE_SCHEMA_START[\s\S]*?-- SUBSCRIPTION_LIFECYCLE_SCHEMA_END/,
      PRE_022_SUBSCRIPTION_SCHEMA
    )
    .replace(
      /-- SUBSCRIPTION_LIFECYCLE_SEED_START[\s\S]*?-- SUBSCRIPTION_LIFECYCLE_SEED_END/,
      PRE_022_SUBSCRIPTION_SEED
    );
  assert(!withoutLifecycle.includes('CREATE TABLE IF NOT EXISTS historialSuscripcionTienda'));
  assert(!withoutLifecycle.includes('planCodigoSnapshot'));
  return withoutLifecycle;
}

async function executeSql(connection, source) {
  for (const statement of readSqlStatementsFromText(source)) {
    await connection.query(statement);
  }
}

function readSqlStatementsFromText(source) {
  return source
    .split(';')
    .map((part) => part
      .split(/\r?\n/)
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n')
      .trim())
    .filter(Boolean)
    .filter((statement) => !/^USE\s+/i.test(statement))
    .filter((statement) => !/^CREATE\s+DATABASE/i.test(statement))
    .filter((statement) => !/^DROP\s+/i.test(statement));
}

function migrationNamesBefore022() {
  return fs.readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql') && name < MIGRATION)
    .sort();
}

async function registerMigrations(connection) {
  await connection.query(
    `CREATE TABLE schema_migrations (
      nombre VARCHAR(255) PRIMARY KEY,
      aplicadaEn DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB`
  );
  for (const name of migrationNamesBefore022()) {
    await connection.query('INSERT INTO schema_migrations (nombre) VALUES (?)', [name]);
  }
}

async function applyMigration022(connection) {
  const migrationFile = path.join(MIGRATIONS_DIR, MIGRATION);
  for (const statement of readSqlStatements(migrationFile)) {
    await connection.query(statement);
  }
  await connection.query('INSERT INTO schema_migrations (nombre) VALUES (?)', [MIGRATION]);
}

function runLifecycleChecker(database) {
  const result = spawnSync(
    process.execPath,
    [path.join(ROOT, 'scripts', 'check-subscription-lifecycle.js')],
    {
      cwd: ROOT,
      env: temporaryEnvironment(database),
      encoding: 'utf8',
      windowsHide: true,
      timeout: 120000
    }
  );
  if (result.status !== 0) {
    throw new Error(
      `El comprobador de 022 fallo: ${String(
        result.error?.message || result.stderr || result.stdout || 'sin salida'
      ).slice(-1200)}`
    );
  }
  assert(String(result.stdout).includes('SUBSCRIPTION_LIFECYCLE_OK'));
}

async function primaryFingerprint(config) {
  const connection = await connect(config);
  try {
    const [[row]] = await connection.query(
      `SELECT
        (SELECT COUNT(*) FROM schema_migrations) migrations,
        (SELECT MAX(nombre) FROM schema_migrations) lastMigration,
        (SELECT COUNT(*) FROM tienda) stores,
        (SELECT COUNT(*) FROM administrador) administrators,
        (SELECT COUNT(*) FROM suscripcionTienda) subscriptions,
        (SELECT COUNT(*) FROM venta) sales,
        (SELECT COALESCE(SUM(total),0) FROM venta) salesTotal,
        (SELECT COUNT(*) FROM fiado) debts,
        (SELECT COALESCE(SUM(saldoPendiente),0) FROM fiado) debtBalance,
        (SELECT COUNT(*) FROM producto) products,
        (SELECT COALESCE(SUM(stock),0) FROM producto) stock`
    );
    return JSON.stringify(row);
  } finally {
    await connection.end();
  }
}

async function createStore(connection, suffix) {
  const now = '2026-07-29 10:00:00';
  const [result] = await connection.query(
    `INSERT INTO tienda
      (nombre,slug,activo,estado,estadoOnboarding,creadoEn,actualizadoEn)
     VALUES (?, ?, 1, 'activa', 'completado', ?, ?)`,
    [`Tienda B1 ${suffix}`, `tienda-b1-${suffix}`, now, now]
  );
  return Number(result.insertId);
}

async function assertBackfill(connection) {
  const [[counts]] = await connection.query(
    `SELECT
      (SELECT COUNT(*) FROM suscripcionTienda) subscriptions,
      (SELECT COUNT(*) FROM suscripcionTienda
       WHERE tipo='cortesia' AND estado='activa'
         AND fechaFinGracia IS NULL AND suspendidaEn IS NULL
         AND reactivadaEn IS NULL AND canceladaEn IS NULL
      ) preservedCourtesy,
      (SELECT COUNT(*) FROM historialSuscripcionTienda) history,
      (SELECT COUNT(*) FROM operacionSuscripcionTienda) operations`
  );
  assert.strictEqual(Number(counts.subscriptions), Number(counts.preservedCourtesy));
  assert.strictEqual(Number(counts.history), 0, 'La migracion no debe inventar historial.');
  assert.strictEqual(Number(counts.operations), 0, 'La migracion no debe crear operaciones idempotentes.');
  const [[snapshot]] = await connection.query(
    `SELECT s.planCodigoSnapshot,s.planNombreSnapshot,s.tipoPeriodoSnapshot,
            s.duracionDiasSnapshot,s.precioReferenciaSnapshot,
            s.limitePropietariosSnapshot,p.codigo planActual
     FROM suscripcionTienda s JOIN plan p ON p.idPlan=s.idPlan
     ORDER BY s.idSuscripcion LIMIT 1`
  );
  assert.strictEqual(snapshot.planCodigoSnapshot, snapshot.planActual);
  assert.strictEqual(snapshot.tipoPeriodoSnapshot, 'personalizada');
  assert.strictEqual(Number(snapshot.duracionDiasSnapshot), 3650);
}

async function assertFrozenSnapshot(connection) {
  const [[subscription]] = await connection.query(
    'SELECT idTienda FROM suscripcionTienda ORDER BY idSuscripcion LIMIT 1'
  );
  const before = await resolveSubscriptionContext(connection, Number(subscription.idTienda));
  assert(before.caracteristicas.includes('reportes_avanzados'));
  await connection.query(
    `UPDATE plan SET nombre='Plan editado',limitePropietarios=99
     WHERE codigo='avanzado'`
  );
  await connection.query(
    `UPDATE funcionalidad SET activo=0 WHERE codigo='reportes_avanzados'`
  );
  const after = await resolveSubscriptionContext(connection, Number(subscription.idTienda));
  assert.strictEqual(after.plan.nombre, before.plan.nombre);
  assert.strictEqual(after.limites.propietarios, before.limites.propietarios);
  assert(after.caracteristicas.includes('reportes_avanzados'));
}

async function assertNewSubscription(connection) {
  const idTienda = await createStore(connection, crypto.randomBytes(4).toString('hex'));
  await connection.beginTransaction();
  const subscription = await createSubscription(connection, {
    idTienda,
    planCodigo: 'basico',
    tipo: 'prueba',
    duracionDias: 30,
    actorTipo: 'sistema'
  });
  await connection.commit();
  const [[stored]] = await connection.query(
    `SELECT planCodigoSnapshot,tipoPeriodoSnapshot,duracionDiasSnapshot,
            TIMESTAMPDIFF(DAY,fechaFin,fechaFinGracia) graceDays
     FROM suscripcionTienda WHERE idTienda=? AND idSuscripcion=?`,
    [idTienda, subscription.idSuscripcion]
  );
  assert.strictEqual(stored.planCodigoSnapshot, 'basico');
  assert.strictEqual(stored.tipoPeriodoSnapshot, 'mensual');
  assert.strictEqual(Number(stored.duracionDiasSnapshot), 30);
  assert.strictEqual(Number(stored.graceDays), SUBSCRIPTION_GRACE_DAYS);
  const [[history]] = await connection.query(
    `SELECT COUNT(*) total FROM historialSuscripcionTienda
     WHERE idTienda=? AND idSuscripcion=? AND tipoOperacion='inicio_prueba'
       AND actorTipo='sistema'`,
    [idTienda, subscription.idSuscripcion]
  );
  assert.strictEqual(Number(history.total), 1);

  const rollbackStore = await createStore(connection, crypto.randomBytes(4).toString('hex'));
  await connection.beginTransaction();
  try {
    await createSubscription(connection, {
      idTienda: rollbackStore,
      planCodigo: 'basico',
      tipo: 'pagada',
      duracionDias: 30
    });
    throw new Error('ROLLBACK_CONTROLADO');
  } catch (error) {
    await connection.rollback();
    assert.strictEqual(error.message, 'ROLLBACK_CONTROLADO');
  }
  const [[rolledBack]] = await connection.query(
    `SELECT
      (SELECT COUNT(*) FROM suscripcionTienda WHERE idTienda=?) subscriptions,
      (SELECT COUNT(*) FROM historialSuscripcionTienda WHERE idTienda=?) history`,
    [rollbackStore, rollbackStore]
  );
  assert.strictEqual(Number(rolledBack.subscriptions), 0);
  assert.strictEqual(Number(rolledBack.history), 0);
}

async function assertConcurrency(database, connection) {
  const idTienda = await createStore(connection, crypto.randomBytes(4).toString('hex'));
  const second = await connect(temporaryOptions(database));
  try {
    await connection.beginTransaction();
    await second.beginTransaction();
    await createSubscription(connection, {
      idTienda,
      planCodigo: 'basico',
      tipo: 'pagada',
      duracionDias: 30
    });
    const competing = createSubscription(second, {
      idTienda,
      planCodigo: 'basico',
      tipo: 'pagada',
      duracionDias: 30
    });
    await connection.commit();
    await competing;
    await second.commit();
  } catch (error) {
    try { await connection.rollback(); } catch { /* Transaccion ya confirmada. */ }
    try { await second.rollback(); } catch { /* Transaccion ya confirmada. */ }
    throw error;
  } finally {
    await second.end();
  }
  const [[active]] = await connection.query(
    `SELECT COUNT(*) total FROM suscripcionTienda
     WHERE idTienda=? AND estado IN ('pendiente','activa','gracia')`,
    [idTienda]
  );
  assert.strictEqual(Number(active.total), 1, 'La serializacion por tienda debe dejar un solo periodo operativo.');
}

async function assertIdempotencyContract(connection) {
  const firstStore = await createStore(connection, crypto.randomBytes(4).toString('hex'));
  const secondStore = await createStore(connection, crypto.randomBytes(4).toString('hex'));
  const rawKey = `b1-${crypto.randomBytes(12).toString('hex')}`;
  const keyHash = sha256(rawKey);
  const payloadHash = sha256('payload-a');
  const now = '2026-07-29 10:00:00';
  const expires = '2026-08-28 10:00:00';
  await connection.query(
    `INSERT INTO operacionSuscripcionTienda
      (idTienda,tipoOperacion,claveHash,huellaSolicitud,estado,expiraEn,creadoEn,actualizadoEn)
     VALUES (?, 'renovar', ?, ?, 'en_proceso', ?, ?, ?)`,
    [firstStore, keyHash, payloadHash, expires, now, now]
  );
  const [[stored]] = await connection.query(
    `SELECT claveHash,huellaSolicitud FROM operacionSuscripcionTienda
     WHERE idTienda=?`,
    [firstStore]
  );
  assert.strictEqual(stored.claveHash, keyHash);
  assert(!stored.claveHash.includes(rawKey));
  assert.strictEqual(stored.huellaSolicitud, payloadHash);
  await assert.rejects(
    connection.query(
      `INSERT INTO operacionSuscripcionTienda
        (idTienda,tipoOperacion,claveHash,huellaSolicitud,estado,expiraEn,creadoEn,actualizadoEn)
       VALUES (?, 'renovar', ?, ?, 'en_proceso', ?, ?, ?)`,
      [firstStore, keyHash, sha256('payload-b'), expires, now, now]
    ),
    (error) => error.code === 'ER_DUP_ENTRY'
  );
  await connection.query(
    `INSERT INTO operacionSuscripcionTienda
      (idTienda,tipoOperacion,claveHash,huellaSolicitud,estado,expiraEn,creadoEn,actualizadoEn)
     VALUES (?, 'renovar', ?, ?, 'en_proceso', ?, ?, ?)`,
    [secondStore, keyHash, payloadHash, expires, now, now]
  );
  await assert.rejects(
    connection.query(
      `INSERT INTO operacionSuscripcionTienda
        (idTienda,tipoOperacion,claveHash,huellaSolicitud,estado,expiraEn,creadoEn,actualizadoEn)
       VALUES (?, 'cancelar', 'clave-en-claro', ?, 'en_proceso', ?, ?, ?)`,
      [firstStore, payloadHash, expires, now, now]
    ),
    (error) => error.code === 'ER_CHECK_CONSTRAINT_VIOLATED'
  );
}

async function assertTemporalConstraints(connection) {
  const [[subscription]] = await connection.query(
    'SELECT idSuscripcion FROM suscripcionTienda ORDER BY idSuscripcion LIMIT 1'
  );
  await assert.rejects(
    connection.query(
      `UPDATE suscripcionTienda
       SET estado='gracia',fechaFinGracia=NULL WHERE idSuscripcion=?`,
      [subscription.idSuscripcion]
    ),
    (error) => error.code === 'ER_CHECK_CONSTRAINT_VIOLATED'
  );
  await assert.rejects(
    connection.query(
      `UPDATE suscripcionTienda
       SET idPlanSiguiente=idPlan,fechaAplicacionPlanSiguiente=NULL
       WHERE idSuscripcion=?`,
      [subscription.idSuscripcion]
    ),
    (error) => error.code === 'ER_CHECK_CONSTRAINT_VIOLATED'
  );
}

async function main() {
  const primary = requireLocalhostDatabase('La prueba del ciclo de vida de suscripciones');
  if (!/(prueba|test)/i.test(primary.database)) {
    throw new Error('La prueba requiere la base principal local de pruebas.');
  }
  assert.strictEqual(periodTypeForDuration(30), 'mensual');
  assert.strictEqual(periodTypeForDuration(365), 'anual');
  assert.strictEqual(periodTypeForDuration(90), 'personalizada');
  assert.strictEqual(snapshotFromPlan({
    idPlan: 1,
    codigo: 'basico',
    nombre: 'Basico',
    precioMensual: 0,
    limitePropietarios: 1,
    limiteProductos: 500,
    limiteClientes: 500,
    limiteProveedores: 100
  }, 30).tipoPeriodo, 'mensual');
  assert.deepStrictEqual(
    sanitizeLifecycleMetadata('activacion', {
      planCodigo: 'basico',
      tipoSuscripcion: 'pagada',
      tipoPeriodo: 'mensual',
      secreto: 'no-permitido'
    }),
    { planCodigo: 'basico', tipoSuscripcion: 'pagada', tipoPeriodo: 'mensual' }
  );

  const before = await primaryFingerprint(primary);
  const database = `${TEMP_PREFIX}${crypto.randomBytes(6).toString('hex')}`;
  const serverOptions = temporaryOptions();
  delete serverOptions.database;
  let server;
  let connection;
  try {
    server = await connect(serverOptions);
    await server.query(
      `CREATE DATABASE ${quoteIdentifier(database)}
       CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
    connection = await connect(temporaryOptions(database));
    await executeSql(connection, pre022Schema());
    await registerMigrations(connection);
    const [[beforeMigration]] = await connection.query(
      `SELECT
        (SELECT COUNT(*) FROM tienda) stores,
        (SELECT COUNT(*) FROM administrador) administrators,
        (SELECT COUNT(*) FROM suscripcionTienda) subscriptions,
        (SELECT COUNT(*) FROM venta) sales,
        (SELECT COALESCE(SUM(total),0) FROM venta) salesTotal,
        (SELECT COUNT(*) FROM fiado) debts,
        (SELECT COALESCE(SUM(saldoPendiente),0) FROM fiado) debtBalance,
        (SELECT COALESCE(SUM(stock),0) FROM producto) stock`
    );
    await applyMigration022(connection);
    const state = await inspectSubscriptionLifecycle(connection);
    assert.strictEqual(state.migration, 1);
    assert(Object.values(state.tables).every(Boolean));
    assert(state.columns && state.indexes && state.constraints);
    assert.strictEqual(state.missingSnapshots, 0);
    assert.strictEqual(state.invalidSubscriptions, 0);
    assert.strictEqual(state.operationalOverlaps, 0);
    const [[afterMigration]] = await connection.query(
      `SELECT
        (SELECT COUNT(*) FROM tienda) stores,
        (SELECT COUNT(*) FROM administrador) administrators,
        (SELECT COUNT(*) FROM suscripcionTienda) subscriptions,
        (SELECT COUNT(*) FROM venta) sales,
        (SELECT COALESCE(SUM(total),0) FROM venta) salesTotal,
        (SELECT COUNT(*) FROM fiado) debts,
        (SELECT COALESCE(SUM(saldoPendiente),0) FROM fiado) debtBalance,
        (SELECT COALESCE(SUM(stock),0) FROM producto) stock`
    );
    assert.deepStrictEqual(afterMigration, beforeMigration, '022 altero la huella comercial temporal.');
    await assertBackfill(connection);
    await assertFrozenSnapshot(connection);
    await assertNewSubscription(connection);
    await assertConcurrency(database, connection);
    await assertIdempotencyContract(connection);
    await assertTemporalConstraints(connection);
    const finalState = await inspectSubscriptionLifecycle(connection);
    assert.strictEqual(finalState.invalidSubscriptions, 0);
    assert.strictEqual(finalState.invalidHistory, 0);
    assert.strictEqual(finalState.invalidOperations, 0);
    assert.strictEqual(finalState.operationalOverlaps, 0);
    runLifecycleChecker(database);
  } finally {
    await connection?.end();
    if (server) {
      await server.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(database)}`);
      await server.end();
    }
  }
  const after = await primaryFingerprint(primary);
  assert.strictEqual(after, before, 'La base principal cambio durante el ensayo de 022.');
  console.log('SAAS-B1: migracion temporal, snapshot, historial, idempotencia, rollback y tenant verificados.');
}

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exitCode = 1;
});
