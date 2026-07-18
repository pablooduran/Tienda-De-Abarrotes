const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const mysql = require('mysql2/promise');
const { requireEnvironment, requireLocalhostDatabase } = require('../config/env');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

class HttpSession {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
    this.cookie = '';
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
  assert(response.status === status, `${label}: se esperaba HTTP ${status} y se obtuvo ${response.status}.`);
  return response.body;
}

function containsTenantField(value) {
  if (Array.isArray(value)) return value.some(containsTenantField);
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(([key, item]) => key === 'idTienda' || containsTenantField(item));
}

async function findByName(session, endpoint, name) {
  const rows = await expect(session, endpoint, {}, 200, `Listado ${endpoint}`);
  const row = rows.find((item) => item.nombre === name);
  assert(row, `No se encontro ${name} en ${endpoint}.`);
  assert(!containsTenantField(rows), `${endpoint} expuso idTienda al navegador.`);
  return row;
}

async function cleanup(connection, fixture) {
  if (!connection) return;
  if (fixture.idTiendaSecundaria) {
    const id = fixture.idTiendaSecundaria;
    await connection.query('DELETE FROM movimientoStock WHERE idTienda=?', [id]);
    await connection.query('DELETE FROM pagoVenta WHERE idTienda=?', [id]);
    await connection.query('DELETE FROM pagoFiado WHERE idTienda=?', [id]);
    await connection.query('DELETE FROM detalleFiado WHERE idTienda=?', [id]);
    await connection.query('DELETE FROM detalleVenta WHERE idTienda=?', [id]);
    await connection.query('DELETE FROM detalleCompra WHERE idTienda=?', [id]);
    await connection.query('DELETE FROM fiado WHERE idTienda=?', [id]);
    await connection.query('DELETE FROM venta WHERE idTienda=?', [id]);
    await connection.query('DELETE FROM compra WHERE idTienda=?', [id]);
    await connection.query('DELETE FROM producto WHERE idTienda=?', [id]);
    await connection.query('DELETE FROM cliente WHERE idTienda=?', [id]);
    await connection.query('DELETE FROM proveedor WHERE idTienda=?', [id]);
    await connection.query('DELETE FROM suscripcionTienda WHERE idTienda=?', [id]);
    await connection.query('DELETE FROM administrador WHERE idTienda=?', [id]);
    await connection.query('DELETE FROM tienda WHERE idTienda=?', [id]);
  }
  if (fixture.idTiendaDeisy) {
    await connection.query(
      `DELETE ms FROM movimientoStock ms
       JOIN producto p ON p.idProducto=ms.idProducto AND p.idTienda=ms.idTienda
       WHERE p.idTienda=? AND p.nombre=?`,
      [fixture.idTiendaDeisy, fixture.nombreProductoDeisy]
    );
    await connection.query('DELETE FROM producto WHERE idTienda=? AND nombre=?', [fixture.idTiendaDeisy, fixture.nombreProductoDeisy]);
    await connection.query('DELETE FROM cliente WHERE idTienda=? AND nombre=?', [fixture.idTiendaDeisy, fixture.nombreClienteDeisy]);
    await connection.query('DELETE FROM proveedor WHERE idTienda=? AND nombre=?', [fixture.idTiendaDeisy, fixture.nombreProveedorDeisy]);
  }
  if (fixture.usuarioSuperadmin) {
    await connection.query('DELETE FROM administrador WHERE usuario=?', [fixture.usuarioSuperadmin]);
  }
}

async function main() {
  requireEnvironment(['ADMIN_USER', 'ADMIN_PASSWORD']);
  const config = { ...requireLocalhostDatabase('La prueba de aislamiento multi-tienda'), decimalNumbers: true };
  if (!/(prueba|test)/i.test(config.database)) {
    throw new Error('La prueba solo puede ejecutarse sobre una base cuyo nombre indique que es de pruebas.');
  }

  const baseUrl = process.env.TEST_BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
  const marker = crypto.randomBytes(5).toString('hex');
  const fixture = {
    nombreProveedorDeisy: `PROVEEDOR DEISY TEST ${marker}`,
    nombreClienteDeisy: `CLIENTE DEISY TEST ${marker}`,
    nombreProductoDeisy: `PRODUCTO DEISY TEST ${marker}`,
    usuarioSuperadmin: `super_test_${marker}`
  };
  const sessions = [];
  let connection;

  try {
    connection = await mysql.createConnection(config);
    const [[deisy]] = await connection.query("SELECT idTienda FROM tienda WHERE slug='tienda-deisy' LIMIT 1");
    assert(deisy, 'No existe Tienda Deisy en la base local.');
    fixture.idTiendaDeisy = deisy.idTienda;

    const slug = `tienda-prueba-${marker}`;
    const [store] = await connection.query(
      "INSERT INTO tienda (nombre, slug, activo, estado) VALUES (?, ?, 1, 'activa')",
      [`TIENDA PRUEBA ${marker}`, slug]
    );
    fixture.idTiendaSecundaria = store.insertId;
    const [[advancedPlan]] = await connection.query("SELECT idPlan FROM plan WHERE codigo='avanzado' LIMIT 1");
    assert(advancedPlan, 'No existe el plan avanzado. Ejecute primero la migracion 005.');
    await connection.query(
      `INSERT INTO suscripcionTienda
       (idTienda, idPlan, tipo, estado, fechaInicio, fechaFin, renovacionAutomatica, observacion)
       VALUES (?, ?, 'cortesia', 'activa', CURRENT_TIMESTAMP, DATE_ADD(CURRENT_TIMESTAMP, INTERVAL 30 DAY), 0, 'Prueba de aislamiento')`,
      [fixture.idTiendaSecundaria, advancedPlan.idPlan]
    );

    const ownerUser = `owner_test_${marker}`;
    const ownerPassword = `Owner-${crypto.randomBytes(12).toString('hex')}!`;
    const inactiveUser = `inactive_test_${marker}`;
    const inactivePassword = `Inactive-${crypto.randomBytes(12).toString('hex')}!`;
    const superPassword = `Super-${crypto.randomBytes(12).toString('hex')}!`;
    const [ownerHash, inactiveHash, superHash] = await Promise.all([
      bcrypt.hash(ownerPassword, 10),
      bcrypt.hash(inactivePassword, 10),
      bcrypt.hash(superPassword, 10)
    ]);
    await connection.query(
      "INSERT INTO administrador (idTienda, usuario, password, rol, activo) VALUES (?, ?, ?, 'dueno_tienda', 1)",
      [fixture.idTiendaSecundaria, ownerUser, ownerHash]
    );
    await connection.query(
      "INSERT INTO administrador (idTienda, usuario, password, rol, activo) VALUES (?, ?, ?, 'dueno_tienda', 0)",
      [fixture.idTiendaSecundaria, inactiveUser, inactiveHash]
    );
    await connection.query(
      "INSERT INTO administrador (idTienda, usuario, password, rol, activo) VALUES (NULL, ?, ?, 'superadmin', 1)",
      [fixture.usuarioSuperadmin, superHash]
    );

    const deisySession = new HttpSession(baseUrl);
    const secondSession = new HttpSession(baseUrl);
    const superSession = new HttpSession(baseUrl);
    const inactiveSession = new HttpSession(baseUrl);
    sessions.push(deisySession, secondSession, superSession, inactiveSession);

    const deisyLogin = await expect(deisySession, '/auth/login', {
      method: 'POST', body: { usuario: process.env.ADMIN_USER, password: process.env.ADMIN_PASSWORD }
    }, 200, 'Login Tienda Deisy');
    assert(!containsTenantField(deisyLogin), 'El login expuso idTienda al navegador.');
    await expect(secondSession, '/auth/login', {
      method: 'POST', body: { usuario: ownerUser, password: ownerPassword }
    }, 200, 'Login segunda tienda');
    await expect(inactiveSession, '/auth/login', {
      method: 'POST', body: { usuario: inactiveUser, password: inactivePassword }
    }, 401, 'Bloqueo de usuario inactivo');
    await expect(superSession, '/auth/login', {
      method: 'POST', body: { usuario: fixture.usuarioSuperadmin, password: superPassword }
    }, 200, 'Login superadmin futuro');
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

    await expect(deisySession, '/api/proveedores', { method: 'POST', body: { nombre: fixture.nombreProveedorDeisy, telefono: '70000003' } }, 201, 'Crear proveedor Deisy');
    await expect(deisySession, '/api/clientes', { method: 'POST', body: { nombre: fixture.nombreClienteDeisy, telefono: '70000004' } }, 201, 'Crear cliente Deisy');
    const deisyProvider = await findByName(deisySession, '/api/proveedores', fixture.nombreProveedorDeisy);
    await expect(deisySession, '/api/productos', {
      method: 'POST',
      body: {
        nombre: fixture.nombreProductoDeisy,
        idProveedor: deisyProvider.idProveedor,
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
    }, 201, 'Crear producto Deisy');
    await findByName(deisySession, '/api/productos', fixture.nombreProductoDeisy);

    const deisyProducts = await expect(deisySession, '/api/productos', {}, 200, 'Productos Deisy');
    const secondProducts = await expect(secondSession, '/api/productos', {}, 200, 'Productos segunda tienda');
    assert(!deisyProducts.some((item) => item.idProducto === secondProduct.idProducto), 'Tienda Deisy vio un producto de otra tienda.');
    assert(!secondProducts.some((item) => item.nombre === fixture.nombreProductoDeisy), 'La segunda tienda vio un producto de Tienda Deisy.');
    await expect(deisySession, `/api/clientes/${secondClient.idCliente}`, {
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
      method: 'POST', body: { idFiado: sale.idFiado, monto: 4, observacion: 'PRUEBA AISLAMIENTO' }
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
      method: 'POST', body: { idCliente: secondClient.idCliente, monto: 2, observacion: 'PRUEBA ACUMULADA' }
    }, 201, 'Pago acumulado segunda tienda');
    assert(accumulatedPayment.aplicaciones.length > 0, 'El pago acumulado no se aplico a ningun fiado.');

    await expect(deisySession, `/api/ventas/${sale.idVenta}`, {}, 404, 'Lectura cruzada de venta');
    await expect(deisySession, `/api/fiados/${sale.idFiado}`, {}, 404, 'Lectura cruzada de fiado');
    await expect(deisySession, '/api/ventas', {
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
    const deisyReport = await expect(deisySession, '/api/reportes/ventasRango', {}, 200, 'Reporte Deisy');
    assert(secondReport.rows.some((row) => row.idVenta === sale.idVenta), 'El reporte de la segunda tienda no incluyo su venta.');
    assert(!deisyReport.rows.some((row) => row.idVenta === sale.idVenta), 'El reporte Deisy mezclo una venta de otra tienda.');
    await expect(secondSession, '/api/dashboard', {}, 200, 'Dashboard segunda tienda');
    await expect(deisySession, '/api/dashboard', {}, 200, 'Dashboard Deisy');

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
