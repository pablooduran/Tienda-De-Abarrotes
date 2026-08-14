const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');
const bcrypt = require('bcryptjs');
const mysql = require('mysql2/promise');
const { chromium } = require('playwright-core');
require('../config/env');
const { buildDatabaseOptions, isProductionEnvironment, setBusinessSessionTimeZone } = require('../config/database-options');
const { applyTestRequestSecurity } = require('./http-test-security');

const ROOT = path.resolve(__dirname, '..');
const MIGRATIONS_DIR = path.join(ROOT, 'database', 'migrations');
const TEMP_PREFIX = 'tmp_tienda_restore_';
const PRIMARY_DATABASE = 'tienda_abarrotes_pruebas';
const PROTECTED_DATABASES = new Set([
  'tienda_abarrotes', PRIMARY_DATABASE, 'mysql', 'information_schema',
  'performance_schema', 'sys'
]);

function ok(condition, message) {
  assert(condition, message);
  console.log(`OK: ${message}`);
}

function safeError(error) {
  return String(error?.message || error || 'Error')
    .replace(/(password|contrasena|cookie|session_secret|db_ssl_ca|token|hash)\s*[:=]\s*\S+/gi,
      '$1=[REDACTED]');
}

function assertSafeRuntime() {
  const environment = String(process.env.APP_ENV || '').trim().toLowerCase();
  const host = String(process.env.DB_HOST || '').trim().toLowerCase();
  const database = String(process.env.DB_NAME || '').trim().toLowerCase();
  if (!['local', 'test'].includes(environment) || isProductionEnvironment(process.env)) {
    throw new Error('test:e2e-critical-business solo se permite en APP_ENV local o test.');
  }
  if (host !== 'localhost' || database !== PRIMARY_DATABASE) {
    throw new Error(`El E2E exige localhost / ${PRIMARY_DATABASE}.`);
  }
  if (!String(process.env.BACKUP_RESTORE_USER || '').trim()
    || !String(process.env.BACKUP_RESTORE_PASSWORD || '')) {
    throw new Error('Faltan credenciales locales limitadas a tmp_tienda_restore_%.*.');
  }
}

function temporaryDatabaseName() {
  return `${TEMP_PREFIX}${crypto.randomBytes(6).toString('hex')}`;
}

function assertTemporaryDatabase(name) {
  const normalized = String(name || '').trim().toLowerCase();
  if (!new RegExp(`^${TEMP_PREFIX}[a-f0-9]{12}$`).test(normalized)
    || PROTECTED_DATABASES.has(normalized)) {
    throw new Error('La guarda rechazo el nombre de la base temporal.');
  }
  return normalized;
}

function quoteTemporaryDatabase(name) {
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

function sqlStatements(sql) {
  return sql.split(';')
    .map((part) => part.split(/\r?\n/)
      .filter((line) => !line.trim().startsWith('--')).join('\n').trim())
    .filter(Boolean)
    .filter((statement) => !/^(USE\s+|CREATE\s+DATABASE|DROP\s+)/i.test(statement));
}

async function initializeSchema(connection) {
  const schema = fs.readFileSync(path.join(ROOT, 'database', 'tienda_abarrotes.sql'), 'utf8');
  for (const statement of sqlStatements(schema)) await connection.query(statement);
  await connection.query(
    `CREATE TABLE schema_migrations (
       nombre VARCHAR(255) PRIMARY KEY,
       aplicadaEn DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
     ) ENGINE=InnoDB`
  );
  const migrations = fs.readdirSync(MIGRATIONS_DIR)
    .filter((name) => /^\d{3}_.+\.sql$/i.test(name)).sort();
  ok(migrations.length === 24 && migrations.at(-1).startsWith('024_'),
    'La base temporal representa exactamente las migraciones 001-024.');
  for (const migration of migrations) {
    await connection.query('INSERT INTO schema_migrations (nombre) VALUES (?)', [migration]);
  }
}

function browserExecutable() {
  const candidates = [
    process.env.BROWSER_EXECUTABLE_PATH,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium', '/usr/bin/chromium-browser'
  ].filter(Boolean);
  const executablePath = candidates.find((candidate) => fs.existsSync(candidate));
  if (!executablePath) throw new Error('No se encontro Chrome, Chromium o Edge para el gate E2E.');
  return executablePath;
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
      ...restoreEnvironment(databaseName), PORT: String(port),
      SESSION_SECRET: crypto.randomBytes(32).toString('hex'),
      TRUSTED_ORIGINS: baseUrl, RATE_LIMIT_ENABLED: 'false'
    },
    stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true
  });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk.toString(); });
  child.stderr.on('data', (chunk) => { output += chunk.toString(); });
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`El servidor E2E no inicio. ${safeError(output.slice(-1800))}`);
    try {
      if ((await fetch(`${baseUrl}/health/ready`)).status === 200) return { child, baseUrl };
    } catch {
      // El listener todavia esta iniciando.
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  child.kill('SIGTERM');
  throw new Error('El servidor E2E no quedo listo dentro del plazo.');
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

class HttpSession {
  constructor(baseUrl) { this.baseUrl = baseUrl; this.cookie = ''; }
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
    try { body = text ? JSON.parse(text) : null; } catch { body = text; }
    return { status: response.status, body };
  }
}

function sanitized(value) {
  if (Array.isArray(value)) return value.map(sanitized);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !/(password|contrasena|cookie|session|token|secret|hash)/i.test(key))
    .map(([key, item]) => [key, sanitized(item)]));
}

async function expectHttp(session, route, options, status, label) {
  const response = await session.request(route, options);
  if (response.status !== status) {
    throw new Error(`${label}: HTTP ${response.status}; esperado ${status}. ${JSON.stringify(sanitized(response.body))}`);
  }
  return response.body;
}

function storePayload(marker, suffix, planCode) {
  const password = `Owner-${suffix}-${crypto.randomBytes(10).toString('hex')}!`;
  return { password, body: {
    nombre: `Tienda robot ${suffix.toUpperCase()} ${marker}`,
    slug: `tienda-robot-${suffix}-${marker}`,
    estado: 'activa', activo: true,
    propietario: {
      usuario: `owner_robot_${suffix}_${marker}`, password,
      confirmacionPassword: password, activo: true
    },
    suscripcion: { planCodigo: planCode, tipo: 'cortesia', duracionDias: 30 }
  } };
}

function productPayload(name, stock = 0) {
  return {
    nombre: name, categoria: 'OTROS', unidadMedida: 'unidad',
    unidadesPorPaquete: 1, paquetesPorCaja: 1, precioVenta: 10,
    stockMinimo: 2, stockUnidadesTotal: stock,
    permiteVentaPorPaquete: false, permiteVentaPorUnidad: true
  };
}

async function scalar(connection, sql, params = []) {
  const [[row]] = await connection.query(sql, params);
  return Number(row.total || 0);
}

async function runBrowserFlow({ baseUrl, username, password, productName, customerName }) {
  const browser = await chromium.launch({
    executablePath: browserExecutable(), headless: true,
    args: process.platform === 'linux' ? ['--no-sandbox'] : []
  });
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error' && !/^Failed to load resource:/.test(message.text())) {
      errors.push(message.text());
    }
  });
  page.on('response', (response) => {
    if (response.status() >= 400 && !response.url().endsWith('/favicon.ico')) {
      errors.push(`HTTP ${response.status()} ${new URL(response.url()).pathname}`);
    }
  });
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await page.goto(`${baseUrl}/login.html`, { waitUntil: 'domcontentloaded' });
    await page.locator('#loginForm [name="usuario"]').fill(username);
    await page.locator('#loginForm [name="password"]').fill(password);
    await Promise.all([
      page.waitForURL('**/app.html'),
      page.locator('#loginForm button[type="submit"]').click()
    ]);
    await page.locator('[data-navigation-family="inicio"]').waitFor();
    ok(!/idTienda|idSuscripcion/.test(await page.locator('body').innerText()),
      'La UI no expone identificadores internos del tenant o suscripcion.');

    await page.locator('[data-navigation-family="inventario"] > summary').click();
    await page.locator('[data-navigation-family="inventario"] [data-view="productos"]').click();
    await page.locator('#addProduct').waitFor();
    ok((await page.locator('#view').innerText()).includes(productName),
      'El producto sintetico aparece en Productos.');

    await page.locator('[data-navigation-family="ventas"] > summary').click();
    await page.locator('[data-navigation-family="ventas"] [data-view="ventas"]').click();
    await page.locator('#posSearch').fill(productName);
    const addButton = page.locator('[data-pos-add]').first();
    await addButton.waitFor();
    await addButton.click();
    ok((await page.locator('#posCartItems').innerText()).includes(productName),
      'El POS incorpora el producto al carrito.');
    await page.locator('#posSubmit').click();
    await page.locator('[data-modal-confirm]').waitFor();
    const responsePromise = page.waitForResponse((response) => (
      response.url().endsWith('/api/pos/ventas') && response.request().method() === 'POST'
    ));
    await page.locator('[data-modal-confirm]').click();
    const response = await responsePromise;
    ok(response.status() === 201, 'La venta critica se registra desde el POS real.');
    const sale = await response.json();
    await page.getByRole('dialog', { name: 'Venta confirmada' }).waitFor();
    ok((await page.locator('#saleReceipt').innerText()).includes('Comprobante interno'),
      'El POS muestra el comprobante interno.');
    await page.locator('[data-modal-confirm]').click();

    await page.locator('[data-navigation-family="clientes"] > summary').click();
    await page.locator('[data-navigation-family="clientes"] [data-view="clientes"]').click();
    await page.getByText(customerName, { exact: false }).first().waitFor();
    ok(true, 'El cliente sintetico aparece en Clientes.');

    await page.locator('[data-navigation-family="ventas"] > summary').click();
    await page.locator('[data-navigation-family="ventas"] [data-view="historialVentas"]').click();
    await page.locator('[data-detail]').first().click();
    await page.getByRole('dialog').getByText(productName, { exact: false }).first().waitFor();
    ok(true, 'El detalle del historial conserva el producto vendido.');
    await page.locator('[data-modal-confirm]').click();

    await page.locator('[data-navigation-family="plan"] > summary').click();
    await Promise.all([
      page.waitForURL('**/suscripcion.html'),
      page.locator('[data-navigation-family="plan"] a[href="/suscripcion.html"]').click()
    ]);
    await page.locator('[data-subscription-view]').waitFor();
    await page.locator('[data-payment-form]').waitFor();
    ok((await page.locator('body').innerText()).includes('Pro'),
      'Mi plan muestra la suscripcion sintetica vigente.');
    await page.locator('[data-payment-form] [name="plan"]').selectOption('pro');
    ok(await page.getByRole('button', { name: 'Cotizar' }).isEnabled(),
      'Mi plan conserva la accion de cotizacion.');
    ok(errors.length === 0, `El recorrido browser termina con consola limpia${errors.length ? `: ${errors.join(' | ')}` : ''}.`);
    return sale;
  } finally {
    await context.close();
    await browser.close();
  }
}

async function main() {
  assertSafeRuntime();
  const temporaryDatabase = temporaryDatabaseName();
  const serverConnection = await createConnection(restoreEnvironment(), false);
  let connection = null;
  let server = null;
  try {
    await serverConnection.query(
      `CREATE DATABASE ${quoteTemporaryDatabase(temporaryDatabase)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
    connection = await createConnection(restoreEnvironment(temporaryDatabase));
    await initializeSchema(connection);
    server = await startServer(temporaryDatabase);

    const marker = crypto.randomBytes(6).toString('hex');
    const superUsername = `super_robot_${marker}`;
    const superPassword = `Super-${crypto.randomBytes(12).toString('hex')}!`;
    await connection.query(
      `INSERT INTO administrador (idTienda, usuario, password, rol, activo, versionSesion)
       VALUES (NULL, ?, ?, 'superadmin', 1, 1)`,
      [superUsername, await bcrypt.hash(superPassword, 4)]
    );

    const superSession = new HttpSession(server.baseUrl);
    const ownerA = new HttpSession(server.baseUrl);
    const ownerB = new HttpSession(server.baseUrl);
    await expectHttp(superSession, '/auth/login', {
      method: 'POST', body: { usuario: superUsername, password: superPassword }
    }, 200, 'Login superadmin sintetico');
    const storeA = storePayload(marker, 'a', 'pro');
    const storeB = storePayload(marker, 'b', 'basico');
    const createdA = await expectHttp(superSession, '/api/admin/tiendas', {
      method: 'POST', body: storeA.body
    }, 201, 'Crear tenant A');
    const createdB = await expectHttp(superSession, '/api/admin/tiendas', {
      method: 'POST', body: storeB.body
    }, 201, 'Crear tenant B');
    const idTiendaA = Number(createdA.tienda.idTienda);
    const idTiendaB = Number(createdB.tienda.idTienda);
    await expectHttp(ownerA, '/auth/login', {
      method: 'POST', body: { usuario: storeA.body.propietario.usuario, password: storeA.password }
    }, 200, 'Login propietario A');
    await expectHttp(ownerB, '/auth/login', {
      method: 'POST', body: { usuario: storeB.body.propietario.usuario, password: storeB.password }
    }, 200, 'Login propietario B');
    await expectHttp(superSession, '/api/admin/pagos-suscripcion/tipos-cambio', {
      method: 'POST',
      headers: { 'Idempotency-Key': `robot:${marker}:rate` },
      body: { valor: '7.00000000', fuente: 'Fuente sintetica del E2E local' }
    }, 201, 'Configurar tasa sintetica');
    await expectHttp(superSession, '/api/admin/pagos-suscripcion/metodos/qr_manual', {
      method: 'PATCH',
      headers: { 'Idempotency-Key': `robot:${marker}:method` },
      body: {
        activo: true,
        visiblePropietario: true,
        instrucciones: 'Instrucciones sinteticas exclusivas del E2E.'
      }
    }, 200, 'Configurar metodo sintetico');

    const productName = `Producto robot ${marker}`;
    const product = await expectHttp(ownerA, '/api/productos', {
      method: 'POST', body: productPayload(productName)
    }, 201, 'Crear producto A');
    const productB = await expectHttp(ownerB, '/api/productos', {
      method: 'POST', body: productPayload(`Producto ajeno ${marker}`, 8)
    }, 201, 'Crear producto B');
    const providerName = `Proveedor robot ${marker}`;
    await expectHttp(ownerA, '/api/proveedores', {
      method: 'POST', body: { nombre: providerName, telefono: '70001001' }
    }, 201, 'Crear proveedor A');
    const providers = await expectHttp(ownerA, '/api/proveedores', {}, 200, 'Listar proveedores A');
    const provider = providers.find((item) => item.nombre === providerName);
    ok(provider, 'El proveedor pertenece al tenant A.');

    const purchasePayload = {
      idProveedor: provider.idProveedor,
      claveOperacion: `purchase-robot-${marker}`,
      items: [{ idProducto: product.idProducto, cantidad: 12, presentacion: 'unidad', precioCompra: 4 }]
    };
    await expectHttp(ownerA, '/api/compras', { method: 'POST', body: purchasePayload }, 201,
      'Registrar compra A');
    const repeatedPurchase = await expectHttp(ownerA, '/api/compras', {
      method: 'POST', body: purchasePayload
    }, 201, 'Repetir compra idempotente');
    ok(repeatedPurchase.repetida === true, 'La compra repetida no duplica stock ni movimientos.');

    const customerName = `Cliente robot ${marker}`;
    const customer = await expectHttp(ownerA, '/api/clientes', {
      method: 'POST', body: {
        nombre: customerName, telefono: '70001002',
        permiteFiado: true, limiteCredito: 100
      }
    }, 201, 'Crear cliente A');
    const customerB = await expectHttp(ownerB, '/api/clientes', {
      method: 'POST', body: { nombre: `Cliente ajeno ${marker}`, telefono: '70001003' }
    }, 201, 'Crear cliente B');

    const browserSale = await runBrowserFlow({
      baseUrl: server.baseUrl,
      username: storeA.body.propietario.usuario,
      password: storeA.password,
      productName, customerName
    });
    ok(await scalar(connection, 'SELECT COUNT(*) total FROM venta WHERE idTienda=? AND idVenta=?',
      [idTiendaA, browserSale.idVenta]) === 1,
    'La activacion desde browser produce una sola venta logica.');

    const creditPayload = {
      claveOperacion: `credit-robot-${marker}`, idCliente: customer.idCliente,
      items: [{ idProducto: product.idProducto, cantidad: 2, presentacion: 'unidad' }],
      pagos: [], saldoFiado: 20
    };
    const creditSale = await expectHttp(ownerA, '/api/pos/ventas', {
      method: 'POST', body: creditPayload
    }, 201, 'Registrar venta a credito');
    const repeatedCredit = await expectHttp(ownerA, '/api/pos/ventas', {
      method: 'POST', body: creditPayload
    }, 200, 'Repetir venta a credito');
    ok(repeatedCredit.repetida === true && repeatedCredit.idVenta === creditSale.idVenta,
      'La venta a credito es idempotente.');

    const collectionPayload = {
      idFiado: creditSale.idFiado, monto: 5, metodoPago: 'efectivo',
      claveOperacion: `collection-robot-${marker}`, observacion: 'Cobranza parcial sintetica'
    };
    await expectHttp(ownerA, '/api/pagos-fiado', {
      method: 'POST', body: collectionPayload
    }, 201, 'Registrar cobranza parcial');
    const repeatedCollection = await expectHttp(ownerA, '/api/pagos-fiado', {
      method: 'POST', body: collectionPayload
    }, 200, 'Repetir cobranza parcial');
    ok(repeatedCollection.repetido === true, 'La cobranza repetida no duplica el pago.');

    const [[detail]] = await connection.query(
      'SELECT idDetalleVenta FROM detalleVenta WHERE idTienda=? AND idVenta=?',
      [idTiendaA, creditSale.idVenta]
    );
    const compensationPayload = {
      confirmar: true, tipoCompensacion: 'devolucion_parcial',
      claveOperacion: `return-robot-${marker}`, motivoCodigo: 'devolucion_cliente',
      detalles: [{
        idDetalleVenta: detail.idDetalleVenta, unidadesDevueltas: 1,
        tratamientoInventario: 'reintegrar_vendible'
      }]
    };
    await expectHttp(ownerA, `/api/ventas/${creditSale.idVenta}/compensaciones`, {
      method: 'POST', body: compensationPayload
    }, 201, 'Registrar devolucion parcial');
    const repeatedCompensation = await expectHttp(ownerA,
      `/api/ventas/${creditSale.idVenta}/compensaciones`,
      { method: 'POST', body: compensationPayload }, 200, 'Repetir devolucion parcial');
    ok(repeatedCompensation.repetida === true,
      'La devolucion repetida conserva una sola compensacion logica.');

    const dashboard = await expectHttp(ownerA, '/api/dashboard', {}, 200, 'Consultar Inicio');
    const sales = await expectHttp(ownerA, '/api/ventas', {}, 200, 'Consultar historial');
    ok(Number(dashboard.ventasHoy) >= 30 && sales.some((sale) => sale.idVenta === creditSale.idVenta),
      'Inicio e historial reflejan las operaciones del recorrido.');

    const subscription = await expectHttp(ownerA, '/api/suscripcion', {}, 200, 'Consultar Mi plan');
    const planChoices = await expectHttp(ownerA, '/api/suscripcion/planes', {}, 200, 'Consultar planes');
    const paymentPlans = await expectHttp(ownerA, '/api/pagos-suscripcion/planes', {}, 200,
      'Consultar catalogo publico de pagos');
    ok(subscription.plan?.codigo === 'pro',
      'La suscripcion sintetica conserva el plan Pro sin alteraciones.');
    ok(Array.isArray(planChoices.planes) && planChoices.planes.length >= 3,
      'Mi plan expone opciones sin cambiar la suscripcion.');
    const codes = (paymentPlans.planes || paymentPlans || [])
      .map((plan) => plan.referencia || plan.codigo || plan.slug);
    ok(['basico', 'standard', 'pro'].every((code) => codes.includes(code))
      && !codes.includes('avanzado'),
    'Pagos expone Basic, Standard y Pro, y oculta avanzado legado.');

    const productsA = await expectHttp(ownerA, '/api/productos', {}, 200, 'Listar productos A');
    const customersA = await expectHttp(ownerA, '/api/clientes', {}, 200, 'Listar clientes A');
    ok(!productsA.some((item) => Number(item.idProducto) === Number(productB.idProducto)),
      'El tenant A no lee productos del tenant B.');
    ok(!customersA.some((item) => Number(item.idCliente) === Number(customerB.idCliente)),
      'El tenant A no lee clientes del tenant B.');
    await expectHttp(ownerA, `/api/pos/productos/${productB.idProducto}`, {}, 404,
      'El tenant A no consulta el producto B por ID.');
    await expectHttp(ownerA, `/api/productos/${productB.idProducto}`, {
      method: 'PUT', body: productPayload('Intento cruzado')
    }, 404, 'El tenant A no edita el producto B.');
    await expectHttp(ownerA, `/api/clientes/${customerB.idCliente}`, {}, 404,
      'El tenant A no consulta el cliente B por ID.');
    await expectHttp(ownerA, '/api/pos/ventas', {
      method: 'POST', body: {
        claveOperacion: `cross-robot-${marker}`,
        items: [{ idProducto: productB.idProducto, cantidad: 1, presentacion: 'unidad' }],
        pagos: [{ metodoPago: 'efectivo', monto: 10 }]
      }
    }, 404, 'El tenant A no vende stock del tenant B.');

    const [[stock]] = await connection.query(
      'SELECT stockUnidadesTotal FROM producto WHERE idTienda=? AND idProducto=?',
      [idTiendaA, product.idProducto]
    );
    const [[credit]] = await connection.query(
      `SELECT f.saldoPendiente, v.saldoPendiente saldoVenta,
              COALESCE((
                SELECT SUM(lcv.montoReduccionDeudaPendiente)
                FROM liquidacionCompensacionVenta lcv
                JOIN compensacionVenta cv
                  ON cv.idTienda=lcv.idTienda
                 AND cv.idCompensacionVenta=lcv.idCompensacionVenta
                WHERE cv.idTienda=v.idTienda AND cv.idVenta=v.idVenta
              ),0) reduccionDeuda
       FROM fiado f JOIN venta v ON v.idTienda=f.idTienda AND v.idVenta=f.idVenta
       WHERE f.idTienda=? AND f.idFiado=?`,
      [idTiendaA, creditSale.idFiado]
    );
    ok(Number(stock.stockUnidadesTotal) === 10,
      'Compra, ventas y devolucion dejan stock final coherente.');
    ok(Number(credit.saldoPendiente) === 15
      && Number(credit.saldoVenta) === 15
      && Number(credit.reduccionDeuda) === 10
      && Number(credit.saldoPendiente) - Number(credit.reduccionDeuda) === 5,
    'Credito, cobranza y devolucion dejan saldo efectivo coherente sin reescribir historicos.');
    ok(await scalar(connection, 'SELECT COUNT(*) total FROM pagoFiado WHERE idTienda=? AND idFiado=?',
      [idTiendaA, creditSale.idFiado]) === 1, 'La cobranza conserva un solo pago.');
    ok(await scalar(connection, 'SELECT COUNT(*) total FROM compensacionVenta WHERE idTienda=? AND idVenta=?',
      [idTiendaA, creditSale.idVenta]) === 1, 'La devolucion conserva una sola compensacion.');
    ok(await scalar(connection,
      'SELECT COUNT(*) total FROM movimientoStock WHERE idTienda=? AND idProducto=?',
      [idTiendaA, product.idProducto]) >= 4,
    'Las entradas, salidas y reintegro conservan trazabilidad.');
    ok(await scalar(connection,
      'SELECT COUNT(*) total FROM producto WHERE idTienda=? AND stockUnidadesTotal<0',
      [idTiendaA]) === 0, 'Ninguna operacion valida deja stock negativo.');
    ok(await scalar(connection, 'SELECT COUNT(*) total FROM tienda WHERE idTienda IN (?, ?)',
      [idTiendaA, idTiendaB]) === 2, 'Los dos tenants sinteticos permanecen separados.');
  } finally {
    await stopServer(server?.child);
    if (connection) await connection.end();
    await serverConnection.query(`DROP DATABASE IF EXISTS ${quoteTemporaryDatabase(temporaryDatabase)}`);
    const [remaining] = await serverConnection.query(
      'SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=?',
      [temporaryDatabase]
    );
    ok(remaining.length === 0, 'La base temporal del E2E se elimina en finally.');
    await serverConnection.end();
  }
  console.log('test:e2e-critical-business OK');
}

main().catch((error) => {
  console.error(`test:e2e-critical-business FAIL: ${safeError(error)}`);
  process.exitCode = 1;
});
