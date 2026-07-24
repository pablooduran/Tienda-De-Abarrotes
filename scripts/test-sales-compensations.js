const crypto = require('crypto');
const fs = require('fs');
const net = require('net');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const bcrypt = require('bcryptjs');
const mysql = require('mysql2/promise');
require('../config/env');
const {
  buildDatabaseOptions,
  isProductionEnvironment,
  setBusinessSessionTimeZone
} = require('../config/database-options');
const { applyTestRequestSecurity } = require('./http-test-security');

const ROOT = path.join(__dirname, '..');
const SCHEMA_FILE = path.join(ROOT, 'database', 'tienda_abarrotes.sql');
const MIGRATIONS_DIR = path.join(ROOT, 'database', 'migrations');
const MIGRATION_015 = '015_compensaciones_venta_inventario.sql';
const TEMP_PREFIX = 'tmp_tienda_restore_';
const PRIMARY_DATABASE = 'tienda_abarrotes_pruebas';
const PRIMARY_RELEVANT_TABLES = [
  'cobrofiado',
  'compensacionventa',
  'detallecompensacionlote',
  'detallecompensacionventa',
  'detalleventa',
  'fiado',
  'liquidacioncompensacionventa',
  'loteproducto',
  'movimientolote',
  'movimientostock',
  'operacioncompensatoria',
  'pagofiado',
  'pagoventa',
  'producto',
  'schema_migrations',
  'venta'
];
const PROTECTED_DATABASES = new Set([
  'tienda_abarrotes',
  PRIMARY_DATABASE,
  'mysql',
  'information_schema',
  'performance_schema',
  'sys'
]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
  console.log(`OK: ${message}`);
}

function safeError(error) {
  return String(error?.message || error || 'Error')
    .replace(/(password|contrasena|cookie|session_secret|db_ssl_ca|token|hash)\s*[:=]\s*\S+/gi,
      '$1=[REDACTED]');
}

function assertTemporaryDatabase(name) {
  const normalized = String(name || '').trim().toLowerCase();
  if (!new RegExp(`^${TEMP_PREFIX}[a-f0-9]{12}$`).test(normalized)
    || PROTECTED_DATABASES.has(normalized)) {
    throw new Error('La guarda de C2 rechazo el nombre de la base temporal.');
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
  const environment = String(process.env.APP_ENV || '').trim().toLowerCase();
  const host = String(process.env.DB_HOST || '').trim().toLowerCase();
  const database = String(process.env.DB_NAME || '').trim().toLowerCase();
  if (!['local', 'test'].includes(environment) || isProductionEnvironment(process.env)) {
    throw new Error('test:sales-compensations solo se permite en APP_ENV local o test.');
  }
  if (host !== 'localhost') {
    throw new Error('test:sales-compensations exige DB_HOST=localhost.');
  }
  if (database !== PRIMARY_DATABASE) {
    throw new Error(`test:sales-compensations exige DB_NAME=${PRIMARY_DATABASE}.`);
  }
  if (!String(process.env.BACKUP_RESTORE_USER || '').trim()
    || !String(process.env.BACKUP_RESTORE_PASSWORD || '')) {
    throw new Error(
      'Configure las credenciales del usuario local limitado a tmp_tienda_restore_%.*.'
    );
  }
}

function restoreEnvironment(databaseName = null) {
  return {
    ...process.env,
    APP_ENV: 'local',
    DB_HOST: 'localhost',
    DB_USER: String(process.env.BACKUP_RESTORE_USER || '').trim(),
    DB_PASSWORD: String(process.env.BACKUP_RESTORE_PASSWORD || ''),
    ...(databaseName ? { DB_NAME: assertTemporaryDatabase(databaseName) } : {})
  };
}

async function createConnection(environment, includeDatabase = true) {
  const options = buildDatabaseOptions(environment, { decimalNumbers: true });
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
    .filter((statement) => !/^DROP\s+/i.test(statement));
}

async function executeSql(connection, sql) {
  for (const statement of readSqlStatements(sql)) {
    await connection.query(statement);
  }
}

function schemaBeforeC2() {
  return fs.readFileSync(SCHEMA_FILE, 'utf8').replace(
    /-- COMPENSATION_SALES_[A-Z_]+_START[\s\S]*?-- COMPENSATION_SALES_[A-Z_]+_END/g,
    ''
  );
}

function migrationNames(limit = null) {
  const names = fs.readdirSync(MIGRATIONS_DIR)
    .filter((name) => /^\d{3}_.+\.sql$/i.test(name))
    .sort();
  return limit ? names.filter((name) => name <= limit) : names;
}

async function createMigrationRegistry(connection, names) {
  await connection.query(
    `CREATE TABLE schema_migrations (
       nombre VARCHAR(255) PRIMARY KEY,
       aplicadaEn DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
     ) ENGINE=InnoDB`
  );
  for (const name of names) {
    await connection.query('INSERT INTO schema_migrations (nombre) VALUES (?)', [name]);
  }
}

function runNodeScript(script, databaseName, timeout = 180000) {
  const result = spawnSync(process.execPath, [path.join(ROOT, script)], {
    cwd: ROOT,
    env: restoreEnvironment(databaseName),
    encoding: 'utf8',
    windowsHide: true,
    timeout
  });
  if (result.status !== 0) {
    const output = `${result.stdout || ''}\n${result.stderr || ''}`;
    throw new Error(`${script} fallo en la base temporal.\n${safeError(output.slice(-5000))}`);
  }
  return result.stdout;
}

async function primaryFingerprint(environment = process.env) {
  const connection = await createConnection(environment);
  try {
    const [migrations] = await connection.query(
      `SELECT nombre,
              DATE_FORMAT(aplicadaEn, '%Y-%m-%d %H:%i:%s') aplicadaEn
       FROM schema_migrations
       ORDER BY nombre`
    );
    const [tables] = await connection.query(
      `SELECT LOWER(TABLE_NAME) tableName,
              LOWER(ENGINE) engine
       FROM information_schema.TABLES
       WHERE TABLE_SCHEMA=DATABASE()
         AND LOWER(TABLE_NAME) IN (?)
       ORDER BY LOWER(TABLE_NAME)`,
      [PRIMARY_RELEVANT_TABLES]
    );
    const [columns] = await connection.query(
      `SELECT LOWER(TABLE_NAME) tableName,
              LOWER(COLUMN_NAME) columnName,
              LOWER(COLUMN_TYPE) columnType,
              IS_NULLABLE nullable,
              COLUMN_DEFAULT defaultValue,
              LOWER(EXTRA) extra
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA=DATABASE()
         AND LOWER(TABLE_NAME) IN (?)
       ORDER BY LOWER(TABLE_NAME), ORDINAL_POSITION`,
      [PRIMARY_RELEVANT_TABLES]
    );
    const [saleStates] = await connection.query(
      `SELECT estadoOperacion,
              estadoPago,
              COUNT(*) count,
              COALESCE(SUM(total), 0) total
       FROM venta
       GROUP BY estadoOperacion, estadoPago
       ORDER BY estadoOperacion, estadoPago`
    );
    const summary = async (sql) => (await connection.query(sql))[0][0];
    const migrationNamesRegistered = migrations.map((migration) => migration.nombre);

    return {
      migrations: {
        registered: migrations,
        latest: migrationNamesRegistered.at(-1) || null
      },
      schema: { tables, columns },
      commercial: {
        venta: await summary(
          `SELECT COUNT(*) count, COALESCE(SUM(idVenta), 0) idSum,
                  COALESCE(SUM(subtotal), 0) subtotal,
                  COALESCE(SUM(descuento), 0) discount,
                  COALESCE(SUM(total), 0) total,
                  COALESCE(SUM(montoPagado), 0) paid,
                  COALESCE(SUM(saldoPendiente), 0) pending
           FROM venta`
        ),
        detalleVenta: await summary(
          `SELECT COUNT(*) count, COALESCE(SUM(idDetalleVenta), 0) idSum,
                  COALESCE(SUM(cantidad), 0) quantity,
                  COALESCE(SUM(cantidadEquivalenteUnidades), 0) baseUnits,
                  COALESCE(SUM(subtotal), 0) subtotal,
                  COALESCE(SUM(subtotalCosto), 0) cost,
                  COALESCE(SUM(ganancia), 0) profit
           FROM detalleVenta`
        ),
        pagoVenta: await summary(
          `SELECT COUNT(*) count, COALESCE(SUM(idPagoVenta), 0) idSum,
                  COALESCE(SUM(monto), 0) amount,
                  COALESCE(SUM(montoRecibido), 0) received,
                  COALESCE(SUM(cambio), 0) changeAmount
           FROM pagoVenta`
        ),
        fiado: await summary(
          `SELECT COUNT(*) count, COALESCE(SUM(idFiado), 0) idSum,
                  COALESCE(SUM(totalFiado), 0) total,
                  COALESCE(SUM(totalPagado), 0) paid,
                  COALESCE(SUM(saldoPendiente), 0) pending,
                  COALESCE(SUM(activo), 0) active
           FROM fiado`
        ),
        pagoFiado: await summary(
          `SELECT COUNT(*) count, COALESCE(SUM(idPagoFiado), 0) idSum,
                  COALESCE(SUM(monto), 0) amount
           FROM pagoFiado`
        ),
        cobroFiado: await summary(
          `SELECT COUNT(*) count, COALESCE(SUM(idCobroFiado), 0) idSum,
                  COALESCE(SUM(montoTotal), 0) total,
                  COALESCE(SUM(montoRecibido), 0) received,
                  COALESCE(SUM(cambio), 0) changeAmount
           FROM cobroFiado`
        ),
        producto: await summary(
          `SELECT COUNT(*) count, COALESCE(SUM(idProducto), 0) idSum,
                  COALESCE(SUM(stock), 0) stock,
                  COALESCE(SUM(stockUnidadesTotal), 0) baseStock,
                  COALESCE(SUM(activo), 0) active
           FROM producto`
        ),
        movimientoStock: await summary(
          `SELECT COUNT(*) count, COALESCE(SUM(idMovimientoStock), 0) idSum,
                  COALESCE(SUM(cantidad), 0) quantity,
                  COALESCE(SUM(stockAnterior), 0) previousStock,
                  COALESCE(SUM(stockPosterior), 0) resultingStock,
                  COALESCE(SUM(cantidadOperacion), 0) operationQuantity
           FROM movimientoStock`
        ),
        loteProducto: await summary(
          `SELECT COUNT(*) count, COALESCE(SUM(idLoteProducto), 0) idSum,
                  COALESCE(SUM(cantidadInicial), 0) initialQuantity,
                  COALESCE(SUM(cantidadRestante), 0) remainingQuantity
           FROM loteProducto`
        ),
        movimientoLote: await summary(
          `SELECT COUNT(*) count, COALESCE(SUM(idMovimientoLote), 0) idSum,
                  COALESCE(SUM(cantidad), 0) quantity,
                  COALESCE(SUM(cantidadAnterior), 0) previousQuantity,
                  COALESCE(SUM(cantidadPosterior), 0) resultingQuantity
           FROM movimientoLote`
        ),
        operacionCompensatoria: await summary(
          `SELECT COUNT(*) count,
                  COALESCE(SUM(idOperacionCompensatoria), 0) idSum
           FROM operacionCompensatoria`
        ),
        compensacionVenta: await summary(
          `SELECT COUNT(*) count, COALESCE(SUM(idCompensacionVenta), 0) idSum,
                  COALESCE(SUM(montoCompensado), 0) amount,
                  COALESCE(SUM(costoCompensado), 0) cost
           FROM compensacionVenta`
        ),
        detalleCompensacionVenta: await summary(
          `SELECT COUNT(*) count,
                  COALESCE(SUM(idDetalleCompensacionVenta), 0) idSum,
                  COALESCE(SUM(unidadesDevueltas), 0) returnedUnits,
                  COALESCE(SUM(montoCompensado), 0) amount,
                  COALESCE(SUM(costoCompensado), 0) cost
           FROM detalleCompensacionVenta`
        ),
        detalleCompensacionLote: await summary(
          `SELECT COUNT(*) count,
                  COALESCE(SUM(idDetalleCompensacionLote), 0) idSum,
                  COALESCE(SUM(unidadesDevueltas), 0) returnedUnits
           FROM detalleCompensacionLote`
        ),
        liquidacionCompensacionVenta: await summary(
          `SELECT COUNT(*) count,
                  COALESCE(SUM(idLiquidacionCompensacionVenta), 0) idSum,
                  COALESCE(SUM(montoCompensado), 0) amount,
                  COALESCE(SUM(montoReduccionDeudaPendiente), 0) debtReduction,
                  COALESCE(SUM(montoReembolsoPendiente), 0) refundPending
           FROM liquidacionCompensacionVenta`
        )
      },
      saleStates
    };
  } finally {
    await connection.end();
  }
}

async function scalar(connection, sql, params = []) {
  const [[row]] = await connection.query(sql, params);
  return Number(row.total || 0);
}

async function row(connection, sql, params = []) {
  const [rows] = await connection.query(sql, params);
  return rows[0] || null;
}

async function expectError(action, code, message) {
  let error = null;
  try {
    await action();
  } catch (caught) {
    error = caught;
  }
  assert(Boolean(error) && error.code === code, message);
  return error;
}

function operationKey(prefix) {
  return `${prefix}:${crypto.randomBytes(8).toString('hex')}`;
}

async function createStoreFixture(connection, suffix, planCode) {
  const now = '2026-07-24 10:00:00';
  const password = `Local-${crypto.randomBytes(12).toString('hex')}!`;
  const hash = await bcrypt.hash(password, 4);
  const [store] = await connection.query(
    `INSERT INTO tienda (nombre, slug, activo, estado, creadoEn, actualizadoEn)
     VALUES (?, ?, 1, 'activa', ?, ?)`,
    [`Tienda C2 ${suffix}`, `tienda-c2-${suffix}`, now, now]
  );
  const idTienda = Number(store.insertId);
  const username = `owner_c2_${suffix}`;
  const [administrator] = await connection.query(
    `INSERT INTO administrador
       (idTienda, usuario, password, rol, activo, versionSesion)
     VALUES (?, ?, ?, 'dueno_tienda', 1, 1)`,
    [idTienda, username, hash]
  );
  const idAdministrador = Number(administrator.insertId);
  const plan = await row(connection, 'SELECT idPlan FROM plan WHERE codigo=?', [planCode]);
  assert(plan, `Existe el plan ${planCode} para la fixture C2.`);
  await connection.query(
    `INSERT INTO suscripcionTienda
       (idTienda, idPlan, tipo, estado, fechaInicio, fechaFin,
        renovacionAutomatica, observacion, creadoPor, creadoEn, actualizadoEn)
     VALUES (?, ?, 'cortesia', 'activa', '2026-01-01 00:00:00',
             '2027-12-31 23:59:59', 0, 'Fixture C2', ?, ?, ?)`,
    [idTienda, plan.idPlan, idAdministrador, now, now]
  );
  await connection.query(
    `INSERT INTO configuracionCreditoTienda
       (idTienda, limiteCreditoDefault, diasCreditoDefault, diasAvisoVencimiento,
        politicaFiadoVencido, requiereTelefonoParaFiado, permiteFiadoSinFecha,
        codigoPaisWhatsApp, creadoEn, actualizadoEn, idAdministradorActualiza)
     VALUES (?, 100000, 30, 3, 'permitir', 0, 1, '591', ?, ?, ?)`,
    [idTienda, now, now, idAdministrador]
  );
  const [client] = await connection.query(
    `INSERT INTO cliente
       (idTienda, nombre, telefono, telefonoNormalizado, documentoIdentidad,
        documentoNormalizado, limiteCredito, permiteFiado, diasCreditoDefault,
        activo, creadoEn, actualizadoEn, idAdministradorCrea, idAdministradorActualiza)
     VALUES (?, ?, '70000000', '70000000', ?, ?, 100000, 1, 30, 1, ?, ?, ?, ?)`,
    [idTienda, `Cliente C2 ${suffix}`, `DOC-${suffix}`, `doc-${suffix}`,
      now, now, idAdministrador, idAdministrador]
  );
  return {
    idTienda,
    idAdministrador,
    idCliente: Number(client.insertId),
    username,
    password,
    planCode
  };
}

async function createProduct(connection, fixture, label, options = {}) {
  const stock = Number(options.stock ?? 30);
  const controlsLots = options.controlsLots ? 1 : 0;
  const controlsExpiration = options.controlsExpiration ? 1 : 0;
  const now = '2026-07-24 10:00:00';
  const [product] = await connection.query(
    `INSERT INTO producto
       (idTienda, nombre, categoria, unidadMedida, unidadesPorPaquete,
        paquetesPorCaja, precioVenta, precioVentaPaquete, stock, stockMinimo,
        controlaLotes, controlaVencimiento, diasAlertaVencimiento,
        lotesActivadosEn, fechaInicioSeguimiento, stockUnidadesTotal,
        ultimoPrecioCompra, permiteVentaPorPaquete, permiteVentaPorUnidad,
        favoritoPos, activo)
     VALUES (?, ?, 'otros', 'unidad', 1, 1, ?, NULL, ?, 1, ?, ?, ?, ?, ?, ?,
             ?, 0, 1, 0, 1)`,
    [fixture.idTienda, `Producto C2 ${label}`, options.price ?? 10,
      stock, controlsLots, controlsExpiration, controlsExpiration ? 30 : null,
      controlsLots ? now : null, now, stock, options.cost ?? 4]
  );
  return Number(product.insertId);
}

async function createLot(connection, fixture, idProducto, input) {
  const now = '2026-07-24 10:00:00';
  const key = operationKey('lot-c2');
  const [lot] = await connection.query(
    `INSERT INTO loteProducto
       (idTienda, idProducto, idProveedor, idDetalleCompra, codigoLote, origen,
        fechaIngreso, fechaVencimiento, cantidadInicial, cantidadRestante,
        costoUnitarioBase, estadoOperativo, claveOperacion, creadoEn,
        actualizadoEn, idAdministradorCrea, idAdministradorActualiza)
     VALUES (?, ?, NULL, NULL, ?, 'distribucion_inicial', ?, ?, ?, ?, ?,
             'disponible', ?, ?, ?, ?, ?)`,
    [fixture.idTienda, idProducto, input.code, now, input.expiration || null,
      input.quantity, input.quantity, input.cost ?? 4, key, now, now,
      fixture.idAdministrador, fixture.idAdministrador]
  );
  await connection.query(
    `INSERT INTO movimientoLote
       (idTienda, idProducto, idLoteProducto, idMovimientoStock, tipoRegistro,
        cantidad, cantidadAnterior, cantidadPosterior, claveOperacion,
        creadoEn, idAdministrador)
     VALUES (?, ?, ?, NULL, 'distribucion_inicial', ?, 0, ?, ?, ?, ?)`,
    [fixture.idTienda, idProducto, lot.insertId, input.quantity, input.quantity,
      operationKey('ml-c2'), now, fixture.idAdministrador]
  );
  return Number(lot.insertId);
}

async function loadSale(connection, fixture, idVenta) {
  const sale = await row(connection,
    'SELECT * FROM venta WHERE idTienda=? AND idVenta=?',
    [fixture.idTienda, idVenta]);
  const details = (await connection.query(
    'SELECT * FROM detalleVenta WHERE idTienda=? AND idVenta=? ORDER BY idDetalleVenta',
    [fixture.idTienda, idVenta]))[0];
  return { sale, details };
}

function partialBody(detail, units, treatment, key = operationKey('return-c2')) {
  return {
    confirmar: true,
    tipoCompensacion: 'devolucion_parcial',
    claveOperacion: key,
    motivoCodigo: 'devolucion_cliente',
    detalles: [{
      idDetalleVenta: detail.idDetalleVenta,
      unidadesDevueltas: units,
      tratamientoInventario: treatment
    }]
  };
}

function cancellationBody(treatment, key = operationKey('cancel-c2')) {
  return {
    confirmar: true,
    tipoCompensacion: 'anulacion_total',
    claveOperacion: key,
    motivoCodigo: 'operacion_duplicada',
    tratamientoInventario: treatment
  };
}

class HttpSession {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
    this.cookie = '';
  }

  async request(route, options = {}, secure = true) {
    const request = { ...options, headers: { ...(options.headers || {}) } };
    if (request.body && typeof request.body !== 'string') {
      request.headers['content-type'] = 'application/json';
      request.body = JSON.stringify(request.body);
    }
    if (secure) applyTestRequestSecurity(this.baseUrl, request);
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

async function expectHttp(session, route, options, status, message, secure = true) {
  const response = await session.request(route, options, secure);
  assert(response.status === status,
    `${message} responde HTTP ${status} (actual ${response.status}, codigo ${response.body?.code || 'sin_codigo'}).`);
  return response.body;
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

async function startTemporaryServer(databaseName) {
  const port = await freePort();
  const baseUrl = `http://localhost:${port}`;
  const child = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    cwd: ROOT,
    env: {
      ...restoreEnvironment(databaseName),
      PORT: String(port),
      SESSION_SECRET: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
      TRUSTED_ORIGINS: baseUrl,
      RATE_LIMIT_ENABLED: 'false'
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk.toString(); });
  child.stderr.on('data', (chunk) => { output += chunk.toString(); });
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`El servidor temporal termino antes de iniciar. ${safeError(output.slice(-2000))}`);
    }
    try {
      const response = await fetch(`${baseUrl}/health/ready`);
      if (response.status === 200) return { child, baseUrl };
    } catch {
      // The server may still be opening its listener.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  child.kill('SIGTERM');
  throw new Error('El servidor temporal no inicio dentro del plazo.');
}

function processHasStopped(child) {
  return !child || child.exitCode !== null || child.signalCode !== null;
}

async function stopTemporaryServer(child) {
  if (processHasStopped(child)) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    new Promise((resolve) => setTimeout(resolve, 10000))
  ]);
  if (!processHasStopped(child)) {
    child.kill('SIGKILL');
    await Promise.race([
      new Promise((resolve) => child.once('exit', resolve)),
      new Promise((resolve) => setTimeout(resolve, 2000))
    ]);
  }
}

function staticContract() {
  const files = [
    'database/migrations/015_compensaciones_venta_inventario.sql',
    'services/sale-compensation-service.js',
    'routes/sales-compensations.js'
  ].map((file) => fs.readFileSync(path.join(ROOT, file), 'utf8'));
  assert(files.every((content) => !/\bDELETE\s+FROM\b/i.test(content)),
    'C2 no contiene borrados fisicos.');
  assert(!/\bUPDATE\s+(venta|detalleVenta|pagoVenta|fiado)\b/i.test(files[0]),
    'La migracion 015 no reinterpreta operaciones comerciales.');
  assert(/requirePlanFeature\(COMPENSATION_FEATURE\)/.test(files[2]),
    'La API exige la funcionalidad de anulaciones operativas.');
  assert(!/\bidTienda\s*[:=]\s*req\.(body|query|params)/.test(files[2]),
    'La API nunca toma idTienda del cliente.');
}

async function main() {
  assertSafeRuntime();
  staticContract();
  const primaryEnvironment = { ...process.env };
  const primaryBefore = await primaryFingerprint(primaryEnvironment);
  assert(primaryBefore.migrations.registered.length > 0
    && primaryBefore.migrations.latest,
  'La prueba registra la version y huella iniciales de la base principal.');

  const temporaryDatabase = temporaryDatabaseName();
  const serverConnection = await createConnection(restoreEnvironment(), false);
  let temporaryConnection = null;
  let applicationPool = null;
  let temporaryServer = null;
  let temporaryServerProcess = null;
  try {
    await serverConnection.query(
      `CREATE DATABASE ${quoteTemporaryDatabase(temporaryDatabase)}
       CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
    temporaryConnection = await createConnection(restoreEnvironment(temporaryDatabase));
    await executeSql(temporaryConnection, schemaBeforeC2());
    await createMigrationRegistry(
      temporaryConnection,
      migrationNames('014_operaciones_compensatorias.sql')
    );
    await executeSql(
      temporaryConnection,
      fs.readFileSync(path.join(MIGRATIONS_DIR, MIGRATION_015), 'utf8')
    );
    const physicalCheckerOutput = runNodeScript(
      'scripts/check-sales-compensations.js', temporaryDatabase
    );
    assert(physicalCheckerOutput.includes('"state": "completa-no-registrada"')
      && physicalCheckerOutput.includes('"structureComplete": true')
      && physicalCheckerOutput.includes('"dataValid": true'),
    'La postcondicion fisica de 015 se valida antes de registrar la migracion.');
    await temporaryConnection.query(
      'INSERT INTO schema_migrations (nombre) VALUES (?)',
      [MIGRATION_015]
    );
    assert(await scalar(temporaryConnection,
      'SELECT COUNT(*) total FROM schema_migrations WHERE nombre=?', [MIGRATION_015]) === 1,
    'La migracion 015 se aplica solo en la base temporal.');
    const checkerOutput = runNodeScript('scripts/check-sales-compensations.js', temporaryDatabase);
    assert(checkerOutput.includes('"state": "post-migracion"'),
      'El comprobador C2 valida la estructura temporal post-015.');

    Object.assign(process.env, {
      APP_ENV: 'local',
      DB_HOST: 'localhost',
      DB_NAME: temporaryDatabase,
      DB_USER: restoreEnvironment().DB_USER,
      DB_PASSWORD: restoreEnvironment().DB_PASSWORD
    });
    const { registerSale } = require('../services/pos-sale-service');
    const {
      compensateSale,
      createSaleCompensationService
    } = require('../services/sale-compensation-service');
    applicationPool = require('../config/db');

    const fixtureA = await createStoreFixture(
      temporaryConnection, crypto.randomBytes(4).toString('hex'), 'avanzado'
    );
    const fixtureB = await createStoreFixture(
      temporaryConnection, crypto.randomBytes(4).toString('hex'), 'basico'
    );

    async function saleFor(fixture, idProducto, units, payments, idCliente = null) {
      const result = await registerSale({
        idTienda: fixture.idTienda,
        idAdministrador: fixture.idAdministrador,
        body: {
          claveOperacion: operationKey('sale-c2'),
          idCliente,
          items: [{ idProducto, cantidad: units, presentacion: 'unidad' }],
          pagos: payments
        }
      });
      return loadSale(temporaryConnection, fixture, result.idVenta);
    }

    const paidProduct = await createProduct(temporaryConnection, fixtureA, 'pagada', { stock: 20 });
    const paid = await saleFor(fixtureA, paidProduct, 2, [
      { metodoPago: 'qr', monto: 20, referencia: 'PAGO-C2' }
    ]);
    const paidSnapshot = JSON.stringify({
      sale: {
        total: paid.sale.total,
        montoPagado: paid.sale.montoPagado,
        saldoPendiente: paid.sale.saldoPendiente,
        estadoPago: paid.sale.estadoPago,
        tipo: paid.sale.tipo
      },
      details: paid.details
    });
    const paidPaymentsBefore = await scalar(temporaryConnection,
      'SELECT COUNT(*) total FROM pagoVenta WHERE idTienda=? AND idVenta=?',
      [fixtureA.idTienda, paid.sale.idVenta]);
    const paidOriginalMovement = await row(temporaryConnection,
      `SELECT * FROM movimientoStock
       WHERE idTienda=? AND idDetalleVenta=? AND origen='venta'`,
      [fixtureA.idTienda, paid.details[0].idDetalleVenta]);
    const paidResult = await compensateSale({
      idTienda: fixtureA.idTienda,
      idAdministrador: fixtureA.idAdministrador,
      idVenta: paid.sale.idVenta,
      body: cancellationBody('reintegrar_vendible')
    });
    assert(paidResult.estadoOperacionVenta === 'anulada'
      && paidResult.detalles[0].resultadoInventario === 'reintegrado_stock',
    'La anulacion total repone stock simple mediante un movimiento compensatorio.');
    assert(Number(paidResult.liquidacion.montoReembolsoPendiente) === 20
      && Number(paidResult.liquidacion.montoReduccionDeudaPendiente) === 0,
    'La venta pagada registra reembolso pendiente sin devolver dinero automaticamente.');
    assert(await scalar(temporaryConnection,
      'SELECT stockUnidadesTotal total FROM producto WHERE idTienda=? AND idProducto=?',
      [fixtureA.idTienda, paidProduct]) === 20,
    'El stock simple vuelve al saldo anterior.');
    const paidAfter = await loadSale(temporaryConnection, fixtureA, paid.sale.idVenta);
    assert(JSON.stringify({
      sale: {
        total: paidAfter.sale.total,
        montoPagado: paidAfter.sale.montoPagado,
        saldoPendiente: paidAfter.sale.saldoPendiente,
        estadoPago: paidAfter.sale.estadoPago,
        tipo: paidAfter.sale.tipo
      },
      details: paidAfter.details
    }) === paidSnapshot,
    'La venta y sus detalles originales permanecen inmutables salvo estadoOperacion.');
    assert(await scalar(temporaryConnection,
      'SELECT COUNT(*) total FROM pagoVenta WHERE idTienda=? AND idVenta=?',
      [fixtureA.idTienda, paid.sale.idVenta]) === paidPaymentsBefore,
    'Los pagos originales no se borran ni modifican.');
    const paidOriginalMovementAfter = await row(temporaryConnection,
      'SELECT * FROM movimientoStock WHERE idMovimientoStock=?',
      [paidOriginalMovement.idMovimientoStock]);
    assert(JSON.stringify(paidOriginalMovementAfter) === JSON.stringify(paidOriginalMovement),
      'El movimiento de stock original permanece inmutable.');

    const cumulativeProduct = await createProduct(
      temporaryConnection, fixtureA, 'acumulada', { stock: 20 }
    );
    const cumulativeSale = await saleFor(fixtureA, cumulativeProduct, 5, [
      { metodoPago: 'qr', monto: 50, referencia: 'ACUM-C2' }
    ]);
    const firstKey = operationKey('return-c2');
    const firstReturnBody = partialBody(
      cumulativeSale.details[0], 2, 'reintegrar_vendible', firstKey
    );
    const firstReturn = await compensateSale({
      idTienda: fixtureA.idTienda,
      idAdministrador: fixtureA.idAdministrador,
      idVenta: cumulativeSale.sale.idVenta,
      body: firstReturnBody
    });
    assert(firstReturn.estadoOperacionVenta === 'devuelta_parcial',
      'La primera devolucion mantiene la venta como devuelta parcial.');
    const repeated = await compensateSale({
      idTienda: fixtureA.idTienda,
      idAdministrador: fixtureA.idAdministrador,
      idVenta: cumulativeSale.sale.idVenta,
      body: firstReturnBody
    });
    assert(repeated.repetida === true
      && repeated.idOperacionCompensatoria === firstReturn.idOperacionCompensatoria,
    'La misma clave y huella devuelve el resultado ya aplicado.');
    await expectError(() => compensateSale({
      idTienda: fixtureA.idTienda,
      idAdministrador: fixtureA.idAdministrador,
      idVenta: cumulativeSale.sale.idVenta,
      body: partialBody(cumulativeSale.details[0], 1, 'no_reintegrar', firstKey)
    }), 'OPERATION_KEY_CONFLICT',
    'La misma clave con otra huella devuelve conflicto estable.');
    await expectError(() => compensateSale({
      idTienda: fixtureA.idTienda,
      idAdministrador: fixtureA.idAdministrador,
      idVenta: cumulativeSale.sale.idVenta,
      body: partialBody(cumulativeSale.details[0], 4, 'reintegrar_vendible')
    }), 'RETURN_EXCEEDS_SOLD_QUANTITY',
    'La devolucion acumulada nunca supera lo vendido.');
    const finalReturn = await compensateSale({
      idTienda: fixtureA.idTienda,
      idAdministrador: fixtureA.idAdministrador,
      idVenta: cumulativeSale.sale.idVenta,
      body: partialBody(cumulativeSale.details[0], 3, 'reintegrar_vendible')
    });
    assert(finalReturn.estadoOperacionVenta === 'anulada'
      && await scalar(temporaryConnection,
        `SELECT COALESCE(SUM(dcv.unidadesDevueltas),0) total
         FROM detalleCompensacionVenta dcv
         JOIN compensacionVenta cv
           ON cv.idTienda=dcv.idTienda
          AND cv.idCompensacionVenta=dcv.idCompensacionVenta
         WHERE cv.idTienda=? AND cv.idVenta=?`,
        [fixtureA.idTienda, cumulativeSale.sale.idVenta]) === 5,
    'La devolucion acumulada exacta anula la venta sin duplicar unidades.');

    for (const treatment of ['no_reintegrar', 'aislar_no_vendible']) {
      const product = await createProduct(
        temporaryConnection, fixtureA, treatment, { stock: 10 }
      );
      const sale = await saleFor(fixtureA, product, 2, [
        { metodoPago: 'qr', monto: 20, referencia: treatment }
      ]);
      const result = await compensateSale({
        idTienda: fixtureA.idTienda,
        idAdministrador: fixtureA.idAdministrador,
        idVenta: sale.sale.idVenta,
        body: cancellationBody(treatment)
      });
      const expectedResult = treatment === 'aislar_no_vendible'
        ? 'aislado_no_vendible' : 'no_reintegrado';
      assert(result.detalles[0].resultadoInventario === expectedResult
        && await scalar(temporaryConnection,
          'SELECT stockUnidadesTotal total FROM producto WHERE idTienda=? AND idProducto=?',
          [fixtureA.idTienda, product]) === 8,
      `${treatment} conserva el stock vendible sin reposicion automatica.`);
    }

    const lotProduct = await createProduct(temporaryConnection, fixtureA, 'lote-vigente', {
      stock: 5,
      controlsLots: true,
      controlsExpiration: true
    });
    const originalLot = await createLot(temporaryConnection, fixtureA, lotProduct, {
      code: 'LOTE-C2-VIGENTE',
      quantity: 5,
      expiration: '2027-12-31',
      cost: 3.5
    });
    const lotSale = await saleFor(fixtureA, lotProduct, 3, [
      { metodoPago: 'qr', monto: 30, referencia: 'LOTE-VIGENTE' }
    ]);
    const originalLotExit = await row(temporaryConnection,
      `SELECT ml.*
       FROM movimientoLote ml
       JOIN movimientoStock ms
         ON ms.idTienda=ml.idTienda
        AND ms.idMovimientoStock=ml.idMovimientoStock
       WHERE ms.idTienda=? AND ms.idDetalleVenta=? AND ml.cantidad<0`,
      [fixtureA.idTienda, lotSale.details[0].idDetalleVenta]);
    const lotReturn = await compensateSale({
      idTienda: fixtureA.idTienda,
      idAdministrador: fixtureA.idAdministrador,
      idVenta: lotSale.sale.idVenta,
      body: partialBody(lotSale.details[0], 2, 'reintegrar_vendible')
    });
    assert(lotReturn.detalles[0].resultadoInventario === 'reintegrado_lote_original'
      && await scalar(temporaryConnection,
        'SELECT cantidadRestante total FROM loteProducto WHERE idLoteProducto=?',
        [originalLot]) === 4,
    'Una devolucion vendible vuelve al lote original vigente.');
    const originalLotExitAfter = await row(temporaryConnection,
      'SELECT * FROM movimientoLote WHERE idMovimientoLote=?',
      [originalLotExit.idMovimientoLote]);
    assert(JSON.stringify(originalLotExitAfter) === JSON.stringify(originalLotExit),
      'El consumo FEFO/FIFO original permanece inmutable.');
    assert(await scalar(temporaryConnection,
      `SELECT COUNT(*) total
       FROM detalleCompensacionLote dcl
       WHERE dcl.idTienda=? AND dcl.idMovimientoLoteSalida=?
         AND dcl.idLoteProductoOrigen=?`,
      [fixtureA.idTienda, originalLotExit.idMovimientoLote, originalLot]) === 1,
    'La compensacion conserva el vinculo con el consumo de lote original.');
    const lotStockBeforeNoReturn = await scalar(temporaryConnection,
      'SELECT stockUnidadesTotal total FROM producto WHERE idTienda=? AND idProducto=?',
      [fixtureA.idTienda, lotProduct]);
    const lotBalanceBeforeNoReturn = await scalar(temporaryConnection,
      'SELECT cantidadRestante total FROM loteProducto WHERE idLoteProducto=?',
      [originalLot]);
    const lotNoReturn = await compensateSale({
      idTienda: fixtureA.idTienda,
      idAdministrador: fixtureA.idAdministrador,
      idVenta: lotSale.sale.idVenta,
      body: partialBody(lotSale.details[0], 1, 'no_reintegrar')
    });
    assert(lotNoReturn.detalles[0].resultadoInventario === 'no_reintegrado'
      && await scalar(temporaryConnection,
        'SELECT stockUnidadesTotal total FROM producto WHERE idTienda=? AND idProducto=?',
        [fixtureA.idTienda, lotProduct]) === lotStockBeforeNoReturn
      && await scalar(temporaryConnection,
        'SELECT cantidadRestante total FROM loteProducto WHERE idLoteProducto=?',
        [originalLot]) === lotBalanceBeforeNoReturn,
    'No reintegrar un producto con lote conserva stock y saldo de lote sin cambios.');

    const expiringProduct = await createProduct(temporaryConnection, fixtureA, 'lote-vencido', {
      stock: 4,
      controlsLots: true,
      controlsExpiration: true
    });
    const expiringLot = await createLot(temporaryConnection, fixtureA, expiringProduct, {
      code: 'LOTE-C2-VENCE',
      quantity: 4,
      expiration: '2026-07-24',
      cost: 5
    });
    const expiringSale = await saleFor(fixtureA, expiringProduct, 2, [
      { metodoPago: 'qr', monto: 20, referencia: 'LOTE-VENCE' }
    ]);
    const futureService = createSaleCompensationService({
      pool: applicationPool,
      now: () => new Date('2026-07-25T12:00:00-04:00')
    });
    const isolatedLotReturn = await futureService.compensateSale({
      idTienda: fixtureA.idTienda,
      idAdministrador: fixtureA.idAdministrador,
      idVenta: expiringSale.sale.idVenta,
      body: cancellationBody('reintegrar_vendible')
    });
    assert(isolatedLotReturn.detalles[0].resultadoInventario === 'aislado_lote_tecnico',
      'La mercancia vencida nunca vuelve automaticamente a stock vendible.');
    const technicalLot = await row(temporaryConnection,
      `SELECT destino.estadoOperativo, destino.origen, destino.fechaVencimiento,
              destino.costoUnitarioBase, origen.fechaVencimiento origenVencimiento,
              origen.costoUnitarioBase origenCosto
       FROM detalleCompensacionLote dcl
       JOIN loteProducto destino
         ON destino.idTienda=dcl.idTienda
        AND destino.idProducto=dcl.idProducto
        AND destino.idLoteProducto=dcl.idLoteProductoDestino
       JOIN loteProducto origen
         ON origen.idTienda=dcl.idTienda
        AND origen.idProducto=dcl.idProducto
        AND origen.idLoteProducto=dcl.idLoteProductoOrigen
       WHERE dcl.idTienda=? AND dcl.idLoteProductoOrigen=?`,
      [fixtureA.idTienda, expiringLot]);
    assert(technicalLot.estadoOperativo === 'bloqueado'
      && technicalLot.origen === 'reversion'
      && String(technicalLot.fechaVencimiento).slice(0, 10)
        === String(technicalLot.origenVencimiento).slice(0, 10)
      && Number(technicalLot.costoUnitarioBase) === Number(technicalLot.origenCosto),
    'El lote tecnico bloqueado conserva costo y vencimiento historicos.');
    assert(await scalar(temporaryConnection,
      `SELECT
         (SELECT stockUnidadesTotal FROM producto
          WHERE idTienda=? AND idProducto=?)
         -
         (SELECT COALESCE(SUM(cantidadRestante),0) FROM loteProducto
          WHERE idTienda=? AND idProducto=? AND estadoOperativo<>'anulado') total`,
      [fixtureA.idTienda, expiringProduct, fixtureA.idTienda, expiringProduct]) === 0,
    'El stock general y los lotes permanecen conciliados tras aislar la devolucion.');

    const debtProduct = await createProduct(temporaryConnection, fixtureA, 'fiado', { stock: 10 });
    const debtSale = await saleFor(
      fixtureA, debtProduct, 3, [], fixtureA.idCliente
    );
    const debtFiadoBefore = await row(temporaryConnection,
      'SELECT * FROM fiado WHERE idTienda=? AND idVenta=?',
      [fixtureA.idTienda, debtSale.sale.idVenta]);
    const debtResult = await compensateSale({
      idTienda: fixtureA.idTienda,
      idAdministrador: fixtureA.idAdministrador,
      idVenta: debtSale.sale.idVenta,
      body: cancellationBody('no_reintegrar')
    });
    assert(Number(debtResult.liquidacion.montoReduccionDeudaPendiente) === 30
      && Number(debtResult.liquidacion.montoReembolsoPendiente) === 0,
    'La venta fiada registra reduccion de deuda pendiente sin crear saldo negativo.');
    const debtFiadoAfter = await row(temporaryConnection,
      'SELECT * FROM fiado WHERE idTienda=? AND idVenta=?',
      [fixtureA.idTienda, debtSale.sale.idVenta]);
    assert(JSON.stringify(debtFiadoAfter) === JSON.stringify(debtFiadoBefore),
      'C2 no sobrescribe el fiado original; su liquidacion queda pendiente para C3.');

    const mixedProduct = await createProduct(temporaryConnection, fixtureA, 'mixta', { stock: 10 });
    const mixedSale = await saleFor(fixtureA, mixedProduct, 4, [
      { metodoPago: 'qr', monto: 15, referencia: 'MIXTA-C2' }
    ], fixtureA.idCliente);
    const mixedResult = await compensateSale({
      idTienda: fixtureA.idTienda,
      idAdministrador: fixtureA.idAdministrador,
      idVenta: mixedSale.sale.idVenta,
      body: cancellationBody('no_reintegrar')
    });
    assert(Number(mixedResult.liquidacion.montoReduccionDeudaPendiente) === 25
      && Number(mixedResult.liquidacion.montoReembolsoPendiente) === 15,
    'La venta mixta separa deuda y reembolso pendientes sin automatizar ninguno.');

    const rollbackProduct = await createProduct(
      temporaryConnection, fixtureA, 'rollback', { stock: 10 }
    );
    const rollbackSale = await saleFor(fixtureA, rollbackProduct, 2, [
      { metodoPago: 'qr', monto: 20, referencia: 'ROLLBACK-C2' }
    ]);
    const rollbackKey = operationKey('rollback-c2');
    const rollbackService = createSaleCompensationService({
      pool: applicationPool,
      afterInventory: async () => {
        const error = new Error('Fallo de prueba posterior al inventario.');
        error.code = 'TEST_AFTER_INVENTORY_FAILURE';
        throw error;
      }
    });
    await expectError(() => rollbackService.compensateSale({
      idTienda: fixtureA.idTienda,
      idAdministrador: fixtureA.idAdministrador,
      idVenta: rollbackSale.sale.idVenta,
      body: cancellationBody('reintegrar_vendible', rollbackKey)
    }), 'TEST_AFTER_INVENTORY_FAILURE',
    'Un fallo posterior al inventario revierte toda la transaccion.');
    assert(await scalar(temporaryConnection,
      'SELECT stockUnidadesTotal total FROM producto WHERE idTienda=? AND idProducto=?',
      [fixtureA.idTienda, rollbackProduct]) === 8
      && await scalar(temporaryConnection,
        'SELECT COUNT(*) total FROM operacionCompensatoria WHERE idTienda=? AND claveOperacion=?',
        [fixtureA.idTienda, rollbackKey]) === 0
      && (await row(temporaryConnection,
        'SELECT estadoOperacion FROM venta WHERE idTienda=? AND idVenta=?',
        [fixtureA.idTienda, rollbackSale.sale.idVenta])).estadoOperacion === 'vigente',
    'El rollback no deja operacion, stock ni estado parcial.');

    const concurrentProduct = await createProduct(
      temporaryConnection, fixtureA, 'concurrencia', { stock: 5 }
    );
    const concurrentSale = await saleFor(fixtureA, concurrentProduct, 1, [
      { metodoPago: 'qr', monto: 10, referencia: 'CONCURRENT-C2' }
    ]);
    const concurrentRequests = await Promise.allSettled([
      compensateSale({
        idTienda: fixtureA.idTienda,
        idAdministrador: fixtureA.idAdministrador,
        idVenta: concurrentSale.sale.idVenta,
        body: partialBody(concurrentSale.details[0], 1, 'reintegrar_vendible')
      }),
      compensateSale({
        idTienda: fixtureA.idTienda,
        idAdministrador: fixtureA.idAdministrador,
        idVenta: concurrentSale.sale.idVenta,
        body: partialBody(concurrentSale.details[0], 1, 'reintegrar_vendible')
      })
    ]);
    const concurrentSummary = concurrentRequests.map((item) => (
      item.status === 'fulfilled' ? 'fulfilled' : `rejected:${item.reason?.code || 'ERROR'}`
    )).join(',');
    assert(concurrentRequests.filter((item) => item.status === 'fulfilled').length === 1
      && concurrentRequests.filter((item) => item.status === 'rejected'
        && ['SALE_ALREADY_CANCELLED', 'SALE_ALREADY_FULLY_COMPENSATED']
          .includes(item.reason?.code)).length === 1,
    `Dos compensaciones concurrentes no devuelven la misma unidad dos veces (${concurrentSummary}).`);

    const apiProductA = await createProduct(temporaryConnection, fixtureA, 'api-a', { stock: 5 });
    const apiSaleA = await saleFor(fixtureA, apiProductA, 1, [
      { metodoPago: 'qr', monto: 10, referencia: 'API-A' }
    ]);
    const apiProductB = await createProduct(temporaryConnection, fixtureB, 'api-b', { stock: 5 });
    const apiSaleB = await saleFor(fixtureB, apiProductB, 1, [
      { metodoPago: 'qr', monto: 10, referencia: 'API-B' }
    ]);
    const superPassword = `Super-${crypto.randomBytes(12).toString('hex')}!`;
    const superUsername = `super_c2_${crypto.randomBytes(4).toString('hex')}`;
    await temporaryConnection.query(
      `INSERT INTO administrador
         (idTienda, usuario, password, rol, activo, versionSesion)
       VALUES (NULL, ?, ?, 'superadmin', 1, 1)`,
      [superUsername, await bcrypt.hash(superPassword, 4)]
    );

    temporaryServer = await startTemporaryServer(temporaryDatabase);
    temporaryServerProcess = temporaryServer.child;
    const sessionA = new HttpSession(temporaryServer.baseUrl);
    const sessionB = new HttpSession(temporaryServer.baseUrl);
    const superSession = new HttpSession(temporaryServer.baseUrl);
    const anonymous = new HttpSession(temporaryServer.baseUrl);
    await expectHttp(sessionA, '/auth/login', {
      method: 'POST',
      body: { usuario: fixtureA.username, password: fixtureA.password }
    }, 200, 'El propietario avanzado inicia sesion');
    await expectHttp(sessionB, '/auth/login', {
      method: 'POST',
      body: { usuario: fixtureB.username, password: fixtureB.password }
    }, 200, 'El propietario basico inicia sesion');
    await expectHttp(superSession, '/auth/login', {
      method: 'POST',
      body: { usuario: superUsername, password: superPassword }
    }, 200, 'El superadministrador inicia sesion');
    await expectHttp(anonymous,
      `/api/ventas/${apiSaleA.sale.idVenta}/compensaciones`,
      { method: 'POST', body: cancellationBody('no_reintegrar') },
      401, 'Una sesion anonima no ejecuta compensaciones');
    await expectHttp(superSession,
      `/api/ventas/${apiSaleA.sale.idVenta}/compensaciones`,
      { method: 'POST', body: cancellationBody('no_reintegrar') },
      403, 'El superadministrador sin tenant no ejecuta compensaciones');
    await expectHttp(sessionA,
      `/api/ventas/${apiSaleA.sale.idVenta}/compensaciones`,
      { method: 'POST', body: cancellationBody('no_reintegrar') },
      403, 'Una escritura sin proteccion de origen/CSRF queda bloqueada',
      false);
    await expectHttp(sessionB,
      `/api/ventas/${apiSaleA.sale.idVenta}/compensaciones`,
      { method: 'POST', body: cancellationBody('no_reintegrar') },
      404, 'Una tienda no compensa ventas de otra');

    await temporaryConnection.query(
      `UPDATE planFuncionalidad pf
       JOIN plan p ON p.idPlan=pf.idPlan
       JOIN funcionalidad f ON f.idFuncionalidad=pf.idFuncionalidad
       SET pf.habilitada=0
       WHERE p.codigo='basico' AND f.codigo='anulaciones_operativas'`
    );
    await expectHttp(sessionB,
      `/api/ventas/${apiSaleB.sale.idVenta}/compensaciones`,
      { method: 'POST', body: cancellationBody('no_reintegrar') },
      403, 'Un plan sin la funcionalidad no ejecuta compensaciones');
    const apiApplied = await expectHttp(sessionA,
      `/api/ventas/${apiSaleA.sale.idVenta}/compensaciones`,
      { method: 'POST', body: cancellationBody('no_reintegrar') },
      201, 'La ruta canonica aplica una compensacion autorizada');
    assert(apiApplied.estadoOperacionVenta === 'anulada',
      'La respuesta API refleja la anulacion aplicada.');

    await stopTemporaryServer(temporaryServer.child);
    temporaryServer = null;

    const finalCheckerOutput = runNodeScript(
      'scripts/check-sales-compensations.js', temporaryDatabase
    );
    assert(finalCheckerOutput.includes('"dataValid": true'),
      'El comprobador C2 valida los datos generados por todas las pruebas.');
    assert(await scalar(temporaryConnection,
      `SELECT COUNT(*) total
       FROM detalleCompensacionVenta dcv
       JOIN compensacionVenta cv
         ON cv.idTienda=dcv.idTienda
        AND cv.idCompensacionVenta=dcv.idCompensacionVenta
       WHERE dcv.unidadesDevueltas<=0`) === 0,
    'No existen devoluciones nulas o negativas.');
  } finally {
    if (temporaryServer) await stopTemporaryServer(temporaryServer.child);
    if (applicationPool) await applicationPool.end();
    if (temporaryConnection) await temporaryConnection.end();
    await serverConnection.query(`DROP DATABASE IF EXISTS ${quoteTemporaryDatabase(temporaryDatabase)}`);
    const [remaining] = await serverConnection.query(
      `SELECT SCHEMA_NAME
       FROM information_schema.SCHEMATA
       WHERE SCHEMA_NAME LIKE 'tmp\\_tienda\\_restore\\_%' ESCAPE '\\\\'`
    );
    assert(remaining.length === 0, 'No quedan bases temporales de C2 o restauracion.');
    await serverConnection.end();
  }

  const primaryAfter = await primaryFingerprint(primaryEnvironment);
  assert(JSON.stringify(primaryAfter) === JSON.stringify(primaryBefore),
    'La base principal conserva exactamente su version, estructura y datos.');
  assert(processHasStopped(temporaryServerProcess),
    'No quedan procesos de servidor temporales de C2.');
}

main().catch((error) => {
  console.error('Fallo test:sales-compensations.');
  console.error(safeError(error));
  process.exit(1);
});
