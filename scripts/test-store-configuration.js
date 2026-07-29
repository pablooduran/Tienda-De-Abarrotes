const assert = require('assert');
const crypto = require('crypto');
const path = require('path');
const mysql = require('mysql2/promise');
const { buildDatabaseOptions, setBusinessSessionTimeZone } = require('../config/database-options');
const { requireLocalhostDatabase } = require('../config/env');
const { readSqlStatements } = require('./db-utils');
const { inspectStoreConfiguration } = require('./check-store-configuration');
const { ensureBaseConfiguration } = require('../services/store-bootstrap-service');

const ROOT = path.resolve(__dirname, '..');
const MIGRATION_FILE = path.join(
  ROOT,
  'database',
  'migrations',
  '021_configuracion_base_tienda.sql'
);
const MIGRATION = '021_configuracion_base_tienda.sql';
const TEMP_PREFIX = 'tmp_tienda_restore_saas_a4a_';
const FIXED_NOW = '2026-07-29 10:00:00';

function quoteIdentifier(value) {
  if (!new RegExp(`^${TEMP_PREFIX}[a-z0-9_]+$`).test(value)) {
    throw new Error('Nombre temporal invalido.');
  }
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
    throw new Error('test:store-configuration requiere credenciales temporales locales configuradas.');
  }
  return buildDatabaseOptions({
    ...source,
    DB_USER: user,
    DB_PASSWORD: password,
    ...(name ? { DB_NAME: name } : {})
  });
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

async function createPre021Schema(connection) {
  await connection.query(
    `CREATE TABLE tienda (
      idTienda INT AUTO_INCREMENT PRIMARY KEY,
      nombre VARCHAR(120) NOT NULL,
      slug VARCHAR(120) NOT NULL UNIQUE,
      activo TINYINT(1) NOT NULL DEFAULT 1,
      estado ENUM('activa','suspendida','inactiva') NOT NULL DEFAULT 'activa',
      estadoOnboarding ENUM('pendiente','en_progreso','completado')
        NOT NULL DEFAULT 'completado',
      onboardingCompletadoEn DATETIME NULL,
      creadoEn DATETIME NOT NULL,
      actualizadoEn DATETIME NOT NULL
    ) ENGINE=InnoDB`
  );
  await connection.query(
    `CREATE TABLE schema_migrations (
      nombre VARCHAR(255) PRIMARY KEY,
      aplicadaEn DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB`
  );
  await connection.query(
    `INSERT INTO tienda
      (nombre,slug,activo,estado,estadoOnboarding,creadoEn,actualizadoEn)
     VALUES
      ('Tienda temporal uno','a4a-uno',1,'activa','completado',?,?),
      ('Tienda temporal dos','a4a-dos',1,'activa','pendiente',?,?)`,
    [FIXED_NOW, FIXED_NOW, FIXED_NOW, FIXED_NOW]
  );
  await connection.query(
    'INSERT INTO schema_migrations (nombre) VALUES (?)',
    ['020_registro_publico_onboarding.sql']
  );
}

async function applyMigration(connection) {
  for (const rawStatement of readSqlStatements(MIGRATION_FILE)) {
    const statement = rawStatement.replace(
      /__MIGRATION_LOCAL_DATETIME__/g,
      `'${FIXED_NOW}'`
    );
    await connection.query(statement);
  }
  await connection.query('INSERT INTO schema_migrations (nombre) VALUES (?)', [MIGRATION]);
}

async function main() {
  const primary = requireLocalhostDatabase('La prueba de configuracion base de tienda');
  if (!/(prueba|test)/i.test(primary.database)) {
    throw new Error('La prueba requiere una base local de pruebas.');
  }
  const before = await primaryFingerprint(primary);
  const marker = crypto.randomBytes(6).toString('hex');
  const database = `${TEMP_PREFIX}${marker}`;
  const serverOptions = await temporaryCredentials();
  delete serverOptions.database;
  let server;
  let connection;
  try {
    server = await connect(serverOptions);
    await server.query(
      `CREATE DATABASE ${quoteIdentifier(database)}
       CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
    connection = await connect(await temporaryCredentials(database));
    await createPre021Schema(connection);
    await applyMigration(connection);

    const state = await inspectStoreConfiguration(connection);
    assert.deepStrictEqual(state, {
      migrationRegistered: true,
      table: true,
      columns: true,
      indexes: true,
      constraints: true,
      stores: 2,
      configurations: 2,
      missing: 0,
      duplicates: 0,
      invalid: 0
    });
    const [backfill] = await connection.query(
      `SELECT t.nombre,c.nombreMostrado,c.moneda,c.zonaHoraria,c.telefono,
              c.direccion,c.datoFiscalBasico
       FROM tienda t JOIN configuracionTienda c ON c.idTienda=t.idTienda
       ORDER BY t.idTienda`
    );
    assert(backfill.every((row) => row.nombreMostrado === row.nombre
      && row.moneda === 'BOB'
      && row.zonaHoraria === 'America/La_Paz'
      && row.telefono === null
      && row.direccion === null
      && row.datoFiscalBasico === null));

    const [storeResult] = await connection.query(
      `INSERT INTO tienda
        (nombre,slug,activo,estado,estadoOnboarding,creadoEn,actualizadoEn)
       VALUES ('Tienda temporal nueva','a4a-nueva',1,'activa','pendiente',?,?)`,
      [FIXED_NOW, FIXED_NOW]
    );
    const newStoreId = Number(storeResult.insertId);
    await ensureBaseConfiguration(connection, newStoreId, FIXED_NOW);
    const [[created]] = await connection.query(
      `SELECT nombreMostrado,moneda,zonaHoraria
       FROM configuracionTienda WHERE idTienda=?`,
      [newStoreId]
    );
    assert.deepStrictEqual(created, {
      nombreMostrado: 'Tienda temporal nueva',
      moneda: 'BOB',
      zonaHoraria: 'America/La_Paz'
    });
    await assert.rejects(
      connection.query(
        `INSERT INTO configuracionTienda
          (idTienda,nombreMostrado,creadoEn,actualizadoEn)
         VALUES (?,?,?,?)`,
        [newStoreId, 'Duplicada', FIXED_NOW, FIXED_NOW]
      ),
      (error) => error.code === 'ER_DUP_ENTRY'
    );
    await assert.rejects(
      connection.query(
        `INSERT INTO configuracionTienda
          (idTienda,nombreMostrado,creadoEn,actualizadoEn)
         VALUES (999999,'Huerfana',?,?)`,
        [FIXED_NOW, FIXED_NOW]
      ),
      (error) => error.code === 'ER_NO_REFERENCED_ROW_2'
    );

    await connection.beginTransaction();
    try {
      const [rollbackStore] = await connection.query(
        `INSERT INTO tienda
          (nombre,slug,activo,estado,estadoOnboarding,creadoEn,actualizadoEn)
         VALUES ('Tienda rollback','a4a-rollback',1,'activa','pendiente',?,?)`,
        [FIXED_NOW, FIXED_NOW]
      );
      const failingConnection = {
        query: async (sql, params) => {
          if (String(sql).includes('INSERT INTO configuracionTienda')) {
            throw new Error('Fallo controlado de configuracion.');
          }
          return connection.query(sql, params);
        }
      };
      await ensureBaseConfiguration(
        failingConnection,
        Number(rollbackStore.insertId),
        FIXED_NOW
      );
      assert.fail('La configuracion simulada debio fallar.');
    } catch (error) {
      assert.match(error.message, /Fallo controlado/);
      await connection.rollback();
    }
    const [[rolledBack]] = await connection.query(
      "SELECT COUNT(*) total FROM tienda WHERE slug='a4a-rollback'"
    );
    assert.strictEqual(Number(rolledBack.total), 0);

    const [isolated] = await connection.query(
      `SELECT c.idTienda,c.nombreMostrado
       FROM configuracionTienda c WHERE c.idTienda IN (?,?)
       ORDER BY c.idTienda`,
      [1, 2]
    );
    assert.strictEqual(isolated.length, 2);
    assert.notStrictEqual(isolated[0].idTienda, isolated[1].idTienda);
    assert.notStrictEqual(isolated[0].nombreMostrado, isolated[1].nombreMostrado);
  } finally {
    await connection?.end();
    if (server) {
      await server.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(database)}`);
      await server.end();
    }
  }
  const after = await primaryFingerprint(primary);
  assert.strictEqual(after, before, 'La base principal cambio durante el ensayo temporal.');
  console.log('SAAS-A4A: estructura, backfill, bootstrap, rollback y tenant verificados.');
}

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exitCode = 1;
});
