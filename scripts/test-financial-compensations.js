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
const { inspectFinancialCompensations } = require('./check-financial-compensations');

const ROOT = path.join(__dirname, '..');
const SCHEMA_FILE = path.join(ROOT, 'database', 'tienda_abarrotes.sql');
const MIGRATIONS_DIR = path.join(ROOT, 'database', 'migrations');
const MIGRATION_016 = '016_compensaciones_financieras.sql';
const TEMP_PREFIX = 'tmp_tienda_restore_';
const PRIMARY_DATABASE = 'tienda_abarrotes_pruebas';
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
    .replace(
      /(password|contrasena|cookie|session_secret|db_ssl_ca|token|hash)\s*[:=]\s*\S+/gi,
      '$1=[REDACTED]'
    );
}

function assertSafeRuntime() {
  const environment = String(process.env.APP_ENV || '').trim().toLowerCase();
  const host = String(process.env.DB_HOST || '').trim().toLowerCase();
  const database = String(process.env.DB_NAME || '').trim().toLowerCase();
  if (!['local', 'test'].includes(environment) || isProductionEnvironment(process.env)) {
    throw new Error('test:financial-compensations solo se permite en APP_ENV local o test.');
  }
  if (host !== 'localhost' || database !== PRIMARY_DATABASE) {
    throw new Error(
      `test:financial-compensations exige localhost/${PRIMARY_DATABASE}.`
    );
  }
  if (!String(process.env.BACKUP_RESTORE_USER || '').trim()
    || !String(process.env.BACKUP_RESTORE_PASSWORD || '')) {
    throw new Error(
      'Configure el usuario local limitado a tmp_tienda_restore_%.*.'
    );
  }
}

function temporaryDatabaseName() {
  return `${TEMP_PREFIX}${crypto.randomBytes(6).toString('hex')}`;
}

function assertTemporaryDatabase(name) {
  const normalized = String(name || '').trim().toLowerCase();
  if (!/^tmp_tienda_restore_[a-f0-9]{12}$/.test(normalized)
    || PROTECTED_DATABASES.has(normalized)) {
    throw new Error('La guarda de C3 rechazo la base temporal.');
  }
  return normalized;
}

function quoteDatabase(name) {
  return `\`${assertTemporaryDatabase(name)}\``;
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

function readStatements(sql) {
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

async function executeSql(connection, sql) {
  for (const statement of readStatements(sql)) await connection.query(statement);
}

function schemaBeforeC3() {
  return fs.readFileSync(SCHEMA_FILE, 'utf8').replace(
    /-- COMPENSATION_FINANCIAL_[A-Z_]+_START[\s\S]*?-- COMPENSATION_FINANCIAL_[A-Z_]+_END/g,
    ''
  );
}

function migrationNames(limit) {
  return fs.readdirSync(MIGRATIONS_DIR)
    .filter((name) => /^\d{3}_.+\.sql$/i.test(name) && name <= limit)
    .sort();
}

async function createMigrationRegistry(connection) {
  await connection.query(
    `CREATE TABLE schema_migrations (
       nombre VARCHAR(255) PRIMARY KEY,
       aplicadaEn DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
     ) ENGINE=InnoDB`
  );
  for (const name of migrationNames('015_compensaciones_venta_inventario.sql')) {
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
    throw new Error(
      `${script} fallo en la base temporal.\n`
      + safeError(`${result.stdout || ''}\n${result.stderr || ''}`.slice(-5000))
    );
  }
  return result.stdout;
}

async function scalar(connection, sql, params = []) {
  const [[result]] = await connection.query(sql, params);
  return Number(result.total);
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
  assert(error?.code === code, message);
}

function key(prefix) {
  return `${prefix}:${crypto.randomBytes(8).toString('hex')}`;
}

async function primaryFingerprint(environment = process.env) {
  const connection = await createConnection(environment);
  try {
    const [migrations] = await connection.query(
      'SELECT nombre FROM schema_migrations ORDER BY nombre'
    );
    const summary = async (table, fields) => row(
      connection,
      `SELECT COUNT(*) cantidad, ${fields} FROM ${table}`
    );
    return {
      migrations: migrations.map((item) => item.nombre),
      venta: await summary(
        'venta',
        'COALESCE(SUM(total),0) total, COALESCE(SUM(montoPagado),0) pagado, COALESCE(SUM(saldoPendiente),0) saldo'
      ),
      pagoVenta: await summary('pagoVenta', 'COALESCE(SUM(monto),0) monto'),
      fiado: await summary(
        'fiado',
        'COALESCE(SUM(totalFiado),0) total, COALESCE(SUM(totalPagado),0) pagado, COALESCE(SUM(saldoPendiente),0) saldo'
      ),
      pagoFiado: await summary('pagoFiado', 'COALESCE(SUM(monto),0) monto'),
      cobroFiado: await summary('cobroFiado', 'COALESCE(SUM(montoTotal),0) monto')
    };
  } finally {
    await connection.end();
  }
}

async function createFixture(connection, planCode) {
  const suffix = crypto.randomBytes(4).toString('hex');
  const now = '2026-07-24 10:00:00';
  const password = `Local-${crypto.randomBytes(12).toString('hex')}!`;
  const [store] = await connection.query(
    `INSERT INTO tienda (nombre, slug, activo, estado, creadoEn, actualizadoEn)
     VALUES (?, ?, 1, 'activa', ?, ?)`,
    [`Tienda C3 ${suffix}`, `tienda-c3-${suffix}`, now, now]
  );
  const idTienda = Number(store.insertId);
  const username = `owner_c3_${suffix}`;
  const [admin] = await connection.query(
    `INSERT INTO administrador
     (idTienda, usuario, password, rol, activo, versionSesion)
     VALUES (?, ?, ?, 'dueno_tienda', 1, 1)`,
    [idTienda, username, await bcrypt.hash(password, 4)]
  );
  const idAdministrador = Number(admin.insertId);
  const plan = await row(connection, 'SELECT idPlan FROM plan WHERE codigo=?', [planCode]);
  await connection.query(
    `INSERT INTO suscripcionTienda
     (idTienda, idPlan, tipo, estado, fechaInicio, fechaFin,
      renovacionAutomatica, observacion, creadoPor, creadoEn, actualizadoEn)
     VALUES (?, ?, 'cortesia', 'activa', '2026-01-01 00:00:00',
             '2027-12-31 23:59:59', 0, 'Fixture C3', ?, ?, ?)`,
    [idTienda, plan.idPlan, idAdministrador, now, now]
  );
  const [client] = await connection.query(
    `INSERT INTO cliente
     (idTienda, nombre, telefono, telefonoNormalizado, documentoIdentidad,
      documentoNormalizado, limiteCredito, permiteFiado, diasCreditoDefault,
      activo, creadoEn, actualizadoEn, idAdministradorCrea, idAdministradorActualiza)
     VALUES (?, ?, '70000000', '70000000', ?, ?, 100000, 1, 30,
             1, ?, ?, ?, ?)`,
    [idTienda, `Cliente C3 ${suffix}`, `DOC-${suffix}`, `doc-${suffix}`,
      now, now, idAdministrador, idAdministrador]
  );
  return {
    idTienda,
    idAdministrador,
    idCliente: Number(client.insertId),
    username,
    password
  };
}

async function createSale(connection, fixture, input) {
  const total = Number(input.total);
  const payments = input.payments || [];
  const paid = payments.reduce((sum, payment) => sum + Number(payment.monto), 0);
  const balance = total - paid;
  const state = balance === 0 ? 'pagada' : (paid > 0 ? 'parcial' : 'pendiente');
  const [sale] = await connection.query(
    `INSERT INTO venta
     (idTienda, fecha, subtotal, descuento, total, montoPagado,
      montoCompensado, saldoPendiente, estadoPago, estadoOperacion, tipo,
      idCliente, claveOperacion)
     VALUES (?, '2026-07-24 10:00:00', ?, 0, ?, ?, 0, ?, ?, 'vigente',
             ?, ?, ?)`,
    [fixture.idTienda, total, total, paid, balance, state,
      balance > 0 ? 'fiada' : 'pagada',
      balance > 0 ? fixture.idCliente : null, key('sale-c3')]
  );
  const idVenta = Number(sale.insertId);
  for (let index = 0; index < payments.length; index += 1) {
    const payment = payments[index];
    await connection.query(
      `INSERT INTO pagoVenta
       (idTienda, idVenta, idPagoFiado, metodoPago, monto, montoRecibido,
        cambio, referencia, claveOperacion, idAdministrador, creadoEn)
       VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, '2026-07-24 10:00:00')`,
      [fixture.idTienda, idVenta, payment.metodo, payment.monto,
        payment.metodo === 'efectivo' ? payment.recibido || payment.monto : null,
        payment.metodo === 'efectivo'
          ? Number(payment.recibido || payment.monto) - Number(payment.monto) : 0,
        payment.referencia || null, key('payment-c3'), fixture.idAdministrador]
    );
  }
  let idFiado = null;
  if (balance > 0) {
    const [debt] = await connection.query(
      `INSERT INTO fiado
       (idTienda, idCliente, idVenta, fechaInicio, fechaVencimiento,
        totalFiado, totalPagado, totalCompensado, saldoPendiente, estado,
        activo, cerradoEn, idAdministradorCrea)
       VALUES (?, ?, ?, '2026-07-24', '2026-08-24', ?, 0, 0, ?,
               'pendiente', 1, NULL, ?)`,
      [fixture.idTienda, fixture.idCliente, idVenta, balance, balance,
        fixture.idAdministrador]
    );
    idFiado = Number(debt.insertId);
  }
  return { idVenta, idFiado };
}

async function createPendingSettlement(connection, fixture, sale, amount, debt, refund) {
  const now = '2026-07-24 10:05:00';
  const [operation] = await connection.query(
    `INSERT INTO operacionCompensatoria
     (idTienda, tipoOperacion, estado, motivoCodigo, observacion,
      requiereAprobacion, idAdministradorSolicitante, idAdministradorAprobador,
      claveOperacion, huellaSolicitud, fechaSolicitud, fechaAprobacion,
      fechaAplicacion, creadoEn, actualizadoEn)
     VALUES (?, 'anulacion_venta', 'aplicada', 'devolucion_cliente', NULL,
             0, ?, NULL, ?, ?, ?, NULL, ?, ?, ?)`,
    [fixture.idTienda, fixture.idAdministrador, key('c2-operation'),
      crypto.createHash('sha256').update(key('fingerprint')).digest('hex'),
      now, now, now, now]
  );
  const [compensation] = await connection.query(
    `INSERT INTO compensacionVenta
     (idTienda, idOperacionCompensatoria, idVenta, tipoCompensacion,
      montoCompensado, costoCompensado, creadoEn)
     VALUES (?, ?, ?, 'anulacion_total', ?, 0, ?)`,
    [fixture.idTienda, operation.insertId, sale.idVenta, amount, now]
  );
  const [settlement] = await connection.query(
    `INSERT INTO liquidacionCompensacionVenta
     (idTienda, idCompensacionVenta, montoCompensado,
      montoReduccionDeudaPendiente, montoReembolsoPendiente, estado,
      creadoEn, resueltoEn)
     VALUES (?, ?, ?, ?, ?, 'pendiente_c3', ?, NULL)`,
    [fixture.idTienda, compensation.insertId, amount, debt, refund, now]
  );
  await connection.query(
    `UPDATE venta SET estadoOperacion='anulada'
     WHERE idTienda=? AND idVenta=?`,
    [fixture.idTienda, sale.idVenta]
  );
  return Number(settlement.insertId);
}

function settlementBody(operationKey = key('settlement-c3')) {
  return {
    confirmar: true,
    claveOperacion: operationKey,
    motivoCodigo: 'devolucion_cliente'
  };
}

async function createCollection(connection, fixture, debts, method = 'qr') {
  const amount = debts.reduce((sum, debt) => sum + debt.amount, 0);
  const now = '2026-07-24 11:00:00';
  const [collection] = await connection.query(
    `INSERT INTO cobroFiado
     (idTienda, idCliente, fechaCobro, montoTotal, metodoPago, montoRecibido,
      cambio, referencia, observacion, claveOperacion, creadoEn,
      idAdministrador, esLegado, estadoOperacion)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'COBRO-C3', NULL, ?, ?, ?, 0, 'vigente')`,
    [fixture.idTienda, fixture.idCliente, now, amount, method,
      method === 'efectivo' ? amount : null, 0, key('collection-c3'),
      now, fixture.idAdministrador]
  );
  for (let index = 0; index < debts.length; index += 1) {
    const item = debts[index];
    const debt = await row(
      connection,
      `SELECT totalPagado, totalCompensado, saldoPendiente
       FROM fiado WHERE idTienda=? AND idFiado=?`,
      [fixture.idTienda, item.idFiado]
    );
    const newPaid = Number(debt.totalPagado) + item.amount;
    const newBalance = Number(debt.saldoPendiente) - item.amount;
    const [payment] = await connection.query(
      `INSERT INTO pagoFiado
       (idTienda, idFiado, idCobroFiado, fechaPago, monto, observacion,
        claveDistribucion)
       VALUES (?, ?, ?, ?, ?, NULL, ?)`,
      [fixture.idTienda, item.idFiado, collection.insertId, now,
        item.amount, key('distribution-c3')]
    );
    await connection.query(
      `UPDATE fiado SET totalPagado=?, saldoPendiente=?, estado=?, cerradoEn=?
       WHERE idTienda=? AND idFiado=?`,
      [newPaid, newBalance, newBalance === 0 ? 'pagado' : 'parcial',
        newBalance === 0 ? now : null, fixture.idTienda, item.idFiado]
    );
    await connection.query(
      `INSERT INTO pagoVenta
       (idTienda, idVenta, idPagoFiado, metodoPago, monto, montoRecibido,
        cambio, referencia, claveOperacion, idAdministrador, creadoEn)
       VALUES (?, ?, ?, ?, ?, ?, 0, 'COBRO-C3', ?, ?, ?)`,
      [fixture.idTienda, item.idVenta, payment.insertId,
        ['efectivo', 'qr'].includes(method) ? method : 'no_especificado',
        item.amount, method === 'efectivo' ? item.amount : null,
        key('collection-sale-payment-c3'), fixture.idAdministrador, now]
    );
    const sale = await row(
      connection,
      'SELECT total, montoPagado, montoCompensado FROM venta WHERE idTienda=? AND idVenta=?',
      [fixture.idTienda, item.idVenta]
    );
    const paid = Number(sale.montoPagado) + item.amount;
    const balance = Math.max(0, Number(sale.total) - Number(sale.montoCompensado) - paid);
    await connection.query(
      `UPDATE venta SET montoPagado=?, saldoPendiente=?, estadoPago=?
       WHERE idTienda=? AND idVenta=?`,
      [paid, balance, balance === 0 ? 'pagada' : 'parcial',
        fixture.idTienda, item.idVenta]
    );
  }
  return Number(collection.insertId);
}

function collectionBody(type, operationKey = key('collection-comp-c3'), extra = {}) {
  return {
    confirmar: true,
    tipoCompensacion: type,
    claveOperacion: operationKey,
    motivoCodigo: type === 'correccion_metodo'
      ? 'error_metodo_pago' : 'operacion_duplicada',
    ...extra
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
    const response = await fetch(`${this.baseUrl}${route}`, {
      ...request,
      redirect: 'manual'
    });
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

async function startServer(databaseName) {
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
      throw new Error(`El servidor temporal no inicio. ${safeError(output.slice(-1500))}`);
    }
    try {
      const response = await fetch(`${baseUrl}/health/ready`);
      if (response.status === 200) return { child, baseUrl };
    } catch {
      // El listener todavia puede estar iniciando.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  child.kill('SIGTERM');
  throw new Error('El servidor temporal de C3 no inicio dentro del plazo.');
}

async function stopServer(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    new Promise((resolve) => setTimeout(resolve, 10000))
  ]);
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
}

function staticContract() {
  const migration = fs.readFileSync(
    path.join(MIGRATIONS_DIR, MIGRATION_016),
    'utf8'
  );
  const service = fs.readFileSync(
    path.join(ROOT, 'services', 'financial-compensation-service.js'),
    'utf8'
  );
  const route = fs.readFileSync(
    path.join(ROOT, 'routes', 'financial-compensations.js'),
    'utf8'
  );
  assert(!/\bDELETE\s+FROM\b/i.test(`${migration}\n${service}`),
    'C3 no contiene borrados fisicos.');
  assert(!/\bUPDATE\s+(pagoVenta|pagoFiado)\b/i.test(service),
    'Los pagos originales permanecen inmutables.');
  assert(/requirePlanFeature\(COMPENSATION_FEATURE\)/.test(route),
    'La API exige anulaciones_operativas.');
  assert(!/\bidTienda\s*[:=]\s*req\.(body|query|params)/.test(route),
    'La API toma la tienda exclusivamente del tenant autenticado.');
}

async function main() {
  assertSafeRuntime();
  staticContract();
  const primaryEnvironment = { ...process.env };
  const primaryBefore = await primaryFingerprint(primaryEnvironment);
  const temporaryDatabase = temporaryDatabaseName();
  const serverConnection = await createConnection(restoreEnvironment(), false);
  let connection = null;
  let applicationPool = null;
  let temporaryServer = null;
  try {
    await serverConnection.query(
      `CREATE DATABASE ${quoteDatabase(temporaryDatabase)}
       CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
    connection = await createConnection(restoreEnvironment(temporaryDatabase));
    await executeSql(connection, schemaBeforeC3());
    await connection.query(
      `INSERT INTO configuracionInventarioTienda
       (idTienda, periodoAnalisisDias, diasHistorialMinimo,
        diasReposicionDefault, diasCoberturaDefault, diasProductoNuevo,
        diasAlertaVencimientoDefault, creadoEn, actualizadoEn,
        idAdministradorActualiza)
       SELECT idTienda, 30, 14, 3, 14, 30, 30,
              '2026-07-24 10:00:00', '2026-07-24 10:00:00', NULL
       FROM tienda`
    );
    await createMigrationRegistry(connection);
    const migrationOutput = runNodeScript(
      'scripts/migrate-db.js',
      temporaryDatabase
    );
    assert(migrationOutput.includes(`Migracion aplicada: ${MIGRATION_016}`),
      'El migrador real aplica exclusivamente la 016 pendiente en la base temporal.');
    const postMigration = await inspectFinancialCompensations(connection);
    assert(postMigration.estado === 'post-migracion'
      && postMigration.estructuraCompleta && postMigration.datosValidos,
    'El comprobador C3 valida la base temporal post-016.');
    const checkerOutput = runNodeScript(
      'scripts/check-financial-compensations.js',
      temporaryDatabase
    );
    assert(checkerOutput.includes('"estado": "post-migracion"')
      && checkerOutput.includes('"datosValidos": true'),
    'db:check-financial-compensations valida la base temporal post-016.');

    Object.assign(process.env, {
      APP_ENV: 'local',
      DB_HOST: 'localhost',
      DB_NAME: temporaryDatabase,
      DB_USER: restoreEnvironment().DB_USER,
      DB_PASSWORD: restoreEnvironment().DB_PASSWORD
    });
    const {
      compensateDebtCollection,
      correctSalePaymentMethod,
      createFinancialCompensationService,
      resolveSaleSettlement
    } = require('../services/financial-compensation-service');
    const { collectSpecificDebt } = require('../services/debt-collection-service');
    applicationPool = require('../config/db');

    const advanced = await createFixture(connection, 'avanzado');
    const basic = await createFixture(connection, 'basico');

    const paidSale = await createSale(connection, advanced, {
      total: 30,
      payments: [
        { metodo: 'efectivo', monto: 10, recibido: 10 },
        { metodo: 'qr', monto: 20, referencia: 'QR-C3' }
      ]
    });
    const paidSettlement = await createPendingSettlement(
      connection, advanced, paidSale, 30, 0, 30
    );
    const paidResult = await resolveSaleSettlement({
      idTienda: advanced.idTienda,
      idAdministrador: advanced.idAdministrador,
      idLiquidacionCompensacionVenta: paidSettlement,
      body: settlementBody()
    });
    assert(paidResult.obligacionReembolso.estado === 'pendiente'
      && paidResult.obligacionReembolso.pagos.length === 2
      && paidResult.obligacionReembolso.pagos.reduce(
        (sum, payment) => sum + Number(payment.monto), 0
      ) === 30,
    'La venta pagada registra reembolso pendiente separado por metodo.');
    assert(await scalar(connection,
      'SELECT COUNT(*) total FROM pagoVenta WHERE idTienda=? AND idVenta=?',
      [advanced.idTienda, paidSale.idVenta]) === 2,
    'Resolver un reembolso no altera ni elimina pagos originales.');
    await expectError(() => correctSalePaymentMethod({
      idTienda: advanced.idTienda,
      idAdministrador: advanced.idAdministrador,
      idPagoVenta: paidResult.obligacionReembolso.pagos[0].idPagoVenta,
      body: {
        confirmar: true,
        claveOperacion: key('refund-linked-method-c3'),
        motivoCodigo: 'error_metodo_pago',
        metodoPagoDestino: 'no_especificado'
      }
    }), 'PAYMENT_COMMITTED_TO_REFUND',
    'Un pago comprometido en un reembolso no puede compensarse dos veces.');

    const debtSale = await createSale(connection, advanced, { total: 40 });
    const debtSettlement = await createPendingSettlement(
      connection, advanced, debtSale, 25, 25, 0
    );
    await resolveSaleSettlement({
      idTienda: advanced.idTienda,
      idAdministrador: advanced.idAdministrador,
      idLiquidacionCompensacionVenta: debtSettlement,
      body: settlementBody()
    });
    const reducedDebt = await row(
      connection,
      `SELECT totalFiado, totalPagado, totalCompensado, saldoPendiente
       FROM fiado WHERE idTienda=? AND idFiado=?`,
      [advanced.idTienda, debtSale.idFiado]
    );
    assert(Number(reducedDebt.totalCompensado) === 25
      && Number(reducedDebt.saldoPendiente) === 15,
    'La liquidacion reduce deuda parcialmente sin crear saldo negativo.');

    const mixedSale = await createSale(connection, advanced, {
      total: 50,
      payments: [{ metodo: 'qr', monto: 15, referencia: 'MIX-C3' }]
    });
    const mixedSettlement = await createPendingSettlement(
      connection, advanced, mixedSale, 50, 35, 15
    );
    const mixedKey = key('mixed-c3');
    const mixedBody = settlementBody(mixedKey);
    const mixedResult = await resolveSaleSettlement({
      idTienda: advanced.idTienda,
      idAdministrador: advanced.idAdministrador,
      idLiquidacionCompensacionVenta: mixedSettlement,
      body: mixedBody
    });
    const mixedRepeated = await resolveSaleSettlement({
      idTienda: advanced.idTienda,
      idAdministrador: advanced.idAdministrador,
      idLiquidacionCompensacionVenta: mixedSettlement,
      body: mixedBody
    });
    assert(Number(mixedResult.montoReduccionDeuda) === 35
      && Number(mixedResult.montoReembolso) === 15
      && mixedRepeated.repetida === true,
    'La venta mixta separa deuda y reembolso con idempotencia.');
    await expectError(() => resolveSaleSettlement({
      idTienda: advanced.idTienda,
      idAdministrador: advanced.idAdministrador,
      idLiquidacionCompensacionVenta: mixedSettlement,
      body: { ...mixedBody, motivoCodigo: 'error_cliente' }
    }), 'OPERATION_KEY_CONFLICT',
    'La misma clave con huella distinta devuelve conflicto.');

    const rollbackSale = await createSale(connection, advanced, { total: 20 });
    const rollbackSettlement = await createPendingSettlement(
      connection, advanced, rollbackSale, 20, 20, 0
    );
    const rollbackService = createFinancialCompensationService({
      pool: applicationPool,
      afterFinancialChanges: async () => {
        const error = new Error('Fallo controlado C3.');
        error.code = 'TEST_C3_ROLLBACK';
        throw error;
      }
    });
    await expectError(() => rollbackService.resolveSaleSettlement({
      idTienda: advanced.idTienda,
      idAdministrador: advanced.idAdministrador,
      idLiquidacionCompensacionVenta: rollbackSettlement,
      body: settlementBody()
    }), 'TEST_C3_ROLLBACK',
    'Un fallo posterior a los cambios financieros revierte toda la transaccion.');
    assert((await row(connection,
      `SELECT estado FROM liquidacionCompensacionVenta
       WHERE idLiquidacionCompensacionVenta=?`,
      [rollbackSettlement])).estado === 'pendiente_c3',
    'El rollback conserva la liquidacion pendiente sin cambios parciales.');

    const concurrentSale = await createSale(connection, advanced, { total: 10 });
    const concurrentSettlement = await createPendingSettlement(
      connection, advanced, concurrentSale, 10, 10, 0
    );
    const concurrentBody = settlementBody(key('concurrent-c3'));
    const concurrent = await Promise.all([
      resolveSaleSettlement({
        idTienda: advanced.idTienda,
        idAdministrador: advanced.idAdministrador,
        idLiquidacionCompensacionVenta: concurrentSettlement,
        body: concurrentBody
      }),
      resolveSaleSettlement({
        idTienda: advanced.idTienda,
        idAdministrador: advanced.idAdministrador,
        idLiquidacionCompensacionVenta: concurrentSettlement,
        body: concurrentBody
      })
    ]);
    assert(concurrent.filter((result) => result.repetida).length === 1,
      'Dos solicitudes concurrentes producen una aplicacion y una repeticion.');

    const collectionSaleA = await createSale(connection, advanced, { total: 30 });
    const collectionSaleB = await createSale(connection, advanced, { total: 20 });
    const idCobro = await createCollection(connection, advanced, [
      { ...collectionSaleA, amount: 20 },
      { ...collectionSaleB, amount: 10 }
    ], 'qr');
    const originalCollectionRows = {
      payments: await scalar(connection,
        'SELECT COUNT(*) total FROM pagoFiado WHERE idTienda=? AND idCobroFiado=?',
        [advanced.idTienda, idCobro]),
      salePayments: await scalar(connection,
        `SELECT COUNT(*) total FROM pagoVenta pv
         JOIN pagoFiado pf ON pf.idTienda=pv.idTienda AND pf.idPagoFiado=pv.idPagoFiado
         WHERE pf.idTienda=? AND pf.idCobroFiado=?`,
        [advanced.idTienda, idCobro])
    };
    const cancelKey = key('cancel-collection-c3');
    const cancelBody = collectionBody('anulacion_total', cancelKey);
    const cancelled = await compensateDebtCollection({
      idTienda: advanced.idTienda,
      idAdministrador: advanced.idAdministrador,
      idCobroFiado: idCobro,
      body: cancelBody
    });
    assert(cancelled.distribuciones.length === 2
      && cancelled.estadoOperacionCobro === 'compensado',
    'La anulacion del cobro revierte exactamente sus distribuciones.');
    assert(await scalar(connection,
      'SELECT COUNT(*) total FROM pagoFiado WHERE idTienda=? AND idCobroFiado=?',
      [advanced.idTienda, idCobro]) === originalCollectionRows.payments
      && await scalar(connection,
        `SELECT COUNT(*) total FROM pagoVenta pv
         JOIN pagoFiado pf ON pf.idTienda=pv.idTienda AND pf.idPagoFiado=pv.idPagoFiado
         WHERE pf.idTienda=? AND pf.idCobroFiado=?`,
        [advanced.idTienda, idCobro]) === originalCollectionRows.salePayments,
    'La anulacion conserva pagoFiado y pagoVenta originales.');
    const cancelledRepeated = await compensateDebtCollection({
      idTienda: advanced.idTienda,
      idAdministrador: advanced.idAdministrador,
      idCobroFiado: idCobro,
      body: cancelBody
    });
    assert(cancelledRepeated.repetida,
      'La anulacion de cobro es idempotente.');
    await collectSpecificDebt({
      idTienda: advanced.idTienda,
      idAdministrador: advanced.idAdministrador,
      idFiado: collectionSaleA.idFiado,
      body: {
        monto: 5,
        metodoPago: 'qr',
        claveOperacion: key('collection-after-compensation-c3')
      }
    });
    const recollectedSale = await row(
      connection,
      `SELECT montoPagado, montoCompensado, saldoPendiente
       FROM venta WHERE idTienda=? AND idVenta=?`,
      [advanced.idTienda, collectionSaleA.idVenta]
    );
    assert(Number(recollectedSale.montoPagado) === 5
      && Number(recollectedSale.montoCompensado) === 0
      && Number(recollectedSale.saldoPendiente) === 25,
    'Un cobro posterior excluye pagos de cobros compensados al reconciliar la venta.');

    const methodSale = await createSale(connection, advanced, { total: 20 });
    const methodCobro = await createCollection(connection, advanced, [
      { ...methodSale, amount: 10 }
    ], 'qr');
    const correctedCollection = await compensateDebtCollection({
      idTienda: advanced.idTienda,
      idAdministrador: advanced.idAdministrador,
      idCobroFiado: methodCobro,
      body: collectionBody('correccion_metodo', key('method-cobro-c3'), {
        metodoPagoDestino: 'efectivo',
        montoRecibidoDestino: 15
      })
    });
    assert(correctedCollection.metodoOriginal === 'qr'
      && correctedCollection.metodoDestino === 'efectivo'
      && Number(correctedCollection.cambioDestino) === 5
      && (await row(connection,
        'SELECT metodoPago FROM cobroFiado WHERE idCobroFiado=?',
        [methodCobro])).metodoPago === 'qr',
    'La correccion de metodo conserva el cobro original y su importe neto.');

    const directSale = await createSale(connection, advanced, {
      total: 12,
      payments: [{ metodo: 'qr', monto: 12 }]
    });
    const directPayment = await row(
      connection,
      'SELECT idPagoVenta FROM pagoVenta WHERE idTienda=? AND idVenta=?',
      [advanced.idTienda, directSale.idVenta]
    );
    await connection.query(
      `INSERT INTO cierreCaja
       (idTienda, idAdministrador, fechaInicio, fechaFin, claveOperacion)
       VALUES (?, ?, '2026-07-24 00:00:00', '2026-07-24 23:59:59', ?)`,
      [advanced.idTienda, advanced.idAdministrador, key('close-c3')]
    );
    const correctedPayment = await correctSalePaymentMethod({
      idTienda: advanced.idTienda,
      idAdministrador: advanced.idAdministrador,
      idPagoVenta: directPayment.idPagoVenta,
      body: {
        confirmar: true,
        claveOperacion: key('payment-method-c3'),
        motivoCodigo: 'error_metodo_pago',
        metodoPagoDestino: 'efectivo',
        montoRecibidoDestino: 20
      }
    });
    assert(correctedPayment.periodoOriginalCerrado
      && Number(correctedPayment.cambioDestino) === 8,
    'La correccion en periodo cerrado se registra hoy como movimiento compensatorio.');
    assert((await row(connection,
      'SELECT metodoPago FROM pagoVenta WHERE idPagoVenta=?',
      [directPayment.idPagoVenta])).metodoPago === 'qr',
    'La correccion nunca edita el metodo del pago original.');

    const pendingSale = await createSale(connection, advanced, { total: 10 });
    const pendingSettlement = await createPendingSettlement(
      connection, advanced, pendingSale, 5, 5, 0
    );
    await expectError(() => collectSpecificDebt({
      idTienda: advanced.idTienda,
      idAdministrador: advanced.idAdministrador,
      idFiado: pendingSale.idFiado,
      body: {
        monto: 1,
        metodoPago: 'qr',
        claveOperacion: key('blocked-collection-c3')
      }
    }), 'SALE_SETTLEMENT_PENDING',
    'Una liquidacion pendiente bloquea nuevos cobros incompatibles.');
    await expectError(() => resolveSaleSettlement({
      idTienda: basic.idTienda,
      idAdministrador: basic.idAdministrador,
      idLiquidacionCompensacionVenta: pendingSettlement,
      body: settlementBody()
    }), 'SALE_SETTLEMENT_NOT_FOUND',
    'Los identificadores manipulados no cruzan tiendas.');

    await connection.query(
      `UPDATE planFuncionalidad pf
       JOIN plan p ON p.idPlan=pf.idPlan
       JOIN funcionalidad f ON f.idFuncionalidad=pf.idFuncionalidad
       SET pf.habilitada=0
       WHERE p.codigo='basico' AND f.codigo='anulaciones_operativas'`
    );
    temporaryServer = await startServer(temporaryDatabase);
    const advancedSession = new HttpSession(temporaryServer.baseUrl);
    const basicSession = new HttpSession(temporaryServer.baseUrl);
    assert((await advancedSession.request('/auth/login', {
      method: 'POST',
      body: { usuario: advanced.username, password: advanced.password }
    })).status === 200, 'El propietario avanzado inicia sesion para C3.');
    assert((await basicSession.request('/auth/login', {
      method: 'POST',
      body: { usuario: basic.username, password: basic.password }
    })).status === 200, 'El propietario basico inicia sesion para C3.');
    const apiSale = await createSale(connection, advanced, { total: 8 });
    const apiSettlement = await createPendingSettlement(
      connection, advanced, apiSale, 8, 8, 0
    );
    const apiRoute = `/api/liquidaciones-compensacion/${apiSettlement}/resolver`;
    const noCsrf = await advancedSession.request(apiRoute, {
      method: 'POST',
      body: settlementBody()
    }, false);
    assert(noCsrf.status === 403
      && ['CSRF_VALIDATION_FAILED', 'ORIGIN_NOT_ALLOWED'].includes(noCsrf.body?.code),
    'La API C3 conserva la proteccion CSRF/origen.');
    const basicResponse = await basicSession.request(apiRoute, {
      method: 'POST',
      body: settlementBody()
    });
    assert(basicResponse.status === 403,
      'El plan sin anulaciones_operativas no ejecuta C3.');
    const advancedResponse = await advancedSession.request(apiRoute, {
      method: 'POST',
      body: settlementBody()
    });
    assert(advancedResponse.status === 201,
      'Tenant, suscripcion, permiso y CSRF validos permiten resolver C3.');

    const finalState = await inspectFinancialCompensations(connection);
    assert(finalState.estructuraCompleta && finalState.datosValidos,
      'Las invariantes financieras finales quedan conciliadas.');
    assert(await scalar(connection,
      `SELECT COUNT(*) total FROM fiado
       WHERE saldoPendiente<0 OR totalPagado+totalCompensado>totalFiado+0.01`) === 0,
    'Ningun fiado queda con saldo negativo.');
  } finally {
    await stopServer(temporaryServer?.child);
    if (applicationPool) await applicationPool.end();
    if (connection) await connection.end();
    await serverConnection.query(`DROP DATABASE IF EXISTS ${quoteDatabase(temporaryDatabase)}`);
    await serverConnection.end();
    const verification = await createConnection(restoreEnvironment(), false);
    try {
      assert(await scalar(
        verification,
        `SELECT COUNT(*) total FROM information_schema.SCHEMATA
         WHERE SCHEMA_NAME=?`,
        [temporaryDatabase]
      ) === 0, 'La base temporal C3 se elimina en finally.');
    } finally {
      await verification.end();
    }
    const primaryAfter = await primaryFingerprint(primaryEnvironment);
    assert(JSON.stringify(primaryAfter) === JSON.stringify(primaryBefore),
      'La base principal conserva exactamente su huella previa.');
  }
}

main().catch((error) => {
  console.error('Fallo la prueba de compensaciones financieras C3.');
  console.error(safeError(error));
  process.exit(1);
});
