const assert = require('assert');
const crypto = require('crypto');
const path = require('path');
const mysql = require('mysql2/promise');
const { buildDatabaseOptions, setBusinessSessionTimeZone } = require('../config/database-options');
const { requireLocalhostDatabase } = require('../config/env');
const { readSqlStatements } = require('./db-utils');
const { inspectPublicRegistration } = require('./check-public-registration');
const { createPublicRegistrationService } = require('../services/public-registration-service');
const { createAdministrativeAuditService } = require('../services/administrative-audit-service');
const { createEmailVerificationService } = require('../services/email-verification-service');
const { createLocalVerificationMailAdapter } = require('../services/local-verification-mail-adapter');
const { normalizeRegistration, normalizeSlug } = require('../config/public-registration-contract');

const ROOT = path.resolve(__dirname, '..');
const MIGRATION_FILE = path.join(ROOT, 'database', 'migrations', '020_registro_publico_onboarding.sql');
const TEMP_PREFIX = 'tmp_tienda_restore_saas_a1_';

function quoteIdentifier(value) {
  if (!new RegExp(`^${TEMP_PREFIX}[a-z0-9_]+$`).test(value)) throw new Error('Nombre temporal invalido.');
  return `\`${value}\``;
}

async function connect(options) {
  return setBusinessSessionTimeZone(await mysql.createConnection(options));
}

async function temporaryCredentials(name = null) {
  const source = { ...process.env };
  const user = String(source.BACKUP_RESTORE_USER || '').trim();
  const password = String(source.BACKUP_RESTORE_PASSWORD || '');
  if (!user || !password) {
    throw new Error('test:public-registration requiere credenciales temporales locales configuradas.');
  }
  return buildDatabaseOptions({
    ...source,
    DB_USER: user,
    DB_PASSWORD: password,
    ...(name ? { DB_NAME: name } : {})
  });
}

async function createPre020Schema(connection) {
  const statements = [
    `CREATE TABLE tienda (
      idTienda INT AUTO_INCREMENT PRIMARY KEY, nombre VARCHAR(120) NOT NULL,
      slug VARCHAR(120) NOT NULL UNIQUE, activo TINYINT(1) NOT NULL DEFAULT 1,
      estado ENUM('activa','suspendida','inactiva') NOT NULL DEFAULT 'activa',
      creadoEn DATETIME NOT NULL, actualizadoEn DATETIME NOT NULL
    ) ENGINE=InnoDB`,
    `CREATE TABLE administrador (
      idAdministrador INT AUTO_INCREMENT PRIMARY KEY, idTienda INT NULL,
      usuario VARCHAR(50) NOT NULL UNIQUE, password VARCHAR(255) NOT NULL,
      rol ENUM('superadmin','dueno_tienda') NOT NULL DEFAULT 'dueno_tienda',
      activo TINYINT(1) NOT NULL DEFAULT 1, versionSesion INT UNSIGNED NOT NULL DEFAULT 1,
      UNIQUE KEY uq_administrador_tienda_id (idTienda, idAdministrador),
      CONSTRAINT fk_administrador_tienda FOREIGN KEY (idTienda) REFERENCES tienda(idTienda)
    ) ENGINE=InnoDB`,
    `CREATE TABLE plan (
      idPlan INT AUTO_INCREMENT PRIMARY KEY, codigo VARCHAR(50) NOT NULL UNIQUE,
      nombre VARCHAR(100) NOT NULL, descripcion VARCHAR(255) NULL, activo TINYINT(1) NOT NULL,
      precioMensual DECIMAL(10,2) NOT NULL DEFAULT 0, duracionDias INT NOT NULL DEFAULT 30,
      limitePropietarios INT NULL, limiteProductos INT NULL, limiteClientes INT NULL, limiteProveedores INT NULL,
      creadoEn DATETIME NOT NULL, actualizadoEn DATETIME NOT NULL
    ) ENGINE=InnoDB`,
    `CREATE TABLE suscripcionTienda (
      idSuscripcion INT AUTO_INCREMENT PRIMARY KEY, idTienda INT NOT NULL, idPlan INT NOT NULL,
      tipo ENUM('prueba','pagada','cortesia') NOT NULL, estado ENUM('pendiente','activa','vencida','suspendida','cancelada') NOT NULL,
      fechaInicio DATETIME NOT NULL, fechaFin DATETIME NOT NULL, renovacionAutomatica TINYINT(1) NOT NULL DEFAULT 0,
      observacion VARCHAR(500) NULL, creadoPor INT NULL, creadoEn DATETIME NOT NULL, actualizadoEn DATETIME NOT NULL,
      CONSTRAINT fk_test_sub_tienda FOREIGN KEY (idTienda) REFERENCES tienda(idTienda),
      CONSTRAINT fk_test_sub_plan FOREIGN KEY (idPlan) REFERENCES plan(idPlan),
      CONSTRAINT fk_test_sub_admin FOREIGN KEY (creadoPor) REFERENCES administrador(idAdministrador)
    ) ENGINE=InnoDB`,
    `CREATE TABLE eventoAuditoriaAdministrativa (
      idEventoAuditoria BIGINT AUTO_INCREMENT PRIMARY KEY, idTienda INT NULL,
      actorTipo ENUM('administrador','sistema','anonimo') NOT NULL, idAdministradorActor INT NULL,
      categoria VARCHAR(40) NOT NULL, accion VARCHAR(64) NOT NULL,
      resultado ENUM('correcto','rechazado','fallido','limitado') NOT NULL,
      codigoResultado VARCHAR(80) NOT NULL, origen ENUM('web','sistema','script') NOT NULL,
      entidadTipo VARCHAR(40) NOT NULL, referenciaSegura VARCHAR(96) NULL, requestId CHAR(36) NULL,
      datosAnteriores JSON NULL, datosPosteriores JSON NULL, metadatos JSON NULL, creadoEn DATETIME NOT NULL,
      UNIQUE KEY uq_eventoAuditoria_request_accion_resultado (requestId, accion, resultado)
    ) ENGINE=InnoDB`,
    'CREATE TABLE schema_migrations (nombre VARCHAR(255) PRIMARY KEY, aplicadaEn DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)'
  ];
  for (const statement of statements) await connection.query(statement);
  await connection.query(
    `INSERT INTO plan (codigo,nombre,activo,precioMensual,duracionDias,limitePropietarios,creadoEn,actualizadoEn)
     VALUES ('basico','Basico',1,0,30,1,'2026-07-29 10:00:00','2026-07-29 10:00:00')`
  );
}

async function apply020(connection) {
  for (const statement of readSqlStatements(MIGRATION_FILE)) {
    await connection.query(statement);
  }
  await connection.query('INSERT INTO schema_migrations (nombre) VALUES (?)', ['020_registro_publico_onboarding.sql']);
}

function request(marker, overrides = {}) {
  return {
    nombreTienda: `Tienda SaaS ${marker}`,
    slug: `tienda-saas-${marker}`,
    usuario: `saas_${marker}`,
    correo: `saas-${marker}@example.test`,
    password: `Registro-${marker}-seguro!`,
    ...overrides
  };
}

async function main() {
  const primary = requireLocalhostDatabase('La prueba de registro publico');
  if (!/(prueba|test)/i.test(primary.database)) throw new Error('La prueba requiere una base local de pruebas.');
  const marker = crypto.randomBytes(6).toString('hex');
  const database = `${TEMP_PREFIX}${marker}`;
  const serverOptions = await temporaryCredentials();
  delete serverOptions.database;
  let server;
  let connection;
  let concurrentConnection;
  try {
    assert.strictEqual(normalizeSlug(' Tienda Nino & Mas '), 'tienda-nino-mas');
    assert.throws(() => normalizeRegistration({ usuario: 'abc' }), /No se pudo completar/);
    server = await connect(serverOptions);
    await server.query(`CREATE DATABASE ${quoteIdentifier(database)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    connection = await connect(await temporaryCredentials(database));
    connection.release = () => {};
    await createPre020Schema(connection);
    await apply020(connection);
    const structure = await inspectPublicRegistration(connection);
    assert.deepStrictEqual(structure, {
      migrationRegistered: true, administrator: true, store: true, token: true, request: true, indexes: true
    });

    const bootstrapCalls = [];
    const auditService = createAdministrativeAuditService({ database: connection });
    const mailAdapter = createLocalVerificationMailAdapter();
    const verificationService = createEmailVerificationService({
      database: { getConnection: async () => connection },
      auditService,
      mailAdapter,
      clock: () => new Date('2026-07-29T14:00:00Z')
    });
    const noopVerificationService = Object.freeze({
      issueWithinTransaction: async () => Object.freeze({}),
      deliver: async () => true
    });
    const service = createPublicRegistrationService({
      database: { getConnection: async () => connection },
      auditService,
      fingerprintSecret: 'test-only-registration-secret',
      verificationService,
      clock: () => '2026-07-29 10:00:00',
      bootstrap: async (_connection, idTienda) => { bootstrapCalls.push(idTienda); }
    });
    const key = `registro:${marker}:clave`;
    const body = request(marker);
    const result = await service.register({ body, idempotencyKey: key, requestId: '11111111-1111-4111-8111-111111111111' });
    assert.strictEqual(result.estado, 'pendiente_verificacion');
    assert.strictEqual(result.repetida, false);
    assert.strictEqual(bootstrapCalls.length, 1);
    const [[owner]] = await connection.query(
      `SELECT a.idAdministrador,a.correoNormalizado,a.correoVerificadoEn,a.estadoAcceso,a.rol,a.idTienda,
              t.estadoOnboarding,s.tipo,s.estado,s.fechaInicio,s.fechaFin
       FROM administrador a JOIN tienda t ON t.idTienda=a.idTienda
       JOIN suscripcionTienda s ON s.idTienda=t.idTienda
       WHERE a.usuario=?`, [body.usuario]
    );
    assert.strictEqual(owner.correoNormalizado, body.correo);
    assert.strictEqual(owner.correoVerificadoEn, null);
    assert.strictEqual(owner.estadoAcceso, 'pendiente_verificacion');
    assert.strictEqual(owner.rol, 'dueno_tienda');
    assert.strictEqual(owner.estadoOnboarding, 'pendiente');
    assert.strictEqual(owner.tipo, 'prueba');
    assert.strictEqual(owner.estado, 'activa');
    assert.strictEqual(Math.round((new Date(owner.fechaFin) - new Date(owner.fechaInicio)) / 86400000), 30);
    const [[tokenCount]] = await connection.query(
      `SELECT COUNT(*) total FROM tokenAccesoAdministrador
       WHERE idAdministrador=? AND tipo='verificacion_correo'`,
      [owner.idAdministrador]
    );
    assert.strictEqual(Number(tokenCount.total), 1);
    assert(mailAdapter.takeLatestForTests()?.token, 'El adaptador local debe recibir el token en claro.');

    const repeated = await service.register({ body, idempotencyKey: key, requestId: '22222222-2222-4222-8222-222222222222' });
    assert.strictEqual(repeated.repetida, true);
    await assert.rejects(
      service.register({ body: request(marker, { slug: `otro-${marker}` }), idempotencyKey: key, requestId: '33333333-3333-4333-8333-333333333333' }),
      (error) => error.code === 'OPERATION_KEY_CONFLICT'
    );
    await assert.rejects(
      service.register({ body: request(`${marker}b`, { usuario: body.usuario }), idempotencyKey: `registro:${marker}:otro` }),
      (error) => error.code === 'REGISTRATION_UNAVAILABLE'
    );
    await assert.rejects(
      service.register({ body: { ...request(`${marker}c`), idTienda: 99 }, idempotencyKey: `registro:${marker}:prohibido` }),
      (error) => error.code === 'REGISTRATION_INPUT_INVALID'
    );

    concurrentConnection = await connect(await temporaryCredentials(database));
    concurrentConnection.release = () => {};
    let releaseBootstrap;
    let markBootstrapStarted;
    const bootstrapStarted = new Promise((resolve) => { markBootstrapStarted = resolve; });
    const bootstrapRelease = new Promise((resolve) => { releaseBootstrap = resolve; });
    const concurrentBody = request(`${marker}concurrent`);
    const concurrentKey = `registro:${marker}:concurrente`;
    const concurrentService = createPublicRegistrationService({
      database: { getConnection: async () => connection }, fingerprintSecret: 'test-only-registration-secret', auditService,
      verificationService: noopVerificationService,
      bootstrap: async () => { markBootstrapStarted(); await bootstrapRelease; }
    });
    const secondAuditService = createAdministrativeAuditService({ database: concurrentConnection });
    const secondService = createPublicRegistrationService({
      database: { getConnection: async () => concurrentConnection }, fingerprintSecret: 'test-only-registration-secret',
      auditService: secondAuditService, verificationService: noopVerificationService, bootstrap: async () => {}
    });
    const firstConcurrent = concurrentService.register({ body: concurrentBody, idempotencyKey: concurrentKey });
    await bootstrapStarted;
    const secondConcurrent = secondService.register({ body: concurrentBody, idempotencyKey: concurrentKey });
    releaseBootstrap();
    const concurrentResults = await Promise.all([firstConcurrent, secondConcurrent]);
    assert.strictEqual(concurrentResults.filter((item) => item.repetida === false).length, 1);
    assert.strictEqual(concurrentResults.filter((item) => item.repetida === true).length, 1);
    const [[concurrentStores]] = await connection.query('SELECT COUNT(*) total FROM tienda WHERE slug=?', [concurrentBody.slug]);
    assert.strictEqual(Number(concurrentStores.total), 1);

    const failing = createPublicRegistrationService({
      database: { getConnection: async () => connection }, fingerprintSecret: 'test-only-registration-secret',
      auditService, verificationService: noopVerificationService,
      bootstrap: async () => { throw new Error('fallo simulado'); }
    });
    const failedBody = request(`${marker}d`);
    await assert.rejects(
      failing.register({ body: failedBody, idempotencyKey: `registro:${marker}:rollback` }),
      (error) => error.code === 'REGISTRATION_FAILED'
    );
    const [[rollbackCount]] = await connection.query('SELECT COUNT(*) total FROM tienda WHERE slug=?', [failedBody.slug]);
    assert.strictEqual(Number(rollbackCount.total), 0);
    const [[requestCount]] = await connection.query('SELECT COUNT(*) total FROM solicitudRegistroPublico');
    assert.strictEqual(Number(requestCount.total), 2);
    const [events] = await connection.query('SELECT accion,metadatos FROM eventoAuditoriaAdministrativa');
    const serialized = JSON.stringify(events).toLowerCase();
    assert(!serialized.includes(body.password.toLowerCase()) && !serialized.includes(body.correo.toLowerCase()),
      'La auditoria no debe incluir contrasena ni correo.');
    console.log('SAAS-A1: migracion temporal, registro, idempotencia y rollback verificados.');
  } finally {
    await concurrentConnection?.end();
    await connection?.end();
    if (server) {
      await server.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(database)}`);
      await server.end();
    }
  }
}

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exitCode = 1;
});
