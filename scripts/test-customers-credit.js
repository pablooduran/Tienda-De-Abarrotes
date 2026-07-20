const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { createDatabaseConnection } = require('../config/database-connection');
const { requireLocalhostDatabase } = require('../config/env');
const { addLocalDays, formatLocalDate, formatLocalDateTime, parseLocalDate } = require('../utils/local-datetime');
const { applyTestRequestSecurity } = require('./http-test-security');

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
  const advancedFeatures = ['limites_credito', 'seguimiento_cobranza', 'recordatorios_fiado'];
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
  if (fixture.superUser) await connection.query('DELETE FROM administrador WHERE usuario=?', [fixture.superUser]);
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
      nombre: `Cliente inactivo ${marker}`, telefono: '70000002'
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
    await expect(advanced, `/api/fiados/${confirmedCredit.idFiado}/fecha-prometida`, { method: 'PATCH', body: {
      fechaPrometidaPago: promiseDate,
      detalle: 'Cliente promete pagar en cinco dias.',
      canal: 'telefono'
    } }, 200, 'Fecha prometida');
    const promiseDebt = await expect(advanced, `/api/fiados/${confirmedCredit.idFiado}`, {}, 200, 'Detalle con promesa');
    assert(String(promiseDebt.fiado.fechaPrometidaPago).slice(0, 10) === promiseDate,
      'La fecha prometida no se guardo o sustituyo la original.');
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
      nombre: `Cliente aislado ${marker}`, telefono: '79999999'
    } }, 201, 'Cliente otra tienda');
    await expect(other, `/api/clientes/${customer.idCliente}`, {}, 404, 'Cliente aislado');
    await expect(other, `/api/fiados/${confirmedCredit.idFiado}`, {}, 404, 'Fiado aislado');
    await expect(other, `/api/fiados/${confirmedCredit.idFiado}/pagos`, { method: 'POST', body: {
      monto: 1, metodoPago: 'efectivo', claveOperacion: `cruce-${marker}`
    } }, 404, 'Cobro cruzado rechazado');
    assert(otherCustomer.idCliente, 'No se creo el cliente de aislamiento.');

    const basicCustomer = await expect(basic, '/api/clientes', { method: 'POST', body: {
      nombre: `Cliente basico ${marker}`, telefono: '71111111'
    } }, 201, 'Cliente plan basico');
    await expect(basic, '/api/configuracion-credito', {}, 200, 'Lectura operativa de configuracion basica');
    await expect(basic, '/api/configuracion-credito', { method: 'PUT', body: { limiteCreditoDefault: 20 } }, 403, 'Configuracion avanzada bloqueada');
    await expect(basic, '/api/cobranza/alertas', {}, 403, 'Recordatorios avanzados bloqueados');
    const basicCredit = await expect(basic, '/api/pos/ventas', { method: 'POST', body: saleBody(marker,
      'fiado-basico', basicProduct.idProducto, basicCustomer.idCliente) }, 201, 'Fiado basico operativo');
    await expect(basic, `/api/fiados/${basicCredit.idFiado}/pagos`, { method: 'POST', body: {
      monto: 5, metodoPago: 'efectivo', claveOperacion: `cobro-basico-${marker}`
    } }, 201, 'Pago disponible en basico');
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
      'Lectura historica con suscripcion suspendida');
    await expect(basic, `/api/fiados/${basicCredit.idFiado}/pagos`, { method: 'POST', body: {
      monto: 1, metodoPago: 'efectivo', claveOperacion: `cobro-suspendido-${marker}`
    } }, 403, 'Cobro bloqueado con suscripcion suspendida');
    await connection.query('UPDATE suscripcionTienda SET estado=?,actualizadoEn=? WHERE idSuscripcion=?',
      [basicSubscription.estado, formatLocalDateTime(), basicSubscription.idSuscripcion]);

    const [[advancedSubscription]] = await connection.query(
      'SELECT idSuscripcion,idPlan FROM suscripcionTienda WHERE idTienda=? ORDER BY idSuscripcion DESC LIMIT 1',
      [fixture.advancedStore]
    );
    await connection.query('UPDATE suscripcionTienda SET idPlan=? WHERE idSuscripcion=?', [plans.basic.idPlan, advancedSubscription.idSuscripcion]);
    const downgradedDebt = await expect(advanced, `/api/fiados/${confirmedCredit.idFiado}`, {}, 200, 'Deuda visible tras downgrade');
    assert(downgradedDebt.permisos.seguimientoCobranza === false
      && !Object.prototype.hasOwnProperty.call(downgradedDebt, 'seguimientos'),
    'El downgrade continuo exponiendo seguimientos avanzados.');
    const downgradePayment = await expect(advanced, `/api/fiados/${confirmedCredit.idFiado}/pagos`, { method: 'POST', body: {
      monto: 1, metodoPago: 'qr', claveOperacion: `cobro-downgrade-${marker}`
    } }, 201, 'Cobro permitido tras downgrade');
    await expect(advanced, `/api/clientes/${customer.idCliente}/estado-cuenta`, {}, 200, 'Estado de cuenta tras downgrade');
    await expect(advanced, '/api/cobranza/seguimientos', {}, 403, 'Seguimiento bloqueado tras downgrade');
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
