const crypto = require('crypto');
const pool = require('../config/db');
const {
  COMPENSATION_REASONS,
  INVENTORY_RETURN_TREATMENTS,
  OPERATION_KEY_PATTERN,
  SALE_COMPENSATION_TYPES
} = require('../config/compensation-contract');
const {
  databaseLocalDate,
  insertLotMovement,
  supportsInventoryClassification
} = require('./lot-service');
const {
  insertStockMovement,
  movementKey,
  stockError
} = require('./stock-movement-service');
const { administrativeAuditService } = require('./administrative-audit-service');
const { formatLocalDate, formatLocalDateTime } = require('../utils/local-datetime');

const MAX_DETAILS = 100;
const MAX_MONEY_CENTS = 9999999999;

function positiveId(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    throw stockError(400, `${label} no es valido.`, 'INVALID_COMPENSATION_REFERENCE');
  }
  return number;
}

function positiveUnits(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    throw stockError(400, `${label} debe ser un numero entero positivo.`, 'INVALID_RETURN_QUANTITY');
  }
  return number;
}

function moneyToCents(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw stockError(409, `${label} no es valido.`, 'SALE_HISTORY_INCONSISTENT');
  }
  const amount = Math.round(number * 100);
  if (!Number.isSafeInteger(amount) || amount < 0 || amount > MAX_MONEY_CENTS) {
    throw stockError(409, `${label} supera el rango permitido.`, 'SALE_HISTORY_INCONSISTENT');
  }
  return amount;
}

function centsToDecimal(value) {
  return (value / 100).toFixed(2);
}

function cleanObservation(value) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  if (text.length > 1000) {
    throw stockError(400, 'La observacion no puede superar 1000 caracteres.', 'INVALID_COMPENSATION_OBSERVATION');
  }
  return text;
}

function inventoryTreatment(value, label = 'El tratamiento de inventario') {
  const normalized = String(value || '').trim().toLowerCase();
  if (!INVENTORY_RETURN_TREATMENTS.includes(normalized)) {
    throw stockError(400, `${label} no es valido.`, 'INVALID_INVENTORY_RETURN_TREATMENT');
  }
  return normalized;
}

function normalizeRequest(idVenta, body) {
  const source = body && typeof body === 'object' ? body : {};
  if (source.confirmar !== true) {
    throw stockError(400, 'Debe confirmar expresamente la compensacion.', 'SALE_COMPENSATION_CONFIRMATION_REQUIRED');
  }
  const type = String(source.tipoCompensacion || source.tipo || '').trim().toLowerCase();
  if (!SALE_COMPENSATION_TYPES.includes(type)) {
    throw stockError(400, 'El tipo de compensacion de venta no es valido.', 'INVALID_SALE_COMPENSATION_TYPE');
  }
  const key = String(source.claveOperacion || '').trim();
  if (!OPERATION_KEY_PATTERN.test(key)) {
    throw stockError(400, 'La clave de operacion no es valida.', 'INVALID_OPERATION_KEY');
  }
  const reason = String(source.motivoCodigo || '').trim().toLowerCase();
  if (!COMPENSATION_REASONS.includes(reason)) {
    throw stockError(400, 'El motivo de la compensacion no es valido.', 'INVALID_COMPENSATION_REASON');
  }
  const observation = cleanObservation(source.observacion);
  if (reason === 'otro_controlado' && (!observation || observation.length < 8)) {
    throw stockError(400, 'El motivo otro_controlado requiere una observacion suficiente.',
      'COMPENSATION_OBSERVATION_REQUIRED');
  }
  const defaultTreatment = source.tratamientoInventario === undefined
    ? null : inventoryTreatment(source.tratamientoInventario);
  let details = [];
  if (type === 'devolucion_parcial') {
    if (!Array.isArray(source.detalles) || !source.detalles.length) {
      throw stockError(400, 'La devolucion parcial requiere al menos un detalle.', 'RETURN_DETAILS_REQUIRED');
    }
    if (source.detalles.length > MAX_DETAILS) {
      throw stockError(400, `Se permiten como maximo ${MAX_DETAILS} detalles por compensacion.`,
        'TOO_MANY_RETURN_DETAILS');
    }
    details = source.detalles.map((detail, index) => ({
      idDetalleVenta: positiveId(detail.idDetalleVenta, `El detalle ${index + 1}`),
      unidadesDevueltas: positiveUnits(
        detail.unidadesDevueltas ?? detail.cantidadUnidades,
        `Las unidades del detalle ${index + 1}`
      ),
      tratamientoInventario: inventoryTreatment(
        detail.tratamientoInventario ?? defaultTreatment,
        `El tratamiento del detalle ${index + 1}`
      )
    })).sort((left, right) => left.idDetalleVenta - right.idDetalleVenta);
    if (new Set(details.map((detail) => detail.idDetalleVenta)).size !== details.length) {
      throw stockError(400, 'Cada detalle de venta debe aparecer una sola vez.', 'DUPLICATE_RETURN_DETAIL');
    }
  } else {
    if (!defaultTreatment) {
      throw stockError(400, 'La anulacion total requiere un tratamiento de inventario.',
        'INVENTORY_RETURN_TREATMENT_REQUIRED');
    }
    if (source.detalles !== undefined && (!Array.isArray(source.detalles) || source.detalles.length)) {
      throw stockError(400, 'La anulacion total calcula automaticamente todos los detalles pendientes.',
        'FULL_CANCELLATION_DETAILS_NOT_ALLOWED');
    }
  }
  const normalized = {
    idVenta: positiveId(idVenta, 'La venta'),
    tipoCompensacion: type,
    tipoOperacion: type === 'anulacion_total' ? 'anulacion_venta' : 'devolucion_venta',
    claveOperacion: key,
    motivoCodigo: reason,
    observacion: observation,
    tratamientoInventario: defaultTreatment,
    detalles: details
  };
  normalized.huellaSolicitud = crypto.createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
  return normalized;
}

function allocateLineAmounts(sale, details) {
  const subtotalCents = moneyToCents(sale.subtotal, 'El subtotal historico');
  const discountCents = moneyToCents(sale.descuento, 'El descuento historico');
  const totalCents = moneyToCents(sale.total, 'El total historico');
  const detailSubtotal = details.reduce(
    (sum, detail) => sum + moneyToCents(detail.subtotal, 'El subtotal de detalle historico'), 0
  );
  if (detailSubtotal !== subtotalCents || subtotalCents - discountCents !== totalCents) {
    throw stockError(409, 'La venta historica no puede reconciliarse para una compensacion.',
      'SALE_HISTORY_INCONSISTENT');
  }
  let remainingDiscount = discountCents;
  return details.map((detail, index) => {
    const lineSubtotal = moneyToCents(detail.subtotal, 'El subtotal de detalle historico');
    const discountShare = index === details.length - 1
      ? remainingDiscount
      : Math.min(remainingDiscount, Math.round(discountCents * lineSubtotal / Math.max(1, subtotalCents)));
    remainingDiscount -= discountShare;
    return {
      ...detail,
      soldUnits: positiveUnits(detail.cantidadEquivalenteUnidades, 'Las unidades historicas vendidas'),
      netCents: lineSubtotal - discountShare,
      costCents: moneyToCents(detail.subtotalCosto, 'El costo historico del detalle')
    };
  });
}

function cumulativeShare(totalCents, units, cumulativeUnits) {
  if (cumulativeUnits >= units) return totalCents;
  return Math.floor(totalCents * cumulativeUnits / units);
}

function operationResponseRow(row, repeated, details, lots) {
  return {
    idOperacionCompensatoria: Number(row.idOperacionCompensatoria),
    idCompensacionVenta: Number(row.idCompensacionVenta),
    idVenta: Number(row.idVenta),
    tipoCompensacion: row.tipoCompensacion,
    estado: row.estado,
    estadoOperacionVenta: row.estadoOperacion,
    montoCompensado: row.montoCompensado,
    costoCompensado: row.costoCompensado,
    liquidacion: {
      estado: row.estadoLiquidacion,
      montoReduccionDeudaPendiente: row.montoReduccionDeudaPendiente,
      montoReembolsoPendiente: row.montoReembolsoPendiente
    },
    detalles: details.map((detail) => ({
      idDetalleCompensacionVenta: Number(detail.idDetalleCompensacionVenta),
      idDetalleVenta: Number(detail.idDetalleVenta),
      idProducto: Number(detail.idProducto),
      unidadesDevueltas: Number(detail.unidadesDevueltas),
      montoCompensado: detail.montoCompensado,
      costoCompensado: detail.costoCompensado,
      tratamientoInventario: detail.tratamientoInventario,
      resultadoInventario: detail.resultadoInventario,
      idMovimientoStock: detail.idMovimientoStock === null ? null : Number(detail.idMovimientoStock)
    })),
    lotes: lots.map((lot) => ({
      idDetalleCompensacionVenta: Number(lot.idDetalleCompensacionVenta),
      unidadesDevueltas: Number(lot.unidadesDevueltas),
      resultadoInventario: lot.resultadoInventario,
      fechaVencimientoHistorica: databaseLocalDate(lot.fechaVencimientoHistorica)
    })),
    repetida: repeated
  };
}

async function loadCompensationResult(connection, idTienda, idOperacionCompensatoria, repeated = false) {
  const [headers] = await connection.query(
    `SELECT oc.idOperacionCompensatoria, oc.estado, cv.idCompensacionVenta, cv.idVenta,
            cv.tipoCompensacion, cv.montoCompensado, cv.costoCompensado,
            v.estadoOperacion, lcv.estado estadoLiquidacion,
            lcv.montoReduccionDeudaPendiente, lcv.montoReembolsoPendiente
     FROM operacionCompensatoria oc
     JOIN compensacionVenta cv
       ON cv.idTienda=oc.idTienda
      AND cv.idOperacionCompensatoria=oc.idOperacionCompensatoria
     JOIN venta v ON v.idTienda=cv.idTienda AND v.idVenta=cv.idVenta
     JOIN liquidacionCompensacionVenta lcv
       ON lcv.idTienda=cv.idTienda
      AND lcv.idCompensacionVenta=cv.idCompensacionVenta
     WHERE oc.idTienda=? AND oc.idOperacionCompensatoria=?`,
    [idTienda, idOperacionCompensatoria]
  );
  if (!headers.length) {
    throw stockError(409, 'La operacion existente no tiene un resultado aplicable.',
      'COMPENSATION_RESULT_INCOMPLETE');
  }
  const [details] = await connection.query(
    `SELECT idDetalleCompensacionVenta, idDetalleVenta, idProducto, unidadesDevueltas,
            montoCompensado, costoCompensado, tratamientoInventario,
            resultadoInventario, idMovimientoStock
     FROM detalleCompensacionVenta
     WHERE idTienda=? AND idCompensacionVenta=?
     ORDER BY idDetalleVenta`,
    [idTienda, headers[0].idCompensacionVenta]
  );
  const [lots] = await connection.query(
    `SELECT dcl.idDetalleCompensacionVenta, dcl.unidadesDevueltas,
            dcl.resultadoInventario, dcl.fechaVencimientoHistorica
     FROM detalleCompensacionLote dcl
     JOIN detalleCompensacionVenta dcv
       ON dcv.idTienda=dcl.idTienda
      AND dcv.idProducto=dcl.idProducto
      AND dcv.idDetalleCompensacionVenta=dcl.idDetalleCompensacionVenta
     WHERE dcv.idTienda=? AND dcv.idCompensacionVenta=?
     ORDER BY dcl.idDetalleCompensacionLote`,
    [idTienda, headers[0].idCompensacionVenta]
  );
  return operationResponseRow(headers[0], repeated, details, lots);
}

async function lockOperation(connection, input, idAdministrador, now) {
  const [insert] = await connection.query(
    `INSERT INTO operacionCompensatoria
     (idTienda, tipoOperacion, estado, motivoCodigo, observacion, requiereAprobacion,
      idAdministradorSolicitante, idAdministradorAprobador, claveOperacion,
      huellaSolicitud, fechaSolicitud, fechaAprobacion, fechaAplicacion, creadoEn, actualizadoEn)
     VALUES (?, ?, 'solicitada', ?, ?, 0, ?, NULL, ?, ?, ?, NULL, NULL, ?, ?)
     ON DUPLICATE KEY UPDATE idOperacionCompensatoria=LAST_INSERT_ID(idOperacionCompensatoria)`,
    [input.idTienda, input.request.tipoOperacion, input.request.motivoCodigo,
      input.request.observacion, idAdministrador, input.request.claveOperacion,
      input.request.huellaSolicitud, now, now, now]
  );
  const idOperacionCompensatoria = Number(insert.insertId);
  const [rows] = await connection.query(
    `SELECT idOperacionCompensatoria, tipoOperacion, estado, huellaSolicitud
     FROM operacionCompensatoria
     WHERE idTienda=? AND idOperacionCompensatoria=? FOR UPDATE`,
    [input.idTienda, idOperacionCompensatoria]
  );
  const operation = rows[0];
  if (!operation) throw stockError(500, 'No se pudo bloquear la operacion compensatoria.');
  if (operation.huellaSolicitud !== input.request.huellaSolicitud
    || operation.tipoOperacion !== input.request.tipoOperacion) {
    throw stockError(409, 'La clave de operacion ya fue utilizada con otra solicitud.',
      'OPERATION_KEY_CONFLICT');
  }
  const [existing] = await connection.query(
    `SELECT idCompensacionVenta FROM compensacionVenta
     WHERE idTienda=? AND idOperacionCompensatoria=? FOR UPDATE`,
    [input.idTienda, idOperacionCompensatoria]
  );
  if (existing.length) {
    if (operation.estado !== 'aplicada') {
      throw stockError(409, 'La operacion existente no se encuentra aplicada.',
        'COMPENSATION_RESULT_INCOMPLETE');
    }
    return {
      repeated: true,
      result: await loadCompensationResult(connection, input.idTienda, idOperacionCompensatoria, true)
    };
  }
  if (operation.estado !== 'solicitada') {
    throw stockError(409, 'La clave pertenece a una operacion que no puede aplicarse.',
      'COMPENSATION_STATE_CONFLICT');
  }
  return { repeated: false, idOperacionCompensatoria };
}

async function lockSaleHistory(connection, idTienda, idVenta) {
  const [sales] = await connection.query(
    `SELECT idVenta, idCliente, fecha, subtotal, descuento, total, montoPagado,
            saldoPendiente, estadoPago, estadoOperacion, tipo
     FROM venta WHERE idTienda=? AND idVenta=? FOR UPDATE`,
    [idTienda, idVenta]
  );
  if (!sales.length) throw stockError(404, 'Venta no encontrada.', 'SALE_NOT_FOUND');
  const [details] = await connection.query(
    `SELECT idDetalleVenta, idProducto, cantidad, presentacionVenta,
            cantidadEquivalenteUnidades, subtotal, subtotalCosto
     FROM detalleVenta
     WHERE idTienda=? AND idVenta=?
     ORDER BY idDetalleVenta FOR UPDATE`,
    [idTienda, idVenta]
  );
  if (!details.length) {
    throw stockError(409, 'La venta no tiene detalles compensables.', 'SALE_WITHOUT_DETAILS');
  }
  return { sale: sales[0], details: allocateLineAmounts(sales[0], details) };
}

async function priorReturns(connection, idTienda, idVenta) {
  const [rows] = await connection.query(
    `SELECT dcv.idDetalleVenta, dcv.unidadesDevueltas
     FROM compensacionVenta cv
     JOIN operacionCompensatoria oc
       ON oc.idTienda=cv.idTienda
      AND oc.idOperacionCompensatoria=cv.idOperacionCompensatoria
     JOIN detalleCompensacionVenta dcv
       ON dcv.idTienda=cv.idTienda
      AND dcv.idCompensacionVenta=cv.idCompensacionVenta
     WHERE cv.idTienda=? AND cv.idVenta=? AND oc.estado='aplicada'
     ORDER BY dcv.idDetalleCompensacionVenta
     FOR UPDATE`,
    [idTienda, idVenta]
  );
  const returned = new Map();
  for (const row of rows) {
    returned.set(Number(row.idDetalleVenta),
      (returned.get(Number(row.idDetalleVenta)) || 0) + Number(row.unidadesDevueltas));
  }
  return returned;
}

function buildRequestedDetails(request, details, returned) {
  const byId = new Map(details.map((detail) => [Number(detail.idDetalleVenta), detail]));
  const requested = request.tipoCompensacion === 'anulacion_total'
    ? details.map((detail) => ({
      idDetalleVenta: Number(detail.idDetalleVenta),
      unidadesDevueltas: detail.soldUnits - (returned.get(Number(detail.idDetalleVenta)) || 0),
      tratamientoInventario: request.tratamientoInventario
    })).filter((detail) => detail.unidadesDevueltas > 0)
    : request.detalles;
  if (!requested.length) {
    throw stockError(409, 'La venta ya fue compensada completamente.', 'SALE_ALREADY_FULLY_COMPENSATED');
  }
  return requested.map((item) => {
    const detail = byId.get(item.idDetalleVenta);
    if (!detail) throw stockError(404, 'Detalle de venta no encontrado.', 'SALE_DETAIL_NOT_FOUND');
    const previousUnits = returned.get(item.idDetalleVenta) || 0;
    const cumulativeUnits = previousUnits + item.unidadesDevueltas;
    if (cumulativeUnits > detail.soldUnits) {
      throw stockError(409, 'La devolucion acumulada supera la cantidad vendida.',
        'RETURN_EXCEEDS_SOLD_QUANTITY');
    }
    return {
      ...detail,
      previousUnits,
      cumulativeUnits,
      returnedUnits: item.unidadesDevueltas,
      treatment: item.tratamientoInventario,
      amountCents: cumulativeShare(detail.netCents, detail.soldUnits, cumulativeUnits)
        - cumulativeShare(detail.netCents, detail.soldUnits, previousUnits),
      returnedCostCents: cumulativeShare(detail.costCents, detail.soldUnits, cumulativeUnits)
        - cumulativeShare(detail.costCents, detail.soldUnits, previousUnits)
    };
  }).sort((left, right) => Number(left.idDetalleVenta) - Number(right.idDetalleVenta));
}

async function lockProducts(connection, idTienda, requestedDetails) {
  const ids = [...new Set(requestedDetails.map((detail) => Number(detail.idProducto)))].sort((a, b) => a - b);
  const placeholders = ids.map(() => '?').join(',');
  const [rows] = await connection.query(
    `SELECT idProducto, stockUnidadesTotal, stock, controlaLotes, controlaVencimiento
     FROM producto
     WHERE idTienda=? AND idProducto IN (${placeholders})
     ORDER BY idProducto FOR UPDATE`,
    [idTienda, ...ids]
  );
  if (rows.length !== ids.length) throw stockError(409, 'Un producto de la venta ya no existe.', 'SALE_PRODUCT_MISSING');
  return new Map(rows.map((row) => [Number(row.idProducto), {
    ...row,
    currentStock: Number(row.stockUnidadesTotal)
  }]));
}

async function lockOriginalStockMovements(connection, idTienda, requestedDetails) {
  const detailIds = requestedDetails.map((detail) => Number(detail.idDetalleVenta));
  const placeholders = detailIds.map(() => '?').join(',');
  const [rows] = await connection.query(
    `SELECT idMovimientoStock, idProducto, idDetalleVenta, cantidad, stockAnterior, stockPosterior
     FROM movimientoStock
     WHERE idTienda=? AND idDetalleVenta IN (${placeholders}) AND origen='venta'
     ORDER BY idProducto, idMovimientoStock FOR UPDATE`,
    [idTienda, ...detailIds]
  );
  return new Map(rows.map((row) => [Number(row.idDetalleVenta), row]));
}

async function lotSources(connection, idTienda, requestedDetails, stockMovements) {
  const movementIds = requestedDetails
    .filter((detail) => Number(detail.product.controlaLotes) === 1)
    .map((detail) => stockMovements.get(Number(detail.idDetalleVenta))?.idMovimientoStock)
    .filter(Boolean);
  if (!movementIds.length) return { sourcesByMovement: new Map(), returnedBySource: new Map() };
  const placeholders = movementIds.map(() => '?').join(',');
  const [sources] = await connection.query(
    `SELECT ml.idMovimientoLote, ml.idMovimientoStock, ml.idProducto, ml.idLoteProducto,
            ml.cantidad, lp.idProveedor, lp.codigoLote, lp.origen, lp.fechaIngreso,
            lp.fechaVencimiento, lp.cantidadInicial, lp.cantidadRestante,
            lp.costoUnitarioBase, lp.estadoOperativo, lp.clasificacionInventario
     FROM movimientoLote ml
     JOIN loteProducto lp
       ON lp.idTienda=ml.idTienda
      AND lp.idProducto=ml.idProducto
      AND lp.idLoteProducto=ml.idLoteProducto
     WHERE ml.idTienda=? AND ml.idMovimientoStock IN (${placeholders}) AND ml.cantidad<0
     ORDER BY ml.idProducto, ml.idMovimientoLote
     FOR UPDATE`,
    [idTienda, ...movementIds]
  );
  const [prior] = await connection.query(
    `SELECT dcl.idMovimientoLoteSalida, dcl.unidadesDevueltas
     FROM detalleCompensacionLote dcl
     JOIN detalleCompensacionVenta dcv
       ON dcv.idTienda=dcl.idTienda
      AND dcv.idProducto=dcl.idProducto
      AND dcv.idDetalleCompensacionVenta=dcl.idDetalleCompensacionVenta
     JOIN compensacionVenta cv
       ON cv.idTienda=dcv.idTienda
      AND cv.idCompensacionVenta=dcv.idCompensacionVenta
     JOIN operacionCompensatoria oc
       ON oc.idTienda=cv.idTienda
      AND oc.idOperacionCompensatoria=cv.idOperacionCompensatoria
     WHERE cv.idTienda=? AND cv.idVenta=? AND oc.estado='aplicada'
     ORDER BY dcl.idDetalleCompensacionLote
     FOR UPDATE`,
    [idTienda, requestedDetails[0].idVenta]
  );
  const sourcesByMovement = new Map();
  for (const source of sources) {
    const key = Number(source.idMovimientoStock);
    if (!sourcesByMovement.has(key)) sourcesByMovement.set(key, []);
    sourcesByMovement.get(key).push(source);
  }
  const returnedBySource = new Map();
  for (const row of prior) {
    const key = Number(row.idMovimientoLoteSalida);
    returnedBySource.set(key, (returnedBySource.get(key) || 0) + Number(row.unidadesDevueltas));
  }
  return { sourcesByMovement, returnedBySource };
}

function allocateLotSources(detail, stockMovement, sources, returnedBySource) {
  if (!stockMovement) {
    throw stockError(409, 'No existe el movimiento de stock original de la venta.',
      'ORIGINAL_STOCK_MOVEMENT_MISSING');
  }
  let pending = detail.returnedUnits;
  const allocations = [];
  for (const source of sources || []) {
    if (pending === 0) break;
    const sold = Math.abs(Number(source.cantidad));
    const returned = returnedBySource.get(Number(source.idMovimientoLote)) || 0;
    const available = sold - returned;
    if (available <= 0) continue;
    const quantity = Math.min(available, pending);
    allocations.push({ source, quantity });
    pending -= quantity;
  }
  if (pending !== 0) {
    throw stockError(409, 'No se pudo reconstruir el consumo original de lotes.',
      'ORIGINAL_LOT_ALLOCATION_INCOMPLETE');
  }
  return allocations;
}

async function insertSaleCompensationDetail(connection, input) {
  const [result] = await connection.query(
    `INSERT INTO detalleCompensacionVenta
     (idTienda, idCompensacionVenta, idDetalleVenta, idProducto, unidadesDevueltas,
      montoCompensado, costoCompensado, tratamientoInventario, resultadoInventario,
      idMovimientoStock, creadoEn)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'no_reintegrado', NULL, ?)`,
    [input.idTienda, input.idCompensacionVenta, input.detail.idDetalleVenta,
      input.detail.idProducto, input.detail.returnedUnits, centsToDecimal(input.detail.amountCents),
      centsToDecimal(input.detail.returnedCostCents), input.detail.treatment, input.now]
  );
  return Number(result.insertId);
}

async function createStockReturnMovement(connection, input) {
  const product = input.product;
  const stockBefore = product.currentStock;
  const stockAfter = stockBefore + input.detail.returnedUnits;
  const [updated] = await connection.query(
    `UPDATE producto SET stockUnidadesTotal=?, stock=?
     WHERE idTienda=? AND idProducto=? AND stockUnidadesTotal=?`,
    [stockAfter, stockAfter, input.idTienda, product.idProducto, stockBefore]
  );
  if (!updated.affectedRows) {
    throw stockError(409, 'El stock cambio durante la compensacion.', 'STOCK_CHANGED_DURING_COMPENSATION');
  }
  product.currentStock = stockAfter;
  return insertStockMovement(connection, {
    idTienda: input.idTienda,
    idProducto: product.idProducto,
    tipoMovimiento: 'ajuste_positivo',
    origen: 'correccion_sistema',
    cantidad: input.detail.returnedUnits,
    stockAnterior: stockBefore,
    stockPosterior: stockAfter,
    cantidadOperacion: input.detail.returnedUnits,
    unidadOperacion: 'unidad_base',
    motivo: 'Compensacion de venta.',
    observacion: `Motivo controlado: ${input.reason}.`,
    referenciaTipo: 'detalle_compensacion_venta',
    referenciaId: input.idDetalleCompensacionVenta,
    claveOperacion: movementKey('compensacion-venta', `${input.idOperacionCompensatoria}:d${input.detail.idDetalleVenta}`),
    idAdministrador: input.idAdministrador,
    creadoEn: input.now
  });
}

function originalLotIsSellable(source, quantity, today) {
  return source.estadoOperativo === 'disponible'
    && source.clasificacionInventario === 'vendible'
    && (!source.fechaVencimiento || databaseLocalDate(source.fechaVencimiento) >= today)
    && Number(source.cantidadRestante) + quantity <= Number(source.cantidadInicial);
}

async function createBlockedReversalLot(connection, input) {
  const source = input.allocation.source;
  const quantity = input.allocation.quantity;
  const lotKey = `reversion:${input.idOperacionCompensatoria}:ml:${source.idMovimientoLote}`;
  const hasClassification = await supportsInventoryClassification(connection);
  const classificationColumn = hasClassification ? ', clasificacionInventario' : '';
  const classificationValue = hasClassification ? ", 'tecnico'" : '';
  const [lot] = await connection.query(
    `INSERT INTO loteProducto
     (idTienda, idProducto, idProveedor, idDetalleCompra, codigoLote, origen,
      fechaIngreso, fechaVencimiento, cantidadInicial, cantidadRestante, costoUnitarioBase,
      estadoOperativo${classificationColumn}, claveOperacion, creadoEn, actualizadoEn,
      idAdministradorCrea, idAdministradorActualiza)
     VALUES (?, ?, ?, NULL, NULL, 'reversion', ?, ?, ?, ?, ?, 'bloqueado'${classificationValue}, ?, ?, ?, ?, ?)`,
    [input.idTienda, input.idProducto, source.idProveedor || null, source.fechaIngreso,
      databaseLocalDate(source.fechaVencimiento), quantity, quantity, source.costoUnitarioBase,
      lotKey, input.now, input.now, input.idAdministrador, input.idAdministrador]
  );
  return Number(lot.insertId);
}

async function applyLotReturn(connection, input) {
  const today = formatLocalDate(input.nowDate);
  const records = [];
  for (const allocation of input.allocations) {
    const source = allocation.source;
    let destinationLotId = null;
    let result = 'no_reintegrado';
    let movementId = null;
    if (input.detail.treatment !== 'no_reintegrar') {
      const restoreOriginal = input.detail.treatment === 'reintegrar_vendible'
        && originalLotIsSellable(source, allocation.quantity, today);
      if (restoreOriginal) {
        const before = Number(source.cantidadRestante);
        const after = before + allocation.quantity;
        const [updated] = await connection.query(
          `UPDATE loteProducto
           SET cantidadRestante=?, actualizadoEn=?, idAdministradorActualiza=?
           WHERE idTienda=? AND idProducto=? AND idLoteProducto=? AND cantidadRestante=?`,
          [after, input.now, input.idAdministrador, input.idTienda, input.detail.idProducto,
            source.idLoteProducto, before]
        );
        if (!updated.affectedRows) {
          throw stockError(409, 'El lote original cambio durante la compensacion.',
            'LOT_CHANGED_DURING_COMPENSATION');
        }
        source.cantidadRestante = after;
        destinationLotId = Number(source.idLoteProducto);
        result = 'reintegrado_lote_original';
        movementId = await insertLotMovement(connection, {
          idTienda: input.idTienda,
          idProducto: input.detail.idProducto,
          idLoteProducto: destinationLotId,
          idMovimientoStock: input.idMovimientoStock,
          tipoRegistro: 'movimiento_stock',
          cantidad: allocation.quantity,
          cantidadAnterior: before,
          cantidadPosterior: after,
          claveOperacion: `ml:compensacion:${input.idOperacionCompensatoria}:src:${source.idMovimientoLote}`,
          creadoEn: input.now,
          idAdministrador: input.idAdministrador
        });
      } else {
        destinationLotId = await createBlockedReversalLot(connection, {
          ...input,
          idProducto: input.detail.idProducto,
          allocation
        });
        result = 'aislado_lote_tecnico';
        movementId = await insertLotMovement(connection, {
          idTienda: input.idTienda,
          idProducto: input.detail.idProducto,
          idLoteProducto: destinationLotId,
          idMovimientoStock: input.idMovimientoStock,
          tipoRegistro: 'movimiento_stock',
          cantidad: allocation.quantity,
          cantidadAnterior: 0,
          cantidadPosterior: allocation.quantity,
          claveOperacion: `ml:compensacion:${input.idOperacionCompensatoria}:src:${source.idMovimientoLote}`,
          creadoEn: input.now,
          idAdministrador: input.idAdministrador
        });
      }
    }
    await connection.query(
      `INSERT INTO detalleCompensacionLote
       (idTienda, idProducto, idDetalleCompensacionVenta, idMovimientoLoteSalida,
        idLoteProductoOrigen, idLoteProductoDestino, idMovimientoLoteCompensatorio,
        unidadesDevueltas, resultadoInventario, costoUnitarioHistorico,
        fechaVencimientoHistorica, creadoEn)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [input.idTienda, input.detail.idProducto, input.idDetalleCompensacionVenta,
        source.idMovimientoLote, source.idLoteProducto, destinationLotId, movementId,
        allocation.quantity, result, source.costoUnitarioBase,
        databaseLocalDate(source.fechaVencimiento), input.now]
    );
    records.push(result);
  }
  if (records.includes('aislado_lote_tecnico')) return 'aislado_lote_tecnico';
  if (records.includes('reintegrado_lote_original')) return 'reintegrado_lote_original';
  return 'no_reintegrado';
}

async function pendingDebtAllocations(connection, idTienda, idVenta) {
  const [rows] = await connection.query(
    `SELECT lcv.montoReduccionDeudaPendiente
     FROM compensacionVenta cv
     JOIN liquidacionCompensacionVenta lcv
       ON lcv.idTienda=cv.idTienda
      AND lcv.idCompensacionVenta=cv.idCompensacionVenta
     WHERE cv.idTienda=? AND cv.idVenta=? AND lcv.estado='pendiente_c3'
     ORDER BY lcv.idLiquidacionCompensacionVenta
     FOR UPDATE`,
    [idTienda, idVenta]
  );
  return rows.reduce(
    (sum, row) => sum + moneyToCents(row.montoReduccionDeudaPendiente, 'La liquidacion previa'), 0
  );
}

async function executeCompensation(connection, input, dependencies) {
  const nowDate = dependencies.now();
  const now = formatLocalDateTime(nowDate);
  const { sale, details } = await lockSaleHistory(
    connection, input.idTienda, input.request.idVenta
  );
  const operation = await lockOperation(connection, input, input.idAdministrador, now);
  if (operation.repeated) return operation.result;
  if (sale.estadoOperacion === 'anulada') {
    throw stockError(409, 'La venta ya esta anulada.', 'SALE_ALREADY_CANCELLED');
  }
  const returned = await priorReturns(connection, input.idTienda, sale.idVenta);
  const requestedDetails = buildRequestedDetails(input.request, details, returned);
  requestedDetails.forEach((detail) => { detail.idVenta = Number(sale.idVenta); });
  const products = await lockProducts(connection, input.idTienda, requestedDetails);
  requestedDetails.forEach((detail) => { detail.product = products.get(Number(detail.idProducto)); });
  const stockMovements = await lockOriginalStockMovements(
    connection, input.idTienda, requestedDetails
  );
  const sourceContext = await lotSources(connection, input.idTienda, requestedDetails, stockMovements);
  const totalAmountCents = requestedDetails.reduce((sum, detail) => sum + detail.amountCents, 0);
  const totalCostCents = requestedDetails.reduce((sum, detail) => sum + detail.returnedCostCents, 0);
  const [compensation] = await connection.query(
    `INSERT INTO compensacionVenta
     (idTienda, idOperacionCompensatoria, idVenta, tipoCompensacion,
      montoCompensado, costoCompensado, creadoEn)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [input.idTienda, operation.idOperacionCompensatoria, sale.idVenta,
      input.request.tipoCompensacion, centsToDecimal(totalAmountCents),
      centsToDecimal(totalCostCents), now]
  );
  const idCompensacionVenta = Number(compensation.insertId);
  const priorDebtCents = await pendingDebtAllocations(connection, input.idTienda, sale.idVenta);
  const currentDebtCents = moneyToCents(sale.saldoPendiente, 'El saldo pendiente de la venta');
  const availableDebtCents = Math.max(0, currentDebtCents - priorDebtCents);
  const debtReductionCents = Math.min(totalAmountCents, availableDebtCents);
  const refundCents = totalAmountCents - debtReductionCents;
  await connection.query(
    `INSERT INTO liquidacionCompensacionVenta
     (idTienda, idCompensacionVenta, montoCompensado, montoReduccionDeudaPendiente,
      montoReembolsoPendiente, estado, creadoEn, resueltoEn)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
    [input.idTienda, idCompensacionVenta, centsToDecimal(totalAmountCents),
      centsToDecimal(debtReductionCents), centsToDecimal(refundCents),
      totalAmountCents === 0 ? 'sin_efecto' : 'pendiente_c3', now]
  );

  for (const detail of requestedDetails) {
    const idDetalleCompensacionVenta = await insertSaleCompensationDetail(connection, {
      idTienda: input.idTienda,
      idCompensacionVenta,
      detail,
      now
    });
    let idMovimientoStock = null;
    let inventoryResult = 'no_reintegrado';
    const stockMovement = stockMovements.get(Number(detail.idDetalleVenta));
    if (Number(detail.product.controlaLotes) === 1) {
      const sources = sourceContext.sourcesByMovement.get(Number(stockMovement?.idMovimientoStock));
      const allocations = allocateLotSources(
        detail, stockMovement, sources, sourceContext.returnedBySource
      );
      if (detail.treatment !== 'no_reintegrar') {
        idMovimientoStock = await createStockReturnMovement(connection, {
          idTienda: input.idTienda,
          idOperacionCompensatoria: operation.idOperacionCompensatoria,
          idDetalleCompensacionVenta,
          idAdministrador: input.idAdministrador,
          detail,
          product: detail.product,
          reason: input.request.motivoCodigo,
          now
        });
      }
      inventoryResult = await applyLotReturn(connection, {
        idTienda: input.idTienda,
        idOperacionCompensatoria: operation.idOperacionCompensatoria,
        idDetalleCompensacionVenta,
        idMovimientoStock,
        idAdministrador: input.idAdministrador,
        detail,
        allocations,
        now,
        nowDate
      });
    } else if (detail.treatment === 'reintegrar_vendible') {
      idMovimientoStock = await createStockReturnMovement(connection, {
        idTienda: input.idTienda,
        idOperacionCompensatoria: operation.idOperacionCompensatoria,
        idDetalleCompensacionVenta,
        idAdministrador: input.idAdministrador,
        detail,
        product: detail.product,
        reason: input.request.motivoCodigo,
        now
      });
      inventoryResult = 'reintegrado_stock';
    } else if (detail.treatment === 'aislar_no_vendible') {
      inventoryResult = 'aislado_no_vendible';
    }
    await connection.query(
      `UPDATE detalleCompensacionVenta
       SET resultadoInventario=?, idMovimientoStock=?
       WHERE idTienda=? AND idDetalleCompensacionVenta=?`,
      [inventoryResult, idMovimientoStock, input.idTienda, idDetalleCompensacionVenta]
    );
  }

  if (typeof dependencies.afterInventory === 'function') {
    await dependencies.afterInventory({ connection, idCompensacionVenta });
  }
  const newReturned = new Map(returned);
  for (const detail of requestedDetails) {
    newReturned.set(Number(detail.idDetalleVenta), detail.cumulativeUnits);
  }
  const fullyReturned = details.every(
    (detail) => (newReturned.get(Number(detail.idDetalleVenta)) || 0) === detail.soldUnits
  );
  const saleState = fullyReturned ? 'anulada' : 'devuelta_parcial';
  await connection.query(
    `UPDATE venta SET estadoOperacion=?
     WHERE idTienda=? AND idVenta=?`,
    [saleState, input.idTienda, sale.idVenta]
  );
  await connection.query(
    `UPDATE operacionCompensatoria
     SET estado='aplicada', fechaAplicacion=?, actualizadoEn=?
     WHERE idTienda=? AND idOperacionCompensatoria=? AND estado='solicitada'`,
    [now, now, input.idTienda, operation.idOperacionCompensatoria]
  );
  return loadCompensationResult(
    connection, input.idTienda, operation.idOperacionCompensatoria, false
  );
}

function createSaleCompensationService(dependencies = {}) {
  const servicePool = dependencies.pool || pool;
  const auditService = dependencies.auditService || administrativeAuditService;
  const runtime = {
    now: dependencies.now || (() => new Date()),
    afterInventory: dependencies.afterInventory
  };
  return {
    async compensateSale(input) {
      const request = normalizeRequest(input.idVenta, input.body);
      const idTienda = positiveId(input.idTienda, 'La tienda');
      const idAdministrador = positiveId(input.idAdministrador, 'El administrador');
      const connection = await servicePool.getConnection();
      try {
        await connection.beginTransaction();
        const result = await executeCompensation(connection, {
          idTienda,
          idAdministrador,
          request
        }, runtime);
        if (!result.repetida && input.requestId) {
          const treatments = new Set(result.detalles.map((detail) => detail.tratamientoInventario));
          await auditService.recordCritical(connection, {
            storeId: idTienda,
            actorType: 'administrador',
            administratorId: idAdministrador,
            action: 'compensacion_venta',
            result: 'correcto',
            resultCode: 'COMMERCIAL_OPERATION_OK',
            origin: 'web',
            reference: `operacion_compensatoria:${result.idOperacionCompensatoria}`,
            requestId: input.requestId,
            after: { estadoOperacion: result.estadoOperacionVenta },
            metadata: {
              tipoOperacion: result.tipoCompensacion,
              tratamientoInventario: treatments.size === 1 ? [...treatments][0] : 'mixto'
            }
          });
        }
        await connection.commit();
        return result;
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    }
  };
}

const defaultService = createSaleCompensationService();

module.exports = {
  allocateLineAmounts,
  createSaleCompensationService,
  normalizeRequest,
  compensateSale: (input) => defaultService.compensateSale(input)
};
