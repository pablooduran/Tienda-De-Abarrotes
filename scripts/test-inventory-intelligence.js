const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const ExcelJS = require('exceljs');
const { createDatabaseConnection } = require('../config/database-connection');
const { requireLocalhostDatabase } = require('../config/env');
const { formatLocalDate, formatLocalDateTime } = require('../utils/local-datetime');
const { applyTestRequestSecurity } = require('./http-test-security');

let currentTestStage = 'inicio';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

class HttpSession {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
    this.cookie = '';
  }

  async fetch(path, options = {}) {
    const request = { ...options, headers: { ...(options.headers || {}) }, redirect: 'manual' };
    if (request.body && typeof request.body !== 'string') {
      request.headers['content-type'] = 'application/json';
      request.body = JSON.stringify(request.body);
    }
    applyTestRequestSecurity(this.baseUrl, request);
    if (this.cookie) request.headers.cookie = this.cookie;
    const response = await fetch(`${this.baseUrl}${path}`, request);
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) this.cookie = setCookie.split(';')[0];
    return response;
  }

  async request(path, options = {}) {
    const response = await this.fetch(path, options);
    const text = await response.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = text; }
    return { status: response.status, body };
  }
}

function safeBody(value) {
  if (Array.isArray(value)) return value.map(safeBody);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !/(password|cookie|session|token|secret|hash)/i.test(key))
    .map(([key, item]) => [key, safeBody(item)]));
}

async function expect(session, path, options, status, label) {
  currentTestStage = `endpoint ${(options && options.method) || 'GET'} ${path.split('?')[0]}`;
  const response = await session.request(path, options);
  if (response.status !== status) {
    throw new Error(`${label}: se esperaba HTTP ${status}, se obtuvo ${response.status}. Respuesta: ${JSON.stringify(safeBody(response.body))}`);
  }
  return response.body;
}

function addDays(date, days, seconds = 0) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000 + seconds * 1000);
}

function storePayload(marker, code, planCodigo) {
  const password = `Owner-${code}-${crypto.randomBytes(10).toString('hex')}!`;
  return {
    password,
    body: {
      nombre: `Tienda inventario ${code} ${marker}`,
      slug: `tienda-inventario-${code}-${marker}`,
      estado: 'activa',
      activo: true,
      propietario: {
        usuario: `owner_inv_${code}_${marker}`,
        password,
        confirmacionPassword: password,
        activo: true
      },
      suscripcion: { planCodigo, tipo: 'cortesia', duracionDias: 30 }
    }
  };
}

async function scalar(connection, sql, params = []) {
  const [[row]] = await connection.query(sql, params);
  return Number(row.total || 0);
}

async function cleanupStore(connection, idTienda) {
  await connection.query('DELETE FROM detalleCompensacionLote WHERE idTienda=?', [idTienda]);
  await connection.query('DELETE FROM detalleCompensacionVenta WHERE idTienda=?', [idTienda]);
  await connection.query('DELETE FROM liquidacionCompensacionVenta WHERE idTienda=?', [idTienda]);
  await connection.query('DELETE FROM compensacionVenta WHERE idTienda=?', [idTienda]);
  await connection.query('DELETE FROM operacionCompensatoria WHERE idTienda=?', [idTienda]);
  await connection.query('DELETE FROM eventoAuditoriaAdministrativa WHERE idTienda=?', [idTienda]);
  await connection.query('DELETE FROM cierreCaja WHERE idTienda=?', [idTienda]);
  await connection.query('DELETE FROM gasto WHERE idTienda=?', [idTienda]);
  await connection.query('DELETE FROM categoriaGasto WHERE idTienda=?', [idTienda]);
  await connection.query('DELETE FROM movimientoStock WHERE idTienda=?', [idTienda]);
  await connection.query('DELETE FROM seguimientoCobranza WHERE idTienda=?', [idTienda]);
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
  const [stores] = await connection.query(
    'SELECT idTienda FROM tienda WHERE slug LIKE ?', [`tienda-inventario-%-${fixture.marker}`]
  );
  const ids = new Set([fixture.advancedStore, fixture.basicStore, ...stores.map((row) => row.idTienda)].filter(Boolean));
  for (const idTienda of ids) await cleanupStore(connection, idTienda);
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

async function createProduct(connection, fixture, specification) {
  const trackingDate = formatLocalDateTime(specification.trackingDate);
  const sold = specification.sold || 0;
  const currentStock = specification.stock;
  const initialStock = currentStock + sold;
  let idVenta = null;
  let idDetalleVenta = null;
  const [result] = await connection.query(
    `INSERT INTO producto
      (idTienda, nombre, categoria, unidadMedida, unidadesPorPaquete, precioVenta,
       stock, stockMinimo, stockUnidadesTotal, ultimoPrecioCompra,
       permiteVentaPorPaquete, permiteVentaPorUnidad, activo,
       presentacionCompraSugerida, fechaInicioSeguimiento)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
    [fixture.advancedStore, specification.name, specification.category || 'PRUEBA', specification.unit || 'unidad',
      specification.unitsPerPackage || 1, specification.price || 10, currentStock, specification.minimum,
      currentStock, specification.cost || 0, specification.unitsPerPackage > 1 ? 1 : 0,
      specification.active === false ? 0 : 1, specification.suggestedPresentation || null, trackingDate]
  );
  const idProducto = result.insertId;
  fixture.productIds.push(idProducto);
  if (initialStock > 0) {
    await connection.query(
      `INSERT INTO movimientoStock
        (idTienda, idProducto, tipoMovimiento, origen, cantidad, stockAnterior, stockPosterior,
         cantidadOperacion, unidadOperacion, motivo, claveOperacion, idAdministrador, creadoEn)
       VALUES (?, ?, 'inventario_inicial', 'alta_producto', ?, 0, ?, ?, 'unidad', ?, ?, ?, ?)`,
      [fixture.advancedStore, idProducto, initialStock, initialStock, initialStock,
        'Saldo inicial de prueba de inteligencia.', `inv-test-inicial:${fixture.marker}:${idProducto}`,
        fixture.advancedOwner, trackingDate]
    );
  }
  if (sold > 0) {
    const saleDate = formatLocalDateTime(specification.saleDate);
    const subtotal = sold * (specification.price || 10);
    const [sale] = await connection.query(
      `INSERT INTO venta
        (idTienda, fecha, subtotal, descuento, total, montoPagado, saldoPendiente,
        estadoPago, estadoOperacion, tipo, claveOperacion, codigoComprobante)
       VALUES (?, ?, ?, 0, ?, ?, 0, 'pagada', ?, 'pagada', ?, ?)`,
      [fixture.advancedStore, saleDate, subtotal, subtotal, subtotal,
        specification.saleState || 'vigente',
        `inv-test-venta:${fixture.marker}:${idProducto}`, `INV-${fixture.marker}-${idProducto}`]
    );
    const cost = specification.cost || 0;
    const [detail] = await connection.query(
      `INSERT INTO detalleVenta
        (idTienda, idVenta, idProducto, cantidad, precioVenta, costoUnitario, subtotal,
         subtotalCosto, ganancia, origenCosto, presentacionVenta, cantidadEquivalenteUnidades)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'unidad', ?)`,
      [fixture.advancedStore, sale.insertId, idProducto, sold, specification.price || 10, cost,
        subtotal, cost * sold, subtotal - cost * sold, cost > 0 ? 'real' : 'desconocido', sold]
    );
    idVenta = Number(sale.insertId);
    idDetalleVenta = Number(detail.insertId);
    await connection.query(
      `INSERT INTO pagoVenta
        (idTienda, idVenta, metodoPago, monto, montoRecibido, cambio,
         claveOperacion, idAdministrador, creadoEn)
       VALUES (?, ?, 'qr', ?, NULL, 0, ?, ?, ?)`,
      [fixture.advancedStore, sale.insertId, subtotal,
        `inv-test-pago:${fixture.marker}:${idProducto}`, fixture.advancedOwner, saleDate]
    );
    await connection.query(
      `INSERT INTO movimientoStock
        (idTienda, idProducto, tipoMovimiento, origen, cantidad, stockAnterior, stockPosterior,
         cantidadOperacion, unidadOperacion, motivo, idDetalleVenta, referenciaTipo,
         referenciaId, claveOperacion, idAdministrador, creadoEn)
       VALUES (?, ?, 'salida', 'venta', ?, ?, ?, ?, 'unidad', ?, ?, 'venta', ?, ?, ?, ?)`,
      [fixture.advancedStore, idProducto, -sold, initialStock, currentStock, sold,
        'Salida de venta de prueba de inteligencia.', detail.insertId, sale.insertId,
        `inv-test-venta-mov:${fixture.marker}:${idProducto}`, fixture.advancedOwner, saleDate]
    );
  }
  if (sold > 0) {
    fixture.salesByProduct.set(Number(idProducto), {
      idProducto: Number(idProducto),
      idVenta,
      idDetalleVenta
    });
  }
  return Number(idProducto);
}

async function addAppliedReturn(connection, fixture, sale, units, amount, date) {
  const timestamp = formatLocalDateTime(date);
  const key = `inv-test-devolucion:${fixture.marker}:${sale.idDetalleVenta}`;
  const [operation] = await connection.query(
    `INSERT INTO operacionCompensatoria
      (idTienda, tipoOperacion, estado, motivoCodigo, observacion, requiereAprobacion,
       idAdministradorSolicitante, idAdministradorAprobador, claveOperacion, huellaSolicitud,
       fechaSolicitud, fechaAprobacion, fechaAplicacion, creadoEn, actualizadoEn)
     VALUES (?, 'devolucion_venta', 'aplicada', 'devolucion_cliente', NULL, 0,
       ?, NULL, ?, REPEAT('a',64), ?, NULL, ?, ?, ?)`,
    [fixture.advancedStore, fixture.advancedOwner, key, timestamp, timestamp, timestamp, timestamp]
  );
  const [compensation] = await connection.query(
    `INSERT INTO compensacionVenta
      (idTienda,idOperacionCompensatoria,idVenta,tipoCompensacion,montoCompensado,costoCompensado,creadoEn)
     VALUES (?, ?, ?, 'devolucion_parcial', ?, 0, ?)`,
    [fixture.advancedStore, operation.insertId, sale.idVenta, amount, timestamp]
  );
  await connection.query(
    `INSERT INTO detalleCompensacionVenta
      (idTienda,idCompensacionVenta,idDetalleVenta,idProducto,unidadesDevueltas,montoCompensado,
       costoCompensado,tratamientoInventario,resultadoInventario,idMovimientoStock,creadoEn)
     VALUES (?, ?, ?, ?, ?, ?, 0, 'no_reintegrar', 'no_reintegrado', NULL, ?)`,
    [fixture.advancedStore, compensation.insertId, sale.idDetalleVenta, sale.idProducto, units, amount, timestamp]
  );
}

async function addNonDemandOperations(connection, fixture, productId, operationDate) {
  const date = formatLocalDateTime(operationDate);
  currentTestStage = 'setup: proveedor y operaciones que no representan demanda';
  const [provider] = await connection.query(
    'INSERT INTO proveedor (idTienda, nombre) VALUES (?, ?)',
    [fixture.advancedStore, `Proveedor inteligencia ${fixture.marker}`]
  );
  const [purchase] = await connection.query(
    'INSERT INTO compra (idTienda, fecha, total, idProveedor, claveOperacion) VALUES (?, ?, 5, ?, ?)',
    [fixture.advancedStore, date, provider.insertId, `inv-test-compra:${fixture.marker}`]
  );
  const [detail] = await connection.query(
    `INSERT INTO detalleCompra
      (idTienda, idCompra, idProducto, cantidad, precioCompra, subtotal,
       presentacionCompra, cantidadEquivalenteUnidades)
     VALUES (?, ?, ?, 1, 5, 5, 'unidad', 1)`,
    [fixture.advancedStore, purchase.insertId, productId]
  );
  const [[product]] = await connection.query(
    'SELECT stockUnidadesTotal FROM producto WHERE idTienda=? AND idProducto=?',
    [fixture.advancedStore, productId]
  );
  const stock = Number(product.stockUnidadesTotal);
  await connection.query(
    `INSERT INTO movimientoStock
      (idTienda, idProducto, tipoMovimiento, origen, cantidad, stockAnterior, stockPosterior,
       cantidadOperacion, unidadOperacion, motivo, idDetalleCompra, claveOperacion,
       idAdministrador, creadoEn)
     VALUES (?, ?, 'entrada', 'compra', 1, ?, ?, 1, 'unidad', ?, ?, ?, ?, ?)`,
    [fixture.advancedStore, productId, stock, stock + 1, 'Compra que no es demanda.', detail.insertId,
      `inv-test-compra-mov:${fixture.marker}`, fixture.advancedOwner, date]
  );
  await connection.query(
    `INSERT INTO movimientoStock
      (idTienda, idProducto, tipoMovimiento, origen, cantidad, stockAnterior, stockPosterior,
       motivo, claveOperacion, idAdministrador, creadoEn)
     VALUES (?, ?, 'ajuste_negativo', 'ajuste_manual', -1, ?, ?, ?, ?, ?, ?)`,
    [fixture.advancedStore, productId, stock + 1, stock, 'Ajuste que no es demanda.',
      `inv-test-ajuste:${fixture.marker}`, fixture.advancedOwner, date]
  );

  const [client] = await connection.query(
    `INSERT INTO cliente (idTienda, nombre, activo, creadoEn, actualizadoEn)
     VALUES (?, ?, 1, ?, ?)`,
    [fixture.advancedStore, `Cliente inteligencia ${fixture.marker}`, date, date]
  );
  const [creditSale] = await connection.query(
    `INSERT INTO venta
      (idTienda, fecha, subtotal, descuento, total, montoPagado, saldoPendiente,
       estadoPago, tipo, idCliente, claveOperacion, codigoComprobante)
     VALUES (?, ?, 10, 0, 10, 4, 6, 'parcial', 'fiada', ?, ?, ?)`,
    [fixture.advancedStore, date, client.insertId, `inv-test-fiado:${fixture.marker}`, `INV-F-${fixture.marker}`]
  );
  const [debt] = await connection.query(
    `INSERT INTO fiado
      (idTienda, idCliente, idVenta, fechaInicio, totalFiado, totalPagado, saldoPendiente, estado, activo)
     VALUES (?, ?, ?, ?, 10, 4, 6, 'parcial', 1)`,
    [fixture.advancedStore, client.insertId, creditSale.insertId, formatLocalDate(operationDate)]
  );
  const [collection] = await connection.query(
    `INSERT INTO cobroFiado
     (idTienda,idCliente,fechaCobro,montoTotal,metodoPago,montoRecibido,cambio,
      claveOperacion,creadoEn,idAdministrador,esLegado)
     VALUES (?, ?, ?, 4, 'efectivo', 4, 0, ?, ?, ?, 0)`,
    [fixture.advancedStore, client.insertId, date, `inv-test-cabecera-cobro:${fixture.marker}`,
      date, fixture.advancedOwner]
  );
  const [debtPayment] = await connection.query(
    `INSERT INTO pagoFiado
     (idTienda,idFiado,idCobroFiado,fechaPago,monto,observacion,claveDistribucion)
     VALUES (?, ?, ?, ?, 4, ?, ?)`,
    [fixture.advancedStore, debt.insertId, collection.insertId, date, 'Cobro que no es demanda.',
      `inv-test-distribucion:${fixture.marker}`]
  );
  await connection.query(
    `INSERT INTO pagoVenta
      (idTienda, idVenta, idPagoFiado, metodoPago, monto, montoRecibido, cambio,
       claveOperacion, idAdministrador, creadoEn)
     VALUES (?, ?, ?, 'efectivo', 4, 4, 0, ?, ?, ?)`,
    [fixture.advancedStore, creditSale.insertId, debtPayment.insertId,
      `inv-test-cobro:${fixture.marker}`, fixture.advancedOwner, date]
  );
}

function byName(rows, name) {
  return rows.find((row) => row.nombre === name);
}

async function main() {
  currentTestStage = 'validacion del entorno local protegido';
  const config = { ...requireLocalhostDatabase('La prueba de inteligencia de inventario'), decimalNumbers: true };
  if (!/(prueba|test)/i.test(config.database)) {
    throw new Error('La prueba requiere una base local cuyo nombre contenga prueba o test.');
  }
  const baseUrl = process.env.TEST_BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
  const target = new URL(baseUrl);
  if (!['localhost', '127.0.0.1', '::1'].includes(target.hostname)) {
    throw new Error('La prueba HTTP solo puede ejecutarse contra localhost.');
  }

  const marker = crypto.randomBytes(6).toString('hex');
  const fixture = { marker, productIds: [], salesByProduct: new Map(), superUser: `super_inv_${marker}` };
  const superPassword = `Super-${crypto.randomBytes(12).toString('hex')}!`;
  const sessions = [];
  let connection;

  try {
    currentTestStage = 'setup: conexion y estructura local';
    connection = await createDatabaseConnection(config);
    fixture.auditStartId = await scalar(
      connection,
      'SELECT COALESCE(MAX(idEventoAuditoria),0) total FROM eventoAuditoriaAdministrativa'
    );
    assert(await scalar(connection,
      "SELECT COUNT(*) total FROM schema_migrations WHERE nombre='010_inteligencia_inventario.sql'") === 1,
    'La migracion 010 debe estar aplicada.');

    currentTestStage = 'setup: administrador temporal';
    const superHash = await bcrypt.hash(superPassword, 12);
    await connection.query(
      "INSERT INTO administrador (idTienda, usuario, password, rol, activo) VALUES (NULL, ?, ?, 'superadmin', 1)",
      [fixture.superUser, superHash]
    );
    const superSession = new HttpSession(baseUrl);
    const advancedSession = new HttpSession(baseUrl);
    const basicSession = new HttpSession(baseUrl);
    sessions.push(superSession, advancedSession, basicSession);
    await expect(superSession, '/auth/login', {
      method: 'POST', body: { usuario: fixture.superUser, password: superPassword }
    }, 200, 'Login superadmin');

    const advancedStore = storePayload(marker, 'avanzado', 'avanzado');
    const basicStore = storePayload(marker, 'basico', 'basico');
    const createdAdvanced = await expect(superSession, '/api/admin/tiendas', {
      method: 'POST', body: advancedStore.body
    }, 201, 'Crear tienda avanzada');
    const createdBasic = await expect(superSession, '/api/admin/tiendas', {
      method: 'POST', body: basicStore.body
    }, 201, 'Crear tienda basica');
    fixture.advancedStore = createdAdvanced.tienda.idTienda;
    fixture.basicStore = createdBasic.tienda.idTienda;
    fixture.advancedSubscription = createdAdvanced.suscripcion.idSuscripcion;
    fixture.advancedOwner = createdAdvanced.propietario.idAdministrador;
    await expect(advancedSession, '/auth/login', {
      method: 'POST', body: { usuario: advancedStore.body.propietario.usuario, password: advancedStore.password }
    }, 200, 'Login avanzado');
    await expect(basicSession, '/auth/login', {
      method: 'POST', body: { usuario: basicStore.body.propietario.usuario, password: basicStore.password }
    }, 200, 'Login basico');

    const now = new Date();
    now.setMilliseconds(0);
    const rangeEnd = now;
    const rangeStart = addDays(rangeEnd, -120);
    const query = `desde=${encodeURIComponent(formatLocalDateTime(rangeStart))}&hasta=${encodeURIComponent(formatLocalDateTime(rangeEnd))}&limite=100`;
    await expect(advancedSession, '/api/inventario-inteligente/configuracion', {
      method: 'PUT', body: {
        periodoAnalisisDias: 120,
        diasHistorialMinimo: 14,
        diasReposicionDefault: 3,
        diasCoberturaDefault: 14,
        diasProductoNuevo: 30
      }
    }, 200, 'Configurar analisis avanzado');

    currentTestStage = 'setup: productos y movimientos de inventario';
    const oldTracking = addDays(now, -130);
    const names = {
      exhausted: `Agotado ${marker}`,
      package: `Paquete bajo ${marker}`,
      minimum: `En minimo ${marker}`,
      enough: `Suficiente ${marker}`,
      inactive: `Inactivo ${marker}`,
      newProduct: `Nuevo ${marker}`,
      insufficient: `Insuficiente ${marker}`,
      never: `=Nunca vendido ${marker}`,
      stale30: `Sin movimiento 30 ${marker}`,
      stale60: `Sin movimiento 60 ${marker}`,
      stale90: `Sin movimiento 90 ${marker}`,
      rotationNull: `Rotacion nula ${marker}`,
      cancelled: `Venta anulada ${marker}`
    };
    const packageSaleDate = addDays(now, -5);
    await createProduct(connection, fixture, {
      name: names.exhausted, stock: 0, minimum: 5, cost: 4, sold: 10,
      trackingDate: oldTracking, saleDate: addDays(now, -10)
    });
    const packageId = await createProduct(connection, fixture, {
      name: names.package, stock: 2, minimum: 5, cost: 2, price: 8, sold: 30,
      trackingDate: oldTracking, saleDate: packageSaleDate, unitsPerPackage: 6,
      suggestedPresentation: 'paquete'
    });
    await addAppliedReturn(
      connection,
      fixture,
      fixture.salesByProduct.get(packageId),
      6,
      48,
      addDays(now, -2)
    );
    await createProduct(connection, fixture, {
      name: names.minimum, stock: 5, minimum: 5, cost: 3, sold: 2,
      trackingDate: oldTracking, saleDate: addDays(now, -4)
    });
    const sufficientId = await createProduct(connection, fixture, {
      name: names.enough, stock: 20, minimum: 5, cost: 5, sold: 1,
      trackingDate: oldTracking, saleDate: addDays(now, -3)
    });
    await createProduct(connection, fixture, {
      name: names.inactive, stock: 1, minimum: 5, cost: 1, sold: 0,
      trackingDate: oldTracking, active: false
    });
    await createProduct(connection, fixture, {
      name: names.newProduct, stock: 3, minimum: 5, cost: 1, sold: 0,
      trackingDate: addDays(now, -5)
    });
    const insufficientId = await createProduct(connection, fixture, {
      name: names.insufficient, stock: 1, minimum: 5, cost: 1, sold: 0,
      trackingDate: addDays(now, -5)
    });
    await createProduct(connection, fixture, {
      name: names.never, stock: 10, minimum: 5, cost: 0, sold: 0,
      trackingDate: oldTracking
    });
    await createProduct(connection, fixture, {
      name: names.stale30, stock: 10, minimum: 5, cost: 2, sold: 1,
      trackingDate: oldTracking, saleDate: addDays(now, -35)
    });
    await createProduct(connection, fixture, {
      name: names.stale60, stock: 10, minimum: 5, cost: 2, sold: 1,
      trackingDate: oldTracking, saleDate: addDays(now, -65)
    });
    await createProduct(connection, fixture, {
      name: names.stale90, stock: 10, minimum: 5, cost: 2, sold: 1,
      trackingDate: oldTracking, saleDate: addDays(now, -95)
    });
    await createProduct(connection, fixture, {
      name: names.rotationNull, stock: 0, minimum: 1, cost: 1, sold: 0,
      trackingDate: oldTracking
    });
    await createProduct(connection, fixture, {
      name: names.cancelled, stock: 8, minimum: 2, cost: 1, sold: 9,
      trackingDate: oldTracking, saleDate: addDays(now, -6), saleState: 'anulada'
    });
    await addNonDemandOperations(connection, fixture, sufficientId, addDays(now, -2));

    const basicProduct = await expect(basicSession, '/api/productos', {
      method: 'POST', body: {
        nombre: `Producto basico ${marker}`, categoria: 'OTROS', unidadMedida: 'unidad',
        unidadesPorPaquete: 1, paquetesPorCaja: 1, precioVenta: 5,
        stockMinimo: 2, stockUnidadesTotal: 1,
        permiteVentaPorPaquete: false, permiteVentaPorUnidad: true
      }
    }, 201, 'Crear producto basico');

    const summary = await expect(advancedSession, `/api/inventario-inteligente/resumen?${query}`, {}, 200, 'Resumen avanzado');
    assert(summary.estados.agotado === 2 && summary.estados.bajo >= 2
      && summary.estados.en_minimo === 1 && summary.estados.suficiente >= 1,
    'El resumen no clasifico correctamente los estados de stock.');
    assert(summary.productosActivos === 12, 'El producto inactivo no fue excluido del resumen normal.');

    const alerts = await expect(advancedSession, `/api/inventario-inteligente/alertas?${query}`, {}, 200, 'Alertas');
    assert(byName(alerts.rows, names.exhausted)?.estadoInventario === 'agotado'
      && byName(alerts.rows, names.package)?.estadoInventario === 'bajo'
      && byName(alerts.rows, names.minimum)?.estadoInventario === 'en_minimo'
      && !byName(alerts.rows, names.inactive),
    'Las alertas no respetaron estados o actividad.');

    const ranking = await expect(advancedSession, `/api/inventario-inteligente/ranking?${query}`, {}, 200, 'Ranking');
    assert(ranking.masVendidosUnidades[0].nombre === names.package,
      'El ranking por unidades no identifico el producto mas vendido.');
    assert(ranking.masVendidosIngresos[0].nombre === names.package,
      'El ranking por ingresos no uso los ingresos comerciales.');
    assert(ranking.menosVendidos.every((row) => row.unidadesVendidas > 0)
      && !ranking.menosVendidos.some((row) => row.nombre === names.never),
    'El ranking de menos vendidos incluyo productos nunca vendidos.');

    const suggestions = await expect(
      advancedSession, `/api/inventario-inteligente/compras-sugeridas?${query}`, {}, 200, 'Compras sugeridas'
    );
    const packageSuggestion = byName(suggestions.rows, names.package);
    const insufficientSuggestion = byName(suggestions.rows, names.insufficient);
    assert(packageSuggestion && packageSuggestion.promedioDiario === 0.2
      && packageSuggestion.cantidadSugeridaUnidades === 6
      && packageSuggestion.cantidadCompraSugerida === 1
      && packageSuggestion.presentacionCompraSugerida === 'paquete',
    'La demanda o el redondeo por paquete es incorrecto.');
    assert(insufficientSuggestion && insufficientSuggestion.confianza === 'insuficiente'
      && insufficientSuggestion.cantidadSugeridaUnidades === 4,
    'La recomendacion con historial insuficiente no uso solo el stock minimo.');
    assert(suggestions.rows.every((row) => row.cantidadSugeridaUnidades >= 0),
      'Se genero una compra sugerida negativa.');
    assert(!suggestions.rows.some((row) => row.nombre === names.inactive),
      'Un producto inactivo genero una recomendacion normal.');

    const boundaryRanking = await expect(
      advancedSession,
      `/api/inventario-inteligente/ranking?desde=${encodeURIComponent(formatLocalDateTime(rangeStart))}&hasta=${encodeURIComponent(formatLocalDateTime(packageSaleDate))}&limite=100`,
      {},
      200,
      'Rango semiabierto'
    );
    assert(!boundaryRanking.masVendidosUnidades.some((row) => row.nombre === names.package),
      'Una venta exactamente igual a fechaFin fue incluida en el rango semiabierto.');

    const rotation = await expect(advancedSession, `/api/inventario-inteligente/rotacion?${query}`, {}, 200, 'Rotacion');
    assert(byName(rotation.rows, names.package)?.diasRestantes !== null,
      'No se calcularon los dias restantes con demanda e historial suficientes.');
    assert(byName(rotation.rows, names.rotationNull)?.rotacion === null
      && byName(rotation.rows, names.rotationNull)?.advertencia,
      'El caso sin rotacion no se explico como NULL.');

    const withoutMovement = await expect(
      advancedSession, `/api/inventario-inteligente/sin-movimiento?${query}`, {}, 200, 'Sin movimiento'
    );
    assert(byName(withoutMovement.rows, names.newProduct)?.clasificacionMovimiento === 'nuevo'
      && byName(withoutMovement.rows, names.never)?.clasificacionMovimiento === 'nunca_vendido'
      && byName(withoutMovement.rows, names.stale30)?.clasificacionMovimiento === 'sin_movimiento_30'
      && byName(withoutMovement.rows, names.stale60)?.clasificacionMovimiento === 'sin_movimiento_60'
      && byName(withoutMovement.rows, names.stale90)?.clasificacionMovimiento === 'sin_movimiento_90',
    'La clasificacion unica de productos sin movimiento es incorrecta.');

    const valuation = await expect(advancedSession, `/api/inventario-inteligente/valoracion?${query}`, {}, 200, 'Valoracion');
    assert(valuation.resumen.productosConCostoConocido > 0
      && valuation.resumen.productosConCostoDesconocido === 1
      && valuation.resumen.unidadesConCostoDesconocido === 10,
    'La valoracion no separo costos conocidos y desconocidos.');

    const soldAfterNonDemand = ranking.masVendidosUnidades.reduce((sum, row) => sum + row.unidadesVendidas, 0);
    assert(soldAfterNonDemand === 40,
      'Compras, ajustes, cobros, devoluciones o ventas anuladas fueron contados como demanda comercial.');
    assert(!ranking.masVendidosUnidades.some((row) => row.nombre === names.cancelled),
      'Una venta anulada fue incluida en la rotacion o el ranking.');
    const windowRotation = await expect(
      advancedSession, '/api/inventario-inteligente/rotacion?ventana=30&limite=100', {}, 200, 'Ventana de 30 dias'
    );
    assert(windowRotation.periodo.ventana === 30,
      'La rotacion no devolvio la ventana aplicada de forma explicita.');
    await expect(advancedSession, '/api/inventario-inteligente/rotacion?ventana=15', {}, 400, 'Ventana invalida');
    const rotationExport = await advancedSession.fetch(
      `/api/inventario-inteligente/exportacion.xlsx?${query}&tipoExportacion=rotacion`
    );
    assert(rotationExport.status === 200
      && /spreadsheetml\.sheet/i.test(rotationExport.headers.get('content-type') || '')
      && /rotacion-inventario-/i.test(rotationExport.headers.get('content-disposition') || ''),
    'La exportacion de rotacion no devolvio un XLSX seguro con nombre local.');
    const exportedWorkbook = new ExcelJS.Workbook();
    await exportedWorkbook.xlsx.load(await rotationExport.arrayBuffer());
    assert(exportedWorkbook.worksheets.length === 1 && exportedWorkbook.worksheets[0].name === 'Rotacion',
      'La exportacion seleccionada incluyo hojas ajenas al informe de rotacion.');
    const rotationSheet = exportedWorkbook.worksheets[0];
    const headers = rotationSheet.getRow(1).values.map((value) => String(value || '').toLowerCase());
    const nameColumn = headers.indexOf('nombre');
    const formulaSafeName = rotationSheet.getRows(2, rotationSheet.rowCount - 1)
      .map((row) => row.getCell(nameColumn).value)
      .find((value) => String(value).includes(`Nunca vendido ${marker}`));
    assert(typeof formulaSafeName === 'string' && formulaSafeName.startsWith("'="),
      'La exportacion XLSX no neutralizo el nombre que inicia con formula.');
    const allSuggestions = await expect(
      advancedSession, `/api/inventario-inteligente/compras-sugeridas?${query}&estadoSugerencia=todos`, {}, 200, 'Estados de sugerencia'
    );
    assert(allSuggestions.resumen && Number.isInteger(allSuggestions.resumen.urgente)
      && allSuggestions.rows.some((row) => row.estadoSugerencia),
    'Las sugerencias no distinguen estados operativos explicables.');
    const priorityAlerts = await expect(
      advancedSession, `/api/inventario-inteligente/alertas?${query}&prioridad=critical`, {}, 200, 'Alertas priorizadas'
    );
    assert(priorityAlerts.rows.every((row) => row.prioridad === 'critical' && row.tipo && row.mensaje),
      'Las alertas no aplicaron prioridad o no explican el motivo.');
    const stockBeforeSuggestion = await scalar(connection,
      'SELECT stockUnidadesTotal total FROM producto WHERE idTienda=? AND idProducto=?',
      [fixture.advancedStore, packageId]);
    await expect(advancedSession, `/api/inventario-inteligente/compras-sugeridas?${query}`, {}, 200, 'Repetir sugerencias');
    const stockAfterSuggestion = await scalar(connection,
      'SELECT stockUnidadesTotal total FROM producto WHERE idTienda=? AND idProducto=?',
      [fixture.advancedStore, packageId]);
    assert(stockBeforeSuggestion === stockAfterSuggestion, 'La recomendacion modifico el stock.');

    const configuration = await expect(
      advancedSession, `/api/inventario-inteligente/configuracion?producto=${packageId}`, {}, 200, 'Leer configuracion'
    );
    assert(configuration.productos.rows[0].presentacionCompraSugeridaEfectiva === 'paquete',
      'El GET de configuracion no combino el override del producto.');
    await expect(advancedSession, '/api/inventario-inteligente/configuracion', {
      method: 'PUT', body: { periodoAnalisisDias: 10, diasHistorialMinimo: 20 }
    }, 400, 'Configuracion invalida');
    await expect(advancedSession, `/api/productos/${insufficientId}/configuracion-inventario`, {
      method: 'PATCH', body: { diasReposicion: 7, diasCoberturaObjetivo: 21, presentacionCompraSugerida: null }
    }, 200, 'Override de producto');

    await expect(basicSession, `/api/inventario-inteligente/resumen?${query}`, {}, 200, 'Resumen basico');
    await expect(basicSession, `/api/inventario-inteligente/alertas?${query}`, {}, 200, 'Alertas basicas');
    await expect(basicSession, `/api/inventario-inteligente/ranking?${query}`, {}, 200, 'Ranking basico');
    await expect(basicSession, `/api/inventario-inteligente/valoracion?${query}`, {}, 200, 'Valoracion basica');
    await expect(basicSession, `/api/inventario-inteligente/compras-sugeridas?${query}`, {}, 403, 'Basico sin sugerencias');
    await expect(basicSession, '/api/inventario-inteligente/exportacion.xlsx', {}, 403, 'Basico sin exportacion avanzada');

    const crossTenant = await advancedSession.request(
      `/api/inventario-inteligente/resumen?producto=${basicProduct.idProducto}`
    );
    assert(crossTenant.status === 404, 'Una tienda pudo consultar un producto de otra tienda.');
    assert(!JSON.stringify(summary).includes(`Producto basico ${marker}`), 'El resumen mezclo productos de otra tienda.');

    const exportResponse = await advancedSession.fetch(`/api/inventario-inteligente/exportacion.xlsx?${query}`);
    assert(exportResponse.status === 200, `La exportacion devolvio HTTP ${exportResponse.status}.`);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(await exportResponse.arrayBuffer()));
    assert(workbook.getWorksheet('Resumen') && workbook.getWorksheet('Compras sugeridas')
      && workbook.getWorksheet('Rotacion') && workbook.getWorksheet('Sin movimiento'),
    'La exportacion no contiene las hojas esperadas para avanzado.');
    const exportedText = workbook.worksheets.flatMap((sheet) => sheet.getSheetValues()).flat(Infinity)
      .filter((value) => typeof value === 'string');
    assert(!exportedText.some((value) => value === names.never)
      && exportedText.some((value) => value === `'${names.never}`),
    'La exportacion no neutralizo una celda que parecia formula.');
    assert(!exportedText.some((value) => value.includes(`Producto basico ${marker}`)),
      'La exportacion incluyo datos de otra tienda.');

    await expect(advancedSession,
      `/api/inventario-inteligente/resumen?desde=${encodeURIComponent(formatLocalDateTime(addDays(now, -366)))}&hasta=${encodeURIComponent(formatLocalDateTime(rangeEnd))}`,
      {}, 400, 'Rango excesivo');

    await connection.query(
      `UPDATE suscripcionTienda SET estado='activa', fechaInicio=?, fechaFin=?
       WHERE idSuscripcion=?`,
      [formatLocalDateTime(addDays(now, -60)), formatLocalDateTime(addDays(now, -1)), fixture.advancedSubscription]
    );
    await expect(advancedSession, `/api/inventario-inteligente/resumen?${query}`, {}, 200, 'Vencida conserva lectura');
    await expect(advancedSession, '/api/inventario-inteligente/configuracion', {
      method: 'PUT', body: { periodoAnalisisDias: 30 }
    }, 403, 'Vencida bloquea configuracion');

    assert(rangeEnd <= new Date(), 'La fecha final de prueba no debe quedar en el futuro.');
    console.log('Prueba de inteligencia de inventario completada correctamente.');
  } finally {
    for (const session of sessions) {
      try { await session.request('/auth/logout', { method: 'POST' }); } catch { /* El servidor puede estar detenido. */ }
    }
    try { await cleanup(connection, fixture); } finally { if (connection) await connection.end(); }
  }
}

main().catch((error) => {
  console.error('La prueba de inteligencia de inventario fallo.');
  console.error(JSON.stringify({
    etapa: currentTestStage,
    codigo: error && error.code ? String(error.code).slice(0, 80) : null,
    mensaje: String(error && error.message ? error.message : 'Error desconocido').slice(0, 500)
  }, null, 2));
  process.exit(1);
});
