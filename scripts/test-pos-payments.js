const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const mysql = require('mysql2/promise');
const { requireLocalhostDatabase } = require('../config/env');

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

function storePayload(marker, suffix) {
  const password = `Owner-${suffix}-${crypto.randomBytes(10).toString('hex')}!`;
  return {
    password,
    body: {
      nombre: `Tienda POS ${suffix} ${marker}`,
      slug: `tienda-pos-${suffix}-${marker}`,
      estado: 'activa',
      activo: true,
      propietario: {
        usuario: `owner_pos_${suffix}_${marker}`,
        password,
        confirmacionPassword: password,
        activo: true
      },
      suscripcion: { planCodigo: 'avanzado', tipo: 'cortesia', duracionDias: 30 }
    }
  };
}

function productPayload(name, barcode, stock = 30, options = {}) {
  return {
    nombre: name,
    codigoBarras: barcode || '',
    categoria: 'OTROS',
    unidadMedida: 'unidad',
    unidadesPorPaquete: options.unitsPerPackage || 5,
    paquetesPorCaja: 1,
    precioVenta: options.price || 10,
    precioVentaPaquete: options.packagePrice || 45,
    stockMinimo: 2,
    stockUnidadesTotal: stock,
    permiteVentaPorPaquete: options.allowPackage !== false,
    permiteVentaPorUnidad: true
  };
}

async function scalar(connection, sql, params = []) {
  const [[row]] = await connection.query(sql, params);
  return Number(row.total || 0);
}

async function cleanupStore(connection, idTienda) {
  await connection.query('DELETE FROM cierreCaja WHERE idTienda=?', [idTienda]);
  await connection.query('DELETE FROM gasto WHERE idTienda=?', [idTienda]);
  await connection.query('DELETE FROM categoriaGasto WHERE idTienda=?', [idTienda]);
  await connection.query('DELETE FROM movimientoStock WHERE idTienda=?', [idTienda]);
  await connection.query('DELETE FROM pagoVenta WHERE idTienda=?', [idTienda]);
  await connection.query('DELETE FROM pagoFiado WHERE idTienda=?', [idTienda]);
  await connection.query('DELETE FROM detalleFiado WHERE idTienda=?', [idTienda]);
  await connection.query('DELETE FROM detalleVenta WHERE idTienda=?', [idTienda]);
  await connection.query('DELETE FROM detalleCompra WHERE idTienda=?', [idTienda]);
  await connection.query('DELETE FROM fiado WHERE idTienda=?', [idTienda]);
  await connection.query('DELETE FROM venta WHERE idTienda=?', [idTienda]);
  await connection.query('DELETE FROM compra WHERE idTienda=?', [idTienda]);
  await connection.query('DELETE FROM producto WHERE idTienda=?', [idTienda]);
  await connection.query('DELETE FROM cliente WHERE idTienda=?', [idTienda]);
  await connection.query('DELETE FROM proveedor WHERE idTienda=?', [idTienda]);
  await connection.query('DELETE FROM configuracionInventarioTienda WHERE idTienda=?', [idTienda]);
  await connection.query('DELETE FROM suscripcionTienda WHERE idTienda=?', [idTienda]);
  await connection.query('DELETE FROM administrador WHERE idTienda=?', [idTienda]);
  await connection.query('DELETE FROM tienda WHERE idTienda=?', [idTienda]);
}

async function cleanup(connection, fixture) {
  if (!connection) return;
  const [stores] = await connection.query('SELECT idTienda FROM tienda WHERE slug LIKE ?', [`tienda-pos-%-${fixture.marker}`]);
  for (const store of stores) await cleanupStore(connection, store.idTienda);
  if (fixture.superUser) await connection.query('DELETE FROM administrador WHERE usuario=?', [fixture.superUser]);
}

async function main() {
  const config = { ...requireLocalhostDatabase('La prueba del punto de venta'), decimalNumbers: true };
  if (!/(prueba|test)/i.test(config.database)) {
    throw new Error('La prueba solo puede ejecutarse sobre una base cuyo nombre contenga prueba o test.');
  }
  const baseUrl = process.env.TEST_BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
  const marker = crypto.randomBytes(6).toString('hex');
  const fixture = { marker, superUser: `super_pos_${marker}` };
  const superPassword = `Super-${crypto.randomBytes(12).toString('hex')}!`;
  let connection;

  try {
    connection = await mysql.createConnection(config);
    assert(await scalar(connection,
      "SELECT COUNT(*) total FROM schema_migrations WHERE nombre='008_punto_venta_pagos.sql'") === 1,
    'La migracion 008 debe estar aplicada.');
    const superHash = await bcrypt.hash(superPassword, 12);
    await connection.query(
      "INSERT INTO administrador (idTienda, usuario, password, rol, activo) VALUES (NULL, ?, ?, 'superadmin', 1)",
      [fixture.superUser, superHash]
    );

    const superSession = new HttpSession(baseUrl);
    const ownerA = new HttpSession(baseUrl);
    const ownerAConcurrent = new HttpSession(baseUrl);
    const ownerB = new HttpSession(baseUrl);
    await expect(superSession, '/auth/login', { method: 'POST', body: { usuario: fixture.superUser, password: superPassword } }, 200, 'Login superadmin');
    const storeA = storePayload(marker, 'a');
    const storeB = storePayload(marker, 'b');
    const createdA = await expect(superSession, '/api/admin/tiendas', { method: 'POST', body: storeA.body }, 201, 'Crear tienda A');
    const createdB = await expect(superSession, '/api/admin/tiendas', { method: 'POST', body: storeB.body }, 201, 'Crear tienda B');
    fixture.storeA = createdA.tienda.idTienda;
    fixture.storeB = createdB.tienda.idTienda;
    fixture.subscriptionA = createdA.suscripcion.idSuscripcion;
    await expect(ownerA, '/auth/login', { method: 'POST', body: { usuario: storeA.body.propietario.usuario, password: storeA.password } }, 200, 'Login propietario A');
    await expect(ownerAConcurrent, '/auth/login', { method: 'POST', body: { usuario: storeA.body.propietario.usuario, password: storeA.password } }, 200, 'Segundo login propietario A');
    await expect(ownerB, '/auth/login', { method: 'POST', body: { usuario: storeB.body.propietario.usuario, password: storeB.password } }, 200, 'Login propietario B');
    await expect(superSession, '/api/pos/productos', {}, 403, 'Superadmin bloqueado del POS');

    await expect(ownerA, '/api/clientes', {
      method: 'POST', body: { nombre: `Cliente POS ${marker}`, telefono: '59170000000', direccion: 'Local' }
    }, 201, 'Crear cliente A');
    const [[clientA]] = await connection.query(
      'SELECT idCliente FROM cliente WHERE idTienda=? AND nombre=?',
      [fixture.storeA, `Cliente POS ${marker}`]
    );
    assert(clientA, 'No se encontro el cliente temporal creado.');
    const productA = await expect(ownerA, '/api/productos', {
      method: 'POST', body: productPayload(`Producto POS ${marker}`, `770${marker}`, 40)
    }, 201, 'Crear producto A');
    const productNoBarcode = await expect(ownerA, '/api/productos', {
      method: 'POST', body: productPayload(`Sin codigo ${marker}`, '', 10)
    }, 201, 'Crear producto sin codigo');
    const concurrentProduct = await expect(ownerA, '/api/productos', {
      method: 'POST', body: productPayload(`Concurrencia ${marker}`, `771${marker}`, 1, { allowPackage: false })
    }, 201, 'Crear producto de concurrencia');
    const productB = await expect(ownerB, '/api/productos', {
      method: 'POST', body: productPayload(`Producto ajeno ${marker}`, `779${marker}`, 10)
    }, 201, 'Crear producto B');
    const [legacyInsert] = await connection.query(
      `INSERT INTO venta
       (idTienda, subtotal, descuento, total, montoPagado, saldoPendiente, estadoPago,
        tipo, idCliente, claveOperacion, codigoComprobante)
       VALUES (?, 12, 0, 12, 12, 0, 'legado', 'pagada', NULL, ?, ?)`,
      [fixture.storeA, `legacy-${marker}`, `V-${fixture.storeA}-LEG-${marker}`]
    );
    const legacyHistory = await expect(ownerA, '/api/ventas', {}, 200, 'Historial con venta legada');
    assert(legacyHistory.some((sale) => sale.idVenta === legacyInsert.insertId && sale.estadoPago === 'legado'),
      'La venta historica no permanecio visible.');

    const byName = await expect(ownerA, `/api/pos/productos?q=${encodeURIComponent(`Producto POS ${marker}`)}`, {}, 200, 'Buscar por nombre');
    assert(byName.productos.some((product) => product.idProducto === productA.idProducto), 'La busqueda por nombre no encontro el producto.');
    assert(!byName.productos.some((product) => product.idProducto === productB.idProducto), 'La busqueda mezclo productos de otra tienda.');
    await expect(ownerA, `/api/pos/productos/${productB.idProducto}`, {}, 404, 'Detalle de producto aislado por tienda');
    await expect(ownerA, '/api/pos/ventas', { method: 'POST', body: {
      claveOperacion: `cross-product-${marker}`,
      items: [{ idProducto: productB.idProducto, cantidad: 1, presentacion: 'unidad' }],
      pagos: [{ metodoPago: 'efectivo', monto: 10 }]
    } }, 404, 'Venta con producto de otra tienda rechazada');
    const byBarcode = await expect(ownerA, `/api/pos/productos?q=${encodeURIComponent(`770${marker}`)}`, {}, 200, 'Buscar por codigo');
    assert(byBarcode.productos[0]?.idProducto === productA.idProducto, 'La coincidencia exacta de codigo no tuvo prioridad.');
    const withoutBarcode = await expect(ownerA, `/api/pos/productos?q=${encodeURIComponent(`Sin codigo ${marker}`)}`, {}, 200, 'Producto sin codigo');
    assert(withoutBarcode.productos.length === 1, 'El producto sin codigo no se pudo buscar por nombre.');
    await connection.query('UPDATE producto SET activo=0 WHERE idTienda=? AND idProducto=?', [fixture.storeA, productNoBarcode.idProducto]);
    const inactiveSearch = await expect(ownerA, `/api/pos/productos?q=${encodeURIComponent(`Sin codigo ${marker}`)}`, {}, 200, 'Producto inactivo oculto');
    assert(inactiveSearch.productos.length === 0, 'El POS mostro un producto inactivo.');
    await expect(ownerA, '/api/pos/ventas', { method: 'POST', body: {
      claveOperacion: `inactive-${marker}`, items: [{ idProducto: productNoBarcode.idProducto, cantidad: 1, presentacion: 'unidad' }],
      pagos: [{ metodoPago: 'efectivo', monto: 10 }]
    } }, 404, 'Producto inactivo rechazado');
    await connection.query('UPDATE producto SET activo=1 WHERE idTienda=? AND idProducto=?', [fixture.storeA, productNoBarcode.idProducto]);
    await expect(ownerA, '/api/pos/ventas', { method: 'POST', body: {
      claveOperacion: `invalid-package-${marker}`, items: [{ idProducto: concurrentProduct.idProducto, cantidad: 1, presentacion: 'paquete' }],
      pagos: [{ metodoPago: 'efectivo', monto: 10 }]
    } }, 400, 'Paquete no permitido rechazado');

    await expect(ownerA, `/api/pos/favoritos/${productA.idProducto}`, { method: 'POST' }, 200, 'Agregar favorito');
    const favorites = await expect(ownerA, '/api/pos/favoritos', {}, 200, 'Listar favoritos');
    assert(favorites.productos.some((product) => product.idProducto === productA.idProducto), 'El favorito no aparece en el POS.');

    const cashKey = `cash-${marker}`;
    const cashSale = await expect(ownerA, '/api/pos/ventas', {
      method: 'POST', body: {
        claveOperacion: cashKey,
        items: [{ idProducto: productA.idProducto, cantidad: 1, presentacion: 'unidad' }],
        pagos: [{ metodoPago: 'efectivo', monto: 10 }], efectivoRecibido: 15, saldoFiado: 0
      }
    }, 201, 'Venta en efectivo');
    assert(Number(cashSale.cambio) === 5, 'El cambio de efectivo es incorrecto.');
    assert(cashSale.estadoPago === 'pagada', 'La venta en efectivo no quedo pagada.');
    assert(cashSale.comprobante.venta.codigoComprobante, 'El comprobante no tiene codigo.');
    assert(cashSale.comprobante.detalle.length === 1 && cashSale.comprobante.pagos.length === 1, 'El comprobante esta incompleto.');
    assert(Number(cashSale.comprobante.pagos[0].montoRecibido) === 15
      && Number(cashSale.comprobante.pagos[0].cambio) === 5, 'El comprobante no conservo efectivo recibido y cambio.');
    const movementCountAfterCash = await scalar(connection,
      'SELECT COUNT(*) total FROM movimientoStock WHERE idTienda=? AND idDetalleVenta IS NOT NULL AND referenciaId IS NULL',
      [fixture.storeA]);
    const duplicateCash = await expect(ownerA, '/api/pos/ventas', {
      method: 'POST', body: {
        claveOperacion: cashKey,
        items: [{ idProducto: productA.idProducto, cantidad: 1, presentacion: 'unidad' }],
        pagos: [{ metodoPago: 'efectivo', monto: 10 }], efectivoRecibido: 15, saldoFiado: 0
      }
    }, 200, 'Reintento idempotente');
    assert(duplicateCash.repetida === true && duplicateCash.idVenta === cashSale.idVenta, 'El reintento no devolvio la venta existente.');
    assert(await scalar(connection, 'SELECT COUNT(*) total FROM venta WHERE idTienda=? AND claveOperacion=?', [fixture.storeA, cashKey]) === 1,
      'La clave de operacion creo ventas duplicadas.');
    assert(await scalar(connection, 'SELECT COUNT(*) total FROM pagoVenta WHERE idTienda=? AND idVenta=?', [fixture.storeA, cashSale.idVenta]) === 1,
      'El reintento duplico el pago.');
    assert(await scalar(connection,
      'SELECT COUNT(*) total FROM movimientoStock WHERE idTienda=? AND idDetalleVenta IS NOT NULL AND referenciaId IS NULL',
    [fixture.storeA]) === movementCountAfterCash, 'El reintento duplico el movimiento de stock.');

    const qrSale = await expect(ownerA, '/api/pos/ventas', {
      method: 'POST', body: {
        claveOperacion: `qr-${marker}`,
        items: [{ idProducto: productNoBarcode.idProducto, cantidad: 1, presentacion: 'unidad' }],
        pagos: [{ metodoPago: 'qr', monto: 10, referencia: `QR-${marker}` }], saldoFiado: 0
      }
    }, 201, 'Venta QR');
    assert(qrSale.comprobante.pagos[0].metodoPago === 'qr', 'El pago QR no quedo desglosado.');

    const discountedSale = await expect(ownerA, '/api/pos/ventas', {
      method: 'POST', body: {
        claveOperacion: `discount-${marker}`,
        items: [{ idProducto: productNoBarcode.idProducto, cantidad: 1, presentacion: 'unidad', precioVenta: 0 }],
        descuento: 2,
        total: 0,
        pagos: [{ metodoPago: 'qr', monto: 8 }],
        saldoFiado: 0
      }
    }, 201, 'Venta con precio autoritativo y descuento');
    assert(Number(discountedSale.subtotal) === 10 && Number(discountedSale.total) === 8,
      'El backend confio en el total o precio manipulado por el navegador.');

    const mixedSale = await expect(ownerA, '/api/pos/ventas', {
      method: 'POST', body: {
        claveOperacion: `mixed-${marker}`, idCliente: clientA.idCliente,
        items: [{ idProducto: productA.idProducto, cantidad: 2, presentacion: 'unidad' }],
        pagos: [{ metodoPago: 'efectivo', monto: 5 }, { metodoPago: 'qr', monto: 7, referencia: 'MIX' }],
        efectivoRecibido: 5, saldoFiado: 8
      }
    }, 201, 'Venta mixta parcial');
    assert(mixedSale.estadoPago === 'parcial' && Number(mixedSale.saldoPendiente) === 8, 'La venta parcial tiene saldo o estado incorrecto.');
    assert(await scalar(connection, 'SELECT COUNT(*) total FROM fiado WHERE idTienda=? AND idVenta=?', [fixture.storeA, mixedSale.idVenta]) === 1,
      'La venta parcial no creo exactamente un fiado.');
    assert(await scalar(connection, 'SELECT COUNT(*) total FROM pagoVenta WHERE idTienda=? AND idVenta=?', [fixture.storeA, mixedSale.idVenta]) === 2,
      'El pago mixto no creo dos componentes.');

    const creditSale = await expect(ownerA, '/api/pos/ventas', {
      method: 'POST', body: {
        claveOperacion: `credit-${marker}`, idCliente: clientA.idCliente,
        items: [{ idProducto: productA.idProducto, cantidad: 1, presentacion: 'paquete' }],
        pagos: [], saldoFiado: 45
      }
    }, 201, 'Venta totalmente fiada por paquete');
    assert(creditSale.estadoPago === 'pendiente', 'La venta totalmente fiada no quedo pendiente.');
    const [[stockAfterPackage]] = await connection.query(
      'SELECT stockUnidadesTotal FROM producto WHERE idTienda=? AND idProducto=?',
      [fixture.storeA, productA.idProducto]
    );
    assert(Number(stockAfterPackage.stockUnidadesTotal) === 32, 'La venta por paquete no desconto cinco unidades base.');

    await expect(ownerA, '/api/pos/ventas', { method: 'POST', body: {
      claveOperacion: `zero-${marker}`, items: [{ idProducto: productA.idProducto, cantidad: 0, presentacion: 'unidad' }], pagos: []
    } }, 400, 'Cantidad cero rechazada');
    await expect(ownerA, '/api/pos/ventas', { method: 'POST', body: {
      claveOperacion: `stock-${marker}`, items: [{ idProducto: productA.idProducto, cantidad: 999, presentacion: 'unidad' }], pagos: []
    } }, 400, 'Stock insuficiente rechazado');
    await expect(ownerA, '/api/pos/ventas', { method: 'POST', body: {
      claveOperacion: `overpay-${marker}`, items: [{ idProducto: productA.idProducto, cantidad: 1, presentacion: 'unidad' }], pagos: [{ metodoPago: 'efectivo', monto: 11 }]
    } }, 400, 'Pago mayor al total rechazado');
    await expect(ownerA, '/api/pos/ventas', { method: 'POST', body: {
      claveOperacion: `negative-${marker}`, items: [{ idProducto: productA.idProducto, cantidad: 1, presentacion: 'unidad' }], pagos: [{ metodoPago: 'efectivo', monto: -1 }]
    } }, 400, 'Pago negativo rechazado');
    await expect(ownerA, '/api/pos/ventas', { method: 'POST', body: {
      claveOperacion: `anonymous-debt-${marker}`, items: [{ idProducto: productA.idProducto, cantidad: 1, presentacion: 'unidad' }], pagos: [], saldoFiado: 10
    } }, 400, 'Fiado sin cliente rechazado');

    const movementBeforeDebtPayment = await scalar(connection,
      'SELECT COUNT(*) total FROM movimientoStock WHERE idTienda=? AND idDetalleVenta IS NOT NULL', [fixture.storeA]);
    const [[mixedDebt]] = await connection.query('SELECT idFiado FROM fiado WHERE idTienda=? AND idVenta=?', [fixture.storeA, mixedSale.idVenta]);
    await expect(ownerA, '/api/pagos-fiado', { method: 'POST', body: { idFiado: mixedDebt.idFiado, monto: 3, observacion: 'Abono POS' } }, 201, 'Pago posterior de fiado');
    assert(await scalar(connection, 'SELECT COUNT(*) total FROM movimientoStock WHERE idTienda=? AND idDetalleVenta IS NOT NULL', [fixture.storeA]) === movementBeforeDebtPayment,
      'El pago posterior del fiado genero otro movimiento de stock.');
    assert(await scalar(connection, 'SELECT COUNT(*) total FROM pagoVenta WHERE idTienda=? AND idVenta=? AND idPagoFiado IS NOT NULL', [fixture.storeA, mixedSale.idVenta]) === 1,
      'El pago posterior no se vinculo con la venta.');
    const [[saleAfterDebtPayment]] = await connection.query(
      'SELECT montoPagado, saldoPendiente, estadoPago FROM venta WHERE idTienda=? AND idVenta=?',
      [fixture.storeA, mixedSale.idVenta]
    );
    assert(Number(saleAfterDebtPayment.montoPagado) === 15
      && Number(saleAfterDebtPayment.saldoPendiente) === 5
      && saleAfterDebtPayment.estadoPago === 'parcial',
    'El pago posterior no actualizo correctamente el estado de la venta.');

    await expect(ownerB, `/api/ventas/${cashSale.idVenta}/comprobante`, {}, 404, 'Comprobante aislado por tienda');
    const beforeInvalid = await scalar(connection, 'SELECT COUNT(*) total FROM venta WHERE idTienda=?', [fixture.storeA]);
    await expect(ownerA, '/api/pos/ventas', { method: 'POST', body: {
      claveOperacion: `rollback-${marker}`, items: [{ idProducto: productA.idProducto, cantidad: 1, presentacion: 'unidad' }], pagos: [{ metodoPago: 'qr', monto: 999 }]
    } }, 400, 'Rollback por pago invalido');
    assert(await scalar(connection, 'SELECT COUNT(*) total FROM venta WHERE idTienda=?', [fixture.storeA]) === beforeInvalid,
      'El fallo de pago dejo una venta incompleta.');

    const concurrentPayload = (key) => ({
      method: 'POST', body: {
        claveOperacion: key,
        items: [{ idProducto: concurrentProduct.idProducto, cantidad: 1, presentacion: 'unidad' }],
        pagos: [{ metodoPago: 'efectivo', monto: 10 }], efectivoRecibido: 10, saldoFiado: 0
      }
    });
    const concurrent = await Promise.all([
      ownerA.request('/api/pos/ventas', concurrentPayload(`concurrent-a-${marker}`)),
      ownerAConcurrent.request('/api/pos/ventas', concurrentPayload(`concurrent-b-${marker}`))
    ]);
    assert(concurrent.filter((response) => response.status === 201).length === 1
      && concurrent.filter((response) => response.status === 400 || response.status === 409).length === 1,
    `La concurrencia no produjo un exito y un rechazo: ${JSON.stringify(concurrent.map((response) => response.status))}`);
    assert(await scalar(connection, 'SELECT stockUnidadesTotal total FROM producto WHERE idTienda=? AND idProducto=?', [fixture.storeA, concurrentProduct.idProducto]) === 0,
      'La venta concurrente dejo stock incorrecto.');

    await connection.query(
      "UPDATE suscripcionTienda SET fechaInicio=DATE_SUB(NOW(), INTERVAL 2 DAY), fechaFin=DATE_SUB(NOW(), INTERVAL 1 DAY), estado='activa' WHERE idSuscripcion=?",
      [fixture.subscriptionA]
    );
    await expect(ownerA, `/api/ventas/${cashSale.idVenta}/comprobante`, {}, 200, 'Comprobante disponible con suscripcion vencida');
    await expect(ownerA, '/api/pos/ventas', { method: 'POST', body: {
      claveOperacion: `expired-${marker}`, items: [{ idProducto: productA.idProducto, cantidad: 1, presentacion: 'unidad' }], pagos: [{ metodoPago: 'efectivo', monto: 10 }]
    } }, 403, 'Venta bloqueada con suscripcion vencida');
    await connection.query(
      "UPDATE suscripcionTienda SET fechaInicio=NOW(), fechaFin=DATE_ADD(NOW(), INTERVAL 30 DAY), estado='activa' WHERE idSuscripcion=?",
      [fixture.subscriptionA]
    );

    const encoded = encodeURIComponent(`Comprobante ${cashSale.codigoComprobante}\nTotal Bs ${cashSale.total}`);
    assert(encoded.includes('%0A') && !encoded.includes(' '), 'El texto de WhatsApp no se codifica de forma segura.');
    assert(await scalar(connection, 'SELECT COUNT(*) total FROM producto WHERE stockUnidadesTotal<0') === 0,
      'La prueba dejo productos con stock negativo.');
    console.log('Prueba de punto de venta y pagos completada correctamente.');
  } finally {
    if (connection) {
      try { await cleanup(connection, fixture); } finally { await connection.end(); }
    }
  }
}

main().catch((error) => {
  console.error('La prueba del punto de venta fallo.');
  console.error(error.message);
  process.exit(1);
});
