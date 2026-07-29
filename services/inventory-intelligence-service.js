const {
  addLocalDays,
  formatLocalDate,
  formatLocalDateTime,
  getLocalNow,
  parseLocalDate,
  parseLocalDateTime
} = require('../utils/local-datetime');
const { inventoryReconciliationSnapshot } = require('./inventory-reconciliation-service');

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_RANGE_DAYS = 365;
const MAX_PAGE_SIZE = 100;
const MAX_ANALYSIS_ROWS = 5000;
const INVENTORY_STATES = new Set(['agotado', 'bajo', 'en_minimo', 'suficiente', 'inactivo']);
const SUGGESTION_STATES = new Set(['urgente', 'recomendada', 'suficiente', 'exceso', 'sin_datos']);
const ALERT_PRIORITIES = new Set(['info', 'warning', 'critical']);
const ALERT_TYPES = new Set([
  'stock_vendible_bajo', 'sin_stock_vendible', 'exceso_inventario',
  'baja_rotacion', 'sin_movimiento', 'proximo_vencimiento', 'vencido',
  'stock_no_vendible_alto', 'conciliacion'
]);
const ROTATION_WINDOWS = new Set([7, 30, 90]);
const EXPIRATION_WARNING_DAYS = 7;
const HIGH_UNSELLABLE_PERCENT = 25;
const SUGGESTED_PRESENTATIONS = new Set(['unidad', 'paquete']);
const STORE_CONFIG_FIELDS = Object.freeze([
  'periodoAnalisisDias',
  'diasHistorialMinimo',
  'diasReposicionDefault',
  'diasCoberturaDefault',
  'diasProductoNuevo'
]);
const PRODUCT_CONFIG_FIELDS = Object.freeze([
  'diasReposicion',
  'diasCoberturaObjetivo',
  'presentacionCompraSugerida'
]);

function inventoryError(status, message, code) {
  const error = new Error(message);
  error.status = status;
  if (code) error.code = code;
  return error;
}

function positiveId(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) throw inventoryError(400, `${label} no es valido.`);
  return number;
}

function boundedInteger(value, label, minimum, maximum, { nullable = false } = {}) {
  if (nullable && (value === null || value === '')) return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum || number > maximum) {
    throw inventoryError(400, `${label} debe ser un entero entre ${minimum} y ${maximum}.`);
  }
  return number;
}

function localDate(value, label, { endOfDate = false } = {}) {
  if (value === undefined || value === null || value === '') return null;
  const text = String(value).trim();
  try {
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
      const date = parseLocalDate(text);
      return endOfDate ? addLocalDays(date, 1) : date;
    }
    return parseLocalDateTime(text);
  } catch {
    throw inventoryError(400, `${label} no es una fecha valida.`);
  }
}

function mysqlDate(value) {
  if (!value) return null;
  if (value instanceof Date) return formatLocalDateTime(value);
  return String(value).slice(0, 19).replace('T', ' ');
}

function dateObject(value) {
  const text = mysqlDate(value);
  if (!text) return null;
  try {
    return parseLocalDateTime(text.slice(0, 19));
  } catch {
    return null;
  }
}

function daysBetween(start, end) {
  if (!start || !end) return 0;
  return Math.max(0, (end.getTime() - start.getTime()) / DAY_MS);
}

function round(value, decimals = 2) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return null;
  const factor = 10 ** decimals;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
}

function cents(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number * 100) : 0;
}

function money(centsValue) {
  return round(centsValue / 100, 2);
}

function safeCentsProduct(quantity, unitCents, label) {
  const result = Number(quantity) * Number(unitCents);
  if (!Number.isSafeInteger(result)) {
    throw inventoryError(422, `${label} supera la precision monetaria permitida.`);
  }
  return result;
}

function safeCentsSum(total, value, label) {
  const result = total + value;
  if (!Number.isSafeInteger(result)) {
    throw inventoryError(422, `${label} supera la precision monetaria permitida.`);
  }
  return result;
}

function pagination(query = {}, maximum = MAX_PAGE_SIZE) {
  const rawPage = query.pagina ?? query.page;
  const rawLimit = query.limite ?? query.limit;
  const pagina = rawPage === undefined || rawPage === '' ? 1 : Number(rawPage);
  const limite = rawLimit === undefined || rawLimit === '' ? 30 : Number(rawLimit);
  if (!Number.isInteger(pagina) || pagina <= 0) throw inventoryError(400, 'La pagina debe ser un entero positivo.');
  if (!Number.isInteger(limite) || limite <= 0 || limite > maximum) {
    throw inventoryError(400, `El limite debe ser un entero entre 1 y ${maximum}.`);
  }
  return { pagina, limite, offset: (pagina - 1) * limite };
}

function paginate(rows, query = {}, maximum = MAX_PAGE_SIZE) {
  const page = pagination(query, maximum);
  return {
    ...page,
    total: rows.length,
    paginas: Math.max(1, Math.ceil(rows.length / page.limite)),
    rows: rows.slice(page.offset, page.offset + page.limite)
  };
}

async function loadInventoryConfiguration(connection, idTienda) {
  const [rows] = await connection.query(
    `SELECT periodoAnalisisDias, diasHistorialMinimo, diasReposicionDefault,
            diasCoberturaDefault, diasProductoNuevo, creadoEn, actualizadoEn
     FROM configuracionInventarioTienda WHERE idTienda=?`,
    [idTienda]
  );
  if (!rows.length) {
    throw inventoryError(500, 'La tienda no tiene configuracion de inventario.', 'MISSING_INVENTORY_CONFIGURATION');
  }
  return {
    ...rows[0],
    creadoEn: mysqlDate(rows[0].creadoEn),
    actualizadoEn: mysqlDate(rows[0].actualizadoEn)
  };
}

async function ensureInventoryConfiguration(connection, idTienda, localDateTime) {
  await connection.query(
    `INSERT INTO configuracionInventarioTienda
      (idTienda, periodoAnalisisDias, diasHistorialMinimo, diasReposicionDefault,
       diasCoberturaDefault, diasProductoNuevo, creadoEn, actualizadoEn)
     VALUES (?, 30, 14, 3, 14, 30, ?, ?)
     ON DUPLICATE KEY UPDATE idTienda=VALUES(idTienda)`,
    [idTienda, localDateTime, localDateTime]
  );
}

function analysisRange(query, configuration) {
  const requestedWindow = query.ventana === undefined || query.ventana === ''
    ? null : Number(query.ventana);
  if (requestedWindow !== null && (!Number.isInteger(requestedWindow) || !ROTATION_WINDOWS.has(requestedWindow))) {
    throw inventoryError(400, 'La ventana debe ser 7, 30 o 90 dias.', 'INVALID_INVENTORY_WINDOW');
  }
  const requestedEnd = localDate(query.hasta, 'La fecha hasta', { endOfDate: true });
  const end = requestedEnd || getLocalNow();
  const requestedStart = localDate(query.desde, 'La fecha desde');
  if (requestedWindow !== null && requestedStart) {
    throw inventoryError(400, 'Use una ventana o una fecha desde, no ambos filtros.', 'INVALID_INVENTORY_WINDOW');
  }
  const configuredStart = addLocalDays(end, -(requestedWindow || Number(configuration.periodoAnalisisDias)));
  if (requestedStart && requestedStart >= end) {
    throw inventoryError(400, 'La fecha desde debe ser anterior a la fecha hasta.');
  }
  const requestedDuration = requestedStart ? daysBetween(requestedStart, end) : Number(configuration.periodoAnalisisDias);
  if (requestedDuration > MAX_RANGE_DAYS + 0.0001) {
    throw inventoryError(400, `El rango no puede superar ${MAX_RANGE_DAYS} dias.`);
  }
  const start = requestedStart && requestedStart > configuredStart ? requestedStart : configuredStart;
  const duration = daysBetween(start, end);
  return {
    inicio: formatLocalDateTime(start),
    finExclusivo: formatLocalDateTime(end),
    desde: formatLocalDateTime(start),
    hastaExclusivo: formatLocalDateTime(end),
    dias: round(duration, 4),
    ventana: requestedWindow,
    limitadoPorConfiguracion: Boolean(requestedStart && requestedStart < configuredStart),
    start,
    end
  };
}

async function validatedFilters(connection, idTienda, query = {}) {
  const filters = { categoria: null, idProveedor: null, idProducto: null, estado: null };
  if (query.categoria !== undefined && query.categoria !== '') {
    filters.categoria = String(query.categoria).trim();
    if (!filters.categoria || filters.categoria.length > 50) {
      throw inventoryError(400, 'La categoria no es valida o supera 50 caracteres.');
    }
  }
  if (query.proveedor !== undefined || query.idProveedor !== undefined) {
    filters.idProveedor = positiveId(query.proveedor ?? query.idProveedor, 'El proveedor');
    const [rows] = await connection.query(
      'SELECT idProveedor FROM proveedor WHERE idTienda=? AND idProveedor=?',
      [idTienda, filters.idProveedor]
    );
    if (!rows.length) throw inventoryError(404, 'El proveedor no pertenece a la tienda.');
  }
  if (query.producto !== undefined || query.idProducto !== undefined) {
    filters.idProducto = positiveId(query.producto ?? query.idProducto, 'El producto');
    const [rows] = await connection.query(
      'SELECT idProducto FROM producto WHERE idTienda=? AND idProducto=?',
      [idTienda, filters.idProducto]
    );
    if (!rows.length) throw inventoryError(404, 'El producto no pertenece a la tienda.');
  }
  if (query.estado !== undefined && query.estado !== '') {
    filters.estado = String(query.estado).trim().toLowerCase();
    if (!INVENTORY_STATES.has(filters.estado)) throw inventoryError(400, 'El estado de inventario no es valido.');
  }
  return filters;
}

function productConditions(filters, { activeOnly = true } = {}) {
  const conditions = ['p.idTienda=?'];
  const params = [];
  if (filters.estado === 'inactivo') conditions.push('p.activo=0');
  else if (activeOnly) conditions.push('p.activo=1');
  if (filters.categoria) { conditions.push('p.categoria=?'); params.push(filters.categoria); }
  if (filters.idProveedor) { conditions.push('p.idProveedor=?'); params.push(filters.idProveedor); }
  if (filters.idProducto) { conditions.push('p.idProducto=?'); params.push(filters.idProducto); }
  return { conditions, params };
}

async function fetchAnalysisRows(connection, idTienda, range, filters, options = {}) {
  const where = productConditions(filters, options);
  const [rows] = await connection.query(
    `SELECT p.idProducto, p.nombre, p.categoria, p.idProveedor,
            pr.nombre proveedor, p.unidadMedida, p.unidadesPorPaquete,
            p.permiteVentaPorPaquete, p.stockUnidadesTotal, p.stockMinimo,
            p.controlaLotes,
            p.precioVenta, p.ultimoPrecioCompra, p.activo AS productoActivo,
            p.diasReposicion, p.diasCoberturaObjetivo, p.presentacionCompraSugerida,
            p.fechaInicioSeguimiento,
            COALESCE(s.unidadesVendidasPeriodo,0) unidadesVendidasPeriodo,
            COALESCE(s.ingresosPeriodo,0) ingresosPeriodo,
            COALESCE(s.ventasPeriodo,0) ventasPeriodo,
            s.ultimaVenta,
            COALESCE(m.movimientosPeriodo,0) movimientosPeriodo,
            COALESCE(m.movimientosPosteriores,0) movimientosPosteriores
     FROM producto p
     LEFT JOIN proveedor pr ON pr.idTienda=p.idTienda AND pr.idProveedor=p.idProveedor
     LEFT JOIN (
       SELECT dv.idProducto,
              SUM(CASE WHEN v.fecha>=? AND v.fecha<? AND v.fecha>=ps.fechaInicioSeguimiento
                              AND v.estadoOperacion<>'anulada'
                       THEN GREATEST(dv.cantidadEquivalenteUnidades-COALESCE(r.unidadesDevueltas,0),0) ELSE 0 END) unidadesVendidasPeriodo,
              SUM(CASE WHEN v.fecha>=? AND v.fecha<? AND v.fecha>=ps.fechaInicioSeguimiento
                              AND v.estadoOperacion<>'anulada'
                       THEN GREATEST(dv.subtotal-COALESCE(r.montoCompensado,0),0) ELSE 0 END) ingresosPeriodo,
              COUNT(DISTINCT CASE WHEN v.fecha>=? AND v.fecha<? AND v.fecha>=ps.fechaInicioSeguimiento
                                      AND v.estadoOperacion<>'anulada'
                                      AND dv.cantidadEquivalenteUnidades>COALESCE(r.unidadesDevueltas,0)
                                  THEN v.idVenta END) ventasPeriodo,
              COUNT(DISTINCT CASE WHEN v.fecha>=? AND v.fecha<? AND v.fecha>=ps.fechaInicioSeguimiento
                                      AND v.estadoOperacion<>'anulada'
                                      AND dv.cantidadEquivalenteUnidades>COALESCE(r.unidadesDevueltas,0)
                                  THEN DATE(v.fecha) END) diasConVentaPeriodo,
              MAX(CASE WHEN v.fecha<? AND v.fecha>=ps.fechaInicioSeguimiento
                            AND v.estadoOperacion<>'anulada'
                            AND dv.cantidadEquivalenteUnidades>COALESCE(r.unidadesDevueltas,0)
                       THEN v.fecha ELSE NULL END) ultimaVenta
       FROM detalleVenta dv
       JOIN venta v ON v.idTienda=dv.idTienda AND v.idVenta=dv.idVenta
       JOIN producto ps ON ps.idTienda=dv.idTienda AND ps.idProducto=dv.idProducto
       LEFT JOIN (
         SELECT dcv.idTienda, dcv.idDetalleVenta,
                SUM(dcv.unidadesDevueltas) unidadesDevueltas,
                SUM(dcv.montoCompensado) montoCompensado
         FROM detalleCompensacionVenta dcv
         JOIN compensacionVenta cv
           ON cv.idTienda=dcv.idTienda AND cv.idCompensacionVenta=dcv.idCompensacionVenta
         JOIN operacionCompensatoria oc
           ON oc.idTienda=cv.idTienda AND oc.idOperacionCompensatoria=cv.idOperacionCompensatoria
         WHERE dcv.idTienda=? AND oc.estado='aplicada'
         GROUP BY dcv.idTienda, dcv.idDetalleVenta
       ) r ON r.idTienda=dv.idTienda AND r.idDetalleVenta=dv.idDetalleVenta
       WHERE dv.idTienda=?
       GROUP BY dv.idProducto
     ) s ON s.idProducto=p.idProducto
     LEFT JOIN (
       SELECT ms.idProducto,
              SUM(CASE WHEN ms.creadoEn>=? AND ms.creadoEn<? THEN ms.cantidad ELSE 0 END) movimientosPeriodo,
              SUM(CASE WHEN ms.creadoEn>=? THEN ms.cantidad ELSE 0 END) movimientosPosteriores
       FROM movimientoStock ms
       WHERE ms.idTienda=?
       GROUP BY ms.idProducto
     ) m ON m.idProducto=p.idProducto
     WHERE ${where.conditions.join(' AND ')}
     ORDER BY p.nombre, p.idProducto
     LIMIT ?`,
    [range.inicio, range.finExclusivo, range.inicio, range.finExclusivo,
      range.inicio, range.finExclusivo, range.inicio, range.finExclusivo,
      range.finExclusivo, idTienda, idTienda,
      range.inicio, range.finExclusivo, range.finExclusivo, idTienda,
      idTienda, ...where.params, MAX_ANALYSIS_ROWS + 1]
  );
  if (rows.length > MAX_ANALYSIS_ROWS) {
    throw inventoryError(413, `El analisis supera ${MAX_ANALYSIS_ROWS} productos. Aplique filtros.`);
  }
  return rows;
}

function inventoryState(product) {
  if (Number(product.productoActivo) !== 1) return 'inactivo';
  const stock = Number(product.stockVendibleCalculado ?? product.stockUnidadesTotal);
  const minimum = Number(product.stockMinimo);
  if (stock === 0) return 'agotado';
  if (stock < minimum) return 'bajo';
  if (stock === minimum) return 'en_minimo';
  return 'suficiente';
}

function analyzeProduct(product, configuration, range) {
  const tracking = dateObject(product.fechaInicioSeguimiento) || range.start;
  const observedStart = tracking > range.start ? tracking : range.start;
  const observedDays = round(daysBetween(observedStart, range.end), 4);
  const enoughHistory = observedDays >= Number(configuration.diasHistorialMinimo);
  const soldUnits = Number(product.unidadesVendidasPeriodo) || 0;
  const averageDaily = enoughHistory && observedDays > 0 ? soldUnits / observedDays : null;
  const physicalStock = Number(product.stockUnidadesTotal);
  const currentStock = Number(product.stockVendibleCalculado ?? physicalStock);
  const restockDays = product.diasReposicion === null
    ? Number(configuration.diasReposicionDefault) : Number(product.diasReposicion);
  const coverageDays = product.diasCoberturaObjetivo === null
    ? Number(configuration.diasCoberturaDefault) : Number(product.diasCoberturaObjetivo);
  const calculatedTarget = enoughHistory
    ? Math.ceil((averageDaily || 0) * (restockDays + coverageDays)) : 0;
  const targetStock = enoughHistory
    ? Math.max(Number(product.stockMinimo), calculatedTarget)
    : Number(product.stockMinimo);
  let suggestedUnits = Math.max(0, targetStock - currentStock);
  let suggestedPresentation = product.presentacionCompraSugerida || 'unidad';
  let suggestedQuantity = suggestedUnits;
  if (suggestedPresentation === 'paquete' && Number(product.unidadesPorPaquete) > 1) {
    suggestedQuantity = Math.ceil(suggestedUnits / Number(product.unidadesPorPaquete));
    suggestedUnits = suggestedQuantity * Number(product.unidadesPorPaquete);
  } else {
    suggestedPresentation = 'unidad';
  }
  const daysRemaining = enoughHistory && averageDaily > 0 ? currentStock / averageDaily : null;
  const stockAtEnd = currentStock - Number(product.movimientosPosteriores || 0);
  const stockAtStart = stockAtEnd - Number(product.movimientosPeriodo || 0);
  const averageStock = (stockAtStart + stockAtEnd) / 2;
  const rotation = averageStock > 0 ? soldUnits / averageStock : null;
  const lastSale = dateObject(product.ultimaVenta);
  const ageDays = daysBetween(tracking, range.end);
  const daysWithoutSale = lastSale ? daysBetween(lastSale, range.end) : null;
  const salesFrequency = observedDays > 0 ? Number(product.ventasPeriodo || 0) / observedDays : 0;
  let rotationState = 'sin_movimiento';
  if (soldUnits > 0) {
    rotationState = rotation === null || rotation < 0.25 ? 'baja'
      : rotation < 1 ? 'media' : 'alta';
  }
  let movementClassification = 'con_movimiento';
  if (ageDays < Number(configuration.diasProductoNuevo)) movementClassification = 'nuevo';
  else if (!lastSale) movementClassification = 'nunca_vendido';
  else if (daysWithoutSale >= 90) movementClassification = 'sin_movimiento_90';
  else if (daysWithoutSale >= 60) movementClassification = 'sin_movimiento_60';
  else if (daysWithoutSale >= 30) movementClassification = 'sin_movimiento_30';

  const confidence = enoughHistory ? 'suficiente' : 'insuficiente';
  let reason;
  if (!enoughHistory) {
    reason = `Hay ${round(observedDays, 1)} dias observados; se usa solo el stock minimo hasta reunir ${configuration.diasHistorialMinimo} dias.`;
  } else if (averageDaily <= 0) {
    reason = suggestedUnits > 0
      ? 'No hubo demanda observable; la sugerencia solo repone el stock minimo.'
      : 'No hubo demanda observable y el stock cubre el minimo configurado.';
  } else if (suggestedUnits > 0) {
    reason = `Se cubren ${restockDays} dias de reposicion y ${coverageDays} dias de cobertura segun una demanda de ${round(averageDaily, 2)} unidades por dia.`;
  } else {
    reason = 'El stock actual ya cubre el objetivo calculado para el periodo.';
  }

  return {
    idProducto: Number(product.idProducto),
    nombre: product.nombre,
    categoria: product.categoria,
    idProveedor: product.idProveedor ? Number(product.idProveedor) : null,
    proveedor: product.proveedor || null,
    unidadBase: product.unidadMedida,
    unidadesPorPaquete: Number(product.unidadesPorPaquete),
    estadoInventario: inventoryState(product),
    stockActual: currentStock,
    stockFisico: physicalStock,
    stockVendible: currentStock,
    stockNoVendible: Math.max(0, physicalStock - currentStock),
    desgloseNoVendible: product.desgloseNoVendible || {
      vencido: 0,
      bloqueado: 0,
      aislado: 0,
      tecnico: 0
    },
    stockProximoVencer: Number(product.stockProximoVencer || 0),
    stockMinimo: Number(product.stockMinimo),
    unidadesVendidasPeriodo: soldUnits,
    ingresosPeriodo: round(product.ingresosPeriodo, 2),
    cantidadVentasPeriodo: Number(product.ventasPeriodo),
    diasConVentaPeriodo: Number(product.diasConVentaPeriodo),
    frecuenciaVentaDiaria: round(salesFrequency, 4),
    ultimaVenta: mysqlDate(product.ultimaVenta),
    diasObservados: observedDays,
    historialSuficiente: enoughHistory,
    confianza: confidence,
    promedioDiario: averageDaily === null ? null : round(averageDaily, 4),
    diasRestantes: daysRemaining === null ? null : round(daysRemaining, 2),
    stockObjetivo: targetStock,
    cantidadSugeridaUnidades: suggestedUnits,
    cantidadCompraSugerida: suggestedQuantity,
    presentacionCompraSugerida: suggestedPresentation,
    motivo: reason,
    configuracionEfectiva: {
      diasReposicion: restockDays,
      diasCoberturaObjetivo: coverageDays,
      diasHistorialMinimo: Number(configuration.diasHistorialMinimo)
    },
    stockInicioPeriodo: stockAtStart,
    stockFinPeriodo: stockAtEnd,
    stockPromedio: round(averageStock, 2),
    rotacion: rotation === null ? null : round(rotation, 4),
    clasificacionRotacion: rotationState,
    rotacionEsEstimacion: true,
    clasificacionMovimiento: movementClassification,
    diasSinVenta: daysWithoutSale === null ? null : round(daysWithoutSale, 1),
    edadSeguimientoDias: round(ageDays, 1),
    fechaInicioSeguimiento: mysqlDate(product.fechaInicioSeguimiento),
    precioVentaUnitario: round(product.precioVenta, 2),
    ultimoPrecioCompra: round(product.ultimoPrecioCompra, 2)
  };
}

async function stockAvailability(connection, idTienda) {
  const [[column]] = await connection.query(
    `SELECT COUNT(*) total
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA=DATABASE()
       AND TABLE_NAME='loteProducto'
       AND COLUMN_NAME='clasificacionInventario'`
  );
  const hasClassification = Number(column.total) === 1;
  const classification = hasClassification
    ? 'lp.clasificacionInventario'
    : "CASE WHEN lp.origen='reversion' THEN 'tecnico' WHEN lp.estadoOperativo='bloqueado' THEN 'bloqueado' ELSE 'vendible' END";
  const today = formatLocalDate();
  const warningEnd = formatLocalDate(addLocalDays(getLocalNow(), EXPIRATION_WARNING_DAYS));
  const [rows] = await connection.query(
    `SELECT lp.idProducto,
            SUM(CASE
              WHEN lp.estadoOperativo='disponible'
               AND ${classification}='vendible'
               AND (lp.fechaVencimiento IS NULL OR lp.fechaVencimiento>=?)
              THEN lp.cantidadRestante ELSE 0 END) stockVendible,
            SUM(CASE WHEN lp.estadoOperativo<>'anulado'
              AND lp.fechaVencimiento IS NOT NULL AND lp.fechaVencimiento<?
              THEN lp.cantidadRestante ELSE 0 END) vencido,
            SUM(CASE WHEN lp.estadoOperativo='disponible'
              AND ${classification}='vendible'
              AND lp.fechaVencimiento IS NOT NULL
              AND lp.fechaVencimiento>=? AND lp.fechaVencimiento<=?
              THEN lp.cantidadRestante ELSE 0 END) proximoVencer,
            SUM(CASE WHEN lp.estadoOperativo<>'anulado'
              AND ${classification}='bloqueado'
              THEN lp.cantidadRestante ELSE 0 END) bloqueado,
            SUM(CASE WHEN lp.estadoOperativo<>'anulado'
              AND ${classification}='aislado'
              THEN lp.cantidadRestante ELSE 0 END) aislado,
            SUM(CASE WHEN lp.estadoOperativo<>'anulado'
              AND ${classification}='tecnico'
              THEN lp.cantidadRestante ELSE 0 END) tecnico
     FROM loteProducto lp
     WHERE lp.idTienda=?
     GROUP BY lp.idProducto`,
    [today, today, today, warningEnd, idTienda]
  );
  return new Map(rows.map((row) => [Number(row.idProducto), {
    stockVendible: Number(row.stockVendible),
    vencido: Number(row.vencido),
    proximoVencer: Number(row.proximoVencer),
    bloqueado: Number(row.bloqueado),
    aislado: Number(row.aislado),
    tecnico: Number(row.tecnico)
  }]));
}

async function analysisContext(connection, idTienda, query = {}, options = {}) {
  const configuration = await loadInventoryConfiguration(connection, idTienda);
  const range = analysisRange(query, configuration);
  const filters = await validatedFilters(connection, idTienda, query);
  const [products, availability] = await Promise.all([
    fetchAnalysisRows(connection, idTienda, range, filters, options),
    stockAvailability(connection, idTienda)
  ]);
  const enriched = products.map((product) => {
    if (!Number(product.controlaLotes)) {
      return { ...product, stockVendibleCalculado: Number(product.stockUnidadesTotal) };
    }
    const current = availability.get(Number(product.idProducto)) || {
      stockVendible: 0, vencido: 0, proximoVencer: 0, bloqueado: 0, aislado: 0, tecnico: 0
    };
    return {
      ...product,
      stockVendibleCalculado: current.stockVendible,
      desgloseNoVendible: current,
      stockProximoVencer: current.proximoVencer
    };
  });
  const filtered = enriched.map((product) => analyzeProduct(product, configuration, range))
    .filter((product) => !filters.estado || product.estadoInventario === filters.estado);
  return {
    configuration,
    range,
    filters,
    products: filtered
  };
}

function publicRange(range) {
  return {
    desde: range.desde,
    hastaExclusivo: range.hastaExclusivo,
    dias: range.dias,
    ventana: range.ventana,
    limitadoPorConfiguracion: range.limitadoPorConfiguracion
  };
}

async function inventorySummary(connection, idTienda, query = {}) {
  const context = await analysisContext(connection, idTienda, query);
  const counts = { agotado: 0, bajo: 0, en_minimo: 0, suficiente: 0, inactivo: 0 };
  context.products.forEach((product) => { counts[product.estadoInventario] += 1; });
  const knownCost = context.products.filter((product) => product.ultimoPrecioCompra > 0);
  return {
    periodo: publicRange(context.range),
    configuracion: context.configuration,
    productosActivos: context.products.length,
    estados: counts,
    unidadesEnStock: context.products.reduce((sum, product) => sum + product.stockVendible, 0),
    stockFisico: context.products.reduce((sum, product) => sum + product.stockFisico, 0),
    stockVendible: context.products.reduce((sum, product) => sum + product.stockVendible, 0),
    stockNoVendible: context.products.reduce((sum, product) => sum + product.stockNoVendible, 0),
    productosConHistorialInsuficiente: context.products.filter((product) => !product.historialSuficiente).length,
    productosConCostoConocido: knownCost.length,
    productosConCostoDesconocido: context.products.length - knownCost.length,
    advertencias: context.products.length === 0 ? ['No hay productos activos para los filtros seleccionados.'] : []
  };
}

async function inventoryAlerts(connection, idTienda, query = {}, options = {}) {
  const context = await analysisContext(connection, idTienda, query);
  const reconciliationByProduct = new Map(
    (await inventoryReconciliationSnapshot(connection, idTienda))
      .filter((row) => row.conciliacion.estado === 'error')
      .map((row) => [row.idProducto, row.conciliacion])
  );
  const requestedPriority = query.prioridad === undefined || query.prioridad === ''
    ? null : String(query.prioridad).trim().toLowerCase();
  const requestedType = query.tipoAlerta === undefined || query.tipoAlerta === ''
    ? null : String(query.tipoAlerta).trim().toLowerCase();
  if (requestedPriority && !ALERT_PRIORITIES.has(requestedPriority)) {
    throw inventoryError(400, 'La prioridad de alerta no es valida.', 'INVALID_INVENTORY_ALERT_FILTER');
  }
  if (requestedType && !ALERT_TYPES.has(requestedType)) {
    throw inventoryError(400, 'El tipo de alerta no es valido.', 'INVALID_INVENTORY_ALERT_FILTER');
  }
  const alerts = [];
  const add = (product, tipo, prioridad, mensaje) => alerts.push({
    idProducto: product.idProducto,
    nombre: product.nombre,
    categoria: product.categoria,
    unidadBase: product.unidadBase,
    tipo,
    prioridad,
    mensaje,
    estadoInventario: product.estadoInventario,
    stockFisico: product.stockFisico,
    stockVendible: product.stockVendible,
    stockNoVendible: product.stockNoVendible,
    stockMinimo: product.stockMinimo,
    stockProximoVencer: product.stockProximoVencer,
    desgloseNoVendible: product.desgloseNoVendible,
    diasRestantes: product.diasRestantes,
    clasificacionRotacion: product.clasificacionRotacion,
    clasificacionMovimiento: product.clasificacionMovimiento
  });
  for (const product of context.products) {
    if (product.estadoInventario === 'agotado') {
      add(product, 'sin_stock_vendible', 'critical', 'No hay stock vendible disponible para la venta.');
    } else if (product.estadoInventario === 'bajo' || product.estadoInventario === 'en_minimo') {
      add(product, 'stock_vendible_bajo', product.estadoInventario === 'bajo' ? 'warning' : 'info',
        'El stock vendible esta en o por debajo del minimo configurado.');
    }
    if (product.historialSuficiente && product.promedioDiario > 0
      && product.stockVendible > Math.max(product.stockObjetivo, product.stockMinimo) * 1.5) {
      add(product, 'exceso_inventario', 'info', 'El stock vendible supera en 50% el objetivo calculado.');
    }
    if (product.clasificacionRotacion === 'baja') {
      add(product, 'baja_rotacion', 'warning', 'La rotacion neta del periodo es baja.');
    }
    if (product.clasificacionRotacion === 'sin_movimiento' && product.stockVendible > 0
      && !['nuevo', 'con_movimiento'].includes(product.clasificacionMovimiento)) {
      add(product, 'sin_movimiento', 'info', 'El producto tiene stock vendible y no registra movimiento reciente.');
    }
    if (product.stockProximoVencer > 0) {
      add(product, 'proximo_vencimiento', 'warning', `Hay mercancia vendible que vence en los proximos ${EXPIRATION_WARNING_DAYS} dias.`);
    }
    if (product.desgloseNoVendible.vencido > 0) {
      add(product, 'vencido', 'critical', 'Hay mercancia vencida que no se considera vendible.');
    }
    if (product.stockFisico > 0 && (product.stockNoVendible / product.stockFisico) * 100 >= HIGH_UNSELLABLE_PERCENT) {
      add(product, 'stock_no_vendible_alto', 'warning', 'Una parte relevante del stock fisico no esta disponible para venta.');
    }
    if (reconciliationByProduct.has(product.idProducto)) {
      add(product, 'conciliacion', 'critical', 'La conciliacion detecto una inconsistencia que requiere revision manual.');
    }
  }
  const filtered = alerts
    .filter((alert) => !requestedPriority || alert.prioridad === requestedPriority)
    .filter((alert) => !requestedType || alert.tipo === requestedType)
    .sort((a, b) => {
      const priority = { critical: 0, warning: 1, info: 2 };
      return priority[a.prioridad] - priority[b.prioridad]
        || a.nombre.localeCompare(b.nombre, 'es-BO') || a.tipo.localeCompare(b.tipo);
    });
  return { periodo: publicRange(context.range), ...paginate(filtered, query, options.maximumLimit || MAX_PAGE_SIZE) };
}

async function inventoryRanking(connection, idTienda, query = {}, options = {}) {
  const context = await analysisContext(connection, idTienda, query);
  const sold = context.products.filter((product) => product.unidadesVendidasPeriodo > 0);
  const rankingQuery = { ...query };
  if (rankingQuery.limite === undefined && rankingQuery.limit === undefined) rankingQuery.limite = 10;
  const limit = pagination(rankingQuery, options.maximumLimit || MAX_PAGE_SIZE).limite;
  const unitRow = (product) => ({
    idProducto: product.idProducto,
    nombre: product.nombre,
    categoria: product.categoria,
    unidadBase: product.unidadBase,
    unidadesVendidas: product.unidadesVendidasPeriodo,
    ingresos: product.ingresosPeriodo
  });
  return {
    periodo: publicRange(context.range),
    advertenciaUnidades: 'Compare unidades solo entre productos con la misma unidad base.',
    masVendidosUnidades: [...sold]
      .sort((a, b) => b.unidadesVendidasPeriodo - a.unidadesVendidasPeriodo || b.ingresosPeriodo - a.ingresosPeriodo)
      .slice(0, limit).map(unitRow),
    masVendidosIngresos: [...sold]
      .sort((a, b) => b.ingresosPeriodo - a.ingresosPeriodo || b.unidadesVendidasPeriodo - a.unidadesVendidasPeriodo)
      .slice(0, limit).map(unitRow),
    menosVendidos: [...sold]
      .sort((a, b) => a.unidadesVendidasPeriodo - b.unidadesVendidasPeriodo || a.ingresosPeriodo - b.ingresosPeriodo)
      .slice(0, limit).map(unitRow)
  };
}

function valuationRows(products) {
  return products.map((product) => {
    const saleValueCents = safeCentsProduct(
      product.stockActual, cents(product.precioVentaUnitario), `El valor de venta de ${product.nombre}`
    );
    const knownCost = cents(product.ultimoPrecioCompra) > 0;
    const costValueCents = knownCost
      ? safeCentsProduct(product.stockActual, cents(product.ultimoPrecioCompra), `El valor de costo de ${product.nombre}`)
      : null;
    return {
      idProducto: product.idProducto,
      nombre: product.nombre,
      categoria: product.categoria,
      stockActual: product.stockActual,
      unidadBase: product.unidadBase,
      costoConocido: knownCost,
      valorCosto: costValueCents === null ? null : money(costValueCents),
      valorVenta: money(saleValueCents),
      gananciaPotencial: costValueCents === null ? null : money(saleValueCents - costValueCents)
    };
  });
}

async function inventoryValuation(connection, idTienda, query = {}, options = {}) {
  const context = await analysisContext(connection, idTienda, query);
  const rows = valuationRows(context.products);
  const known = rows.filter((row) => row.costoConocido);
  const unknown = rows.filter((row) => !row.costoConocido);
  const sumMoneyField = (source, field, label) => source.reduce(
    (sum, row) => safeCentsSum(sum, cents(row[field]), label), 0
  );
  const summary = {
    valorCostoConocido: money(sumMoneyField(known, 'valorCosto', 'El valor total a costo')),
    valorVenta: money(sumMoneyField(rows, 'valorVenta', 'El valor total a precio de venta')),
    valorVentaConCostoConocido: money(sumMoneyField(known, 'valorVenta', 'El valor de venta con costo conocido')),
    gananciaPotencialConocida: money(sumMoneyField(known, 'gananciaPotencial', 'La ganancia potencial conocida')),
    productosConCostoConocido: known.length,
    productosConCostoDesconocido: unknown.length,
    unidadesConCostoDesconocido: unknown.reduce((sum, row) => sum + row.stockActual, 0)
  };
  return {
    periodo: publicRange(context.range),
    resumen: summary,
    ...paginate(rows, query, options.maximumLimit || MAX_PAGE_SIZE)
  };
}

async function suggestedPurchases(connection, idTienda, query = {}, options = {}) {
  const context = await analysisContext(connection, idTienda, query);
  const requestedState = query.estadoSugerencia === undefined || query.estadoSugerencia === ''
    ? 'accionables' : String(query.estadoSugerencia).trim().toLowerCase();
  if (requestedState !== 'accionables' && requestedState !== 'todos' && !SUGGESTION_STATES.has(requestedState)) {
    throw inventoryError(400, 'El estado de sugerencia no es valido.', 'INVALID_PURCHASE_SUGGESTION_FILTER');
  }
  const classified = context.products.filter((product) => product.estadoInventario !== 'inactivo').map((product) => {
    let estadoSugerencia = 'suficiente';
    if (!product.historialSuficiente) estadoSugerencia = 'sin_datos';
    else if (product.historialSuficiente && product.promedioDiario > 0
      && product.stockVendible > Math.max(product.stockObjetivo, product.stockMinimo) * 1.5) estadoSugerencia = 'exceso';
    else if (product.cantidadSugeridaUnidades > 0
      && (product.stockVendible === 0 || product.diasRestantes === null
        || product.diasRestantes <= product.configuracionEfectiva.diasReposicion)) estadoSugerencia = 'urgente';
    else if (product.cantidadSugeridaUnidades > 0) estadoSugerencia = 'recomendada';
    return { ...product, estadoSugerencia };
  });
  const suggestions = classified
    .filter((product) => requestedState === 'todos'
      || (requestedState === 'accionables'
        ? ['urgente', 'recomendada'].includes(product.estadoSugerencia)
          || (product.estadoSugerencia === 'sin_datos' && product.cantidadSugeridaUnidades > 0)
        : product.estadoSugerencia === requestedState))
    .sort((a, b) => {
      const order = { urgente: 0, recomendada: 1, sin_datos: 2, exceso: 3, suficiente: 4 };
      return order[a.estadoSugerencia] - order[b.estadoSugerencia]
        || a.nombre.localeCompare(b.nombre, 'es-BO') || a.idProducto - b.idProducto;
    });
  const resumen = classified.reduce((result, product) => {
    result[product.estadoSugerencia] += 1;
    return result;
  }, { urgente: 0, recomendada: 0, suficiente: 0, exceso: 0, sin_datos: 0 });
  return {
    periodo: publicRange(context.range),
    resumen,
    ...paginate(suggestions, query, options.maximumLimit || MAX_PAGE_SIZE)
  };
}

async function inventoryRotation(connection, idTienda, query = {}, options = {}) {
  const context = await analysisContext(connection, idTienda, query);
  const rows = context.products.map((product) => ({
    idProducto: product.idProducto,
    nombre: product.nombre,
    categoria: product.categoria,
    unidadBase: product.unidadBase,
    unidadesVendidasPeriodo: product.unidadesVendidasPeriodo,
    cantidadVentasPeriodo: product.cantidadVentasPeriodo,
    diasConVentaPeriodo: product.diasConVentaPeriodo,
    frecuenciaVentaDiaria: product.frecuenciaVentaDiaria,
    ultimaVenta: product.ultimaVenta,
    stockInicioPeriodo: product.stockInicioPeriodo,
    stockFinPeriodo: product.stockFinPeriodo,
    stockPromedio: product.stockPromedio,
    rotacion: product.rotacion,
    clasificacionRotacion: product.clasificacionRotacion,
    stockFisico: product.stockFisico,
    stockVendible: product.stockVendible,
    stockNoVendible: product.stockNoVendible,
    diasRestantes: product.diasRestantes,
    diasObservados: product.diasObservados,
    historialSuficiente: product.historialSuficiente,
    confianza: product.confianza,
    motivo: product.motivo,
    configuracionEfectiva: product.configuracionEfectiva,
    advertencia: product.rotacion === null ? 'No hay stock promedio positivo para estimar la rotacion.' : null,
    estimacion: true
  }));
  return { periodo: publicRange(context.range), ...paginate(rows, query, options.maximumLimit || MAX_PAGE_SIZE) };
}

async function inventoryWithoutMovement(connection, idTienda, query = {}, options = {}) {
  const context = await analysisContext(connection, idTienda, query);
  const rows = context.products.filter((product) => product.clasificacionMovimiento !== 'con_movimiento');
  return { periodo: publicRange(context.range), ...paginate(rows, query, options.maximumLimit || MAX_PAGE_SIZE) };
}

async function inventoryConfiguration(connection, idTienda, query = {}) {
  const configuration = await loadInventoryConfiguration(connection, idTienda);
  const filters = await validatedFilters(connection, idTienda, query);
  const where = productConditions(filters, { activeOnly: false });
  const [products] = await connection.query(
    `SELECT p.idProducto, p.nombre, p.activo AS productoActivo,
            p.diasReposicion, p.diasCoberturaObjetivo,
            p.presentacionCompraSugerida, p.fechaInicioSeguimiento, p.unidadesPorPaquete,
            COALESCE(p.diasReposicion, ?) diasReposicionEfectivo,
            COALESCE(p.diasCoberturaObjetivo, ?) diasCoberturaObjetivoEfectivo,
            COALESCE(p.presentacionCompraSugerida, 'unidad') presentacionCompraSugeridaEfectiva
     FROM producto p WHERE ${where.conditions.join(' AND ')}
     ORDER BY p.nombre, p.idProducto LIMIT ?`,
    [configuration.diasReposicionDefault, configuration.diasCoberturaDefault,
      idTienda, ...where.params, MAX_ANALYSIS_ROWS + 1]
  );
  if (products.length > MAX_ANALYSIS_ROWS) throw inventoryError(413, 'La configuracion supera el limite de productos.');
  return {
    configuracionTienda: configuration,
    productos: paginate(products.map((product) => ({
      ...product,
      fechaInicioSeguimiento: mysqlDate(product.fechaInicioSeguimiento)
    })), query)
  };
}

function validatedStoreConfiguration(body, current) {
  const values = {};
  for (const field of STORE_CONFIG_FIELDS) {
    values[field] = body[field] === undefined
      ? Number(current[field])
      : boundedInteger(body[field], field, field === 'periodoAnalisisDias' ? 7 : field === 'diasReposicionDefault' ? 0 : 1, 365);
  }
  if (values.diasHistorialMinimo > values.periodoAnalisisDias) {
    throw inventoryError(400, 'Los dias de historial minimo no pueden superar el periodo de analisis.');
  }
  return values;
}

async function updateInventoryConfiguration(connection, idTienda, idAdministrador, body = {}) {
  const current = await loadInventoryConfiguration(connection, idTienda);
  const values = validatedStoreConfiguration(body, current);
  const updatedAt = formatLocalDateTime();
  const [result] = await connection.query(
    `UPDATE configuracionInventarioTienda
     SET periodoAnalisisDias=?, diasHistorialMinimo=?, diasReposicionDefault=?,
         diasCoberturaDefault=?, diasProductoNuevo=?, actualizadoEn=?, idAdministradorActualiza=?
     WHERE idTienda=?`,
    [values.periodoAnalisisDias, values.diasHistorialMinimo, values.diasReposicionDefault,
      values.diasCoberturaDefault, values.diasProductoNuevo, updatedAt, idAdministrador, idTienda]
  );
  if (!result.affectedRows) throw inventoryError(404, 'La configuracion de inventario no existe.');
  return loadInventoryConfiguration(connection, idTienda);
}

async function updateProductInventoryConfiguration(connection, idTienda, idProducto, body = {}) {
  idProducto = positiveId(idProducto, 'El producto');
  const supplied = PRODUCT_CONFIG_FIELDS.filter((field) => Object.prototype.hasOwnProperty.call(body, field));
  if (!supplied.length) throw inventoryError(400, 'No se enviaron campos de configuracion permitidos.');
  const [products] = await connection.query(
    `SELECT idProducto, unidadesPorPaquete FROM producto
     WHERE idTienda=? AND idProducto=?`,
    [idTienda, idProducto]
  );
  if (!products.length) throw inventoryError(404, 'El producto no pertenece a la tienda.');
  const values = {};
  if (supplied.includes('diasReposicion')) {
    values.diasReposicion = boundedInteger(body.diasReposicion, 'diasReposicion', 0, 365, { nullable: true });
  }
  if (supplied.includes('diasCoberturaObjetivo')) {
    values.diasCoberturaObjetivo = boundedInteger(
      body.diasCoberturaObjetivo, 'diasCoberturaObjetivo', 1, 365, { nullable: true }
    );
  }
  if (supplied.includes('presentacionCompraSugerida')) {
    const presentation = body.presentacionCompraSugerida === null || body.presentacionCompraSugerida === ''
      ? null : String(body.presentacionCompraSugerida).trim().toLowerCase();
    if (presentation !== null && !SUGGESTED_PRESENTATIONS.has(presentation)) {
      throw inventoryError(400, 'La presentacion sugerida no es valida.');
    }
    if (presentation === 'paquete' && Number(products[0].unidadesPorPaquete) <= 1) {
      throw inventoryError(400, 'El producto no tiene una equivalencia de paquete valida.');
    }
    values.presentacionCompraSugerida = presentation;
  }
  const assignments = Object.keys(values).map((field) => `${field}=?`);
  const params = Object.values(values);
  await connection.query(
    `UPDATE producto SET ${assignments.join(', ')} WHERE idTienda=? AND idProducto=?`,
    [...params, idTienda, idProducto]
  );
  const [rows] = await connection.query(
    `SELECT idProducto, diasReposicion, diasCoberturaObjetivo, presentacionCompraSugerida,
            fechaInicioSeguimiento
     FROM producto WHERE idTienda=? AND idProducto=?`,
    [idTienda, idProducto]
  );
  return { ...rows[0], fechaInicioSeguimiento: mysqlDate(rows[0].fechaInicioSeguimiento) };
}

module.exports = {
  MAX_ANALYSIS_ROWS,
  MAX_PAGE_SIZE,
  analysisContext,
  analysisRange,
  ensureInventoryConfiguration,
  inventoryAlerts,
  inventoryConfiguration,
  inventoryError,
  inventoryRanking,
  inventoryRotation,
  inventorySummary,
  inventoryValuation,
  inventoryWithoutMovement,
  loadInventoryConfiguration,
  mysqlDate,
  positiveId,
  suggestedPurchases,
  updateInventoryConfiguration,
  updateProductInventoryConfiguration,
  valuationRows,
  stockAvailability
};
