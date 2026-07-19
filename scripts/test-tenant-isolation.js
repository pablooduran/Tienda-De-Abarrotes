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
    this.diagnosticContext = null;
  }

  async request(path, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (options.body && typeof options.body !== 'string') {
      headers['content-type'] = 'application/json';
      options.body = JSON.stringify(options.body);
    }
    if (this.cookie) headers.cookie = this.cookie;
    const response = await fetch(`${this.baseUrl}${path}`, { ...options, headers, redirect: 'manual' });
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) this.cookie = setCookie.split(';')[0];
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

async function expect(session, path, options, status, label) {
  const response = await session.request(path, options);
  if (response.status !== status) {
    throw new Error(`${label}: diagnostico seguro:\n${JSON.stringify({
      metodo: options?.method || 'GET',
      ruta: path,
      statusEsperado: status,
      statusRecibido: response.status,
      respuesta: response.body,
      contextoTienda: session.diagnosticContext
    }, null, 2)}`);
  }
  return response.body;
}

function containsTenantField(value) {
  if (Array.isArray(value)) return value.some(containsTenantField);
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(([key, item]) => key === 'idTienda' || containsTenantField(item));
}

async function findByName(session, endpoint, name) {
  const response = await expect(session, endpoint, {}, 200, `Listado ${endpoint}`);
  const rows = Array.isArray(response) ? response : (response.clientes || []);
  const row = rows.find((item) => item.nombre === name);
  assert(row, `No se encontro ${name} en ${endpoint}.`);
  assert(!containsTenantField(response), `${endpoint} expuso idTienda al navegador.`);
  return row;
}

async function resolveOperationalPlan(connection, superSession) {
  const plans = await expect(superSession, '/api/admin/planes', {}, 200, 'Listado de planes para aislamiento');
  const [rows] = await connection.query(
    `SELECT p.idPlan, f.codigo funcionalidad
     FROM plan p
     JOIN planFuncionalidad pf ON pf.idPlan=p.idPlan AND pf.habilitada=1
     JOIN funcionalidad f ON f.idFuncionalidad=pf.idFuncionalidad AND f.activo=1
     WHERE p.activo=1`
  );
  const features = new Map();
  for (const row of rows) {
    const idPlan = Number(row.idPlan);
    if (!features.has(idPlan)) features.set(idPlan, new Set());
    features.get(idPlan).add(row.funcionalidad);
  }
  const candidates = plans.filter((plan) => Number(plan.activo) === 1
    && features.get(Number(plan.idPlan))?.has('clientes_basico'));
  candidates.sort((left, right) =>
    (features.get(Number(right.idPlan))?.size || 0) - (features.get(Number(left.idPlan))?.size || 0)
  );
  assert(candidates.length > 0, 'No existe un plan activo con clientes_basico para la prueba de aislamiento.');
  return candidates[0];
}

function storePayload(marker, label, planCode) {
  const password = `Owner-${label}-${crypto.randomBytes(10).toString('hex')}!`;
  return {
    password,
    body: {
      nombre: `Tienda aislamiento ${label} ${marker}`,
      slug: `tienda-aislamiento-${label}-${marker}`,
      estado: 'activa',
      activo: true,
      propietario: {
        usuario: `owner_isolation_${label}_${marker}`,
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
  await connection.query('DELETE FROM cierreCaja WHERE idTienda=?', [idTienda]);
  await connection.query('DELETE FROM gasto WHERE idTienda=?', [idTienda]);
  await connection.query('DELETE FROM categoriaGasto WHERE idTienda=?', [idTienda]);
  await connection.query('DELETE FROM movimientoLote WHERE idTienda=?', [idTienda]);
  await connection.query('DELETE FROM loteProducto WHERE idTienda=?', [idTienda]);
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
  await cleanupStore(connection, fixture.idTiendaSecundaria);
  await cleanupStore(connection, fixture.idTiendaPrimaria);
  if (fixture.usuarioSuperadmin) {
    await connection.query('DELETE FROM administrador WHERE usuario=?', [fixture.usuarioSuperadmin]);
  }
}

async function main() {
  const config = { ...requireLocalhostDatabase('La prueba de aislamiento multi-tienda'), decimalNumbers: true };
  if (!/(prueba|test)/i.test(config.database)) {
    throw new Error('La prueba solo puede ejecutarse sobre una base cuyo nombre indique que es de pruebas.');
  }

  const baseUrl = process.env.TEST_BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
  const marker = crypto.randomBytes(5).toString('hex');
  const fixture = {
    nombreProveedorPrimaria: `PROVEEDOR PRIMERA TEST ${marker}`,
    nombreClientePrimaria: `CLIENTE PRIMERA TEST ${marker}`,
    nombreProductoPrimaria: `PRODUCTO PRIMERA TEST ${marker}`,
    usuarioSuperadmin: `super_test_${marker}`
  };
  const sessions = [];
  let connection;

  try {
    connection = await mysql.createConnection(config);
    const inactiveUser = `inactive_test_${marker}`;
    const inactivePassword = `Inactive-${crypto.randomBytes(12).toString('hex')}!`;
    const superPassword = `Super-${crypto.randomBytes(12).toString('hex')}!`;
    const [inactiveHash, superHash] = await Promise.all([
      bcrypt.hash(inactivePassword, 10), bcrypt.hash(superPassword, 10)
    ]);
    await connection.query(
      "INSERT INTO administrador (idTienda, usuario, password, rol, activo) VALUES (NULL, ?, ?, 'superadmin', 1)",
      [fixture.usuarioSuperadmin, superHash]
    );

    const primarySession = new HttpSession(baseUrl);
    const secondSession = new HttpSession(baseUrl);
    const superSession = new HttpSession(baseUrl);
    const inactiveSession = new HttpSession(baseUrl);
    sessions.push(primarySession, secondSession, superSession, inactiveSession);

    await expect(superSession, '/auth/login', {
      method: 'POST', body: { usuario: fixture.usuarioSuperadmin, password: superPassword }
    }, 200, 'Login superadmin futuro');
    const operationalPlan = await resolveOperationalPlan(connection, superSession);
    const primaryStore = storePayload(marker, 'primaria', operationalPlan.codigo);
    const secondaryStore = storePayload(marker, 'secundaria', operationalPlan.codigo);
    const primaryCreated = await expect(superSession, '/api/admin/tiendas', {
      method: 'POST', body: primaryStore.body
    }, 201, 'Crear primera tienda temporal');
    fixture.idTiendaPrimaria = primaryCreated.tienda.idTienda;
    const secondaryCreated = await expect(superSession, '/api/admin/tiendas', {
      method: 'POST', body: secondaryStore.body
    }, 201, 'Crear segunda tienda temporal');
    fixture.idTiendaSecundaria = secondaryCreated.tienda.idTienda;
    primarySession.diagnosticContext = {
      tiendaActiva: primaryCreated.tienda,
      plan: primaryCreated.suscripcion.planCodigo,
      estadoSuscripcion: primaryCreated.suscripcion.estado
    };
    secondSession.diagnosticContext = {
      tiendaActiva: secondaryCreated.tienda,
      plan: secondaryCreated.suscripcion.planCodigo,
      estadoSuscripcion: secondaryCreated.suscripcion.estado
    };
    await connection.query(
      "INSERT INTO administrador (idTienda, usuario, password, rol, activo) VALUES (?, ?, ?, 'dueno_tienda', 0)",
      [fixture.idTiendaSecundaria, inactiveUser, inactiveHash]
    );

    const primaryLogin = await expect(primarySession, '/auth/login', {
      method: 'POST', body: { usuario: primaryStore.body.propietario.usuario, password: primaryStore.password }
    }, 200, 'Login primera tienda');
    assert(!containsTenantField(primaryLogin), 'El login expuso idTienda al navegador.');
    await expect(secondSession, '/auth/login', {
      method: 'POST', body: { usuario: secondaryStore.body.propietario.usuario, password: secondaryStore.password }
    }, 200, 'Login segunda tienda');
    await expect(inactiveSession, '/auth/login', {
      method: 'POST', body: { usuario: inactiveUser, password: inactivePassword }
    }, 401, 'Bloqueo de usuario inactivo');
    await expect(superSession, '/api/productos', {}, 403, 'Bloqueo operativo de superadmin');

    const secondNames = {
      proveedor: `PROVEEDOR SEGUNDA TEST ${marker}`,
      cliente: `CLIENTE SEGUNDA TEST ${marker}`,
      producto: `PRODUCTO SEGUNDA TEST ${marker}`
    };
    await expect(secondSession, '/api/proveedores', { method: 'POST', body: { nombre: secondNames.proveedor, telefono: '70000001' } }, 201, 'Crear proveedor segunda tienda');
    await expect(secondSession, '/api/clientes', { method: 'POST', body: { nombre: secondNames.cliente, telefono: '70000002' } }, 201, 'Crear cliente segunda tienda');
    const secondProvider = await findByName(secondSession, '/api/proveedores', secondNames.proveedor);
    const secondClient = await findByName(secondSession, '/api/clientes', secondNames.cliente);
    await expect(secondSession, '/api/productos', {
      method: 'POST',
      body: {
        nombre: secondNames.producto,
        idProveedor: secondProvider.idProveedor,
        categoria: 'OTROS',
        unidadMedida: 'unidad',
        unidadesPorPaquete: 1,
        paquetesPorCaja: 1,
        precioVenta: 10,
        stockMinimo: 1,
        stockUnidadesTotal: 0,
        permiteVentaPorPaquete: false,
        permiteVentaPorUnidad: true
      }
    }, 201, 'Crear producto segunda tienda');
    const secondProduct = await findByName(secondSession, '/api/productos', secondNames.producto);

    await expect(primarySession, '/api/proveedores', { method: 'POST', body: { nombre: fixture.nombreProveedorPrimaria, telefono: '70000003' } }, 201, 'Crear proveedor primera tienda');
    await expect(primarySession, '/api/clientes', { method: 'POST', body: { nombre: fixture.nombreClientePrimaria, telefono: '70000004' } }, 201, 'Crear cliente primera tienda');
    const primaryProvider = await findByName(primarySession, '/api/proveedores', fixture.nombreProveedorPrimaria);
    await expect(primarySession, '/api/productos', {
      method: 'POST',
      body: {
        nombre: fixture.nombreProductoPrimaria,
        idProveedor: primaryProvider.idProveedor,
        categoria: 'OTROS',
        unidadMedida: 'unidad',
        unidadesPorPaquete: 1,
        paquetesPorCaja: 1,
        precioVenta: 9,
        stockMinimo: 1,
        stockUnidadesTotal: 0,
        permiteVentaPorPaquete: false,
        permiteVentaPorUnidad: true
      }
    }, 201, 'Crear producto primera tienda');
    await findByName(primarySession, '/api/productos', fixture.nombreProductoPrimaria);

    const primaryProducts = await expect(primarySession, '/api/productos', {}, 200, 'Productos primera tienda');
    const secondProducts = await expect(secondSession, '/api/productos', {}, 200, 'Productos segunda tienda');
    assert(!primaryProducts.some((item) => item.idProducto === secondProduct.idProducto), 'La primera tienda vio un producto de otra tienda.');
    assert(!secondProducts.some((item) => item.nombre === fixture.nombreProductoPrimaria), 'La segunda tienda vio un producto de la primera tienda.');
    await expect(primarySession, `/api/clientes/${secondClient.idCliente}`, {
      method: 'PUT', body: { nombre: 'INTENTO CRUZADO', telefono: '70000005' }
    }, 404, 'Actualizacion cruzada de cliente');

    const purchase = await expect(secondSession, '/api/compras', {
      method: 'POST',
      body: {
        idProveedor: secondProvider.idProveedor,
        items: [{ idProducto: secondProduct.idProducto, cantidad: 3, presentacion: 'unidad', precioCompra: 4 }]
      }
    }, 201, 'Compra segunda tienda');
    const paidSale = await expect(secondSession, '/api/ventas', {
      method: 'POST',
      body: {
        tipo: 'pagada',
        items: [{ idProducto: secondProduct.idProducto, cantidad: 1, presentacion: 'unidad' }]
      }
    }, 201, 'Venta pagada segunda tienda');
    const sale = await expect(secondSession, '/api/ventas', {
      method: 'POST',
      body: {
        tipo: 'fiada',
        idCliente: secondClient.idCliente,
        items: [{ idProducto: secondProduct.idProducto, cantidad: 1, presentacion: 'unidad' }]
      }
    }, 201, 'Venta fiada segunda tienda');
    await expect(secondSession, '/api/pagos-fiado', {
      method: 'POST', body: {
        idFiado: sale.idFiado, monto: 4, metodoPago: 'efectivo',
        claveOperacion: `pago-aislamiento-${marker}`, observacion: 'PRUEBA AISLAMIENTO'
      }
    }, 201, 'Pago segunda tienda');
    await expect(secondSession, '/api/ventas', {
      method: 'POST',
      body: {
        tipo: 'fiada',
        idCliente: secondClient.idCliente,
        items: [{ idProducto: secondProduct.idProducto, cantidad: 1, presentacion: 'unidad' }]
      }
    }, 201, 'Segundo fiado para pago acumulado');
    const accumulatedPayment = await expect(secondSession, '/api/pagos-fiado/cliente', {
      method: 'POST', body: {
        idCliente: secondClient.idCliente, monto: 2, metodoPago: 'efectivo',
        claveOperacion: `pago-acumulado-aislamiento-${marker}`, observacion: 'PRUEBA ACUMULADA'
      }
    }, 201, 'Pago acumulado segunda tienda');
    assert(accumulatedPayment.aplicaciones.length > 0, 'El pago acumulado no se aplico a ningun fiado.');

    await expect(primarySession, `/api/ventas/${sale.idVenta}`, {}, 404, 'Lectura cruzada de venta');
    await expect(primarySession, `/api/fiados/${sale.idFiado}`, {}, 404, 'Lectura cruzada de fiado');
    await expect(primarySession, '/api/ventas', {
      method: 'POST',
      body: { tipo: 'pagada', items: [{ idProducto: secondProduct.idProducto, cantidad: 1, presentacion: 'unidad' }] }
    }, 404, 'Venta con producto de otra tienda');

    const [[stored]] = await connection.query(
      `SELECT
        (SELECT idTienda FROM compra WHERE idCompra=?) compraTienda,
        (SELECT idTienda FROM detalleCompra WHERE idCompra=? LIMIT 1) detalleCompraTienda,
        (SELECT idTienda FROM venta WHERE idVenta=?) ventaPagadaTienda,
        (SELECT idTienda FROM venta WHERE idVenta=?) ventaTienda,
        (SELECT idTienda FROM detalleVenta WHERE idVenta=? LIMIT 1) detalleVentaTienda,
        (SELECT idTienda FROM fiado WHERE idFiado=?) fiadoTienda,
        (SELECT idTienda FROM pagoFiado WHERE idFiado=? LIMIT 1) pagoTienda`,
      [purchase.idCompra, purchase.idCompra, paidSale.idVenta, sale.idVenta, sale.idVenta, sale.idFiado, sale.idFiado]
    );
    Object.values(stored).forEach((id) => {
      assert(Number(id) === Number(fixture.idTiendaSecundaria), 'Una escritura comercial guardo un idTienda incorrecto.');
    });

    const secondReport = await expect(secondSession, '/api/reportes/ventasRango', {}, 200, 'Reporte segunda tienda');
    const primaryReport = await expect(primarySession, '/api/reportes/ventasRango', {}, 200, 'Reporte primera tienda');
    assert(secondReport.rows.some((row) => row.idVenta === sale.idVenta), 'El reporte de la segunda tienda no incluyo su venta.');
    assert(!primaryReport.rows.some((row) => row.idVenta === sale.idVenta), 'El reporte de la primera tienda mezclo una venta de otra tienda.');
    await expect(secondSession, '/api/dashboard', {}, 200, 'Dashboard segunda tienda');
    await expect(primarySession, '/api/dashboard', {}, 200, 'Dashboard primera tienda');

    console.log('Prueba de aislamiento multi-tienda completada correctamente.');
  } finally {
    for (const session of sessions) {
      try {
        await session.request('/auth/logout', { method: 'POST' });
      } catch {
        // La limpieza de datos no depende de que el servidor siga disponible.
      }
    }
    try {
      await cleanup(connection, fixture);
    } finally {
      if (connection) await connection.end();
    }
  }
}

main().catch((error) => {
  console.error('La prueba de aislamiento multi-tienda fallo.');
  console.error(error.message);
  process.exit(1);
});
