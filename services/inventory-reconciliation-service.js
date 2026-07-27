const { formatLocalDate } = require('../utils/local-datetime');
const {
  INVENTORY_RECONCILIATION_CODES
} = require('../config/inventory-adjustment-contract');
const { stockError } = require('./stock-movement-service');

const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 25;
const VALID_STATUSES = new Set(['todos', 'ok', 'warning', 'error']);
const KNOWN_CODES = new Set(INVENTORY_RECONCILIATION_CODES);

function positiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    throw stockError(400, `${label} no es valido.`, 'INVALID_INVENTORY_FILTER');
  }
  return number;
}

function pagination(query = {}) {
  const page = query.page === undefined ? 1 : positiveInteger(query.page, 'La pagina');
  const pageSize = query.pageSize === undefined
    ? DEFAULT_PAGE_SIZE
    : positiveInteger(query.pageSize, 'El tamano de pagina');
  if (pageSize > MAX_PAGE_SIZE) {
    throw stockError(400, `El tamano de pagina no puede superar ${MAX_PAGE_SIZE}.`, 'INVALID_INVENTORY_FILTER');
  }
  return { page, pageSize, offset: (page - 1) * pageSize };
}

function searchFilter(query = {}) {
  const search = String(query.busqueda || '').trim();
  if (search.length > 100) {
    throw stockError(400, 'La busqueda no puede superar 100 caracteres.', 'INVALID_INVENTORY_FILTER');
  }
  return search;
}

function statusFilter(query = {}) {
  const status = String(query.estado || 'todos').trim().toLowerCase();
  if (!VALID_STATUSES.has(status)) {
    throw stockError(400, 'El estado de conciliacion no es valido.', 'INVALID_INVENTORY_FILTER');
  }
  return status;
}

const RECONCILIATION_SOURCE = `
  SELECT
    p.idProducto,
    p.nombre,
    p.activo,
    p.controlaLotes,
    p.controlaVencimiento,
    p.stockUnidadesTotal stockFisico,
    COALESCE(l.stockLotesFisico, 0) stockLotesFisico,
    CASE
      WHEN p.controlaLotes=1 THEN COALESCE(l.stockVendible, 0)
      ELSE p.stockUnidadesTotal
    END stockVendible,
    CASE
      WHEN p.controlaLotes=1 THEN COALESCE(l.stockVencido, 0)
      ELSE 0
    END stockVencido,
    CASE
      WHEN p.controlaLotes=1 THEN COALESCE(l.stockBloqueado, 0)
      ELSE 0
    END stockBloqueado,
    CASE
      WHEN p.controlaLotes=1 THEN COALESCE(l.stockAislado, 0)
      ELSE 0
    END stockAislado,
    CASE
      WHEN p.controlaLotes=1 THEN COALESCE(l.stockTecnico, 0)
      ELSE 0
    END stockTecnico,
    COALESCE(l.lotesNegativos, 0) lotesNegativos,
    COALESCE(l.lotesTecnicosVendibles, 0) lotesTecnicosVendibles,
    COALESCE(m.stockSegunMovimientos, p.stockUnidadesTotal) stockSegunMovimientos,
    COALESCE(m.referenciasInvalidas, 0) referenciasInvalidas,
    COALESCE(ml.movimientosHuerfanos, 0) movimientosLoteHuerfanos,
    COALESCE(ml.asignacionesDuplicadas, 0) asignacionesDuplicadas
  FROM producto p
  LEFT JOIN (
    SELECT
      lp.idTienda,
      lp.idProducto,
      SUM(CASE WHEN lp.estadoOperativo<>'anulado' THEN lp.cantidadRestante ELSE 0 END) stockLotesFisico,
      SUM(CASE
        WHEN lp.estadoOperativo='disponible'
         AND lp.clasificacionInventario='vendible'
         AND (lp.fechaVencimiento IS NULL OR lp.fechaVencimiento>=?)
        THEN lp.cantidadRestante ELSE 0 END) stockVendible,
      SUM(CASE
        WHEN lp.estadoOperativo<>'anulado'
         AND lp.fechaVencimiento IS NOT NULL
         AND lp.fechaVencimiento<?
        THEN lp.cantidadRestante ELSE 0 END) stockVencido,
      SUM(CASE
        WHEN lp.estadoOperativo<>'anulado'
         AND lp.clasificacionInventario='bloqueado'
        THEN lp.cantidadRestante ELSE 0 END) stockBloqueado,
      SUM(CASE
        WHEN lp.estadoOperativo<>'anulado'
         AND lp.clasificacionInventario='aislado'
        THEN lp.cantidadRestante ELSE 0 END) stockAislado,
      SUM(CASE
        WHEN lp.estadoOperativo<>'anulado'
         AND lp.clasificacionInventario='tecnico'
        THEN lp.cantidadRestante ELSE 0 END) stockTecnico,
      SUM(lp.cantidadRestante<0) lotesNegativos,
      SUM(
        lp.clasificacionInventario='tecnico'
        AND lp.estadoOperativo='disponible'
        AND lp.cantidadRestante>0
      ) lotesTecnicosVendibles
    FROM loteProducto lp
    WHERE lp.idTienda=?
    GROUP BY lp.idTienda, lp.idProducto
  ) l ON l.idTienda=p.idTienda AND l.idProducto=p.idProducto
  LEFT JOIN (
    SELECT
      ms.idTienda,
      ms.idProducto,
      CAST(SUBSTRING_INDEX(
        GROUP_CONCAT(ms.stockAnterior ORDER BY ms.creadoEn, ms.idMovimientoStock SEPARATOR ','),
        ',',
        1
      ) AS SIGNED) + SUM(ms.cantidad) stockSegunMovimientos,
      SUM(
        (ms.origen='venta' AND (ms.idDetalleVenta IS NULL OR dv.idDetalleVenta IS NULL))
        OR (ms.origen='compra' AND (ms.idDetalleCompra IS NULL OR dc.idDetalleCompra IS NULL))
        OR (ms.origen<>'venta' AND ms.idDetalleVenta IS NOT NULL)
        OR (ms.origen<>'compra' AND ms.idDetalleCompra IS NOT NULL)
      ) referenciasInvalidas
    FROM movimientoStock ms
    LEFT JOIN detalleVenta dv
      ON dv.idTienda=ms.idTienda AND dv.idDetalleVenta=ms.idDetalleVenta
    LEFT JOIN detalleCompra dc
      ON dc.idTienda=ms.idTienda AND dc.idDetalleCompra=ms.idDetalleCompra
    WHERE ms.idTienda=?
    GROUP BY ms.idTienda, ms.idProducto
  ) m ON m.idTienda=p.idTienda AND m.idProducto=p.idProducto
  LEFT JOIN (
    SELECT
      grouped.idTienda,
      grouped.idProducto,
      SUM(grouped.huerfano) movimientosHuerfanos,
      SUM(grouped.duplicado) asignacionesDuplicadas
    FROM (
      SELECT
        ml.idTienda,
        ml.idProducto,
        ml.idMovimientoStock,
        ml.idLoteProducto,
        MAX(lp.idLoteProducto IS NULL OR p.idProducto IS NULL) huerfano,
        COUNT(*)>1 duplicado
      FROM movimientoLote ml
      LEFT JOIN loteProducto lp
        ON lp.idTienda=ml.idTienda
       AND lp.idProducto=ml.idProducto
       AND lp.idLoteProducto=ml.idLoteProducto
      LEFT JOIN producto p
        ON p.idTienda=ml.idTienda AND p.idProducto=ml.idProducto
      WHERE ml.idTienda=?
      GROUP BY ml.idTienda, ml.idProducto, ml.idMovimientoStock, ml.idLoteProducto
    ) grouped
    GROUP BY grouped.idTienda, grouped.idProducto
  ) ml ON ml.idTienda=p.idTienda AND ml.idProducto=p.idProducto
  WHERE p.idTienda=?
`;

function finding(code, severity) {
  if (!KNOWN_CODES.has(code)) throw new Error('Codigo de conciliacion no reconocido.');
  return Object.freeze({ code, severity });
}

function classify(row) {
  const findings = [];
  if (Number(row.stockFisico) < 0) findings.push(finding('STOCK_NEGATIVE', 'error'));
  if (Number(row.lotesNegativos) > 0) findings.push(finding('LOT_QUANTITY_NEGATIVE', 'error'));
  if (Number(row.controlaLotes) === 1 && Number(row.stockFisico) !== Number(row.stockLotesFisico)) {
    findings.push(finding('LOT_PHYSICAL_MISMATCH', 'error'));
  }
  if (Number(row.stockFisico) !== Number(row.stockSegunMovimientos)) {
    findings.push(finding('STOCK_LEDGER_MISMATCH', 'error'));
  }
  if (Number(row.referenciasInvalidas) > 0) {
    findings.push(finding('STOCK_MOVEMENT_REFERENCE_INVALID', 'error'));
  }
  if (Number(row.movimientosLoteHuerfanos) > 0) {
    findings.push(finding('LOT_MOVEMENT_ORPHAN', 'error'));
  }
  if (Number(row.asignacionesDuplicadas) > 0) {
    findings.push(finding('LOT_ASSIGNMENT_DUPLICATED', 'warning'));
  }
  if (Number(row.lotesTecnicosVendibles) > 0) {
    findings.push(finding('TECHNICAL_LOT_SELLABLE', 'error'));
  }
  const stockNoVendible = Math.max(0, Number(row.stockFisico) - Number(row.stockVendible));
  if (!findings.length && stockNoVendible > 0) {
    findings.push(finding('UNSELLABLE_STOCK_PRESENT', 'warning'));
  }
  const status = findings.some((item) => item.severity === 'error')
    ? 'error'
    : findings.length ? 'warning' : 'ok';
  return {
    idProducto: Number(row.idProducto),
    nombre: row.nombre,
    activo: Number(row.activo) === 1,
    controlaLotes: Number(row.controlaLotes) === 1,
    controlaVencimiento: Number(row.controlaVencimiento) === 1,
    stockFisico: Number(row.stockFisico),
    stockVendible: Number(row.stockVendible),
    stockNoVendible,
    desgloseNoVendible: {
      vencido: Number(row.stockVencido),
      bloqueado: Number(row.stockBloqueado),
      aislado: Number(row.stockAislado),
      tecnico: Number(row.stockTecnico)
    },
    conciliacion: {
      estado: status,
      stockLotesFisico: Number(row.stockLotesFisico),
      stockSegunMovimientos: Number(row.stockSegunMovimientos),
      hallazgos: findings
    }
  };
}

async function inventoryReconciliation(connection, idTienda, query = {}) {
  idTienda = positiveInteger(idTienda, 'La tienda');
  const { page, pageSize } = pagination(query);
  const search = searchFilter(query);
  const requestedStatus = statusFilter(query);
  const today = formatLocalDate();
  const [rawRows] = await connection.query(
    `${RECONCILIATION_SOURCE}
     ORDER BY p.nombre, p.idProducto`,
    [today, today, idTienda, idTienda, idTienda, idTienda]
  );
  const classified = rawRows
    .map(classify)
    .filter((row) => !search || row.nombre.toLocaleUpperCase('es-BO').includes(search.toLocaleUpperCase('es-BO')))
    .filter((row) => requestedStatus === 'todos' || row.conciliacion.estado === requestedStatus);
  const total = classified.length;
  const offset = (page - 1) * pageSize;
  const rows = classified.slice(offset, offset + pageSize);
  const totals = classified.reduce((result, row) => {
    result.stockFisico += row.stockFisico;
    result.stockVendible += row.stockVendible;
    result.stockNoVendible += row.stockNoVendible;
    result[row.conciliacion.estado] += 1;
    return result;
  }, { stockFisico: 0, stockVendible: 0, stockNoVendible: 0, ok: 0, warning: 0, error: 0 });
  return {
    checkedAt: today,
    resumen: { productos: total, ...totals },
    resultados: rows,
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
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  classify,
  inventoryReconciliation,
  pagination
};
