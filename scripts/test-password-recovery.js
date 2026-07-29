const assert = require('assert');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const path = require('path');
const mysql = require('mysql2/promise');
const { buildDatabaseOptions, setBusinessSessionTimeZone } = require('../config/database-options');
const { requireLocalhostDatabase } = require('../config/env');
const { readSqlStatements } = require('./db-utils');
const { createAdministrativeAuditService } = require('../services/administrative-audit-service');
const { createPasswordRecoveryService } = require('../services/password-recovery-service');
const { createLocalVerificationMailAdapter } = require('../services/local-verification-mail-adapter');
const { createEmailVerificationToken, EMAIL_VERIFICATION_TYPE } = (() => {
  const contract = require('../config/email-verification-contract');
  return { createEmailVerificationToken: contract.createVerificationToken, EMAIL_VERIFICATION_TYPE: contract.EMAIL_VERIFICATION_TYPE };
})();
const {
  PASSWORD_RECOVERY_TTL_MINUTES,
  PASSWORD_RECOVERY_TYPE,
  passwordRecoveryTtlMinutes,
  sha256
} = require('../config/password-recovery-contract');
const { validateSession } = require('../services/session-validation-service');

const ROOT = path.resolve(__dirname, '..');
const MIGRATION_FILE = path.join(ROOT, 'database', 'migrations', '020_registro_publico_onboarding.sql');
const TEMP_PREFIX = 'tmp_tienda_restore_saas_a3_';

function quoteIdentifier(value) {
  if (!new RegExp(`^${TEMP_PREFIX}[a-z0-9_]+$`).test(value)) throw new Error('Nombre temporal invalido.');
  return `\`${value}\``;
}

async function credentials(name = null) {
  const source = { ...process.env };
  const user = String(source.BACKUP_RESTORE_USER || '').trim();
  const password = String(source.BACKUP_RESTORE_PASSWORD || '');
  if (!user || !password) throw new Error('test:password-recovery requiere credenciales temporales locales configuradas.');
  return buildDatabaseOptions({ ...source, DB_USER: user, DB_PASSWORD: password, ...(name ? { DB_NAME: name } : {}) });
}

async function createSchema(connection) {
  const statements = [
    `CREATE TABLE tienda (idTienda INT AUTO_INCREMENT PRIMARY KEY, nombre VARCHAR(120) NOT NULL,
      slug VARCHAR(120) NOT NULL UNIQUE, activo TINYINT(1) NOT NULL DEFAULT 1,
      estado ENUM('activa','suspendida','inactiva') NOT NULL DEFAULT 'activa', creadoEn DATETIME NOT NULL,
      actualizadoEn DATETIME NOT NULL) ENGINE=InnoDB`,
    `CREATE TABLE administrador (idAdministrador INT AUTO_INCREMENT PRIMARY KEY, idTienda INT NULL,
      usuario VARCHAR(50) NOT NULL UNIQUE, password VARCHAR(255) NOT NULL,
      rol ENUM('superadmin','dueno_tienda') NOT NULL DEFAULT 'dueno_tienda', activo TINYINT(1) NOT NULL DEFAULT 1,
      versionSesion INT UNSIGNED NOT NULL DEFAULT 1,
      CONSTRAINT fk_a3_admin_tienda FOREIGN KEY (idTienda) REFERENCES tienda(idTienda)) ENGINE=InnoDB`,
    `CREATE TABLE plan (idPlan INT AUTO_INCREMENT PRIMARY KEY, codigo VARCHAR(50) NOT NULL UNIQUE,
      nombre VARCHAR(100) NOT NULL, activo TINYINT(1) NOT NULL, precioMensual DECIMAL(10,2) NOT NULL DEFAULT 0,
      duracionDias INT NOT NULL DEFAULT 30, creadoEn DATETIME NOT NULL, actualizadoEn DATETIME NOT NULL) ENGINE=InnoDB`,
    `CREATE TABLE suscripcionTienda (idSuscripcion INT AUTO_INCREMENT PRIMARY KEY, idTienda INT NOT NULL,
      idPlan INT NOT NULL, tipo ENUM('prueba','pagada','cortesia') NOT NULL,
      estado ENUM('pendiente','activa','vencida','suspendida','cancelada') NOT NULL,
      fechaInicio DATETIME NOT NULL, fechaFin DATETIME NOT NULL, renovacionAutomatica TINYINT(1) NOT NULL DEFAULT 0,
      observacion VARCHAR(500) NULL, creadoEn DATETIME NOT NULL, actualizadoEn DATETIME NOT NULL,
      CONSTRAINT fk_a3_sub_tienda FOREIGN KEY (idTienda) REFERENCES tienda(idTienda),
      CONSTRAINT fk_a3_sub_plan FOREIGN KEY (idPlan) REFERENCES plan(idPlan)) ENGINE=InnoDB`,
    `CREATE TABLE eventoAuditoriaAdministrativa (idEventoAuditoria BIGINT AUTO_INCREMENT PRIMARY KEY,
      idTienda INT NULL, actorTipo ENUM('administrador','sistema','anonimo') NOT NULL,
      idAdministradorActor INT NULL, categoria VARCHAR(40) NOT NULL, accion VARCHAR(64) NOT NULL,
      resultado ENUM('correcto','rechazado','fallido','limitado') NOT NULL, codigoResultado VARCHAR(80) NOT NULL,
      origen ENUM('web','sistema','script') NOT NULL, entidadTipo VARCHAR(40) NOT NULL,
      referenciaSegura VARCHAR(96) NULL, requestId CHAR(36) NULL, datosAnteriores JSON NULL,
      datosPosteriores JSON NULL, metadatos JSON NULL, creadoEn DATETIME NOT NULL,
      UNIQUE KEY uq_a3_audit_request_action_result (requestId, accion, resultado)) ENGINE=InnoDB`
  ];
  for (const statement of statements) await connection.query(statement);
  await connection.query('INSERT INTO plan (codigo,nombre,activo,precioMensual,duracionDias,creadoEn,actualizadoEn) VALUES (?,?,?,?,?, ?, ?)',
    ['basico', 'Basico', 1, 0, 30, '2026-07-29 10:00:00', '2026-07-29 10:00:00']);
  for (const statement of readSqlStatements(MIGRATION_FILE)) await connection.query(statement);
}

async function createOwner(connection, marker, { email = true, active = true, state = 'activo' } = {}) {
  const storeName = `Tienda recuperacion ${marker}`;
  await connection.query(
    `INSERT INTO tienda (nombre,slug,activo,estado,creadoEn,actualizadoEn) VALUES (?,?,?, 'activa', ?, ?)`,
    [storeName, `recuperacion-${marker}`, active ? 1 : 0, '2026-07-29 10:00:00', '2026-07-29 10:00:00']
  );
  const [[store]] = await connection.query('SELECT LAST_INSERT_ID() idTienda');
  const password = `Inicial-${marker}-segura!`;
  await connection.query(
    `INSERT INTO administrador (idTienda,usuario,correoNormalizado,correoVerificadoEn,password,rol,activo,estadoAcceso)
     VALUES (?,?,?,?,?,'dueno_tienda',?,?)`,
    [store.idTienda, `recuperacion_${marker}`, email ? `recuperacion-${marker}@example.test` : null,
      state === 'activo' ? '2026-07-29 09:00:00' : null, await bcrypt.hash(password, 4), active ? 1 : 0, state]
  );
  const [[owner]] = await connection.query('SELECT LAST_INSERT_ID() idAdministrador');
  return { idTienda: Number(store.idTienda), idAdministrador: Number(owner.idAdministrador), password };
}

async function main() {
  const primary = requireLocalhostDatabase('La prueba de recuperacion de password');
  if (!/(prueba|test)/i.test(primary.database)) throw new Error('La prueba requiere una base local de pruebas.');
  assert.strictEqual(passwordRecoveryTtlMinutes({}), PASSWORD_RECOVERY_TTL_MINUTES);
  assert.throws(() => passwordRecoveryTtlMinutes({ PASSWORD_RECOVERY_TOKEN_TTL_MINUTES: '2' }));
  const marker = crypto.randomBytes(6).toString('hex');
  const database = `${TEMP_PREFIX}${marker}`;
  const serverOptions = await credentials();
  delete serverOptions.database;
  let server;
  let pool;
  const mail = createLocalVerificationMailAdapter();
  try {
    server = await mysql.createConnection(serverOptions);
    await server.query(`CREATE DATABASE ${quoteIdentifier(database)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    pool = mysql.createPool({ ...(await credentials(database)), connectionLimit: 4 });
    const setup = await setBusinessSessionTimeZone(await pool.getConnection());
    try { await createSchema(setup); } finally { setup.release(); }
    const audit = createAdministrativeAuditService({ database: pool, clock: () => '2026-07-29 10:00:00' });
    const recovery = createPasswordRecoveryService({
      database: pool, auditService: audit, mailAdapter: mail,
      clock: () => new Date('2026-07-29T14:00:00Z')
    });
    const connection = await setBusinessSessionTimeZone(await pool.getConnection());
    try {
      const owner = await createOwner(connection, `${marker}_active`);
      const missing = await recovery.request({ body: { correo: 'ausente@example.test' }, requestId: '11111111-1111-4111-8111-111111111111' });
      const existing = await recovery.request({ body: { correo: `RECUPERACION-${marker}_ACTIVE@example.test` }, requestId: '22222222-2222-4222-8222-222222222222' });
      assert.deepStrictEqual(missing, existing, 'La solicitud debe ser neutra para cuentas existentes e inexistentes.');
      const firstToken = mail.takeLatestRecoveryForTests().token;
      const [[tokenRow]] = await connection.query(
        `SELECT tokenHash,expiraEn,usadoEn,invalidadoEn FROM tokenAccesoAdministrador WHERE idAdministrador=? AND tipo=?`,
        [owner.idAdministrador, PASSWORD_RECOVERY_TYPE]
      );
      assert.strictEqual(tokenRow.tokenHash, sha256(firstToken));
      assert.strictEqual(tokenRow.usadoEn, null);
      assert.strictEqual(tokenRow.invalidadoEn, null);
      const [[versionBefore]] = await connection.query('SELECT versionSesion,password,estadoAcceso,activo FROM administrador WHERE idAdministrador=?', [owner.idAdministrador]);
      const sessionBefore = await validateSession({ id: owner.idAdministrador, rol: 'dueno_tienda', idTienda: owner.idTienda, versionSesion: Number(versionBefore.versionSesion) }, pool);
      assert(sessionBefore.valid, 'La sesion fixture debe ser valida antes del cambio.');
      const reset = await recovery.reset({
        body: { token: firstToken, nuevaPassword: 'Nueva-clave-segura-2026!', confirmacionPassword: 'Nueva-clave-segura-2026!' },
        requestId: '33333333-3333-4333-8333-333333333333'
      });
      assert(/Contrasena actualizada/.test(reset.message));
      const [[versionAfter]] = await connection.query('SELECT versionSesion,password,estadoAcceso,activo FROM administrador WHERE idAdministrador=?', [owner.idAdministrador]);
      assert.strictEqual(Number(versionAfter.versionSesion), Number(versionBefore.versionSesion) + 1);
      assert.strictEqual(versionAfter.estadoAcceso, 'activo');
      assert.strictEqual(Number(versionAfter.activo), 1);
      assert(await bcrypt.compare('Nueva-clave-segura-2026!', versionAfter.password));
      assert(!(await bcrypt.compare(owner.password, versionAfter.password)));
      const sessionAfter = await validateSession({ id: owner.idAdministrador, rol: 'dueno_tienda', idTienda: owner.idTienda, versionSesion: Number(versionBefore.versionSesion) }, pool);
      assert.strictEqual(sessionAfter.valid, false);
      await assert.rejects(recovery.reset({
        body: { token: firstToken, nuevaPassword: 'Otra-clave-segura-2026!', confirmacionPassword: 'Otra-clave-segura-2026!' },
        requestId: '44444444-4444-4444-8444-444444444444'
      }), (error) => error.code === 'PASSWORD_RECOVERY_INVALID');

      const pending = await createOwner(connection, `${marker}_pending`, { state: 'pendiente_verificacion' });
      await recovery.request({ body: { correo: `recuperacion-${marker}_pending@example.test` }, requestId: '55555555-5555-4555-8555-555555555555' });
      const pendingToken = mail.takeLatestRecoveryForTests().token;
      await recovery.reset({ body: { token: pendingToken, nuevaPassword: 'Pendiente-clave-2026!', confirmacionPassword: 'Pendiente-clave-2026!' }, requestId: '66666666-6666-4666-8666-666666666666' });
      const [[pendingAfter]] = await connection.query('SELECT estadoAcceso,correoVerificadoEn FROM administrador WHERE idAdministrador=?', [pending.idAdministrador]);
      assert.strictEqual(pendingAfter.estadoAcceso, 'pendiente_verificacion');
      assert.strictEqual(pendingAfter.correoVerificadoEn, null);

      const suspended = await createOwner(connection, `${marker}_suspended`, { active: false, state: 'activo' });
      await recovery.request({ body: { correo: `recuperacion-${marker}_suspended@example.test` }, requestId: '77777777-7777-4777-8777-777777777777' });
      const suspendedToken = mail.takeLatestRecoveryForTests().token;
      await recovery.reset({ body: { token: suspendedToken, nuevaPassword: 'Suspendida-clave-2026!', confirmacionPassword: 'Suspendida-clave-2026!' }, requestId: '88888888-8888-4888-8888-888888888888' });
      const [[suspendedAfter]] = await connection.query('SELECT activo,estadoAcceso FROM administrador WHERE idAdministrador=?', [suspended.idAdministrador]);
      assert.strictEqual(Number(suspendedAfter.activo), 0);

      const verificationToken = createEmailVerificationToken();
      await connection.query(
        `INSERT INTO tokenAccesoAdministrador (idAdministrador,tipo,tokenHash,expiraEn,creadoEn)
         VALUES (?,?,?,?,?)`,
        [owner.idAdministrador, EMAIL_VERIFICATION_TYPE, sha256(verificationToken), '2026-07-30 10:00:00', '2026-07-29 10:00:00']
      );
      const secondRecovery = await recovery.request({ body: { correo: `recuperacion-${marker}_active@example.test` }, requestId: '99999999-9999-4999-8999-999999999999' });
      assert(secondRecovery.message);
      const [[verificationStillActive]] = await connection.query(
        `SELECT invalidadoEn FROM tokenAccesoAdministrador WHERE idAdministrador=? AND tipo=?`,
        [owner.idAdministrador, EMAIL_VERIFICATION_TYPE]
      );
      assert.strictEqual(verificationStillActive.invalidadoEn, null);

      const concurrentOwner = await createOwner(connection, `${marker}_concurrent`);
      await recovery.request({ body: { correo: `recuperacion-${marker}_concurrent@example.test` }, requestId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' });
      const concurrentToken = mail.takeLatestRecoveryForTests().token;
      const concurrentResults = await Promise.allSettled([
        recovery.reset({ body: { token: concurrentToken, nuevaPassword: 'Concurrente-clave-2026!', confirmacionPassword: 'Concurrente-clave-2026!' }, requestId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }),
        recovery.reset({ body: { token: concurrentToken, nuevaPassword: 'Concurrente-clave-2026!', confirmacionPassword: 'Concurrente-clave-2026!' }, requestId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' })
      ]);
      assert.strictEqual(concurrentResults.filter((result) => result.status === 'fulfilled').length, 1);
      const [[concurrentVersion]] = await connection.query('SELECT versionSesion FROM administrador WHERE idAdministrador=?', [concurrentOwner.idAdministrador]);
      assert.strictEqual(Number(concurrentVersion.versionSesion), 2);

      const noEmail = await createOwner(connection, `${marker}_noemail`, { email: false });
      const noEmailResponse = await recovery.request({ body: { correo: 'sin-correo@example.test' }, requestId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' });
      assert.deepStrictEqual(noEmailResponse, missing);
      const [[events]] = await connection.query('SELECT COUNT(*) total FROM eventoAuditoriaAdministrativa');
      assert(Number(events.total) > 0 && noEmail.idAdministrador > 0);
      const [auditRows] = await connection.query('SELECT metadatos,datosAnteriores,datosPosteriores FROM eventoAuditoriaAdministrativa');
      const auditText = JSON.stringify(auditRows).toLowerCase();
      assert(!auditText.includes(firstToken.toLowerCase()) && !auditText.includes('nueva-clave-segura-2026'));
      assert(!auditText.includes(`recuperacion-${marker}`));
      mail.clearForTests();
      assert.strictEqual(mail.takeLatestRecoveryForTests(), null);
    } finally {
      connection.release();
    }
    console.log('SAAS-A3: solicitud neutra, tokens hash-only, restablecimiento, revocacion y limpieza temporal verificados.');
  } finally {
    mail.clearForTests();
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
