const express = require('express');
const pool = require('../config/db');
const { requirePlanFeature } = require('../middleware/subscription');
const { getSaleReceipt, registerSale } = require('../services/pos-sale-service');
const { formatLocalDate } = require('../utils/local-datetime');

const router = express.Router();

router.use('/pos', requirePlanFeature('punto_venta'));

function tenantId(req) {
  return req.tenant.idTienda;
}

function positiveId(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function pagination(query) {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const limit = Math.min(50, Math.max(1, Number.parseInt(query.limit, 10) || 20));
  return { page, limit, offset: (page - 1) * limit };
}

function customerSearchPagination(query) {
  const rawPage = query.page === undefined ? '1' : String(query.page);
  const rawLimit = query.limit === undefined ? '20' : String(query.limit);
  if (!/^\d+$/.test(rawPage) || !/^\d+$/.test(rawLimit)) return null;
  const page = Number(rawPage);
  const limit = Number(rawLimit);
  if (page < 1 || limit < 1 || limit > 50) return null;
  return { page, limit, offset: (page - 1) * limit };
}

async function listProducts(req, res, next, forcedView = null) {
  try {
    const idTienda = tenantId(req);
    const { page, limit, offset } = pagination(req.query);
    const q = String(req.query.q || '').trim().slice(0, 100);
    const categoria = String(req.query.categoria || '').trim().slice(0, 50);
    const view = forcedView || String(req.query.vista || '').toLowerCase();
    const conditions = ['p.idTienda=?', 'p.activo=1'];
    const params = [idTienda];
    if (q) {
      conditions.push('(p.nombre LIKE ? OR p.codigoBarras=?)');
      params.push(`%${q}%`, q);
    }
    if (categoria) {
      conditions.push('p.categoria=?');
      params.push(categoria);
    }
    if (view === 'favoritos') conditions.push('p.favoritoPos=1');
    let order = 'exactBarcode DESC, p.nombre ASC';
    if (view === 'recientes') order = 'ultimaVenta IS NULL, ultimaVenta DESC, p.nombre';
    if (view === 'mas_vendidos') order = 'unidadesVendidas DESC, p.nombre';
    if (view === 'favoritos') order = 'p.nombre';

    const useStats = ['recientes', 'mas_vendidos'].includes(view);
    const joinStats = useStats ? `
       LEFT JOIN (
         SELECT d.idTienda, d.idProducto, MAX(v.fecha) ultimaVenta,
                SUM(d.cantidadEquivalenteUnidades) unidadesVendidas
         FROM detalleVenta d
         JOIN venta v ON v.idTienda=d.idTienda AND v.idVenta=d.idVenta
         WHERE d.idTienda=?
         GROUP BY d.idTienda, d.idProducto
       ) stats ON stats.idTienda=p.idTienda AND stats.idProducto=p.idProducto` : '';
    const statsColumns = useStats
      ? 'stats.ultimaVenta, COALESCE(stats.unidadesVendidas,0) unidadesVendidas'
      : 'NULL ultimaVenta, 0 unidadesVendidas';
    const queryParams = useStats ? [idTienda, ...params] : params;
    const [rows] = await pool.query(
      `SELECT p.idProducto, p.nombre, p.categoria, p.codigoBarras,
              p.codigoBarras codigoBarrasDisponible,
              p.precioVenta, p.precioVentaPaquete, p.unidadesPorPaquete,
              p.stockUnidadesTotal, p.controlaLotes, p.controlaVencimiento,
              CASE WHEN p.controlaLotes=1 THEN (
                SELECT COALESCE(SUM(l.cantidadRestante),0) FROM loteProducto l
                WHERE l.idTienda=p.idTienda AND l.idProducto=p.idProducto
                  AND l.estadoOperativo='disponible' AND l.cantidadRestante>0
                  AND (l.fechaVencimiento IS NULL OR l.fechaVencimiento>=?)
              ) ELSE p.stockUnidadesTotal END stockVendible,
              p.permiteVentaPorUnidad, p.permiteVentaPorPaquete,
              p.favoritoPos, pr.nombre proveedor,
              ${statsColumns},
              CASE WHEN ?<>'' AND p.codigoBarras=? THEN 1 ELSE 0 END exactBarcode
       FROM producto p
       LEFT JOIN proveedor pr ON pr.idTienda=p.idTienda AND pr.idProveedor=p.idProveedor
       ${joinStats}
       WHERE ${conditions.join(' AND ')}
       ORDER BY ${order}
       LIMIT ? OFFSET ?`,
      [formatLocalDate(), q, q, ...queryParams, limit, offset]
    );
    res.json({ productos: rows, pagina: page, limite: limit, hayMas: rows.length === limit });
  } catch (error) {
    next(error);
  }
}

router.get('/pos/productos', (req, res, next) => listProducts(req, res, next));
router.get('/pos/recientes', (req, res, next) => listProducts(req, res, next, 'recientes'));
router.get('/pos/mas-vendidos', (req, res, next) => listProducts(req, res, next, 'mas_vendidos'));
router.get('/pos/favoritos', (req, res, next) => listProducts(req, res, next, 'favoritos'));

router.get('/pos/productos/:idProducto', async (req, res, next) => {
  try {
    const idProducto = positiveId(req.params.idProducto);
    if (!idProducto) return res.status(400).json({ error: 'Producto no valido.' });
    const [rows] = await pool.query(
      `SELECT p.idProducto, p.nombre, p.categoria, p.codigoBarras,
              p.codigoBarras codigoBarrasDisponible,
              p.precioVenta, p.precioVentaPaquete, p.unidadesPorPaquete,
              p.stockUnidadesTotal, p.controlaLotes, p.controlaVencimiento,
              CASE WHEN p.controlaLotes=1 THEN (
                SELECT COALESCE(SUM(l.cantidadRestante),0) FROM loteProducto l
                WHERE l.idTienda=p.idTienda AND l.idProducto=p.idProducto
                  AND l.estadoOperativo='disponible' AND l.cantidadRestante>0
                  AND (l.fechaVencimiento IS NULL OR l.fechaVencimiento>=?)
              ) ELSE p.stockUnidadesTotal END stockVendible,
              p.permiteVentaPorUnidad, p.permiteVentaPorPaquete,
              p.favoritoPos, pr.nombre proveedor
       FROM producto p
       LEFT JOIN proveedor pr ON pr.idTienda=p.idTienda AND pr.idProveedor=p.idProveedor
       WHERE p.idTienda=? AND p.idProducto=? AND p.activo=1`,
      [formatLocalDate(), tenantId(req), idProducto]
    );
    if (!rows.length) return res.status(404).json({ error: 'Producto no encontrado.' });
    res.json(rows[0]);
  } catch (error) {
    next(error);
  }
});

router.get('/pos/clientes', async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim().slice(0, 100);
    const paginated = req.query.page !== undefined || req.query.limit !== undefined;
    const pageData = paginated ? customerSearchPagination(req.query) : { page: 1, limit: 30, offset: 0 };
    if (!pageData) return res.status(400).json({ error: 'Paginacion de clientes invalida.' });
    const { page, limit, offset } = pageData;
    if (paginated && q.length < 2) {
      return res.json({ clientes: [], pagina: page, limite: limit, total: 0, hayMas: false });
    }
    const params = [tenantId(req)];
    let search = '';
    if (q) {
      search = 'AND (nombre LIKE ? OR telefono LIKE ?)';
      params.push(`%${q}%`, `%${q}%`);
    }
    const [rows] = await pool.query(
      `SELECT idCliente, nombre, telefono, direccion
       FROM cliente WHERE idTienda=? AND activo=1 ${search}
       ORDER BY nombre, idCliente LIMIT ? OFFSET ?`,
      [...params, paginated ? limit : 30, paginated ? offset : 0]
    );
    if (!paginated) return res.json(rows);
    const [[count]] = await pool.query(
      `SELECT COUNT(*) total FROM cliente
       WHERE idTienda=? AND activo=1 ${search}`,
      params
    );
    return res.json({
      clientes: rows,
      pagina: page,
      limite: limit,
      total: Number(count.total),
      hayMas: offset + rows.length < Number(count.total)
    });
  } catch (error) {
    next(error);
  }
});

router.post('/pos/favoritos/:idProducto', async (req, res, next) => {
  try {
    const [result] = await pool.query(
      'UPDATE producto SET favoritoPos=1 WHERE idTienda=? AND idProducto=? AND activo=1',
      [tenantId(req), req.params.idProducto]
    );
    if (!result.affectedRows) return res.status(404).json({ error: 'Producto no encontrado.' });
    res.json({ message: 'Producto agregado a favoritos.' });
  } catch (error) {
    next(error);
  }
});

router.delete('/pos/favoritos/:idProducto', async (req, res, next) => {
  try {
    const [result] = await pool.query(
      'UPDATE producto SET favoritoPos=0 WHERE idTienda=? AND idProducto=? AND activo=1',
      [tenantId(req), req.params.idProducto]
    );
    if (!result.affectedRows) return res.status(404).json({ error: 'Producto no encontrado.' });
    res.json({ message: 'Producto quitado de favoritos.' });
  } catch (error) {
    next(error);
  }
});

router.post('/pos/ventas', async (req, res, next) => {
  try {
    const result = await registerSale({
      idTienda: tenantId(req),
      idAdministrador: req.session.admin.id,
      requestId: req.requestId,
      body: req.body
    });
    const receipt = await getSaleReceipt(tenantId(req), result.idVenta);
    res.status(result.repetida ? 200 : 201).json({
      message: result.repetida ? 'La venta ya habia sido registrada.' : 'Venta registrada.',
      ...result,
      comprobante: receipt
    });
  } catch (error) {
    next(error);
  }
});

router.get('/ventas/:idVenta/comprobante', async (req, res, next) => {
  try {
    res.json(await getSaleReceipt(tenantId(req), req.params.idVenta));
  } catch (error) {
    next(error);
  }
});

router.get('/ventas/:idVenta/pagos', async (req, res, next) => {
  try {
    const receipt = await getSaleReceipt(tenantId(req), req.params.idVenta);
    res.json(receipt.pagos);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
