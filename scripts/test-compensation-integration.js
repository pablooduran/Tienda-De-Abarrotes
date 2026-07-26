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
const {
  inspectCompensationIntegration
} = require('./check-compensation-integration');

const ROOT = path.join(__dirname, '..');
const SCHEMA_FILE = path.join(ROOT, 'database', 'tienda_abarrotes.sql');
const MIGRATIONS_DIR = path.join(ROOT, 'database', 'migrations');
const MIGRATION_017 = '017_integracion_compensaciones.sql';
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
  if (!['local', 'test'].includes(environment)
    || isProductionEnvironment(process.env)) {
    throw new Error('test:compensation-integration solo permite APP_ENV local o test.');
  }
  if (host !== 'localhost' || database !== PRIMARY_DATABASE) {
    throw new Error(
      `test:compensation-integration exige localhost/${PRIMARY_DATABASE}.`
    );
  }
  if (!String(process.env.BACKUP_RESTORE_USER || '').trim()
    || !String(process.env.BACKUP_RESTORE_PASSWORD || '')) {
    throw new Error('Configure el usuario local limitado a tmp_tienda_restore_%.*.');
  }
}

function temporaryDatabaseName() {
  return `${TEMP_PREFIX}${crypto.randomBytes(6).toString('hex')}`;
}

function assertTemporaryDatabase(name) {
  const normalized = String(name || '').trim().toLowerCase();
  if (!/^tmp_tienda_restore_[a-f0-9]{12}$/.test(normalized)
    || PROTECTED_DATABASES.has(normalized)) {
    throw new Error('La guarda de C4A rechazo la base temporal.');
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
    .filter((statement) => !/^(CREATE|DROP)\s+DATABASE/i.test(statement));
}

async function executeSql(connection, sql) {
  for (const statement of readStatements(sql)) await connection.query(statement);
}

function schemaBeforeC4A() {
  return fs.readFileSync(SCHEMA_FILE, 'utf8').replace(
    /-- COMPENSATION_INTEGRATION_TABLES_START[\s\S]*?-- COMPENSATION_INTEGRATION_TABLES_END/g,
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
  for (const name of migrationNames('016_compensaciones_financieras.sql')) {
    await connection.query(
      'INSERT INTO schema_migrations (nombre) VALUES (?)',
      [name]
    );
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

async function row(connection, sql, params = []) {
  const [rows] = await connection.query(sql, params);
  return rows[0] || null;
}

async function scalar(connection, sql, params = []) {
  return Number((await row(connection, sql, params))?.total || 0);
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

function operationKey(prefix) {
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
  const now = '2026-07-25 09:00:00';
  const password = `Local-${crypto.randomBytes(12).toString('hex')}!`;
  const [store] = await connection.query(
    `INSERT INTO tienda (nombre, slug, activo, estado, creadoEn, actualizadoEn)
     VALUES (?, ?, 1, 'activa', ?, ?)`,
    [`Tienda C4A ${suffix}`, `tienda-c4a-${suffix}`, now, now]
  );
  const idTienda = Number(store.insertId);
  const username = `owner_c4a_${suffix}`;
  const [admin] = await connection.query(
    `INSERT INTO administrador
     (idTienda, usuario, password, rol, activo, versionSesion)
     VALUES (?, ?, ?, 'dueno_tienda', 1, 1)`,
    [idTienda, username, await bcrypt.hash(password, 4)]
  );
  const idAdministrador = Number(admin.insertId);
  const plan = await row(
    connection,
    'SELECT idPlan FROM plan WHERE codigo=?',
    [planCode]
  );
  await connection.query(
    `INSERT INTO suscripcionTienda
     (idTienda, idPlan, tipo, estado, fechaInicio, fechaFin,
      renovacionAutomatica, observacion, creadoPor, creadoEn, actualizadoEn)
     VALUES (?, ?, 'cortesia', 'activa', '2026-01-01 00:00:00',
             '2027-12-31 23:59:59', 0, 'Fixture C4A', ?, ?, ?)`,
    [idTienda, plan.idPlan, idAdministrador, now, now]
  );
  const [client] = await connection.query(
    `INSERT INTO cliente
     (idTienda, nombre, telefono, telefonoNormalizado, documentoIdentidad,
      documentoNormalizado, limiteCredito, permiteFiado, diasCreditoDefault,
      activo, creadoEn, actualizadoEn, idAdministradorCrea, idAdministradorActualiza)
     VALUES (?, ?, '70000000', '70000000', ?, ?, 100000, 1, 30,
             1, ?, ?, ?, ?)`,
    [idTienda, `Cliente C4A ${suffix}`, `DOC-${suffix}`, `doc-${suffix}`,
      now, now, idAdministrador, idAdministrador]
  );
  const [product] = await connection.query(
    `INSERT INTO producto
     (idTienda, nombre, categoria, unidadMedida, unidadesPorPaquete,
      paquetesPorCaja, precioVenta, precioVentaPaquete, stock, stockMinimo,
      controlaLotes, controlaVencimiento, diasAlertaVencimiento,
      lotesActivadosEn, fechaInicioSeguimiento, stockUnidadesTotal,
      ultimoPrecioCompra, permiteVentaPorPaquete, permiteVentaPorUnidad,
      favoritoPos, activo)
     VALUES (?, ?, 'otros', 'unidad', 1, 1, 20, NULL, 10, 1, 0, 0, NULL,
             NULL, ?, 10, 8, 0, 1, 0, 1)`,
    [idTienda, `Producto C4A ${suffix}`, now]
  );
  return {
    idTienda,
    idAdministrador,
    idCliente: Number(client.insertId),
    idProducto: Number(product.insertId),
    username,
    password
  };
}

async function createRefundObligation(connection, fixture, amount = 10) {
  const saleDate = '2026-07-25 09:15:00';
  const compensationDate = '2026-07-25 10:00:00';
  const [sale] = await connection.query(
    `INSERT INTO venta
     (idTienda, fecha, subtotal, descuento, total, montoPagado,
      montoCompensado, saldoPendiente, estadoPago, estadoOperacion, tipo,
      idCliente, claveOperacion, codigoComprobante)
     VALUES (?, ?, 20, 0, 20, 20, ?, 0, 'pagada', 'devuelta_parcial',
             'pagada', ?, ?, ?)`,
    [fixture.idTienda, saleDate, amount, fixture.idCliente,
      operationKey('sale-c4a'), operationKey('receipt-c4a')]
  );
  const idVenta = Number(sale.insertId);
  const [detail] = await connection.query(
    `INSERT INTO detalleVenta
     (idTienda, idVenta, idProducto, cantidad, precioVenta, costoUnitario,
      subtotal, subtotalCosto, ganancia, origenCosto, presentacionVenta,
      cantidadEquivalenteUnidades)
     VALUES (?, ?, ?, 1, 20, 8, 20, 8, 12, 'real', 'unidad', 1)`,
    [fixture.idTienda, idVenta, fixture.idProducto]
  );
  const [payment] = await connection.query(
    `INSERT INTO pagoVenta
     (idTienda, idVenta, idPagoFiado, metodoPago, monto, montoRecibido,
      cambio, referencia, claveOperacion, idAdministrador, creadoEn)
     VALUES (?, ?, NULL, 'efectivo', 20, 20, 0, NULL, ?, ?, ?)`,
    [fixture.idTienda, idVenta, operationKey('payment-c4a'),
      fixture.idAdministrador, saleDate]
  );
  const [saleOperation] = await connection.query(
    `INSERT INTO operacionCompensatoria
     (idTienda, tipoOperacion, estado, motivoCodigo, observacion,
      requiereAprobacion, idAdministradorSolicitante, idAdministradorAprobador,
      claveOperacion, huellaSolicitud, fechaSolicitud, fechaAprobacion,
      fechaAplicacion, creadoEn, actualizadoEn)
     VALUES (?, 'devolucion_venta', 'aplicada', 'devolucion_cliente', NULL,
             0, ?, NULL, ?, ?, ?, NULL, ?, ?, ?)`,
    [fixture.idTienda, fixture.idAdministrador, operationKey('c2-c4a'),
      crypto.createHash('sha256').update(operationKey('fp-c2')).digest('hex'),
      compensationDate, compensationDate, compensationDate, compensationDate]
  );
  const [compensation] = await connection.query(
    `INSERT INTO compensacionVenta
     (idTienda, idOperacionCompensatoria, idVenta, tipoCompensacion,
      montoCompensado, costoCompensado, creadoEn)
     VALUES (?, ?, ?, 'devolucion_parcial', ?, 4, ?)`,
    [fixture.idTienda, saleOperation.insertId, idVenta, amount, compensationDate]
  );
  await connection.query(
    `INSERT INTO detalleCompensacionVenta
     (idTienda, idCompensacionVenta, idDetalleVenta, idProducto,
      unidadesDevueltas, montoCompensado, costoCompensado,
      tratamientoInventario, resultadoInventario, idMovimientoStock, creadoEn)
     VALUES (?, ?, ?, ?, 1, ?, 4, 'no_reintegrar', 'no_reintegrado', NULL, ?)`,
    [fixture.idTienda, compensation.insertId, detail.insertId,
      fixture.idProducto, amount, compensationDate]
  );
  const [settlement] = await connection.query(
    `INSERT INTO liquidacionCompensacionVenta
     (idTienda, idCompensacionVenta, montoCompensado,
      montoReduccionDeudaPendiente, montoReembolsoPendiente, estado,
      creadoEn, resueltoEn)
     VALUES (?, ?, ?, 0, ?, 'resuelta', ?, ?)`,
    [fixture.idTienda, compensation.insertId, amount, amount,
      compensationDate, compensationDate]
  );
  const [financialOperation] = await connection.query(
    `INSERT INTO operacionCompensatoria
     (idTienda, tipoOperacion, estado, motivoCodigo, observacion,
      requiereAprobacion, idAdministradorSolicitante, idAdministradorAprobador,
      claveOperacion, huellaSolicitud, fechaSolicitud, fechaAprobacion,
      fechaAplicacion, creadoEn, actualizadoEn)
     VALUES (?, 'correccion_saldo', 'aplicada', 'devolucion_cliente', NULL,
             0, ?, NULL, ?, ?, ?, NULL, ?, ?, ?)`,
    [fixture.idTienda, fixture.idAdministrador, operationKey('c3-c4a'),
      crypto.createHash('sha256').update(operationKey('fp-c3')).digest('hex'),
      compensationDate, compensationDate, compensationDate, compensationDate]
  );
  const [resolution] = await connection.query(
    `INSERT INTO resolucionLiquidacionVenta
     (idTienda, idOperacionCompensatoria, idLiquidacionCompensacionVenta,
      idFiado, montoReduccionDeuda, montoReembolso,
      periodoOriginalCerrado, creadoEn, idAdministrador)
     VALUES (?, ?, ?, NULL, 0, ?, 0, ?, ?)`,
    [fixture.idTienda, financialOperation.insertId, settlement.insertId,
      amount, compensationDate, fixture.idAdministrador]
  );
  const [obligation] = await connection.query(
    `INSERT INTO obligacionReembolsoVenta
     (idTienda, idResolucionLiquidacionVenta, idVenta, monto, estado,
      creadoEn, resueltoEn, idAdministradorResuelve)
     VALUES (?, ?, ?, ?, 'pendiente', ?, NULL, NULL)`,
    [fixture.idTienda, resolution.insertId, idVenta, amount, compensationDate]
  );
  await connection.query(
    `INSERT INTO detalleObligacionReembolsoPago
     (idTienda, idObligacionReembolsoVenta, idPagoVenta,
      metodoOriginal, monto, creadoEn)
     VALUES (?, ?, ?, 'efectivo', ?, ?)`,
    [fixture.idTienda, obligation.insertId, payment.insertId,
      amount, compensationDate]
  );
  return {
    idVenta,
    idCompensacionVenta: Number(compensation.insertId),
    idObligacionReembolsoVenta: Number(obligation.insertId),
    idPagoVenta: Number(payment.insertId)
  };
}

function settlementBody(amount, key = operationKey('material-c4a'), overrides = {}) {
  return {
    confirmar: true,
    claveOperacion: key,
    motivoCodigo: 'devolucion_cliente',
    tipoLiquidacion: 'reembolso_realizado',
    metodoLiquidacion: 'efectivo',
    monto: amount,
    ...overrides
  };
}

class SessionClient {
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
      SESSION_SECRET: process.env.SESSION_SECRET
        || crypto.randomBytes(32).toString('hex'),
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
      // El listener todavia esta iniciando.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  child.kill('SIGTERM');
  throw new Error('El servidor temporal de C4A no inicio dentro del plazo.');
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
  const files = [
    'database/migrations/017_integracion_compensaciones.sql',
    'services/material-settlement-service.js',
    'services/compensation-receipt-service.js',
    'services/compensation-report-service.js',
    'routes/financial-compensations.js'
  ].map((name) => fs.readFileSync(path.join(ROOT, name), 'utf8')).join('\n');
  assert(!/\bDELETE\s+FROM\b/i.test(files),
    'C4A no contiene borrados fisicos.');
  assert(!/\bUPDATE\s+(venta|pagoVenta|pagoFiado|cobroFiado)\b/i.test(
    fs.readFileSync(
      path.join(ROOT, 'services', 'material-settlement-service.js'),
      'utf8'
    )
  ), 'La liquidacion material no modifica originales financieros.');
  assert(/requirePlanFeature\(COMPENSATION_FEATURE\)/.test(files),
    'La API C4A exige anulaciones_operativas.');
  assert(!/\bidTienda\s*[:=]\s*req\.(body|query|params)/.test(files),
    'La API obtiene la tienda solo del tenant autenticado.');
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
    await executeSql(connection, schemaBeforeC4A());
    await connection.query(
      `INSERT INTO configuracionInventarioTienda
       (idTienda, periodoAnalisisDias, diasHistorialMinimo,
        diasReposicionDefault, diasCoberturaDefault, diasProductoNuevo,
        diasAlertaVencimientoDefault, creadoEn, actualizadoEn,
        idAdministradorActualiza)
       SELECT idTienda, 30, 14, 3, 14, 30, 30,
              '2026-07-25 09:00:00', '2026-07-25 09:00:00', NULL
       FROM tienda`
    );
    await createMigrationRegistry(connection);
    const migrationOutput = runNodeScript('scripts/migrate-db.js', temporaryDatabase);
    assert(migrationOutput.includes(`Migracion aplicada: ${MIGRATION_017}`),
      'El migrador real aplica solo la 017 pendiente en la base temporal.');
    const state = await inspectCompensationIntegration(connection);
    assert(state.estado === 'post-migracion'
      && state.estructuraCompleta && state.datosValidos,
    'El comprobador valida la estructura C4A post-017.');
    runNodeScript('scripts/check-financial-reports.js', temporaryDatabase);
    assert(true,
      'El comprobador financiero acepta la ecuacion de caja post-017.');

    Object.assign(process.env, {
      APP_ENV: 'local',
      DB_HOST: 'localhost',
      DB_NAME: temporaryDatabase,
      DB_USER: restoreEnvironment().DB_USER,
      DB_PASSWORD: restoreEnvironment().DB_PASSWORD
    });
    const {
      createMaterialSettlementService
    } = require('../services/material-settlement-service');
    const {
      calculateCashClose,
      financialSummary,
      paymentMethods,
      productProfitability,
      salesByDay,
      reportRange
    } = require('../services/financial-service');
    const {
      materialSettlementReceipt,
      saleCompensationReceipt
    } = require('../services/compensation-receipt-service');
    applicationPool = require('../config/db');
    const materialService = createMaterialSettlementService({
      pool: applicationPool,
      now: () => new Date('2026-07-25T14:00:00.000Z')
    });
    const { settleRefundObligation } = materialService;

    const advanced = await createFixture(connection, 'avanzado');
    const basic = await createFixture(connection, 'basico');
    const otherTenant = await createFixture(connection, 'avanzado');
    const partial = await createRefundObligation(connection, advanced, 10);
    const partialKey = operationKey('partial-c4a');
    const first = await settleRefundObligation({
      idTienda: advanced.idTienda,
      idAdministrador: advanced.idAdministrador,
      idObligacionReembolsoVenta: partial.idObligacionReembolsoVenta,
      body: settlementBody(4, partialKey)
    });
    const repeated = await settleRefundObligation({
      idTienda: advanced.idTienda,
      idAdministrador: advanced.idAdministrador,
      idObligacionReembolsoVenta: partial.idObligacionReembolsoVenta,
      body: settlementBody(4, partialKey)
    });
    assert(Number(first.saldoPendiente) === 6
      && first.estadoObligacion === 'pendiente' && repeated.repetida,
    'El reembolso parcial conserva saldo e idempotencia.');
    await expectError(() => settleRefundObligation({
      idTienda: advanced.idTienda,
      idAdministrador: advanced.idAdministrador,
      idObligacionReembolsoVenta: partial.idObligacionReembolsoVenta,
      body: settlementBody(5, partialKey)
    }), 'OPERATION_KEY_CONFLICT',
    'La misma clave con otra huella devuelve conflicto.');
    await expectError(() => settleRefundObligation({
      idTienda: advanced.idTienda,
      idAdministrador: advanced.idAdministrador,
      idObligacionReembolsoVenta: partial.idObligacionReembolsoVenta,
      body: settlementBody(7)
    }), 'SETTLEMENT_EXCEEDS_REFUND_BALANCE',
    'No se puede liquidar por encima del saldo pendiente.');
    const completed = await settleRefundObligation({
      idTienda: advanced.idTienda,
      idAdministrador: advanced.idAdministrador,
      idObligacionReembolsoVenta: partial.idObligacionReembolsoVenta,
      body: settlementBody(6)
    });
    assert(completed.estadoObligacion === 'reembolsado'
      && Number(completed.saldoPendiente) === 0,
    'El reembolso total cierra exactamente la obligacion.');
    await expectError(() => settleRefundObligation({
      idTienda: advanced.idTienda,
      idAdministrador: advanced.idAdministrador,
      idObligacionReembolsoVenta: partial.idObligacionReembolsoVenta,
      body: settlementBody(1)
    }), 'REFUND_OBLIGATION_ALREADY_SETTLED',
    'Una obligacion cerrada no se liquida dos veces.');

    const otherMeans = await createRefundObligation(connection, advanced, 8);
    const otherResult = await settleRefundObligation({
      idTienda: advanced.idTienda,
      idAdministrador: advanced.idAdministrador,
      idObligacionReembolsoVenta: otherMeans.idObligacionReembolsoVenta,
      body: settlementBody(8, undefined, {
        tipoLiquidacion: 'compensacion_otro_medio',
        metodoLiquidacion: 'transferencia',
        referencia: 'ACUERDO-C4A'
      })
    });
    assert(otherResult.estadoObligacion === 'compensado',
      'La compensacion por otro medio queda materializada y conciliada.');
    const credit = await createRefundObligation(connection, advanced, 3);
    await expectError(() => settleRefundObligation({
      idTienda: advanced.idTienda,
      idAdministrador: advanced.idAdministrador,
      idObligacionReembolsoVenta: credit.idObligacionReembolsoVenta,
      body: settlementBody(3, undefined, { tipoLiquidacion: 'credito_a_favor' })
    }), 'CREDIT_BALANCE_NOT_AVAILABLE',
    'No se inventa credito a favor sin un libro seguro de consumo.');

    const rollback = await createRefundObligation(connection, advanced, 5);
    const rollbackService = createMaterialSettlementService({
      pool: applicationPool,
      now: () => new Date('2026-07-25T14:00:00.000Z'),
      afterMaterialSettlement: async () => {
        const error = new Error('Fallo controlado C4A.');
        error.code = 'TEST_C4A_ROLLBACK';
        throw error;
      }
    });
    await expectError(() => rollbackService.settleRefundObligation({
      idTienda: advanced.idTienda,
      idAdministrador: advanced.idAdministrador,
      idObligacionReembolsoVenta: rollback.idObligacionReembolsoVenta,
      body: settlementBody(5)
    }), 'TEST_C4A_ROLLBACK',
    'Un fallo controlado revierte toda la liquidacion.');
    assert(await scalar(
      connection,
      `SELECT COUNT(*) total FROM movimientoLiquidacionCompensacion
       WHERE idTienda=? AND idObligacionReembolsoVenta=?`,
      [advanced.idTienda, rollback.idObligacionReembolsoVenta]
    ) === 0, 'El rollback no deja movimientos parciales.');

    const concurrent = await createRefundObligation(connection, advanced, 10);
    const concurrentResults = await Promise.all([
      settleRefundObligation({
        idTienda: advanced.idTienda,
        idAdministrador: advanced.idAdministrador,
        idObligacionReembolsoVenta: concurrent.idObligacionReembolsoVenta,
        body: settlementBody(5)
      }),
      settleRefundObligation({
        idTienda: advanced.idTienda,
        idAdministrador: advanced.idAdministrador,
        idObligacionReembolsoVenta: concurrent.idObligacionReembolsoVenta,
        body: settlementBody(5)
      })
    ]);
    assert(concurrentResults.some((result) => result.estadoObligacion === 'reembolsado')
      && await scalar(
        connection,
        `SELECT COUNT(*) total FROM movimientoLiquidacionCompensacion
         WHERE idTienda=? AND idObligacionReembolsoVenta=?`,
        [advanced.idTienda, concurrent.idObligacionReembolsoVenta]
      ) === 2,
    'La concurrencia serializa dos abonos sin exceder la obligacion.');
    await expectError(() => settleRefundObligation({
      idTienda: otherTenant.idTienda,
      idAdministrador: otherTenant.idAdministrador,
      idObligacionReembolsoVenta: rollback.idObligacionReembolsoVenta,
      body: settlementBody(1)
    }), 'REFUND_OBLIGATION_NOT_FOUND',
    'Una tienda no puede liquidar obligaciones de otra.');

    const range = reportRange({
      desde: '2026-07-25',
      hasta: '2026-07-25'
    });
    const summary = await financialSummary(connection, advanced.idTienda, range);
    assert(Number(summary.ventasAntesCompensaciones) > Number(summary.ventasNetas)
      && Number(summary.compensacionesVenta) > 0
      && Number(summary.reembolsosRealizados) > 0
      && Number(summary.liquidacionesOtroMedio) === 8,
    `El resumen distingue bruto, compensacion, liquidacion y neto: ${
      JSON.stringify({
        bruto: summary.ventasAntesCompensaciones,
        compensaciones: summary.compensacionesVenta,
        neto: summary.ventasNetas,
        reembolsos: summary.reembolsosRealizados,
        otros: summary.liquidacionesOtroMedio
      })
    }.`);
    const methods = await paymentMethods(connection, advanced.idTienda, range);
    const cash = methods.find((item) => item.metodoPago === 'efectivo');
    assert(cash && Number(cash.bruto) > Number(cash.total)
      && Number(cash.reembolsos) > 0,
    'Los metodos de pago muestran bruto, reembolsos y neto.');
    const daily = await salesByDay(connection, advanced.idTienda, range);
    const day = daily.find((item) => String(item.fecha) === '2026-07-25');
    assert(day && Number(day.compensacionesVenta) > 0
      && Number(day.ventasNetas) < Number(day.ventasAntesCompensaciones),
    'Las ventas diarias contabilizan la compensacion en su fecha real.');
    const profitability = await productProfitability(
      connection,
      advanced.idTienda,
      range,
      { idProducto: advanced.idProducto }
    );
    assert(profitability.length === 1
      && Number(profitability[0].compensacionesVenta) > 0
      && Number(profitability[0].ventasNetas)
        < Number(profitability[0].ventasAntesCompensaciones),
    'La rentabilidad descuenta devolucion y costo sin doble contabilizacion.');
    const cashClose = await calculateCashClose(
      connection, advanced.idTienda, range, 100
    );
    assert(Number(cashClose.reembolsosEfectivo) > 0
      && Number(cashClose.compensacionesVenta) > 0
      && Number(cashClose.totalCobradoNeto) < Number(cashClose.totalCobrado),
    'El calculo de caja separa entradas, compensaciones, reembolsos y neto.');
    const saleReceipt = await saleCompensationReceipt(
      connection, advanced.idTienda, partial.idCompensacionVenta
    );
    const materialReceipt = await materialSettlementReceipt(
      connection, advanced.idTienda,
      first.idMovimientoLiquidacionCompensacion
    );
    assert(saleReceipt.comprobante.numero.startsWith('COMP-VTA-')
      && materialReceipt.comprobante.numero.startsWith('LIQ-COMP-')
      && !JSON.stringify(materialReceipt).includes(partialKey),
    'Los comprobantes son independientes y no exponen claves idempotentes.');

    temporaryServer = await startServer(temporaryDatabase);
    const advancedClient = new SessionClient(temporaryServer.baseUrl);
    const basicClient = new SessionClient(temporaryServer.baseUrl);
    assert((await advancedClient.request('/auth/login', {
      method: 'POST',
      body: { usuario: advanced.username, password: advanced.password }
    })).status === 200, 'El administrador avanzado inicia sesion en la base temporal.');
    assert((await basicClient.request('/auth/login', {
      method: 'POST',
      body: { usuario: basic.username, password: basic.password }
    })).status === 200, 'El administrador basico inicia sesion en la base temporal.');
    const closeResponse = await advancedClient.request('/api/caja/cierres', {
      method: 'POST',
      body: {
        fechaInicio: '2026-07-25 00:00:00',
        fechaFin: '2026-07-26 00:00:00',
        efectivoInicial: 100,
        efectivoContado: cashClose.efectivoEsperado,
        claveOperacion: operationKey('close-c4a'),
        observacion: 'Cierre compensatorio C4A'
      }
    });
    assert(closeResponse.status === 201
      && Number(closeResponse.body?.calculo?.reembolsosEfectivo) > 0,
    `Los cierres futuros congelan los campos explicativos de C4A: HTTP ${
      closeResponse.status
    } ${JSON.stringify(closeResponse.body)}.`);
    const apiObligation = await createRefundObligation(connection, advanced, 2);
    const apiResponse = await advancedClient.request(
      `/api/obligaciones-reembolso/${apiObligation.idObligacionReembolsoVenta}/liquidaciones`,
      { method: 'POST', body: settlementBody(2) }
    );
    assert(apiResponse.status === 201,
      'La API autenticada registra una liquidacion material.');
    const csrfObligation = await createRefundObligation(connection, advanced, 2);
    const csrfResponse = await advancedClient.request(
      `/api/obligaciones-reembolso/${csrfObligation.idObligacionReembolsoVenta}/liquidaciones`,
      { method: 'POST', body: settlementBody(2) },
      false
    );
    assert(csrfResponse.status === 403,
      'La proteccion CSRF/origen bloquea la escritura sin cabeceras.');
    const basicResponse = await basicClient.request(
      `/api/obligaciones-reembolso/${csrfObligation.idObligacionReembolsoVenta}/liquidaciones`,
      { method: 'POST', body: settlementBody(2) }
    );
    assert(basicResponse.status === 404,
      'El plan basico autorizado conserva aislamiento y no cruza obligaciones.');

    const postState = await inspectCompensationIntegration(connection);
    assert(postState.datosValidos,
      'Las liquidaciones de prueba conservan las invariantes de C4A.');
    assert(await scalar(connection,
      `SELECT COUNT(*) total FROM pagoVenta
       WHERE idTienda=? AND idPagoVenta=? AND monto=20`,
      [advanced.idTienda, partial.idPagoVenta]) === 1,
    'Los pagos y ventas originales permanecen inmutables.');
  } finally {
    await stopServer(temporaryServer?.child);
    if (applicationPool) await applicationPool.end();
    if (connection) await connection.end();
    await serverConnection.query(
      `DROP DATABASE IF EXISTS ${quoteDatabase(temporaryDatabase)}`
    );
    await serverConnection.end();
    Object.assign(process.env, primaryEnvironment);
  }
  const primaryAfter = await primaryFingerprint(primaryEnvironment);
  assert(JSON.stringify(primaryAfter) === JSON.stringify(primaryBefore),
    'La base principal conserva migraciones, conteos e importes exactamente iguales.');
  const cleanupConnection = await createConnection(restoreEnvironment(), false);
  try {
    const [temporary] = await cleanupConnection.query(
      `SELECT SCHEMA_NAME
       FROM information_schema.SCHEMATA
       WHERE SCHEMA_NAME=?`,
      [temporaryDatabase]
    );
    assert(temporary.length === 0, 'La base temporal C4A fue eliminada.');
  } finally {
    await cleanupConnection.end();
  }
  console.log('Pruebas de integracion compensatoria C4A completadas.');
}

main().catch((error) => {
  console.error(`Fallo C4A: ${safeError(error)}`);
  process.exitCode = 1;
});
