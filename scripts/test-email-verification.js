const assert = require('assert');
const crypto = require('crypto');
const path = require('path');
const mysql = require('mysql2/promise');
const { buildDatabaseOptions, setBusinessSessionTimeZone } = require('../config/database-options');
const { requireLocalhostDatabase } = require('../config/env');
const { readSqlStatements } = require('./db-utils');
const { createAdministrativeAuditService } = require('../services/administrative-audit-service');
const { createEmailVerificationService } = require('../services/email-verification-service');
const { createLocalVerificationMailAdapter } = require('../services/local-verification-mail-adapter');
const { createPublicRegistrationService } = require('../services/public-registration-service');
const {
  VERIFICATION_TOKEN,
  createVerificationToken,
  verificationTokenHash,
  verificationTokenTtlHours
} = require('../config/email-verification-contract');

const ROOT = path.resolve(__dirname, '..');
const MIGRATION_FILES = Object.freeze([
  path.join(ROOT, 'database', 'migrations', '020_registro_publico_onboarding.sql'),
  path.join(ROOT, 'database', 'migrations', '022_ciclo_vida_suscripciones.sql')
]);
const TEMP_PREFIX = 'tmp_tienda_restore_saas_a2_';

function quoteIdentifier(value) {
  if (!new RegExp(`^${TEMP_PREFIX}[a-z0-9_]+$`).test(value)) throw new Error('Nombre temporal invalido.');
  return `\`${value}\``;
}

async function credentials(name = null) {
  const source = { ...process.env };
  const user = String(source.BACKUP_RESTORE_USER || '').trim();
  const password = String(source.BACKUP_RESTORE_PASSWORD || '');
  if (!user || !password) throw new Error('test:email-verification requiere credenciales temporales locales configuradas.');
  return buildDatabaseOptions({ ...source, DB_USER: user, DB_PASSWORD: password, ...(name ? { DB_NAME: name } : {}) });
}

async function createSchema(connection) {
  const statements = [
    `CREATE TABLE tienda (
      idTienda INT AUTO_INCREMENT PRIMARY KEY, nombre VARCHAR(120) NOT NULL, slug VARCHAR(120) NOT NULL UNIQUE,
      activo TINYINT(1) NOT NULL DEFAULT 1, estado ENUM('activa','suspendida','inactiva') NOT NULL DEFAULT 'activa',
      creadoEn DATETIME NOT NULL, actualizadoEn DATETIME NOT NULL
    ) ENGINE=InnoDB`,
    `CREATE TABLE administrador (
      idAdministrador INT AUTO_INCREMENT PRIMARY KEY, idTienda INT NULL, usuario VARCHAR(50) NOT NULL UNIQUE,
      password VARCHAR(255) NOT NULL, rol ENUM('superadmin','dueno_tienda') NOT NULL DEFAULT 'dueno_tienda',
      activo TINYINT(1) NOT NULL DEFAULT 1, versionSesion INT UNSIGNED NOT NULL DEFAULT 1,
      CONSTRAINT fk_a2_administrador_tienda FOREIGN KEY (idTienda) REFERENCES tienda(idTienda)
    ) ENGINE=InnoDB`,
    `CREATE TABLE plan (
      idPlan INT AUTO_INCREMENT PRIMARY KEY, codigo VARCHAR(50) NOT NULL UNIQUE, nombre VARCHAR(100) NOT NULL,
      descripcion VARCHAR(255) NULL, activo TINYINT(1) NOT NULL, precioMensual DECIMAL(10,2) NOT NULL DEFAULT 0,
      duracionDias INT NOT NULL DEFAULT 30, limitePropietarios INT NULL, limiteProductos INT NULL,
      limiteClientes INT NULL, limiteProveedores INT NULL, creadoEn DATETIME NOT NULL, actualizadoEn DATETIME NOT NULL
    ) ENGINE=InnoDB`,
    `CREATE TABLE funcionalidad (
      idFuncionalidad INT AUTO_INCREMENT PRIMARY KEY,
      codigo VARCHAR(80) NOT NULL UNIQUE,
      nombre VARCHAR(120) NOT NULL,
      descripcion VARCHAR(255) NULL,
      activo TINYINT(1) NOT NULL DEFAULT 1,
      creadoEn DATETIME NOT NULL,
      actualizadoEn DATETIME NOT NULL
    ) ENGINE=InnoDB`,
    `CREATE TABLE planFuncionalidad (
      idPlan INT NOT NULL,
      idFuncionalidad INT NOT NULL,
      habilitada TINYINT(1) NOT NULL DEFAULT 1,
      creadoEn DATETIME NOT NULL,
      PRIMARY KEY (idPlan,idFuncionalidad),
      CONSTRAINT fk_a2_plan_func_plan FOREIGN KEY (idPlan) REFERENCES plan(idPlan),
      CONSTRAINT fk_a2_plan_func_feature FOREIGN KEY (idFuncionalidad)
        REFERENCES funcionalidad(idFuncionalidad)
    ) ENGINE=InnoDB`,
    `CREATE TABLE suscripcionTienda (
      idSuscripcion INT AUTO_INCREMENT PRIMARY KEY, idTienda INT NOT NULL, idPlan INT NOT NULL,
      tipo ENUM('prueba','pagada','cortesia') NOT NULL, estado ENUM('pendiente','activa','vencida','suspendida','cancelada') NOT NULL,
      fechaInicio DATETIME NOT NULL, fechaFin DATETIME NOT NULL, renovacionAutomatica TINYINT(1) NOT NULL DEFAULT 0,
      observacion VARCHAR(500) NULL, creadoPor INT NULL, creadoEn DATETIME NOT NULL, actualizadoEn DATETIME NOT NULL,
      CONSTRAINT fk_a2_suscripcion_tienda FOREIGN KEY (idTienda) REFERENCES tienda(idTienda),
      CONSTRAINT fk_a2_suscripcion_plan FOREIGN KEY (idPlan) REFERENCES plan(idPlan),
      CONSTRAINT fk_a2_suscripcion_admin FOREIGN KEY (creadoPor) REFERENCES administrador(idAdministrador)
    ) ENGINE=InnoDB`,
    `CREATE TABLE eventoAuditoriaAdministrativa (
      idEventoAuditoria BIGINT AUTO_INCREMENT PRIMARY KEY, idTienda INT NULL,
      actorTipo ENUM('administrador','sistema','anonimo') NOT NULL, idAdministradorActor INT NULL,
      categoria VARCHAR(40) NOT NULL, accion VARCHAR(64) NOT NULL, resultado ENUM('correcto','rechazado','fallido','limitado') NOT NULL,
      codigoResultado VARCHAR(80) NOT NULL, origen ENUM('web','sistema','script') NOT NULL,
      entidadTipo VARCHAR(40) NOT NULL, referenciaSegura VARCHAR(96) NULL, requestId CHAR(36) NULL,
      datosAnteriores JSON NULL, datosPosteriores JSON NULL, metadatos JSON NULL, creadoEn DATETIME NOT NULL,
      UNIQUE KEY uq_a2_audit_request_action_result (requestId, accion, resultado)
    ) ENGINE=InnoDB`,
    'CREATE TABLE schema_migrations (nombre VARCHAR(255) PRIMARY KEY, aplicadaEn DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)'
  ];
  for (const statement of statements) await connection.query(statement);
  await connection.query(
    `INSERT INTO plan (codigo,nombre,activo,precioMensual,duracionDias,limitePropietarios,creadoEn,actualizadoEn)
     VALUES ('basico','Basico',1,0,30,1,'2026-07-29 10:00:00','2026-07-29 10:00:00')`
  );
  for (const migrationFile of MIGRATION_FILES) {
    for (const statement of readSqlStatements(migrationFile)) await connection.query(statement);
  }
  await connection.query(
    'INSERT INTO schema_migrations (nombre) VALUES (?),(?)',
    ['020_registro_publico_onboarding.sql', '022_ciclo_vida_suscripciones.sql']
  );
}

function registration(marker, suffix = '') {
  return {
    nombreTienda: `Tienda verificacion ${marker}${suffix}`,
    slug: `tienda-verificacion-${marker}${suffix}`,
    usuario: `verificacion_${marker}${suffix}`,
    correo: `verificacion-${marker}${suffix}@example.test`,
    password: `Verificacion-${marker}${suffix}-segura!`
  };
}

async function main() {
  const primary = requireLocalhostDatabase('La prueba de verificacion de correo');
  if (!/(prueba|test)/i.test(primary.database)) throw new Error('La prueba requiere una base local de pruebas.');
  assert.strictEqual(verificationTokenTtlHours({}), 24);
  assert.throws(() => verificationTokenTtlHours({ EMAIL_VERIFICATION_TOKEN_TTL_HOURS: '0' }));
  const entropyA = createVerificationToken();
  const entropyB = createVerificationToken();
  assert(VERIFICATION_TOKEN.test(entropyA) && entropyA !== entropyB, 'El token no tiene el formato o entropia esperados.');
  const marker = crypto.randomBytes(6).toString('hex');
  const database = `${TEMP_PREFIX}${marker}`;
  const serverOptions = await credentials();
  delete serverOptions.database;
  let server;
  let pool;
  try {
    server = await mysql.createConnection(serverOptions);
    await server.query(`CREATE DATABASE ${quoteIdentifier(database)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    pool = mysql.createPool({ ...(await credentials(database)), connectionLimit: 4 });
    const setup = await setBusinessSessionTimeZone(await pool.getConnection());
    try { await createSchema(setup); } finally { setup.release(); }

    const audit = createAdministrativeAuditService({ database: pool, clock: () => '2026-07-29 10:00:00' });
    const mail = createLocalVerificationMailAdapter();
    const verification = createEmailVerificationService({
      database: pool, auditService: audit, mailAdapter: mail,
      clock: () => new Date('2026-07-29T14:00:00Z')
    });
    const registrationService = createPublicRegistrationService({
      database: pool, auditService: audit, verificationService: verification,
      fingerprintSecret: 'saas-a2-test-secret', bootstrap: async () => {}
    });
    const first = registration(marker);
    const registered = await registrationService.register({
      body: first, idempotencyKey: `registro-a2-${marker}-clave-segura`, requestId: '11111111-1111-4111-8111-111111111111'
    });
    assert.strictEqual(registered.estado, 'pendiente_verificacion');
    const message = mail.takeLatestForTests();
    assert(message?.token && message.recipient === first.correo, 'El adaptador local no recibio el mensaje esperado.');
    const connection = await setBusinessSessionTimeZone(await pool.getConnection());
    try {
      const [[before]] = await connection.query(
        `SELECT a.idAdministrador,a.correoVerificadoEn,a.estadoAcceso,t.estado,t.estadoOnboarding,
                s.tipo,s.fechaInicio,s.fechaFin,ta.tokenHash,ta.usadoEn
         FROM administrador a JOIN tienda t ON t.idTienda=a.idTienda
         JOIN suscripcionTienda s ON s.idTienda=t.idTienda
         JOIN tokenAccesoAdministrador ta ON ta.idAdministrador=a.idAdministrador
         WHERE a.usuario=?`, [first.usuario]
      );
      assert.strictEqual(before.estadoAcceso, 'pendiente_verificacion');
      assert.strictEqual(before.correoVerificadoEn, null);
      assert.strictEqual(before.estadoOnboarding, 'pendiente');
      assert.strictEqual(before.tipo, 'prueba');
      assert.notStrictEqual(before.tokenHash, message.token, 'El token no puede quedar en claro en la base.');
      assert.strictEqual(before.tokenHash, verificationTokenHash(message.token));
      const subscriptionSnapshot = `${before.fechaInicio}|${before.fechaFin}|${before.tipo}`;

      const confirmed = await verification.confirm({ token: message.token, requestId: '22222222-2222-4222-8222-222222222222' });
      assert(/Correo verificado/.test(confirmed.message));
      const [[after]] = await connection.query(
        `SELECT a.correoVerificadoEn,a.estadoAcceso,t.estado,t.estadoOnboarding,
                s.tipo,s.fechaInicio,s.fechaFin,ta.usadoEn
         FROM administrador a JOIN tienda t ON t.idTienda=a.idTienda
         JOIN suscripcionTienda s ON s.idTienda=t.idTienda
         JOIN tokenAccesoAdministrador ta ON ta.idAdministrador=a.idAdministrador
         WHERE a.usuario=?`, [first.usuario]
      );
      assert(after.correoVerificadoEn && after.usadoEn, 'La confirmacion no activo ni marco el token.');
      assert.strictEqual(after.estadoAcceso, 'activo');
      assert.strictEqual(after.estado, 'activa');
      assert.strictEqual(after.estadoOnboarding, 'pendiente');
      assert.strictEqual(`${after.fechaInicio}|${after.fechaFin}|${after.tipo}`, subscriptionSnapshot);
      await assert.rejects(
        verification.confirm({ token: message.token, requestId: '33333333-3333-4333-8333-333333333333' }),
        (error) => error.code === 'EMAIL_VERIFICATION_INVALID'
      );

      const second = registration(marker, 'resend');
      await registrationService.register({
        body: second, idempotencyKey: `registro-a2-${marker}-reenvio`, requestId: '44444444-4444-4444-8444-444444444444'
      });
      const original = mail.takeLatestForTests().token;
      const neutralMissing = await verification.resend({ email: 'ausente@example.test', requestId: '55555555-5555-4555-8555-555555555555' });
      const neutralPending = await verification.resend({ email: second.correo, requestId: '66666666-6666-4666-8666-666666666666' });
      assert.deepStrictEqual(neutralMissing, neutralPending, 'El reenvio no debe enumerar cuentas.');
      const replacement = mail.takeLatestForTests().token;
      assert.notStrictEqual(original, replacement);
      await assert.rejects(
        verification.confirm({ token: original, requestId: '77777777-7777-4777-8777-777777777777' }),
        (error) => error.code === 'EMAIL_VERIFICATION_INVALID'
      );
      await verification.confirm({ token: replacement, requestId: '88888888-8888-4888-8888-888888888888' });

      const third = registration(marker, 'expired');
      await registrationService.register({
        body: third, idempotencyKey: `registro-a2-${marker}-expira`, requestId: '99999999-9999-4999-8999-999999999999' });
      const expiredToken = mail.takeLatestForTests().token;
      const expiredVerifier = createEmailVerificationService({
        database: pool, auditService: audit, mailAdapter: mail,
        clock: () => new Date('2026-07-31T14:00:00Z')
      });
      await assert.rejects(
        expiredVerifier.confirm({ token: expiredToken, requestId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }),
        (error) => error.code === 'EMAIL_VERIFICATION_INVALID'
      );

      const concurrent = registration(marker, 'concurrent');
      await registrationService.register({
        body: concurrent, idempotencyKey: `registro-a2-${marker}-concurrent`, requestId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
      });
      const concurrentToken = mail.takeLatestForTests().token;
      const confirmations = await Promise.allSettled([
        verification.confirm({ token: concurrentToken, requestId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' }),
        verification.confirm({ token: concurrentToken, requestId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' })
      ]);
      assert.strictEqual(confirmations.filter((item) => item.status === 'fulfilled').length, 1,
        'Dos confirmaciones concurrentes no pueden activar el mismo token dos veces.');

      const deliveryFailure = registration(marker, 'delivery');
      const failingMail = Object.freeze({ sendVerification: async () => { throw new Error('Fallo simulado de adaptador.'); } });
      const deliveryVerifier = createEmailVerificationService({
        database: pool, auditService: audit, mailAdapter: failingMail,
        clock: () => new Date('2026-07-29T14:00:00Z')
      });
      const deliveryRegistration = createPublicRegistrationService({
        database: pool, auditService: audit, verificationService: deliveryVerifier,
        fingerprintSecret: 'saas-a2-test-secret', bootstrap: async () => {}
      });
      const deliveryResult = await deliveryRegistration.register({
        body: deliveryFailure, idempotencyKey: `registro-a2-${marker}-delivery`, requestId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
      });
      assert.strictEqual(deliveryResult.estado, 'pendiente_verificacion');
      const [[deliveryPending]] = await connection.query(
        `SELECT a.estadoAcceso, COUNT(ta.idTokenAcceso) totalTokens
         FROM administrador a LEFT JOIN tokenAccesoAdministrador ta ON ta.idAdministrador=a.idAdministrador
         WHERE a.usuario=? GROUP BY a.estadoAcceso`, [deliveryFailure.usuario]
      );
      assert.strictEqual(deliveryPending.estadoAcceso, 'pendiente_verificacion');
      assert.strictEqual(Number(deliveryPending.totalTokens), 1);
      const [events] = await connection.query('SELECT accion,metadatos FROM eventoAuditoriaAdministrativa');
      const auditText = JSON.stringify(events).toLowerCase();
      assert(!auditText.includes(first.correo) && !auditText.includes(message.token.toLowerCase()),
        'La auditoria no debe contener correo ni token.');
    } finally {
      connection.release();
    }
    console.log('SAAS-A2: tokens hasheados, reenvio neutro, confirmacion y limpieza temporal verificados.');
  } finally {
    await pool?.end();
    if (server) {
      await server.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(database)}`);
      await server.end();
    }
  }
}

main().catch((error) => {
  console.error(`Error: ${String(error.message || error).replace(/token|password|correo|hash/gi, '[REDACTED]')}`);
  process.exitCode = 1;
});
