const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../config/db');
const { requirePlanFeature } = require('../middleware/subscription');
const {
  MOVEMENT_ORIGINS,
  MOVEMENT_TYPES,
  cleanText,
  insertStockMovement,
  logRejectedStockAction,
  movementKey,
  operationKey,
  stockError
} = require('../services/stock-movement-service');
const {
  applyLotExit,
  assertReconciled,
  createLotEntries,
  lockLots,
  lockProduct,
  normalizeLotEntries,
  prepareLotExit
} = require('../services/lot-service');
const { formatLocalDateTime } = require('../utils/local-datetime');
const { administrativeAuditService } = require('../services/administrative-audit-service');
const { createInventoryAdjustmentService } = require('../services/inventory-adjustment-service');

const router = express.Router();
const inventoryAdjustmentService = createInventoryAdjustmentService({
  database: pool,
  audit: administrativeAuditService
});
const ADJUSTMENT_WINDOW_MS = 10 * 60 * 1000;
const ADJUSTMENT_BLOCK_MS = 15 * 60 * 1000;
const MAX_PASSWORD_ATTEMPTS = 5;

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function parseId(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) throw stockError(400, `${label} no es valido.`);
  return number;
}

async function hasCanonicalInventoryAdjustments() {
  const [[row]] = await pool.query(
    `SELECT COUNT(*) total
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ajusteInventario'`
  );
  return Number(row.total) === 1;
}

function pagination(query) {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, Number.parseInt(query.limit, 10) || 25));
  return { page, limit, offset: (page - 1) * limit };
}

function validDate(value, label) {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) throw stockError(400, `${label} no es valida.`);
  return String(value);
}

function movementFilters(query, { productId = null } = {}) {
  const conditions = ['ms.idTienda=?'];
  const params = [];
  if (productId) {
    conditions.push('ms.idProducto=?');
    params.push(productId);
  }
  if (query.tipo) {
    if (!MOVEMENT_TYPES.has(query.tipo)) throw stockError(400, 'El tipo de movimiento no es valido.');
    conditions.push('ms.tipoMovimiento=?');
    params.push(query.tipo);
  }
  if (query.origen) {
    if (!MOVEMENT_ORIGINS.has(query.origen)) throw stockError(400, 'El origen del movimiento no es valido.');
    conditions.push('ms.origen=?');
    params.push(query.origen);
  }
  const desde = validDate(query.desde, 'La fecha inicial');
  const hasta = validDate(query.hasta, 'La fecha final');
  if (desde && hasta && desde > hasta) throw stockError(400, 'La fecha inicial no puede ser posterior a la fecha final.');
  if (desde) {
    conditions.push('DATE(ms.creadoEn)>=?');
    params.push(desde);
  }
  if (hasta) {
    conditions.push('DATE(ms.creadoEn)<=?');
    params.push(hasta);
  }
  if (query.idAdministrador) {
    conditions.push('ms.idAdministrador=?');
    params.push(parseId(query.idAdministrador, 'El responsable'));
  }
  if (query.q) {
    conditions.push('UPPER(p.nombre) LIKE ?');
    params.push(`%${String(query.q).trim().toUpperCase().slice(0, 100)}%`);
  }
  return { conditions, params };
}

function movementQuery(where) {
  return `SELECT ms.idMovimientoStock, ms.idProducto, p.nombre producto,
      ms.tipoMovimiento, ms.origen, ms.cantidad, ms.stockAnterior, ms.stockPosterior,
      ms.cantidadOperacion, ms.unidadOperacion, ms.motivo, ms.observacion,
      ms.referenciaTipo, ms.referenciaId, ms.creadoEn,
      a.usuario responsable, dv.idVenta, dc.idCompra
    FROM movimientoStock ms
    JOIN producto p ON p.idProducto=ms.idProducto AND p.idTienda=ms.idTienda
    LEFT JOIN administrador a ON a.idAdministrador=ms.idAdministrador AND a.idTienda=ms.idTienda
    LEFT JOIN detalleVenta dv ON dv.idDetalleVenta=ms.idDetalleVenta AND dv.idTienda=ms.idTienda
    LEFT JOIN detalleCompra dc ON dc.idDetalleCompra=ms.idDetalleCompra AND dc.idTienda=ms.idTienda
    WHERE ${where}`;
}

function passwordGuard(req) {
  const now = Date.now();
  const current = req.session.stockAdjustmentGuard || { attempts: 0, firstAttemptAt: now, blockedUntil: 0 };
  if (current.blockedUntil > now) {
    throw stockError(429, 'No se pudo confirmar la identidad. Intenta nuevamente mas tarde.', 'ADJUSTMENT_RATE_LIMIT');
  }
  if (now - current.firstAttemptAt > ADJUSTMENT_WINDOW_MS) {
    return { attempts: 0, firstAttemptAt: now, blockedUntil: 0 };
  }
  return current;
}

function registerPasswordFailure(req, guard) {
  const attempts = guard.attempts + 1;
  req.session.stockAdjustmentGuard = {
    attempts,
    firstAttemptAt: guard.firstAttemptAt,
    blockedUntil: attempts >= MAX_PASSWORD_ATTEMPTS ? Date.now() + ADJUSTMENT_BLOCK_MS : 0
  };
}

router.get('/movimientos-stock', requirePlanFeature('historial_stock'), asyncRoute(async (req, res) => {
  const idTienda = req.tenant.idTienda;
  const { page, limit, offset } = pagination(req.query);
  const { conditions, params } = movementFilters(req.query);
  const where = conditions.join(' AND ');
  const queryParams = [idTienda, ...params];
  const [[count], [rows], [responsables]] = await Promise.all([
    pool.query(
      `SELECT COUNT(*) total FROM movimientoStock ms
       JOIN producto p ON p.idProducto=ms.idProducto AND p.idTienda=ms.idTienda
       WHERE ${where}`,
      queryParams
    ),
    pool.query(
      `${movementQuery(where)} ORDER BY ms.creadoEn DESC, ms.idMovimientoStock DESC LIMIT ? OFFSET ?`,
      [...queryParams, limit, offset]
    ),
    pool.query(
      `SELECT DISTINCT a.idAdministrador, a.usuario
       FROM movimientoStock ms
       JOIN administrador a ON a.idAdministrador=ms.idAdministrador AND a.idTienda=ms.idTienda
       WHERE ms.idTienda=? ORDER BY a.usuario`,
      [idTienda]
    )
  ]);
  const total = Number(count[0].total);
  res.json({ rows, responsables, page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) });
}));

router.get('/productos/:idProducto/movimientos', requirePlanFeature('historial_stock'), asyncRoute(async (req, res) => {
  const idTienda = req.tenant.idTienda;
  const idProducto = parseId(req.params.idProducto, 'El producto');
  const [products] = await pool.query(
    'SELECT idProducto, nombre, stockUnidadesTotal FROM producto WHERE idProducto=? AND idTienda=?',
    [idProducto, idTienda]
  );
  if (!products.length) throw stockError(404, 'Producto no encontrado.');
  const { page, limit, offset } = pagination(req.query);
  const { conditions, params } = movementFilters(req.query, { productId: idProducto });
  const where = conditions.join(' AND ');
  const queryParams = [idTienda, ...params];
  const [[count], [rows]] = await Promise.all([
    pool.query(`SELECT COUNT(*) total FROM movimientoStock ms JOIN producto p ON p.idProducto=ms.idProducto AND p.idTienda=ms.idTienda WHERE ${where}`, queryParams),
    pool.query(`${movementQuery(where)} ORDER BY ms.creadoEn DESC, ms.idMovimientoStock DESC LIMIT ? OFFSET ?`, [...queryParams, limit, offset])
  ]);
  const total = Number(count[0].total);
  res.json({ producto: products[0], rows, page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) });
}));

router.post('/productos/:idProducto/ajustar-stock', requirePlanFeature('ajuste_stock'), asyncRoute(async (req, res) => {
  const idTienda = req.tenant.idTienda;
  const idAdministrador = Number(req.session.admin.id);
  const idProducto = parseId(req.params.idProducto, 'El producto');
  if (await hasCanonicalInventoryAdjustments()) {
    const result = await inventoryAdjustmentService.applyAdjustment({
      idTienda,
      idAdministrador,
      idProducto,
      requestId: req.requestId
    }, { ...(req.body || {}), idProducto });
    return res.status(result.repetida ? 200 : 201).json({
      message: result.repetida
        ? 'El ajuste ya habia sido aplicado.'
        : 'Ajuste de inventario aplicado.',
      ajuste: result
    });
  }
  const nuevoStock = Number(req.body.nuevoStock);
  const motivo = cleanText(req.body.motivo, 160);
  const observacion = cleanText(req.body.observacion, 500);
  const password = String(req.body.password || '');
  const requestKey = operationKey(req.body.claveOperacion);
  if (!Number.isInteger(nuevoStock)) throw stockError(400, 'El nuevo stock debe ser un numero entero igual o mayor a cero.');
  if (nuevoStock < 0) {
    logRejectedStockAction('ajuste_manual', { idTienda, idAdministrador, idProducto, codigo: 'STOCK_NEGATIVO' });
    throw stockError(400, 'El stock no puede ser negativo.');
  }
  if (!motivo || motivo.length < 5) throw stockError(400, 'El motivo debe tener al menos 5 caracteres.');
  if (!password) throw stockError(400, 'Debes ingresar tu contrasena actual.');
  if (password.length > 200) throw stockError(400, 'No se pudo confirmar la identidad.');

  const guard = passwordGuard(req);
  const [admins] = await pool.query(
    `SELECT password FROM administrador
     WHERE idAdministrador=? AND idTienda=? AND rol='dueno_tienda' AND activo=1`,
    [idAdministrador, idTienda]
  );
  const passwordValid = admins.length && await bcrypt.compare(password, admins[0].password);
  if (!passwordValid) {
    registerPasswordFailure(req, guard);
    logRejectedStockAction('ajuste_manual', { idTienda, idAdministrador, idProducto, codigo: 'CONTRASENA_INVALIDA' });
    throw stockError(403, 'No se pudo confirmar la identidad.', 'INVALID_PASSWORD');
  }
  delete req.session.stockAdjustmentGuard;

  const key = movementKey('ajuste', requestKey);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const product = await lockProduct(connection, idTienda, idProducto);
    const [existing] = await connection.query(
      `SELECT idMovimientoStock, stockAnterior, cantidad, stockPosterior
       FROM movimientoStock WHERE idTienda=? AND claveOperacion=? FOR UPDATE`,
      [idTienda, key]
    );
    if (existing.length) {
      await connection.commit();
      return res.json({ message: 'El ajuste ya habia sido registrado.', repetida: true, ...existing[0] });
    }

    const stockAnterior = Number(product.stockUnidadesTotal);
    const diferencia = nuevoStock - stockAnterior;
    if (diferencia === 0) throw stockError(400, 'El nuevo stock debe ser diferente del stock actual.', 'ZERO_STOCK_ADJUSTMENT');
    const operationDate = new Date();
    const operationDateTime = formatLocalDateTime(operationDate);
    let lotExit = null;
    let lotEntries = null;
    if (Number(product.controlaLotes)) {
      const lotMode = String(req.body.modoLotes || '').trim();
      const expectedMode = diferencia > 0 ? 'ajuste_positivo' : 'ajuste_negativo';
      if (lotMode !== expectedMode) {
        throw stockError(409,
          'Este producto controla lotes. Debe registrar un ajuste por lotes de forma explicita.',
          'LOT_ADJUSTMENT_REQUIRED');
      }
      if (diferencia > 0) {
        const currentLots = await lockLots(connection, idTienda, idProducto, product);
        assertReconciled(product, currentLots);
        lotEntries = normalizeLotEntries(req.body.lotes, {
          requiredTotal: diferencia,
          controlsExpiration: Number(product.controlaVencimiento) === 1,
          operationDate
        });
      } else {
        lotExit = await prepareLotExit(connection, { idTienda, product, cantidad: Math.abs(diferencia) });
      }
    }
    const [updated] = await connection.query(
      `UPDATE producto SET stockUnidadesTotal=?, stock=?
       WHERE idProducto=? AND idTienda=? AND activo=1`,
      [nuevoStock, nuevoStock, idProducto, idTienda]
    );
    if (!updated.affectedRows) throw stockError(404, 'Producto no encontrado.');
    const idMovimientoStock = await insertStockMovement(connection, {
      idTienda,
      idProducto,
      tipoMovimiento: diferencia > 0 ? 'ajuste_positivo' : 'ajuste_negativo',
      origen: 'ajuste_manual',
      cantidad: diferencia,
      stockAnterior,
      stockPosterior: nuevoStock,
      cantidadOperacion: Math.abs(diferencia),
      unidadOperacion: 'unidad_base',
      motivo,
      observacion,
      referenciaTipo: 'ajuste_manual',
      referenciaId: idProducto,
      claveOperacion: key,
      idAdministrador,
      creadoEn: operationDateTime
    });
    if (lotEntries) {
      await createLotEntries(connection, {
        idTienda,
        idProducto,
        entries: lotEntries,
        origen: 'ajuste_positivo',
        operation: `adjustment:${requestKey}`,
        detailIndex: 1,
        creadoEn: operationDateTime,
        idMovimientoStock,
        idAdministrador
      });
    }
    await applyLotExit(connection, {
      prepared: lotExit,
      idTienda,
      idProducto,
      idMovimientoStock,
      operation: `adjustment:${requestKey}`,
      detailIndex: 1,
      creadoEn: operationDateTime,
      idAdministrador
    });
    await administrativeAuditService.recordCritical(connection, {
      storeId: idTienda,
      actorType: 'administrador',
      administratorId: idAdministrador,
      action: 'ajuste_stock',
      result: 'correcto',
      resultCode: 'COMMERCIAL_OPERATION_OK',
      origin: 'web',
      reference: `producto:${idProducto}`,
      requestId: req.requestId,
      before: { stock: stockAnterior },
      after: { stock: nuevoStock }
    });
    await connection.commit();
    res.status(201).json({
      message: 'Stock ajustado correctamente.',
      idMovimientoStock,
      stockAnterior,
      diferencia,
      stockPosterior: nuevoStock
    });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}));

module.exports = router;
