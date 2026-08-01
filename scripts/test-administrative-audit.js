const crypto = require('crypto');
const fs = require('fs');
const net = require('net');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const bcrypt = require('bcryptjs');
const mysql = require('mysql2/promise');
const {
  buildDatabaseOptions,
  isProductionEnvironment,
  setBusinessSessionTimeZone
} = require('../config/database-options');
const { requireLocalhostDatabase } = require('../config/env');
const {
  createAdministrativeAuditService
} = require('../services/administrative-audit-service');
const {
  MIGRATION,
  inspectAdministrativeAudit
} = require('./check-administrative-audit');
const { applyTestRequestSecurity } = require('./http-test-security');

const ROOT = path.join(__dirname, '..');
const SCHEMA_FILE = path.join(ROOT, 'database', 'tienda_abarrotes.sql');
const TEMP_PREFIX = 'tmp_tienda_restore_';
const PROTECTED_DATABASES = new Set([
  'tienda_abarrotes',
  'tienda_abarrotes_pruebas',
  'mysql',
  'information_schema',
  'performance_schema',
  'sys'
]);

function check(condition, message) {
  if (!condition) throw new Error(message);
  console.log(`OK: ${message}`);
}

function assertSafeRuntime() {
  const environment = String(process.env.APP_ENV || '').trim().toLowerCase();
  const host = String(process.env.DB_HOST || '').trim().toLowerCase();
  if (!['local', 'test'].includes(environment) || isProductionEnvironment(process.env)) {
    throw new Error('test:administrative-audit solo se permite con APP_ENV=local o test.');
  }
  if (host !== 'localhost') {
    throw new Error('test:administrative-audit solo se permite contra MySQL local.');
  }
  const primary = String(process.env.DB_NAME || '').trim().toLowerCase();
  if (!primary || primary.startsWith(TEMP_PREFIX)) {
    throw new Error('DB_NAME debe identificar la base local principal.');
  }
  return primary;
}

function assertTemporaryDatabase(name) {
  const normalized = String(name || '').trim().toLowerCase();
  if (!new RegExp(`^${TEMP_PREFIX}[a-f0-9]{12}$`).test(normalized)
    || PROTECTED_DATABASES.has(normalized)) {
    throw new Error(`Base temporal de auditoria rechazada: ${name || '(vacia)'}.`);
  }
  return normalized;
}

function quoteTemporaryDatabase(name) {
  return `\`${assertTemporaryDatabase(name)}\``;
}

function temporaryCredentials(database = null) {
  const user = String(process.env.BACKUP_RESTORE_USER || '').trim();
  const password = String(process.env.BACKUP_RESTORE_PASSWORD || '');
  if (!user || !password) {
    throw new Error(
      'Configure BACKUP_RESTORE_USER y BACKUP_RESTORE_PASSWORD con permisos '
      + 'limitados a tmp_tienda_restore_%.*.'
    );
  }
  return {
    ...process.env,
    DB_USER: user,
    DB_PASSWORD: password,
    ...(database ? { DB_NAME: assertTemporaryDatabase(database) } : {})
  };
}

async function connectWithEnvironment(environment, includeDatabase = true) {
  const options = buildDatabaseOptions(environment);
  if (!includeDatabase) delete options.database;
  return setBusinessSessionTimeZone(await mysql.createConnection(options));
}

function readSqlStatements(sql) {
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
    .filter((statement) => !/^DROP\s+DATABASE/i.test(statement));
}

function schemaWithoutAdministrativeAudit() {
  return fs.readFileSync(SCHEMA_FILE, 'utf8')
    .replace(
      /-- ADMINISTRATIVE_AUDIT_FOUNDATION_START[\s\S]*?-- ADMINISTRATIVE_AUDIT_FOUNDATION_END/g,
      ''
    )
    .replace(
      /-- SAAS_C_PAYMENT_SCHEMA_START[\s\S]*?-- SAAS_C_PAYMENT_SCHEMA_END/g,
      ''
    );
}

async function executeSql(connection, sql) {
  for (const statement of readSqlStatements(sql)) {
    await connection.query(statement);
  }
}

function repositoryMigrationNames() {
  return fs.readdirSync(path.join(ROOT, 'database', 'migrations'))
    .filter((name) => name.endsWith('.sql'))
    .sort();
}

function historicalBaselineMigrationNames() {
  return repositoryMigrationNames().filter((name) => name < '010_');
}

async function registerMigrations(connection) {
  await connection.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       nombre VARCHAR(255) PRIMARY KEY,
       aplicadaEn DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
     ) ENGINE=InnoDB`
  );
  for (const name of historicalBaselineMigrationNames()) {
    await connection.query('INSERT INTO schema_migrations (nombre) VALUES (?)', [name]);
  }
}

function runMigrator(database) {
  const result = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'migrate-db.js')], {
    cwd: ROOT,
    env: {
      ...temporaryCredentials(database),
      APP_ENV: 'local',
      DB_HOST: 'localhost',
      DB_NAME: assertTemporaryDatabase(database)
    },
    encoding: 'utf8',
    windowsHide: true,
    timeout: 180000
  });
  if (result.status !== 0) {
    throw new Error(`El migrador fallo sobre la base temporal.\n${String(result.stderr || '').slice(-2000)}`);
  }
  const applied = String(result.stdout)
    .split(/\r?\n/)
    .filter((line) => line.startsWith('Migracion aplicada: '))
    .map((line) => line.slice('Migracion aplicada: '.length).trim());
  const repositoryMigrations = new Set(repositoryMigrationNames());
  check(applied.includes(MIGRATION),
    'El migrador real aplica la migracion 018 sobre la base temporal.');
  check(applied.every((name) => repositoryMigrations.has(name)),
    'Toda migracion aplicada en la base temporal pertenece al repositorio.');
}

const PRIMARY_FINGERPRINT_TABLES = Object.freeze([
  'tienda',
  'administrador',
  'plan',
  'funcionalidad',
  'planFuncionalidad',
  'suscripcionTienda',
  'cliente',
  'proveedor',
  'producto',
  'compra',
  'detalleCompra',
  'venta',
  'detalleVenta',
  'pagoVenta',
  'fiado',
  'detalleFiado',
  'pagoFiado',
  'cobroFiado',
  'movimientoStock',
  'loteProducto',
  'movimientoLote',
  'gasto',
  'cierreCaja',
  'operacionCompensatoria',
  'compensacionVenta',
  'compensacionPagoVenta',
  'compensacionCobroFiado',
  'obligacionReembolsoVenta',
  'movimientoLiquidacionCompensacion'
]);

function quoteIdentifier(identifier) {
  return `\`${String(identifier).replace(/`/g, '``')}\``;
}

async function aggregateTable(connection, primaryDatabase, table) {
  const [existing] = await connection.query(
    `SELECT TABLE_NAME
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA=? AND LOWER(TABLE_NAME)=LOWER(?)`,
    [primaryDatabase, table]
  );
  if (!existing.length) return { exists: false };
  const realTable = existing[0].TABLE_NAME;
  const [columns] = await connection.query(
    `SELECT COLUMN_NAME
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA=? AND LOWER(TABLE_NAME)=LOWER(?)
       AND DATA_TYPE IN (
         'tinyint','smallint','mediumint','int','bigint',
         'decimal','numeric','float','double','real','bit'
       )
     ORDER BY ORDINAL_POSITION`,
    [primaryDatabase, table]
  );
  const sums = columns.map(({ COLUMN_NAME }) => (
    `COALESCE(SUM(COALESCE(${quoteIdentifier(COLUMN_NAME)},0)),0) AS ${quoteIdentifier(COLUMN_NAME)}`
  ));
  const [rows] = await connection.query(
    `SELECT COUNT(*) AS __rows${sums.length ? `, ${sums.join(', ')}` : ''}
     FROM ${quoteIdentifier(realTable)}`
  );
  return Object.fromEntries(
    Object.entries(rows[0]).map(([key, value]) => [key, String(value)])
  );
}

async function primaryFingerprint(connection, primaryDatabase) {
  const [migrations] = await connection.query(
    'SELECT nombre, aplicadaEn FROM schema_migrations ORDER BY nombre'
  );
  const [auditTables] = await connection.query(
    `SELECT TABLE_NAME
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA=? AND LOWER(TABLE_NAME)=LOWER('eventoAuditoriaAdministrativa')`,
    [primaryDatabase]
  );
  const [auditColumns] = await connection.query(
    `SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, EXTRA, COLLATION_NAME
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA=? AND LOWER(TABLE_NAME)=LOWER('eventoAuditoriaAdministrativa')
     ORDER BY ORDINAL_POSITION`,
    [primaryDatabase]
  );
  const [auditIndexes] = await connection.query(
    `SELECT INDEX_NAME, NON_UNIQUE, SEQ_IN_INDEX, COLUMN_NAME
     FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA=? AND LOWER(TABLE_NAME)=LOWER('eventoAuditoriaAdministrativa')
     ORDER BY INDEX_NAME, SEQ_IN_INDEX`,
    [primaryDatabase]
  );
  const [auditConstraints] = await connection.query(
    `SELECT CONSTRAINT_NAME, CONSTRAINT_TYPE
     FROM information_schema.TABLE_CONSTRAINTS
     WHERE CONSTRAINT_SCHEMA=? AND LOWER(TABLE_NAME)=LOWER('eventoAuditoriaAdministrativa')
     ORDER BY CONSTRAINT_NAME`,
    [primaryDatabase]
  );
  const auditRows = auditTables.length
    ? Number((await connection.query(
      'SELECT COUNT(*) total FROM eventoAuditoriaAdministrativa'
    ))[0][0].total)
    : null;
  const aggregates = {};
  for (const table of PRIMARY_FINGERPRINT_TABLES) {
    aggregates[table] = await aggregateTable(connection, primaryDatabase, table);
  }
  return {
    migrations: migrations.map((row) => ({
      name: row.nombre,
      appliedAt: String(row.aplicadaEn)
    })),
    lastMigration: migrations.at(-1)?.nombre || null,
    audit: {
      present: auditTables.length === 1,
      rows: auditRows,
      columns: auditColumns,
      indexes: auditIndexes,
      constraints: auditConstraints
    },
    aggregates
  };
}

function fingerprintDigest(fingerprint) {
  return crypto.createHash('sha256').update(JSON.stringify(fingerprint)).digest('hex');
}

async function temporaryDatabaseSnapshot(connection) {
  const [rows] = await connection.query(
    `SELECT SCHEMA_NAME
     FROM information_schema.SCHEMATA
     WHERE SCHEMA_NAME LIKE 'tmp\\_tienda\\_restore\\_%' ESCAPE '\\\\'
     ORDER BY SCHEMA_NAME`
  );
  return rows.map((row) => row.SCHEMA_NAME);
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

async function waitForServer(baseUrl, child) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error('El servidor temporal termino antes de iniciar.');
    }
    try {
      const response = await fetch(`${baseUrl}/health/live`);
      if (response.status === 200) return;
    } catch {
      // El proceso todavia esta iniciando.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('El servidor temporal no inicio dentro del tiempo esperado.');
}

async function stopServer(child) {
  const stopped = () => child.exitCode !== null || child.signalCode !== null;
  if (!child || stopped()) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    new Promise((resolve) => setTimeout(resolve, 10000))
  ]);
  if (!stopped()) {
    child.kill('SIGKILL');
    await Promise.race([
      new Promise((resolve) => child.once('exit', resolve)),
      new Promise((resolve) => setTimeout(resolve, 5000))
    ]);
  }
  if (!stopped()) throw new Error('El proceso Node temporal no pudo cerrarse.');
}

class HttpSession {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
    this.cookie = '';
  }

  async request(route, options = {}) {
    const request = { ...options, headers: { ...(options.headers || {}) } };
    if (request.body && typeof request.body !== 'string') {
      request.headers['content-type'] = 'application/json';
      request.body = JSON.stringify(request.body);
    }
    applyTestRequestSecurity(this.baseUrl, request);
    if (this.cookie) request.headers.cookie = this.cookie;
    const response = await fetch(`${this.baseUrl}${route}`, { ...request, redirect: 'manual' });
    const cookie = response.headers.get('set-cookie');
    if (cookie) this.cookie = cookie.split(';')[0];
    const text = await response.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    return { status: response.status, body };
  }
}

async function expect(session, route, options, expectedStatus, label) {
  const response = await session.request(route, options);
  check(response.status === expectedStatus, `${label} responde HTTP ${expectedStatus}.`);
  return response.body;
}

async function assertAction(connection, action, result, minimum = 1) {
  const [[row]] = await connection.query(
    `SELECT COUNT(*) total FROM eventoAuditoriaAdministrativa
     WHERE accion=? AND resultado=?`,
    [action, result]
  );
  check(Number(row.total) >= minimum, `Auditoria registra ${action}/${result}.`);
}

async function testServiceGuarantees(connection, ids) {
  const audit = createAdministrativeAuditService({
    database: connection,
    clock: () => '2026-07-26 12:00:00'
  });
  const requestId = crypto.randomUUID();
  const first = await audit.recordOutcome({
    actorType: 'sistema',
    administratorId: null,
    storeId: ids.storeA,
    action: 'revocacion_sesion',
    result: 'correcto',
    resultCode: 'SESSION_REVOKED',
    origin: 'sistema',
    reference: `tienda:${ids.storeA}`,
    requestId,
    metadata: { sesionesRevocadas: 2 }
  });
  const duplicate = await audit.recordOutcome({
    actorType: 'sistema',
    administratorId: null,
    storeId: ids.storeA,
    action: 'revocacion_sesion',
    result: 'correcto',
    resultCode: 'SESSION_REVOKED',
    origin: 'sistema',
    reference: `tienda:${ids.storeA}`,
    requestId,
    metadata: { sesionesRevocadas: 2 }
  });
  check(first.idEventoAuditoria === duplicate.idEventoAuditoria && duplicate.duplicated,
    'Una misma solicitud de auditoria no duplica eventos.');

  const beforeRollback = await connection.query(
    'SELECT activo FROM tienda WHERE idTienda=?',
    [ids.storeA]
  );
  await connection.beginTransaction();
  await connection.query('UPDATE tienda SET activo=0 WHERE idTienda=?', [ids.storeA]);
  await audit.recordCritical(connection, {
    actorType: 'administrador',
    administratorId: ids.superadmin,
    storeId: ids.storeA,
    action: 'modificacion_tienda',
    result: 'correcto',
    resultCode: 'STORE_UPDATED',
    origin: 'web',
    reference: `tienda:${ids.storeA}`,
    requestId: crypto.randomUUID(),
    before: { activo: true, estado: 'activa' },
    after: { activo: false, estado: 'inactiva' }
  });
  await connection.rollback();
  const afterRollback = await connection.query(
    'SELECT activo FROM tienda WHERE idTienda=?',
    [ids.storeA]
  );
  check(
    Number(beforeRollback[0][0].activo) === Number(afterRollback[0][0].activo),
    'Rollback revierte conjuntamente la mutacion y su evento critico.'
  );

  const rejectedRequestId = crypto.randomUUID();
  await audit.recordOutcome({
    actorType: 'administrador',
    administratorId: ids.superadmin,
    storeId: ids.storeA,
    action: 'modificacion_tienda',
    result: 'rechazado',
    resultCode: 'ADMIN_OPERATION_REJECTED',
    origin: 'web',
    reference: `tienda:${ids.storeA}`,
    requestId: rejectedRequestId
  });
  check(
    await connection.query(
      'SELECT COUNT(*) total FROM eventoAuditoriaAdministrativa WHERE requestId=?',
      [rejectedRequestId]
    ).then(([rows]) => Number(rows[0].total)) === 1,
    'Un rechazo se registra separadamente despues del rollback.'
  );

  const forbidden = await audit.recordOutcome({
    actorType: 'sistema',
    administratorId: null,
    storeId: ids.storeA,
    action: 'revocacion_sesion',
    result: 'correcto',
    resultCode: 'SESSION_REVOKED',
    origin: 'sistema',
    requestId: crypto.randomUUID(),
    metadata: { password: 'no-debe-guardarse' }
  });
  check(forbidden.recorded === false, 'La allowlist rechaza campos sensibles antes de escribir.');

  const mismatchedResult = await audit.recordOutcome({
    actorType: 'sistema',
    administratorId: null,
    storeId: ids.storeA,
    action: 'revocacion_sesion',
    result: 'fallido',
    resultCode: 'SESSION_REVOKED',
    origin: 'sistema',
    requestId: crypto.randomUUID()
  });
  check(mismatchedResult.recorded === false,
    'El contrato rechaza combinaciones incoherentes de resultado y codigo.');

  let crossedTenantRejected = false;
  try {
    await audit.recordCritical(connection, {
      actorType: 'administrador',
      administratorId: ids.ownerA,
      storeId: ids.storeB,
      action: 'modificacion_tienda',
      result: 'correcto',
      resultCode: 'STORE_UPDATED',
      origin: 'web',
      requestId: crypto.randomUUID(),
      before: { activo: true, estado: 'activa' },
      after: { activo: true, estado: 'activa' }
    });
  } catch (error) {
    crossedTenantRejected = error.code === 'AUDIT_EVENT_INVALID';
  }
  check(crossedTenantRejected, 'El servicio rechaza actores de otra tienda.');

  let crossedReferenceRejected = false;
  try {
    await audit.recordCritical(connection, {
      actorType: 'administrador',
      administratorId: ids.superadmin,
      storeId: ids.storeA,
      action: 'modificacion_propietario',
      result: 'correcto',
      resultCode: 'OWNER_UPDATED',
      origin: 'web',
      requestId: crypto.randomUUID(),
      reference: `administrador:${ids.ownerB}`,
      before: { activo: true, rol: 'dueno_tienda' },
      after: { activo: true, rol: 'dueno_tienda' }
    });
  } catch (error) {
    crossedReferenceRejected = error.code === 'AUDIT_EVENT_INVALID';
  }
  check(crossedReferenceRejected, 'El servicio rechaza referencias de otra tienda.');

  check(
    !Object.hasOwn(audit, 'update') && !Object.hasOwn(audit, 'delete'),
    'El servicio append-only no expone operaciones de UPDATE o DELETE.'
  );
}

async function main() {
  const primaryDatabase = assertSafeRuntime();
  const primaryConfig = {
    ...requireLocalhostDatabase('La prueba de auditoria administrativa'),
    decimalNumbers: true
  };
  const primary = await connectWithEnvironment({ ...process.env, DB_NAME: primaryDatabase });
  const temporaryServer = await connectWithEnvironment(temporaryCredentials(), false);
  const temporaryDatabase = `${TEMP_PREFIX}${crypto.randomBytes(6).toString('hex')}`;
  let temporary = null;
  let serverProcess = null;
  let serverOutput = '';
  let temporaryDatabasesBefore = null;

  try {
    temporaryDatabasesBefore = await temporaryDatabaseSnapshot(temporaryServer);
    const primaryBefore = await primaryFingerprint(primary, primaryDatabase);
    check(primaryBefore.migrations.some((item) => item.name === MIGRATION),
      'La base principal contiene la migracion 018 sin depender de la ultima version.');
    check(primaryBefore.audit.present,
      'La huella principal incluye la estructura fisica de auditoria.');
    check(primaryBefore.migrations.at(-1)?.name === primaryBefore.lastMigration,
      'La ultima migracion se deriva dinamicamente de schema_migrations.');
    console.log(`Huella principal inicial: ${fingerprintDigest(primaryBefore)}`);

    await temporaryServer.query(
      `CREATE DATABASE ${quoteTemporaryDatabase(temporaryDatabase)}
       CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
    temporary = await connectWithEnvironment(temporaryCredentials(temporaryDatabase));
    await executeSql(temporary, schemaWithoutAdministrativeAudit());
    await registerMigrations(temporary);
    runMigrator(temporaryDatabase);

    const state = await inspectAdministrativeAudit(temporary, { schemaName: temporaryDatabase });
    check(state.estado === 'post', 'El comprobador valida 018 sobre la base temporal.');
    const [[migrationCount]] = await temporary.query(
      'SELECT COUNT(*) total FROM schema_migrations'
    );
    check(
      Number(migrationCount.total) === repositoryMigrationNames().length,
      'La base temporal queda con todas las migraciones del repositorio.'
    );

    const marker = crypto.randomBytes(5).toString('hex');
    const superPassword = `Super-${crypto.randomBytes(12).toString('hex')}!`;
    const ownerPassword = `Owner-${crypto.randomBytes(12).toString('hex')}!`;
    const extraPassword = `Extra-${crypto.randomBytes(12).toString('hex')}!`;
    const changedPassword = `Changed-${crypto.randomBytes(12).toString('hex')}!`;
    const [superResult] = await temporary.query(
      `INSERT INTO administrador (idTienda, usuario, password, rol, activo)
       VALUES (NULL, ?, ?, 'superadmin', 1)`,
      [`audit_super_${marker}`, await bcrypt.hash(superPassword, 12)]
    );

    const port = await findFreePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    serverProcess = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
      cwd: ROOT,
      env: {
        ...temporaryCredentials(temporaryDatabase),
        APP_ENV: 'local',
        DB_HOST: 'localhost',
        DB_NAME: temporaryDatabase,
        PORT: String(port),
        SESSION_SECRET: crypto.randomBytes(32).toString('hex'),
        TRUSTED_ORIGINS: baseUrl,
        RATE_LIMIT_ENABLED: 'true',
        RATE_LIMIT_MAX: '2000',
        AUTH_RATE_LIMIT_MAX: '200',
        ADMIN_RATE_LIMIT_MAX: '200',
        LOGIN_RATE_LIMIT_MAX: '6',
        LOGIN_IDENTITY_RATE_LIMIT_MAX: '4'
      },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    serverProcess.stdout.on('data', (chunk) => { serverOutput += chunk.toString(); });
    serverProcess.stderr.on('data', (chunk) => { serverOutput += chunk.toString(); });
    await waitForServer(baseUrl, serverProcess);

    const superSession = new HttpSession(baseUrl);
    const ownerSession = new HttpSession(baseUrl);
    const ownerRevokedSession = new HttpSession(baseUrl);

    await expect(superSession, '/auth/login', {
      method: 'POST',
      body: { usuario: `inexistente_${marker}`, password: 'incorrecta' }
    }, 401, 'Login rechazado');
    await expect(superSession, '/auth/login', {
      method: 'POST',
      body: { usuario: `audit_super_${marker}`, password: superPassword }
    }, 200, 'Login correcto');

    const storeA = await expect(superSession, '/api/admin/tiendas', {
      method: 'POST',
      body: {
        nombre: `Auditoria A ${marker}`,
        slug: `auditoria-a-${marker}`,
        activo: true,
        estado: 'activa',
        propietario: {
          usuario: `audit_owner_a_${marker}`,
          password: ownerPassword,
          confirmacionPassword: ownerPassword,
          activo: true
        },
        suscripcion: { planCodigo: 'avanzado', tipo: 'prueba', duracionDias: 30 }
      }
    }, 201, 'Creacion de tienda auditada');
    const storeB = await expect(superSession, '/api/admin/tiendas', {
      method: 'POST',
      body: {
        nombre: `Auditoria B ${marker}`,
        slug: `auditoria-b-${marker}`,
        activo: true,
        estado: 'activa',
        propietario: {
          usuario: `audit_owner_b_${marker}`,
          password: ownerPassword,
          confirmacionPassword: ownerPassword,
          activo: true
        },
        suscripcion: { planCodigo: 'basico', tipo: 'prueba', duracionDias: 30 }
      }
    }, 201, 'Segunda tienda para aislamiento');

    await expect(superSession, '/api/admin/tiendas', {
      method: 'POST',
      body: {
        nombre: 'Duplicada',
        slug: `auditoria-a-${marker}`,
        propietario: {
          usuario: `audit_duplicate_${marker}`,
          password: ownerPassword,
          confirmacionPassword: ownerPassword,
          activo: true
        },
        suscripcion: { planCodigo: 'basico', tipo: 'prueba', duracionDias: 30 }
      }
    }, 409, 'Rechazo administrativo despues de rollback');

    await expect(superSession, `/api/admin/tiendas/${storeA.tienda.idTienda}`, {
      method: 'PUT',
      body: {
        nombre: `Auditoria A actualizada ${marker}`,
        slug: `auditoria-a-${marker}`,
        activo: true,
        estado: 'activa'
      }
    }, 200, 'Modificacion de tienda');

    const extraOwner = await expect(
      superSession,
      `/api/admin/tiendas/${storeA.tienda.idTienda}/propietarios`,
      {
        method: 'POST',
        body: {
          usuario: `audit_extra_${marker}`,
          password: extraPassword,
          confirmacionPassword: extraPassword,
          activo: true
        }
      },
      201,
      'Creacion de propietario'
    );
    await expect(superSession, `/api/admin/propietarios/${extraOwner.propietario.idAdministrador}`, {
      method: 'PUT',
      body: { usuario: `audit_extra_updated_${marker}` }
    }, 200, 'Modificacion de propietario');
    await expect(superSession, `/api/admin/propietarios/${extraOwner.propietario.idAdministrador}/desactivar`, {
      method: 'PATCH'
    }, 200, 'Desactivacion de propietario');
    await expect(superSession, `/api/admin/propietarios/${extraOwner.propietario.idAdministrador}/activar`, {
      method: 'PATCH'
    }, 200, 'Activacion de propietario');
    await expect(
      superSession,
      `/api/admin/propietarios/${extraOwner.propietario.idAdministrador}/restablecer-password`,
      {
        method: 'PATCH',
        body: { password: changedPassword, confirmacionPassword: changedPassword }
      },
      200,
      'Restablecimiento de password'
    );

    const subscription = await expect(
      superSession,
      `/api/admin/tiendas/${storeA.tienda.idTienda}/suscripciones`,
      {
        method: 'POST',
        body: { planCodigo: 'basico', tipo: 'pagada', duracionDias: 30 }
      },
      201,
      'Creacion de suscripcion'
    );
    await expect(
      superSession,
      `/api/admin/suscripciones/${subscription.suscripcion.idSuscripcion}/suspender`,
      { method: 'PATCH' },
      200,
      'Suspension de suscripcion'
    );
    await expect(
      superSession,
      `/api/admin/suscripciones/${subscription.suscripcion.idSuscripcion}/cancelar`,
      { method: 'PATCH' },
      200,
      'Cancelacion de suscripcion'
    );

    await expect(ownerSession, '/auth/login', {
      method: 'POST',
      body: { usuario: `audit_owner_a_${marker}`, password: ownerPassword }
    }, 200, 'Login de propietario');
    await expect(ownerSession, '/auth/change-password', {
      method: 'POST',
      body: {
        passwordActual: ownerPassword,
        passwordNueva: changedPassword,
        confirmacionPassword: changedPassword
      }
    }, 200, 'Cambio propio de password');
    await expect(ownerSession, '/auth/login', {
      method: 'POST',
      body: { usuario: `audit_owner_a_${marker}`, password: changedPassword }
    }, 200, 'Nuevo login tras cambio de password');
    await expect(ownerSession, '/auth/logout', { method: 'POST' }, 200, 'Logout auditado');

    await expect(ownerRevokedSession, '/auth/login', {
      method: 'POST',
      body: { usuario: `audit_owner_a_${marker}`, password: changedPassword }
    }, 200, 'Login previo a revocacion');
    await expect(
      superSession,
      `/api/admin/propietarios/${storeA.propietario.idAdministrador}/desactivar`,
      { method: 'PATCH' },
      200,
      'Revocacion administrativa'
    );
    await expect(ownerRevokedSession, '/api/contexto', {}, 401, 'Sesion revocada rechazada');

    let limited = false;
    for (let attempt = 0; attempt < 10 && !limited; attempt += 1) {
      const response = await new HttpSession(baseUrl).request('/auth/login', {
        method: 'POST',
        body: { usuario: `limited_${marker}`, password: 'incorrecta' }
      });
      limited = response.status === 429;
    }
    check(limited, 'El limitador de login produce un evento limitado.');

    await assertAction(temporary, 'inicio_sesion', 'correcto', 3);
    await assertAction(temporary, 'inicio_sesion', 'rechazado');
    await assertAction(temporary, 'inicio_sesion', 'limitado');
    await assertAction(temporary, 'cierre_sesion', 'correcto');
    await assertAction(temporary, 'revocacion_sesion', 'correcto');
    await assertAction(temporary, 'revocacion_sesion', 'rechazado');
    await assertAction(temporary, 'cambio_password', 'correcto');
    await assertAction(temporary, 'restablecimiento_password', 'correcto');
    await assertAction(temporary, 'creacion_tienda', 'correcto', 2);
    await assertAction(temporary, 'creacion_tienda', 'rechazado');
    await assertAction(temporary, 'modificacion_tienda', 'correcto');
    await assertAction(temporary, 'creacion_propietario', 'correcto', 3);
    await assertAction(temporary, 'modificacion_propietario', 'correcto');
    await assertAction(temporary, 'activacion_propietario', 'correcto');
    await assertAction(temporary, 'desactivacion_propietario', 'correcto');
    await assertAction(temporary, 'asignacion_plan', 'correcto', 3);
    await assertAction(temporary, 'creacion_suscripcion', 'correcto', 3);
    await assertAction(temporary, 'suspension_suscripcion', 'correcto');
    await assertAction(temporary, 'cancelacion_suscripcion', 'correcto');

    await testServiceGuarantees(temporary, {
      superadmin: Number(superResult.insertId),
      storeA: Number(storeA.tienda.idTienda),
      storeB: Number(storeB.tienda.idTienda),
      ownerA: Number(storeA.propietario.idAdministrador),
      ownerB: Number(storeB.propietario.idAdministrador)
    });

    const [auditRows] = await temporary.query(
      `SELECT actorTipo, categoria, accion, resultado, codigoResultado, origen,
         entidadTipo, referenciaSegura, requestId, datosAnteriores,
         datosPosteriores, metadatos
       FROM eventoAuditoriaAdministrativa`
    );
    const serialized = JSON.stringify(auditRows).toLowerCase();
    for (const forbidden of [
      superPassword,
      ownerPassword,
      extraPassword,
      changedPassword,
      'session_secret',
      'sqlmessage',
      'claveoperacion',
      'huellasolicitud'
    ]) {
      check(!serialized.includes(String(forbidden).toLowerCase()),
        `La auditoria no contiene el valor o campo prohibido ${forbidden.includes('-') ? 'secreto' : forbidden}.`);
    }

    const finalState = await inspectAdministrativeAudit(temporary, { schemaName: temporaryDatabase });
    check(finalState.estado === 'post' && finalState.datosValidos,
      'El comprobador final acepta estructura, contrato y datos de auditoria.');

    const primaryAfter = await primaryFingerprint(primary, primaryDatabase);
    check(JSON.stringify(primaryAfter) === JSON.stringify(primaryBefore),
      'La base principal conserva exactamente su huella previa.');
    console.log(`Huella principal final: ${fingerprintDigest(primaryAfter)}`);
  } finally {
    await stopServer(serverProcess);
    if (serverOutput) {
      const lowered = serverOutput.toLowerCase();
      check(!lowered.includes(String(process.env.DB_PASSWORD || '').toLowerCase()) || !process.env.DB_PASSWORD,
        'Los logs del servidor temporal no exponen la credencial de base.');
      check(!lowered.includes(String(process.env.SESSION_SECRET || '').toLowerCase()) || !process.env.SESSION_SECRET,
        'Los logs del servidor temporal no exponen SESSION_SECRET.');
    }
    if (temporary) await temporary.end();
    try {
      await temporaryServer.query(`DROP DATABASE IF EXISTS ${quoteTemporaryDatabase(temporaryDatabase)}`);
    } finally {
      const [remaining] = await temporaryServer.query(
        `SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=?`,
        [temporaryDatabase]
      );
      check(remaining.length === 0, 'La base temporal se elimina en finally.');
      const temporaryDatabasesAfter = await temporaryDatabaseSnapshot(temporaryServer);
      if (temporaryDatabasesBefore) {
        check(
          JSON.stringify(temporaryDatabasesAfter) === JSON.stringify(temporaryDatabasesBefore),
          'El conjunto de bases temporales queda exactamente como al inicio.'
        );
      }
      await temporaryServer.end();
      await primary.end();
    }
  }
}

main().catch((error) => {
  console.error('Fallo test:administrative-audit.');
  console.error(error.message);
  process.exit(1);
});
