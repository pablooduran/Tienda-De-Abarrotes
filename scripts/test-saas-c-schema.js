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
const { inspectSaasC, isValidState } = require('./check-saas-c');
const {
  BASIC_FEATURES,
  PLAN_CATALOG,
  PRO_FEATURES,
  STANDARD_FEATURES
} = require('../config/saas-c-payment-contract');

const ROOT = path.resolve(__dirname, '..');
const SCHEMA_FILE = path.join(ROOT, 'database', 'tienda_abarrotes.sql');
const MIGRATIONS_DIR = path.join(ROOT, 'database', 'migrations');
const MIGRATION = '023_estructura_pagos_suscripcion.sql';
const TEMP_PREFIX = 'tmp_tienda_restore_saas_c1_';

function quoteIdentifier(value) {
  if (!new RegExp(`^${TEMP_PREFIX}[a-f0-9]{12}$`).test(String(value || ''))) {
    throw new Error('Nombre de base temporal SAAS-C1 invalido.');
  }
  return `\`${value}\``;
}

function temporaryEnvironment(database = null) {
  const user = String(process.env.BACKUP_RESTORE_USER || '').trim();
  const password = String(process.env.BACKUP_RESTORE_PASSWORD || '');
  if (!user || !password) {
    throw new Error('test:saas-c-schema requiere credenciales temporales locales.');
  }
  return {
    ...process.env,
    APP_ENV: 'local',
    NODE_ENV: 'test',
    DB_HOST: 'localhost',
    DB_USER: user,
    DB_PASSWORD: password,
    DB_SSL_ENABLED: 'false',
    ...(database ? { DB_NAME: database } : {})
  };
}

function temporaryOptions(database = null) {
  return buildDatabaseOptions(temporaryEnvironment(database));
}

async function connect(options) {
  return setBusinessSessionTimeZone(await mysql.createConnection(options));
}

function statementsFromText(source) {
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

async function executeSql(connection, source) {
  for (const statement of statementsFromText(source)) {
    await connection.query(statement);
  }
}

function schemaBefore023() {
  const source = fs.readFileSync(SCHEMA_FILE, 'utf8');
  const withoutC1 = source.replace(
    /-- SAAS_C_PAYMENT_SCHEMA_START[\s\S]*?-- SAAS_C_PAYMENT_SCHEMA_END/,
    ''
  );
  assert(!withoutC1.includes('CREATE TABLE IF NOT EXISTS solicitudPagoSuscripcion'));
  assert(!withoutC1.includes('visiblePublicamente'));
  return withoutC1;
}

async function registerMigrations(connection, include023) {
  await connection.query(
    `CREATE TABLE schema_migrations (
      nombre VARCHAR(255) PRIMARY KEY,
      aplicadaEn DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB`
  );
  const migrations = fs.readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql') && (include023 || name < MIGRATION))
    .sort();
  for (const migration of migrations) {
    await connection.query('INSERT INTO schema_migrations (nombre) VALUES (?)', [migration]);
  }
}

function runScript(script, database) {
  const result = spawnSync(process.execPath, [path.join(ROOT, script)], {
    cwd: ROOT,
    env: temporaryEnvironment(database),
    encoding: 'utf8',
    windowsHide: true,
    timeout: 180000
  });
  if (result.status !== 0) {
    throw new Error(String(result.error?.message || result.stderr || result.stdout).slice(-2000));
  }
  return String(result.stdout || '');
}

async function applyMigration023(connection) {
  for (const statement of readSqlStatements(path.join(MIGRATIONS_DIR, MIGRATION))) {
    await connection.query(statement);
  }
  await connection.query('INSERT INTO schema_migrations (nombre) VALUES (?)', [MIGRATION]);
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
        (SELECT COUNT(*) FROM plan) plans,
        (SELECT COUNT(*) FROM funcionalidad) features,
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

async function commercialFingerprint(connection) {
  const [[counts]] = await connection.query(
    `SELECT
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
  const [subscriptions] = await connection.query(
    `SELECT idSuscripcion,idTienda,idPlan,tipo,estado,fechaInicio,fechaFin,
            fechaFinGracia,suspendidaEn,reactivadaEn,canceladaEn,
            planCodigoSnapshot,planNombreSnapshot,tipoPeriodoSnapshot,
            duracionDiasSnapshot,precioReferenciaSnapshot,
            limitePropietariosSnapshot,limiteProductosSnapshot,
            limiteClientesSnapshot,limiteProveedoresSnapshot
     FROM suscripcionTienda ORDER BY idSuscripcion`
  );
  return JSON.stringify({ counts, subscriptions });
}

async function assertCatalog(connection) {
  const [plans] = await connection.query(
    `SELECT codigo,nombre,activo,visiblePublicamente,esLegado,ordenComercial,
            precioMensual,limitePropietarios,limiteProductos,limiteClientes,
            limiteProveedores
     FROM plan WHERE codigo IN ('basico','standard','pro','avanzado')`
  );
  const byCode = new Map(plans.map((plan) => [plan.codigo, plan]));
  for (const [code, expected] of Object.entries(PLAN_CATALOG)) {
    const plan = byCode.get(code);
    assert(plan, `Falta el plan ${code}.`);
    assert.strictEqual(plan.nombre, expected.name);
    assert.strictEqual(Number(plan.visiblePublicamente), 1);
    assert.strictEqual(Number(plan.esLegado), 0);
    assert.strictEqual(Number(plan.ordenComercial), expected.order);
    assert.strictEqual(Number(plan.precioMensual), expected.pricesUsd.mensual);
  }
  const legacy = byCode.get('avanzado');
  assert(legacy);
  assert.strictEqual(Number(legacy.activo), 1);
  assert.strictEqual(Number(legacy.visiblePublicamente), 0);
  assert.strictEqual(Number(legacy.esLegado), 1);

  const [features] = await connection.query(
    `SELECT p.codigo,COUNT(*) total FROM plan p
     JOIN planFuncionalidad pf ON pf.idPlan=p.idPlan AND pf.habilitada=1
     JOIN funcionalidad f ON f.idFuncionalidad=pf.idFuncionalidad AND f.activo=1
     WHERE p.codigo IN ('basico','standard','pro') GROUP BY p.codigo`
  );
  const totals = Object.fromEntries(features.map((row) => [row.codigo, Number(row.total)]));
  assert.strictEqual(totals.basico, BASIC_FEATURES.length);
  assert.strictEqual(totals.standard, STANDARD_FEATURES.length);
  assert.strictEqual(totals.pro, PRO_FEATURES.length);

  const [prices] = await connection.query(
    `SELECT p.codigo,pp.periodo,pp.monto,pp.cantidadMeses,pp.monedaBase,
            pp.versionPrecio,pp.activo
     FROM precioPlanPeriodo pp JOIN plan p ON p.idPlan=pp.idPlan
     ORDER BY p.ordenComercial,FIELD(pp.periodo,'mensual','trimestral','anual')`
  );
  assert.strictEqual(prices.length, 9);
  for (const price of prices) {
    const expected = PLAN_CATALOG[price.codigo];
    assert(expected);
    assert.strictEqual(Number(price.monto), expected.pricesUsd[price.periodo]);
    assert.strictEqual(price.monedaBase, 'USD');
    assert.strictEqual(Number(price.versionPrecio), 1);
    assert.strictEqual(Number(price.activo), 1);
  }
  const [[empty]] = await connection.query(
    `SELECT
      (SELECT COUNT(*) FROM tipoCambioSuscripcion) rates,
      (SELECT COUNT(*) FROM solicitudPagoSuscripcion) requests,
      (SELECT COUNT(*) FROM comprobantePagoSuscripcion) receipts,
      (SELECT COUNT(*) FROM revisionPagoSuscripcion) reviews,
      (SELECT COUNT(*) FROM historialSolicitudPagoSuscripcion) history,
      (SELECT COUNT(*) FROM aplicacionPagoSuscripcion) applications,
      (SELECT COUNT(*) FROM operacionPagoSuscripcion) operations`
  );
  assert(Object.values(empty).every((value) => Number(value) === 0));
}

async function insertActors(connection) {
  const [[store]] = await connection.query(
    'SELECT idTienda FROM tienda ORDER BY idTienda LIMIT 1'
  );
  const suffix = crypto.randomBytes(5).toString('hex');
  const [superadmin] = await connection.query(
    `INSERT INTO administrador
      (idTienda,usuario,correoNormalizado,correoVerificadoEn,password,rol,
       activo,estadoAcceso,versionSesion)
     VALUES (NULL,?,NULL,NULL,?,'superadmin',1,'activo',1)`,
    [`saas_c_super_${suffix}`, '$2b$12$estructuraTemporalSinCredencialReal000000000000000000000']
  );
  const [owner] = await connection.query(
    `INSERT INTO administrador
      (idTienda,usuario,correoNormalizado,correoVerificadoEn,password,rol,
       activo,estadoAcceso,versionSesion)
     VALUES (?, ?, NULL, NULL, ?, 'dueno_tienda', 1, 'activo', 1)`,
    [store.idTienda, `saas_c_owner_${suffix}`, '$2b$12$estructuraTemporalSinCredencialReal000000000000000000000']
  );
  return {
    idTienda: Number(store.idTienda),
    idSuperadmin: Number(superadmin.insertId),
    idOwner: Number(owner.insertId)
  };
}

async function assertFinancialConstraints(connection) {
  const actor = await insertActors(connection);
  const now = '2026-08-01 10:00:00';
  const [rateResult] = await connection.query(
    `INSERT INTO tipoCambioSuscripcion
      (monedaOrigen,monedaDestino,valor,direccion,fuente,fechaEfectiva,
       vigenteDesde,vigenteHasta,versionTipoCambio,activo,registradoPor)
     VALUES ('USD','BOB',7.00000000,'destino_por_unidad_origen',?, ?, ?, NULL,1,1,?)`,
    ['Prueba local controlada', now, now, actor.idSuperadmin]
  );
  await assert.rejects(
    connection.query(
      `INSERT INTO tipoCambioSuscripcion
        (monedaOrigen,monedaDestino,valor,direccion,fuente,fechaEfectiva,
         vigenteDesde,vigenteHasta,versionTipoCambio,activo,registradoPor)
       VALUES ('USD','BOB',7.10000000,'destino_por_unidad_origen',?, ?, ?, NULL,2,1,?)`,
      ['Prueba local controlada', now, now, actor.idSuperadmin]
    ),
    (error) => error.code === 'ER_DUP_ENTRY'
  );
  const [[subscription]] = await connection.query(
    'SELECT idSuscripcion,idPlan FROM suscripcionTienda WHERE idTienda=? LIMIT 1',
    [actor.idTienda]
  );
  const [[price]] = await connection.query(
    `SELECT pp.*,p.codigo,p.nombre,p.limitePropietarios,p.limiteProductos,
            p.limiteClientes,p.limiteProveedores
     FROM precioPlanPeriodo pp JOIN plan p ON p.idPlan=pp.idPlan
     WHERE p.codigo='basico' AND pp.periodo='mensual' AND pp.activo=1`
  );
  const [[method]] = await connection.query(
    `SELECT * FROM metodoPagoSuscripcion WHERE codigo='efectivo_administrativo'`
  );
  const reference = crypto.randomBytes(32).toString('base64url');
  const [requestResult] = await connection.query(
    `INSERT INTO solicitudPagoSuscripcion
      (referenciaPublica,idTienda,idSuscripcion,idPlanActual,idPlanObjetivo,
       idPrecioPlanPeriodo,idTipoCambioSuscripcion,idMetodoPagoSuscripcion,
       operacion,periodo,cantidadMeses,planCodigoSnapshot,planNombreSnapshot,
       versionPrecioSnapshot,precioBaseUSD,tipoCambioUsdBob,
       fuenteTipoCambioSnapshot,fechaEfectivaTipoCambioSnapshot,
       montoCalculadoBOB,montoFinalBOB,monedaBase,monedaCobro,
       limitePropietariosSnapshot,limiteProductosSnapshot,limiteClientesSnapshot,
       limiteProveedoresSnapshot,metodoCodigoSnapshot,metodoNombreSnapshot,
       instruccionesMetodoSnapshot,estado,creadaPor,creadaEn,venceEn,
       enviadaEn,aplicadaEn,canceladaEn,ultimaTransicionEn,actualizadoEn)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'renovacion','mensual',1,?, ?,1,3.00,
       7.00000000,?, ?,21.00,21.00,'USD','BOB',?,?,?,?,?,?,NULL,
       'pendiente_revision',?,?,DATE_ADD(?,INTERVAL 72 HOUR),?,NULL,NULL,?,?)`,
    [
      reference, actor.idTienda, subscription.idSuscripcion, subscription.idPlan,
      price.idPlan, price.idPrecioPlanPeriodo, rateResult.insertId,
      method.idMetodoPagoSuscripcion, price.codigo, price.nombre,
      'Prueba local controlada', now, price.limitePropietarios,
      price.limiteProductos, price.limiteClientes, price.limiteProveedores,
      method.codigo, method.nombre, actor.idOwner, now, now, now, now, now
    ]
  );
  const idRequest = Number(requestResult.insertId);
  await assert.rejects(
    connection.query(
      `INSERT INTO solicitudPagoSuscripcion
        (referenciaPublica,idTienda,idSuscripcion,idPlanActual,idPlanObjetivo,
         idPrecioPlanPeriodo,idTipoCambioSuscripcion,idMetodoPagoSuscripcion,
         operacion,periodo,cantidadMeses,planCodigoSnapshot,planNombreSnapshot,
         versionPrecioSnapshot,precioBaseUSD,tipoCambioUsdBob,
         fuenteTipoCambioSnapshot,fechaEfectivaTipoCambioSnapshot,
         montoCalculadoBOB,montoFinalBOB,monedaBase,monedaCobro,
         metodoCodigoSnapshot,metodoNombreSnapshot,estado,creadaPor,creadaEn,
         venceEn,ultimaTransicionEn,actualizadoEn)
       SELECT ?,idTienda,idSuscripcion,idPlanActual,idPlanObjetivo,
         idPrecioPlanPeriodo,idTipoCambioSuscripcion,idMetodoPagoSuscripcion,
         operacion,periodo,cantidadMeses,planCodigoSnapshot,planNombreSnapshot,
         versionPrecioSnapshot,precioBaseUSD,tipoCambioUsdBob,
         fuenteTipoCambioSnapshot,fechaEfectivaTipoCambioSnapshot,
         montoCalculadoBOB,montoFinalBOB,monedaBase,monedaCobro,
         metodoCodigoSnapshot,metodoNombreSnapshot,estado,creadaPor,creadaEn,
         venceEn,ultimaTransicionEn,actualizadoEn
       FROM solicitudPagoSuscripcion WHERE idSolicitudPago=?`,
      [crypto.randomBytes(32).toString('base64url'), idRequest]
    ),
    (error) => error.code === 'ER_DUP_ENTRY'
  );

  const receiptReference = crypto.randomBytes(32).toString('base64url');
  const hash = crypto.createHash('sha256').update('comprobante temporal').digest('hex');
  const [receipt] = await connection.query(
    `INSERT INTO comprobantePagoSuscripcion
      (referenciaPublica,idTienda,idSolicitudPago,versionComprobante,estado,
       nombreGenerado,nombreOriginalSanitizado,extensionDetectada,mimeDetectado,
       tamanoBytes,hashSha256,claveAlmacenamiento,cargadoPor,cargadoEn,
       reemplazadoEn,creadoEn,actualizadoEn)
     VALUES (?, ?, ?,1,'cargado',?,'comprobante.pdf','pdf','application/pdf',
       128,?,?,?, ?,NULL,?,?)`,
    [receiptReference, actor.idTienda, idRequest, `c_${crypto.randomBytes(16).toString('hex')}.pdf`,
      hash, `pagos/${crypto.randomBytes(20).toString('hex')}`, actor.idOwner, now, now, now]
  );
  await assert.rejects(
    connection.query(
      `INSERT INTO comprobantePagoSuscripcion
        (referenciaPublica,idTienda,idSolicitudPago,versionComprobante,estado,
         nombreGenerado,nombreOriginalSanitizado,extensionDetectada,mimeDetectado,
         tamanoBytes,hashSha256,claveAlmacenamiento,cargadoPor,cargadoEn,
         reemplazadoEn,creadoEn,actualizadoEn)
       VALUES (?, ?, ?,2,'cargado',?,'otro.pdf','pdf','application/pdf',
         128,?,?,?, ?,NULL,?,?)`,
      [crypto.randomBytes(32).toString('base64url'), actor.idTienda, idRequest,
        `c_${crypto.randomBytes(16).toString('hex')}.pdf`, hash,
        `pagos/${crypto.randomBytes(20).toString('hex')}`, actor.idOwner, now, now, now]
    ),
    (error) => error.code === 'ER_DUP_ENTRY'
  );
  await connection.query(
    `UPDATE comprobantePagoSuscripcion
     SET estado='reemplazado',reemplazadoEn=?,actualizadoEn=?
     WHERE idComprobantePago=?`,
    [now, now, receipt.insertId]
  );

  const key = `c1-${crypto.randomBytes(16).toString('hex')}`;
  const keyHash = crypto.createHash('sha256').update(key).digest('hex');
  const payloadHash = crypto.createHash('sha256').update('payload-canonico').digest('hex');
  await connection.query(
    `INSERT INTO operacionPagoSuscripcion
      (idTienda,idSolicitudPago,actorTipo,idAdministradorActor,alcance,
       claveHash,huellaPayload,estado,creadaEn,completadaEn,fallidaEn,
       expiraEn,actualizadaEn)
     VALUES (?,?,'propietario',?,'cargar_comprobante',?,?,'en_proceso',
       ?,NULL,NULL,DATE_ADD(?,INTERVAL 24 HOUR),?)`,
    [actor.idTienda, idRequest, actor.idOwner, keyHash, payloadHash, now, now, now]
  );
  const [[storedOperation]] = await connection.query(
    'SELECT claveHash,huellaPayload FROM operacionPagoSuscripcion LIMIT 1'
  );
  assert.strictEqual(storedOperation.claveHash, keyHash);
  assert(!storedOperation.claveHash.includes(key));
  assert.strictEqual(storedOperation.huellaPayload, payloadHash);
  await assert.rejects(
    connection.query(
      `INSERT INTO operacionPagoSuscripcion
        (idTienda,idSolicitudPago,actorTipo,idAdministradorActor,alcance,
         claveHash,huellaPayload,estado,creadaEn,expiraEn,actualizadaEn)
       VALUES (?,?,'propietario',?,'cargar_comprobante','clave-en-claro',?,
         'en_proceso',?,DATE_ADD(?,INTERVAL 24 HOUR),?)`,
      [actor.idTienda, idRequest, actor.idOwner, payloadHash, now, now, now]
    ),
    (error) => error.code === 'ER_CHECK_CONSTRAINT_VIOLATED'
  );
}

async function runUpgradeScenario(server, database) {
  let connection;
  try {
    await server.query(
      `CREATE DATABASE ${quoteIdentifier(database)}
       CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
    connection = await connect(temporaryOptions(database));
    await executeSql(connection, schemaBefore023());
    await registerMigrations(connection, false);
    const before = await commercialFingerprint(connection);
    const [[legacyBefore]] = await connection.query(
      `SELECT idPlan,codigo,nombre,activo,precioMensual,duracionDias,
              limitePropietarios,limiteProductos,limiteClientes,limiteProveedores
       FROM plan WHERE codigo='avanzado'`
    );
    await applyMigration023(connection);
    const after = await commercialFingerprint(connection);
    assert.strictEqual(after, before, '023 altero la huella comercial temporal.');
    const [[legacyAfter]] = await connection.query(
      `SELECT idPlan,codigo,nombre,activo,precioMensual,duracionDias,
              limitePropietarios,limiteProductos,limiteClientes,limiteProveedores
       FROM plan WHERE codigo='avanzado'`
    );
    assert.deepStrictEqual(legacyAfter, legacyBefore, 'El plan avanzado legado fue reescrito.');
    const state = await inspectSaasC(connection);
    assert(isValidState(state), JSON.stringify(state));
    await assertCatalog(connection);
    await assertFinancialConstraints(connection);
    assert(runScript('scripts/check-saas-c.js', database).includes('SAAS_C_SCHEMA_OK'));
    const [firstStatement] = readSqlStatements(path.join(MIGRATIONS_DIR, MIGRATION));
    await assert.rejects(
      connection.query(firstStatement),
      (error) => [
        'ER_DUP_FIELDNAME',
        'ER_DUP_KEYNAME',
        'ER_CHECK_CONSTRAINT_DUP_NAME'
      ].includes(error.code)
    );
  } finally {
    await connection?.end();
    await server.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(database)}`);
  }
}

async function runCleanScenario(server, database) {
  let connection;
  try {
    await server.query(
      `CREATE DATABASE ${quoteIdentifier(database)}
       CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
    connection = await connect(temporaryOptions(database));
    await executeSql(connection, fs.readFileSync(SCHEMA_FILE, 'utf8'));
    await registerMigrations(connection, true);
    const state = await inspectSaasC(connection);
    assert(isValidState(state), JSON.stringify(state));
    await assertCatalog(connection);
    assert(runScript('scripts/check-saas-c.js', database).includes('SAAS_C_SCHEMA_OK'));
  } finally {
    await connection?.end();
    await server.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(database)}`);
  }
}

async function main() {
  const primary = requireLocalhostDatabase('La prueba estructural de SAAS-C1');
  if (!/(prueba|test)/i.test(primary.database)) {
    throw new Error('test:saas-c-schema requiere la base principal local de pruebas.');
  }
  const before = await primaryFingerprint(primary);
  const serverOptions = temporaryOptions();
  delete serverOptions.database;
  const server = await connect(serverOptions);
  const upgradeDatabase = `${TEMP_PREFIX}${crypto.randomBytes(6).toString('hex')}`;
  const cleanDatabase = `${TEMP_PREFIX}${crypto.randomBytes(6).toString('hex')}`;
  try {
    await runUpgradeScenario(server, upgradeDatabase);
    await runCleanScenario(server, cleanDatabase);
  } finally {
    await server.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(upgradeDatabase)}`);
    await server.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(cleanDatabase)}`);
    await server.end();
  }
  const after = await primaryFingerprint(primary);
  assert.strictEqual(after, before, 'La base principal cambio durante el ensayo temporal de 023.');
  console.log('SAAS-C1: 001-023, 022-023, catalogo, precios, tenant, hashes y limpieza verificados.');
}

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exitCode = 1;
});
