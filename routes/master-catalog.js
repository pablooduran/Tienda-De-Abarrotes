const express = require('express');
const pool = require('../config/db');
const { requirePlanFeature } = require('../middleware/subscription');
const { enforcePlanLimit } = require('../services/subscription-service');
const {
  LOCAL_CATEGORIES,
  booleanValue,
  catalogError,
  cleanText,
  normalizeText,
  parseId,
  positiveInteger
} = require('../services/master-catalog-service');

const router = express.Router();
const UNIT_MEASURES = new Set(['unidad', 'paquete', 'kilo', 'gramo', 'litro', 'mililitro', 'caja', 'docena', 'bolsa']);

router.use(requirePlanFeature('catalogo_maestro'));

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function pagination(query) {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const limit = Math.min(50, Math.max(1, Number.parseInt(query.limit, 10) || 20));
  return { page, limit, offset: (page - 1) * limit };
}

function nonNegativeNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw catalogError(400, `${label} debe ser igual o mayor a cero.`);
  return number;
}

function positiveMoney(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw catalogError(400, `${label} debe ser mayor a cero.`);
  return number;
}

function nonNegativeInteger(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) throw catalogError(400, `${label} debe ser un entero igual o mayor a cero.`);
  return number;
}

function localCategory(value, suggested) {
  const normalized = normalizeText(value || suggested || 'OTROS').toUpperCase();
  return LOCAL_CATEGORIES.includes(normalized) ? normalized : 'OTROS';
}

router.get('/categorias', asyncRoute(async (req, res) => {
  const [rows] = await pool.query(
    'SELECT idCategoriaMaestra, nombre FROM categoriaMaestra WHERE activo=1 ORDER BY nombre'
  );
  res.json(rows);
}));

router.get('/marcas', asyncRoute(async (req, res) => {
  const [rows] = await pool.query(
    'SELECT idMarcaMaestra, nombre FROM marcaMaestra WHERE activo=1 ORDER BY nombre'
  );
  res.json(rows);
}));

router.get('/', asyncRoute(async (req, res) => {
  const idTienda = req.tenant.idTienda;
  const { page, limit, offset } = pagination(req.query);
  const conditions = ['pm.activo=1'];
  const params = [];
  const search = normalizeText(req.query.q || '');
  if (search) {
    conditions.push('(pm.nombreNormalizado LIKE ? OR m.nombreNormalizado LIKE ? OR pm.codigoBarras LIKE ? OR pm.presentacion LIKE ?)');
    const barcodeSearch = cleanText(req.query.q, 64).replace(/\s+/g, '').toUpperCase();
    params.push(`%${search}%`, `%${search}%`, `%${barcodeSearch}%`, `%${cleanText(req.query.q, 60)}%`);
  }
  if (req.query.idCategoriaMaestra) {
    conditions.push('pm.idCategoriaMaestra=?');
    params.push(parseId(req.query.idCategoriaMaestra, 'La categoria'));
  }
  if (req.query.idMarcaMaestra) {
    conditions.push('pm.idMarcaMaestra=?');
    params.push(parseId(req.query.idMarcaMaestra, 'La marca'));
  }
  if (req.query.presentacion) {
    conditions.push('pm.presentacion=?');
    params.push(cleanText(req.query.presentacion, 60));
  }
  const where = `WHERE ${conditions.join(' AND ')}`;
  const [[count], [rows]] = await Promise.all([
    pool.query(
      `SELECT COUNT(*) total FROM productoMaestro pm
       LEFT JOIN marcaMaestra m ON m.idMarcaMaestra=pm.idMarcaMaestra ${where}`,
      params
    ),
    pool.query(
      `SELECT pm.idProductoMaestro, pm.nombre, pm.descripcion, pm.codigoBarras, pm.presentacion,
         pm.contenidoCantidad, pm.contenidoUnidad, pm.unidadesPorPaquete,
         pm.permiteVentaPorUnidad, pm.permiteVentaPorPaquete,
         c.nombre categoriaMaestra, m.nombre marca,
         CASE WHEN p.idProducto IS NULL THEN 0 ELSE 1 END agregadoEnTienda,
         p.idProducto idProductoLocal
       FROM productoMaestro pm
       LEFT JOIN categoriaMaestra c ON c.idCategoriaMaestra=pm.idCategoriaMaestra
       LEFT JOIN marcaMaestra m ON m.idMarcaMaestra=pm.idMarcaMaestra
       LEFT JOIN producto p ON p.idProductoMaestro=pm.idProductoMaestro AND p.idTienda=?
       ${where} ORDER BY pm.nombre LIMIT ? OFFSET ?`,
      [idTienda, ...params, limit, offset]
    )
  ]);
  const total = Number(count[0].total);
  res.json({ rows, page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) });
}));

router.get('/:idProductoMaestro', asyncRoute(async (req, res) => {
  const id = parseId(req.params.idProductoMaestro, 'El producto maestro');
  const [rows] = await pool.query(
    `SELECT pm.idProductoMaestro, pm.nombre, pm.descripcion, pm.codigoBarras, pm.presentacion,
       pm.contenidoCantidad, pm.contenidoUnidad, pm.unidadesPorPaquete,
       pm.permiteVentaPorUnidad, pm.permiteVentaPorPaquete,
       c.nombre categoriaMaestra, m.nombre marca,
       CASE WHEN p.idProducto IS NULL THEN 0 ELSE 1 END agregadoEnTienda,
       p.idProducto idProductoLocal
     FROM productoMaestro pm
     LEFT JOIN categoriaMaestra c ON c.idCategoriaMaestra=pm.idCategoriaMaestra
     LEFT JOIN marcaMaestra m ON m.idMarcaMaestra=pm.idMarcaMaestra
     LEFT JOIN producto p ON p.idProductoMaestro=pm.idProductoMaestro AND p.idTienda=?
     WHERE pm.idProductoMaestro=? AND pm.activo=1`,
    [req.tenant.idTienda, id]
  );
  if (!rows.length) throw catalogError(404, 'El producto maestro no esta disponible.');
  res.json(rows[0]);
}));

router.post('/agregar', asyncRoute(async (req, res) => {
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  if (!items.length || items.length > 50) throw catalogError(400, 'Debe seleccionar entre 1 y 50 productos.');
  const ids = items.map((item) => parseId(item.idProductoMaestro, 'El producto maestro'));
  if (new Set(ids).size !== ids.length) throw catalogError(409, 'La seleccion contiene productos maestros repetidos.');
  const idTienda = req.tenant.idTienda;
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.query('SELECT idTienda FROM tienda WHERE idTienda=? FOR UPDATE', [idTienda]);
    await enforcePlanLimit(connection, idTienda, 'productos', items.length);
    const placeholders = ids.map(() => '?').join(',');
    const [masters] = await connection.query(
      `SELECT pm.*, c.nombre categoriaMaestra
       FROM productoMaestro pm
       LEFT JOIN categoriaMaestra c ON c.idCategoriaMaestra=pm.idCategoriaMaestra
       WHERE pm.idProductoMaestro IN (${placeholders}) AND pm.activo=1 FOR UPDATE`,
      ids
    );
    if (masters.length !== ids.length) throw catalogError(409, 'Uno o mas productos maestros ya no estan disponibles.');
    const masterMap = new Map(masters.map((master) => [Number(master.idProductoMaestro), master]));
    const [existing] = await connection.query(
      `SELECT idProductoMaestro FROM producto
       WHERE idTienda=? AND idProductoMaestro IN (${placeholders})`,
      [idTienda, ...ids]
    );
    if (existing.length) throw catalogError(409, 'Uno o mas productos ya fueron agregados a esta tienda.', 'MASTER_ALREADY_ADDED');

    const providerCache = new Set();
    const created = [];
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      const master = masterMap.get(ids[index]);
      const idProveedor = parseId(item.idProveedor, 'El proveedor');
      if (idProveedor && !providerCache.has(idProveedor)) {
        const [providers] = await connection.query(
          'SELECT idProveedor FROM proveedor WHERE idProveedor=? AND idTienda=?',
          [idProveedor, idTienda]
        );
        if (!providers.length) throw catalogError(400, `El proveedor del producto ${index + 1} no pertenece a la tienda.`);
        providerCache.add(idProveedor);
      }
      const unidadesPorPaquete = positiveInteger(
        item.unidadesPorPaquete, 'Unidades por paquete', Number(master.unidadesPorPaquete || 1)
      );
      const permiteVentaPorUnidad = booleanValue(item.permiteVentaPorUnidad, Boolean(master.permiteVentaPorUnidad));
      const permiteVentaPorPaquete = booleanValue(item.permiteVentaPorPaquete, Boolean(master.permiteVentaPorPaquete));
      if (!permiteVentaPorUnidad && !permiteVentaPorPaquete) {
        throw catalogError(400, `El producto ${index + 1} debe permitir alguna forma de venta.`);
      }
      if (permiteVentaPorPaquete && unidadesPorPaquete <= 1) {
        throw catalogError(400, `El producto ${index + 1} requiere mas de una unidad por paquete.`);
      }
      const unidadMedida = cleanText(item.unidadMedida || 'unidad', 30).toLowerCase();
      if (!UNIT_MEASURES.has(unidadMedida)) throw catalogError(400, `La unidad del producto ${index + 1} no es valida.`);
      const nombre = cleanText(item.nombreLocal || master.nombre, 100);
      if (!nombre) throw catalogError(400, `El nombre local del producto ${index + 1} es obligatorio.`);
      const precioCompra = nonNegativeNumber(item.precioCompra ?? 0, `El precio de compra de ${nombre}`);
      const precioVenta = positiveMoney(item.precioVenta, `El precio de venta de ${nombre}`);
      const stock = nonNegativeInteger(item.stockInicial ?? 0, `El stock inicial de ${nombre}`);
      const stockMinimo = positiveInteger(item.stockMinimo, `El stock minimo de ${nombre}`, 5);
      if (!booleanValue(item.activo, true)) {
        throw catalogError(400, `El producto ${index + 1} debe crearse operativo en el inventario actual.`);
      }
      const [result] = await connection.query(
        `INSERT INTO producto
          (idTienda, nombre, idProveedor, idProductoMaestro, categoria, unidadMedida,
           unidadesPorPaquete, paquetesPorCaja, precioVenta, stock, stockMinimo,
           stockUnidadesTotal, ultimoPrecioCompra, permiteVentaPorPaquete, permiteVentaPorUnidad)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)`,
        [idTienda, nombre, idProveedor, master.idProductoMaestro,
          localCategory(item.categoriaLocal, master.categoriaMaestra), unidadMedida,
          unidadesPorPaquete, precioVenta, stock, stockMinimo, stock, precioCompra,
          permiteVentaPorPaquete, permiteVentaPorUnidad]
      );
      created.push({ idProductoMaestro: master.idProductoMaestro, idProducto: result.insertId, nombre });
    }
    await connection.commit();
    res.status(201).json({ message: `${created.length} producto(s) agregado(s) al inventario.`, creados: created });
  } catch (error) {
    await connection.rollback();
    if (error.code === 'ER_DUP_ENTRY') throw catalogError(409, 'Un producto maestro ya esta vinculado a esta tienda.');
    throw error;
  } finally {
    connection.release();
  }
}));

module.exports = router;
