const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const mysql = require('mysql2/promise');
const {
  buildDatabaseOptions,
  isProductionEnvironment,
  setBusinessSessionTimeZone
} = require('../config/database-options');
const {
  COMPENSATION_REASONS,
  COMPENSATION_STATES,
  COMPENSATION_TYPES,
  OPERATION_KEY_PATTERN,
  REQUEST_FINGERPRINT_PATTERN,
  SALE_OPERATION_STATES,
  TERMINAL_COMPENSATION_STATES
} = require('../config/compensation-contract');
const {
  MIGRATION,
  inspectCompensationFoundation
} = require('./check-compensations');

const TEMP_PREFIX = 'tmp_tienda_restore_';
const PROTECTED_DATABASES = new Set([
  'tienda_abarrotes',
  'tienda_abarrotes_pruebas',
  'mysql',
  'information_schema',
  'performance_schema',
  'sys'
]);
const ROOT = path.join(__dirname, '..');
const SCHEMA_FILE = path.join(ROOT, 'database', 'tienda_abarrotes.sql');
const MIGRATION_FILE = path.join(ROOT, 'database', 'migrations', MIGRATION);

function check(condition, message) {
  if (!condition) throw new Error(message);
  console.log(`OK: ${message}`);
}

function assertTemporaryDatabase(name) {
  const normalized = String(name || '').toLocaleLowerCase('en-US');
  if (!new RegExp(`^${TEMP_PREFIX}[a-f0-9]{12}$`).test(normalized)
    || PROTECTED_DATABASES.has(normalized)) {
    throw new Error(`Base temporal rechazada por la guarda de C1: ${name || '(vacia)'}.`);
  }
  return normalized;
}

function quoteTemporaryDatabase(name) {
  return `\`${assertTemporaryDatabase(name)}\``;
}

function temporaryDatabaseName() {
  return `${TEMP_PREFIX}${crypto.randomBytes(6).toString('hex')}`;
}

function assertSafeRuntime() {
  const environment = String(process.env.APP_ENV || '').trim().toLocaleLowerCase('en-US');
  const host = String(process.env.DB_HOST || '').trim().toLocaleLowerCase('en-US');
  if (!['local', 'test'].includes(environment) || isProductionEnvironment(process.env)) {
    throw new Error('test:compensation-foundation solo se permite con APP_ENV=local o APP_ENV=test.');
  }
  if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
    throw new Error('test:compensation-foundation solo se permite contra MySQL local.');
  }
  const primaryDatabase = String(process.env.DB_NAME || '').trim().toLocaleLowerCase('en-US');
  if (!primaryDatabase || primaryDatabase.startsWith(TEMP_PREFIX)) {
    throw new Error('DB_NAME debe identificar la base local principal, nunca una base temporal de C1.');
  }
  return primaryDatabase;
}

async function createServerConnection() {
  const options = buildDatabaseOptions(process.env);
  delete options.database;
  return setBusinessSessionTimeZone(await mysql.createConnection(options));
}

function temporaryDatabaseEnvironment(name = null) {
  const user = String(process.env.BACKUP_RESTORE_USER || '').trim();
  const password = String(process.env.BACKUP_RESTORE_PASSWORD || '');
  if (!user || !password) {
    throw new Error(
      'Configure BACKUP_RESTORE_USER y BACKUP_RESTORE_PASSWORD con permisos limitados '
      + 'a tmp_tienda_restore_%.* para ejecutar test:compensation-foundation.'
    );
  }
  return {
    ...process.env,
    DB_USER: user,
    DB_PASSWORD: password,
    ...(name ? { DB_NAME: assertTemporaryDatabase(name) } : {})
  };
}

async function createTemporaryServerConnection() {
  const options = buildDatabaseOptions(temporaryDatabaseEnvironment());
  delete options.database;
  return setBusinessSessionTimeZone(await mysql.createConnection(options));
}

async function connectDatabase(name) {
  const options = buildDatabaseOptions({
    ...temporaryDatabaseEnvironment(name)
  });
  return setBusinessSessionTimeZone(await mysql.createConnection(options));
}

async function connectPrimaryDatabase(name) {
  const options = buildDatabaseOptions({
    ...process.env,
    DB_NAME: name
  });
  return setBusinessSessionTimeZone(await mysql.createConnection(options));
}

async function createTemporaryDatabase(server, name) {
  await server.query(
    `CREATE DATABASE ${quoteTemporaryDatabase(name)}
     CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
  );
}

async function dropTemporaryDatabase(server, name) {
  await server.query(`DROP DATABASE IF EXISTS ${quoteTemporaryDatabase(name)}`);
}

function readSqlStatementsFromText(sql) {
  return sql
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

async function executeSqlText(connection, sql) {
  const statements = readSqlStatementsFromText(sql);
  for (const statement of statements) {
    await connection.query(statement);
  }
}

async function executeCompensationMigration(connection) {
  const localDateTime = '2026-07-24 10:00:00';
  const statements = readSqlStatementsFromText(fs.readFileSync(MIGRATION_FILE, 'utf8'));
  for (const statement of statements) {
    const occurrences = statement.split('__MIGRATION_LOCAL_DATETIME__').length - 1;
    await connection.query(
      statement.split('__MIGRATION_LOCAL_DATETIME__').join('?'),
      Array(occurrences).fill(localDateTime)
    );
  }
}

function schemaWithoutCompensationFoundation() {
  const schema = fs.readFileSync(SCHEMA_FILE, 'utf8');
  return schema
    .replace(
      /-- COMPENSATION_INTEGRATION_[A-Z_]+_START[\s\S]*?-- COMPENSATION_INTEGRATION_[A-Z_]+_END/g,
      ''
    )
    .replace(
      /-- COMPENSATION_FINANCIAL_[A-Z_]+_START[\s\S]*?-- COMPENSATION_FINANCIAL_[A-Z_]+_END/g,
      ''
    )
    .replace(
      /-- COMPENSATION_SALES_[A-Z_]+_START[\s\S]*?-- COMPENSATION_SALES_[A-Z_]+_END/g,
      ''
    )
    .replace(
      /-- COMPENSATION_FOUNDATION_[A-Z_]+_START[\s\S]*?-- COMPENSATION_FOUNDATION_[A-Z_]+_END/g,
      ''
    );
}

function migrationNames(limit = null) {
  const names = fs.readdirSync(path.join(ROOT, 'database', 'migrations'))
    .filter((name) => name.endsWith('.sql'))
    .sort();
  return limit ? names.filter((name) => name <= limit) : names;
}

async function createMigrationRegistry(connection, names) {
  await connection.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       nombre VARCHAR(255) PRIMARY KEY,
       aplicadaEn DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
     ) ENGINE=InnoDB`
  );
  for (const name of names) {
    await connection.query(
      'INSERT INTO schema_migrations (nombre) VALUES (?)',
      [name]
    );
  }
}

function runScript(script, databaseName) {
  const result = spawnSync(process.execPath, [path.join(ROOT, script)], {
    cwd: ROOT,
    env: {
      ...temporaryDatabaseEnvironment(databaseName),
      APP_ENV: 'local',
      DB_HOST: 'localhost',
      DB_NAME: assertTemporaryDatabase(databaseName)
    },
    encoding: 'utf8',
    windowsHide: true,
    timeout: 180000
  });
  if (result.status !== 0) {
    const output = `${result.stdout || ''}\n${result.stderr || ''}`
      .replace(/password|session_secret|db_ssl_ca/gi, '[REDACTED]');
    throw new Error(`${script} fallo para una base temporal.\n${output.slice(-4000)}`);
  }
  return result.stdout;
}

async function primaryFingerprint(server, primaryDatabase) {
  const [[tables]] = await server.query(
    `SELECT COUNT(*) total FROM information_schema.TABLES
     WHERE TABLE_SCHEMA=?`,
    [primaryDatabase]
  );
  const [[foundationTable]] = await server.query(
    `SELECT COUNT(*) total FROM information_schema.TABLES
     WHERE TABLE_SCHEMA=? AND LOWER(TABLE_NAME)='operacioncompensatoria'`,
    [primaryDatabase]
  );
  const [[saleColumn]] = await server.query(
    `SELECT COUNT(*) total FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA=? AND LOWER(TABLE_NAME)='venta'
       AND LOWER(COLUMN_NAME)='estadooperacion'`,
    [primaryDatabase]
  );
  const [[migrationTable]] = await server.query(
    `SELECT COUNT(*) total FROM information_schema.TABLES
     WHERE TABLE_SCHEMA=? AND LOWER(TABLE_NAME)='schema_migrations'`,
    [primaryDatabase]
  );
  let migration014 = 0;
  if (Number(migrationTable.total) === 1) {
    const primary = await connectPrimaryDatabase(primaryDatabase);
    try {
      const [[row]] = await primary.query(
        'SELECT COUNT(*) total FROM schema_migrations WHERE nombre=?',
        [MIGRATION]
      );
      migration014 = Number(row.total);
    } finally {
      await primary.end();
    }
  }
  return {
    tables: Number(tables.total),
    foundationTable: Number(foundationTable.total),
    saleColumn: Number(saleColumn.total),
    migration014
  };
}

async function expectDatabaseError(action, expectedCodes, message) {
  let error = null;
  try {
    await action();
  } catch (caught) {
    error = caught;
  }
  check(Boolean(error) && expectedCodes.includes(error.code), message);
}

async function createFixtureTenant(connection, suffix) {
  const [store] = await connection.query(
    `INSERT INTO tienda (nombre, slug, activo, estado, creadoEn, actualizadoEn)
     VALUES (?, ?, 1, 'activa', '2026-07-24 10:00:00', '2026-07-24 10:00:00')`,
    [`Fixture C1 ${suffix}`, `fixture-c1-${suffix}`]
  );
  const [administrator] = await connection.query(
    `INSERT INTO administrador
       (idTienda, usuario, password, rol, activo, versionSesion)
     VALUES (?, ?, REPEAT('x', 60), 'dueno_tienda', 1, 1)`,
    [store.insertId, `fixture_c1_${suffix}`]
  );
  return {
    idTienda: Number(store.insertId),
    idAdministrador: Number(administrator.insertId)
  };
}

async function insertCompensation(connection, fixture, overrides = {}) {
  const values = {
    tipoOperacion: 'anulacion_venta',
    estado: 'solicitada',
    motivoCodigo: 'operacion_duplicada',
    observacion: null,
    requiereAprobacion: 0,
    idAdministradorSolicitante: fixture.idAdministrador,
    idAdministradorAprobador: null,
    claveOperacion: `c1:${crypto.randomBytes(10).toString('hex')}`,
    huellaSolicitud: crypto.createHash('sha256').update(crypto.randomBytes(16)).digest('hex'),
    fechaSolicitud: '2026-07-24 10:10:00',
    fechaAprobacion: null,
    fechaAplicacion: null,
    ...overrides
  };
  return connection.query(
    `INSERT INTO operacionCompensatoria
       (idTienda, tipoOperacion, estado, motivoCodigo, observacion,
        requiereAprobacion, idAdministradorSolicitante, idAdministradorAprobador,
        claveOperacion, huellaSolicitud, fechaSolicitud, fechaAprobacion,
        fechaAplicacion, creadoEn, actualizadoEn)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      fixture.idTienda,
      values.tipoOperacion,
      values.estado,
      values.motivoCodigo,
      values.observacion,
      values.requiereAprobacion,
      values.idAdministradorSolicitante,
      values.idAdministradorAprobador,
      values.claveOperacion,
      values.huellaSolicitud,
      values.fechaSolicitud,
      values.fechaAprobacion,
      values.fechaAplicacion,
      values.fechaSolicitud,
      values.fechaSolicitud
    ]
  );
}

async function validateStructuralInvariants(connection) {
  const fixtureA = await createFixtureTenant(connection, crypto.randomBytes(4).toString('hex'));
  const fixtureB = await createFixtureTenant(connection, crypto.randomBytes(4).toString('hex'));
  const sharedKey = `shared:${crypto.randomBytes(8).toString('hex')}`;
  const fingerprint = crypto.createHash('sha256').update('same-canonical-payload').digest('hex');

  await insertCompensation(connection, fixtureA, {
    claveOperacion: sharedKey,
    huellaSolicitud: fingerprint
  });
  await expectDatabaseError(
    () => insertCompensation(connection, fixtureA, {
      claveOperacion: sharedKey,
      huellaSolicitud: fingerprint
    }),
    ['ER_DUP_ENTRY'],
    'La misma clave no puede duplicarse dentro de una tienda.'
  );
  await expectDatabaseError(
    () => insertCompensation(connection, fixtureA, {
      claveOperacion: sharedKey,
      huellaSolicitud: crypto.createHash('sha256').update('different-payload').digest('hex')
    }),
    ['ER_DUP_ENTRY'],
    'La misma clave tampoco puede reutilizarse con una huella diferente.'
  );
  await insertCompensation(connection, fixtureB, {
    claveOperacion: sharedKey,
    huellaSolicitud: fingerprint
  });
  check(true, 'La misma clave puede utilizarse en tiendas diferentes.');

  await expectDatabaseError(
    () => insertCompensation(connection, fixtureB, {
      idAdministradorSolicitante: fixtureA.idAdministrador
    }),
    ['ER_NO_REFERENCED_ROW_2'],
    'La FK compuesta rechaza un solicitante de otra tienda.'
  );
  await expectDatabaseError(
    () => insertCompensation(connection, fixtureA, {
      idAdministradorSolicitante: null
    }),
    ['ER_BAD_NULL_ERROR'],
    'El administrador solicitante es obligatorio.'
  );
  await insertCompensation(connection, fixtureA, {
    estado: 'aprobada',
    requiereAprobacion: 1,
    idAdministradorAprobador: fixtureA.idAdministrador,
    fechaAprobacion: '2026-07-24 10:11:00'
  });
  check(true, 'El aprobador es opcional y queda exigido cuando la operación aprobada lo requiere.');

  for (const state of COMPENSATION_STATES) {
    const approved = state === 'aprobada';
    const applied = state === 'aplicada';
    await insertCompensation(connection, fixtureA, {
      estado: state,
      requiereAprobacion: approved ? 1 : 0,
      idAdministradorAprobador: approved ? fixtureA.idAdministrador : null,
      fechaAprobacion: approved ? '2026-07-24 10:11:00' : null,
      fechaAplicacion: applied ? '2026-07-24 10:12:00' : null
    });
  }
  check(true, 'Todos los estados contractuales válidos son aceptados con fechas coherentes.');

  for (const reason of COMPENSATION_REASONS) {
    await insertCompensation(connection, fixtureA, {
      motivoCodigo: reason,
      observacion: reason === 'otro_controlado' ? 'Motivo detallado de prueba C1.' : null
    });
  }
  check(true, 'Todos los motivos controlados válidos son aceptados.');

  await expectDatabaseError(
    () => insertCompensation(connection, fixtureA, {
      huellaSolicitud: 'no-es-sha256'
    }),
    ['ER_CHECK_CONSTRAINT_VIOLATED'],
    'Una huella que no es SHA-256 hexadecimal queda rechazada.'
  );
  await expectDatabaseError(
    () => insertCompensation(connection, fixtureA, {
      motivoCodigo: 'otro_controlado',
      observacion: 'corta'
    }),
    ['ER_CHECK_CONSTRAINT_VIOLATED'],
    'otro_controlado exige una observación suficiente.'
  );
  await expectDatabaseError(
    () => insertCompensation(connection, fixtureA, {
      estado: 'aplicada',
      fechaAplicacion: null
    }),
    ['ER_CHECK_CONSTRAINT_VIOLATED'],
    'Una operación aplicada exige fecha de aplicación coherente.'
  );
  await expectDatabaseError(
    () => insertCompensation(connection, fixtureA, {
      claveOperacion: '../ruta-invalida'
    }),
    ['ER_CHECK_CONSTRAINT_VIOLATED'],
    'El esquema rechaza claves de operación con formato inseguro.'
  );
  await expectDatabaseError(
    () => insertCompensation(connection, fixtureA, {
      estado: 'desconocida'
    }),
    ['WARN_DATA_TRUNCATED', 'ER_CHECK_CONSTRAINT_VIOLATED'],
    'Los estados fuera de la allowlist quedan rechazados.'
  );
  await expectDatabaseError(
    () => insertCompensation(connection, fixtureA, {
      motivoCodigo: 'texto_libre'
    }),
    ['WARN_DATA_TRUNCATED', 'ER_CHECK_CONSTRAINT_VIOLATED'],
    'Los motivos fuera de la allowlist quedan rechazados.'
  );
  await expectDatabaseError(
    () => insertCompensation(connection, fixtureA, {
      tipoOperacion: 'anulacion_compra'
    }),
    ['WARN_DATA_TRUNCATED', 'ER_CHECK_CONSTRAINT_VIOLATED'],
    'Los tipos fuera de la allowlist quedan rechazados.'
  );
  await expectDatabaseError(
    () => insertCompensation(connection, fixtureA, {
      requiereAprobacion: 1,
      estado: 'aprobada',
      idAdministradorAprobador: fixtureB.idAdministrador,
      fechaAprobacion: '2026-07-24 10:11:00'
    }),
    ['ER_NO_REFERENCED_ROW_2'],
    'La FK compuesta rechaza un aprobador de otra tienda.'
  );
}

function assertStaticContract() {
  const migrationSql = fs.readFileSync(MIGRATION_FILE, 'utf8');
  check(!/\bDELETE\s+FROM\b/i.test(migrationSql), 'La migración no contiene DELETE físico.');
  check(!/\bUPDATE\s+(fiado|cobroFiado|pagoFiado|pagoVenta|producto|movimientoStock|loteProducto|movimientoLote)\b/i.test(migrationSql),
    'La migración no modifica stock, lotes, pagos, fiados ni cobros.');
  check(/\bUPDATE\s+venta\s+SET\s+estadoOperacion='vigente'/i.test(migrationSql),
    'El único backfill comercial asigna venta.estadoOperacion=vigente.');
  check(COMPENSATION_TYPES.length === 6 && COMPENSATION_TYPES.every((value) => migrationSql.includes(value)),
    'Los seis tipos iniciales tienen una definición única y estable.');
  check(COMPENSATION_STATES.length === 7 && COMPENSATION_STATES.every((value) => migrationSql.includes(value)),
    'Los estados contractuales están respaldados por la migración.');
  check(COMPENSATION_REASONS.length === 8 && COMPENSATION_REASONS.every((value) => migrationSql.includes(value)),
    'Los motivos controlados están respaldados por la migración.');
  check(JSON.stringify(TERMINAL_COMPENSATION_STATES) === JSON.stringify(['aplicada', 'rechazada', 'cancelada']),
    'Los estados terminales son aplicada, rechazada y cancelada.');
  check(OPERATION_KEY_PATTERN.test('venta:123.reversa-1') && !OPERATION_KEY_PATTERN.test('../ruta'),
    'El formato de clave de operación está acotado y no acepta traversal.');
  check(REQUEST_FINGERPRINT_PATTERN.test('a'.repeat(64)) && !REQUEST_FINGERPRINT_PATTERN.test('A'.repeat(64)),
    'La huella exige SHA-256 hexadecimal canónico en minúsculas.');
}

async function main() {
  const primaryDatabase = assertSafeRuntime();
  assertStaticContract();

  const primaryServer = await createServerConnection();
  const temporaryServer = await createTemporaryServerConnection();
  const temporaryDatabases = [
    temporaryDatabaseName(),
    temporaryDatabaseName(),
    temporaryDatabaseName()
  ];
  const createdDatabases = [];
  const primaryBefore = await primaryFingerprint(primaryServer, primaryDatabase);
  try {
    for (const database of temporaryDatabases) {
      await createTemporaryDatabase(temporaryServer, database);
      createdDatabases.push(database);
    }

    const [fromZero, from013, initialSchema] = temporaryDatabases;
    runScript('scripts/init-db.js', fromZero);
    runScript('scripts/migrate-db.js', fromZero);
    const zeroConnection = await connectDatabase(fromZero);
    try {
      const state = await inspectCompensationFoundation(zeroConnection, {
        schemaName: fromZero
      });
      check(state.state === 'post-migracion', 'La instalación 001-014 desde cero queda en estado post-migración.');
      check(state.structureComplete && state.dataValid, 'La instalación desde cero cumple estructura e invariantes.');
      const [[operationsBeforeRetry]] = await zeroConnection.query(
        'SELECT COUNT(*) total FROM operacionCompensatoria'
      );
      runScript('scripts/migrate-db.js', fromZero);
      const [[operationsAfterRetry]] = await zeroConnection.query(
        'SELECT COUNT(*) total FROM operacionCompensatoria'
      );
      check(
        Number(operationsBeforeRetry.total) === Number(operationsAfterRetry.total),
        'Reejecutar el migrador no duplica ni altera operaciones existentes.'
      );
    } finally {
      await zeroConnection.end();
    }

    const from013Connection = await connectDatabase(from013);
    try {
      await executeSqlText(from013Connection, schemaWithoutCompensationFoundation());
      await createMigrationRegistry(
        from013Connection,
        migrationNames('013_seguridad_sesiones.sql')
      );
      await from013Connection.query(
        `INSERT INTO venta
           (idTienda, fecha, subtotal, descuento, total, montoPagado,
            saldoPendiente, estadoPago, tipo, claveOperacion, codigoComprobante)
         VALUES (
           (SELECT idTienda FROM tienda WHERE slug='tienda-deisy'),
           '2026-07-24 09:00:00', 25, 0, 25, 25, 0, 'pagada', 'pagada',
           'fixture-pre014-sale', 'FIXTURE-PRE014'
         )`
      );
      await from013Connection.query(
        `INSERT INTO pagoVenta
           (idTienda, idVenta, idPagoFiado, metodoPago, monto, montoRecibido,
            cambio, referencia, claveOperacion, idAdministrador, creadoEn)
         SELECT idTienda, idVenta, NULL, 'qr', total, NULL, 0,
                'fixture-pre014', 'fixture-pre014-payment', NULL,
                '2026-07-24 09:00:00'
         FROM venta WHERE claveOperacion='fixture-pre014-sale'`
      );
      const [[before]] = await from013Connection.query(
        `SELECT total, montoPagado, saldoPendiente, estadoPago, tipo
         FROM venta WHERE claveOperacion='fixture-pre014-sale'`
      );
      await executeCompensationMigration(from013Connection);
      const physicalState = await inspectCompensationFoundation(from013Connection, {
        schemaName: from013
      });
      check(
        physicalState.structureComplete && physicalState.dataValid && !physicalState.migrationRegistered,
        'La postcondición física de 014 se valida antes de registrar la migración.'
      );
      await from013Connection.query(
        'INSERT INTO schema_migrations (nombre) VALUES (?)',
        [MIGRATION]
      );
      const [[after]] = await from013Connection.query(
        `SELECT total, montoPagado, saldoPendiente, estadoPago, tipo, estadoOperacion
         FROM venta WHERE claveOperacion='fixture-pre014-sale'`
      );
      check(after.estadoOperacion === 'vigente', 'El backfill asigna vigente a ventas existentes.');
      check(
        Number(after.total) === Number(before.total)
          && Number(after.montoPagado) === Number(before.montoPagado)
          && Number(after.saldoPendiente) === Number(before.saldoPendiente)
          && after.estadoPago === before.estadoPago
          && after.tipo === before.tipo,
        'El backfill no reinterpreta estadoPago, tipo ni importes históricos.'
      );
      const [[cobroState]] = await from013Connection.query(
        `SELECT COUNT(*) total FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA=? AND LOWER(TABLE_NAME)='cobrofiado'
           AND LOWER(COLUMN_NAME)='estadooperacion'`,
        [from013]
      );
      check(Number(cobroState.total) === 0, 'C1 difiere estadoOperacion de cobroFiado para C4.');

      const migratedState = await inspectCompensationFoundation(from013Connection, {
        schemaName: from013
      });
      check(migratedState.state === 'post-migracion', 'La migración desde 013 queda registrada y completa.');
      await validateStructuralInvariants(from013Connection);
      const validState = await inspectCompensationFoundation(from013Connection, {
        schemaName: from013
      });
      check(validState.dataValid, 'El comprobador acepta operaciones de prueba que respetan el contrato.');

      const checkerOutput = runScript('scripts/check-compensations.js', from013);
      check(checkerOutput.includes('"state": "post-migracion"'),
        'db:check-compensations valida la base temporal migrada.');
    } finally {
      await from013Connection.end();
    }

    const initialConnection = await connectDatabase(initialSchema);
    try {
      await executeSqlText(initialConnection, fs.readFileSync(SCHEMA_FILE, 'utf8'));
      await createMigrationRegistry(initialConnection, migrationNames(MIGRATION));
      const initialState = await inspectCompensationFoundation(initialConnection, {
        schemaName: initialSchema
      });
      check(initialState.state === 'post-migracion', 'El esquema inicial representa el estado final post-014.');

      const migratedConnection = await connectDatabase(from013);
      try {
        const migratedState = await inspectCompensationFoundation(migratedConnection, {
          schemaName: from013
        });
        check(
          JSON.stringify(initialState.columns) === JSON.stringify(migratedState.columns)
            && JSON.stringify(initialState.indexes) === JSON.stringify(migratedState.indexes)
            && JSON.stringify(initialState.checks) === JSON.stringify(migratedState.checks)
            && JSON.stringify(initialState.foreignKeys) === JSON.stringify(migratedState.foreignKeys),
          'El esquema inicial y la ruta 013→014 son equivalentes para C1.'
        );
      } finally {
        await migratedConnection.end();
      }
    } finally {
      await initialConnection.end();
    }

    const primaryAfter = await primaryFingerprint(primaryServer, primaryDatabase);
    check(JSON.stringify(primaryAfter) === JSON.stringify(primaryBefore),
      'La base local principal conserva exactamente su huella estructural de C1.');
  } finally {
    for (const database of createdDatabases.reverse()) {
      try {
        await dropTemporaryDatabase(temporaryServer, database);
      } catch (error) {
        console.error(`No se pudo limpiar una base temporal C1: ${error.code || 'ERROR'}.`);
        process.exitCode = 1;
      }
    }
    const [remaining] = await temporaryServer.query(
      `SELECT SCHEMA_NAME FROM information_schema.SCHEMATA
       WHERE SCHEMA_NAME IN (${createdDatabases.map(() => '?').join(',')})`,
      createdDatabases
    );
    check(remaining.length === 0, 'Las bases temporales propias de C1 se eliminan en finally.');
    await temporaryServer.end();
    await primaryServer.end();
  }
}

main().catch((error) => {
  console.error('Fallo test:compensation-foundation.');
  console.error(error.message);
  process.exit(1);
});
