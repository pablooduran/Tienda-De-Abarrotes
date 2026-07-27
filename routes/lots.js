const express = require('express');
const pool = require('../config/db');
const { requirePlanFeature } = require('../middleware/subscription');
const {
  LOT_STATES,
  createLotEntries,
  databaseLocalDate,
  databaseLocalDateTime,
  existingOperationLots,
  inventoryClassificationExpression,
  lockLots,
  lockProduct,
  normalizeLotEntries,
  operationPart,
  productLotSnapshot,
  supportsInventoryClassification,
  validLocalDate
} = require('../services/lot-service');
const { stockError } = require('../services/stock-movement-service');
const { buildLotExport, lotSummary } = require('../services/lot-export-service');
const { formatLocalDate, formatLocalDateTime } = require('../utils/local-datetime');

const router = express.Router();

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function parseId(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) throw stockError(400, `${label} no es valido.`);
  return number;
}

function optionalBoolean(value, label) {
  if (value === undefined) return undefined;
  if ([true, 1, '1', 'true'].includes(value)) return true;
  if ([false, 0, '0', 'false'].includes(value)) return false;
  throw stockError(400, `${label} no es valido.`);
}

function alertDays(value) {
  if (value === null || value === '') return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > 365) {
    throw stockError(400, 'Los dias de alerta deben estar entre 1 y 365.');
  }
  return number;
}

function pagination(query) {
  const page = Math.max(1, Number.parseInt(query.pagina || query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, Number.parseInt(query.limite || query.limit, 10) || 25));
  return { page, limit, offset: (page - 1) * limit };
}

async function transaction(work) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await work(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

function requireLotReadAccess(featureCode) {
  return asyncRoute(async (req, res, next) => {
    if (req.subscriptionContext?.caracteristicas?.includes(featureCode)) return next();
    const [rows] = await pool.query(
      'SELECT idProducto FROM producto WHERE idTienda=? AND controlaLotes=1 LIMIT 1',
      [req.tenant.idTienda]
    );
    if (rows.length) return next();
    return res.status(403).json({
      error: 'Esta funcion no esta incluida en el plan actual.',
      code: 'PLAN_FEATURE_REQUIRED'
    });
  });
}

router.get('/lotes/acceso', asyncRoute(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT c.diasAlertaVencimientoDefault,
            (SELECT COUNT(*) FROM producto p WHERE p.idTienda=c.idTienda AND p.controlaLotes=1) productosControlados
     FROM configuracionInventarioTienda c WHERE c.idTienda=?`,
    [req.tenant.idTienda]
  );
  res.json({
    productosControlados: Number(rows[0]?.productosControlados || 0),
    diasAlertaVencimientoDefault: Number(rows[0]?.diasAlertaVencimientoDefault || 30)
  });
}));

router.get('/lotes/resumen', requireLotReadAccess('trazabilidad_lotes'), asyncRoute(async (req, res) => {
  res.json(await lotSummary(pool, req.tenant.idTienda, req.query));
}));

router.get('/lotes/exportacion.xlsx', requirePlanFeature('exportacion_lotes'), asyncRoute(async (req, res) => {
  const report = await buildLotExport(pool, req.tenant.idTienda, req.query);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${report.fileName}"`);
  res.setHeader('X-Exported-Rows', String(report.totalExportado));
  res.send(report.buffer);
}));

router.patch('/productos/:id/configuracion-lotes', requirePlanFeature('control_lotes'), asyncRoute(async (req, res) => {
  const idTienda = req.tenant.idTienda;
  const idProducto = parseId(req.params.id, 'El producto');
  const requestedLots = optionalBoolean(req.body.controlaLotes, 'El control de lotes');
  const requestedExpiration = optionalBoolean(req.body.controlaVencimiento, 'El control de vencimiento');
  const requestedAlert = req.body.diasAlertaVencimiento === undefined
    ? undefined : alertDays(req.body.diasAlertaVencimiento);
  const result = await transaction(async (connection) => {
    const product = await lockProduct(connection, idTienda, idProducto);
    const currentlyControlled = Number(product.controlaLotes) === 1;
    const controlsLots = requestedLots === undefined ? currentlyControlled : requestedLots;
    const controlsExpiration = requestedExpiration === undefined
      ? Number(product.controlaVencimiento) === 1 : requestedExpiration;
    if (currentlyControlled && !controlsLots) {
      throw stockError(409, 'No se puede desactivar el control de lotes una vez iniciado el historial.');
    }
    if (controlsExpiration && !controlsLots) {
      throw stockError(400, 'El control de vencimiento requiere control de lotes.');
    }
    if (!currentlyControlled && controlsLots && Number(product.stockUnidadesTotal) > 0) {
      throw stockError(409,
        'El producto tiene stock existente. Use la distribucion inicial para activar el control de lotes.',
        'INITIAL_LOT_DISTRIBUTION_REQUIRED');
    }
    if (controlsExpiration && !Number(product.controlaVencimiento)) {
      const [missingExpiration] = await connection.query(
        `SELECT idLoteProducto FROM loteProducto
         WHERE idTienda=? AND idProducto=? AND estadoOperativo<>'anulado'
           AND cantidadRestante>0 AND fechaVencimiento IS NULL LIMIT 1 FOR UPDATE`,
        [idTienda, idProducto]
      );
      if (missingExpiration.length) {
        throw stockError(409, 'Debe regularizar el vencimiento de todos los lotes con saldo antes de activar esta opcion.');
      }
    }
    const activatedAt = controlsLots ? (product.lotesActivadosEn || formatLocalDateTime()) : null;
    const alert = requestedAlert === undefined ? product.diasAlertaVencimiento : requestedAlert;
    await connection.query(
      `UPDATE producto SET controlaLotes=?, controlaVencimiento=?, diasAlertaVencimiento=?, lotesActivadosEn=?
       WHERE idTienda=? AND idProducto=?`,
      [controlsLots ? 1 : 0, controlsExpiration ? 1 : 0, alert, activatedAt, idTienda, idProducto]
    );
    return {
      idProducto,
      controlaLotes: controlsLots,
      controlaVencimiento: controlsExpiration,
      diasAlertaVencimiento: alert,
      lotesActivadosEn: activatedAt
    };
  });
  res.json({ message: 'Configuracion de lotes actualizada.', ...result });
}));

router.post('/lotes/distribucion-inicial', requirePlanFeature('control_lotes'), asyncRoute(async (req, res) => {
  const idTienda = req.tenant.idTienda;
  const idAdministrador = Number(req.session.admin.id);
  const idProducto = parseId(req.body.idProducto, 'El producto');
  const operation = operationPart(req.body.claveOperacion);
  const lotOperation = `distribution:${operation}`;
  const rawLots = req.body.lotes;
  const controlsExpiration = optionalBoolean(req.body.controlaVencimiento, 'El control de vencimiento') || false;
  const days = req.body.diasAlertaVencimiento === undefined ? null : alertDays(req.body.diasAlertaVencimiento);
  const result = await transaction(async (connection) => {
    const product = await lockProduct(connection, idTienda, idProducto);
    const operationDate = new Date();
    const operationDateTime = formatLocalDateTime(operationDate);
    if (!Array.isArray(rawLots) || !rawLots.length) throw stockError(400, 'Debe indicar los lotes de la distribucion inicial.');
    const entries = normalizeLotEntries(rawLots, {
      requiredTotal: null, controlsExpiration, operationDate
    });
    const repeated = await existingOperationLots(connection, {
      idTienda, idProducto, operation: lotOperation, detailIndex: 0, entries
    });
    if (repeated) {
      if (Number(product.controlaVencimiento) !== (controlsExpiration ? 1 : 0)
        || (days ?? null) !== (product.diasAlertaVencimiento ?? null)) {
        throw stockError(409, 'La clave de operacion ya fue utilizada con otra configuracion de lotes.');
      }
      return { idProducto, lotes: repeated, repetida: true };
    }
    if (Number(product.controlaLotes)) throw stockError(409, 'El producto ya tiene control de lotes activo.');
    if (Number(product.stockUnidadesTotal) <= 0) {
      throw stockError(400, 'La distribucion inicial se utiliza solo para productos con stock existente.');
    }
    const distributedTotal = entries.reduce((sum, entry) => sum + entry.quantity, 0);
    if (distributedTotal !== Number(product.stockUnidadesTotal)) {
      throw stockError(400,
        `La distribucion de lotes debe sumar exactamente ${product.stockUnidadesTotal} unidades base.`);
    }
    const history = await lockLots(connection, idTienda, idProducto, product);
    if (history.length) throw stockError(409, 'El producto ya tiene historial de lotes.');
    const created = await createLotEntries(connection, {
      idTienda,
      idProducto,
      entries,
      origen: 'distribucion_inicial',
      operation: lotOperation,
      detailIndex: 0,
      creadoEn: operationDateTime,
      idAdministrador
    });
    await connection.query(
      `UPDATE producto
       SET controlaLotes=1, controlaVencimiento=?, diasAlertaVencimiento=?, lotesActivadosEn=?
       WHERE idTienda=? AND idProducto=? AND controlaLotes=0`,
      [controlsExpiration ? 1 : 0, days, operationDateTime, idTienda, idProducto]
    );
    return { idProducto, lotes: created, lotesActivadosEn: operationDateTime, repetida: false };
  });
  res.status(result.repetida ? 200 : 201).json({
    message: result.repetida ? 'La distribucion ya habia sido registrada.' : 'Distribucion inicial registrada.',
    ...result
  });
}));

router.get('/lotes/alertas', requirePlanFeature('alertas_vencimiento'), asyncRoute(async (req, res) => {
  const idTienda = req.tenant.idTienda;
  const today = formatLocalDate();
  const { page, limit, offset } = pagination(req.query);
  const conditions = ["l.idTienda=?", "p.controlaLotes=1", "l.estadoOperativo<>'anulado'"];
  const params = [idTienda];
  if (req.query.producto) {
    conditions.push('l.idProducto=?');
    params.push(parseId(req.query.producto, 'El producto'));
  }
  const hasClassification = await supportsInventoryClassification(pool);
  const inventoryClassification = inventoryClassificationExpression(hasClassification);
  const classification = `CASE
    WHEN ${inventoryClassification}='tecnico' THEN 'tecnico'
    WHEN ${inventoryClassification}='aislado' THEN 'aislado'
    WHEN ${inventoryClassification}='bloqueado' THEN 'bloqueado'
    WHEN l.cantidadRestante=0 THEN 'agotado'
    WHEN l.fechaVencimiento<? THEN 'vencido'
    WHEN l.fechaVencimiento=? THEN 'vence_hoy'
    WHEN l.fechaVencimiento<=DATE_ADD(?, INTERVAL COALESCE(p.diasAlertaVencimiento,c.diasAlertaVencimientoDefault) DAY)
      THEN 'proximo_a_vencer'
    ELSE 'vigente' END`;
  const baseParams = [today, today, today, ...params];
  const from = `FROM loteProducto l
    JOIN producto p ON p.idTienda=l.idTienda AND p.idProducto=l.idProducto
    JOIN configuracionInventarioTienda c ON c.idTienda=l.idTienda
    LEFT JOIN proveedor pr ON pr.idTienda=l.idTienda AND pr.idProveedor=l.idProveedor
    WHERE ${conditions.join(' AND ')}`;
  const [[count], [rows]] = await Promise.all([
    pool.query(`SELECT COUNT(*) total ${from}`, params),
    pool.query(
      `SELECT l.idLoteProducto, l.idProducto, p.nombre producto, p.categoria, pr.nombre proveedor,
              l.codigoLote, l.fechaIngreso, l.fechaVencimiento, l.cantidadInicial, l.cantidadRestante,
              CAST(l.costoUnitarioBase AS CHAR) costoUnitarioBase,
              CASE WHEN l.costoUnitarioBase IS NULL THEN NULL
                   ELSE ROUND(l.cantidadRestante*l.costoUnitarioBase,2) END valorRestante,
              l.estadoOperativo, ${inventoryClassification} clasificacionInventario,
              ${classification} estadoCalculado
       ${from}
       ORDER BY FIELD(estadoCalculado,'vencido','vence_hoy','proximo_a_vencer','bloqueado','aislado','tecnico','agotado','vigente'),
                l.fechaVencimiento, l.idLoteProducto LIMIT ? OFFSET ?`,
      [...baseParams, limit, offset]
    )
  ]);
  const total = Number(count[0].total);
  res.json({ rows, page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) });
}));

router.get('/productos/:id/lotes-disponibles', requireLotReadAccess('trazabilidad_lotes'), asyncRoute(async (req, res) => {
  const idTienda = req.tenant.idTienda;
  const snapshot = await productLotSnapshot(pool, idTienda, parseId(req.params.id, 'El producto'));
  const today = formatLocalDate();
  const lots = snapshot.lots.map((lot) => ({
    ...lot,
    vendible: lot.estadoOperativo === 'disponible'
      && lot.clasificacionInventario === 'vendible'
      && Number(lot.cantidadRestante) > 0
      && (!lot.fechaVencimiento || databaseLocalDate(lot.fechaVencimiento) >= today),
    motivoNoVendible: lot.clasificacionInventario === 'tecnico' ? 'tecnico'
      : lot.clasificacionInventario === 'aislado' ? 'aislado'
        : lot.estadoOperativo === 'bloqueado' ? 'bloqueado'
      : Number(lot.cantidadRestante) <= 0 ? 'agotado'
        : lot.fechaVencimiento && databaseLocalDate(lot.fechaVencimiento) < today ? 'vencido' : null
  })).sort((a, b) => {
    if (Number(snapshot.product.controlaVencimiento)) {
      const dateA = a.fechaVencimiento ? databaseLocalDate(a.fechaVencimiento) : '9999-12-31';
      const dateB = b.fechaVencimiento ? databaseLocalDate(b.fechaVencimiento) : '9999-12-31';
      if (dateA !== dateB) return dateA.localeCompare(dateB);
    }
    return databaseLocalDateTime(a.fechaIngreso).localeCompare(databaseLocalDateTime(b.fechaIngreso))
      || Number(a.idLoteProducto) - Number(b.idLoteProducto);
  });
  res.json({ producto: snapshot.product, ...snapshot.balances, lotes: lots });
}));

router.get('/lotes/:id', requireLotReadAccess('trazabilidad_lotes'), asyncRoute(async (req, res) => {
  const idTienda = req.tenant.idTienda;
  const idLote = parseId(req.params.id, 'El lote');
  const [[lots], [movements]] = await Promise.all([
    pool.query(
      `SELECT l.idLoteProducto, l.idProducto, p.nombre producto, p.categoria, l.idProveedor,
              pr.nombre proveedor, l.idDetalleCompra, dc.idCompra, l.codigoLote, l.origen,
              l.fechaIngreso, l.fechaVencimiento, l.cantidadInicial, l.cantidadRestante,
              CAST(l.costoUnitarioBase AS CHAR) costoUnitarioBase,
              CASE WHEN l.costoUnitarioBase IS NULL THEN NULL
                   ELSE ROUND(l.cantidadRestante*l.costoUnitarioBase,2) END valorRestante,
              l.estadoOperativo, l.creadoEn, l.actualizadoEn, co.fecha fechaCompra,
              creator.usuario creadoPor, updater.usuario actualizadoPor
       FROM loteProducto l
       JOIN producto p ON p.idTienda=l.idTienda AND p.idProducto=l.idProducto
       LEFT JOIN proveedor pr ON pr.idTienda=l.idTienda AND pr.idProveedor=l.idProveedor
       LEFT JOIN detalleCompra dc ON dc.idTienda=l.idTienda AND dc.idProducto=l.idProducto
         AND dc.idDetalleCompra=l.idDetalleCompra
       LEFT JOIN compra co ON co.idTienda=dc.idTienda AND co.idCompra=dc.idCompra
       LEFT JOIN administrador creator ON creator.idTienda=l.idTienda
         AND creator.idAdministrador=l.idAdministradorCrea
       LEFT JOIN administrador updater ON updater.idTienda=l.idTienda
         AND updater.idAdministrador=l.idAdministradorActualiza
       WHERE l.idTienda=? AND l.idLoteProducto=?`,
      [idTienda, idLote]
    ),
    pool.query(
      `SELECT ml.idMovimientoLote, ml.tipoRegistro, ml.cantidad, ml.cantidadAnterior,
              ml.cantidadPosterior, ml.creadoEn, ms.idMovimientoStock, ms.tipoMovimiento,
              ms.origen, dv.idDetalleVenta, dv.idVenta, a.usuario responsable
       FROM movimientoLote ml
       LEFT JOIN movimientoStock ms ON ms.idTienda=ml.idTienda AND ms.idProducto=ml.idProducto
         AND ms.idMovimientoStock=ml.idMovimientoStock
       LEFT JOIN detalleVenta dv ON dv.idTienda=ms.idTienda AND dv.idDetalleVenta=ms.idDetalleVenta
       JOIN administrador a ON a.idTienda=ml.idTienda AND a.idAdministrador=ml.idAdministrador
       WHERE ml.idTienda=? AND ml.idLoteProducto=?
       ORDER BY ml.creadoEn, ml.idMovimientoLote`,
      [idTienda, idLote]
    )
  ]);
  if (!lots.length) throw stockError(404, 'Lote no encontrado.');
  const snapshot = await productLotSnapshot(pool, idTienda, lots[0].idProducto);
  const classifiedLot = snapshot.lots.find((lot) => Number(lot.idLoteProducto) === idLote);
  res.json({
    lote: { ...lots[0], clasificacionInventario: classifiedLot?.clasificacionInventario || 'vendible' },
    movimientos: movements,
    stock: snapshot.balances
  });
}));

router.get('/ventas/:id/lotes-utilizados', requireLotReadAccess('trazabilidad_lotes'), asyncRoute(async (req, res) => {
  const idTienda = req.tenant.idTienda;
  const idVenta = parseId(req.params.id, 'La venta');
  const [rows] = await pool.query(
    `SELECT dv.idDetalleVenta, p.nombre producto, l.idLoteProducto, l.codigoLote,
            l.fechaVencimiento, ABS(ml.cantidad) cantidadUnidades,
            CAST(l.costoUnitarioBase AS CHAR) costoUnitarioBase, ml.creadoEn
     FROM detalleVenta dv
     JOIN producto p ON p.idTienda=dv.idTienda AND p.idProducto=dv.idProducto
     JOIN movimientoStock ms ON ms.idTienda=dv.idTienda AND ms.idDetalleVenta=dv.idDetalleVenta
     JOIN movimientoLote ml ON ml.idTienda=ms.idTienda AND ml.idMovimientoStock=ms.idMovimientoStock
     JOIN loteProducto l ON l.idTienda=ml.idTienda AND l.idLoteProducto=ml.idLoteProducto
     WHERE dv.idTienda=? AND dv.idVenta=? AND ml.cantidad<0
     ORDER BY dv.idDetalleVenta, ml.idMovimientoLote`,
    [idTienda, idVenta]
  );
  res.json({ rows });
}));

router.get('/lotes', requireLotReadAccess('trazabilidad_lotes'), asyncRoute(async (req, res) => {
  const idTienda = req.tenant.idTienda;
  const today = formatLocalDate();
  const { page, limit, offset } = pagination(req.query);
  const conditions = ['l.idTienda=?'];
  const params = [idTienda];
  if (req.query.producto) { conditions.push('l.idProducto=?'); params.push(parseId(req.query.producto, 'El producto')); }
  if (req.query.proveedor) { conditions.push('l.idProveedor=?'); params.push(parseId(req.query.proveedor, 'El proveedor')); }
  if (req.query.estadoOperativo) {
    if (!LOT_STATES.has(req.query.estadoOperativo)) throw stockError(400, 'El estado operativo no es valido.');
    conditions.push('l.estadoOperativo=?'); params.push(req.query.estadoOperativo);
  }
  if (req.query.codigoLote) { conditions.push('l.codigoLote LIKE ?'); params.push(`%${String(req.query.codigoLote).trim().slice(0, 80)}%`); }
  const from = req.query.venceDesde ? validLocalDate(req.query.venceDesde, 'La fecha inicial') : null;
  const to = req.query.venceHasta ? validLocalDate(req.query.venceHasta, 'La fecha final') : null;
  if (from && to && from > to) throw stockError(400, 'El rango de vencimiento no es valido.');
  if (from) { conditions.push('l.fechaVencimiento>=?'); params.push(from); }
  if (to) { conditions.push('l.fechaVencimiento<=?'); params.push(to); }
  if (['1', 'true'].includes(String(req.query.soloConSaldo || '').toLowerCase())) conditions.push('l.cantidadRestante>0');
  const hasClassification = await supportsInventoryClassification(pool);
  const inventoryClassification = inventoryClassificationExpression(hasClassification);
  const classification = `CASE
    WHEN ${inventoryClassification}='tecnico' THEN 'tecnico'
    WHEN ${inventoryClassification}='aislado' THEN 'aislado'
    WHEN ${inventoryClassification}='bloqueado' THEN 'bloqueado'
    WHEN l.cantidadRestante=0 THEN 'agotado' WHEN l.fechaVencimiento<? THEN 'vencido'
    WHEN l.fechaVencimiento=? THEN 'vence_hoy'
    WHEN l.fechaVencimiento<=DATE_ADD(?, INTERVAL COALESCE(p.diasAlertaVencimiento,c.diasAlertaVencimientoDefault) DAY)
      THEN 'proximo_a_vencer' ELSE 'vigente' END`;
  const state = String(req.query.estadoCalculado || '').trim();
  const allowedCalculated = new Set([
    'vencido', 'vence_hoy', 'proximo_a_vencer', 'vigente', 'bloqueado', 'aislado', 'tecnico', 'agotado'
  ]);
  const selectParams = [today, today, today, ...params];
  const base = `SELECT l.idLoteProducto, l.idProducto, p.nombre producto, p.categoria,
      pr.nombre proveedor, l.codigoLote, l.origen, l.fechaIngreso, l.fechaVencimiento,
      l.cantidadInicial, l.cantidadRestante, CAST(l.costoUnitarioBase AS CHAR) costoUnitarioBase,
      CASE WHEN l.costoUnitarioBase IS NULL THEN NULL
           ELSE ROUND(l.cantidadRestante*l.costoUnitarioBase,2) END valorRestante,
      l.estadoOperativo, ${inventoryClassification} clasificacionInventario,
      ${classification} estadoCalculado
    FROM loteProducto l
    JOIN producto p ON p.idTienda=l.idTienda AND p.idProducto=l.idProducto
    JOIN configuracionInventarioTienda c ON c.idTienda=l.idTienda
    LEFT JOIN proveedor pr ON pr.idTienda=l.idTienda AND pr.idProveedor=l.idProveedor
    WHERE ${conditions.join(' AND ')}`;
  let outerWhere = '';
  if (state) {
    if (!allowedCalculated.has(state)) throw stockError(400, 'El estado calculado no es valido.');
    outerWhere = 'WHERE estadoCalculado=?';
    selectParams.push(state);
  }
  const [[rows], [countRows]] = await Promise.all([
    pool.query(`SELECT * FROM (${base}) lotes ${outerWhere}
      ORDER BY fechaVencimiento IS NULL, fechaVencimiento, fechaIngreso, idLoteProducto LIMIT ? OFFSET ?`,
    [...selectParams, limit, offset]),
    pool.query(`SELECT COUNT(*) total FROM (${base}) lotes ${outerWhere}`, selectParams)
  ]);
  const total = Number(countRows[0].total);
  res.json({ rows, page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) });
}));

module.exports = router;
