const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { createDatabaseConnection } = require('../config/database-connection');
const { requireLocalhostDatabase } = require('../config/env');
const { insertStockMovement } = require('../services/stock-movement-service');
const { addLocalDays, formatLocalDateTime, getLocalNow } = require('../utils/local-datetime');

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
      nombre: `Tienda stock ${suffix} ${marker}`,
      slug: `tienda-stock-${suffix}-${marker}`,
      estado: 'activa',
      activo: true,
      propietario: {
        usuario: `owner_stock_${suffix}_${marker}`,
        password,
        confirmacionPassword: password,
        activo: true
      },
      suscripcion: { planCodigo: 'avanzado', tipo: 'cortesia', duracionDias: 30 }
    }
  };
}

function productPayload(name, stock = 0) {
  return {
    nombre: name,
    categoria: 'OTROS',
    unidadMedida: 'unidad',
    unidadesPorPaquete: 5,
    paquetesPorCaja: 1,
    precioVenta: 10,
    stockMinimo: 2,
    stockUnidadesTotal: stock,
    permiteVentaPorPaquete: true,
    permiteVentaPorUnidad: true
  };
}

async function scalar(connection, sql, params = []) {
  const [[row]] = await connection.query(sql, params);
  return Number(row.total || 0);
}

async function stockOf(connection, idTienda, idProducto) {
  const [[row]] = await connection.query(
    'SELECT stockUnidadesTotal, stock, activo FROM producto WHERE idTienda=? AND idProducto=?',
    [idTienda, idProducto]
  );
  assert(row, 'No se encontro el producto temporal esperado.');
  return row;
}

async function movementCount(connection, idTienda, idProducto = null) {
  const suffix = idProducto ? ' AND idProducto=?' : '';
  return scalar(connection, `SELECT COUNT(*) total FROM movimientoStock WHERE idTienda=?${suffix}`,
    idProducto ? [idTienda, idProducto] : [idTienda]);
}

async function cleanupStore(connection, idTienda) {
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
  const [stores] = await connection.query('SELECT idTienda FROM tienda WHERE slug LIKE ?', [`tienda-stock-%-${fixture.marker}`]);
  for (const store of stores) await cleanupStore(connection, store.idTienda);
  if (fixture.masterId) await connection.query('DELETE FROM productoMaestro WHERE idProductoMaestro=?', [fixture.masterId]);
  if (fixture.superUser) await connection.query('DELETE FROM administrador WHERE usuario=?', [fixture.superUser]);
}

async function main() {
  const config = { ...requireLocalhostDatabase('La prueba de movimientos de stock'), decimalNumbers: true };
  if (!/(prueba|test)/i.test(config.database)) {
    throw new Error('La prueba solo puede ejecutarse sobre una base cuyo nombre contenga prueba o test.');
  }
  const baseUrl = process.env.TEST_BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
  const marker = crypto.randomBytes(6).toString('hex');
  const fixture = { marker, superUser: `super_stock_${marker}` };
  const superPassword = `Super-${crypto.randomBytes(12).toString('hex')}!`;
  const sessions = [];
  let connection;

  try {
    connection = await createDatabaseConnection(config);
    const migration = await scalar(connection,
      "SELECT COUNT(*) total FROM schema_migrations WHERE nombre='007_movimientos_stock.sql'");
    assert(migration === 1, 'La migracion 007 debe estar aplicada.');

    const superHash = await bcrypt.hash(superPassword, 12);
    await connection.query(
      "INSERT INTO administrador (idTienda, usuario, password, rol, activo) VALUES (NULL, ?, ?, 'superadmin', 1)",
      [fixture.superUser, superHash]
    );

    const superSession = new HttpSession(baseUrl);
    const ownerA = new HttpSession(baseUrl);
    const ownerAConcurrent = new HttpSession(baseUrl);
    const ownerB = new HttpSession(baseUrl);
    sessions.push(superSession, ownerA, ownerAConcurrent, ownerB);
    await expect(superSession, '/auth/login', {
      method: 'POST', body: { usuario: fixture.superUser, password: superPassword }
    }, 200, 'Login superadmin');

    const storeA = storePayload(marker, 'a');
    const storeB = storePayload(marker, 'b');
    const createdA = await expect(superSession, '/api/admin/tiendas', {
      method: 'POST', body: storeA.body
    }, 201, 'Crear tienda A');
    const createdB = await expect(superSession, '/api/admin/tiendas', {
      method: 'POST', body: storeB.body
    }, 201, 'Crear tienda B');
    fixture.storeA = createdA.tienda.idTienda;
    fixture.storeB = createdB.tienda.idTienda;
    fixture.subscriptionA = createdA.suscripcion.idSuscripcion;

    await expect(ownerA, '/auth/login', {
      method: 'POST', body: { usuario: storeA.body.propietario.usuario, password: storeA.password }
    }, 200, 'Login propietario A');
    await expect(ownerAConcurrent, '/auth/login', {
      method: 'POST', body: { usuario: storeA.body.propietario.usuario, password: storeA.password }
    }, 200, 'Segundo login propietario A');
    await expect(ownerB, '/auth/login', {
      method: 'POST', body: { usuario: storeB.body.propietario.usuario, password: storeB.password }
    }, 200, 'Login propietario B');
    await expect(superSession, '/api/movimientos-stock', {}, 403, 'Superadmin bloqueado de inventario operativo');

    const manualName = `Producto manual stock ${marker}`;
    const manual = await expect(ownerA, '/api/productos', {
      method: 'POST', body: productPayload(manualName, 10)
    }, 201, 'Alta manual con stock');
    const manualId = manual.idProducto;
    assert(await movementCount(connection, fixture.storeA, manualId) === 1,
      'El alta manual no creo exactamente un movimiento inicial.');
    const [[initialMovement]] = await connection.query(
      `SELECT tipoMovimiento, origen, cantidad, stockAnterior, stockPosterior
       FROM movimientoStock WHERE idTienda=? AND idProducto=?`,
      [fixture.storeA, manualId]
    );
    assert(initialMovement.tipoMovimiento === 'inventario_inicial'
      && initialMovement.origen === 'alta_producto'
      && Number(initialMovement.cantidad) === 10
      && Number(initialMovement.stockAnterior) === 0
      && Number(initialMovement.stockPosterior) === 10,
    'El movimiento inicial manual es incorrecto.');

    const zero = await expect(ownerA, '/api/productos', {
      method: 'POST', body: productPayload(`Producto cero ${marker}`, 0)
    }, 201, 'Alta manual sin stock');
    assert(await movementCount(connection, fixture.storeA, zero.idProducto) === 0,
      'El alta con stock cero creo un movimiento inutil.');

    const masterName = `Maestro stock ${marker}`;
    const fingerprint = crypto.createHash('sha256').update(`${masterName}|sin-marca|unidad|1|unidad`).digest('hex');
    const [master] = await connection.query(
      `INSERT INTO productoMaestro
       (nombre, nombreNormalizado, unidadesPorPaquete, permiteVentaPorUnidad,
        permiteVentaPorPaquete, huellaDuplicado, activo)
       VALUES (?, ?, 1, 1, 0, ?, 1)`,
      [masterName, masterName.toLowerCase(), fingerprint]
    );
    fixture.masterId = master.insertId;
    const catalogAdded = await expect(ownerA, '/api/catalogo-maestro/agregar', {
      method: 'POST', body: { items: [{
        idProductoMaestro: fixture.masterId,
        nombreLocal: `Local catalogo ${marker}`,
        categoriaLocal: 'OTROS',
        precioCompra: 2,
        precioVenta: 4,
        stockInicial: 6,
        stockMinimo: 1,
        unidadesPorPaquete: 1,
        permiteVentaPorUnidad: true,
        permiteVentaPorPaquete: false,
        activo: true
      }] }
    }, 201, 'Alta desde catalogo con stock');
    const catalogProductId = catalogAdded.creados[0].idProducto;
    const [[catalogMovement]] = await connection.query(
      'SELECT cantidad, origen FROM movimientoStock WHERE idTienda=? AND idProducto=?',
      [fixture.storeA, catalogProductId]
    );
    assert(Number(catalogMovement.cantidad) === 6 && catalogMovement.origen === 'alta_producto',
      'El alta desde catalogo no creo el movimiento inicial correcto.');

    const provider = await expect(ownerA, '/api/proveedores', {
      method: 'POST', body: { nombre: `Proveedor stock ${marker}`, telefono: '70000001' }
    }, 201, 'Crear proveedor');
    const providers = await expect(ownerA, '/api/proveedores', {}, 200, 'Listar proveedores');
    const providerRow = providers.find((row) => row.nombre === `Proveedor stock ${marker}`);
    assert(providerRow, 'No se encontro el proveedor temporal.');
    const client = await expect(ownerA, '/api/clientes', {
      method: 'POST', body: { nombre: `Cliente stock ${marker}`, telefono: '70000002' }
    }, 201, 'Crear cliente');
    const clients = await expect(ownerA, '/api/clientes', {}, 200, 'Listar clientes');
    const clientRow = clients.find((row) => row.nombre === `Cliente stock ${marker}`);
    assert(clientRow, 'No se encontro el cliente temporal.');
    assert(provider && client, 'Las altas auxiliares no devolvieron respuesta.');

    const purchaseKey = `purchase-${marker}`;
    const purchasePayload = {
      idProveedor: providerRow.idProveedor,
      claveOperacion: purchaseKey,
      items: [{ idProducto: manualId, cantidad: 2, presentacion: 'paquete', precioCompra: 15 }]
    };
    const purchase = await expect(ownerA, '/api/compras', {
      method: 'POST', body: purchasePayload
    }, 201, 'Compra por paquete');
    let stock = await stockOf(connection, fixture.storeA, manualId);
    assert(Number(stock.stockUnidadesTotal) === 20, 'La compra por paquete no sumo diez unidades base.');
    const purchaseMovementCount = await movementCount(connection, fixture.storeA, manualId);
    const repeatedPurchase = await expect(ownerA, '/api/compras', {
      method: 'POST', body: purchasePayload
    }, 201, 'Reintento idempotente de compra');
    assert(repeatedPurchase.repetida === true
      && await movementCount(connection, fixture.storeA, manualId) === purchaseMovementCount,
    'El reintento de compra duplico el movimiento.');

    const paidSaleKey = `paid-sale-${marker}`;
    const paidSalePayload = {
      tipo: 'pagada',
      claveOperacion: paidSaleKey,
      items: [{ idProducto: manualId, cantidad: 1, presentacion: 'paquete' }]
    };
    const paidSale = await expect(ownerA, '/api/ventas', {
      method: 'POST', body: paidSalePayload
    }, 201, 'Venta pagada por paquete');
    stock = await stockOf(connection, fixture.storeA, manualId);
    assert(Number(stock.stockUnidadesTotal) === 15, 'La venta por paquete no desconto cinco unidades base.');
    const saleMovementCount = await movementCount(connection, fixture.storeA, manualId);
    const repeatedSale = await expect(ownerA, '/api/ventas', {
      method: 'POST', body: paidSalePayload
    }, 201, 'Reintento idempotente de venta');
    assert(repeatedSale.repetida === true
      && await movementCount(connection, fixture.storeA, manualId) === saleMovementCount,
    'El reintento de venta duplico el movimiento.');

    const creditSale = await expect(ownerA, '/api/ventas', {
      method: 'POST', body: {
        tipo: 'fiada',
        idCliente: clientRow.idCliente,
        claveOperacion: `credit-sale-${marker}`,
        items: [{ idProducto: manualId, cantidad: 2, presentacion: 'unidad' }]
      }
    }, 201, 'Venta fiada');
    const creditMovementCount = await scalar(connection,
      `SELECT COUNT(*) total FROM movimientoStock ms
       JOIN detalleVenta dv ON dv.idDetalleVenta=ms.idDetalleVenta AND dv.idTienda=ms.idTienda
       WHERE ms.idTienda=? AND dv.idVenta=?`,
      [fixture.storeA, creditSale.idVenta]);
    assert(creditMovementCount === 1, 'La venta fiada genero mas de una salida de stock.');
    const beforePayment = await movementCount(connection, fixture.storeA, manualId);
    await expect(ownerA, '/api/pagos-fiado', {
      method: 'POST', body: {
        idFiado: creditSale.idFiado, monto: 1, metodoPago: 'efectivo',
        claveOperacion: `cobro-stock-${marker}`, observacion: 'Pago de prueba'
      }
    }, 201, 'Pago de fiado');
    assert(await movementCount(connection, fixture.storeA, manualId) === beforePayment,
      'El pago del fiado modifico el historial de stock.');

    stock = await stockOf(connection, fixture.storeA, manualId);
    const stockBeforeEdit = Number(stock.stockUnidadesTotal);
    await expect(ownerA, `/api/productos/${manualId}`, {
      method: 'PUT', body: { ...productPayload(manualName, 999), stockUnidadesTotal: 999 }
    }, 200, 'Editar producto sin alterar stock');
    stock = await stockOf(connection, fixture.storeA, manualId);
    assert(Number(stock.stockUnidadesTotal) === stockBeforeEdit && Number(stock.stock) === stockBeforeEdit,
      'La edicion general cambio el stock directamente.');

    await expect(ownerA, `/api/productos/${manualId}/ajustar-stock`, {
      method: 'POST', body: {
        nuevoStock: stockBeforeEdit + 3, motivo: 'Conteo fisico', password: 'incorrecta', claveOperacion: `bad-pass-${marker}`
      }
    }, 403, 'Ajuste con contrasena incorrecta');
    await expect(ownerA, `/api/productos/${manualId}/ajustar-stock`, {
      method: 'POST', body: {
        nuevoStock: stockBeforeEdit + 3, motivo: '', password: storeA.password, claveOperacion: `empty-reason-${marker}`
      }
    }, 400, 'Ajuste sin motivo');
    const positiveAdjustment = await expect(ownerA, `/api/productos/${manualId}/ajustar-stock`, {
      method: 'POST', body: {
        nuevoStock: stockBeforeEdit + 3, motivo: 'Conteo fisico positivo', observacion: 'Prueba local',
        password: storeA.password, claveOperacion: `positive-${marker}`
      }
    }, 201, 'Ajuste positivo');
    assert(Number(positiveAdjustment.diferencia) === 3, 'El ajuste positivo calculo una diferencia incorrecta.');
    const negativeAdjustment = await expect(ownerA, `/api/productos/${manualId}/ajustar-stock`, {
      method: 'POST', body: {
        nuevoStock: stockBeforeEdit + 1, motivo: 'Conteo fisico negativo',
        password: storeA.password, claveOperacion: `negative-${marker}`
      }
    }, 201, 'Ajuste negativo');
    assert(Number(negativeAdjustment.diferencia) === -2, 'El ajuste negativo calculo una diferencia incorrecta.');
    await expect(ownerA, `/api/productos/${manualId}/ajustar-stock`, {
      method: 'POST', body: {
        nuevoStock: stockBeforeEdit + 1, motivo: 'Conteo sin diferencia',
        password: storeA.password, claveOperacion: `zero-adjustment-${marker}`
      }
    }, 400, 'Ajuste de cantidad cero');
    await expect(ownerA, `/api/productos/${manualId}/ajustar-stock`, {
      method: 'POST', body: {
        nuevoStock: -1, motivo: 'Intento de stock negativo',
        password: storeA.password, claveOperacion: `negative-stock-${marker}`
      }
    }, 400, 'Ajuste a stock negativo');

    await expect(ownerB, `/api/productos/${manualId}/movimientos`, {}, 404,
      'Otra tienda consulta movimientos ajenos');
    await expect(ownerB, `/api/productos/${manualId}/ajustar-stock`, {
      method: 'POST', body: {
        nuevoStock: 1, motivo: 'Intento cruzado', password: storeB.password, claveOperacion: `cross-${marker}`
      }
    }, 404, 'Otra tienda ajusta stock ajeno');

    const beforeHideCount = await movementCount(connection, fixture.storeA, manualId);
    const beforeHideStock = Number((await stockOf(connection, fixture.storeA, manualId)).stockUnidadesTotal);
    await expect(ownerA, `/api/productos/${manualId}`, { method: 'DELETE' }, 200, 'Ocultar producto');
    stock = await stockOf(connection, fixture.storeA, manualId);
    assert(Number(stock.activo) === 0 && Number(stock.stockUnidadesTotal) === beforeHideStock
      && await movementCount(connection, fixture.storeA, manualId) === beforeHideCount,
    'Ocultar el producto altero stock o movimientos.');
    await expect(ownerA, `/api/productos/${manualId}/movimientos`, {}, 200,
      'Consultar movimientos de producto oculto');
    await expect(ownerA, `/api/productos/${manualId}/restaurar`, { method: 'PATCH' }, 200,
      'Restaurar producto');
    stock = await stockOf(connection, fixture.storeA, manualId);
    assert(Number(stock.activo) === 1 && Number(stock.stockUnidadesTotal) === beforeHideStock
      && await movementCount(connection, fixture.storeA, manualId) === beforeHideCount,
    'Restaurar el producto altero stock o movimientos.');

    const concurrencyProduct = await expect(ownerA, '/api/productos', {
      method: 'POST', body: { ...productPayload(`Producto concurrencia ${marker}`, 1), unidadesPorPaquete: 1, permiteVentaPorPaquete: false }
    }, 201, 'Crear producto para concurrencia');
    const concurrentResults = await Promise.all([
      ownerA.request('/api/ventas', {
        method: 'POST', body: {
          tipo: 'pagada', claveOperacion: `concurrent-a-${marker}`,
          items: [{ idProducto: concurrencyProduct.idProducto, cantidad: 1, presentacion: 'unidad' }]
        }
      }),
      ownerAConcurrent.request('/api/ventas', {
        method: 'POST', body: {
          tipo: 'pagada', claveOperacion: `concurrent-b-${marker}`,
          items: [{ idProducto: concurrencyProduct.idProducto, cantidad: 1, presentacion: 'unidad' }]
        }
      })
    ]);
    assert(concurrentResults.filter((result) => result.status === 201).length === 1
      && concurrentResults.filter((result) => result.status === 400).length === 1,
    `La concurrencia no produjo una venta valida y una rechazada: ${concurrentResults.map((result) => result.status).join(', ')}.`);
    stock = await stockOf(connection, fixture.storeA, concurrencyProduct.idProducto);
    assert(Number(stock.stockUnidadesTotal) === 0
      && await movementCount(connection, fixture.storeA, concurrencyProduct.idProducto) === 2,
    'La concurrencia dejo stock negativo o movimientos incorrectos.');

    let doubleReferenceRejected = false;
    try {
      await insertStockMovement(connection, {
        idTienda: fixture.storeA,
        idProducto: zero.idProducto,
        tipoMovimiento: 'salida',
        origen: 'venta',
        cantidad: -1,
        stockAnterior: 1,
        stockPosterior: 0,
        motivo: 'Prueba de referencia comercial doble.',
        idDetalleVenta: 1,
        idDetalleCompra: 1,
        claveOperacion: `double-reference-${marker}`
      });
    } catch (error) {
      doubleReferenceRejected = error.code === 'STOCK_REFERENCE_CONFLICT';
    }
    assert(doubleReferenceRejected,
      'El servicio permitio vincular un movimiento a venta y compra simultaneamente.');

    const beforeRollbackStock = Number((await stockOf(connection, fixture.storeA, zero.idProducto)).stockUnidadesTotal);
    const rollbackConnection = await createDatabaseConnection(config);
    try {
      await rollbackConnection.beginTransaction();
      await rollbackConnection.query(
        'UPDATE producto SET stockUnidadesTotal=stockUnidadesTotal+1, stock=stock+1 WHERE idTienda=? AND idProducto=?',
        [fixture.storeA, zero.idProducto]
      );
      await insertStockMovement(rollbackConnection, {
        idTienda: fixture.storeA,
        idProducto: zero.idProducto,
        tipoMovimiento: 'entrada',
        origen: 'correccion_sistema',
        cantidad: 1,
        stockAnterior: beforeRollbackStock,
        stockPosterior: beforeRollbackStock + 2,
        motivo: 'Prueba controlada de rollback.',
        claveOperacion: `rollback-${marker}`
      });
      throw new Error('El servicio acepto un movimiento incoherente.');
    } catch (error) {
      await rollbackConnection.rollback();
      assert(error.code === 'STOCK_MOVEMENT_MISMATCH', `Fallo inesperado en la prueba de rollback: ${error.message}`);
    } finally {
      await rollbackConnection.end();
    }
    stock = await stockOf(connection, fixture.storeA, zero.idProducto);
    assert(Number(stock.stockUnidadesTotal) === beforeRollbackStock,
      'El rollback no revirtio el cambio de stock cuando fallo el movimiento.');

    const history = await expect(ownerA, `/api/movimientos-stock?origen=venta&q=${encodeURIComponent(manualName)}&limit=2`, {}, 200,
      'Historial general filtrado');
    assert(history.limit === 2 && history.rows.length > 0
      && history.rows.every((row) => row.origen === 'venta' && row.producto === manualName),
    'El historial general no respeto filtros o paginacion.');
    const productHistory = await expect(ownerA, `/api/productos/${manualId}/movimientos?tipo=ajuste_negativo&limit=10`, {}, 200,
      'Historial por producto filtrado');
    assert(productHistory.rows.length >= 1
      && productHistory.rows.every((row) => row.tipoMovimiento === 'ajuste_negativo'),
    'El historial del producto no respeto el filtro.');

    const reconciliation = await scalar(connection,
      `SELECT COUNT(*) total FROM (
         SELECT p.idProducto
         FROM producto p
         LEFT JOIN movimientoStock ms ON ms.idTienda=p.idTienda AND ms.idProducto=p.idProducto
         WHERE p.idTienda=?
         GROUP BY p.idProducto, p.stockUnidadesTotal
         HAVING COALESCE(SUM(ms.cantidad),0)<>p.stockUnidadesTotal
       ) diferencias`,
      [fixture.storeA]);
    assert(reconciliation === 0, 'Los movimientos temporales no reconcilian con el stock actual.');
    const duplicateReferences = await scalar(connection,
      `SELECT COUNT(*) total FROM (
         SELECT idDetalleVenta referencia FROM movimientoStock
         WHERE idTienda=? AND idDetalleVenta IS NOT NULL
         GROUP BY idDetalleVenta HAVING COUNT(*)>1
         UNION ALL
         SELECT idDetalleCompra referencia FROM movimientoStock
         WHERE idTienda=? AND idDetalleCompra IS NOT NULL
         GROUP BY idDetalleCompra HAVING COUNT(*)>1
       ) duplicados`,
      [fixture.storeA, fixture.storeA]);
    assert(duplicateReferences === 0, 'Existen referencias de venta o compra duplicadas.');

    const expirationReference = getLocalNow();
    await connection.query(
      `UPDATE suscripcionTienda SET estado='activa', fechaInicio=?, fechaFin=?
       WHERE idSuscripcion=?`,
      [formatLocalDateTime(addLocalDays(expirationReference, -30)),
        formatLocalDateTime(addLocalDays(expirationReference, -1)), fixture.subscriptionA]
    );
    await expect(ownerA, '/api/movimientos-stock', {}, 200,
      'Suscripcion vencida consulta movimientos');
    await expect(ownerA, `/api/productos/${manualId}/ajustar-stock`, {
      method: 'POST', body: {
        nuevoStock: beforeHideStock + 1, motivo: 'Intento con suscripcion vencida',
        password: storeA.password, claveOperacion: `expired-${marker}`
      }
    }, 403, 'Suscripcion vencida bloquea ajuste');

    assert(paidSale.idVenta && purchase.idCompra,
      'Las operaciones comerciales no devolvieron sus referencias.');
    console.log('Prueba de movimientos de stock completada correctamente.');
  } finally {
    for (const session of sessions) {
      try { await session.request('/auth/logout', { method: 'POST' }); } catch { /* El servidor puede estar detenido. */ }
    }
    try { await cleanup(connection, fixture); } finally { if (connection) await connection.end(); }
  }
}

main().catch((error) => {
  console.error('La prueba de movimientos de stock fallo.');
  console.error(error.message);
  process.exit(1);
});
