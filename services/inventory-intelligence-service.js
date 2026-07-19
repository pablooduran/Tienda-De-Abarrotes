const { formatLocalDateTime } = require('../utils/local-datetime');

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_RANGE_DAYS = 365;
const MAX_PAGE_SIZE = 100;
const MAX_ANALYSIS_ROWS = 5000;
const INVENTORY_STATES = new Set(['agotado', 'bajo', 'en_minimo', 'suficiente', 'inactivo']);
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
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!match) throw inventoryError(400, `${label} no tiene un formato valido.`);
  const date = new Date(
    Number(match[1]), Number(match[2]) - 1, Number(match[3]),
    Number(match[4] || 0), Number(match[5] || 0), Number(match[6] || 0)
  );
  if (date.getFullYear() !== Number(match[1]) || date.getMonth() !== Number(match[2]) - 1
    || date.getDate() !== Number(match[3]) || date.getHours() !== Number(match[4] || 0)
    || date.getMinutes() !== Number(match[5] || 0) || date.getSeconds() !== Number(match[6] || 0)) {
    throw inventoryError(400, `${label} no es una fecha valida.`);
  }
  if (endOfDate && !match[4]) date.setDate(date.getDate() + 1);
  return date;
}

function mysqlDate(value) {
  if (!value) return null;
  if (value instanceof Date) return formatLocalDateTime(value);
  return String(value).slice(0, 19).replace('T', ' ');
}

function dateObject(value) {
  const text = mysqlDate(value);
  if (!text) return null;
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  return match
    ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]), Number(match[6]))
    : null;
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
  const requestedEnd = localDate(query.hasta, 'La fecha hasta', { endOfDate: true });
  const end = requestedEnd || new Date(Date.now() + 1000);
  const requestedStart = localDate(query.desde, 'La fecha desde');
  const configuredStart = new Date(end.getTime() - Number(configuration.periodoAnalisisDias) * DAY_MS);
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
  if (filters.estado === 'agotado') conditions.push('p.stockUnidadesTotal=0');
  if (filters.estado === 'bajo') conditions.push('p.stockUnidadesTotal>0 AND p.stockUnidadesTotal<p.stockMinimo');
  if (filters.estado === 'en_minimo') conditions.push('p.stockUnidadesTotal=p.stockMinimo');
  if (filters.estado === 'suficiente') conditions.push('p.stockUnidadesTotal>p.stockMinimo');
  return { conditions, params };
}

async function fetchAnalysisRows(connection, idTienda, range, filters, options = {}) {
  const where = productConditions(filters, options);
  const [rows] = await connection.query(
    `SELECT p.idProducto, p.nombre, p.categoria, p.idProveedor,
            pr.nombre proveedor, p.unidadMedida, p.unidadesPorPaquete,
            p.permiteVentaPorPaquete, p.stockUnidadesTotal, p.stockMinimo,
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
                       THEN dv.cantidadEquivalenteUnidades ELSE 0 END) unidadesVendidasPeriodo,
              SUM(CASE WHEN v.fecha>=? AND v.fecha<? AND v.fecha>=ps.fechaInicioSeguimiento
                       THEN dv.subtotal ELSE 0 END) ingresosPeriodo,
              COUNT(DISTINCT CASE WHEN v.fecha>=? AND v.fecha<? AND v.fecha>=ps.fechaInicioSeguimiento
                                  THEN v.idVenta END) ventasPeriodo,
              MAX(CASE WHEN v.fecha<? AND v.fecha>=ps.fechaInicioSeguimiento THEN v.fecha ELSE NULL END) ultimaVenta
       FROM detalleVenta dv
       JOIN venta v ON v.idTienda=dv.idTienda AND v.idVenta=dv.idVenta
       JOIN producto ps ON ps.idTienda=dv.idTienda AND ps.idProducto=dv.idProducto
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
      range.inicio, range.finExclusivo, range.finExclusivo, idTienda,
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
  const stock = Number(product.stockUnidadesTotal);
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
  const currentStock = Number(product.stockUnidadesTotal);
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
    stockMinimo: Number(product.stockMinimo),
    unidadesVendidasPeriodo: soldUnits,
    ingresosPeriodo: round(product.ingresosPeriodo, 2),
    cantidadVentasPeriodo: Number(product.ventasPeriodo),
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
    rotacionEsEstimacion: true,
    clasificacionMovimiento: movementClassification,
    diasSinVenta: daysWithoutSale === null ? null : round(daysWithoutSale, 1),
    edadSeguimientoDias: round(ageDays, 1),
    fechaInicioSeguimiento: mysqlDate(product.fechaInicioSeguimiento),
    precioVentaUnitario: round(product.precioVenta, 2),
    ultimoPrecioCompra: round(product.ultimoPrecioCompra, 2)
  };
}

async function analysisContext(connection, idTienda, query = {}, options = {}) {
  const configuration = await loadInventoryConfiguration(connection, idTienda);
  const range = analysisRange(query, configuration);
  const filters = await validatedFilters(connection, idTienda, query);
  const products = await fetchAnalysisRows(connection, idTienda, range, filters, options);
  return {
    configuration,
    range,
    filters,
    products: products.map((product) => analyzeProduct(product, configuration, range))
  };
}

function publicRange(range) {
  return {
    desde: range.desde,
    hastaExclusivo: range.hastaExclusivo,
    dias: range.dias,
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
    unidadesEnStock: context.products.reduce((sum, product) => sum + product.stockActual, 0),
    productosConHistorialInsuficiente: context.products.filter((product) => !product.historialSuficiente).length,
    productosConCostoConocido: knownCost.length,
    productosConCostoDesconocido: context.products.length - knownCost.length,
    advertencias: context.products.length === 0 ? ['No hay productos activos para los filtros seleccionados.'] : []
  };
}

async function inventoryAlerts(connection, idTienda, query = {}, options = {}) {
  const context = await analysisContext(connection, idTienda, query);
  const alerts = context.products.filter((product) => ['agotado', 'bajo', 'en_minimo'].includes(product.estadoInventario));
  return { periodo: publicRange(context.range), ...paginate(alerts, query, options.maximumLimit || MAX_PAGE_SIZE) };
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
  const suggestions = context.products.filter((product) => (
    product.estadoInventario !== 'inactivo' && product.cantidadSugeridaUnidades > 0
  ));
  return {
    periodo: publicRange(context.range),
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
    stockInicioPeriodo: product.stockInicioPeriodo,
    stockFinPeriodo: product.stockFinPeriodo,
    stockPromedio: product.stockPromedio,
    rotacion: product.rotacion,
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
  valuationRows
};
