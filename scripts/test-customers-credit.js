const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const ExcelJS = require('exceljs');
const { createDatabaseConnection } = require('../config/database-connection');
const { requireLocalhostDatabase } = require('../config/env');
const {
  exportCustomers,
  safeExportFileName,
  sanitizeSpreadsheetCell
} = require('../services/customer-credit-export-service');
const { addLocalDays, formatLocalDate, formatLocalDateTime, parseLocalDate } = require('../utils/local-datetime');
const { applyTestRequestSecurity } = require('./http-test-security');

const TEMPLATE_TYPES_FOR_TEST = [
  'recordatorio_previo', 'deuda_vencida', 'confirmacion_pago', 'estado_cuenta'
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

class HttpSession {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
    this.cookie = '';
  }

  async request(path, options = {}) {
    const request = { ...options, headers: { ...(options.headers || {}) }, redirect: 'manual' };
    if (request.body && typeof request.body !== 'string') {
      request.headers['content-type'] = 'application/json';
      request.body = JSON.stringify(request.body);
    }
    applyTestRequestSecurity(this.baseUrl, request);
    if (this.cookie) request.headers.cookie = this.cookie;
    const response = await fetch(`${this.baseUrl}${path}`, request);
    const cookie = response.headers.get('set-cookie');
    if (cookie) this.cookie = cookie.split(';')[0];
    const text = await response.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = text; }
    return { status: response.status, body };
  }

  async requestRaw(path, options = {}) {
    const request = { ...options, headers: { ...(options.headers || {}) }, redirect: 'manual' };
    if (request.body && typeof request.body !== 'string') {
      request.headers['content-type'] = 'application/json';
      request.body = JSON.stringify(request.body);
    }
    applyTestRequestSecurity(this.baseUrl, request);
    if (this.cookie) request.headers.cookie = this.cookie;
    const response = await fetch(`${this.baseUrl}${path}`, request);
    const cookie = response.headers.get('set-cookie');
    if (cookie) this.cookie = cookie.split(';')[0];
    return {
      status: response.status,
      headers: response.headers,
      buffer: Buffer.from(await response.arrayBuffer())
    };
  }
}

function safe(value) {
  if (Array.isArray(value)) return value.map(safe);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !/(password|cookie|session|token|secret|hash)/i.test(key))
    .map(([key, item]) => [key, safe(item)]));
}

async function expect(session, path, options, status, label) {
  const response = await session.request(path, options);
  if (response.status !== status) {
    throw new Error(`${label}: se esperaba HTTP ${status}, se obtuvo ${response.status}. Respuesta: ${JSON.stringify(safe(response.body))}`);
  }
  return response.body;
}

async function expectRaw(session, path, status, label) {
  const response = await session.requestRaw(path);
  if (response.status !== status) {
    let body = response.buffer.toString('utf8');
    try { body = JSON.parse(body); } catch { /* keep text for the diagnostic */ }
    throw new Error(`${label}: se esperaba HTTP ${status}, se obtuvo ${response.status}. Respuesta: ${JSON.stringify(safe(body))}`);
  }
  return response;
}

async function workbookFrom(response, expectedFilePrefix) {
  assert(
    response.headers.get('content-type')?.includes('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
    'La exportacion no devolvio el Content-Type de XLSX.'
  );
  const disposition = response.headers.get('content-disposition') || '';
  assert(disposition.includes('attachment;') && disposition.includes(expectedFilePrefix),
    `Content-Disposition no contiene un nombre seguro esperado: ${disposition}`);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(response.buffer);
  return workbook;
}

function findHeaderRow(sheet, label) {
  for (let index = 1; index <= sheet.rowCount; index += 1) {
    if (String(sheet.getRow(index).getCell(1).value || '') === label) return sheet.getRow(index);
  }
  throw new Error(`No se encontro el encabezado ${label} en ${sheet.name}.`);
}

async function resolveTestPlans(connection, superSession) {
  const apiPlans = await expect(superSession, '/api/admin/planes', {}, 200, 'Listar planes disponibles');
  const [featureRows] = await connection.query(
    `SELECT p.idPlan, p.codigo planCodigo, f.codigo funcionalidad
     FROM plan p
     JOIN planFuncionalidad pf ON pf.idPlan=p.idPlan AND pf.habilitada=1
     JOIN funcionalidad f ON f.idFuncionalidad=pf.idFuncionalidad AND f.activo=1
     WHERE p.activo=1`
  );
  const featuresByPlan = new Map();
  for (const row of featureRows) {
    const idPlan = Number(row.idPlan);
    if (!featuresByPlan.has(idPlan)) featuresByPlan.set(idPlan, new Set());
    featuresByPlan.get(idPlan).add(row.funcionalidad);
  }
  const availablePlans = apiPlans.filter((plan) => Number(plan.activo) === 1).map((plan) => ({
    idPlan: Number(plan.idPlan),
    codigo: plan.codigo,
    funcionalidades: featuresByPlan.get(Number(plan.idPlan)) || new Set()
  }));
  const basicFeatures = ['clientes_basico', 'fiados_basico', 'pagos_fiado', 'estado_cuenta_basico'];
  const advancedFeatures = [
    'limites_credito', 'seguimiento_cobranza', 'recordatorios_fiado', 'exportacion_clientes_fiados',
    'segmentacion_clientes'
  ];
  const advanced = availablePlans.find((plan) =>
    [...basicFeatures, ...advancedFeatures].every((feature) => plan.funcionalidades.has(feature))
  );
  const basic = availablePlans.find((plan) =>
    basicFeatures.every((feature) => plan.funcionalidades.has(feature))
      && advancedFeatures.every((feature) => !plan.funcionalidades.has(feature))
  );
  assert(advanced, 'No existe un plan activo con las funciones avanzadas requeridas por la prueba.');
  assert(basic, 'No existe un plan activo con las funciones basicas requeridas por la prueba.');
  return { advanced, basic };
}

function storePayload(marker, label, planCode) {
  const password = `Owner-${label}-${crypto.randomBytes(10).toString('hex')}!`;
  return {
    password,
    body: {
      nombre: `Tienda credito ${label} ${marker}`,
      slug: `tienda-credito-${label}-${marker}`,
      estado: 'activa',
      activo: true,
      propietario: {
        usuario: `owner_credit_${label}_${marker}`,
        password,
        confirmacionPassword: password,
        activo: true
      },
      suscripcion: { planCodigo: planCode, tipo: 'cortesia', duracionDias: 30 }
    }
  };
}

function addDays(dateText, days) {
  return formatLocalDate(addLocalDays(parseLocalDate(dateText), days));
}

async function captureExclusiveLocalEnd(afterDateTime) {
  const deadline = Date.now() + 2000;
  let current = formatLocalDateTime();
  while (current <= afterDateTime && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
    current = formatLocalDateTime();
  }
  assert(current > afterDateTime, 'No se pudo capturar una fecha final real posterior al ultimo cobro.');
  return current;
}

async function scalar(connection, sql, params = []) {
  const [[row]] = await connection.query(sql, params);
  return Number(row.total || 0);
}

async function cleanupStore(connection, idTienda) {
  await connection.query('DELETE FROM eventoAuditoriaAdministrativa WHERE idTienda=?', [idTienda]);
  await connection.query('DELETE FROM seguimientoCobranza WHERE idTienda=?', [idTienda]);
  await connection.query('DELETE FROM cierreCaja WHERE idTienda=?', [idTienda]);
  await connection.query('DELETE FROM gasto WHERE idTienda=?', [idTienda]);
  await connection.query('DELETE FROM categoriaGasto WHERE idTienda=?', [idTienda]);
  await connection.query('DELETE FROM movimientoLote WHERE idTienda=?', [idTienda]);
  await connection.query('DELETE FROM loteProducto WHERE idTienda=?', [idTienda]);
  await connection.query('DELETE FROM movimientoStock WHERE idTienda=?', [idTienda]);
  await connection.query('DELETE FROM pagoVenta WHERE idTienda=?', [idTienda]);
  await connection.query('DELETE FROM pagoFiado WHERE idTienda=?', [idTienda]);
  await connection.query('DELETE FROM cobroFiado WHERE idTienda=?', [idTienda]);
  await connection.query('DELETE FROM detalleFiado WHERE idTienda=?', [idTienda]);
  await connection.query('DELETE FROM detalleVenta WHERE idTienda=?', [idTienda]);
  await connection.query('DELETE FROM detalleCompra WHERE idTienda=?', [idTienda]);
  await connection.query('DELETE FROM fiado WHERE idTienda=?', [idTienda]);
  await connection.query('DELETE FROM venta WHERE idTienda=?', [idTienda]);
  await connection.query('DELETE FROM compra WHERE idTienda=?', [idTienda]);
  await connection.query('DELETE FROM producto WHERE idTienda=?', [idTienda]);
  await connection.query('DELETE FROM cliente WHERE idTienda=?', [idTienda]);
  await connection.query('DELETE FROM proveedor WHERE idTienda=?', [idTienda]);
  await connection.query('DELETE FROM plantillaCobranzaTienda WHERE idTienda=?', [idTienda]);
  await connection.query('DELETE FROM configuracionCreditoTienda WHERE idTienda=?', [idTienda]);
  await connection.query('DELETE FROM configuracionInventarioTienda WHERE idTienda=?', [idTienda]);
  await connection.query('DELETE FROM configuracionTienda WHERE idTienda=?', [idTienda]);
  await connection.query('DELETE FROM operacionSuscripcionTienda WHERE idTienda=?', [idTienda]);
  await connection.query('DELETE FROM historialSuscripcionTienda WHERE idTienda=?', [idTienda]);
  await connection.query('DELETE FROM suscripcionFuncionalidadSnapshot WHERE idTienda=?', [idTienda]);
  await connection.query('DELETE FROM suscripcionTienda WHERE idTienda=?', [idTienda]);
  await connection.query('DELETE FROM administrador WHERE idTienda=?', [idTienda]);
  await connection.query('DELETE FROM tienda WHERE idTienda=?', [idTienda]);
}

async function cleanup(connection, fixture) {
  if (!connection) return;
  const [stores] = await connection.query('SELECT idTienda FROM tienda WHERE slug LIKE ?', [`tienda-credito-%-${fixture.marker}`]);
  const ids = new Set([
    fixture.advancedStore, fixture.basicStore, fixture.otherStore, fixture.noFeatureStore,
    ...stores.map((row) => row.idTienda)
  ].filter(Boolean));
  for (const idTienda of ids) await cleanupStore(connection, idTienda);
  if (fixture.noFeaturePlan) await connection.query('DELETE FROM plan WHERE idPlan=?', [fixture.noFeaturePlan]);
  if (fixture.superUser) {
    await connection.query(
      `DELETE ea FROM eventoAuditoriaAdministrativa ea
       JOIN administrador a ON a.idAdministrador=ea.idAdministradorActor
       WHERE a.usuario=?`,
      [fixture.superUser]
    );
    await connection.query('DELETE FROM administrador WHERE usuario=?', [fixture.superUser]);
  }
  if (Number.isSafeInteger(fixture.auditStartId)) {
    await connection.query(
      `DELETE FROM eventoAuditoriaAdministrativa
       WHERE idEventoAuditoria>? AND idTienda IS NULL AND actorTipo='anonimo'`,
      [fixture.auditStartId]
    );
  }
}

async function createProduct(session, marker, suffix, stock = 100) {
  return expect(session, '/api/productos', { method: 'POST', body: {
    nombre: `Producto credito ${suffix} ${marker}`,
    categoria: 'OTROS',
    unidadMedida: 'unidad',
    unidadesPorPaquete: 1,
    paquetesPorCaja: 1,
    precioVenta: 10,
    stockMinimo: 2,
    stockUnidadesTotal: stock,
    ultimoPrecioCompra: 4,
    permiteVentaPorPaquete: false,
    permiteVentaPorUnidad: true
  } }, 201, `Crear producto ${suffix}`);
}

function saleBody(marker, key, idProducto, idCliente, payments = [], extra = {}) {
  return {
    claveOperacion: `${key}-${marker}`,
    idCliente,
    items: [{ idProducto, cantidad: 1, presentacion: 'unidad' }],
    pagos: payments,
    ...extra
  };
}

async function main() {
  const config = { ...requireLocalhostDatabase('La prueba de clientes y credito'), decimalNumbers: true };
  if (!/(prueba|test)/i.test(config.database)) throw new Error('La prueba requiere una base local cuyo nombre contenga prueba o test.');
  const baseUrl = process.env.TEST_BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
  const target = new URL(baseUrl);
  if (!['localhost', '127.0.0.1', '::1'].includes(target.hostname)) {
    throw new Error('La prueba HTTP solo puede ejecutarse contra localhost.');
  }

  const marker = crypto.randomBytes(6).toString('hex');
  const fixture = { marker, superUser: `super_credit_${marker}` };
  const superPassword = `Super-${crypto.randomBytes(12).toString('hex')}!`;
  let connection;

  try {
    connection = await createDatabaseConnection(config);
    const [[auditStart]] = await connection.query(
      'SELECT COALESCE(MAX(idEventoAuditoria),0) id FROM eventoAuditoriaAdministrativa'
    );
    fixture.auditStartId = Number(auditStart.id);
    await connection.query(
      "INSERT INTO administrador (idTienda,usuario,password,rol,activo) VALUES (NULL,?,?,'superadmin',1)",
      [fixture.superUser, await bcrypt.hash(superPassword, 12)]
    );
    const superSession = new HttpSession(baseUrl);
    const advanced = new HttpSession(baseUrl);
    const concurrent = new HttpSession(baseUrl);
    const basic = new HttpSession(baseUrl);
    const other = new HttpSession(baseUrl);
    const noFeature = new HttpSession(baseUrl);
    await expect(superSession, '/auth/login', { method: 'POST', body: { usuario: fixture.superUser, password: superPassword } }, 200, 'Login superadmin');
    const plans = await resolveTestPlans(connection, superSession);
    const temporaryPlanCode = `sin-clientes-${marker}`;
    const now = formatLocalDateTime();
    const [temporaryPlan] = await connection.query(
      `INSERT INTO plan
       (codigo,nombre,descripcion,activo,precioMensual,duracionDias,limitePropietarios,
        limiteProductos,limiteClientes,limiteProveedores,creadoEn,actualizadoEn)
       VALUES (?,?,?,1,0,30,1,50,50,20,?,?)`,
      [temporaryPlanCode, `Plan sin clientes ${marker}`, 'Plan temporal aislado para permisos.', now, now]
    );
    fixture.noFeaturePlan = temporaryPlan.insertId;
    const advancedStore = storePayload(marker, 'avanzada', plans.advanced.codigo);
    const basicStore = storePayload(marker, 'basica', plans.basic.codigo);
    const otherStore = storePayload(marker, 'aislada', plans.advanced.codigo);
    const noFeatureStore = storePayload(marker, 'sin-clientes', temporaryPlanCode);
    const advancedCreated = await expect(superSession, '/api/admin/tiendas', { method: 'POST', body: advancedStore.body }, 201, 'Crear tienda avanzada');
    const basicCreated = await expect(superSession, '/api/admin/tiendas', { method: 'POST', body: basicStore.body }, 201, 'Crear tienda basica');
    const otherCreated = await expect(superSession, '/api/admin/tiendas', { method: 'POST', body: otherStore.body }, 201, 'Crear tienda aislada');
    const noFeatureCreated = await expect(superSession, '/api/admin/tiendas', { method: 'POST', body: noFeatureStore.body }, 201, 'Crear tienda sin clientes');
    fixture.advancedStore = advancedCreated.tienda.idTienda;
    fixture.basicStore = basicCreated.tienda.idTienda;
    fixture.otherStore = otherCreated.tienda.idTienda;
    fixture.noFeatureStore = noFeatureCreated.tienda.idTienda;
    await expect(advanced, '/auth/login', { method: 'POST', body: { usuario: advancedStore.body.propietario.usuario, password: advancedStore.password } }, 200, 'Login avanzado');
    await expect(concurrent, '/auth/login', { method: 'POST', body: { usuario: advancedStore.body.propietario.usuario, password: advancedStore.password } }, 200, 'Login concurrente');
    await expect(basic, '/auth/login', { method: 'POST', body: { usuario: basicStore.body.propietario.usuario, password: basicStore.password } }, 200, 'Login basico');
    await expect(other, '/auth/login', { method: 'POST', body: { usuario: otherStore.body.propietario.usuario, password: otherStore.password } }, 200, 'Login otra tienda');
    await expect(noFeature, '/auth/login', { method: 'POST', body: { usuario: noFeatureStore.body.propietario.usuario, password: noFeatureStore.password } }, 200, 'Login sin clientes');
    const cashObservationStart = formatLocalDateTime();

    assert(await scalar(connection, 'SELECT COUNT(*) total FROM configuracionCreditoTienda WHERE idTienda IN (?,?,?,?)',
      [fixture.advancedStore, fixture.basicStore, fixture.otherStore, fixture.noFeatureStore]) === 4,
    'Las tiendas nuevas no recibieron configuracion de credito.');

    const product = await createProduct(advanced, marker, 'principal');
    const basicProduct = await createProduct(basic, marker, 'basico');
    const otherProduct = await createProduct(other, marker, 'aislado');

    const customer = await expect(advanced, '/api/clientes', { method: 'POST', body: {
      nombre: `Cliente credito ${marker}`,
      telefono: '76543210',
      documentoIdentidad: `CI-${marker}`,
      correo: `CLIENTE-${marker}@EXAMPLE.COM`,
      limiteCredito: 100,
      diasCreditoDefault: 15,
      canalPreferido: 'whatsapp'
    } }, 201, 'Crear cliente completo');
    await expect(advanced, '/api/clientes', { method: 'POST', body: {
      nombre: `Documento duplicado ${marker}`, documentoIdentidad: `CI ${marker}`
    } }, 409, 'Documento duplicado');
    const duplicatePhone = await expect(advanced, '/api/clientes', { method: 'POST', body: {
      nombre: `Telefono repetido ${marker}`, telefono: '76543210'
    } }, 201, 'Telefono duplicado permitido');
    assert(duplicatePhone.advertencias.length === 1, 'El telefono duplicado no genero advertencia.');

    const noPhone = await expect(advanced, '/api/clientes', { method: 'POST', body: {
      nombre: `Cliente sin telefono ${marker}`
    } }, 201, 'Cliente sin telefono');
    const disabled = await expect(advanced, '/api/clientes', { method: 'POST', body: {
      nombre: `Cliente bloqueado ${marker}`, telefono: '70000001', permiteFiado: false
    } }, 201, 'Cliente sin fiado');
    const inactive = await expect(advanced, '/api/clientes', { method: 'POST', body: {
      nombre: '=SUM(1,1)',
      telefono: '+CMD 70000002',
      documentoIdentidad: '-1+1',
      direccion: '@HYPERLINK("https://example.invalid")',
      notas: '\t=FORMULA_OCULTA'
    } }, 201, 'Cliente para inactivar');
    await connection.query('UPDATE cliente SET activo=0 WHERE idTienda=? AND idCliente=?', [fixture.advancedStore, inactive.idCliente]);

    await expect(advanced, '/api/pos/ventas', { method: 'POST', body: saleBody(marker, 'contado-sin-cliente', product.idProducto, null,
      [{ metodoPago: 'efectivo', monto: 10 }]) }, 201, 'Venta al contado sin cliente');
    await expect(advanced, '/api/pos/ventas', { method: 'POST', body: saleBody(marker,
      'fiado-cliente-ocasional', product.idProducto, null) }, 400, 'Cliente ocasional no recibe fiado');
    await expect(advanced, '/api/pos/ventas', { method: 'POST', body: saleBody(marker, 'fiado-deshabilitado', product.idProducto, disabled.idCliente) }, 409, 'permiteFiado bloquea');
    await expect(advanced, '/api/pos/ventas', { method: 'POST', body: saleBody(marker, 'contado-cliente-bloqueado',
      product.idProducto, disabled.idCliente, [{ metodoPago: 'efectivo', monto: 10 }]) }, 201,
    'Cliente bloqueado compra al contado');
    await expect(advanced, '/api/pos/ventas', { method: 'POST', body: saleBody(marker, 'fiado-inactivo', product.idProducto, inactive.idCliente) }, 404, 'Cliente inactivo bloquea');

    await expect(advanced, '/api/configuracion-credito', { method: 'PUT', body: {
      limiteCreditoDefault: 20,
      diasCreditoDefault: 30,
      diasAvisoVencimiento: 3,
      politicaFiadoVencido: 'advertir',
      requiereTelefonoParaFiado: true,
      permiteFiadoSinFecha: false,
      codigoPaisWhatsApp: '591'
    } }, 200, 'Configurar credito');
    await expect(advanced, '/api/pos/ventas', { method: 'POST', body: saleBody(marker, 'fiado-sin-telefono', product.idProducto, noPhone.idCliente) }, 409, 'Telefono obligatorio');

    const invalidDate = addDays(formatLocalDate(), -1);
    await expect(advanced, '/api/pos/ventas', { method: 'POST', body: saleBody(marker, 'fecha-invalida', product.idProducto,
      customer.idCliente, [], { fechaVencimiento: invalidDate }) }, 400, 'Fecha de credito invalida');
    const firstCredit = await expect(advanced, '/api/pos/ventas', { method: 'POST', body: saleBody(marker, 'fiado-inicial',
      product.idProducto, customer.idCliente) }, 201, 'Fiado valido');
    assert(firstCredit.idFiado && firstCredit.fechaVencimiento === addDays(formatLocalDate(), 15),
      'La fecha no se derivo desde el cliente.');
    assert(Number(firstCredit.deudaAnterior) === 0 && Number(firstCredit.deudaPosterior) === 10
      && Number(firstCredit.creditoDisponiblePosterior) === 90,
    'La respuesta POS no informo deuda y credito correctamente.');
    const storeDueDate = await expect(advanced, '/api/pos/ventas', { method: 'POST', body: saleBody(marker,
      'fecha-desde-tienda', product.idProducto, duplicatePhone.idCliente) }, 201, 'Fecha derivada desde tienda');
    assert(storeDueDate.fechaVencimiento === addDays(formatLocalDate(), 30),
      'La fecha no se derivo desde la configuracion de tienda.');

    await expect(advanced, `/api/clientes/${customer.idCliente}`, { method: 'PATCH', body: { limiteCredito: 12 } }, 200, 'Reducir limite cliente');
    await expect(advanced, '/api/pos/ventas', { method: 'POST', body: saleBody(marker, 'supera-limite', product.idProducto, customer.idCliente) }, 409, 'Limite de cliente');
    await expect(advanced, `/api/clientes/${customer.idCliente}`, { method: 'PATCH', body: { limiteCredito: null } }, 200, 'Heredar limite tienda');
    const inheritedCredit = await expect(advanced, '/api/pos/ventas', { method: 'POST', body: saleBody(marker, 'limite-tienda-valido', product.idProducto, customer.idCliente) }, 201, 'Limite heredado');
    await expect(advanced, '/api/pos/ventas', { method: 'POST', body: saleBody(marker, 'limite-tienda-superado', product.idProducto, customer.idCliente) }, 409, 'Limite heredado superado');

    await connection.query('UPDATE fiado SET fechaVencimiento=? WHERE idTienda=? AND idFiado=?',
      [invalidDate, fixture.advancedStore, firstCredit.idFiado]);
    await expect(advanced, '/api/pos/ventas', { method: 'POST', body: saleBody(marker, 'advertir-sin-confirmar', product.idProducto,
      customer.idCliente) }, 409, 'Politica advertir exige confirmacion');
    await expect(advanced, `/api/clientes/${customer.idCliente}`, { method: 'PATCH', body: { limiteCredito: 100 } }, 200, 'Ampliar limite');
    const confirmedCredit = await expect(advanced, '/api/pos/ventas', { method: 'POST', body: saleBody(marker, 'advertir-confirmado',
      product.idProducto, customer.idCliente, [], {
        confirmarDeudaVencida: true,
        motivoDeudaVencida: 'Propietario confirma credito temporal para la prueba.'
      }) }, 201, 'Politica advertir confirmada');
    assert(confirmedCredit.advertencias.length === 1, 'La deuda vencida confirmada no devolvio advertencia.');
    assert(await scalar(connection,
      "SELECT COUNT(*) total FROM seguimientoCobranza WHERE idTienda=? AND idFiado=? AND tipo='nota'",
      [fixture.advancedStore, confirmedCredit.idFiado]) === 1,
    'La confirmacion de deuda vencida no dejo seguimiento.');

    await expect(advanced, '/api/configuracion-credito', { method: 'PUT', body: { politicaFiadoVencido: 'bloquear' } }, 200, 'Politica bloquear');
    await expect(advanced, '/api/pos/ventas', { method: 'POST', body: saleBody(marker, 'bloqueo-vencido', product.idProducto,
      customer.idCliente) }, 409, 'Politica bloquear aplicada');
    await expect(advanced, '/api/configuracion-credito', { method: 'PUT', body: { politicaFiadoVencido: 'permitir' } }, 200, 'Politica permitir');
    const allowedCredit = await expect(advanced, '/api/pos/ventas', { method: 'POST', body: saleBody(marker, 'permitir-vencido',
      product.idProducto, customer.idCliente) }, 201, 'Politica permitir aplicada');
    assert(allowedCredit.advertencias.length === 1, 'La politica permitir no advirtio la deuda vencida.');
    await expect(advanced, '/api/configuracion-credito', { method: 'PUT', body: { limiteCreditoDefault: null } }, 200, 'Credito sin limite de tienda');
    await expect(advanced, `/api/clientes/${duplicatePhone.idCliente}`, { method: 'PATCH', body: { limiteCredito: null } }, 200, 'Cliente sin limite propio');
    const unlimitedSummary = await expect(advanced, `/api/clientes/${duplicatePhone.idCliente}/resumen`, {}, 200, 'Resumen sin limite');
    assert(unlimitedSummary.cliente.limiteEfectivo === null && unlimitedSummary.cliente.creditoDisponible === null,
      'El credito sin limite se represento como un monto finito.');

    const oldCustomer = await expect(advanced, '/api/clientes', { method: 'POST', body: {
      nombre: `Cliente compra antigua ${marker}`, telefono: '71110001'
    } }, 201, 'Crear cliente con compra antigua');
    const oldSale = await expect(advanced, '/api/pos/ventas', { method: 'POST', body: saleBody(
      marker, 'compra-antigua-segmentacion', product.idProducto, oldCustomer.idCliente,
      [{ metodoPago: 'efectivo', monto: 10 }]
    ) }, 201, 'Crear compra para inactividad');
    const oldPurchaseDate = formatLocalDateTime(addLocalDays(parseLocalDate(formatLocalDate()), -120));
    await connection.query('UPDATE venta SET fecha=? WHERE idTienda=? AND idVenta=?',
      [oldPurchaseDate, fixture.advancedStore, oldSale.idVenta]);

    const punctualCustomer = await expect(advanced, '/api/clientes', { method: 'POST', body: {
      nombre: `Cliente puntual ${marker}`, telefono: '71110002'
    } }, 201, 'Crear cliente puntual');
    const punctualCredit = await expect(advanced, '/api/pos/ventas', { method: 'POST', body: saleBody(
      marker, 'fiado-puntual-segmentacion', product.idProducto, punctualCustomer.idCliente, [],
      { fechaVencimiento: addDays(formatLocalDate(), 10) }
    ) }, 201, 'Crear fiado puntual');
    await expect(advanced, `/api/fiados/${punctualCredit.idFiado}/pagos`, { method: 'POST', body: {
      monto: 10, metodoPago: 'qr', claveOperacion: `cobro-puntual-segmentacion-${marker}`
    } }, 201, 'Cerrar fiado puntual');

    const stockBeforePayment = await scalar(connection,
      'SELECT stockUnidadesTotal total FROM producto WHERE idTienda=? AND idProducto=?',
      [fixture.advancedStore, product.idProducto]);
    const movementsBeforePayment = await scalar(connection,
      'SELECT COUNT(*) total FROM movimientoStock WHERE idTienda=? AND idProducto=?',
      [fixture.advancedStore, product.idProducto]);
    const cashBaselineEnd = await captureExclusiveLocalEnd(formatLocalDateTime());
    const cashCloseBefore = await expect(advanced,
      `/api/caja/cierres/calcular?fechaInicio=${encodeURIComponent(cashObservationStart)}&fechaFin=${encodeURIComponent(cashBaselineEnd)}&efectivoInicial=0`,
      {}, 200, 'Linea base del calculo de caja');
    const partialBody = {
      monto: 3,
      metodoPago: 'efectivo',
      montoRecibido: 5,
      claveOperacion: `cobro-parcial-${marker}`,
      observacion: 'Pago parcial de prueba'
    };
    const partial = await expect(advanced, `/api/fiados/${allowedCredit.idFiado}/pagos`, { method: 'POST', body: partialBody }, 201, 'Pago especifico parcial');
    assert(Number(partial.cambio) === 2 && partial.aplicaciones.length === 1, 'El pago parcial o su cambio son incorrectos.');
    const repeated = await expect(advanced, `/api/fiados/${allowedCredit.idFiado}/pagos`, { method: 'POST', body: partialBody }, 200, 'Idempotencia de cobro');
    assert(repeated.repetido === true && Number(repeated.idCobroFiado) === Number(partial.idCobroFiado), 'El reintento duplico el cobro.');
    assert(await scalar(connection, 'SELECT COUNT(*) total FROM cobroFiado WHERE idTienda=? AND claveOperacion=?',
      [fixture.advancedStore, partialBody.claveOperacion]) === 1,
    'La clave de operacion creo mas de una cabecera.');
    await expect(advanced, `/api/fiados/${allowedCredit.idFiado}/pagos`, { method: 'POST', body: {
      monto: 99, metodoPago: 'qr', claveOperacion: `sobrepago-${marker}`
    } }, 400, 'Sobrepago rechazado');
    await expect(advanced, `/api/fiados/${allowedCredit.idFiado}/pagos`, { method: 'POST', body: {
      monto: 1, metodoPago: 'efectivo'
    } }, 400, 'Clave obligatoria');
    const fullPayment = await expect(advanced, `/api/fiados/${allowedCredit.idFiado}/pagos`, { method: 'POST', body: {
      monto: 7, metodoPago: 'qr', referencia: `QR-${marker}`, claveOperacion: `cobro-total-${marker}`
    } }, 201, 'Pago especifico total');
    assert(fullPayment.aplicaciones[0].estado === 'pagado'
      && Number(fullPayment.aplicaciones[0].saldoPendiente) === 0,
    'El pago total no cerro el fiado.');
    const partialReceipt = await expect(advanced, `/api/cobros-fiado/${partial.idCobroFiado}/comprobante`, {}, 200,
      'Comprobante de cobro parcial');
    assert(partialReceipt.comprobante.numero && Number(partialReceipt.comprobante.montoTotal) === 3
      && Number(partialReceipt.comprobante.saldoAnterior) === 10
      && Number(partialReceipt.comprobante.saldoPosterior) === 7
      && partialReceipt.distribuciones.length === 1
      && Number(partialReceipt.distribuciones[0].monto) === 3,
    'El comprobante parcial no reconstruyo el monto o los saldos historicos.');
    assert(!Object.keys(partialReceipt.comprobante).some((key) => /claveoperacion/i.test(key)),
      'El comprobante expuso la clave interna de operacion.');
    const fullReceipt = await expect(advanced, `/api/cobros-fiado/${fullPayment.idCobroFiado}`, {}, 200,
      'Detalle de cobro total');
    assert(Number(fullReceipt.comprobante.saldoAnterior) === 7
      && Number(fullReceipt.comprobante.saldoPosterior) === 0
      && Number(fullReceipt.distribuciones[0].saldoPosterior) === 0,
    'El comprobante total no conserva la secuencia historica del fiado.');
    await connection.query('UPDATE cobroFiado SET esLegado=1 WHERE idTienda=? AND idCobroFiado=?',
      [fixture.advancedStore, partial.idCobroFiado]);
    const legacyReceipt = await expect(advanced, `/api/cobros-fiado/${partial.idCobroFiado}/comprobante`, {}, 200,
      'Comprobante legado');
    assert(legacyReceipt.comprobante.esLegado === true && legacyReceipt.distribuciones.length === 1,
      'Un cobro legado no se identifico o rompio su distribucion.');
    await connection.query('UPDATE cobroFiado SET esLegado=0 WHERE idTienda=? AND idCobroFiado=?',
      [fixture.advancedStore, partial.idCobroFiado]);
    assert(await scalar(connection, 'SELECT stockUnidadesTotal total FROM producto WHERE idTienda=? AND idProducto=?',
      [fixture.advancedStore, product.idProducto]) === stockBeforePayment,
    'El cobro modifico el stock.');
    assert(await scalar(connection, 'SELECT COUNT(*) total FROM movimientoStock WHERE idTienda=? AND idProducto=?',
      [fixture.advancedStore, product.idProducto]) === movementsBeforePayment,
    'El cobro creo movimientos de stock.');

    await connection.query('UPDATE fiado SET activo=0, eliminadoEn=? WHERE idTienda=? AND idFiado=?',
      [formatLocalDateTime(), fixture.advancedStore, firstCredit.idFiado]);
    const accumulated = await expect(advanced, '/api/pagos-fiado/cliente', { method: 'POST', body: {
      idCliente: customer.idCliente,
      monto: 12,
      metodoPago: 'transferencia',
      referencia: `TR-${marker}`,
      claveOperacion: `cobro-acumulado-${marker}`
    } }, 201, 'Cobro acumulado');
    assert(accumulated.aplicaciones.length >= 2, 'El cobro acumulado no se distribuyo por antiguedad.');
    assert(accumulated.aplicaciones.some((item) => Number(item.idFiado) === Number(firstCredit.idFiado)),
      'La deuda oculta fue excluida del cobro acumulado.');
    await connection.query('UPDATE fiado SET fechaVencimiento=? WHERE idTienda=? AND idFiado=?',
      [invalidDate, fixture.advancedStore, inheritedCredit.idFiado]);

    const concurrentCredit = await expect(advanced, '/api/pos/ventas', { method: 'POST', body: saleBody(marker,
      'fiado-concurrente', product.idProducto, customer.idCliente) }, 201, 'Fiado para concurrencia');
    const concurrentBodies = [
      { monto: 7, metodoPago: 'qr', claveOperacion: `cobro-concurrente-a-${marker}` },
      { monto: 7, metodoPago: 'qr', claveOperacion: `cobro-concurrente-b-${marker}` }
    ];
    const concurrentResponses = await Promise.all([
      advanced.request(`/api/fiados/${concurrentCredit.idFiado}/pagos`, { method: 'POST', body: concurrentBodies[0] }),
      concurrent.request(`/api/fiados/${concurrentCredit.idFiado}/pagos`, { method: 'POST', body: concurrentBodies[1] })
    ]);
    assert(concurrentResponses.map((response) => response.status).sort().join(',') === '201,400',
      `La concurrencia no rechazo el sobrepago: ${JSON.stringify(concurrentResponses.map((response) => response.status))}`);
    await connection.query(
      'UPDATE fiado SET fechaVencimiento=NULL, fechaPrometidaPago=NULL WHERE idTienda=? AND idFiado=?',
      [fixture.advancedStore, concurrentCredit.idFiado]
    );
    const dueTodayCredit = await expect(advanced, '/api/pos/ventas', { method: 'POST', body: saleBody(marker,
      'fiado-vence-hoy', product.idProducto, customer.idCliente, [], { fechaVencimiento: formatLocalDate() }) }, 201,
    'Fiado que vence hoy');
    assert(dueTodayCredit.fechaVencimiento === formatLocalDate(), 'El fiado no conservo el vencimiento de hoy.');

    const promiseDate = addDays(formatLocalDate(), 5);
    const beforePromise = await expect(advanced, `/api/fiados/${confirmedCredit.idFiado}`, {}, 200, 'Detalle antes de promesa');
    const originalDueDate = String(beforePromise.fiado.fechaVencimiento || '').slice(0, 10);
    await expect(advanced, `/api/fiados/${confirmedCredit.idFiado}/fecha-prometida`, { method: 'PATCH', body: {
      fechaPrometidaPago: promiseDate,
      detalle: 'Cliente promete pagar en cinco dias.',
      canal: 'telefono'
    } }, 200, 'Fecha prometida');
    const promiseDebt = await expect(advanced, `/api/fiados/${confirmedCredit.idFiado}`, {}, 200, 'Detalle con promesa');
    assert(String(promiseDebt.fiado.fechaPrometidaPago).slice(0, 10) === promiseDate,
      'La fecha prometida no se guardo o sustituyo la original.');
    assert(String(promiseDebt.fiado.fechaVencimiento || '').slice(0, 10) === originalDueDate,
      'La promesa reemplazo el vencimiento original.');
    await expect(advanced, '/api/cobranza/seguimientos', { method: 'POST', body: {
      idCliente: customer.idCliente,
      idFiado: confirmedCredit.idFiado,
      tipo: 'compromiso_pago',
      canal: 'whatsapp',
      detalle: 'Compromiso confirmado manualmente.',
      fechaCompromiso: addDays(formatLocalDate(), 2)
    } }, 201, 'Seguimiento de compromiso');
    const followups = await expect(advanced, `/api/cobranza/seguimientos?cliente=${customer.idCliente}`, {}, 200, 'Listar seguimientos');
    assert(followups.seguimientos.length >= 2, 'El historial inmutable no conserva seguimientos.');
    for (let index = 0; index < 21; index += 1) {
      await expect(advanced, '/api/cobranza/seguimientos', { method: 'POST', body: {
        idCliente: customer.idCliente,
        idFiado: confirmedCredit.idFiado,
        tipo: 'nota',
        canal: 'telefono',
        detalle: `Nota de paginacion ${index + 1} ${marker}`
      } }, 201, `Crear seguimiento reciente ${index + 1}`);
    }
    const advancedProfile = await expect(advanced, `/api/clientes/${customer.idCliente}`, {}, 200,
      'Detalle avanzado del cliente');
    assert(advancedProfile.permisos.seguimientoCobranza === true
      && advancedProfile.seguimientos.length === 20
      && advancedProfile.historial.seguimientos.total >= 21
      && advancedProfile.historial.seguimientos.truncado === true,
    'La ficha avanzada no informo correctamente el historial reciente truncado.');
    const advancedDebtDetail = await expect(advanced, `/api/fiados/${confirmedCredit.idFiado}`, {}, 200,
      'Detalle avanzado del fiado');
    assert(advancedDebtDetail.permisos.seguimientoCobranza === true
      && advancedDebtDetail.seguimientos.length === 20
      && advancedDebtDetail.historial.seguimientos.truncado === true,
    'El detalle avanzado del fiado no informo su historial reciente truncado.');

    const prepared = await expect(advanced, '/api/cobranza/mensaje-whatsapp/preparar', { method: 'POST', body: {
      idCliente: customer.idCliente,
      idFiado: confirmedCredit.idFiado,
      tipoPlantilla: 'recordatorio_previo',
      registrarPreparacion: true
    } }, 200, 'Preparar WhatsApp');
    assert(prepared.url?.startsWith('https://wa.me/591') && prepared.enviado === false,
      'WhatsApp no genero un enlace seguro o afirmo envio.');
    await expect(advanced, '/api/configuracion-credito', { method: 'PUT', body: { codigoPaisWhatsApp: null } }, 200, 'Quitar codigo de pais');
    const manualCopy = await expect(advanced, '/api/cobranza/mensaje-whatsapp/preparar', { method: 'POST', body: {
      idCliente: customer.idCliente, idFiado: confirmedCredit.idFiado, tipoPlantilla: 'estado_cuenta'
    } }, 200, 'WhatsApp para copia manual');
    assert(manualCopy.url === null && manualCopy.texto, 'Sin codigo de pais no devolvio copia manual.');

    const initialTemplates = await expect(advanced, '/api/plantillas-cobranza?limite=100', {}, 200,
      'Listar plantillas propias');
    assert(initialTemplates.plantillas.length >= 4
      && initialTemplates.plantillas.every((item) => TEMPLATE_TYPES_FOR_TEST.includes(item.tipo)),
    'La tienda avanzada no recibio sus plantillas iniciales o tipos validos.');
    const createdTemplate = await expect(advanced, '/api/plantillas-cobranza', { method: 'POST', body: {
      tipo: 'confirmacion_pago',
      nombre: `Confirmacion ${marker}`,
      contenido: '<b>Pago</b> {{monto_pagado}} de {{cliente}}. Saldo {{saldo_restante}}.',
      activo: true
    } }, 201, 'Crear plantilla valida');
    assert(createdTemplate.plantilla.contenido.includes('<b>Pago</b>'),
      'El HTML inocuo no se conservo como texto literal en la plantilla.');
    await expect(advanced, '/api/plantillas-cobranza', { method: 'POST', body: {
      tipo: 'desconocido', nombre: `Tipo ${marker}`, contenido: 'Texto'
    } }, 400, 'Rechazar tipo de plantilla invalido');
    await expect(advanced, '/api/plantillas-cobranza', { method: 'POST', body: {
      tipo: 'recordatorio_previo', nombre: '', contenido: 'Texto'
    } }, 400, 'Rechazar nombre de plantilla vacio');
    await expect(advanced, '/api/plantillas-cobranza', { method: 'POST', body: {
      tipo: 'recordatorio_previo', nombre: `Vacia ${marker}`, contenido: ''
    } }, 400, 'Rechazar contenido de plantilla vacio');
    await expect(advanced, '/api/plantillas-cobranza', { method: 'POST', body: {
      tipo: 'recordatorio_previo', nombre: `Variable ${marker}`, contenido: 'Hola {{objeto.ruta}}'
    } }, 400, 'Rechazar variable desconocida');
    await expect(advanced, '/api/plantillas-cobranza', { method: 'POST', body: {
      tipo: 'recordatorio_previo', nombre: `Script ${marker}`, contenido: '<script>alert(1)</script>'
    } }, 400, 'Rechazar HTML ejecutable');
    await expect(advanced, '/api/plantillas-cobranza', { method: 'POST', body: {
      tipo: 'confirmacion_pago', nombre: `Confirmacion ${marker}`, contenido: 'Duplicada'
    } }, 409, 'Rechazar plantilla duplicada');
    const editedTemplate = await expect(advanced,
      `/api/plantillas-cobranza/${createdTemplate.plantilla.idPlantillaCobranza}`, { method: 'PATCH', body: {
        nombre: `Confirmacion editada ${marker}`,
        contenido: 'Pago {{monto_pagado}} por {{metodo_pago}}. Referencia {{referencia}}.'
      } }, 200, 'Editar plantilla propia');
    assert(editedTemplate.plantilla.nombre.includes('editada'), 'La plantilla propia no se actualizo.');
    await expect(advanced, `/api/plantillas-cobranza/${createdTemplate.plantilla.idPlantillaCobranza}`, {
      method: 'PATCH', body: { tipo: 'deuda_vencida' }
    }, 409, 'El tipo de plantilla es inmutable');
    const confirmationMessage = await expect(advanced, '/api/cobranza/mensaje-whatsapp/preparar', {
      method: 'POST', body: {
        idCliente: customer.idCliente,
        idCobroFiado: partial.idCobroFiado,
        tipoPlantilla: 'confirmacion_pago',
        idPlantillaCobranza: createdTemplate.plantilla.idPlantillaCobranza
      }
    }, 200, 'Preparar confirmacion de pago historica');
    assert(confirmationMessage.enviado === false
      && confirmationMessage.texto.includes('3.00')
      && confirmationMessage.texto.includes('efectivo')
      && confirmationMessage.plantilla.idPlantillaCobranza === createdTemplate.plantilla.idPlantillaCobranza,
    'La confirmacion no uso la plantilla elegida o los datos historicos del cobro.');
    await expect(advanced, `/api/plantillas-cobranza/${createdTemplate.plantilla.idPlantillaCobranza}/desactivar`, {
      method: 'PATCH', body: {}
    }, 200, 'Desactivar plantilla');
    await expect(advanced, `/api/plantillas-cobranza/${createdTemplate.plantilla.idPlantillaCobranza}/desactivar`, {
      method: 'PATCH', body: {}
    }, 409, 'Desactivar plantilla repetida');
    await expect(advanced, '/api/cobranza/mensaje-whatsapp/preparar', { method: 'POST', body: {
      idCliente: customer.idCliente,
      idCobroFiado: partial.idCobroFiado,
      tipoPlantilla: 'confirmacion_pago',
      idPlantillaCobranza: createdTemplate.plantilla.idPlantillaCobranza
    } }, 409, 'Rechazar plantilla inactiva');
    await expect(advanced, `/api/plantillas-cobranza/${createdTemplate.plantilla.idPlantillaCobranza}/activar`, {
      method: 'PATCH', body: {}
    }, 200, 'Activar plantilla');
    await expect(advanced, `/api/plantillas-cobranza/${createdTemplate.plantilla.idPlantillaCobranza}/activar`, {
      method: 'PATCH', body: {}
    }, 409, 'Activar plantilla repetida');
    const automaticConfirmation = await expect(advanced, '/api/cobranza/mensaje-whatsapp/preparar', {
      method: 'POST', body: { idCliente: customer.idCliente, idCobroFiado: partial.idCobroFiado, tipoPlantilla: 'confirmacion_pago' }
    }, 200, 'Fallback determinista de plantilla');
    assert(automaticConfirmation.plantilla.idPlantillaCobranza === createdTemplate.plantilla.idPlantillaCobranza,
      'El fallback no eligio la plantilla activa actualizada mas reciente.');
    const activeConfirmations = await expect(advanced,
      '/api/plantillas-cobranza?tipo=confirmacion_pago&activo=1&limite=100', {}, 200,
      'Listar confirmaciones activas');
    for (const template of activeConfirmations.plantillas) {
      await expect(advanced, `/api/plantillas-cobranza/${template.idPlantillaCobranza}/desactivar`, {
        method: 'PATCH', body: {}
      }, 200, `Desactivar confirmacion ${template.idPlantillaCobranza}`);
    }
    const internalFallback = await expect(advanced, '/api/cobranza/mensaje-whatsapp/preparar', {
      method: 'POST', body: { idCliente: customer.idCliente, idCobroFiado: partial.idCobroFiado, tipoPlantilla: 'confirmacion_pago' }
    }, 200, 'Texto interno cuando no hay plantilla activa');
    assert(internalFallback.plantilla.origen === 'fallback_interno' && internalFallback.texto.includes('3.00'),
      'La ausencia de plantillas activas no uso el fallback interno seguro.');
    await expect(advanced, `/api/plantillas-cobranza/${createdTemplate.plantilla.idPlantillaCobranza}/activar`, {
      method: 'PATCH', body: {}
    }, 200, 'Restaurar confirmacion activa para pruebas posteriores');
    await expect(advanced, '/api/cobranza/mensaje-whatsapp/preparar', { method: 'POST', body: {
      idCliente: customer.idCliente,
      idFiado: confirmedCredit.idFiado,
      tipoPlantilla: 'recordatorio_previo',
      idPlantillaCobranza: createdTemplate.plantilla.idPlantillaCobranza
    } }, 409, 'Rechazar plantilla de tipo incorrecto');
    await expect(advanced, `/api/clientes/${customer.idCliente}`, { method: 'PATCH', body: { aceptaRecordatorios: false } }, 200, 'Desactivar recordatorios');
    await expect(advanced, '/api/cobranza/mensaje-whatsapp/preparar', { method: 'POST', body: {
      idCliente: customer.idCliente, idFiado: confirmedCredit.idFiado
    } }, 409, 'Preferencia de recordatorios');

    const account = await expect(advanced, `/api/clientes/${customer.idCliente}/estado-cuenta`, {}, 200, 'Estado de cuenta');
    assert(account.fiadosAbiertos.length > 0 && account.pagos.length > 0 && account.movimientos.length > 0,
      'El estado de cuenta no contiene deuda, pagos y movimientos.');
    assert(new Set(account.movimientos.map((item) => item.tipo)).size >= 2,
      'El estado de cuenta no combino los tipos de movimiento disponibles.');
    const movementIdentity = (item) => `${item.tipo}:${item.idVenta || ''}:${item.idFiado || ''}:${item.idPagoFiado || ''}`;
    const accountFirstPage = await expect(advanced,
      `/api/clientes/${customer.idCliente}/estado-cuenta?pagina=1&limite=3`, {}, 200,
      'Primera pagina del estado de cuenta');
    const accountFirstPageRepeat = await expect(advanced,
      `/api/clientes/${customer.idCliente}/estado-cuenta?pagina=1&limite=3`, {}, 200,
      'Orden determinista del estado de cuenta');
    assert(accountFirstPage.page === 1 && accountFirstPage.pageSize === 3
      && accountFirstPage.totalPages === Math.ceil(accountFirstPage.total / 3)
      && accountFirstPage.hasPreviousPage === false,
    'Los metadatos de la primera pagina del estado de cuenta son incorrectos.');
    assert(accountFirstPage.movimientos.map(movementIdentity).join('|')
      === accountFirstPageRepeat.movimientos.map(movementIdentity).join('|'),
    'La cronologia combinada no tiene un orden determinista.');
    const allMovementIds = [];
    for (let page = 1; page <= accountFirstPage.totalPages; page += 1) {
      const accountPage = page === 1 ? accountFirstPage : await expect(advanced,
        `/api/clientes/${customer.idCliente}/estado-cuenta?pagina=${page}&limite=3`, {}, 200,
        `Pagina ${page} del estado de cuenta`);
      assert(accountPage.page === page, `La pagina ${page} devolvio metadatos incorrectos.`);
      allMovementIds.push(...accountPage.movimientos.map(movementIdentity));
    }
    assert(allMovementIds.length === accountFirstPage.total
      && new Set(allMovementIds).size === accountFirstPage.total,
    'La paginacion combinada omitio o duplico movimientos.');
    const alerts = await expect(advanced, '/api/cobranza/alertas', {}, 200, 'Alertas de cobranza');
    assert(alerts.alertas.some((item) => item.estadoCobranza === 'vencido')
      && alerts.alertas.some((item) => item.estadoCobranza === 'vence_hoy')
      && alerts.alertas.some((item) => item.estadoCobranza === 'proximo_a_vencer')
      && alerts.alertas.some((item) => item.estadoCobranza === 'sin_fecha'),
    'Las alertas no clasificaron vencidos, vence hoy, proximos y sin fecha.');
    const expectedOverdue = await scalar(connection,
      `SELECT COUNT(*) total FROM fiado
       WHERE idTienda=? AND saldoPendiente>0
         AND COALESCE(fechaPrometidaPago,fechaVencimiento) IS NOT NULL
         AND COALESCE(fechaPrometidaPago,fechaVencimiento)<?`,
      [fixture.advancedStore, formatLocalDate()]);
    const expectedOverdueDebt = await scalar(connection,
      `SELECT COALESCE(SUM(saldoPendiente),0) total FROM fiado
       WHERE idTienda=? AND saldoPendiente>0
         AND COALESCE(fechaPrometidaPago,fechaVencimiento) IS NOT NULL
         AND COALESCE(fechaPrometidaPago,fechaVencimiento)<?`,
      [fixture.advancedStore, formatLocalDate()]);
    const overdueAlerts = await expect(advanced, '/api/cobranza/alertas?estado=vencido&pagina=1&limite=1', {}, 200,
      'Alertas vencidas filtradas antes de paginar');
    assert(overdueAlerts.total === expectedOverdue
      && overdueAlerts.resumen.vencidos === expectedOverdue
      && Number(overdueAlerts.resumen.deudaTotal) === expectedOverdueDebt
      && overdueAlerts.alertas.every((item) => item.estadoCobranza === 'vencido'),
    'El filtro o los totales globales de alertas vencidas no coinciden con la tienda.');
    if (expectedOverdue > 1) {
      assert(overdueAlerts.alertas.length === 1 && Number(overdueAlerts.resumen.deudaTotal) > Number(overdueAlerts.alertas[0].saldoPendiente),
        'Los totales de alertas se calcularon solo con la pagina visible.');
    }
    const noAlertMatches = await expect(advanced,
      `/api/cobranza/alertas?busqueda=${encodeURIComponent(`sin-coincidencia-${marker}`)}&pagina=1&limite=1`, {}, 200,
      'Alertas sin coincidencias');
    assert(noAlertMatches.total === 0 && noAlertMatches.alertas.length === 0,
      'Una pagina vacia de alertas informo coincidencias globales inexistentes.');
    await expect(advanced, '/api/cobranza/alertas?estado=no_valido', {}, 400, 'Estado de alerta invalido');

    const otherCustomer = await expect(other, '/api/clientes', { method: 'POST', body: {
      nombre: `Cliente aislado ${marker}`, telefono: '76543210', documentoIdentidad: `CI-${marker}`
    } }, 201, 'Cliente otra tienda');
    const otherCredit = await expect(other, '/api/pos/ventas', { method: 'POST', body: saleBody(
      marker, 'fiado-otra-tienda', otherProduct.idProducto, otherCustomer.idCliente
    ) }, 201, 'Fiado de tienda aislada');

    const frequent = await expect(advanced,
      '/api/clientes/segmentacion?segmento=frecuentes&comprasMinimas=5&page=1&pageSize=20', {}, 200,
      'Segmentar clientes frecuentes');
    assert(frequent.resultados.some((item) => Number(item.idCliente) === Number(customer.idCliente)
      && Number(item.cantidadCompras) >= 5 && item.motivo.includes('Frecuente:')),
    'El cliente frecuente no cumplio el umbral o no explica el criterio aplicado.');
    const frequentStrict = await expect(advanced,
      '/api/clientes/segmentacion?segmento=frecuentes&comprasMinimas=100&page=1&pageSize=20', {}, 200,
      'Umbral estricto de frecuencia');
    assert(!frequentStrict.resultados.some((item) => Number(item.idCliente) === Number(customer.idCliente)),
      'Un cliente por debajo del umbral aparecio como frecuente.');

    const inactiveSegment = await expect(advanced,
      '/api/clientes/segmentacion?segmento=inactivos&diasSinCompra=90&page=1&pageSize=100', {}, 200,
      'Segmentar clientes inactivos');
    assert(inactiveSegment.resultados.some((item) => Number(item.idCliente) === Number(noPhone.idCliente)
      && item.ultimaCompra === null)
      && inactiveSegment.resultados.some((item) => Number(item.idCliente) === Number(oldCustomer.idCliente)
        && Number(item.diasDesdeUltimaCompra) >= 90)
      && !inactiveSegment.resultados.some((item) => Number(item.idCliente) === Number(disabled.idCliente)),
    'La inactividad no distinguio nunca compro, compra antigua y compra reciente.');
    assert(!inactiveSegment.resultados.some((item) => Number(item.idCliente) === Number(inactive.idCliente)),
      'Los clientes ocultos se incluyeron por defecto como inactivos.');
    const inactiveAll = await expect(advanced,
      '/api/clientes/segmentacion?segmento=inactivos&diasSinCompra=90&estadoCliente=todos&pageSize=100', {}, 200,
      'Segmentacion incluye ocultos de forma explicita');
    assert(inactiveAll.resultados.some((item) => Number(item.idCliente) === Number(inactive.idCliente) && item.activo === false),
      'El estado todos no incluyo al cliente oculto.');

    const withDebtSegment = await expect(advanced,
      '/api/clientes/segmentacion?segmento=con_deuda&page=1&pageSize=100', {}, 200,
      'Segmentar clientes con deuda');
    const customerDebtRow = withDebtSegment.resultados.find((item) => Number(item.idCliente) === Number(customer.idCliente));
    const expectedCustomerDebt = await scalar(connection,
      'SELECT COALESCE(SUM(saldoPendiente),0) total FROM fiado WHERE idTienda=? AND idCliente=? AND saldoPendiente>0',
      [fixture.advancedStore, customer.idCliente]);
    assert(customerDebtRow && Number(customerDebtRow.saldoPendiente) === expectedCustomerDebt
      && withDebtSegment.resultados.every((item) => Number(item.saldoPendiente) > 0),
    'El segmento con deuda no coincide con el saldo canonico de cobranza.');
    assert(!withDebtSegment.resultados.some((item) => Number(item.idCliente) === Number(punctualCustomer.idCliente)),
      'Un cliente sin saldo aparecio en el segmento con deuda.');

    const overdueSegment = await expect(advanced,
      '/api/clientes/segmentacion?segmento=vencidos&page=1&pageSize=100', {}, 200,
      'Segmentar clientes vencidos');
    assert(overdueSegment.resultados.some((item) => Number(item.idCliente) === Number(customer.idCliente)
      && Number(item.saldoVencido) > 0 && Number(item.diasMaximoAtraso) >= 1)
      && !overdueSegment.resultados.some((item) => Number(item.idCliente) === Number(duplicatePhone.idCliente)),
    'El segmento vencido no respeto la fecha local original o incluyo deuda futura.');

    const promisedBeforeTest = addDays(formatLocalDate(), 2);
    await connection.query('UPDATE fiado SET fechaPrometidaPago=? WHERE idTienda=? AND idFiado=?',
      [invalidDate, fixture.advancedStore, confirmedCredit.idFiado]);
    const brokenPromise = await expect(advanced,
      '/api/clientes/segmentacion?segmento=promesa_incumplida&page=1&pageSize=100', {}, 200,
      'Segmentar promesas incumplidas');
    assert(brokenPromise.resultados.some((item) => Number(item.idCliente) === Number(customer.idCliente)
      && String(item.fechaPrometida).slice(0, 10) === invalidDate),
    'La promesa vencida no se clasifico con la fecha local.');
    await connection.query('UPDATE fiado SET fechaPrometidaPago=? WHERE idTienda=? AND idFiado=?',
      [promisedBeforeTest, fixture.advancedStore, confirmedCredit.idFiado]);
    const futurePromise = await expect(advanced,
      `/api/clientes/segmentacion?segmento=promesa_incumplida&busqueda=${encodeURIComponent(`Cliente puntual ${marker}`)}`, {}, 200,
      'Promesa futura no incumplida');
    assert(futurePromise.resultados.length === 0, 'Una promesa futura aparecio como incumplida.');

    const goodPayersDefault = await expect(advanced,
      `/api/clientes/segmentacion?segmento=buenos_pagadores&busqueda=${encodeURIComponent(`Cliente puntual ${marker}`)}`, {}, 200,
      'Buen pagador exige historial suficiente');
    assert(goodPayersDefault.resultados.length === 0,
      'Un solo fiado cerrado fue suficiente para clasificar como buen pagador con los valores predeterminados.');
    const goodPayersCustom = await expect(advanced,
      `/api/clientes/segmentacion?segmento=buenos_pagadores&minimoFiadosCerrados=1&porcentajePuntualMinimo=80&busqueda=${encodeURIComponent(`Cliente puntual ${marker}`)}`, {}, 200,
      'Buen pagador con umbral verificable');
    assert(goodPayersCustom.resultados.length === 1
      && Number(goodPayersCustom.resultados[0].porcentajePuntualidad) === 100,
    'El porcentaje puntual de un historial evaluable no se calculo correctamente.');
    assert(!goodPayersCustom.resultados.some((item) => Number(item.idCliente) === Number(customer.idCliente)),
      'Un cliente con deuda vencida actual aparecio como buen pagador.');

    const purchaseRanking = await expect(advanced,
      '/api/clientes/segmentacion?segmento=mayor_compra&page=1&pageSize=100', {}, 200,
      'Ranking por compras');
    assert(purchaseRanking.resultados.every((item, index, rows) => index === 0
      || Number(rows[index - 1].totalComprado) >= Number(item.totalComprado)),
    'El ranking de compras no esta ordenado de forma descendente.');
    const customerPurchase = purchaseRanking.resultados.find((item) => Number(item.idCliente) === Number(customer.idCliente));
    const [[expectedPurchase]] = await connection.query(
      `SELECT COUNT(*) cantidad, COALESCE(SUM(total),0) total
       FROM venta WHERE idTienda=? AND idCliente=? AND fecha>=? AND fecha<?`,
      [fixture.advancedStore, customer.idCliente,
        formatLocalDateTime(addLocalDays(parseLocalDate(formatLocalDate()), -89)),
        formatLocalDateTime(addLocalDays(parseLocalDate(formatLocalDate()), 1))]
    );
    assert(customerPurchase && Number(customerPurchase.totalComprado) === Number(expectedPurchase.total)
      && Number(customerPurchase.ticketPromedio) === Number((Number(expectedPurchase.total) / Number(expectedPurchase.cantidad)).toFixed(2)),
    'El total comprado o ticket promedio no coincide con las ventas del periodo.');
    const balanceRanking = await expect(advanced,
      '/api/clientes/segmentacion?segmento=mayor_saldo&page=1&pageSize=100', {}, 200,
      'Ranking por saldo');
    assert(balanceRanking.resultados.every((item, index, rows) => index === 0
      || Number(rows[index - 1].saldoPendiente) >= Number(item.saldoPendiente)),
    'El ranking de saldo no esta ordenado de forma descendente.');

    const filteredPage = await expect(advanced,
      `/api/clientes/segmentacion?segmento=inactivos&estadoCliente=todos&busqueda=${encodeURIComponent(marker)}&page=1&pageSize=1`, {}, 200,
      'Filtros antes de paginar segmentacion');
    const filteredPageRepeat = await expect(advanced,
      `/api/clientes/segmentacion?segmento=inactivos&estadoCliente=todos&busqueda=${encodeURIComponent(marker)}&page=1&pageSize=1`, {}, 200,
      'Orden determinista de segmentacion');
    assert(filteredPage.paginacion.total >= filteredPage.resultados.length
      && filteredPage.resumen.totalClientes === filteredPage.paginacion.total
      && filteredPage.resultados.map((item) => item.idCliente).join(',')
        === filteredPageRepeat.resultados.map((item) => item.idCliente).join(','),
    'El conteo, filtro o el orden determinista se calculo despues de paginar.');

    await expect(advanced, '/api/clientes/segmentacion?segmento=no_existe', {}, 400,
      'Segmento invalido');
    await expect(advanced, '/api/clientes/segmentacion?segmento=frecuentes&dias=-1', {}, 400,
      'Rango negativo de segmentacion');
    await expect(advanced,
      `/api/clientes/segmentacion?segmento=frecuentes&fechaDesde=${addDays(formatLocalDate(), 1)}&fechaHasta=${formatLocalDate()}`,
      {}, 400, 'Fechas invalidas de segmentacion');
    await expect(advanced, '/api/clientes/segmentacion?segmento=frecuentes&pageSize=101', {}, 400,
      'Tamano excesivo de pagina');
    await expect(basic, '/api/clientes/segmentacion?segmento=con_deuda', {}, 403,
      'Plan basico no accede a segmentacion');
    const isolatedSegmentation = await expect(other,
      `/api/clientes/segmentacion?segmento=con_deuda&busqueda=${encodeURIComponent(marker)}&pageSize=100`, {}, 200,
      'Segmentacion aislada por tienda');
    assert(isolatedSegmentation.resultados.some((item) => Number(item.idCliente) === Number(otherCustomer.idCliente))
      && !isolatedSegmentation.resultados.some((item) => Number(item.idCliente) === Number(customer.idCliente))
      && Number(isolatedSegmentation.resumen.saldoPendiente) === Number(otherCredit.nuevoSaldoFiado),
    'La segmentacion o sus agregados mezclaron tiendas.');
    const crossSearch = await expect(advanced,
      `/api/clientes/segmentacion?segmento=con_deuda&busqueda=${encodeURIComponent(`Cliente aislado ${marker}`)}`, {}, 200,
      'Busqueda no cruza tenants');
    assert(crossSearch.resultados.length === 0 && crossSearch.resumen.totalClientes === 0,
      'La busqueda manipulada encontro un cliente de otra tienda.');

    const otherTemplate = await expect(other, '/api/plantillas-cobranza', { method: 'POST', body: {
      tipo: 'recordatorio_previo', nombre: `Aislada ${marker}`, contenido: 'Hola {cliente}'
    } }, 201, 'Crear plantilla en otra tienda');
    await expect(advanced, `/api/plantillas-cobranza/${otherTemplate.plantilla.idPlantillaCobranza}`, {
      method: 'PATCH', body: { nombre: 'Cruce prohibido' }
    }, 404, 'No editar plantilla de otra tienda');
    const ownTemplatesAfterCross = await expect(advanced, '/api/plantillas-cobranza?limite=100', {}, 200,
      'Plantillas aisladas por tienda');
    assert(!ownTemplatesAfterCross.plantillas.some((item) => Number(item.idPlantillaCobranza) === Number(otherTemplate.plantilla.idPlantillaCobranza)),
      'El listado de plantillas mezclo tiendas.');
    await expect(other, `/api/clientes/${customer.idCliente}`, {}, 404, 'Cliente aislado');
    await expect(other, `/api/fiados/${confirmedCredit.idFiado}`, {}, 404, 'Fiado aislado');
    await expect(other, `/api/fiados/${confirmedCredit.idFiado}/pagos`, { method: 'POST', body: {
      monto: 1, metodoPago: 'efectivo', claveOperacion: `cruce-${marker}`
    } }, 404, 'Cobro cruzado rechazado');
    await expect(other, `/api/cobros-fiado/${partial.idCobroFiado}/comprobante`, {}, 404,
      'Comprobante de otra tienda rechazado');
    assert(otherCustomer.idCliente, 'No se creo el cliente de aislamiento.');

    const customerExportResponse = await expectRaw(
      advanced,
      `/api/clientes/exportacion.xlsx?estado=activos&texto=${encodeURIComponent(marker)}`,
      200,
      'Exportar clientes avanzados'
    );
    const customerWorkbook = await workbookFrom(customerExportResponse, 'clientes_');
    const customerSheet = customerWorkbook.getWorksheet('Clientes');
    assert(customerSheet && customerSheet.getRow(1).getCell(1).value === 'ID cliente',
      'La hoja de clientes no tiene el encabezado esperado.');
    const exportedCustomerNames = customerSheet.getColumn(2).values.slice(2).map(String);
    assert(exportedCustomerNames.length > 0
      && exportedCustomerNames.every((name) => name.includes(marker))
      && !exportedCustomerNames.some((name) => name.includes('Cliente aislado')),
    'La exportacion de clientes no respeto la busqueda o mezclo tiendas.');
    assert(customerSheet.getRow(2).getCell(1).type === ExcelJS.ValueType.Number
      && customerSheet.getRow(2).getCell(9).value instanceof Date,
    'Los identificadores o fechas de clientes dejaron de ser tipos XLSX reales.');
    const customerHeaders = customerSheet.getRow(1).values.slice(1).join('|').toLowerCase();
    assert(!/(password|hash|token|claveoperacion|idtienda)/.test(customerHeaders),
      'La exportacion de clientes contiene columnas sensibles o del tenant.');

    const noCreditExport = await workbookFrom(await expectRaw(
      advanced,
      '/api/clientes/exportacion.xlsx?estado=activos&permiteFiado=0',
      200,
      'Exportar clientes sin fiado'
    ), 'clientes_');
    const noCreditIds = noCreditExport.getWorksheet('Clientes').getColumn(1).values.slice(2).map(Number);
    assert(noCreditIds.includes(Number(disabled.idCliente)),
      'La exportacion no respeto permiteFiado=0.');

    const injectionExport = await workbookFrom(await expectRaw(
      advanced,
      `/api/clientes/exportacion.xlsx?estado=ocultos&documento=${encodeURIComponent('-1+1')}`,
      200,
      'Exportar cliente con formulas potenciales'
    ), 'clientes_');
    const injectionRow = injectionExport.getWorksheet('Clientes').getRow(2);
    assert(String(injectionRow.getCell(2).value).startsWith("'=")
      && String(injectionRow.getCell(3).value).startsWith("'+")
      && String(injectionRow.getCell(5).value).startsWith("'-")
      && String(injectionRow.getCell(7).value).startsWith("'@"),
    'La exportacion no neutralizo =, +, - y @ en texto de usuario.');
    assert(sanitizeSpreadsheetCell('\t+CMD') === "'\t+CMD"
      && sanitizeSpreadsheetCell('  =SUM(1,1)') === "'  =SUM(1,1)"
      && sanitizeSpreadsheetCell('\u200b@HYPERLINK') === "'\u200b@HYPERLINK"
      && sanitizeSpreadsheetCell('Texto normal') === 'Texto normal'
      && sanitizeSpreadsheetCell(12.5) === 12.5,
    'La neutralizacion no cubre espacios, tabulaciones o caracteres invisibles, o altera valores seguros.');
    const safeName = safeExportFileName('estado:cuenta', '../Cliente AUX', formatLocalDate());
    assert(!/[<>:"/\\|?*\u0000-\u001f]/.test(safeName)
      && safeName.endsWith(`${formatLocalDate()}.xlsx`) && safeName.length <= 160,
    `El nombre de archivo no es seguro: ${safeName}`);

    const debtExportResponse = await expectRaw(
      advanced,
      `/api/fiados/exportacion.xlsx?estado=vencido&venceHasta=${formatLocalDate()}&soloAbiertos=1`,
      200,
      'Exportar fiados vencidos'
    );
    const debtWorkbook = await workbookFrom(debtExportResponse, 'fiados_');
    const debtSheet = debtWorkbook.getWorksheet('Cobranza');
    const debtHeader = findHeaderRow(debtSheet, 'ID fiado');
    const exportedDebtRows = [];
    for (let rowNumber = debtHeader.number + 1; rowNumber <= debtSheet.rowCount; rowNumber += 1) {
      const row = debtSheet.getRow(rowNumber);
      if (row.getCell(1).value !== null) exportedDebtRows.push(row);
    }
    assert(Number(debtSheet.getRow(2).getCell(2).value) === expectedOverdue
      && Number(debtSheet.getRow(3).getCell(2).value) === expectedOverdueDebt
      && exportedDebtRows.length === expectedOverdue
      && exportedDebtRows.every((row) => row.getCell(7).value === 'vencido'),
    'Los totales o filtros globales de la exportacion de fiados son incorrectos.');

    const statementExportResponse = await expectRaw(
      advanced,
      `/api/clientes/${customer.idCliente}/estado-cuenta/exportacion.xlsx`,
      200,
      'Exportar estado de cuenta completo'
    );
    const statementWorkbook = await workbookFrom(statementExportResponse, 'estado_cuenta_');
    const statementSheet = statementWorkbook.getWorksheet('Estado de cuenta');
    const statementHeader = findHeaderRow(statementSheet, 'Fecha');
    const statementRows = [];
    for (let rowNumber = statementHeader.number + 1; rowNumber <= statementSheet.rowCount; rowNumber += 1) {
      const row = statementSheet.getRow(rowNumber);
      if (row.getCell(1).value !== null) statementRows.push(row);
    }
    assert(statementRows.length === accountFirstPage.total,
      'El estado de cuenta XLSX quedo limitado a la pagina visual.');
    for (let index = 1; index < statementRows.length; index += 1) {
      assert(statementRows[index - 1].getCell(1).value.getTime() <= statementRows[index].getCell(1).value.getTime(),
        'El estado de cuenta XLSX no tiene orden cronologico determinista.');
    }
    let expectedRunningBalance = Number(statementSheet.getRow(7).getCell(2).value || 0);
    for (const row of statementRows) {
      expectedRunningBalance = Number((expectedRunningBalance
        + Number(row.getCell(7).value || 0) - Number(row.getCell(8).value || 0)).toFixed(2));
      assert(Number(row.getCell(9).value) === expectedRunningBalance,
        'El saldo acumulado del estado de cuenta es incorrecto.');
    }
    const currentCustomerDebt = await scalar(connection,
      'SELECT COALESCE(SUM(saldoPendiente),0) total FROM fiado WHERE idTienda=? AND idCliente=?',
      [fixture.advancedStore, customer.idCliente]);
    assert(Number(statementSheet.getRow(8).getCell(2).value) === currentCustomerDebt
      && expectedRunningBalance === currentCustomerDebt,
    'El saldo final exportado no coincide con la deuda reconciliada.');

    const otherCustomerExport = await workbookFrom(await expectRaw(
      other,
      `/api/clientes/exportacion.xlsx?estado=todos&texto=${encodeURIComponent(marker)}`,
      200,
      'Exportar clientes de tienda aislada'
    ), 'clientes_');
    const otherNames = otherCustomerExport.getWorksheet('Clientes').getColumn(2).values.slice(2).map(String);
    assert(otherNames.includes(`Cliente aislado ${marker}`)
      && !otherNames.includes(`Cliente credito ${marker}`),
    'La exportacion de clientes mezclo tiendas.');
    const otherDebtExport = await workbookFrom(await expectRaw(
      other,
      '/api/fiados/exportacion.xlsx?soloAbiertos=1',
      200,
      'Exportar fiados de tienda aislada'
    ), 'fiados_');
    const otherDebtSheet = otherDebtExport.getWorksheet('Cobranza');
    const otherDebtHeader = findHeaderRow(otherDebtSheet, 'ID fiado');
    const otherDebtIds = otherDebtSheet.getColumn(1).values.slice(otherDebtHeader.number + 1).map(Number).filter(Boolean);
    assert(otherDebtIds.length === 1 && otherDebtIds[0] === Number(otherCredit.idFiado)
      && !otherDebtIds.includes(Number(confirmedCredit.idFiado)),
    'La exportacion de fiados mezclo tiendas.');
    await expect(other, `/api/clientes/${customer.idCliente}/estado-cuenta/exportacion.xlsx`, {}, 404,
      'Estado de cuenta de otra tienda rechazado');

    let limitError = null;
    try {
      await exportCustomers(connection, fixture.advancedStore, { estado: 'todos', texto: marker }, {
        limits: { customers: 1, debts: 1, statement: 1 }
      });
    } catch (error) {
      limitError = error;
    }
    assert(limitError?.status === 413 && limitError?.code === 'EXPORT_ROW_LIMIT_EXCEEDED',
      'Superar el limite de exportacion no produjo un error controlado sin truncamiento.');

    const basicCustomer = await expect(basic, '/api/clientes', { method: 'POST', body: {
      nombre: `Cliente basico ${marker}`, telefono: '71111111'
    } }, 201, 'Cliente plan basico');
    const basicExport = await expectRaw(basic, '/api/clientes/exportacion.xlsx', 403,
      'Plan basico no exporta clientes');
    assert(JSON.parse(basicExport.buffer.toString('utf8')).code === 'PLAN_FEATURE_REQUIRED',
      'El plan basico no recibio el error estable de funcionalidad para exportar.');
    await expectRaw(basic, '/api/fiados/exportacion.xlsx', 403,
      'Plan basico no exporta fiados');
    await expectRaw(basic, `/api/clientes/${basicCustomer.idCliente}/estado-cuenta/exportacion.xlsx`, 403,
      'Plan basico no exporta estado de cuenta');
    await expect(basic, '/api/configuracion-credito', {}, 200, 'Lectura operativa de configuracion basica');
    await expect(basic, '/api/configuracion-credito', { method: 'PUT', body: { limiteCreditoDefault: 20 } }, 403, 'Configuracion avanzada bloqueada');
    await expect(basic, '/api/cobranza/alertas', {}, 403, 'Recordatorios avanzados bloqueados');
    const basicCredit = await expect(basic, '/api/pos/ventas', { method: 'POST', body: saleBody(marker,
      'fiado-basico', basicProduct.idProducto, basicCustomer.idCliente) }, 201, 'Fiado basico operativo');
    const basicPayment = await expect(basic, `/api/fiados/${basicCredit.idFiado}/pagos`, { method: 'POST', body: {
      monto: 5, metodoPago: 'efectivo', claveOperacion: `cobro-basico-${marker}`
    } }, 201, 'Pago disponible en basico');
    await expect(basic, `/api/cobros-fiado/${basicPayment.idCobroFiado}/comprobante`, {}, 200,
      'Comprobante disponible con pagos_fiado');
    await expect(basic, '/api/plantillas-cobranza', {}, 403,
      'Plan basico no accede a plantillas avanzadas');
    await expect(noFeature, `/api/cobros-fiado/${partial.idCobroFiado}/comprobante`, {}, 403,
      'Plan sin pagos_fiado no accede a comprobantes');
    const basicProfile = await expect(basic, `/api/clientes/${basicCustomer.idCliente}`, {}, 200,
      'Detalle basico del cliente');
    assert(basicProfile.permisos.seguimientoCobranza === false
      && !Object.prototype.hasOwnProperty.call(basicProfile, 'seguimientos')
      && !Object.prototype.hasOwnProperty.call(basicProfile.historial, 'seguimientos'),
    'El plan basico recibio seguimientos desde el detalle del cliente.');
    const basicDebtDetail = await expect(basic, `/api/fiados/${basicCredit.idFiado}`, {}, 200,
      'Detalle basico del fiado');
    assert(basicDebtDetail.permisos.seguimientoCobranza === false
      && !Object.prototype.hasOwnProperty.call(basicDebtDetail, 'seguimientos'),
    'El plan basico recibio seguimientos desde el detalle del fiado.');
    await expect(basic, '/api/cobranza/seguimientos', {}, 403, 'Seguimientos bloqueados en plan basico');
    await expect(basic, `/api/fiados/${basicCredit.idFiado}/fecha-prometida`, { method: 'PATCH', body: {
      fechaPrometidaPago: addDays(formatLocalDate(), 2),
      detalle: 'El plan basico no debe crear seguimientos.',
      canal: 'telefono'
    } }, 403, 'Promesa bloqueada sin seguimiento de cobranza');
    await expect(basic, `/api/clientes/${basicCustomer.idCliente}/estado-cuenta?pagina=1&limite=2`, {}, 200,
      'Estado de cuenta disponible en plan basico');
    const basicHiddenCustomer = await expect(basic, '/api/clientes', { method: 'POST', body: {
      nombre: `Cliente ocultable ${marker}`, telefono: '71111112'
    } }, 201, 'Cliente para ocultar y restaurar');
    const defaultActiveList = await expect(basic, '/api/clientes', {}, 200, 'Listado predeterminado de clientes activos');
    assert(defaultActiveList.some((item) => Number(item.idCliente) === Number(basicCustomer.idCliente))
      && defaultActiveList.every((item) => item.activo === true),
    'El listado sin estado no quedo limitado a clientes activos.');
    const [[historyBeforeHide]] = await connection.query(
      `SELECT c.activo, c.eliminadoEn,
              (SELECT COUNT(*) FROM venta v WHERE v.idTienda=c.idTienda AND v.idCliente=c.idCliente) ventas,
              (SELECT COUNT(*) FROM fiado f WHERE f.idTienda=c.idTienda AND f.idCliente=c.idCliente) fiados,
              (SELECT COUNT(*) FROM pagoFiado pf JOIN fiado f
               ON f.idTienda=pf.idTienda AND f.idFiado=pf.idFiado
               WHERE f.idTienda=c.idTienda AND f.idCliente=c.idCliente) pagos,
              (SELECT COALESCE(SUM(f.saldoPendiente),0) FROM fiado f
               WHERE f.idTienda=c.idTienda AND f.idCliente=c.idCliente) saldo
       FROM cliente c WHERE c.idTienda=? AND c.idCliente=?`,
      [fixture.basicStore, basicCustomer.idCliente]
    );
    const hiddenResult = await expect(basic, `/api/clientes/${basicCustomer.idCliente}`, {
      method: 'DELETE', body: { password: basicStore.password }
    }, 200, 'Ocultar cliente con permiso basico');
    assert(hiddenResult.cliente.activo === false
      && Number(hiddenResult.cliente.saldoPendiente) === Number(historyBeforeHide.saldo),
    'La respuesta de ocultacion no conservo el saldo real.');
    await expect(basic, `/api/clientes/${basicCustomer.idCliente}`, {
      method: 'DELETE', body: { password: basicStore.password }
    }, 409, 'Ocultar dos veces devuelve conflicto');
    await expect(other, `/api/clientes/${basicCustomer.idCliente}`, {
      method: 'DELETE', body: { password: otherStore.password }
    }, 404, 'Otra tienda no oculta cliente ajeno');
    await expect(other, `/api/clientes/${basicCustomer.idCliente}/restaurar`, {
      method: 'PATCH', body: { password: otherStore.password }
    }, 404, 'Otra tienda no restaura cliente ajeno');

    const hiddenProfile = await expect(basic, `/api/clientes/${basicCustomer.idCliente}`, {}, 200,
      'Ficha historica de cliente oculto');
    assert(hiddenProfile.cliente.activo === false && hiddenProfile.cliente.eliminadoEn,
      'La ficha no identifica al cliente oculto.');
    await expect(basic, `/api/clientes/${basicCustomer.idCliente}`, {
      method: 'PATCH', body: { nombre: 'No debe editarse oculto' }
    }, 404, 'Cliente oculto no admite edicion normal');
    const activeList = await expect(basic,
      `/api/clientes?estado=activos&texto=${encodeURIComponent(marker)}&pagina=1&limite=20`, {}, 200,
      'Listado activo excluye ocultos');
    assert(!activeList.clientes.some((item) => Number(item.idCliente) === Number(basicCustomer.idCliente)),
      'El cliente oculto continuo en el listado activo.');
    const hiddenList = await expect(basic,
      `/api/clientes?estado=ocultos&texto=${encodeURIComponent(marker)}&pagina=1&limite=20`, {}, 200,
      'Listado de clientes ocultos');
    assert(hiddenList.clientes.some((item) => Number(item.idCliente) === Number(basicCustomer.idCliente))
      && hiddenList.clientes.every((item) => item.activo === false && item.eliminadoEn),
    'El listado oculto no devolvio estado y fecha de ocultacion.');
    const allCustomers = await expect(basic,
      `/api/clientes?estado=todos&texto=${encodeURIComponent(marker)}&pagina=1&limite=1`, {}, 200,
      'Listado de todos los estados con paginacion');
    assert(allCustomers.total >= 2 && allCustomers.clientes.length === 1
      && Number(allCustomers.resumen.clientesFiltrados) === allCustomers.total,
    'El conteo o la paginacion no respetan el filtro de estado.');
    await expect(basic, '/api/clientes?estado=ambiguo&pagina=1&limite=20', {}, 400,
      'Estado de cliente invalido');

    const posHidden = await expect(basic,
      `/api/pos/clientes?q=${encodeURIComponent(`Cliente basico ${marker}`)}`, {}, 200,
      'POS excluye cliente oculto');
    assert(!(posHidden.clientes || posHidden).some((item) => Number(item.idCliente) === Number(basicCustomer.idCliente)),
      'El selector POS devolvio un cliente oculto.');
    const posPaged = await expect(basic,
      `/api/pos/clientes?q=${encodeURIComponent(`Cliente basico ${marker}`)}&page=1&limit=1`, {}, 200,
      'POS pagina busqueda de clientes');
    assert(Array.isArray(posPaged.clientes) && Number(posPaged.limite) === 1 && posPaged.clientes.length <= 1,
      `La busqueda POS paginada no limito la respuesta: ${JSON.stringify(posPaged)}.`);
    await expect(basic, '/api/pos/clientes?q=ab&page=1&limit=51', {}, 400,
      'POS rechaza limite de clientes fuera de rango');
    await expect(basic, '/api/pos/ventas', { method: 'POST', body: saleBody(marker,
      'fiado-cliente-oculto', basicProduct.idProducto, basicCustomer.idCliente) }, 404,
    'Venta fiada rechaza cliente oculto');
    const hiddenCollection = await expect(basic,
      `/api/fiados?cliente=${basicCustomer.idCliente}&pagina=1&limite=20`, {}, 200,
      'Cobranza conserva cliente oculto');
    assert(hiddenCollection.fiados.some((item) => Number(item.idFiado) === Number(basicCredit.idFiado)
      && item.clienteActivo === false),
    'La cobranza historica oculto la deuda o no marco al cliente.');
    const paymentWhileHidden = await expect(basic, `/api/fiados/${basicCredit.idFiado}/pagos`, {
      method: 'POST', body: {
        monto: 1, metodoPago: 'efectivo', claveOperacion: `cobro-cliente-oculto-${marker}`
      }
    }, 201, 'Cliente oculto conserva cobro de deuda existente');
    assert(paymentWhileHidden.aplicaciones.length === 1,
      'El cobro del cliente oculto no se aplico exactamente una vez.');
    const [[afterHide]] = await connection.query(
      `SELECT c.activo, c.eliminadoEn, c.idAdministradorActualiza,
              (SELECT COUNT(*) FROM venta v WHERE v.idTienda=c.idTienda AND v.idCliente=c.idCliente) ventas,
              (SELECT COUNT(*) FROM fiado f WHERE f.idTienda=c.idTienda AND f.idCliente=c.idCliente) fiados,
              (SELECT COUNT(*) FROM pagoFiado pf JOIN fiado f
               ON f.idTienda=pf.idTienda AND f.idFiado=pf.idFiado
               WHERE f.idTienda=c.idTienda AND f.idCliente=c.idCliente) pagos,
              (SELECT COALESCE(SUM(f.saldoPendiente),0) FROM fiado f
               WHERE f.idTienda=c.idTienda AND f.idCliente=c.idCliente) saldo
       FROM cliente c WHERE c.idTienda=? AND c.idCliente=?`,
      [fixture.basicStore, basicCustomer.idCliente]
    );
    assert(Number(afterHide.ventas) === Number(historyBeforeHide.ventas)
      && Number(afterHide.fiados) === Number(historyBeforeHide.fiados)
      && Number(afterHide.pagos) === Number(historyBeforeHide.pagos) + 1
      && Number(afterHide.saldo) === Number(historyBeforeHide.saldo) - 1
      && afterHide.eliminadoEn && afterHide.idAdministradorActualiza,
    'Ocultar altero historial o no preservo la auditoria minima.');

    await expect(basic, `/api/clientes/${basicCustomer.idCliente}/restaurar`, {
      method: 'PATCH', body: { password: basicStore.password }
    }, 200, 'Restaurar cliente con permiso basico');
    await expect(basic, `/api/clientes/${basicCustomer.idCliente}/restaurar`, {
      method: 'PATCH', body: { password: basicStore.password }
    }, 409, 'Restaurar dos veces devuelve conflicto');
    const [[afterRestore]] = await connection.query(
      `SELECT activo, eliminadoEn,
              (SELECT COALESCE(SUM(saldoPendiente),0) FROM fiado f
               WHERE f.idTienda=cliente.idTienda AND f.idCliente=cliente.idCliente) saldo
       FROM cliente WHERE idTienda=? AND idCliente=?`,
      [fixture.basicStore, basicCustomer.idCliente]
    );
    assert(Number(afterRestore.activo) === 1 && afterRestore.eliminadoEn === null
      && Number(afterRestore.saldo) === Number(historyBeforeHide.saldo) - 1,
    'Restaurar modifico la deuda o no limpio eliminadoEn.');
    assert(await scalar(connection, 'SELECT COUNT(*) total FROM cliente WHERE idTienda=? AND idCliente=?',
      [fixture.basicStore, basicCustomer.idCliente]) === 1,
    'Ocultar o restaurar elimino fisicamente al cliente.');

    const [[noFeatureOwner]] = await connection.query(
      "SELECT idAdministrador FROM administrador WHERE idTienda=? AND rol='dueno_tienda' LIMIT 1",
      [fixture.noFeatureStore]
    );
    const noFeatureNow = formatLocalDateTime();
    const [noFeatureCustomer] = await connection.query(
      `INSERT INTO cliente
       (idTienda,nombre,telefono,activo,creadoEn,actualizadoEn,idAdministradorCrea)
       VALUES (?,?,?,1,?,?,?)`,
      [fixture.noFeatureStore, `Cliente sin funcion ${marker}`, '70001010',
        noFeatureNow, noFeatureNow, noFeatureOwner.idAdministrador]
    );
    await expect(noFeature, `/api/clientes/${noFeatureCustomer.insertId}`, {
      method: 'DELETE', body: { password: noFeatureStore.password }
    }, 403, 'Plan sin clientes_basico no oculta');
    await expect(noFeature, `/api/clientes/${noFeatureCustomer.insertId}/restaurar`, {
      method: 'PATCH', body: { password: noFeatureStore.password }
    }, 403, 'Plan sin clientes_basico no restaura');
    assert(basicHiddenCustomer.idCliente, 'No se creo el cliente activo de comparacion.');
    const [[basicSubscription]] = await connection.query(
      'SELECT idSuscripcion,estado FROM suscripcionTienda WHERE idTienda=? ORDER BY idSuscripcion DESC LIMIT 1',
      [fixture.basicStore]
    );
    await connection.query('UPDATE suscripcionTienda SET estado=?,actualizadoEn=? WHERE idSuscripcion=?',
      ['suspendida', formatLocalDateTime(), basicSubscription.idSuscripcion]);
    await expect(basic, `/api/clientes/${basicCustomer.idCliente}`, {}, 200,
      'Lectura de clientes permitida en modo solo lectura suspendido');
    const suspendedExport = await expectRaw(basic, '/api/clientes/exportacion.xlsx', 403,
      'Suscripcion suspendida no exporta');
    assert(JSON.parse(suspendedExport.buffer.toString('utf8')).code === 'SUBSCRIPTION_SUSPENDED',
      'La exportacion con suscripcion suspendida no devolvio el contrato esperado.');
    await expect(basic, `/api/fiados/${basicCredit.idFiado}/pagos`, { method: 'POST', body: {
      monto: 1, metodoPago: 'efectivo', claveOperacion: `cobro-suspendido-${marker}`
    } }, 403, 'Cobro bloqueado con suscripcion suspendida');
    await connection.query('UPDATE suscripcionTienda SET estado=?,actualizadoEn=? WHERE idSuscripcion=?',
      [basicSubscription.estado, formatLocalDateTime(), basicSubscription.idSuscripcion]);

    const [[advancedSubscription]] = await connection.query(
      'SELECT idSuscripcion,idPlan FROM suscripcionTienda WHERE idTienda=? ORDER BY idSuscripcion DESC LIMIT 1',
      [fixture.advancedStore]
    );
    await connection.query('UPDATE suscripcionTienda SET estado=?,actualizadoEn=? WHERE idSuscripcion=?',
      ['suspendida', formatLocalDateTime(), advancedSubscription.idSuscripcion]);
    await expect(advanced, '/api/clientes/segmentacion?segmento=con_deuda', {}, 200,
      'Lectura de segmentacion permitida en modo solo lectura suspendido');
    await expect(advanced, '/api/plantillas-cobranza', {}, 200,
      'Lectura de plantillas permitida en modo solo lectura suspendido');
    const suspendedTemplateWrite = await expect(advanced, '/api/plantillas-cobranza', { method: 'POST', body: {
      tipo: 'recordatorio_previo', nombre: `Suspendida ${marker}`, contenido: 'No debe guardarse'
    } }, 403, 'Suscripcion suspendida no crea plantillas');
    assert(suspendedTemplateWrite.code === 'SUBSCRIPTION_SUSPENDED',
      'La escritura suspendida no devolvio el contrato de acceso restringido.');
    await expect(advanced, `/api/cobros-fiado/${partial.idCobroFiado}/comprobante`, {}, 403,
      'Comprobante fuera de lectura suspendida permitida');
    await connection.query('UPDATE suscripcionTienda SET estado=?,actualizadoEn=? WHERE idSuscripcion=?',
      ['activa', formatLocalDateTime(), advancedSubscription.idSuscripcion]);
    await connection.query('UPDATE suscripcionTienda SET idPlan=? WHERE idSuscripcion=?', [plans.basic.idPlan, advancedSubscription.idSuscripcion]);
    const catalogChangedDebt = await expect(advanced, `/api/fiados/${confirmedCredit.idFiado}`, {}, 200,
      'Deuda visible con catalogo modificado');
    assert(catalogChangedDebt.permisos.seguimientoCobranza === true
      && Object.prototype.hasOwnProperty.call(catalogChangedDebt, 'seguimientos'),
    'El cambio directo de catalogo altero el snapshot vigente.');
    const downgradePayment = await expect(advanced, `/api/fiados/${confirmedCredit.idFiado}/pagos`, { method: 'POST', body: {
      monto: 1, metodoPago: 'qr', claveOperacion: `cobro-downgrade-${marker}`
    } }, 201, 'Cobro permitido por snapshot vigente');
    await expect(advanced, `/api/clientes/${customer.idCliente}/estado-cuenta`, {}, 200,
      'Estado de cuenta preservado por snapshot');
    await expect(advanced, '/api/cobranza/seguimientos', {}, 200,
      'Seguimiento preservado por snapshot');
    await connection.query('UPDATE suscripcionTienda SET idPlan=? WHERE idSuscripcion=?', [advancedSubscription.idPlan, advancedSubscription.idSuscripcion]);

    const today = formatLocalDate();
    const financialSummary = await expect(advanced,
      `/api/reportes/finanzas/resumen?desde=${today}&hasta=${today}`, {}, 200, 'Cobros en finanzas');
    assert(Number(financialSummary.cobrosFiado) > 0 && Number(financialSummary.dineroCobrado) > 0,
      'Los cobros de fiado no aparecen en finanzas.');
    const paymentMethods = await expect(advanced,
      `/api/reportes/finanzas/metodos-pago?desde=${today}&hasta=${today}`, {}, 200, 'Metodos de cobro de fiado');
    assert(paymentMethods.filas.some((row) => row.metodoPago === 'transferencia' && Number(row.cobrosFiado) === 12),
      'La transferencia de un cobro acumulado perdio su metodo financiero real.');
    const cashRangeEnd = await captureExclusiveLocalEnd(downgradePayment.fechaCobro);
    const cashCloseAfter = await expect(advanced,
      `/api/caja/cierres/calcular?fechaInicio=${encodeURIComponent(cashObservationStart)}&fechaFin=${encodeURIComponent(cashRangeEnd)}&efectivoInicial=0`,
      {}, 200, 'Cobros en calculo de caja');
    const cashDifference = (field) => Number((Number(cashCloseAfter[field]) - Number(cashCloseBefore[field])).toFixed(2));
    const cashCloseDifference = {
      efectivoVentasEsperado: cashDifference('efectivoVentasEsperado'),
      efectivoFiadosCobrado: cashDifference('efectivoFiadosCobrado'),
      efectivoEsperado: cashDifference('efectivoEsperado'),
      totalQR: cashDifference('totalQR'),
      totalNoEspecificado: cashDifference('totalNoEspecificado'),
      totalCobrado: cashDifference('totalCobrado')
    };
    assert(cashCloseDifference.efectivoVentasEsperado === 0
      && cashCloseDifference.efectivoFiadosCobrado === 3
      && cashCloseDifference.efectivoEsperado === 3
      && cashCloseDifference.totalQR === 15
      && cashCloseDifference.totalNoEspecificado === 12
      && cashCloseDifference.totalCobrado === 30,
    `Los cobros no se reflejan una sola vez en el calculo de caja. Diferencia esperada: ${JSON.stringify({
      efectivoVentasEsperado: 0,
      efectivoFiadosCobrado: 3,
      efectivoEsperado: 3,
      totalQR: 15,
      totalNoEspecificado: 12,
      totalCobrado: 30
    })}. Diferencia recibida: ${JSON.stringify(cashCloseDifference)}`);

    assert(await scalar(connection,
      `SELECT COUNT(*) total FROM pagoFiado pf LEFT JOIN cobroFiado cf
       ON cf.idTienda=pf.idTienda AND cf.idCobroFiado=pf.idCobroFiado
       WHERE pf.idTienda=? AND (cf.idCobroFiado IS NULL OR pf.claveDistribucion IS NULL)`,
      [fixture.advancedStore]) === 0,
    'Existe un pago sin cabecera o clave de distribucion.');
    assert(await scalar(connection,
      `SELECT COUNT(*) total FROM fiado f LEFT JOIN (
         SELECT idTienda,idFiado,COALESCE(SUM(monto),0) pagado FROM pagoFiado GROUP BY idTienda,idFiado
       ) p ON p.idTienda=f.idTienda AND p.idFiado=f.idFiado
       WHERE f.idTienda=? AND ABS(f.totalPagado-COALESCE(p.pagado,0))>=0.01`,
      [fixture.advancedStore]) === 0,
    'Los saldos no reconcilian con las distribuciones.');
    assert(await scalar(connection,
      `SELECT COUNT(*) total FROM (
         SELECT pv.idPagoFiado
         FROM pagoVenta pv
         WHERE pv.idTienda=? AND pv.idPagoFiado IS NOT NULL
         GROUP BY pv.idPagoFiado
         HAVING COUNT(*)<>1
       ) pagosDuplicados`, [fixture.advancedStore]) === 0,
    'Existe un pagoFiado sin un unico pagoVenta asociado.');
    assert(await scalar(connection,
      `SELECT COUNT(*) total FROM pagoVenta pv JOIN pagoFiado pf
       ON pf.idTienda=pv.idTienda AND pf.idPagoFiado=pv.idPagoFiado
       WHERE pv.idTienda=?`, [fixture.advancedStore])
      === await scalar(connection, 'SELECT COUNT(*) total FROM pagoFiado WHERE idTienda=? AND idFiado IN (SELECT idFiado FROM fiado WHERE idTienda=? AND idVenta IS NOT NULL)',
        [fixture.advancedStore, fixture.advancedStore]),
    'Los cobros duplicaron o perdieron pagoVenta.');
    assert(await scalar(connection, 'SELECT COUNT(*) total FROM loteProducto WHERE idTienda=?', [fixture.advancedStore]) === 0,
      'Los cobros crearon lotes.');

    console.log('Prueba de clientes, fiados y comunicacion completada correctamente.');
  } finally {
    if (connection) {
      try { await cleanup(connection, fixture); } finally { await connection.end(); }
    }
  }
}

main().catch((error) => {
  console.error('La prueba de clientes, fiados y comunicacion fallo.');
  console.error(error.message);
  process.exit(1);
});
