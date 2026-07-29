const assert = require('assert');
const crypto = require('crypto');
const mysql = require('mysql2/promise');
const { buildDatabaseOptions, setBusinessSessionTimeZone } = require('../config/database-options');
const { requireLocalhostDatabase } = require('../config/env');
const { createAdministrativeAuditService } = require('../services/administrative-audit-service');
const { createOnboardingService } = require('../services/onboarding-service');
const { normalizeOnboardingPatch } = require('../config/onboarding-contract');

const TEMP_PREFIX = 'tmp_tienda_restore_saas_a4b_';
const NOW = '2026-07-29 12:00:00';

function quoteIdentifier(value) {
  if (!new RegExp(`^${TEMP_PREFIX}[a-z0-9_]+$`).test(value)) throw new Error('Nombre temporal invalido.');
  return `\`${value}\``;
}

async function connect(options) {
  return setBusinessSessionTimeZone(await mysql.createConnection(options));
}

async function temporaryCredentials(database = null) {
  const source = { ...process.env };
  if (!source.BACKUP_RESTORE_USER || !source.BACKUP_RESTORE_PASSWORD) {
    throw new Error('test:onboarding requiere credenciales temporales locales configuradas.');
  }
  return buildDatabaseOptions({
    ...source,
    DB_USER: source.BACKUP_RESTORE_USER,
    DB_PASSWORD: source.BACKUP_RESTORE_PASSWORD,
    ...(database ? { DB_NAME: database } : {})
  });
}

async function primaryFingerprint(options) {
  const connection = await connect(options);
  try {
    const [[row]] = await connection.query(
      `SELECT
        (SELECT MAX(nombre) FROM schema_migrations) AS ultimaMigracion,
        (SELECT COUNT(*) FROM tienda) AS tiendas,
        (SELECT COUNT(*) FROM administrador) AS administradores,
        (SELECT COUNT(*) FROM venta) AS ventas,
        (SELECT COALESCE(SUM(total), 0) FROM venta) AS totalVentas,
        (SELECT COUNT(*) FROM producto) AS productos,
        (SELECT COALESCE(SUM(stock), 0) FROM producto) AS stock`
    );
    return JSON.stringify(row);
  } finally {
    await connection.end();
  }
}

async function createSchema(connection) {
  const statements = [
    `CREATE TABLE tienda (
      idTienda INT AUTO_INCREMENT PRIMARY KEY, nombre VARCHAR(120) NOT NULL, slug VARCHAR(120) NOT NULL UNIQUE,
      activo TINYINT(1) NOT NULL DEFAULT 1, estado ENUM('activa','suspendida','inactiva') NOT NULL DEFAULT 'activa',
      estadoOnboarding ENUM('pendiente','en_progreso','completado') NOT NULL DEFAULT 'pendiente',
      onboardingCompletadoEn DATETIME NULL, creadoEn DATETIME NOT NULL, actualizadoEn DATETIME NOT NULL
    ) ENGINE=InnoDB`,
    `CREATE TABLE administrador (
      idAdministrador INT AUTO_INCREMENT PRIMARY KEY, idTienda INT NULL, usuario VARCHAR(50) NOT NULL UNIQUE,
      password VARCHAR(255) NOT NULL, rol ENUM('superadmin','dueno_tienda') NOT NULL DEFAULT 'dueno_tienda',
      activo TINYINT(1) NOT NULL DEFAULT 1, estadoAcceso ENUM('activo','pendiente_verificacion','suspendido') NOT NULL DEFAULT 'activo',
      correoVerificadoEn DATETIME NULL, versionSesion INT UNSIGNED NOT NULL DEFAULT 1,
      CONSTRAINT fk_a4b_administrador_tienda FOREIGN KEY (idTienda) REFERENCES tienda(idTienda)
    ) ENGINE=InnoDB`,
    `CREATE TABLE configuracionTienda (
      idConfiguracionTienda INT AUTO_INCREMENT PRIMARY KEY, idTienda INT NOT NULL,
      nombreMostrado VARCHAR(120) NOT NULL, moneda CHAR(3) NOT NULL, zonaHoraria VARCHAR(64) NOT NULL,
      telefono VARCHAR(30) NULL, direccion VARCHAR(255) NULL, datoFiscalBasico VARCHAR(120) NULL,
      creadoEn DATETIME NOT NULL, actualizadoEn DATETIME NOT NULL,
      UNIQUE KEY uq_a4b_config_tienda (idTienda),
      CONSTRAINT fk_a4b_config_tienda FOREIGN KEY (idTienda) REFERENCES tienda(idTienda)
    ) ENGINE=InnoDB`,
    `CREATE TABLE eventoAuditoriaAdministrativa (
      idEventoAuditoria BIGINT AUTO_INCREMENT PRIMARY KEY, idTienda INT NULL,
      actorTipo ENUM('administrador','sistema','anonimo') NOT NULL, idAdministradorActor INT NULL,
      categoria VARCHAR(40) NOT NULL, accion VARCHAR(64) NOT NULL,
      resultado ENUM('correcto','rechazado','fallido','limitado') NOT NULL, codigoResultado VARCHAR(80) NOT NULL,
      origen ENUM('web','sistema','script') NOT NULL, entidadTipo VARCHAR(40) NOT NULL,
      referenciaSegura VARCHAR(96) NULL, requestId CHAR(36) NULL, datosAnteriores JSON NULL,
      datosPosteriores JSON NULL, metadatos JSON NULL, creadoEn DATETIME NOT NULL,
      UNIQUE KEY uq_a4b_audit_request_action_result (requestId, accion, resultado)
    ) ENGINE=InnoDB`
  ];
  for (const statement of statements) await connection.query(statement);
  await connection.query(
    `INSERT INTO tienda (nombre,slug,activo,estado,estadoOnboarding,creadoEn,actualizadoEn)
     VALUES ('Tienda uno','a4b-uno',1,'activa','pendiente',?,?),
            ('Tienda dos','a4b-dos',1,'activa','pendiente',?,?)`,
    [NOW, NOW, NOW, NOW]
  );
  await connection.query(
    `INSERT INTO administrador (idTienda,usuario,password,rol,activo,estadoAcceso,correoVerificadoEn)
     VALUES (1,'a4b_uno','hash','dueno_tienda',1,'activo',?),
            (2,'a4b_dos','hash','dueno_tienda',1,'activo',?)`,
    [NOW, NOW]
  );
  await connection.query(
    `INSERT INTO configuracionTienda (idTienda,nombreMostrado,moneda,zonaHoraria,creadoEn,actualizadoEn)
     VALUES (1,'Tienda uno','BOB','America/La_Paz',?,?),
            (2,'Tienda dos','BOB','America/La_Paz',?,?)`,
    [NOW, NOW, NOW, NOW]
  );
}

function databaseFor(connection) {
  connection.release = () => {};
  connection.getConnection = async () => connection;
  return connection;
}

async function main() {
  const primary = requireLocalhostDatabase('La prueba de onboarding');
  if (!/(prueba|test)/i.test(primary.database)) throw new Error('La prueba requiere una base local de pruebas.');
  const before = await primaryFingerprint(primary);
  const marker = crypto.randomBytes(6).toString('hex');
  const database = `${TEMP_PREFIX}${marker}`;
  const serverOptions = await temporaryCredentials();
  delete serverOptions.database;
  let server;
  let first;
  let second;
  try {
    server = await connect(serverOptions);
    await server.query(`CREATE DATABASE ${quoteIdentifier(database)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    first = await connect(await temporaryCredentials(database));
    await createSchema(first);
    second = await connect(await temporaryCredentials(database));
    const auditOne = createAdministrativeAuditService({ database: databaseFor(first), clock: () => NOW });
    const auditTwo = createAdministrativeAuditService({ database: databaseFor(second), clock: () => NOW });
    const serviceOne = createOnboardingService({ database: databaseFor(first), audit: auditOne, clock: () => NOW });
    const serviceTwo = createOnboardingService({ database: databaseFor(second), audit: auditTwo, clock: () => NOW });
    const one = { idTienda: 1, idAdministrador: 1, requestId: '11111111-1111-4111-8111-111111111111' };
    const two = { idTienda: 2, idAdministrador: 2, requestId: '22222222-2222-4222-8222-222222222222' };

    assert.deepStrictEqual(normalizeOnboardingPatch({ nombreMostrado: '  Nueva   tienda  ' }), { nombreMostrado: 'Nueva tienda' });
    assert.throws(() => normalizeOnboardingPatch({ idTienda: 2 }), /no permitido/i);
    const pending = await serviceOne.get(one);
    assert.strictEqual(pending.estado, 'pendiente');
    assert.strictEqual(pending.progreso, 75);
    await assert.rejects(() => serviceOne.get({ ...one, idTienda: 2 }), (error) => error.code === 'ONBOARDING_ACCESS_DENIED');
    await assert.rejects(() => serviceOne.complete(one), (error) => error.code === 'ONBOARDING_PROGRESS_REQUIRED');

    const saved = await serviceOne.save(one, { nombreMostrado: 'Tienda uno configurada', telefono: '70000000' });
    assert.strictEqual(saved.estado, 'en_progreso');
    assert.strictEqual(saved.configuracion.telefono, '70000000');
    const [[secondConfig]] = await first.query('SELECT nombreMostrado,telefono FROM configuracionTienda WHERE idTienda=2');
    assert.deepStrictEqual(secondConfig, { nombreMostrado: 'Tienda dos', telefono: null });
    const completed = await serviceOne.complete({ ...one, requestId: '33333333-3333-4333-8333-333333333333' });
    assert.strictEqual(completed.estado, 'completado');
    assert.strictEqual(completed.completadoEn, NOW);
    const repeated = await serviceOne.complete({ ...one, requestId: '44444444-4444-4444-8444-444444444444' });
    assert.strictEqual(repeated.repetida, true);
    const [[completedAudits]] = await first.query("SELECT COUNT(*) AS total FROM eventoAuditoriaAdministrativa WHERE accion='onboarding_completado'");
    assert.strictEqual(Number(completedAudits.total), 1);

    await serviceTwo.save(two, { direccion: 'Direccion temporal' });
    const concurrent = await Promise.all([
      serviceOne.complete({ ...two, requestId: '55555555-5555-4555-8555-555555555555' }),
      serviceTwo.complete({ ...two, requestId: '66666666-6666-4666-8666-666666666666' })
    ]);
    assert.strictEqual(concurrent.filter((state) => !state.repetida).length, 1);
    const [[concurrentAudits]] = await first.query("SELECT COUNT(*) AS total FROM eventoAuditoriaAdministrativa WHERE accion='onboarding_completado'");
    assert.strictEqual(Number(concurrentAudits.total), 2);
    const [auditRows] = await first.query("SELECT metadatos FROM eventoAuditoriaAdministrativa WHERE accion='onboarding_progreso_guardado'");
    assert(auditRows.every((row) => !JSON.stringify(row.metadatos).includes('Tienda uno configurada')));

    const failingAudit = { recordCritical: async () => { throw new Error('forced audit failure'); }, recordOutcome: async () => ({ recorded: false }) };
    const rollbackService = createOnboardingService({ database: databaseFor(first), audit: failingAudit, clock: () => NOW });
    await first.query("UPDATE tienda SET estadoOnboarding='pendiente', onboardingCompletadoEn=NULL WHERE idTienda=1");
    await assert.rejects(() => rollbackService.save(one, { telefono: '79999999' }), /forced audit failure/);
    const [[rolledBack]] = await first.query('SELECT telefono FROM configuracionTienda WHERE idTienda=1');
    assert.strictEqual(rolledBack.telefono, '70000000');
    console.log('test:onboarding OK');
  } finally {
    if (second) await second.end().catch(() => {});
    if (first) await first.end().catch(() => {});
    if (server) {
      await server.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(database)}`).catch(() => {});
      await server.end().catch(() => {});
    }
  }
  assert.strictEqual(await primaryFingerprint(primary), before, 'La base principal no debe cambiar.');
}

main().catch((error) => {
  console.error(`test:onboarding FAIL: ${error.message}`);
  process.exitCode = 1;
});
