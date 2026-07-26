const { stockError } = require('./stock-movement-service');
const { allocateLineAmounts } = require('./sale-compensation-service');
const {
  COMPENSATION_REASONS,
  COMPENSATION_STATES,
  COMPENSATION_TYPES
} = require('../config/compensation-contract');

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;
const MAX_EXPORT_ROWS = 10000;

function positiveId(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    throw stockError(400, `${label} no es valido.`, 'INVALID_COMPENSATION_FILTER');
  }
  return number;
}

function optionalId(value, label) {
  return value === undefined || value === null || value === ''
    ? null
    : positiveId(value, label);
}

function localDate(value, label) {
  const text = String(value || '').trim();
  if (!text) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw stockError(400, `${label} no es valida.`, 'INVALID_COMPENSATION_FILTER');
  }
  return text;
}

function buildOperationFilter(idTienda, query = {}) {
  const conditions = ['oc.idTienda=?'];
  const params = [positiveId(idTienda, 'La tienda')];
  const type = String(query.tipo || '').trim();
  const state = String(query.estado || '').trim();
  if (type) {
    if (!COMPENSATION_TYPES.includes(type)) {
      throw stockError(400, 'El tipo de compensacion no es valido.', 'INVALID_COMPENSATION_FILTER');
    }
    conditions.push('oc.tipoOperacion=?');
    params.push(type);
  }
  if (state) {
    if (!COMPENSATION_STATES.includes(state)) {
      throw stockError(400, 'El estado de compensacion no es valido.', 'INVALID_COMPENSATION_FILTER');
    }
    conditions.push('oc.estado=?');
    params.push(state);
  }
  const from = localDate(query.fechaDesde, 'La fecha inicial');
  const to = localDate(query.fechaHasta, 'La fecha final');
  if (from && to && from > to) {
    throw stockError(400, 'La fecha inicial no puede ser posterior a la final.',
      'INVALID_COMPENSATION_FILTER');
  }
  if (from) {
    conditions.push('oc.fechaSolicitud>=CONCAT(?," 00:00:00")');
    params.push(from);
  }
  if (to) {
    conditions.push('oc.fechaSolicitud<DATE_ADD(?,INTERVAL 1 DAY)');
    params.push(to);
  }
  const administrator = String(query.usuario || '').trim();
  if (administrator) {
    conditions.push('a.usuario LIKE ?');
    params.push(`%${administrator.slice(0, 80)}%`);
  }
  const customer = String(query.cliente || '').trim();
  if (customer) {
    conditions.push(`COALESCE(c.nombre,cc.nombre,mc.nombre,'') LIKE ?`);
    params.push(`%${customer.slice(0, 120)}%`);
  }
  const saleId = optionalId(query.venta, 'La venta');
  if (saleId) {
    conditions.push('COALESCE(v.idVenta,pv.idVenta,mv.idVenta,rv.idVenta)=?');
    params.push(saleId);
  }
  return { where: conditions.join(' AND '), params };
}

const OPERATION_FROM = `
  FROM operacionCompensatoria oc
  JOIN administrador a
    ON a.idTienda=oc.idTienda
   AND a.idAdministrador=oc.idAdministradorSolicitante
  LEFT JOIN compensacionVenta cv
    ON cv.idTienda=oc.idTienda
   AND cv.idOperacionCompensatoria=oc.idOperacionCompensatoria
  LEFT JOIN venta v
    ON v.idTienda=cv.idTienda AND v.idVenta=cv.idVenta
  LEFT JOIN cliente c
    ON c.idTienda=v.idTienda AND c.idCliente=v.idCliente
  LEFT JOIN compensacionCobroFiado ccf
    ON ccf.idTienda=oc.idTienda
   AND ccf.idOperacionCompensatoria=oc.idOperacionCompensatoria
  LEFT JOIN cobroFiado cf
    ON cf.idTienda=ccf.idTienda AND cf.idCobroFiado=ccf.idCobroFiado
  LEFT JOIN cliente cc
    ON cc.idTienda=cf.idTienda AND cc.idCliente=cf.idCliente
  LEFT JOIN compensacionPagoVenta cpv
    ON cpv.idTienda=oc.idTienda
   AND cpv.idOperacionCompensatoria=oc.idOperacionCompensatoria
  LEFT JOIN pagoVenta pv
    ON pv.idTienda=cpv.idTienda AND pv.idPagoVenta=cpv.idPagoVenta
  LEFT JOIN resolucionLiquidacionVenta rlv
    ON rlv.idTienda=oc.idTienda
   AND rlv.idOperacionCompensatoria=oc.idOperacionCompensatoria
  LEFT JOIN liquidacionCompensacionVenta lcv
    ON lcv.idTienda=rlv.idTienda
   AND lcv.idLiquidacionCompensacionVenta=rlv.idLiquidacionCompensacionVenta
  LEFT JOIN compensacionVenta rv
    ON rv.idTienda=lcv.idTienda AND rv.idCompensacionVenta=lcv.idCompensacionVenta
  LEFT JOIN movimientoLiquidacionCompensacion mlc
    ON mlc.idTienda=oc.idTienda
   AND mlc.idOperacionCompensatoria=oc.idOperacionCompensatoria
  LEFT JOIN obligacionReembolsoVenta ore
    ON ore.idTienda=mlc.idTienda
   AND ore.idObligacionReembolsoVenta=mlc.idObligacionReembolsoVenta
  LEFT JOIN venta mv
    ON mv.idTienda=ore.idTienda AND mv.idVenta=ore.idVenta
  LEFT JOIN cliente mc
    ON mc.idTienda=mv.idTienda AND mc.idCliente=mv.idCliente`;

const OPERATION_SELECT = `
  SELECT oc.idOperacionCompensatoria, oc.tipoOperacion, oc.estado,
         oc.motivoCodigo, oc.observacion, oc.fechaSolicitud,
         oc.fechaAplicacion, a.usuario administrador,
         COALESCE(v.idVenta,pv.idVenta,mv.idVenta,rv.idVenta) idVenta,
         COALESCE(v.codigoComprobante,mv.codigoComprobante) codigoVenta,
         COALESCE(c.nombre,cc.nombre,mc.nombre,'Cliente ocasional') cliente,
         cv.idCompensacionVenta, cv.tipoCompensacion tipoCompensacionVenta,
         cv.montoCompensado, cv.costoCompensado,
         ccf.idCompensacionCobroFiado, ccf.idCobroFiado,
         ccf.tipoCompensacion tipoCompensacionCobro,
         ccf.metodoOriginal, ccf.metodoDestino,
         cpv.idCompensacionPagoVenta, cpv.idPagoVenta,
         cpv.metodoOriginal metodoPagoOriginal,
         cpv.metodoDestino metodoPagoDestino,
         mlc.idMovimientoLiquidacionCompensacion,
         mlc.tipoLiquidacion, mlc.metodoLiquidacion, mlc.monto montoLiquidado,
         CASE
           WHEN cv.idCompensacionVenta IS NOT NULL THEN 'venta'
           WHEN ccf.idCompensacionCobroFiado IS NOT NULL THEN 'cobro'
           WHEN cpv.idCompensacionPagoVenta IS NOT NULL THEN 'pago'
           WHEN mlc.idMovimientoLiquidacionCompensacion IS NOT NULL THEN 'liquidacion'
           ELSE NULL
         END tipoComprobante,
         COALESCE(cv.idCompensacionVenta,ccf.idCompensacionCobroFiado,
                  cpv.idCompensacionPagoVenta,mlc.idMovimientoLiquidacionCompensacion)
           idComprobante`;

function pagination(query = {}, options = {}) {
  const page = Number(query.page || 1);
  const maximum = options.maximumPageSize || MAX_PAGE_SIZE;
  const defaultSize = options.defaultPageSize || DEFAULT_PAGE_SIZE;
  const pageSize = Number(query.pageSize || defaultSize);
  if (!Number.isInteger(page) || page < 1
    || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > maximum) {
    throw stockError(400, `La paginacion debe usar pagina positiva y hasta ${maximum} filas.`,
      'INVALID_COMPENSATION_PAGINATION');
  }
  return { page, pageSize, offset: (page - 1) * pageSize };
}

async function listCompensations(connection, idTienda, query = {}, options = {}) {
  const filter = buildOperationFilter(idTienda, query);
  const page = pagination(query, options);
  const [[count], [summary], [rows]] = await Promise.all([
    connection.query(
      `SELECT COUNT(*) total ${OPERATION_FROM} WHERE ${filter.where}`,
      filter.params
    ),
    connection.query(
      `SELECT COUNT(*) total,
              COALESCE(SUM(COALESCE(cv.montoCompensado,0)),0) compensacionComercial,
              COALESCE(SUM(COALESCE(mlc.monto,0)),0) liquidacionesMateriales,
              SUM(oc.estado='aplicada') aplicadas,
              SUM(oc.estado IN ('solicitada','pendiente_aprobacion','aprobada')) pendientes
       ${OPERATION_FROM} WHERE ${filter.where}`,
      filter.params
    ),
    connection.query(
      `${OPERATION_SELECT} ${OPERATION_FROM}
       WHERE ${filter.where}
       ORDER BY oc.fechaSolicitud DESC, oc.idOperacionCompensatoria DESC
       LIMIT ? OFFSET ?`,
      [...filter.params, page.pageSize, page.offset]
    )
  ]);
  const total = Number(count[0]?.total || 0);
  const totalPages = Math.max(1, Math.ceil(total / page.pageSize));
  return {
    filtros: {
      tipo: String(query.tipo || ''),
      estado: String(query.estado || ''),
      fechaDesde: String(query.fechaDesde || ''),
      fechaHasta: String(query.fechaHasta || ''),
      usuario: String(query.usuario || ''),
      cliente: String(query.cliente || ''),
      venta: String(query.venta || '')
    },
    resumen: {
      total: Number(summary[0]?.total || 0),
      compensacionComercial: Number(summary[0]?.compensacionComercial || 0),
      liquidacionesMateriales: Number(summary[0]?.liquidacionesMateriales || 0),
      aplicadas: Number(summary[0]?.aplicadas || 0),
      pendientes: Number(summary[0]?.pendientes || 0)
    },
    resultados: rows,
    paginacion: {
      page: page.page,
      pageSize: page.pageSize,
      total,
      totalPages,
      hasNextPage: page.page < totalPages,
      hasPreviousPage: page.page > 1
    }
  };
}

async function operationDetail(connection, idTienda, sourceId) {
  const id = positiveId(sourceId, 'La operacion');
  const [rows] = await connection.query(
    `${OPERATION_SELECT} ${OPERATION_FROM}
     WHERE oc.idTienda=? AND oc.idOperacionCompensatoria=?`,
    [idTienda, id]
  );
  if (!rows.length) {
    throw stockError(404, 'Operacion compensatoria no encontrada.',
      'COMPENSATION_NOT_FOUND');
  }
  return rows[0];
}

async function saleContext(connection, idTienda, sourceId) {
  const idVenta = positiveId(sourceId, 'La venta');
  const [[sales], [details], [payments], [collections]] = await Promise.all([
    connection.query(
      `SELECT v.idVenta,v.codigoComprobante,v.fecha,v.subtotal,v.descuento,v.total,
              v.montoPagado,v.montoCompensado,v.saldoPendiente,v.estadoPago,
              v.estadoOperacion,COALESCE(c.nombre,'Cliente ocasional') cliente,
              f.idFiado,f.saldoPendiente saldoFiado,f.estado estadoFiado
       FROM venta v
       LEFT JOIN cliente c ON c.idTienda=v.idTienda AND c.idCliente=v.idCliente
       LEFT JOIN fiado f ON f.idTienda=v.idTienda AND f.idVenta=v.idVenta
       WHERE v.idTienda=? AND v.idVenta=?`,
      [idTienda, idVenta]
    ),
    connection.query(
      `SELECT dv.idDetalleVenta,dv.idProducto,p.nombre producto,
              dv.cantidadEquivalenteUnidades unidadesVendidas,
              dv.cantidadEquivalenteUnidades,
              COALESCE(SUM(dcv.unidadesDevueltas),0) unidadesDevueltas,
              dv.cantidad,dv.presentacionVenta,dv.precioVenta,dv.subtotal,
              dv.subtotalCosto,dv.origenCosto,p.controlaLotes
       FROM detalleVenta dv
       JOIN producto p ON p.idTienda=dv.idTienda AND p.idProducto=dv.idProducto
       LEFT JOIN detalleCompensacionVenta dcv
         ON dcv.idTienda=dv.idTienda AND dcv.idDetalleVenta=dv.idDetalleVenta
       WHERE dv.idTienda=? AND dv.idVenta=?
       GROUP BY dv.idTienda,dv.idDetalleVenta,dv.idProducto,p.nombre,
                dv.cantidadEquivalenteUnidades,dv.cantidad,dv.presentacionVenta,
                dv.precioVenta,dv.subtotal,dv.subtotalCosto,dv.origenCosto,
                p.controlaLotes
       ORDER BY dv.idDetalleVenta`,
      [idTienda, idVenta]
    ),
    connection.query(
      `SELECT pv.idPagoVenta,pv.metodoPago,pv.monto,pv.montoRecibido,pv.cambio,
              pv.referencia,pv.creadoEn,
              cpv.idCompensacionPagoVenta,cpv.metodoDestino
       FROM pagoVenta pv
       LEFT JOIN compensacionPagoVenta cpv
         ON cpv.idTienda=pv.idTienda AND cpv.idPagoVenta=pv.idPagoVenta
       WHERE pv.idTienda=? AND pv.idVenta=?
       ORDER BY pv.creadoEn,pv.idPagoVenta`,
      [idTienda, idVenta]
    ),
    connection.query(
      `SELECT DISTINCT cf.idCobroFiado,cf.fechaCobro,cf.montoTotal,cf.metodoPago,
              cf.estadoOperacion,cf.referencia,ccf.idCompensacionCobroFiado
       FROM cobroFiado cf
       JOIN pagoFiado pf
         ON pf.idTienda=cf.idTienda AND pf.idCobroFiado=cf.idCobroFiado
       JOIN fiado f ON f.idTienda=pf.idTienda AND f.idFiado=pf.idFiado
       LEFT JOIN compensacionCobroFiado ccf
         ON ccf.idTienda=cf.idTienda AND ccf.idCobroFiado=cf.idCobroFiado
       WHERE cf.idTienda=? AND f.idVenta=?
       ORDER BY cf.fechaCobro,cf.idCobroFiado`,
      [idTienda, idVenta]
    )
  ]);
  if (!sales.length) {
    throw stockError(404, 'Venta no encontrada.', 'SALE_NOT_FOUND');
  }
  const allocated = allocateLineAmounts(sales[0], details);
  const allocationByDetail = new Map(
    allocated.map((row) => [Number(row.idDetalleVenta), row])
  );
  const enrichedDetails = details.map((row) => {
    const line = allocationByDetail.get(Number(row.idDetalleVenta));
    const returned = Number(row.unidadesDevueltas || 0);
    const previouslyCompensated = returned >= line.soldUnits
      ? line.netCents
      : Math.floor(line.netCents * returned / line.soldUnits);
    return {
      ...row,
      montoNetoLinea: (line.netCents / 100).toFixed(2),
      montoCompensableMaximo: ((line.netCents - previouslyCompensated) / 100).toFixed(2)
    };
  });
  return { venta: sales[0], detalles: enrichedDetails, pagos: payments, cobros: collections };
}

async function pendingCompensations(connection, idTienda) {
  const [[settlements], [refunds]] = await Promise.all([
    connection.query(
      `SELECT lcv.idLiquidacionCompensacionVenta,lcv.montoCompensado,
              lcv.montoReduccionDeudaPendiente,lcv.montoReembolsoPendiente,
              lcv.estado,lcv.creadoEn,cv.idCompensacionVenta,v.idVenta,
              v.codigoComprobante,COALESCE(c.nombre,'Cliente ocasional') cliente
       FROM liquidacionCompensacionVenta lcv
       JOIN compensacionVenta cv
         ON cv.idTienda=lcv.idTienda AND cv.idCompensacionVenta=lcv.idCompensacionVenta
       JOIN venta v ON v.idTienda=cv.idTienda AND v.idVenta=cv.idVenta
       LEFT JOIN cliente c ON c.idTienda=v.idTienda AND c.idCliente=v.idCliente
       WHERE lcv.idTienda=? AND lcv.estado='pendiente_c3'
       ORDER BY lcv.creadoEn,lcv.idLiquidacionCompensacionVenta`,
      [idTienda]
    ),
    connection.query(
      `SELECT ore.idObligacionReembolsoVenta,ore.idVenta,ore.monto,ore.estado,
              ore.creadoEn,v.codigoComprobante,
              COALESCE(c.nombre,'Cliente ocasional') cliente,
              COALESCE(SUM(mlc.monto),0) montoLiquidado,
              ore.monto-COALESCE(SUM(mlc.monto),0) montoPendiente
       FROM obligacionReembolsoVenta ore
       JOIN venta v ON v.idTienda=ore.idTienda AND v.idVenta=ore.idVenta
       LEFT JOIN cliente c ON c.idTienda=v.idTienda AND c.idCliente=v.idCliente
       LEFT JOIN movimientoLiquidacionCompensacion mlc
         ON mlc.idTienda=ore.idTienda
        AND mlc.idObligacionReembolsoVenta=ore.idObligacionReembolsoVenta
       WHERE ore.idTienda=? AND ore.estado='pendiente'
       GROUP BY ore.idTienda,ore.idObligacionReembolsoVenta,ore.idVenta,
                ore.monto,ore.estado,ore.creadoEn,v.codigoComprobante,c.nombre
       ORDER BY ore.creadoEn,ore.idObligacionReembolsoVenta`,
      [idTienda]
    )
  ]);
  return { liquidaciones: settlements, reembolsos: refunds };
}

async function compensationOptions(connection, idTienda) {
  const [administrators] = await connection.query(
    `SELECT idAdministrador,usuario
     FROM administrador
     WHERE idTienda=? AND activo=1
     ORDER BY usuario,idAdministrador`,
    [idTienda]
  );
  return {
    tipos: COMPENSATION_TYPES,
    estados: COMPENSATION_STATES,
    motivos: COMPENSATION_REASONS,
    administradores: administrators
  };
}

async function allCompensationsForExport(connection, idTienda, query = {}) {
  const result = await listCompensations(connection, idTienda, {
    ...query,
    page: 1,
    pageSize: MAX_EXPORT_ROWS
  }, {
    maximumPageSize: MAX_EXPORT_ROWS,
    defaultPageSize: MAX_EXPORT_ROWS
  });
  if (result.paginacion.total > MAX_EXPORT_ROWS) {
    throw stockError(413,
      `La exportacion supera el limite de ${MAX_EXPORT_ROWS} filas. Reduce el rango o los filtros.`,
      'COMPENSATION_EXPORT_LIMIT_EXCEEDED');
  }
  return result.resultados;
}

module.exports = {
  MAX_EXPORT_ROWS,
  allCompensationsForExport,
  buildOperationFilter,
  compensationOptions,
  listCompensations,
  operationDetail,
  pendingCompensations,
  saleContext
};
