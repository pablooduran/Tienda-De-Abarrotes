const crypto = require('crypto');
const pool = require('../config/db');
const {
  ADJUSTMENT_TYPES,
  INVENTORY_ADJUSTMENT_REASONS,
  LOT_SELECTION_MODES,
  MANUAL_INVENTORY_CLASSIFICATIONS
} = require('../config/inventory-adjustment-contract');
const {
  applyLotExit,
  createLotEntries,
  databaseLocalDate,
  insertLotMovement,
  lockLots,
  lockProduct,
  lotBalances,
  normalizeLotEntries,
  prepareLotExit
} = require('./lot-service');
const {
  cleanText,
  insertStockMovement,
  movementKey,
  stockError
} = require('./stock-movement-service');
const { administrativeAuditService } = require('./administrative-audit-service');
const { businessAnalytics } = require('./product-analytics');
const { formatLocalDate, formatLocalDateTime } = require('../utils/local-datetime');

const MAX_HISTORY_PAGE_SIZE = 100;
const KEY_PATTERN = /^[A-Za-z0-9._:-]{8,64}$/;

function positiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    throw stockError(400, `${label} debe ser un entero positivo.`, 'INVALID_INVENTORY_ADJUSTMENT');
  }
  return number;
}

function allowed(value, values, label) {
  const normalized = String(value || '').trim();
  if (!values.includes(normalized)) {
    throw stockError(400, `${label} no es valido.`, 'INVALID_INVENTORY_ADJUSTMENT');
  }
  return normalized;
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

function requestFingerprint(value) {
  return crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function normalizeRequest(raw = {}) {
  const tipoAjuste = allowed(raw.tipoAjuste, ADJUSTMENT_TYPES, 'El tipo de ajuste');
  const cantidad = positiveInteger(raw.cantidad, 'La cantidad');
  const motivoCodigo = allowed(raw.motivoCodigo, INVENTORY_ADJUSTMENT_REASONS, 'El motivo');
  const observacion = cleanText(raw.observacion, 500);
  if (motivoCodigo === 'otro_controlado' && (!observacion || observacion.length < 5)) {
    throw stockError(
      400,
      'La observacion es obligatoria para otro motivo.',
      'INVENTORY_ADJUSTMENT_OBSERVATION_REQUIRED'
    );
  }
  if (raw.confirmado !== true) {
    throw stockError(400, 'Debe confirmar expresamente el ajuste.', 'INVENTORY_ADJUSTMENT_CONFIRMATION_REQUIRED');
  }
  const claveOperacion = String(raw.claveOperacion || '').trim();
  if (!KEY_PATTERN.test(claveOperacion)) {
    throw stockError(400, 'La clave de operacion no es valida.', 'INVALID_OPERATION_KEY');
  }
  const modoLotes = allowed(raw.modoLotes || 'no_aplica', LOT_SELECTION_MODES, 'El modo de lotes');
  const clasificacionInventario = allowed(
    raw.clasificacionInventario || 'vendible',
    MANUAL_INVENTORY_CLASSIFICATIONS,
    'La clasificacion de inventario'
  );
  const idLoteProducto = raw.idLoteProducto === null || raw.idLoteProducto === undefined
    || raw.idLoteProducto === ''
    ? null
    : positiveInteger(raw.idLoteProducto, 'El lote');
  const lote = raw.lote && typeof raw.lote === 'object' ? {
    codigoLote: cleanText(raw.lote.codigoLote, 80),
    fechaVencimiento: raw.lote.fechaVencimiento || null,
    costoUnitarioBase: raw.lote.costoUnitarioBase
  } : null;
  const normalized = {
    tipoAjuste,
    cantidad,
    motivoCodigo,
    observacion,
    claveOperacion,
    modoLotes,
    clasificacionInventario,
    idLoteProducto,
    lote
  };
  return { ...normalized, huellaSolicitud: requestFingerprint(normalized) };
}

function effectiveSellable(lot, today = formatLocalDate()) {
  return lot.estadoOperativo === 'disponible'
    && lot.clasificacionInventario === 'vendible'
    && Number(lot.cantidadRestante) > 0
    && (!lot.fechaVencimiento || databaseLocalDate(lot.fechaVencimiento) >= today);
}

function validateLotMode(product, request) {
  if (!Number(product.controlaLotes)) {
    if (request.modoLotes !== 'no_aplica' || request.idLoteProducto
      || request.clasificacionInventario !== 'vendible') {
      throw stockError(
        409,
        'Este producto no controla lotes; el ajuste debe aplicarse al stock general vendible.',
        'LOT_MODE_NOT_ALLOWED'
      );
    }
    return;
  }
  if (request.tipoAjuste === 'positivo' && request.modoLotes !== 'lote_nuevo') {
    throw stockError(409, 'El ajuste positivo requiere crear un lote controlado.', 'LOT_CREATION_REQUIRED');
  }
  if (request.tipoAjuste === 'negativo'
    && !['fefo_fifo', 'lote_explicito'].includes(request.modoLotes)) {
    throw stockError(409, 'El ajuste negativo requiere FEFO/FIFO o un lote explicito.', 'LOT_SELECTION_REQUIRED');
  }
  if (request.modoLotes === 'lote_explicito' && !request.idLoteProducto) {
    throw stockError(400, 'Debe seleccionar el lote que se ajustara.', 'LOT_REQUIRED');
  }
}

function explicitLotExit(product, lots, request) {
  const lot = lots.find((item) => Number(item.idLoteProducto) === request.idLoteProducto);
  if (!lot || lot.estadoOperativo === 'anulado') {
    throw stockError(404, 'Lote no encontrado o no disponible para ajuste.', 'LOT_NOT_FOUND');
  }
  const before = Number(lot.cantidadRestante);
  if (before < request.cantidad) {
    throw stockError(409, 'El lote no tiene existencia fisica suficiente.', 'INSUFFICIENT_LOT_STOCK');
  }
  return {
    allocations: [{
      lot,
      quantity: request.cantidad,
      before,
      after: before - request.cantidad
    }],
    balances: lotBalances(product, lots)
  };
}

function publicAdjustment(row, repeated = false) {
  return {
    idAjusteInventario: Number(row.idAjusteInventario),
    idProducto: Number(row.idProducto),
    tipoAjuste: row.tipoAjuste,
    cantidad: Number(row.cantidad),
    motivoCodigo: row.motivoCodigo,
    observacion: row.observacion || null,
    modoLotes: row.modoLotes,
    clasificacionInventario: row.clasificacionInventario,
    stockFisicoAnterior: Number(row.stockFisicoAnterior),
    stockFisicoPosterior: Number(row.stockFisicoPosterior),
    stockVendibleAnterior: Number(row.stockVendibleAnterior),
    stockVendiblePosterior: Number(row.stockVendiblePosterior),
    creadoEn: row.creadoEn,
    repetida: repeated
  };
}

async function findByKey(connection, idTienda, key, { lock = false } = {}) {
  const [rows] = await connection.query(
    `SELECT idAjusteInventario, idProducto, tipoAjuste, cantidad, motivoCodigo,
            observacion, modoLotes, clasificacionInventario, stockFisicoAnterior,
            stockFisicoPosterior, stockVendibleAnterior, stockVendiblePosterior,
            huellaSolicitud, creadoEn
     FROM ajusteInventario
     WHERE idTienda=? AND claveOperacion=?
     LIMIT 1${lock ? ' FOR UPDATE' : ''}`,
    [idTienda, key]
  );
  return rows[0] || null;
}

function idempotentResult(row, fingerprint) {
  if (row.huellaSolicitud !== fingerprint) {
    throw stockError(
      409,
      'La clave de operacion ya fue usada para un ajuste diferente.',
      'OPERATION_KEY_CONFLICT'
    );
  }
  return publicAdjustment(row, true);
}

function auditInput(context, action, result, resultCode, reference, before, after, metadata) {
  return {
    storeId: context.idTienda,
    actorType: 'administrador',
    administratorId: context.idAdministrador,
    action,
    result,
    resultCode,
    origin: 'web',
    reference,
    requestId: context.requestId,
    before,
    after,
    metadata
  };
}

function createInventoryAdjustmentService({
  database = pool,
  audit = administrativeAuditService,
  analytics = businessAnalytics,
  clock = () => new Date()
} = {}) {
  async function applyAdjustment(context, rawRequest) {
    const idTienda = positiveInteger(context.idTienda, 'La tienda');
    const idAdministrador = positiveInteger(context.idAdministrador, 'El administrador');
    const idProducto = positiveInteger(context.idProducto, 'El producto');
    let request;
    let connection;
    try {
      request = normalizeRequest(rawRequest);
      connection = await database.getConnection();
      await connection.beginTransaction();
      const existing = await findByKey(connection, idTienda, request.claveOperacion);
      if (existing) {
        const result = idempotentResult(existing, request.huellaSolicitud);
        await connection.commit();
        return result;
      }

      const product = await lockProduct(connection, idTienda, idProducto);
      const existingAfterProductLock = await findByKey(
        connection,
        idTienda,
        request.claveOperacion,
        { lock: true }
      );
      if (existingAfterProductLock) {
        const result = idempotentResult(existingAfterProductLock, request.huellaSolicitud);
        await connection.commit();
        return result;
      }
      validateLotMode(product, request);
      const nowDate = clock();
      const now = formatLocalDateTime(nowDate);
      const stockFisicoAnterior = Number(product.stockUnidadesTotal);
      if (request.tipoAjuste === 'negativo' && stockFisicoAnterior < request.cantidad) {
        throw stockError(409, 'El ajuste supera el stock fisico disponible.', 'INSUFFICIENT_PHYSICAL_STOCK');
      }

      let lots = [];
      let lotExit = null;
      let normalizedLot = null;
      let idLoteProducto = request.idLoteProducto;
      let stockVendibleAnterior = stockFisicoAnterior;
      if (Number(product.controlaLotes)) {
        lots = await lockLots(connection, idTienda, idProducto, product);
        const balances = lotBalances(product, lots);
        if (balances.stockGeneral !== balances.stockTrazado) {
          throw stockError(
            409,
            'El inventario debe conciliarse antes de registrar un ajuste.',
            'LOT_STOCK_MISMATCH'
          );
        }
        stockVendibleAnterior = balances.stockVendible;
        if (request.tipoAjuste === 'negativo') {
          lotExit = request.modoLotes === 'lote_explicito'
            ? explicitLotExit(product, lots, request)
            : await prepareLotExit(connection, { idTienda, product, cantidad: request.cantidad });
        } else {
          if (!request.lote) {
            throw stockError(400, 'Debe proporcionar los datos del lote nuevo.', 'LOT_DATA_REQUIRED');
          }
          normalizedLot = normalizeLotEntries([{
            ...request.lote,
            cantidad: request.cantidad
          }], {
            requiredTotal: request.cantidad,
            controlsExpiration: Number(product.controlaVencimiento) === 1,
            operationDate: nowDate,
            allowExpired: request.clasificacionInventario !== 'vendible'
          });
        }
      }

      const delta = request.tipoAjuste === 'positivo' ? request.cantidad : -request.cantidad;
      const stockFisicoPosterior = stockFisicoAnterior + delta;
      const [updated] = await connection.query(
        `UPDATE producto
         SET stockUnidadesTotal=?, stock=?
         WHERE idTienda=? AND idProducto=? AND activo=1 AND stockUnidadesTotal=?`,
        [stockFisicoPosterior, stockFisicoPosterior, idTienda, idProducto, stockFisicoAnterior]
      );
      if (!updated.affectedRows) {
        throw stockError(409, 'El stock cambio durante el ajuste.', 'INVENTORY_CONCURRENT_CHANGE');
      }
      const idMovimientoStock = await insertStockMovement(connection, {
        idTienda,
        idProducto,
        tipoMovimiento: request.tipoAjuste === 'positivo' ? 'ajuste_positivo' : 'ajuste_negativo',
        origen: 'ajuste_manual',
        cantidad: delta,
        stockAnterior: stockFisicoAnterior,
        stockPosterior: stockFisicoPosterior,
        cantidadOperacion: request.cantidad,
        unidadOperacion: 'unidad_base',
        motivo: request.motivoCodigo,
        observacion: request.observacion,
        referenciaTipo: 'ajuste_inventario',
        referenciaId: idProducto,
        claveOperacion: movementKey('inventario-ajuste', request.claveOperacion),
        idAdministrador,
        creadoEn: now
      });

      if (normalizedLot) {
        const created = await createLotEntries(connection, {
          idTienda,
          idProducto,
          entries: normalizedLot,
          origen: 'ajuste_positivo',
          clasificacionInventario: request.clasificacionInventario,
          operation: `inventory-adjustment:${request.claveOperacion}`,
          detailIndex: 1,
          creadoEn: now,
          idMovimientoStock,
          idAdministrador
        });
        idLoteProducto = Number(created[0].idLoteProducto);
      } else if (lotExit) {
        await applyLotExit(connection, {
          prepared: lotExit,
          idTienda,
          idProducto,
          idMovimientoStock,
          operation: `inventory-adjustment:${request.claveOperacion}`,
          detailIndex: 1,
          creadoEn: now,
          idAdministrador
        });
      }

      let stockVendiblePosterior = stockFisicoPosterior;
      if (Number(product.controlaLotes)) {
        if (request.tipoAjuste === 'positivo') {
          const sellableNewLot = request.clasificacionInventario === 'vendible'
            && (!normalizedLot[0].fechaVencimiento
              || normalizedLot[0].fechaVencimiento >= formatLocalDate(nowDate));
          stockVendiblePosterior = stockVendibleAnterior + (sellableNewLot ? request.cantidad : 0);
        } else {
          const removedSellable = lotExit.allocations.reduce(
            (total, allocation) => total
              + (effectiveSellable(allocation.lot, formatLocalDate(nowDate)) ? allocation.quantity : 0),
            0
          );
          stockVendiblePosterior = stockVendibleAnterior - removedSellable;
        }
      }

      const [inserted] = await connection.query(
        `INSERT INTO ajusteInventario
         (idTienda, idProducto, idMovimientoStock, idLoteProducto, tipoAjuste,
          cantidad, motivoCodigo, observacion, modoLotes, clasificacionInventario,
          stockFisicoAnterior, stockFisicoPosterior, stockVendibleAnterior,
          stockVendiblePosterior, claveOperacion, huellaSolicitud, idAdministrador, creadoEn)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          idTienda, idProducto, idMovimientoStock, idLoteProducto,
          request.tipoAjuste, request.cantidad, request.motivoCodigo,
          request.observacion, request.modoLotes, request.clasificacionInventario,
          stockFisicoAnterior, stockFisicoPosterior, stockVendibleAnterior,
          stockVendiblePosterior, request.claveOperacion, request.huellaSolicitud,
          idAdministrador, now
        ]
      );
      const idAjusteInventario = Number(inserted.insertId);
      const reference = `ajuste_inventario:${idAjusteInventario}`;
      await audit.recordCritical(connection, auditInput(
        { ...context, idTienda, idAdministrador },
        'ajuste_inventario_solicitado',
        'correcto',
        'INVENTORY_ADJUSTMENT_REQUESTED',
        reference,
        null,
        null,
        { tipoAjuste: request.tipoAjuste, motivoCodigo: request.motivoCodigo }
      ));
      await audit.recordCritical(connection, auditInput(
        { ...context, idTienda, idAdministrador },
        'ajuste_inventario_aplicado',
        'correcto',
        'INVENTORY_ADJUSTMENT_APPLIED',
        reference,
        { stockFisico: stockFisicoAnterior, stockVendible: stockVendibleAnterior },
        { stockFisico: stockFisicoPosterior, stockVendible: stockVendiblePosterior },
        {
          tipoAjuste: request.tipoAjuste,
          motivoCodigo: request.motivoCodigo,
          clasificacionInventario: request.clasificacionInventario
        }
      ));
      await connection.commit();
      analytics.stockRegistered({
        registered: request.tipoAjuste === 'positivo',
        repeated: false,
        mode: 'manual_adjustment'
      });
      return {
        idAjusteInventario,
        idProducto,
        tipoAjuste: request.tipoAjuste,
        cantidad: request.cantidad,
        motivoCodigo: request.motivoCodigo,
        observacion: request.observacion,
        modoLotes: request.modoLotes,
        clasificacionInventario: request.clasificacionInventario,
        stockFisicoAnterior,
        stockFisicoPosterior,
        stockVendibleAnterior,
        stockVendiblePosterior,
        creadoEn: now,
        repetida: false
      };
    } catch (error) {
      if (connection) {
        try {
          await connection.rollback();
        } catch {
          // Preserve the functional error; the centralized handler will log infrastructure failures.
        }
      }
      if (request && error.code === 'ER_DUP_ENTRY') {
        const existing = await findByKey(database, context.idTienda, request.claveOperacion);
        if (existing) return idempotentResult(existing, request.huellaSolicitud);
      }
      const rejected = Number(error.status || 500) < 500;
      await audit.recordOutcome(auditInput(
        context,
        rejected ? 'ajuste_inventario_rechazado' : 'ajuste_inventario_fallido',
        rejected ? 'rechazado' : 'fallido',
        rejected ? 'INVENTORY_ADJUSTMENT_REJECTED' : 'INVENTORY_ADJUSTMENT_FAILED',
        `producto:${context.idProducto}`,
        null,
        null,
        request ? { tipoAjuste: request.tipoAjuste, motivoCodigo: request.motivoCodigo } : null
      ));
      throw error;
    } finally {
      connection?.release();
    }
  }

  return Object.freeze({ applyAdjustment });
}

function historyPagination(query = {}) {
  const page = query.page === undefined ? 1 : positiveInteger(query.page, 'La pagina');
  const pageSize = query.pageSize === undefined ? 25 : positiveInteger(query.pageSize, 'El tamano de pagina');
  if (pageSize > MAX_HISTORY_PAGE_SIZE) {
    throw stockError(400, `El tamano de pagina no puede superar ${MAX_HISTORY_PAGE_SIZE}.`);
  }
  return { page, pageSize, offset: (page - 1) * pageSize };
}

async function listInventoryAdjustments(connection, idTienda, query = {}) {
  idTienda = positiveInteger(idTienda, 'La tienda');
  const { page, pageSize, offset } = historyPagination(query);
  const conditions = ['ai.idTienda=?'];
  const params = [idTienda];
  if (query.idProducto) {
    conditions.push('ai.idProducto=?');
    params.push(positiveInteger(query.idProducto, 'El producto'));
  }
  if (query.tipoAjuste) {
    conditions.push('ai.tipoAjuste=?');
    params.push(allowed(query.tipoAjuste, ADJUSTMENT_TYPES, 'El tipo de ajuste'));
  }
  const where = conditions.join(' AND ');
  const [[counts], [rows]] = await Promise.all([
    connection.query(`SELECT COUNT(*) total FROM ajusteInventario ai WHERE ${where}`, params),
    connection.query(
      `SELECT ai.idAjusteInventario, ai.idProducto, p.nombre producto,
              ai.tipoAjuste, ai.cantidad, ai.motivoCodigo, ai.observacion,
              ai.modoLotes, ai.clasificacionInventario,
              ai.stockFisicoAnterior, ai.stockFisicoPosterior,
              ai.stockVendibleAnterior, ai.stockVendiblePosterior,
              ai.creadoEn, a.usuario responsable
       FROM ajusteInventario ai
       JOIN producto p ON p.idTienda=ai.idTienda AND p.idProducto=ai.idProducto
       JOIN administrador a
         ON a.idTienda=ai.idTienda AND a.idAdministrador=ai.idAdministrador
       WHERE ${where}
       ORDER BY ai.creadoEn DESC, ai.idAjusteInventario DESC
       LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    )
  ]);
  const total = Number(counts[0].total);
  return {
    resultados: rows.map((row) => ({
      ...row,
      idAjusteInventario: Number(row.idAjusteInventario),
      idProducto: Number(row.idProducto),
      cantidad: Number(row.cantidad),
      stockFisicoAnterior: Number(row.stockFisicoAnterior),
      stockFisicoPosterior: Number(row.stockFisicoPosterior),
      stockVendibleAnterior: Number(row.stockVendibleAnterior),
      stockVendiblePosterior: Number(row.stockVendiblePosterior)
    })),
    paginacion: {
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      hasNextPage: offset + rows.length < total,
      hasPreviousPage: page > 1
    }
  };
}

module.exports = {
  createInventoryAdjustmentService,
  listInventoryAdjustments,
  normalizeRequest,
  requestFingerprint
};
