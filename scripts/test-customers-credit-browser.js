const crypto = require('crypto');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const bcrypt = require('bcryptjs');
const { chromium } = require('playwright-core');
const { createDatabaseConnection } = require('../config/database-connection');
const { requireLocalhostDatabase } = require('../config/env');
const { formatLocalDate, formatLocalDateTime, addLocalDays, getLocalNow } = require('../utils/local-datetime');
const { applyTestRequestSecurity } = require('./http-test-security');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class HttpSession {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
    this.cookie = '';
  }

  async request(route, options = {}) {
    const request = { ...options, headers: { ...(options.headers || {}) }, redirect: 'manual' };
    if (request.body && typeof request.body !== 'string') {
      request.headers['content-type'] = 'application/json';
      request.body = JSON.stringify(request.body);
    }
    applyTestRequestSecurity(this.baseUrl, request);
    if (this.cookie) request.headers.cookie = this.cookie;
    const response = await fetch(`${this.baseUrl}${route}`, request);
    const cookie = response.headers.get('set-cookie');
    if (cookie) this.cookie = cookie.split(';')[0];
    const text = await response.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = text; }
    return { status: response.status, body, headers: response.headers };
  }
}

async function expectHttp(session, route, options, status, label) {
  const response = await session.request(route, options);
  if (response.status !== status) {
    throw new Error(`${label}: HTTP ${response.status}, esperado ${status}. ${JSON.stringify(response.body)}`);
  }
  return response.body;
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function waitForServer(baseUrl, child, output) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`El servidor temporal termino antes de iniciar. ${output.join('\n')}`);
    try {
      const response = await fetch(`${baseUrl}/login.html`);
      if (response.ok) return;
    } catch { /* the socket is not ready yet */ }
    await delay(100);
  }
  throw new Error(`El servidor temporal no respondio a tiempo. ${output.join('\n')}`);
}

function browserExecutable() {
  const candidates = [
    process.env.BROWSER_EXECUTABLE_PATH,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  ].filter(Boolean);
  const executable = candidates.find((candidate) => fs.existsSync(candidate));
  if (!executable) throw new Error('No se encontro Edge o Chrome. Configura BROWSER_EXECUTABLE_PATH.');
  return executable;
}

async function resolvePlans(connection, superSession) {
  const plans = await expectHttp(superSession, '/api/admin/planes', {}, 200, 'Listar planes');
  const [rows] = await connection.query(
    `SELECT p.idPlan, f.codigo funcionalidad
     FROM plan p
     JOIN planFuncionalidad pf ON pf.idPlan=p.idPlan AND pf.habilitada=1
     JOIN funcionalidad f ON f.idFuncionalidad=pf.idFuncionalidad AND f.activo=1
     WHERE p.activo=1`
  );
  const featureMap = new Map();
  rows.forEach((row) => {
    if (!featureMap.has(Number(row.idPlan))) featureMap.set(Number(row.idPlan), new Set());
    featureMap.get(Number(row.idPlan)).add(row.funcionalidad);
  });
  const available = plans.filter((plan) => Number(plan.activo) === 1).map((plan) => ({
    ...plan,
    features: featureMap.get(Number(plan.idPlan)) || new Set()
  }));
  const basicFeatures = ['clientes_basico', 'fiados_basico', 'pagos_fiado', 'estado_cuenta_basico'];
  const advancedFeatures = ['limites_credito', 'seguimiento_cobranza', 'recordatorios_fiado', 'exportacion_clientes_fiados', 'segmentacion_clientes'];
  const advanced = available.find((plan) => [...basicFeatures, ...advancedFeatures].every((feature) => plan.features.has(feature)));
  const basic = available.find((plan) => basicFeatures.every((feature) => plan.features.has(feature))
    && advancedFeatures.every((feature) => !plan.features.has(feature)));
  assert(advanced && basic, 'La prueba necesita planes basico y avanzado reales con sus funciones esperadas.');
  return { advanced, basic };
}

function storePayload(marker, kind, planCode) {
  const password = `Browser-${kind}-${crypto.randomBytes(10).toString('hex')}!`;
  return {
    password,
    body: {
      nombre: `Tienda browser ${kind} ${marker}`,
      slug: `tienda-browser-${kind}-${marker}`,
      estado: 'activa',
      activo: true,
      propietario: {
        usuario: `owner_browser_${kind}_${marker}`,
        password,
        confirmacionPassword: password,
        activo: true
      },
      suscripcion: { planCodigo: planCode, tipo: 'cortesia', duracionDias: 30 }
    }
  };
}

async function cleanupStore(connection, idTienda) {
  if (!idTienda) return;
  const tables = [
    'seguimientoCobranza', 'cierreCaja', 'gasto', 'categoriaGasto', 'movimientoLote', 'loteProducto',
    'movimientoStock', 'pagoVenta', 'pagoFiado', 'cobroFiado', 'detalleFiado', 'detalleVenta',
    'detalleCompra', 'fiado', 'venta', 'compra', 'producto', 'cliente', 'proveedor',
    'plantillaCobranzaTienda', 'configuracionCreditoTienda', 'configuracionInventarioTienda',
    'suscripcionTienda', 'administrador', 'tienda'
  ];
  for (const table of tables) await connection.query(`DELETE FROM ${table} WHERE idTienda=?`, [idTienda]);
}

async function login(page, baseUrl, user, password) {
  await page.goto(`${baseUrl}/login.html`);
  await page.locator('[name="usuario"]').fill(user);
  await page.locator('[name="password"]').fill(password);
  await Promise.all([
    page.waitForURL('**/app.html'),
    page.getByRole('button', { name: /Iniciar sesi/i }).click()
  ]);
  await page.locator('#menu').waitFor();
  await page.locator('#menu').getByRole('button', { name: 'Clientes', exact: true }).waitFor();
}

async function openMenu(page, name, readySelector) {
  await page.locator('#menu').getByRole('button', { name, exact: true }).click();
  await page.locator(readySelector).waitFor();
}

async function closeSuccess(page) {
  const button = page.locator('#modalRoot [data-modal-confirm]');
  if (await button.count()) await button.click();
}

async function accessibilitySnapshot(page) {
  return page.evaluate(() => {
    const visible = (element) => Boolean(element.offsetWidth || element.offsetHeight || element.getClientRects().length);
    const controls = [...document.querySelectorAll('input, select, textarea')].filter(visible);
    const unnamedFields = controls.filter((field) => {
      const idLabel = field.id && document.querySelector(`label[for="${CSS.escape(field.id)}"]`);
      return !field.closest('label') && !idLabel && !field.getAttribute('aria-label') && !field.getAttribute('aria-labelledby');
    }).map((field) => field.name || field.id || field.outerHTML.slice(0, 80));
    const unnamedButtons = [...document.querySelectorAll('button')].filter(visible).filter((button) =>
      !button.textContent.trim() && !button.getAttribute('aria-label') && !button.getAttribute('title')
    ).length;
    const unnamedDialogs = [...document.querySelectorAll('[role="dialog"]')].filter((dialog) =>
      !dialog.getAttribute('aria-label') && !dialog.getAttribute('aria-labelledby')
    ).length;
    const positiveTabIndex = [...document.querySelectorAll('[tabindex]')].filter((element) => Number(element.tabIndex) > 0).length;
    return { unnamedFields, unnamedButtons, unnamedDialogs, positiveTabIndex };
  });
}

async function assertResponsive(page, width, height) {
  await page.setViewportSize({ width, height });
  await delay(80);
  const layout = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
    modal: (() => {
      const element = document.querySelector('#modalRoot .modal');
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
    })()
  }));
  assert(layout.documentWidth <= layout.viewportWidth + 2, `Hay overflow global a ${width}px: ${layout.documentWidth}px.`);
  if (layout.modal) {
    assert(layout.modal.left >= -2 && layout.modal.right <= width + 2, `El modal sale horizontalmente a ${width}px.`);
    assert(layout.modal.top < height && layout.modal.bottom > 0, `El modal no es alcanzable a ${width}px.`);
  }
}

async function browserFetch(page, route, options = {}) {
  return page.evaluate(async ({ route: requestRoute, options: requestOptions }) => {
    const response = await window.SecurityHttp.secureFetch(requestRoute, {
      ...requestOptions,
      headers: { 'Content-Type': 'application/json', ...(requestOptions.headers || {}) }
    });
    return { status: response.status, body: await response.json().catch(() => null) };
  }, { route, options });
}

async function main() {
  const config = { ...requireLocalhostDatabase('La prueba browser de clientes y cobranza'), decimalNumbers: true };
  assert(/(prueba|test)/i.test(config.database), 'La base local debe contener prueba o test en su nombre.');
  const marker = crypto.randomBytes(6).toString('hex');
  const artifactDir = fs.mkdtempSync(path.join(os.tmpdir(), `tienda-browser-${marker}-`));
  const fixture = { stores: [], superUser: `super_browser_${marker}` };
  const superPassword = `Super-${crypto.randomBytes(12).toString('hex')}!`;
  const checks = [];
  let connection;
  let server;
  let browser;
  const serverOutput = [];

  const check = (condition, label) => {
    assert(condition, label);
    checks.push(label);
    process.stdout.write(`OK ${checks.length}: ${label}\n`);
  };

  try {
    connection = await createDatabaseConnection(config);
    const port = await freePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    server = spawn(process.execPath, ['server.js'], {
      cwd: path.join(__dirname, '..'),
      env: {
        ...process.env,
        APP_ENV: 'local',
        DB_HOST: 'localhost',
        PORT: String(port),
        TRUSTED_ORIGINS: baseUrl,
        RATE_LIMIT_ENABLED: 'false',
        SECURITY_LOG_LEVEL: 'off'
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    const collect = (chunk) => {
      serverOutput.push(String(chunk).trim());
      if (serverOutput.length > 20) serverOutput.shift();
    };
    server.stdout.on('data', collect);
    server.stderr.on('data', collect);
    await waitForServer(baseUrl, server, serverOutput);

    await connection.query(
      "INSERT INTO administrador (idTienda,usuario,password,rol,activo) VALUES (NULL,?,?,'superadmin',1)",
      [fixture.superUser, await bcrypt.hash(superPassword, 12)]
    );
    const superSession = new HttpSession(baseUrl);
    await expectHttp(superSession, '/auth/login', { method: 'POST', body: { usuario: fixture.superUser, password: superPassword } }, 200, 'Login superadmin');
    const plans = await resolvePlans(connection, superSession);
    const advancedStore = storePayload(marker, 'avanzada', plans.advanced.codigo);
    const basicStore = storePayload(marker, 'basica', plans.basic.codigo);
    const otherStore = storePayload(marker, 'aislada', plans.advanced.codigo);
    for (const item of [advancedStore, basicStore, otherStore]) {
      const created = await expectHttp(superSession, '/api/admin/tiendas', { method: 'POST', body: item.body }, 201, `Crear ${item.body.nombre}`);
      item.idTienda = created.tienda.idTienda;
      item.idSuscripcion = created.suscripcion.idSuscripcion;
      fixture.stores.push(item.idTienda);
    }
    const advancedApi = new HttpSession(baseUrl);
    const basicApi = new HttpSession(baseUrl);
    const otherApi = new HttpSession(baseUrl);
    await expectHttp(advancedApi, '/auth/login', { method: 'POST', body: { usuario: advancedStore.body.propietario.usuario, password: advancedStore.password } }, 200, 'Login API avanzado');
    await expectHttp(basicApi, '/auth/login', { method: 'POST', body: { usuario: basicStore.body.propietario.usuario, password: basicStore.password } }, 200, 'Login API basico');
    await expectHttp(otherApi, '/auth/login', { method: 'POST', body: { usuario: otherStore.body.propietario.usuario, password: otherStore.password } }, 200, 'Login API aislado');
    await expectHttp(advancedApi, '/api/configuracion-credito', { method: 'PUT', body: {
      limiteCreditoDefault: 500, diasCreditoDefault: 30, diasAvisoVencimiento: 3,
      politicaFiadoVencido: 'permitir', requiereTelefonoParaFiado: false,
      permiteFiadoSinFecha: true, codigoPaisWhatsApp: '591'
    } }, 200, 'Configurar credito');
    const product = await expectHttp(advancedApi, '/api/productos', { method: 'POST', body: {
      nombre: `Producto browser ${marker}`, categoria: 'OTROS', unidadMedida: 'unidad',
      unidadesPorPaquete: 1, paquetesPorCaja: 1, precioVenta: 20, stockMinimo: 1,
      stockUnidadesTotal: 100, ultimoPrecioCompra: 8,
      permiteVentaPorPaquete: false, permiteVentaPorUnidad: true
    } }, 201, 'Crear producto browser');
    const otherCustomer = await expectHttp(otherApi, '/api/clientes', { method: 'POST', body: {
      nombre: `Cliente aislado ${marker}`, telefono: '70000999'
    } }, 201, 'Crear cliente aislado');

    browser = await chromium.launch({ executablePath: browserExecutable(), headless: true });
    const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1366, height: 768 } });
    const page = await context.newPage();
    await page.addInitScript(() => {
      window.__printCalls = 0;
      window.print = () => { window.__printCalls += 1; };
      window.__openedUrls = [];
      window.open = (url) => { window.__openedUrls.push(String(url)); return null; };
    });
    await login(page, baseUrl, advancedStore.body.propietario.usuario, advancedStore.password);
    check(await page.locator('#menu').getByRole('button', { name: 'Clientes', exact: true }).count() === 1, 'La sesion avanzada muestra Clientes.');
    check(await page.locator('#menu').getByRole('button', { name: 'Cobranza', exact: true }).count() === 1, 'La sesion avanzada muestra Cobranza.');

    await openMenu(page, 'Clientes', '#customerFilters');
    check(await page.locator('[data-customer-segmentation]').count() === 1, 'El plan avanzado muestra Segmentacion.');
    check(await page.locator('[data-export-customers]').count() === 1, 'El plan avanzado muestra exportacion de clientes.');
    const trigger = page.locator('[data-new-customer]');
    await trigger.focus();
    await trigger.click();
    await page.locator('[data-credit-modal]').waitFor();
    check(await page.evaluate(() => document.activeElement?.name === 'nombre'), 'El modal coloca el foco en el primer campo.');
    const focusBeforeTrap = await page.locator('[data-credit-modal] [data-modal-submit]').focus().then(() => true);
    await page.keyboard.press('Tab');
    check(focusBeforeTrap && await page.evaluate(() => document.activeElement?.name === 'nombre'), 'El foco queda atrapado dentro del modal.');
    await page.locator('[data-credit-modal] [name="nombre"]').fill(`Cliente UI ${marker}`);
    await page.locator('[data-credit-modal] [name="telefono"]').fill('76543210');
    await page.locator('[data-credit-modal] [name="documentoIdentidad"]').fill(`UI-${marker}`);
    await page.locator('[data-credit-modal] [name="limiteCredito"]').fill('300');
    let customerPosts = 0;
    await page.route('**/api/clientes', async (route) => {
      if (route.request().method() === 'POST') {
        customerPosts += 1;
        await delay(180);
      }
      await route.continue();
    });
    await page.locator('[data-credit-modal]').evaluate((form) => {
      form.querySelector('[data-modal-submit]').click();
      form.querySelector('[data-modal-submit]').click();
    });
    await page.getByRole('heading', { name: 'Listo' }).waitFor();
    check(customerPosts === 1, 'El doble clic no duplica la creacion del cliente.');
    await closeSuccess(page);
    await page.unroute('**/api/clientes');
    await page.locator('#customerFilters').waitFor();
    check(await page.getByText(`Cliente UI ${marker}`, { exact: true }).count() >= 1, 'El cliente creado aparece en el listado.');
    const [[createdCustomer]] = await connection.query('SELECT idCliente FROM cliente WHERE idTienda=? AND documentoNormalizado=?', [advancedStore.idTienda, `UI${marker.toUpperCase()}`]);
    assert(createdCustomer, 'No se encontro el cliente creado desde la interfaz.');

    await page.locator('[data-new-customer]').click();
    await page.locator('[data-credit-modal] [name="nombre"]').fill(`Documento duplicado ${marker}`);
    await page.locator('[data-credit-modal] [name="documentoIdentidad"]').fill(`UI ${marker}`);
    await page.locator('[data-modal-submit]').click();
    await page.locator('[data-form-error]').waitFor();
    check(await page.locator('[data-form-error]').textContent() !== '', 'El conflicto 409 queda asociado al formulario sin cerrarlo.');
    await page.keyboard.press('Escape');
    const [[sameDocument]] = await connection.query('SELECT COUNT(*) total FROM cliente WHERE idTienda=? AND documentoNormalizado=?', [advancedStore.idTienda, `UI${marker.toUpperCase()}`]);
    check(Number(sameDocument.total) === 1, 'El documento duplicado no crea otro cliente.');

    await page.locator(`[data-customer-edit="${createdCustomer.idCliente}"]`).first().click();
    await page.locator('[data-credit-modal] [name="direccion"]').fill(`Direccion editada ${marker}`);
    await page.locator('[data-modal-submit]').click();
    await page.getByRole('heading', { name: 'Listo' }).waitFor();
    await closeSuccess(page);
    const [[edited]] = await connection.query('SELECT direccion FROM cliente WHERE idTienda=? AND idCliente=?', [advancedStore.idTienda, createdCustomer.idCliente]);
    check(edited.direccion === `Direccion editada ${marker}`, 'La edicion desde UI persiste los cambios.');

    await page.locator(`[data-customer-view="${createdCustomer.idCliente}"]`).first().click();
    await page.locator('.customer-profile-modal').waitFor();
    check((await accessibilitySnapshot(page)).unnamedDialogs === 0, 'La ficha tiene nombre accesible.');
    await page.keyboard.press('Escape');
    check(await page.locator('.customer-profile-modal').count() === 0, 'Escape cierra la ficha.');
    check(await page.evaluate(() => document.activeElement?.dataset?.customerView !== undefined), 'Cerrar devuelve el foco al disparador.');

    await page.locator(`[data-customer-hide="${createdCustomer.idCliente}"]`).first().click();
    check((await page.locator('#modalRoot').textContent()).includes('No se eliminara su historial'), 'Ocultar explica que conserva el historial.');
    await page.locator('[data-modal-cancel]').click();
    check(await page.locator(`[data-customer-hide="${createdCustomer.idCliente}"]`).count() >= 1, 'Cancelar ocultacion no cambia al cliente.');
    await page.locator(`[data-customer-hide="${createdCustomer.idCliente}"]`).first().click();
    await page.locator('#adminDeletePassword').fill(advancedStore.password);
    await page.locator('[data-modal-confirm]').click();
    await page.getByRole('heading', { name: 'Listo' }).waitFor();
    await closeSuccess(page);
    await page.locator('#customerFilters [name="estado"]').selectOption('ocultos');
    await page.locator('#customerFilters').evaluate((form) => form.requestSubmit());
    await page.getByText(`Cliente UI ${marker}`, { exact: true }).first().waitFor();
    check((await page.locator('#customerResults').textContent()).includes('Oculto'), 'El listado de ocultos muestra el badge correspondiente.');
    await page.locator(`[data-customer-restore="${createdCustomer.idCliente}"]`).first().click();
    await page.locator('#adminDeletePassword').fill(advancedStore.password);
    await page.locator('[data-modal-confirm]').click();
    await page.getByRole('heading', { name: 'Listo' }).waitFor();
    await closeSuccess(page);
    const [[restored]] = await connection.query('SELECT activo,eliminadoEn FROM cliente WHERE idTienda=? AND idCliente=?', [advancedStore.idTienda, createdCustomer.idCliente]);
    check(Number(restored.activo) === 1 && restored.eliminadoEn === null, 'Restaurar reactiva sin conservar fecha de ocultacion.');

    await openMenu(page, 'Punto de venta', '#posForm');
    await page.locator('#posSearch').fill(`Producto browser ${marker}`);
    await page.locator(`[data-pos-add="${product.idProducto}"]`).waitFor();
    await page.locator(`[data-pos-add="${product.idProducto}"]`).click();
    await page.locator('#posClient').selectOption(String(createdCustomer.idCliente));
    await page.locator('#posPaymentMode').selectOption('fiado');
    await page.locator('#posCreditDueDate').waitFor();
    check((await page.locator('#posCreditSummary').textContent()).includes('Cliente habilitado para fiado'), 'POS muestra el resumen de credito real.');
    await page.locator('#posSubmit').click();
    await page.locator('[data-modal-confirm]').click();
    await page.getByRole('heading', { name: 'Venta confirmada' }).waitFor();
    check((await page.locator('#saleReceipt').textContent()).includes('Saldo pendiente'), 'La venta fiada muestra deuda en el comprobante.');
    await page.locator('[data-modal-confirm]').click();
    const debtList = await expectHttp(advancedApi, `/api/fiados?cliente=${createdCustomer.idCliente}&pagina=1&limite=20`, {}, 200, 'Consultar deuda creada');
    const debt = (debtList.fiados || debtList)[0];
    assert(debt, 'La venta fiada no genero una deuda.');

    await openMenu(page, 'Cobranza', '#collectionFilters');
    check(await page.locator(`[data-debt-pay="${debt.idFiado}"]`).count() >= 1, 'La deuda aparece en Cobranza.');
    await page.locator(`[data-debt-pay="${debt.idFiado}"]`).first().click();
    await page.locator('[name="monto"]').fill('5');
    await page.locator('[name="montoRecibido"]').fill('10');
    check(await page.locator('[name="cambioVisual"]').inputValue() === '5.00', 'El cambio se calcula visualmente.');
    let paymentPosts = 0;
    await page.route(`**/api/fiados/${debt.idFiado}/pagos`, async (route) => {
      paymentPosts += 1;
      await delay(220);
      await route.continue();
    });
    await page.locator('[data-credit-modal]').evaluate((form) => {
      form.querySelector('[data-modal-submit]').click();
      form.querySelector('[data-modal-submit]').click();
    });
    await page.getByRole('heading', { name: 'Listo' }).waitFor();
    await closeSuccess(page);
    await page.locator('.receipt-modal').waitFor();
    check(paymentPosts === 1, 'El doble clic registra un solo cobro.');
    check((await page.locator('[data-print-receipt]').textContent()).includes('5.00'), 'El comprobante usa el monto historico del cobro.');
    await page.locator('[data-receipt-print]').click();
    check(await page.evaluate(() => window.__printCalls === 1), 'Imprimir comprobante activa la impresion del navegador.');
    check((await page.locator('.receipt-modal').textContent()).includes('No es una factura fiscal'), 'El comprobante no se presenta como factura.');
    await page.locator('[data-modal-cancel]').click();
    await page.unroute(`**/api/fiados/${debt.idFiado}/pagos`);
    const [[paymentCount]] = await connection.query(
      `SELECT COUNT(*) total FROM pagoFiado pf
       JOIN cobroFiado cf ON cf.idTienda=pf.idTienda AND cf.idCobroFiado=pf.idCobroFiado
       WHERE pf.idTienda=? AND pf.idFiado=? AND cf.montoTotal=5`,
      [advancedStore.idTienda, debt.idFiado]
    );
    check(Number(paymentCount.total) === 1, 'La idempotencia conserva una sola distribucion de pago.');

    await openMenu(page, 'Cobranza', '#collectionFilters');
    const [[remainingOriginal]] = await connection.query('SELECT saldoPendiente FROM fiado WHERE idTienda=? AND idFiado=?', [advancedStore.idTienda, debt.idFiado]);
    await page.locator(`[data-debt-pay="${debt.idFiado}"]`).first().click();
    await page.locator('[data-credit-modal] [name="monto"]').fill(String(remainingOriginal.saldoPendiente));
    await page.locator('[data-credit-modal] [name="metodoPago"]').selectOption('transferencia');
    await page.locator('[data-modal-submit]').click();
    await page.getByRole('heading', { name: 'Listo' }).waitFor();
    await closeSuccess(page);
    await page.locator('.receipt-modal').waitFor();
    await page.locator('[data-modal-cancel]').click();
    const [[closedOriginal]] = await connection.query('SELECT saldoPendiente,estado,cerradoEn FROM fiado WHERE idTienda=? AND idFiado=?', [advancedStore.idTienda, debt.idFiado]);
    check(Number(closedOriginal.saldoPendiente) === 0 && closedOriginal.estado === 'pagado' && closedOriginal.cerradoEn, 'El cobro total cierra la deuda desde la interfaz.');

    for (const suffix of ['acumulado-a', 'acumulado-b']) {
      await expectHttp(advancedApi, '/api/pos/ventas', { method: 'POST', body: {
        claveOperacion: `browser:${suffix}:${marker}`,
        idCliente: createdCustomer.idCliente,
        items: [{ idProducto: product.idProducto, cantidad: 1, presentacion: 'unidad' }],
        pagos: [],
        fechaVencimiento: formatLocalDate(addLocalDays(getLocalNow(), 30))
      } }, 201, `Crear deuda ${suffix}`);
    }
    await openMenu(page, 'Cobranza', '#collectionFilters');
    const openDebtsResponse = await expectHttp(advancedApi, `/api/fiados?cliente=${createdCustomer.idCliente}&pagina=1&limite=20`, {}, 200, 'Listar deudas para pago acumulado');
    const openDebts = (openDebtsResponse.fiados || openDebtsResponse).filter((item) => Number(item.saldoPendiente) > 0);
    assert(openDebts.length === 2, 'Se esperaban dos deudas abiertas para el pago acumulado.');
    await page.locator(`[data-customer-pay-accum="${createdCustomer.idCliente}"]`).first().click();
    await page.locator('[data-credit-modal] [name="monto"]').fill('25');
    await page.locator('[data-credit-modal] [name="metodoPago"]').selectOption('transferencia');
    await page.locator('[data-modal-submit]').click();
    await page.getByRole('heading', { name: 'Listo' }).waitFor();
    await closeSuccess(page);
    await page.locator('.receipt-modal').waitFor();
    check(await page.locator('.receipt-distribution').count() === 2, 'El comprobante acumulado muestra dos distribuciones.');
    await page.locator('[data-modal-cancel]').click();
    const [[accumulatedPayment]] = await connection.query(
      `SELECT cf.idCobroFiado,cf.montoTotal,COUNT(pf.idPagoFiado) distribuciones,SUM(pf.monto) distribuido
       FROM cobroFiado cf
       JOIN pagoFiado pf ON pf.idTienda=cf.idTienda AND pf.idCobroFiado=cf.idCobroFiado
       WHERE cf.idTienda=? AND cf.idCliente=? AND cf.montoTotal=25
       GROUP BY cf.idCobroFiado,cf.montoTotal
       ORDER BY cf.idCobroFiado DESC LIMIT 1`,
      [advancedStore.idTienda, createdCustomer.idCliente]
    );
    check(Number(accumulatedPayment.distribuciones) === 2 && Number(accumulatedPayment.distribuido) === 25, 'El pago acumulado distribuye el monto exacto entre deudas.');
    const refreshedDebts = await expectHttp(advancedApi, `/api/fiados?cliente=${createdCustomer.idCliente}&pagina=1&limite=20`, {}, 200, 'Actualizar deudas abiertas');
    const followupDebt = (refreshedDebts.fiados || refreshedDebts).find((item) => Number(item.saldoPendiente) > 0);
    assert(followupDebt, 'Debe quedar una deuda parcial para seguimiento.');

    await page.locator(`[data-debt-followup="${followupDebt.idFiado}"]`).first().click();
    await page.locator('[name="tipo"]').selectOption('llamada');
    await page.locator('[name="canal"]').selectOption('telefono');
    await page.locator('[name="detalle"]').fill(`Llamada browser ${marker}`);
    await page.locator('[data-modal-submit]').click();
    await page.getByRole('heading', { name: 'Listo' }).waitFor();
    await closeSuccess(page);
    const [[followup]] = await connection.query('SELECT COUNT(*) total FROM seguimientoCobranza WHERE idTienda=? AND idFiado=? AND detalle=?', [advancedStore.idTienda, followupDebt.idFiado, `Llamada browser ${marker}`]);
    check(Number(followup.total) === 1, 'El seguimiento creado desde UI queda en el historial.');

    await page.locator('[data-manage-templates]').click();
    await page.locator('.template-manager').waitFor();
    await page.locator('[data-template-new]').click();
    await page.locator('[name="nombre"]').fill(`Plantilla browser ${marker}`);
    await page.locator('[name="contenido"]').fill(`<script>window.__xssExecuted=true</script> Hola {{cliente}}, saldo {{saldo}}`);
    check(await page.evaluate(() => window.__xssExecuted !== true), 'La vista previa de plantilla no ejecuta HTML.');
    await page.locator('[name="contenido"]').fill(`<b>Recordatorio</b> Hola {{cliente}}, saldo {{saldo}}`);
    await page.locator('[data-modal-submit]').click();
    await page.getByRole('heading', { name: 'Listo' }).waitFor();
    await closeSuccess(page);
    await page.locator('.template-manager').waitFor();
    check((await page.locator('.template-manager').textContent()).includes('<b>Recordatorio</b>'), 'El HTML no ejecutable de plantilla se muestra como texto.');
    await page.keyboard.press('Escape');

    await page.locator(`[data-debt-whatsapp="${followupDebt.idFiado}"]`).first().click();
    await page.locator('[name="tipoPlantilla"]').selectOption('recordatorio_previo');
    const templateOption = page.locator('[name="idPlantillaCobranza"] option', { hasText: `Plantilla browser ${marker}` });
    if (await templateOption.count()) await page.locator('[name="idPlantillaCobranza"]').selectOption(await templateOption.getAttribute('value'));
    await page.locator('[data-modal-submit]').click();
    await page.locator('[data-whatsapp-preview] textarea').waitFor();
    check((await page.locator('[data-whatsapp-preview] textarea').inputValue()).includes(`Cliente UI ${marker}`), 'WhatsApp sustituye variables con datos reales.');
    const whatsappButton = page.locator('[data-open-whatsapp]');
    check(await whatsappButton.count() === 1, 'WhatsApp solo ofrece apertura cuando el backend devuelve URL.');
    await whatsappButton.click();
    const opened = await page.evaluate(() => window.__openedUrls.at(-1));
    check(/^https:\/\/wa\.me\/591\d+\?text=/.test(opened), 'La URL de WhatsApp usa HTTPS, numero normalizado y texto codificado.');
    check(!(await page.locator('[data-whatsapp-preview]').textContent()).includes('enviado automaticamente'), 'La vista no afirma un envio automatico.');
    await page.keyboard.press('Escape');

    await openMenu(page, 'Clientes', '#customerFilters');
    await page.locator('[data-customer-segmentation]').click();
    await page.locator('#segmentationFilters').waitFor();
    for (const segment of ['frecuentes', 'inactivos', 'con_deuda', 'vencidos', 'promesa_incumplida', 'buenos_pagadores', 'mayor_compra', 'mayor_saldo']) {
      await page.locator('#segmentationFilters [name="segmento"]').selectOption(segment);
      await page.locator('#segmentationFilters').waitFor();
      check((await page.locator('.segmentation-criteria').textContent()).includes('Criterio aplicado'), `Segmentacion explica el criterio de ${segment}.`);
    }
    let released;
    const gate = new Promise((resolve) => { released = resolve; });
    await page.route('**/api/clientes/segmentacion?**', async (route) => {
      if (route.request().url().includes('segmento=frecuentes')) await gate;
      await route.continue();
    });
    await page.locator('#segmentationFilters [name="segmento"]').selectOption('frecuentes');
    await page.locator('#menu').getByRole('button', { name: 'Clientes', exact: true }).click();
    await page.locator('#customerFilters').waitFor();
    released();
    await delay(300);
    check(await page.locator('#customerFilters').count() === 1, 'Una respuesta obsoleta de Segmentacion no reemplaza Clientes.');
    await page.unroute('**/api/clientes/segmentacion?**');

    await page.route('**/api/clientes/exportacion.xlsx?**', async (route) => {
      await route.fulfill({ status: 413, contentType: 'application/json', body: JSON.stringify({ error: 'Reduce el rango o los filtros.', code: 'EXPORT_LIMIT_EXCEEDED' }) });
    }, { times: 1 });
    await page.locator('[data-export-customers]').click();
    await page.locator('#message').getByText('Reduce el rango o los filtros.').waitFor();
    check(await page.locator('[data-export-customers]').isEnabled(), 'Un error 413 libera el boton de exportacion para reintentar.');
    const customerDownload = page.waitForEvent('download');
    await page.locator('[data-export-customers]').click();
    const download = await customerDownload;
    const downloadPath = path.join(artifactDir, download.suggestedFilename());
    await download.saveAs(downloadPath);
    check(download.suggestedFilename().endsWith('.xlsx') && fs.statSync(downloadPath).size > 0, 'La UI descarga clientes con el nombre XLSX del backend.');
    await closeSuccess(page);

    const invalidSegment = await browserFetch(page, '/api/clientes/segmentacion?segmento=no_valido');
    check(invalidSegment.status === 400, 'El contrato 400 de filtros invalidos permanece activo.');

    await page.route('**/api/clientes?**', async (route) => {
      await route.fulfill({ status: 429, contentType: 'application/json', body: JSON.stringify({ error: 'Demasiadas solicitudes. Intenta nuevamente.', code: 'RATE_LIMITED' }) });
    }, { times: 1 });
    await page.locator('#customerFilters').evaluate((form) => form.requestSubmit());
    await page.locator('[data-retry-customers]').waitFor();
    check((await page.locator('[role="alert"]').textContent()).includes('Demasiadas solicitudes'), 'La UI presenta un error 429 comprensible.');
    await page.locator('[data-retry-customers]').click();
    await page.locator('#customerFilters').waitFor();

    await page.route('**/api/clientes?**', async (route) => route.abort('failed'), { times: 1 });
    await page.locator('#customerFilters').evaluate((form) => form.requestSubmit());
    await page.locator('[data-retry-customers]').waitFor();
    check(await page.locator('[role="alert"]').count() === 1, 'Una desconexion deja la vista recuperable.');
    await page.locator('[data-retry-customers]').click();
    await page.locator('#customerFilters').waitFor();

    await page.route('**/api/clientes?**', async (route) => {
      await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Error temporal de prueba' }) });
    }, { times: 1 });
    await page.locator('#customerFilters').evaluate((form) => form.requestSubmit());
    await page.locator('[data-retry-customers]').waitFor();
    check((await page.locator('[role="alert"]').textContent()).includes('Error temporal de prueba'), 'Un error 500 se muestra sin bloquear la vista.');
    await page.locator('[data-retry-customers]').click();
    await page.locator('#customerFilters').waitFor();
    check(await page.locator('[data-retry-customers]').count() === 0, 'La vista permite reintentar despues del error.');

    await page.locator('#customerFilters [name="estado"]').selectOption('todos');
    await page.locator('#customerFilters').evaluate((form) => form.requestSubmit());
    await page.locator(`[data-customer-statement="${createdCustomer.idCliente}"]`).first().waitFor();

    await expectHttp(advancedApi, `/api/clientes/${createdCustomer.idCliente}`, { method: 'PATCH', body: {
      limiteCredito: 5000
    } }, 200, 'Ampliar limite para paginacion del estado de cuenta');
    const statementBeforeSeed = await expectHttp(
      advancedApi,
      `/api/clientes/${createdCustomer.idCliente}/estado-cuenta?pagina=1&limite=1`,
      {},
      200,
      'Contar movimientos previos del estado de cuenta'
    );
    const [[openDebtsBeforeSeed]] = await connection.query(
      'SELECT COUNT(*) total FROM fiado WHERE idTienda=? AND idCliente=? AND saldoPendiente>0',
      [advancedStore.idTienda, createdCustomer.idCliente]
    );
    const statementPageSize = 100;
    const existingMovements = Number(statementBeforeSeed.total);
    const existingOpenDebts = Number(openDebtsBeforeSeed.total);
    const statementSalesCreated = Math.max(1, Math.ceil(
      (statementPageSize + 1 - existingMovements - existingOpenDebts) / 3
    ));
    for (let index = 0; index < statementSalesCreated; index += 1) {
      await expectHttp(advancedApi, '/api/pos/ventas', { method: 'POST', body: {
        claveOperacion: `browser:estado-cuenta:${marker}:${index}`,
        idCliente: createdCustomer.idCliente,
        items: [{ idProducto: product.idProducto, cantidad: 1, presentacion: 'unidad' }],
        pagos: [],
        fechaVencimiento: formatLocalDate(addLocalDays(getLocalNow(), 30))
      } }, 201, `Crear movimiento paginado ${index + 1}`);
    }
    const [[debtToSettle]] = await connection.query(
      'SELECT COUNT(*) cantidad,COALESCE(SUM(saldoPendiente),0) total FROM fiado WHERE idTienda=? AND idCliente=? AND saldoPendiente>0',
      [advancedStore.idTienda, createdCustomer.idCliente]
    );
    await expectHttp(advancedApi, '/api/pagos-fiado/cliente', { method: 'POST', body: {
      idCliente: createdCustomer.idCliente,
      monto: Number(debtToSettle.total),
      metodoPago: 'transferencia',
      referencia: `Paginacion ${marker}`,
      observacion: 'Cobro temporal para validar paginacion del estado de cuenta.',
      claveOperacion: `browser:estado-cuenta-pago:${marker}`
    } }, 201, 'Crear pagos para paginacion del estado de cuenta');

    const isStatementResponse = (response, requestedPage) => {
      const url = new URL(response.url());
      return response.request().method() === 'GET'
        && url.pathname === `/api/clientes/${createdCustomer.idCliente}/estado-cuenta`
        && url.searchParams.get('pagina') === String(requestedPage)
        && response.status() === 200;
    };
    const movementIdentity = (movement) => {
      if (movement.tipo === 'venta') return `venta:${movement.idVenta}`;
      if (movement.tipo === 'fiado') return `fiado:${movement.idFiado}`;
      return `pago:${movement.idPagoFiado}`;
    };
    const movementOrderId = (movement) => Number(
      movement.tipo === 'venta' ? movement.idVenta
        : movement.tipo === 'fiado' ? movement.idFiado : movement.idPagoFiado
    );
    const movementTypeOrder = { venta: 1, fiado: 2, pago: 3 };
    const compareMovements = (left, right) => (
      String(right.fecha).localeCompare(String(left.fecha))
      || movementTypeOrder[right.tipo] - movementTypeOrder[left.tipo]
      || movementOrderId(right) - movementOrderId(left)
    );

    const firstPageResponsePromise = page.waitForResponse((response) => isStatementResponse(response, 1));
    await page.locator(`[data-customer-statement="${createdCustomer.idCliente}"]`).first().click();
    const firstPageData = await (await firstPageResponsePromise).json();
    await page.locator('.statement-modal').waitFor();
    const firstPageVisibleRows = await page.locator('.statement-row').allTextContents();
    const projectedStatementTotal = existingMovements + existingOpenDebts + (statementSalesCreated * 3);
    const totalWithOneLessSale = existingMovements + existingOpenDebts + ((statementSalesCreated - 1) * 3);
    check(projectedStatementTotal > statementPageSize && totalWithOneLessSale <= statementPageSize,
      `La prueba crea las ${statementSalesCreated} ventas minimas necesarias para superar una pagina de 100 movimientos.`);
    check(firstPageData.pageSize === statementPageSize && firstPageData.total > statementPageSize,
      'La primera respuesta usa pageSize 100 y confirma una segunda pagina real.');
    check(firstPageData.totalPages === 2 && firstPageData.hasNextPage === true && firstPageData.hasPreviousPage === false,
      'La primera pagina informa totalPages, hasNextPage y hasPreviousPage correctamente.');
    check(firstPageData.movimientos.length === statementPageSize && firstPageVisibleRows.length === statementPageSize,
      'La primera pagina muestra exactamente 100 movimientos reales.');
    check((await page.locator('.statement-modal .credit-pagination').textContent()).includes('Pagina 1 de 2')
      && await page.locator('.statement-modal').getByRole('button', { name: 'Anterior' }).isDisabled()
      && await page.locator('.statement-modal').getByRole('button', { name: 'Siguiente' }).isEnabled(),
    'Los controles visibles representan la primera pagina y permiten avanzar.');

    const secondPageResponsePromise = page.waitForResponse((response) => isStatementResponse(response, 2));
    await page.locator('[data-statement-page="2"]').click();
    const secondPageData = await (await secondPageResponsePromise).json();
    await page.locator('.statement-modal').waitFor();
    const secondPageVisibleRows = await page.locator('.statement-row').allTextContents();
    check(secondPageData.movimientos.length === secondPageData.total - statementPageSize
      && secondPageVisibleRows.length === secondPageData.movimientos.length
      && JSON.stringify(secondPageVisibleRows) !== JSON.stringify(firstPageVisibleRows),
    'La pagina 2 muestra el remanente y movimientos visibles diferentes a la pagina 1.');
    check(secondPageData.total === firstPageData.total && secondPageData.totalPages === 2
      && secondPageData.hasNextPage === false && secondPageData.hasPreviousPage === true,
    'La segunda pagina conserva el total y actualiza los indicadores de navegacion.');
    check((await page.locator('.statement-modal .credit-pagination').textContent()).includes('Pagina 2 de 2')
      && await page.locator('.statement-modal').getByRole('button', { name: 'Anterior' }).isEnabled()
      && await page.locator('.statement-modal').getByRole('button', { name: 'Siguiente' }).isDisabled(),
    'Los controles visibles representan la segunda pagina y permiten volver.');

    const allStatementMovements = [...firstPageData.movimientos, ...secondPageData.movimientos];
    const allMovementIdentities = allStatementMovements.map(movementIdentity);
    check(allStatementMovements.length === firstPageData.total
      && new Set(allMovementIdentities).size === firstPageData.total,
    'Las dos paginas cubren el total sin movimientos omitidos ni duplicados.');
    const sortedMovementIdentities = [...allStatementMovements].sort(compareMovements).map(movementIdentity);
    check(JSON.stringify(allMovementIdentities) === JSON.stringify(sortedMovementIdentities),
      'Los movimientos mantienen el orden determinista por fecha, tipo e identificador.');

    const returnPageResponsePromise = page.waitForResponse((response) => isStatementResponse(response, 1));
    await page.locator('[data-statement-page="1"]').click();
    const returnedFirstPageData = await (await returnPageResponsePromise).json();
    await page.locator('.statement-modal').waitFor();
    const returnedFirstPageRows = await page.locator('.statement-row').allTextContents();
    check(JSON.stringify(returnedFirstPageRows) === JSON.stringify(firstPageVisibleRows)
      && JSON.stringify(returnedFirstPageData.movimientos.map(movementIdentity))
        === JSON.stringify(firstPageData.movimientos.map(movementIdentity)),
    'Volver con el control real restaura exactamente la primera pagina.');
    check(returnedFirstPageData.page === 1 && returnedFirstPageData.hasNextPage === true
      && returnedFirstPageData.hasPreviousPage === false,
    'Al volver, los metadatos visibles y de respuesta regresan a la pagina 1.');

    const statementDownload = page.waitForEvent('download');
    await page.locator('[data-statement-export]').click();
    const statementFile = await statementDownload;
    await statementFile.saveAs(path.join(artifactDir, statementFile.suggestedFilename()));
    check(statementFile.suggestedFilename().startsWith('estado_cuenta_'), 'Estado de cuenta inicia una descarga con nombre seguro.');
    await closeSuccess(page);
    await page.locator('[data-statement-print]').click();
    check(await page.evaluate(() => window.__printCalls === 2), 'Estado de cuenta activa impresion HTML.');
    const printRules = await page.evaluate(() => [...document.styleSheets].some((sheet) => {
      try { return [...sheet.cssRules].some((rule) => rule.media?.mediaText?.includes('print')); } catch { return false; }
    }));
    check(printRules, 'La aplicacion contiene reglas CSS de impresion.');
    await page.locator('[data-modal-cancel]').click();

    const a11y = await accessibilitySnapshot(page);
    check(a11y.unnamedFields.length === 0, `Los controles visibles tienen nombre accesible: ${a11y.unnamedFields.join(', ')}`);
    check(a11y.unnamedButtons === 0 && a11y.positiveTabIndex === 0, 'No hay botones sin nombre ni tabindex positivo.');
    for (const viewport of [[360, 800], [768, 1024], [1366, 768]]) {
      await assertResponsive(page, viewport[0], viewport[1]);
      const screenshotPath = path.join(artifactDir, `clientes-${viewport[0]}x${viewport[1]}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: true });
      assert(fs.statSync(screenshotPath).size > 5000, `La captura ${viewport[0]}x${viewport[1]} esta vacia.`);
      check(true, `Responsive ${viewport[0]}x${viewport[1]} sin overflow global y con captura no vacia.`);
    }

    const crossTenant = await browserFetch(page, `/api/clientes/${otherCustomer.idCliente}`);
    check(crossTenant.status === 404, 'Un ID de cliente de otra tienda no cruza el tenant.');
    check(!(await page.content()).includes('idTienda='), 'La interfaz no incorpora idTienda en sus solicitudes visibles.');
    check(await page.evaluate(() => !Object.keys(localStorage).some((key) => /(password|token|secret)/i.test(key))), 'No se guardan credenciales en localStorage.');

    const basicContext = await browser.newContext({ viewport: { width: 768, height: 1024 } });
    const basicPage = await basicContext.newPage();
    await login(basicPage, baseUrl, basicStore.body.propietario.usuario, basicStore.password);
    await openMenu(basicPage, 'Clientes', '#customerFilters');
    check(await basicPage.locator('[data-customer-segmentation]').count() === 0, 'El plan basico no muestra Segmentacion.');
    check(await basicPage.locator('[data-export-customers]').count() === 0, 'El plan basico no muestra exportacion avanzada.');
    await openMenu(basicPage, 'Cobranza', '#collectionFilters');
    check(await basicPage.locator('[data-manage-templates]').count() === 0, 'El plan basico no muestra Plantillas.');
    const forbiddenSegmentation = await browserFetch(basicPage, '/api/clientes/segmentacion?segmento=frecuentes');
    check(forbiddenSegmentation.status === 403, 'El backend niega Segmentacion al plan basico.');

    const anonymousContext = await browser.newContext();
    const anonymousPage = await anonymousContext.newPage();
    await anonymousPage.goto(`${baseUrl}/login.html`);
    const unauthenticated = await browserFetch(anonymousPage, '/api/clientes');
    check(unauthenticated.status === 401, 'Una solicitud sin sesion conserva el contrato 401.');
    await anonymousContext.close();

    const oldEnd = formatLocalDateTime(addLocalDays(getLocalNow(), -1));
    await connection.query('UPDATE suscripcionTienda SET fechaFin=?, actualizadoEn=? WHERE idSuscripcion=?', [oldEnd, formatLocalDateTime(), basicStore.idSuscripcion]);
    await basicPage.reload();
    await basicPage.locator('#menu').waitFor();
    await openMenu(basicPage, 'Clientes', '#customerFilters');
    check((await basicPage.locator('#view').textContent()).includes('Modo de solo lectura'), 'La suscripcion vencida conserva lectura y explica el bloqueo.');
    check(await basicPage.locator('[data-new-customer]').count() === 0, 'La suscripcion vencida oculta acciones de escritura.');
    const blockedWrite = await browserFetch(basicPage, '/api/clientes', {
      method: 'POST', body: JSON.stringify({ nombre: `No crear ${marker}` })
    });
    check(blockedWrite.status === 403, 'La escritura manipulada sigue bloqueada por backend.');
    await basicContext.close();

    await context.close();
    console.log(JSON.stringify({ resultado: 'ok', navegador: path.basename(browserExecutable()), comprobaciones: checks.length }, null, 2));
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (server && server.exitCode === null) {
      server.kill();
      await Promise.race([new Promise((resolve) => server.once('exit', resolve)), delay(3000)]);
      if (server.exitCode === null) server.kill('SIGKILL');
    }
    if (connection) {
      for (const idTienda of fixture.stores) await cleanupStore(connection, idTienda).catch(() => {});
      await connection.query('DELETE FROM administrador WHERE usuario=?', [fixture.superUser]).catch(() => {});
      await connection.end().catch(() => {});
    }
    fs.rmSync(artifactDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`Fallo test:customers-credit-browser: ${error.message}`);
  process.exitCode = 1;
});
