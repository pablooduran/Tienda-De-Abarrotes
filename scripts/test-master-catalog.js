const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const ExcelJS = require('exceljs');
const mysql = require('mysql2/promise');
const { requireLocalhostDatabase } = require('../config/env');
const { formatLocalDateTime } = require('../utils/local-datetime');

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
    if (request.body && typeof request.body !== 'string' && !(request.body instanceof FormData)) {
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

async function expect(session, path, options, status, label) {
  const response = await session.request(path, options);
  if (response.status !== status) {
    const safeBody = response.body && typeof response.body === 'object'
      ? Object.fromEntries(Object.entries(response.body).filter(([key]) => !/(password|cookie|token|hash)/i.test(key)))
      : response.body;
    throw new Error(`${label}: se esperaba HTTP ${status}, se obtuvo ${response.status}. Respuesta: ${JSON.stringify(safeBody)}`);
  }
  return response.body;
}

function storePayload(marker, suffix, planCodigo) {
  const password = `Owner-${suffix}-${crypto.randomBytes(10).toString('hex')}!`;
  return {
    password,
    body: {
      nombre: `Tienda catalogo ${suffix} ${marker}`,
      slug: `tienda-catalogo-${suffix}-${marker}`,
      estado: 'activa',
      activo: true,
      propietario: {
        usuario: `owner_catalogo_${suffix}_${marker}`,
        password,
        confirmacionPassword: password,
        activo: true
      },
      suscripcion: { planCodigo, tipo: 'cortesia', duracionDias: 30 }
    }
  };
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
  const [admins] = await connection.query(
    'SELECT idAdministrador FROM administrador WHERE usuario=? OR usuario LIKE ?',
    [fixture.superUser, `owner_catalogo_%_${fixture.marker}`]
  );
  if (admins.length) {
    const placeholders = admins.map(() => '?').join(',');
    await connection.query(`DELETE FROM auditoriaCatalogo WHERE idAdministrador IN (${placeholders})`, admins.map((row) => row.idAdministrador));
  }
  const [stores] = await connection.query('SELECT idTienda FROM tienda WHERE slug LIKE ?', [`tienda-catalogo-%-${fixture.marker}`]);
  for (const store of stores) await cleanupStore(connection, store.idTienda);
  await connection.query('DELETE FROM productoMaestro WHERE nombre LIKE ?', [`%${fixture.marker}%`]);
  await connection.query('DELETE FROM categoriaMaestra WHERE nombre LIKE ?', [`%${fixture.marker}%`]);
  await connection.query('DELETE FROM marcaMaestra WHERE nombre LIKE ?', [`%${fixture.marker}%`]);
  await connection.query('DELETE FROM administrador WHERE usuario=?', [fixture.superUser]);
}

async function workbookFile(marker) {
  const headers = ['nombre', 'marca', 'categoria', 'codigoBarras', 'presentacion', 'contenidoCantidad',
    'contenidoUnidad', 'unidadesPorPaquete', 'permiteVentaPorUnidad', 'permiteVentaPorPaquete', 'descripcion'];
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Catalogo');
  sheet.addRow(headers);
  sheet.addRow([`Importado valido ${marker}`, `Marca importada ${marker}`, `Categoria importada ${marker}`,
    `IMP${marker}`, 'Bolsa', 100, 'g', 1, 'si', 'no', 'Fila valida']);
  sheet.addRow([`Duplicado codigo ${marker}`, '', '', `BAR${marker}`, 'Unidad', '', '', 1, 'si', 'no', 'Duplicado']);
  sheet.addRow(['', '', '', '', '', '', '', 1, 'si', 'no', 'Sin nombre']);
  sheet.getCell('A5').value = { formula: 'CONCAT("Formula","Producto")', result: `Formula ${marker}` };
  for (let column = 2; column <= headers.length; column += 1) sheet.getRow(5).getCell(column).value = '';
  const buffer = await workbook.xlsx.writeBuffer();
  const data = new FormData();
  data.append('archivo', new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  }), `catalogo-${marker}.xlsx`);
  return data;
}

async function main() {
  const config = { ...requireLocalhostDatabase('La prueba del catalogo maestro'), decimalNumbers: true };
  if (!/(prueba|test)/i.test(config.database)) {
    throw new Error('La prueba solo puede ejecutarse sobre una base cuyo nombre contenga prueba o test.');
  }
  const baseUrl = process.env.TEST_BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
  const marker = crypto.randomBytes(6).toString('hex');
  const fixture = { marker, superUser: `super_catalogo_${marker}` };
  const superPassword = `Super-${crypto.randomBytes(12).toString('hex')}!`;
  const sessions = [];
  let connection;

  try {
    connection = await mysql.createConnection(config);
    const [[migration]] = await connection.query(
      "SELECT COUNT(*) total FROM schema_migrations WHERE nombre='006_catalogo_maestro.sql'"
    );
    assert(Number(migration.total) === 1, 'La migracion 006 debe estar aplicada.');
    const superHash = await bcrypt.hash(superPassword, 12);
    const [superResult] = await connection.query(
      "INSERT INTO administrador (idTienda, usuario, password, rol, activo) VALUES (NULL, ?, ?, 'superadmin', 1)",
      [fixture.superUser, superHash]
    );
    fixture.superId = superResult.insertId;

    const superSession = new HttpSession(baseUrl);
    const basicSession = new HttpSession(baseUrl);
    const advancedSession = new HttpSession(baseUrl);
    sessions.push(superSession, basicSession, advancedSession);
    await expect(superSession, '/auth/login', { method: 'POST', body: { usuario: fixture.superUser, password: superPassword } }, 200, 'Login superadmin');

    const basic = storePayload(marker, 'basica', 'basico');
    const advanced = storePayload(marker, 'avanzada', 'avanzado');
    const basicCreated = await expect(superSession, '/api/admin/tiendas', { method: 'POST', body: basic.body }, 201, 'Tienda basica');
    const advancedCreated = await expect(superSession, '/api/admin/tiendas', { method: 'POST', body: advanced.body }, 201, 'Tienda avanzada');
    fixture.basicStore = basicCreated.tienda.idTienda;
    fixture.advancedStore = advancedCreated.tienda.idTienda;
    fixture.basicSubscription = basicCreated.suscripcion.idSuscripcion;

    await expect(basicSession, '/auth/login', { method: 'POST', body: { usuario: basic.body.propietario.usuario, password: basic.password } }, 200, 'Login basico');
    await expect(advancedSession, '/auth/login', { method: 'POST', body: { usuario: advanced.body.propietario.usuario, password: advanced.password } }, 200, 'Login avanzado');
    await expect(basicSession, '/api/admin/catalogo/resumen', {}, 403, 'Dueno bloqueado del catalogo administrativo');

    const category = await expect(superSession, '/api/admin/catalogo/categorias', {
      method: 'POST', body: { nombre: `Categoria ${marker}` }
    }, 201, 'Crear categoria');
    const brand = await expect(superSession, '/api/admin/catalogo/marcas', {
      method: 'POST', body: { nombre: `Marca ${marker}` }
    }, 201, 'Crear marca');
    const masterPayload = {
      nombre: `Producto maestro ${marker}`,
      idCategoriaMaestra: category.id,
      idMarcaMaestra: brand.id,
      codigoBarras: `BAR${marker}`,
      presentacion: 'Paquete',
      contenidoCantidad: 12,
      contenidoUnidad: 'unidades',
      unidadesPorPaquete: 12,
      permiteVentaPorUnidad: true,
      permiteVentaPorPaquete: true,
      activo: true
    };
    const master = await expect(superSession, '/api/admin/catalogo/productos', {
      method: 'POST', body: masterPayload
    }, 201, 'Crear producto maestro');
    fixture.masterId = master.idProductoMaestro;
    await expect(superSession, '/api/admin/catalogo/productos', {
      method: 'POST', body: { ...masterPayload, nombre: `Otro ${marker}` }
    }, 409, 'Codigo de barras duplicado');
    await expect(superSession, '/api/admin/catalogo/productos', {
      method: 'POST', body: { ...masterPayload, codigoBarras: null }
    }, 409, 'Posible duplicado sin codigo');

    const basicCatalog = await expect(basicSession, `/api/catalogo-maestro?q=${marker}`, {}, 200, 'Busqueda plan basico');
    const advancedCatalog = await expect(advancedSession, `/api/catalogo-maestro?q=${marker}`, {}, 200, 'Busqueda plan avanzado');
    assert(basicCatalog.rows.length === 1 && advancedCatalog.rows.length === 1, 'Los planes no reciben el mismo catalogo maestro.');
    assert(!Object.prototype.hasOwnProperty.call(advancedCatalog.rows[0], 'precioVenta'), 'El catalogo expuso precios comerciales.');

    const [provider] = await connection.query(
      'INSERT INTO proveedor (idTienda, nombre) VALUES (?, ?)',
      [fixture.advancedStore, `Proveedor cruzado ${marker}`]
    );
    const localInput = {
      idProductoMaestro: fixture.masterId,
      nombreLocal: `Nombre local ${marker}`,
      categoriaLocal: 'BEBIDAS',
      precioCompra: 5,
      precioVenta: 8,
      stockInicial: 24,
      stockMinimo: 4,
      unidadesPorPaquete: 12,
      permiteVentaPorUnidad: true,
      permiteVentaPorPaquete: true,
      activo: true
    };
    await expect(basicSession, '/api/catalogo-maestro/agregar', {
      method: 'POST', body: { items: [{ ...localInput, idProveedor: provider.insertId }] }
    }, 400, 'Proveedor de otra tienda rechazado');
    const added = await expect(basicSession, '/api/catalogo-maestro/agregar', {
      method: 'POST', body: { items: [localInput] }
    }, 201, 'Agregar maestro a tienda A');
    fixture.localProduct = added.creados[0].idProducto;
    const [[local]] = await connection.query(
      'SELECT idTienda, idProductoMaestro, nombre, precioVenta, stockUnidadesTotal FROM producto WHERE idProducto=?',
      [fixture.localProduct]
    );
    assert(Number(local.idTienda) === Number(fixture.basicStore) && Number(local.idProductoMaestro) === Number(fixture.masterId), 'El producto local no conserva tienda y maestro.');
    assert(Number(local.precioVenta) === 8 && Number(local.stockUnidadesTotal) === 24, 'Precio o stock local incorrecto.');
    await expect(basicSession, '/api/catalogo-maestro/agregar', {
      method: 'POST', body: { items: [localInput] }
    }, 409, 'Vinculo duplicado rechazado');
    const marked = await expect(basicSession, `/api/catalogo-maestro?q=${marker}`, {}, 200, 'Maestro marcado como agregado');
    assert(Number(marked.rows[0].agregadoEnTienda) === 1, 'La tienda A no ve el producto como agregado.');
    const isolated = await expect(advancedSession, `/api/catalogo-maestro?q=${marker}`, {}, 200, 'Catalogo aislado tienda B');
    assert(Number(isolated.rows[0].agregadoEnTienda) === 0 && isolated.rows[0].idProductoLocal === null, 'La tienda B recibio datos locales de la tienda A.');

    await expect(superSession, `/api/admin/catalogo/productos/${fixture.masterId}`, {
      method: 'PUT', body: { ...masterPayload, nombre: `Producto maestro editado ${marker}` }
    }, 200, 'Editar producto maestro');
    const [[unchangedLocal]] = await connection.query('SELECT nombre, precioVenta FROM producto WHERE idProducto=?', [fixture.localProduct]);
    assert(unchangedLocal.nombre === `Nombre local ${marker}` && Number(unchangedLocal.precioVenta) === 8,
      'Editar el maestro modifico el producto local.');

    await expect(basicSession, '/api/productos', {
      method: 'POST', body: {
        nombre: `Manual ${marker}`, categoria: 'OTROS', unidadMedida: 'unidad', unidadesPorPaquete: 1,
        paquetesPorCaja: 1, precioVenta: 2, stockMinimo: 1, stockUnidadesTotal: 0,
        permiteVentaPorPaquete: false, permiteVentaPorUnidad: true
      }
    }, 201, 'Alta manual conserva funcionamiento');

    const preview = await expect(superSession, '/api/admin/catalogo/importaciones/previsualizar', {
      method: 'POST', body: await workbookFile(marker)
    }, 200, 'Previsualizar Excel');
    assert(preview.validos === 1 && preview.duplicados >= 1 && preview.invalidos >= 1, 'La previsualizacion Excel no clasifico las filas.');
    await expect(basicSession, '/api/admin/catalogo/importaciones/previsualizar', {
      method: 'POST', body: await workbookFile(marker)
    }, 403, 'Dueno bloqueado de importacion');
    const validRows = preview.filas.filter((row) => row.valido).map((row) => {
      const copy = { ...row };
      delete copy.valido; delete copy.duplicado; delete copy.errores; delete copy.coincidencias;
      return copy;
    });
    const imported = await expect(superSession, '/api/admin/catalogo/importaciones/confirmar', {
      method: 'POST', body: { filas: validRows }
    }, 201, 'Confirmar importacion');
    assert(imported.creados === 1, 'La importacion no creo la fila valida seleccionada.');
    const oversized = new FormData();
    oversized.append('archivo', new Blob([Buffer.alloc(5 * 1024 * 1024 + 1)]), `grande-${marker}.xlsx`);
    await expect(superSession, '/api/admin/catalogo/importaciones/previsualizar', {
      method: 'POST', body: oversized
    }, 413, 'Archivo fuera de limite');

    await expect(superSession, `/api/admin/catalogo/productos/${fixture.masterId}/estado`, {
      method: 'PATCH', body: { activo: false }
    }, 200, 'Desactivar maestro');
    await expect(advancedSession, '/api/catalogo-maestro/agregar', {
      method: 'POST', body: { items: [{ ...localInput, nombreLocal: `Avanzado ${marker}` }] }
    }, 409, 'Maestro inactivo no se agrega');
    const [[linkedAfterDisable]] = await connection.query('SELECT COUNT(*) total FROM producto WHERE idProducto=? AND idProductoMaestro=?', [fixture.localProduct, fixture.masterId]);
    assert(Number(linkedAfterDisable.total) === 1, 'Desactivar el maestro elimino el vinculo local.');

    const currentCount = await connection.query('SELECT COUNT(*) total FROM producto WHERE idTienda=?', [fixture.basicStore]);
    const remaining = 500 - Number(currentCount[0][0].total);
    if (remaining > 0) {
      const fechaInicioSeguimiento = formatLocalDateTime();
      const rows = Array.from({ length: remaining }, (_, index) => [
        fixture.basicStore, `Limite catalogo ${marker} ${index}`, 1, 1, 0, 1, fechaInicioSeguimiento
      ]);
      const placeholders = rows.map(() => '(?,?,?,?,?,?,?)').join(',');
      await connection.query(
        `INSERT INTO producto
           (idTienda, nombre, precioVenta, unidadesPorPaquete, permiteVentaPorPaquete,
            permiteVentaPorUnidad, fechaInicioSeguimiento)
         VALUES ${placeholders}`,
        rows.flat()
      );
    }
    await expect(basicSession, '/api/productos', {
      method: 'POST', body: {
        nombre: `Supera limite ${marker}`, categoria: 'OTROS', unidadMedida: 'unidad', unidadesPorPaquete: 1,
        paquetesPorCaja: 1, precioVenta: 2, stockMinimo: 1, stockUnidadesTotal: 0,
        permiteVentaPorPaquete: false, permiteVentaPorUnidad: true
      }
    }, 409, 'Limite basico de productos');

    await connection.query(
      `UPDATE suscripcionTienda SET estado='activa', fechaInicio=DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 30 DAY),
       fechaFin=DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 1 DAY) WHERE idSuscripcion=?`,
      [fixture.basicSubscription]
    );
    await expect(basicSession, '/api/catalogo-maestro', {}, 200, 'Suscripcion vencida consulta catalogo');
    await expect(basicSession, '/api/catalogo-maestro/agregar', {
      method: 'POST', body: { items: [localInput] }
    }, 403, 'Suscripcion vencida bloquea alta');

    console.log('Prueba de catalogo maestro completada correctamente.');
  } finally {
    for (const session of sessions) {
      try { await session.request('/auth/logout', { method: 'POST' }); } catch { /* El servidor puede estar detenido. */ }
    }
    try { await cleanup(connection, fixture); } finally { if (connection) await connection.end(); }
  }
}

main().catch((error) => {
  console.error('La prueba del catalogo maestro fallo.');
  console.error(error.message);
  process.exit(1);
});
