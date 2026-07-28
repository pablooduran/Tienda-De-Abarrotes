const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { createDatabaseConnection } = require('../config/database-connection');
const { requireLocalhostDatabase } = require('../config/env');
const { addLocalDays, formatLocalDate, getLocalNow } = require('../utils/local-datetime');
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
    const request = { ...options, headers: { ...(options.headers || {}) } };
    if (request.body && typeof request.body !== 'string') {
      request.headers['content-type'] = 'application/json';
      request.body = JSON.stringify(request.body);
    }
    applyTestRequestSecurity(this.baseUrl, request);
    if (this.cookie) request.headers.cookie = this.cookie;
    const response = await fetch(`${this.baseUrl}${path}`, { ...request, redirect: 'manual' });
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) this.cookie = setCookie.split(';')[0];
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
    .filter(([key]) => !/(password|contrasena|cookie|session|token|secret|hash)/i.test(key))
    .map(([key, item]) => [key, safeBody(item)]));
}

async function expect(session, path, options, status, label) {
  const response = await session.request(path, options);
  if (response.status !== status) {
    throw new Error(`${label}: se esperaba HTTP ${status}, se obtuvo ${response.status}. Respuesta: ${JSON.stringify(safeBody(response.body))}`);
  }
  return response.body;
}

function storePayload(marker, suffix, planCodigo = 'avanzado') {
  const password = `Owner-${suffix}-${crypto.randomBytes(10).toString('hex')}!`;
  return {
    password,
    body: {
      nombre: `Tienda lotes ${suffix} ${marker}`,
      slug: `tienda-lotes-${suffix}-${marker}`,
      estado: 'activa',
      activo: true,
      propietario: {
        usuario: `owner_lotes_${suffix}_${marker}`,
        password,
        confirmacionPassword: password,
        activo: true
      },
      suscripcion: { planCodigo, tipo: 'cortesia', duracionDias: 30 }
    }
  };
}

function productPayload(name, stock = 0, options = {}) {
  return {
    nombre: name,
    codigoBarras: options.barcode || '',
    categoria: 'OTROS',
    unidadMedida: 'unidad',
    unidadesPorPaquete: options.unitsPerPackage || 5,
    paquetesPorCaja: options.packagesPerBox || 1,
    precioVenta: options.price || 10,
    precioVentaPaquete: options.packagePrice || 45,
    stockMinimo: 2,
    stockUnidadesTotal: stock,
    permiteVentaPorPaquete: options.allowPackage !== false,
    permiteVentaPorUnidad: true
  };
}

function dateOffset(days) {
  return formatLocalDate(addLocalDays(getLocalNow(), days));
}

async function scalar(connection, sql, params = []) {
  const [[row]] = await connection.query(sql, params);
  return Number(row.total || 0);
}

async function cleanupStore(connection, idTienda) {
  await connection.query('DELETE FROM eventoAuditoriaAdministrativa WHERE idTienda=?', [idTienda]);
  await connection.query('DELETE FROM ajusteInventario WHERE idTienda=?', [idTienda]);
  await connection.query('DELETE FROM movimientoLote WHERE idTienda=?', [idTienda]);
  await connection.query('DELETE FROM loteProducto WHERE idTienda=?', [idTienda]);
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
  await connection.query('DELETE FROM suscripcionTienda WHERE idTienda=?', [idTienda]);
  await connection.query('DELETE FROM administrador WHERE idTienda=?', [idTienda]);
  await connection.query('DELETE FROM tienda WHERE idTienda=?', [idTienda]);
}

async function cleanup(connection, fixture) {
  if (!connection) return;
  const [stores] = await connection.query('SELECT idTienda FROM tienda WHERE slug LIKE ?', [`tienda-lotes-%-${fixture.marker}`]);
  for (const store of stores) await cleanupStore(connection, store.idTienda);
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

async function createProduct(session, marker, label, stock = 0, options = {}) {
  return expect(session, '/api/productos', {
    method: 'POST', body: productPayload(`${label} ${marker}`, stock, options)
  }, 201, `Crear ${label}`);
}

async function distribute(session, idProducto, key, lots, controlsExpiration = false, expectedStatus = 201) {
  return expect(session, '/api/lotes/distribucion-inicial', {
    method: 'POST', body: {
      idProducto,
      controlaVencimiento: controlsExpiration,
      diasAlertaVencimiento: 15,
      lotes: lots,
      claveOperacion: key
    }
  }, expectedStatus, 'Distribucion inicial');
}

async function sell(session, key, idProducto, cantidad, options = {}, expectedStatus = 201) {
  return expect(session, '/api/pos/ventas', {
    method: 'POST', body: {
      claveOperacion: key,
      idCliente: options.idCliente,
      items: [{ idProducto, cantidad, presentacion: options.presentacion || 'unidad' }],
      pagos: options.fiado ? [] : [{ metodoPago: 'efectivo', monto: options.monto || cantidad * 10 }],
      ...(options.fiado ? { saldoFiado: options.saldoFiado || cantidad * 10 } : {})
    }
  }, expectedStatus, `Venta ${key}`);
}

async function main() {
  const config = { ...requireLocalhostDatabase('La prueba de lotes y vencimientos'), decimalNumbers: true };
  if (!/(prueba|test)/i.test(config.database)) {
    throw new Error('La prueba solo puede ejecutarse sobre una base cuyo nombre contenga prueba o test.');
  }
  const baseUrl = process.env.TEST_BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
  const marker = crypto.randomBytes(6).toString('hex');
  const fixture = { marker, superUser: `super_lotes_${marker}` };
  const superPassword = `Super-${crypto.randomBytes(12).toString('hex')}!`;
  let connection;

  try {
    connection = await createDatabaseConnection(config);
    fixture.auditStartId = await scalar(
      connection,
      'SELECT COALESCE(MAX(idEventoAuditoria),0) total FROM eventoAuditoriaAdministrativa'
    );
    assert(await scalar(connection,
      "SELECT COUNT(*) total FROM schema_migrations WHERE nombre='011_lotes_vencimientos.sql'") === 1,
    'La migracion 011 debe estar aplicada.');
    await connection.query(
      "INSERT INTO administrador (idTienda, usuario, password, rol, activo) VALUES (NULL, ?, ?, 'superadmin', 1)",
      [fixture.superUser, await bcrypt.hash(superPassword, 12)]
    );

    const superSession = new HttpSession(baseUrl);
    const ownerA = new HttpSession(baseUrl);
    const ownerAConcurrent = new HttpSession(baseUrl);
    const ownerB = new HttpSession(baseUrl);
    const basicOwner = new HttpSession(baseUrl);
    await expect(superSession, '/auth/login', { method: 'POST', body: { usuario: fixture.superUser, password: superPassword } }, 200, 'Login superadmin');
    const storeA = storePayload(marker, 'a');
    const storeB = storePayload(marker, 'b');
    const storeBasic = storePayload(marker, 'basic', 'basico');
    const createdA = await expect(superSession, '/api/admin/tiendas', { method: 'POST', body: storeA.body }, 201, 'Crear tienda A');
    const createdB = await expect(superSession, '/api/admin/tiendas', { method: 'POST', body: storeB.body }, 201, 'Crear tienda B');
    const createdBasic = await expect(superSession, '/api/admin/tiendas', { method: 'POST', body: storeBasic.body }, 201, 'Crear tienda basica');
    fixture.storeA = createdA.tienda.idTienda;
    fixture.storeB = createdB.tienda.idTienda;
    fixture.storeBasic = createdBasic.tienda.idTienda;
    await expect(ownerA, '/auth/login', { method: 'POST', body: { usuario: storeA.body.propietario.usuario, password: storeA.password } }, 200, 'Login A');
    await expect(ownerAConcurrent, '/auth/login', { method: 'POST', body: { usuario: storeA.body.propietario.usuario, password: storeA.password } }, 200, 'Login concurrente A');
    await expect(ownerB, '/auth/login', { method: 'POST', body: { usuario: storeB.body.propietario.usuario, password: storeB.password } }, 200, 'Login B');
    await expect(basicOwner, '/auth/login', { method: 'POST', body: { usuario: storeBasic.body.propietario.usuario, password: storeBasic.password } }, 200, 'Login basico');

    const normal = await createProduct(ownerA, marker, 'Producto normal', 10);
    await expect(ownerA, '/api/compras', { method: 'POST', body: {
      claveOperacion: `normal-buy-${marker}`,
      items: [{ idProducto: normal.idProducto, cantidad: 1, presentacion: 'unidad', precioCompra: 3 }]
    } }, 201, 'Compra sin lotes');
    assert(await scalar(connection, 'SELECT COUNT(*) total FROM loteProducto WHERE idTienda=? AND idProducto=?',
      [fixture.storeA, normal.idProducto]) === 0, 'La compra sin lotes creo loteProducto innecesariamente.');
    assert(await scalar(connection, `SELECT COUNT(*) total
      FROM movimientoLote ml
      INNER JOIN loteProducto lp
        ON lp.idTienda=ml.idTienda AND lp.idLoteProducto=ml.idLoteProducto
      WHERE ml.idTienda=? AND lp.idProducto=?`,
    [fixture.storeA, normal.idProducto]) === 0, 'La compra sin lotes creo movimientoLote innecesariamente.');
    await sell(ownerA, `normal-sale-${marker}`, normal.idProducto, 1);

    const zero = await createProduct(ownerA, marker, 'Control cero', 0);
    await expect(ownerA, `/api/productos/${zero.idProducto}/configuracion-lotes`, {
      method: 'PATCH', body: { controlaLotes: true, controlaVencimiento: true, diasAlertaVencimiento: 7 }
    }, 200, 'Activar producto sin stock');
    const basicProduct = await createProduct(basicOwner, marker, 'Basico bloqueado', 0);
    await expect(basicOwner, `/api/productos/${basicProduct.idProducto}/configuracion-lotes`, {
      method: 'PATCH', body: { controlaLotes: true }
    }, 403, 'Plan basico no activa lotes');

    const fefo = await createProduct(ownerA, marker, 'Producto FEFO', 6);
    await expect(ownerA, `/api/productos/${fefo.idProducto}/configuracion-lotes`, {
      method: 'PATCH', body: { controlaLotes: true }
    }, 409, 'Stock existente exige distribucion');
    await distribute(ownerA, fefo.idProducto, `bad-dist-${marker}`, [
      { codigoLote: 'BAD', cantidad: 5, fechaVencimiento: dateOffset(20), costoUnitarioBase: 2 }
    ], true, 400);
    const distributionKey = `dist-${marker}`;
    const distribution = await distribute(ownerA, fefo.idProducto, distributionKey, [
      { codigoLote: 'REPETIBLE', cantidad: 2, fechaVencimiento: dateOffset(5), costoUnitarioBase: 2 },
      { codigoLote: 'REPETIBLE', cantidad: 4, fechaVencimiento: dateOffset(20), costoUnitarioBase: 4 }
    ], true);
    assert(distribution.lotes.length === 2, 'La distribucion no creo dos lotes.');
    const repeatedDistribution = await distribute(ownerA, fefo.idProducto, distributionKey, [
      { codigoLote: 'REPETIBLE', cantidad: 2, fechaVencimiento: dateOffset(5), costoUnitarioBase: 2 },
      { codigoLote: 'REPETIBLE', cantidad: 4, fechaVencimiento: dateOffset(20), costoUnitarioBase: 4 }
    ], true, 200);
    assert(repeatedDistribution.repetida === true, 'La distribucion inicial no fue idempotente.');

    const fefoSale = await sell(ownerA, `fefo-sale-${marker}`, fefo.idProducto, 3, { monto: 30 });
    const lotMovementsAfterFefo = await scalar(connection,
      'SELECT COUNT(*) total FROM movimientoLote WHERE idTienda=? AND idProducto=?',
      [fixture.storeA, fefo.idProducto]);
    const repeatedFefoSale = await sell(ownerA, `fefo-sale-${marker}`, fefo.idProducto, 3, { monto: 30 }, 200);
    assert(repeatedFefoSale.repetida === true && repeatedFefoSale.idVenta === fefoSale.idVenta,
      'El reintento de venta controlada no devolvio la venta existente.');
    assert(await scalar(connection,
      'SELECT COUNT(*) total FROM movimientoLote WHERE idTienda=? AND idProducto=?',
    [fixture.storeA, fefo.idProducto]) === lotMovementsAfterFefo,
    'El reintento de venta duplico movimientos de lote.');
    const [fefoLots] = await connection.query(
      'SELECT codigoLote, cantidadRestante FROM loteProducto WHERE idTienda=? AND idProducto=? ORDER BY fechaVencimiento',
      [fixture.storeA, fefo.idProducto]
    );
    assert(Number(fefoLots[0].cantidadRestante) === 0 && Number(fefoLots[1].cantidadRestante) === 3,
      'FEFO no consumio primero el lote con vencimiento mas cercano.');
    const [[fefoCost]] = await connection.query(
      'SELECT costoUnitario, subtotalCosto, origenCosto FROM detalleVenta WHERE idTienda=? AND idVenta=?',
      [fixture.storeA, fefoSale.idVenta]
    );
    assert(fefoCost.origenCosto === 'real' && Math.abs(Number(fefoCost.costoUnitario) - 2.666667) < 0.000001,
      'El costo ponderado de varios lotes es incorrecto.');

    const fifo = await createProduct(ownerA, marker, 'Producto FIFO', 2);
    await distribute(ownerA, fifo.idProducto, `fifo-dist-${marker}`, [
      { codigoLote: 'FIFO-1', cantidad: 1, costoUnitarioBase: 1 },
      { codigoLote: 'FIFO-2', cantidad: 1, costoUnitarioBase: 2 }
    ]);
    await sell(ownerA, `fifo-sale-${marker}`, fifo.idProducto, 1);
    const [[fifoFirst]] = await connection.query(
      'SELECT cantidadRestante FROM loteProducto WHERE idTienda=? AND idProducto=? ORDER BY idLoteProducto LIMIT 1',
      [fixture.storeA, fifo.idProducto]
    );
    assert(Number(fifoFirst.cantidadRestante) === 0, 'FIFO no consumio el primer ingreso.');

    const todayProduct = await createProduct(ownerA, marker, 'Vence hoy', 1);
    await distribute(ownerA, todayProduct.idProducto, `today-dist-${marker}`, [
      { codigoLote: 'TODAY', cantidad: 1, fechaVencimiento: formatLocalDate(), costoUnitarioBase: 1 }
    ], true);
    await sell(ownerA, `today-sale-${marker}`, todayProduct.idProducto, 1);

    const unavailable = await createProduct(ownerA, marker, 'No vendible', 2);
    await distribute(ownerA, unavailable.idProducto, `unavailable-dist-${marker}`, [
      { codigoLote: 'EXPIRED', cantidad: 1, fechaVencimiento: dateOffset(2), costoUnitarioBase: 1 },
      { codigoLote: 'BLOCKED', cantidad: 1, fechaVencimiento: dateOffset(10), costoUnitarioBase: 1 }
    ], true);
    const [unavailableLots] = await connection.query(
      'SELECT idLoteProducto FROM loteProducto WHERE idTienda=? AND idProducto=? ORDER BY idLoteProducto',
      [fixture.storeA, unavailable.idProducto]
    );
    await connection.query(
      'UPDATE loteProducto SET fechaIngreso=?, fechaVencimiento=? WHERE idTienda=? AND idLoteProducto=?',
      [dateOffset(-3) + ' 08:00:00', dateOffset(-1), fixture.storeA, unavailableLots[0].idLoteProducto]
    );
    await connection.query(
      "UPDATE loteProducto SET estadoOperativo='bloqueado', clasificacionInventario='bloqueado' WHERE idTienda=? AND idLoteProducto=?",
      [fixture.storeA, unavailableLots[1].idLoteProducto]
    );
    const unavailableSale = await ownerA.request('/api/pos/ventas', { method: 'POST', body: {
      claveOperacion: `unavailable-sale-${marker}`,
      items: [{ idProducto: unavailable.idProducto, cantidad: 1, presentacion: 'unidad' }],
      pagos: [{ metodoPago: 'efectivo', monto: 10 }]
    } });
    assert(unavailableSale.status === 409 && unavailableSale.body.code === 'INSUFFICIENT_SELLABLE_LOT_STOCK',
      'No se distinguio stock fisico de stock vendible.');

    await expect(ownerA, '/api/proveedores', {
      method: 'POST', body: { nombre: `Proveedor lotes ${marker}`, telefono: '70000001' }
    }, 201, 'Crear proveedor');
    const [providers] = await connection.query('SELECT idProveedor FROM proveedor WHERE idTienda=?', [fixture.storeA]);
    const supplierId = providers[0].idProveedor;
    const purchaseProduct = zero;
    const purchaseKey = `lot-buy-${marker}`;
    const purchaseBody = {
      claveOperacion: purchaseKey,
      idProveedor: supplierId,
      items: [{
        idProducto: purchaseProduct.idProducto,
        cantidad: 1,
        presentacion: 'paquete',
        precioCompra: 20,
        lotes: [
          { codigoLote: 'BUY-SAME', fechaVencimiento: dateOffset(30), cantidadUnidadesBase: 2 },
          { codigoLote: 'BUY-SAME', fechaVencimiento: dateOffset(40), cantidadUnidadesBase: 3 }
        ]
      }]
    };
    const missingExpirationPurchase = JSON.parse(JSON.stringify(purchaseBody));
    missingExpirationPurchase.claveOperacion = `missing-expiration-${marker}`;
    delete missingExpirationPurchase.items[0].lotes[0].fechaVencimiento;
    await expect(ownerA, '/api/compras', { method: 'POST', body: missingExpirationPurchase }, 400,
      'Compra sin vencimiento obligatorio');
    const purchase = await expect(ownerA, '/api/compras', { method: 'POST', body: purchaseBody }, 201, 'Compra con varios lotes');
    assert(await scalar(connection, 'SELECT COUNT(*) total FROM loteProducto WHERE idTienda=? AND idDetalleCompra IS NOT NULL',
      [fixture.storeA]) === 2, 'La compra por paquete no creo sus lotes fisicos.');
    const movementCount = await scalar(connection,
      'SELECT COUNT(*) total FROM movimientoStock WHERE idTienda=? AND idProducto=? AND origen=\'compra\'',
      [fixture.storeA, purchaseProduct.idProducto]);
    await expect(ownerA, '/api/compras', { method: 'POST', body: purchaseBody }, 201, 'Reintento de compra');
    assert(await scalar(connection,
      'SELECT COUNT(*) total FROM movimientoStock WHERE idTienda=? AND idProducto=? AND origen=\'compra\'',
    [fixture.storeA, purchaseProduct.idProducto]) === movementCount, 'El reintento duplico la entrada de stock.');
    assert(purchase.idCompra, 'La compra controlada no devolvio su identificador.');
    await expect(ownerA, '/api/compras', { method: 'POST', body: {
      claveOperacion: `single-lot-buy-${marker}`,
      idProveedor: supplierId,
      items: [{
        idProducto: purchaseProduct.idProducto, cantidad: 1, presentacion: 'unidad', precioCompra: 4,
        lotes: [{ codigoLote: 'BUY-SAME', fechaVencimiento: dateOffset(50), cantidadUnidadesBase: 1 }]
      }]
    } }, 201, 'Compra de lote unico con codigo repetido');

    const adjustmentProduct = await createProduct(ownerA, marker, 'Ajuste por lotes', 0);
    await expect(ownerA, `/api/productos/${adjustmentProduct.idProducto}/configuracion-lotes`, {
      method: 'PATCH', body: { controlaLotes: true }
    }, 200, 'Activar producto para ajuste');
    await expect(ownerA, `/api/productos/${adjustmentProduct.idProducto}/ajustar-stock`, {
      method: 'POST', body: {
        tipoAjuste: 'positivo', cantidad: 2, motivoCodigo: 'conteo_fisico',
        confirmado: true, modoLotes: 'no_aplica', clasificacionInventario: 'vendible',
        claveOperacion: `adjust-positive-${marker}`
      }
    }, 409, 'Ajuste general inseguro rechazado');
    await expect(ownerA, `/api/productos/${adjustmentProduct.idProducto}/ajustar-stock`, {
      method: 'POST', body: {
        tipoAjuste: 'positivo', cantidad: 2, motivoCodigo: 'conteo_fisico',
        confirmado: true, modoLotes: 'lote_nuevo', clasificacionInventario: 'vendible',
        claveOperacion: `adjust-positive-${marker}`,
        lote: { codigoLote: 'ADJ', costoUnitarioBase: 1.5 }
      }
    }, 201, 'Ajuste positivo por lotes');
    await expect(ownerA, `/api/productos/${adjustmentProduct.idProducto}/ajustar-stock`, {
      method: 'POST', body: {
        tipoAjuste: 'negativo', cantidad: 1, motivoCodigo: 'conteo_fisico',
        confirmado: true, modoLotes: 'fefo_fifo', clasificacionInventario: 'vendible',
        claveOperacion: `adjust-negative-${marker}`
      }
    }, 201, 'Ajuste negativo por lotes');

    const unknown = await createProduct(ownerA, marker, 'Costo desconocido', 1);
    await distribute(ownerA, unknown.idProducto, `unknown-dist-${marker}`, [
      { codigoLote: 'UNKNOWN', cantidad: 1 }
    ]);
    const unknownSale = await sell(ownerA, `unknown-sale-${marker}`, unknown.idProducto, 1);
    const [[unknownCost]] = await connection.query(
      'SELECT origenCosto, costoUnitario FROM detalleVenta WHERE idTienda=? AND idVenta=?',
      [fixture.storeA, unknownSale.idVenta]
    );
    assert(unknownCost.origenCosto === 'desconocido' && Number(unknownCost.costoUnitario) === 0,
      'El costo desconocido fue tratado como costo real.');

    const foreignProduct = await createProduct(ownerB, marker, 'Producto ajeno', 0);
    await expect(ownerA, `/api/productos/${foreignProduct.idProducto}/configuracion-lotes`, {
      method: 'PATCH', body: { controlaLotes: true }
    }, 404, 'Configuracion aislada por tienda');
    await expect(ownerA, `/api/productos/${foreignProduct.idProducto}/lotes-disponibles`, {}, 404,
      'Consulta de lotes aislada por tienda');

    const available = await expect(ownerA, `/api/productos/${fefo.idProducto}/lotes-disponibles`, {}, 200, 'Lotes disponibles');
    assert(available.stockGeneral === available.stockTrazado, 'La consulta detecto una reconciliacion incorrecta.');
    const list = await expect(ownerA, `/api/lotes?producto=${fefo.idProducto}`, {}, 200, 'Listado de lotes');
    assert(list.rows.length === 2, 'El listado no devolvio los lotes del producto.');
    const detail = await expect(ownerA, `/api/lotes/${distribution.lotes[0].idLoteProducto}`, {}, 200, 'Trazabilidad de lote');
    assert(detail.movimientos.some((movement) => Number(movement.idVenta) === Number(fefoSale.idVenta)),
      'No existe trazabilidad compra/lote/venta.');
    await expect(ownerA, '/api/lotes/alertas', {}, 200, 'Alertas de vencimiento');

    await expect(ownerA, '/api/clientes', {
      method: 'POST', body: { nombre: `Cliente lotes ${marker}`, telefono: '70000002' }
    }, 201, 'Crear cliente para fiado');
    const [[creditClient]] = await connection.query(
      'SELECT idCliente FROM cliente WHERE idTienda=? AND nombre=?',
      [fixture.storeA, `Cliente lotes ${marker}`]
    );
    const creditProduct = await createProduct(ownerA, marker, 'Fiado trazado', 2);
    await distribute(ownerA, creditProduct.idProducto, `credit-dist-${marker}`, [
      { codigoLote: 'CREDIT', cantidad: 2, costoUnitarioBase: 1 }
    ]);
    const creditSale = await sell(ownerA, `credit-sale-${marker}`, creditProduct.idProducto, 1, {
      fiado: true, saldoFiado: 10, idCliente: creditClient.idCliente
    });
    const movementsBeforePayment = await scalar(connection,
      'SELECT COUNT(*) total FROM movimientoStock WHERE idTienda=? AND idProducto=?',
      [fixture.storeA, creditProduct.idProducto]);
    await expect(ownerA, '/api/pagos-fiado', {
      method: 'POST', body: {
        idFiado: creditSale.idFiado, monto: 1, metodoPago: 'efectivo',
        claveOperacion: `cobro-lotes-${marker}`, observacion: 'Pago sin stock'
      }
    }, 201, 'Pago posterior de fiado');
    assert(await scalar(connection,
      'SELECT COUNT(*) total FROM movimientoStock WHERE idTienda=? AND idProducto=?',
    [fixture.storeA, creditProduct.idProducto]) === movementsBeforePayment,
    'El pago de fiado duplico la salida de inventario.');

    const concurrent = await createProduct(ownerA, marker, 'Concurrencia lotes', 1);
    await distribute(ownerA, concurrent.idProducto, `concurrent-dist-${marker}`, [
      { codigoLote: 'CONCURRENT', cantidad: 1, costoUnitarioBase: 1 }
    ]);
    const concurrentResponses = await Promise.all([
      ownerA.request('/api/pos/ventas', { method: 'POST', body: {
        claveOperacion: `concurrent-a-${marker}`, items: [{ idProducto: concurrent.idProducto, cantidad: 1 }],
        pagos: [{ metodoPago: 'efectivo', monto: 10 }]
      } }),
      ownerAConcurrent.request('/api/pos/ventas', { method: 'POST', body: {
        claveOperacion: `concurrent-b-${marker}`, items: [{ idProducto: concurrent.idProducto, cantidad: 1 }],
        pagos: [{ metodoPago: 'efectivo', monto: 10 }]
      } })
    ]);
    assert(concurrentResponses.filter((response) => response.status === 201).length === 1
      && concurrentResponses.filter((response) => [400, 409].includes(response.status)).length === 1,
    'Las ventas concurrentes no protegieron el saldo del lote.');

    await expect(superSession, `/api/admin/tiendas/${fixture.storeA}/suscripciones`, {
      method: 'POST', body: { planCodigo: 'basico', tipo: 'pagada', duracionDias: 30, observacion: 'Downgrade lotes' }
    }, 201, 'Downgrade a basico');
    const newAfterDowngrade = await createProduct(ownerA, marker, 'No activa tras downgrade', 0);
    await expect(ownerA, `/api/productos/${newAfterDowngrade.idProducto}/configuracion-lotes`, {
      method: 'PATCH', body: { controlaLotes: true }
    }, 403, 'Downgrade bloquea nuevas activaciones');
    await sell(ownerA, `downgrade-sale-${marker}`, adjustmentProduct.idProducto, 1);
    assert(await scalar(connection,
      `SELECT COUNT(*) total FROM movimientoStock ms
       LEFT JOIN movimientoLote ml ON ml.idTienda=ms.idTienda AND ml.idProducto=ms.idProducto
         AND ml.idMovimientoStock=ms.idMovimientoStock
       WHERE ms.idTienda=? AND ms.idProducto=? AND ms.origen='venta' AND ml.idMovimientoLote IS NULL`,
    [fixture.storeA, adjustmentProduct.idProducto]) === 0,
    'El downgrade permitio omitir la trazabilidad operativa.');

    assert(await scalar(connection,
      `SELECT COUNT(*) total FROM (
         SELECT p.idProducto
         FROM producto p
         LEFT JOIN loteProducto l ON l.idTienda=p.idTienda AND l.idProducto=p.idProducto
           AND l.estadoOperativo<>'anulado'
         WHERE p.idTienda=? AND p.controlaLotes=1
         GROUP BY p.idProducto, p.stockUnidadesTotal
         HAVING COALESCE(SUM(l.cantidadRestante),0)<>p.stockUnidadesTotal
       ) diferencias`,
    [fixture.storeA]) === 0, 'El stock general no reconcilia con los lotes.');
    assert(await scalar(connection,
      `SELECT COUNT(*) total FROM (
         SELECT ms.idMovimientoStock, ms.cantidad
         FROM movimientoStock ms
         JOIN producto p ON p.idTienda=ms.idTienda AND p.idProducto=ms.idProducto
         LEFT JOIN movimientoLote ml ON ml.idTienda=ms.idTienda AND ml.idProducto=ms.idProducto
           AND ml.idMovimientoStock=ms.idMovimientoStock
         WHERE ms.idTienda=? AND p.controlaLotes=1 AND ms.creadoEn>p.lotesActivadosEn
         GROUP BY ms.idMovimientoStock, ms.cantidad
         HAVING COALESCE(SUM(ml.cantidad),0)<>ms.cantidad
       ) diferencias`, [fixture.storeA]) === 0,
    'La suma de movimientoLote no coincide con movimientoStock.');
    assert(await scalar(connection,
      'SELECT COUNT(*) total FROM producto WHERE idTienda=? AND stockUnidadesTotal<0', [fixture.storeA]) === 0,
    'La prueba dejo stock general negativo.');

    console.log('Prueba de lotes y vencimientos completada correctamente.');
  } finally {
    try { await cleanup(connection, fixture); } finally { if (connection) await connection.end(); }
  }
}

main().catch((error) => {
  console.error('La prueba de lotes y vencimientos fallo.');
  console.error(error.message);
  process.exit(1);
});
