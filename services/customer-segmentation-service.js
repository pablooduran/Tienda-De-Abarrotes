const {
  addLocalDays,
  formatLocalDate,
  formatLocalDateTime,
  parseLocalDate
} = require('../utils/local-datetime');
const { centsToDecimal, creditError, moneyToCents } = require('./customer-credit-service');

const SEGMENTS = new Set([
  'frecuentes',
  'inactivos',
  'con_deuda',
  'vencidos',
  'promesa_incumplida',
  'buenos_pagadores',
  'mayor_compra',
  'mayor_saldo'
]);
const CUSTOMER_STATES = new Set(['activos', 'ocultos', 'todos']);
const SORT_COLUMNS = {
  nombre: 'nombre',
  ultimaCompra: 'ultimaCompra',
  totalComprado: 'totalComprado',
  cantidadCompras: 'cantidadCompras',
  ticketPromedio: 'ticketPromedio',
  saldoPendiente: 'saldoPendiente',
  saldoVencido: 'saldoVencido',
  diasDesdeUltimaCompra: 'diasDesdeUltimaCompra',
  diasMaximoAtraso: 'diasMaximoAtraso',
  porcentajePuntualidad: 'porcentajePuntualidad',
  fiadosAbiertos: 'fiadosAbiertos'
};
const DEFAULT_SORT = {
  frecuentes: ['cantidadCompras DESC', 'totalComprado DESC'],
  inactivos: ['ultimaCompra IS NULL DESC', 'ultimaCompra ASC'],
  con_deuda: ['saldoPendiente DESC', 'saldoVencido DESC'],
  vencidos: ['saldoVencido DESC', 'diasMaximoAtraso DESC'],
  promesa_incumplida: ['fechaPrometida ASC', 'saldoPendiente DESC'],
  buenos_pagadores: ['porcentajePuntualidad DESC', 'fiadosCerradosEvaluables DESC'],
  mayor_compra: ['totalComprado DESC', 'cantidadCompras DESC'],
  mayor_saldo: ['saldoPendiente DESC', 'saldoVencido DESC']
};
const DESCRIPTIONS = {
  frecuentes: 'Clientes que alcanzan el minimo de compras dentro del periodo seleccionado.',
  inactivos: 'Clientes activos sin compras recientes, incluidos quienes nunca compraron.',
  con_deuda: 'Clientes con saldo pendiente mayor que cero.',
  vencidos: 'Clientes con fiados abiertos cuya fecha de vencimiento original ya paso.',
  promesa_incumplida: 'Clientes con deuda abierta y una fecha prometida anterior a hoy.',
  buenos_pagadores: 'Clientes con historial suficiente, puntualidad comprobable y sin deuda vencida ni promesas incumplidas.',
  mayor_compra: 'Ranking por valor comprado dentro del periodo seleccionado.',
  mayor_saldo: 'Ranking por saldo pendiente total.'
};

function integerParameter(value, fallback, label, { minimum = 0, maximum = 3650 } = {}) {
  if (value === undefined || value === '') return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum || number > maximum) {
    throw creditError(400, `${label} debe ser un entero entre ${minimum} y ${maximum}.`, 'SEGMENTATION_PARAMETER_INVALID');
  }
  return number;
}

function dateParameter(value, label) {
  if (value === undefined || value === '') return null;
  try {
    return formatLocalDate(parseLocalDate(value));
  } catch {
    throw creditError(400, `${label} debe usar una fecha local valida AAAA-MM-DD.`, 'SEGMENTATION_DATE_INVALID');
  }
}

function escapeLike(value) {
  return String(value).replace(/[\\%_]/g, (character) => `\\${character}`);
}

function normalizeParameters(query = {}) {
  const segmento = String(query.segmento || '').trim().toLowerCase();
  if (!SEGMENTS.has(segmento)) {
    throw creditError(400, 'El segmento de clientes no es valido.', 'SEGMENTO_CLIENTE_INVALIDO');
  }
  const estadoCliente = String(query.estadoCliente || 'activos').trim().toLowerCase();
  if (!CUSTOMER_STATES.has(estadoCliente)) {
    throw creditError(400, 'El estado de cliente no es valido.', 'SEGMENTATION_CUSTOMER_STATE_INVALID');
  }

  const today = formatLocalDate();
  const dias = integerParameter(query.dias, 90, 'Los dias de la ventana', { minimum: 1 });
  const diasSinCompra = integerParameter(query.diasSinCompra, 90, 'Los dias sin compra', { minimum: 1 });
  const comprasMinimas = integerParameter(query.comprasMinimas, 5, 'Las compras minimas', { minimum: 1, maximum: 1000 });
  const minimoFiadosCerrados = integerParameter(query.minimoFiadosCerrados, 3, 'Los fiados cerrados minimos', { minimum: 1, maximum: 1000 });
  const porcentajePuntualMinimo = integerParameter(query.porcentajePuntualMinimo, 80, 'El porcentaje puntual minimo', { maximum: 100 });
  const periodoDias = integerParameter(query.periodoDias, 365, 'Los dias del periodo historico', { minimum: 1 });
  const page = integerParameter(query.page ?? query.pagina, 1, 'La pagina', { minimum: 1, maximum: 1000000 });
  const pageSize = integerParameter(
    query.pageSize ?? query.limiteResultados ?? query.limite,
    20,
    'El tamano de pagina',
    { minimum: 1, maximum: 100 }
  );
  const fechaDesde = dateParameter(query.fechaDesde, 'La fecha inicial');
  const fechaHasta = dateParameter(query.fechaHasta, 'La fecha final');
  if (fechaDesde && fechaHasta && fechaDesde > fechaHasta) {
    throw creditError(400, 'La fecha inicial no puede ser posterior a la fecha final.', 'SEGMENTATION_DATE_RANGE_INVALID');
  }

  let saldoMinimoCents = null;
  let saldoMaximoCents = null;
  if (query.saldoMinimo !== undefined && query.saldoMinimo !== '') {
    saldoMinimoCents = moneyToCents(query.saldoMinimo, 'El saldo minimo');
  }
  if (query.saldoMaximo !== undefined && query.saldoMaximo !== '') {
    saldoMaximoCents = moneyToCents(query.saldoMaximo, 'El saldo maximo');
  }
  if (saldoMinimoCents !== null && saldoMaximoCents !== null && saldoMinimoCents > saldoMaximoCents) {
    throw creditError(400, 'El saldo minimo no puede superar el saldo maximo.', 'SEGMENTATION_BALANCE_RANGE_INVALID');
  }

  const order = query.orden ? SORT_COLUMNS[query.orden] : null;
  if (query.orden && !order) {
    throw creditError(400, 'El campo de orden no es valido.', 'SEGMENTATION_ORDER_INVALID');
  }
  const direction = String(query.direccion || 'desc').trim().toLowerCase();
  if (!['asc', 'desc'].includes(direction)) {
    throw creditError(400, 'La direccion de orden no es valida.', 'SEGMENTATION_ORDER_INVALID');
  }

  const purchaseWindowDays = segmento === 'buenos_pagadores' ? periodoDias : dias;
  const defaultFrom = formatLocalDate(addLocalDays(parseLocalDate(today), -(purchaseWindowDays - 1)));
  const periodFrom = fechaDesde || defaultFrom;
  const periodThrough = fechaHasta || today;
  if (periodFrom > periodThrough) {
    throw creditError(400, 'El periodo aplicado no es valido.', 'SEGMENTATION_DATE_RANGE_INVALID');
  }
  const periodStart = formatLocalDateTime(parseLocalDate(periodFrom));
  const periodEndExclusive = formatLocalDateTime(addLocalDays(parseLocalDate(periodThrough), 1));

  return {
    segmento,
    estadoCliente,
    busqueda: String(query.busqueda || '').trim().slice(0, 160),
    today,
    dias,
    diasSinCompra,
    comprasMinimas,
    minimoFiadosCerrados,
    porcentajePuntualMinimo,
    periodoDias,
    page,
    pageSize,
    saldoMinimoCents,
    saldoMaximoCents,
    periodFrom,
    periodThrough,
    periodStart,
    periodEndExclusive,
    order,
    direction
  };
}

function metricCtes() {
  return `WITH ventas_cliente AS (
    SELECT v.idTienda, v.idCliente,
           MAX(v.fecha) ultimaCompra,
           SUM(CASE WHEN v.fecha>=? AND v.fecha<? THEN 1 ELSE 0 END) cantidadCompras,
           COALESCE(SUM(CASE WHEN v.fecha>=? AND v.fecha<? THEN v.total ELSE 0 END),0) totalComprado
    FROM venta v WHERE v.idTienda=? AND v.idCliente IS NOT NULL GROUP BY v.idTienda,v.idCliente
  ), deudas_cliente AS (
    SELECT f.idTienda, f.idCliente,
           COALESCE(SUM(CASE WHEN f.saldoPendiente>0 THEN f.saldoPendiente ELSE 0 END),0) saldoPendiente,
           SUM(CASE WHEN f.saldoPendiente>0 THEN 1 ELSE 0 END) fiadosAbiertos,
           MIN(CASE WHEN f.saldoPendiente>0 THEN f.fechaInicio END) deudaMasAntigua,
           MIN(CASE WHEN f.saldoPendiente>0 AND COALESCE(f.fechaPrometidaPago,f.fechaVencimiento)>=?
                    THEN COALESCE(f.fechaPrometidaPago,f.fechaVencimiento) END) proximaDeuda,
           MIN(CASE WHEN f.saldoPendiente>0 AND f.fechaPrometidaPago IS NOT NULL THEN f.fechaPrometidaPago END) fechaPrometida,
           COALESCE(SUM(CASE WHEN f.saldoPendiente>0 AND f.activo=1 AND f.cerradoEn IS NULL
                 AND f.fechaVencimiento IS NOT NULL AND f.fechaVencimiento<? THEN f.saldoPendiente ELSE 0 END),0) saldoVencido,
           SUM(CASE WHEN f.saldoPendiente>0 AND f.activo=1 AND f.cerradoEn IS NULL
                 AND f.fechaVencimiento IS NOT NULL AND f.fechaVencimiento<? THEN 1 ELSE 0 END) fiadosVencidos,
           COALESCE(MAX(CASE WHEN f.saldoPendiente>0 AND f.activo=1 AND f.cerradoEn IS NULL
                 AND f.fechaVencimiento IS NOT NULL AND f.fechaVencimiento<?
                 THEN DATEDIFF(?,f.fechaVencimiento) END),0) diasMaximoAtraso,
           SUM(CASE WHEN f.saldoPendiente>0 AND f.activo=1 AND f.cerradoEn IS NULL
                 AND f.fechaPrometidaPago IS NOT NULL AND f.fechaPrometidaPago<? THEN 1 ELSE 0 END) promesasIncumplidas,
           SUM(CASE WHEN f.saldoPendiente=0 AND f.cerradoEn>=? AND f.cerradoEn<? THEN 1 ELSE 0 END) fiadosCerrados,
           SUM(CASE WHEN f.saldoPendiente=0 AND f.cerradoEn>=? AND f.cerradoEn<?
                 AND f.fechaVencimiento IS NOT NULL THEN 1 ELSE 0 END) fiadosCerradosEvaluables,
           SUM(CASE WHEN f.saldoPendiente=0 AND f.cerradoEn>=? AND f.cerradoEn<?
                 AND f.fechaVencimiento IS NOT NULL AND DATE(f.cerradoEn)<=f.fechaVencimiento THEN 1 ELSE 0 END) fiadosPuntuales
    FROM fiado f WHERE f.idTienda=? GROUP BY f.idTienda,f.idCliente
  ), gestiones_cliente AS (
    SELECT idTienda, idCliente, MAX(creadoEn) ultimaGestion FROM seguimientoCobranza
    WHERE idTienda=? GROUP BY idTienda,idCliente
  ), metricas AS (
    SELECT c.idCliente, c.nombre, c.telefono, c.documentoNormalizado, c.activo, c.eliminadoEn,
           vc.ultimaCompra,
           COALESCE(vc.cantidadCompras,0) cantidadCompras,
           COALESCE(vc.totalComprado,0) totalComprado,
           CASE WHEN COALESCE(vc.cantidadCompras,0)>0
                THEN ROUND(vc.totalComprado/vc.cantidadCompras,2) ELSE 0 END ticketPromedio,
           CASE WHEN vc.ultimaCompra IS NULL THEN NULL ELSE DATEDIFF(?,DATE(vc.ultimaCompra)) END diasDesdeUltimaCompra,
           COALESCE(dc.saldoPendiente,0) saldoPendiente,
           COALESCE(dc.saldoVencido,0) saldoVencido,
           COALESCE(dc.fiadosAbiertos,0) fiadosAbiertos,
           COALESCE(dc.fiadosVencidos,0) fiadosVencidos,
           COALESCE(dc.diasMaximoAtraso,0) diasMaximoAtraso,
           dc.deudaMasAntigua, dc.proximaDeuda, dc.fechaPrometida,
           COALESCE(dc.promesasIncumplidas,0) promesasIncumplidas,
           COALESCE(dc.fiadosCerrados,0) fiadosCerrados,
           COALESCE(dc.fiadosCerradosEvaluables,0) fiadosCerradosEvaluables,
           CASE WHEN COALESCE(dc.fiadosCerradosEvaluables,0)>0
                THEN ROUND(100*dc.fiadosPuntuales/dc.fiadosCerradosEvaluables,2) ELSE NULL END porcentajePuntualidad,
           gc.ultimaGestion
    FROM cliente c
    LEFT JOIN ventas_cliente vc ON vc.idTienda=c.idTienda AND vc.idCliente=c.idCliente
    LEFT JOIN deudas_cliente dc ON dc.idTienda=c.idTienda AND dc.idCliente=c.idCliente
    LEFT JOIN gestiones_cliente gc ON gc.idTienda=c.idTienda AND gc.idCliente=c.idCliente
    WHERE c.idTienda=?
  )`;
}

function cteParameters(idTienda, parameters) {
  const p = parameters;
  return [
    p.periodStart, p.periodEndExclusive, p.periodStart, p.periodEndExclusive, idTienda,
    p.today, p.today, p.today, p.today, p.today, p.today,
    p.periodStart, p.periodEndExclusive,
    p.periodStart, p.periodEndExclusive,
    p.periodStart, p.periodEndExclusive,
    idTienda, idTienda, p.today, idTienda
  ];
}

function filteredConditions(parameters) {
  const conditions = [];
  const params = [];
  if (parameters.estadoCliente === 'activos') conditions.push('activo=1');
  if (parameters.estadoCliente === 'ocultos') conditions.push('activo=0');
  if (parameters.busqueda) {
    const like = `%${escapeLike(parameters.busqueda)}%`;
    conditions.push(`(nombre LIKE ? ESCAPE '\\\\' OR telefono LIKE ? ESCAPE '\\\\'
      OR documentoNormalizado LIKE ? ESCAPE '\\\\')`);
    params.push(like, like, like);
  }
  if (parameters.saldoMinimoCents !== null) {
    conditions.push('saldoPendiente>=?');
    params.push(centsToDecimal(parameters.saldoMinimoCents));
  }
  if (parameters.saldoMaximoCents !== null) {
    conditions.push('saldoPendiente<=?');
    params.push(centsToDecimal(parameters.saldoMaximoCents));
  }

  switch (parameters.segmento) {
    case 'frecuentes':
      conditions.push('cantidadCompras>=?');
      params.push(parameters.comprasMinimas);
      break;
    case 'inactivos':
      conditions.push('(ultimaCompra IS NULL OR diasDesdeUltimaCompra>=?)');
      params.push(parameters.diasSinCompra);
      break;
    case 'con_deuda':
      conditions.push('saldoPendiente>0');
      break;
    case 'vencidos':
      conditions.push('saldoVencido>0');
      break;
    case 'promesa_incumplida':
      conditions.push('promesasIncumplidas>0');
      break;
    case 'buenos_pagadores':
      conditions.push('fiadosCerrados>=?', 'fiadosCerradosEvaluables>=?', 'porcentajePuntualidad>=?', 'saldoVencido=0', 'promesasIncumplidas=0');
      params.push(parameters.minimoFiadosCerrados, parameters.minimoFiadosCerrados, parameters.porcentajePuntualMinimo);
      break;
    case 'mayor_compra':
      conditions.push('cantidadCompras>0');
      break;
    case 'mayor_saldo':
      conditions.push('saldoPendiente>0');
      break;
    default:
      break;
  }
  return { sql: conditions.length ? conditions.join(' AND ') : '1=1', params };
}

function orderSql(parameters) {
  const principal = parameters.order
    ? [`${parameters.order} ${parameters.direction.toUpperCase()}`]
    : DEFAULT_SORT[parameters.segmento];
  return [...principal, 'nombre ASC', 'idCliente ASC'].join(', ');
}

function criterionText(parameters) {
  const period = `${parameters.periodFrom} a ${parameters.periodThrough}`;
  const criteria = {
    frecuentes: `${parameters.comprasMinimas} o mas compras entre ${period}.`,
    inactivos: `Sin compras durante ${parameters.diasSinCompra} dias o sin compras registradas.`,
    con_deuda: 'Saldo pendiente almacenado y reconciliado mayor que cero.',
    vencidos: `Saldo abierto con fecha de vencimiento original anterior a ${parameters.today}.`,
    promesa_incumplida: `Saldo abierto con fecha prometida anterior a ${parameters.today}.`,
    buenos_pagadores: `Al menos ${parameters.minimoFiadosCerrados} fiados cerrados y evaluables entre ${period}, ${parameters.porcentajePuntualMinimo}% de puntualidad, sin vencidos ni promesas incumplidas actuales.`,
    mayor_compra: `Compras acumuladas entre ${period}, ordenadas por valor.`,
    mayor_saldo: 'Saldo pendiente total, ordenado de mayor a menor.'
  };
  return criteria[parameters.segmento];
}

function reasonFor(row, parameters) {
  switch (parameters.segmento) {
    case 'frecuentes': return `Frecuente: ${row.cantidadCompras} compras entre ${parameters.periodFrom} y ${parameters.periodThrough}.`;
    case 'inactivos': return row.ultimaCompra
      ? `Inactivo: ${row.diasDesdeUltimaCompra} dias desde su ultima compra.`
      : 'Inactivo: nunca realizo una compra.';
    case 'con_deuda': return `Con deuda: Bs ${row.saldoPendiente} en ${row.fiadosAbiertos} fiado(s) abierto(s).`;
    case 'vencidos': return `Vencido: Bs ${row.saldoVencido} y hasta ${row.diasMaximoAtraso} dias de atraso.`;
    case 'promesa_incumplida': return `Promesa incumplida: compromiso del ${row.fechaPrometida || 'sin fecha disponible'}.`;
    case 'buenos_pagadores': return `Buen pagador: ${row.porcentajePuntualidad}% puntual en ${row.fiadosCerradosEvaluables} fiados evaluables.`;
    case 'mayor_compra': return `Volumen: Bs ${row.totalComprado} en ${row.cantidadCompras} compra(s).`;
    case 'mayor_saldo': return `Saldo: Bs ${row.saldoPendiente}, de los cuales Bs ${row.saldoVencido} estan vencidos.`;
    default: return '';
  }
}

function publicRow(row, parameters) {
  return {
    idCliente: Number(row.idCliente),
    nombre: row.nombre,
    telefono: row.telefono,
    activo: Boolean(row.activo),
    eliminadoEn: row.eliminadoEn,
    ultimaCompra: row.ultimaCompra,
    totalComprado: row.totalComprado,
    cantidadCompras: Number(row.cantidadCompras || 0),
    ticketPromedio: row.ticketPromedio,
    saldoPendiente: row.saldoPendiente,
    saldoVencido: row.saldoVencido,
    fiadosAbiertos: Number(row.fiadosAbiertos || 0),
    fiadosVencidos: Number(row.fiadosVencidos || 0),
    diasDesdeUltimaCompra: row.diasDesdeUltimaCompra === null ? null : Number(row.diasDesdeUltimaCompra),
    diasMaximoAtraso: Number(row.diasMaximoAtraso || 0),
    deudaMasAntigua: row.deudaMasAntigua,
    proximaDeuda: row.proximaDeuda,
    fechaPrometida: row.fechaPrometida,
    ultimaGestion: row.ultimaGestion,
    fiadosCerrados: Number(row.fiadosCerrados || 0),
    fiadosCerradosEvaluables: Number(row.fiadosCerradosEvaluables || 0),
    porcentajePuntualidad: row.porcentajePuntualidad === null ? null : Number(row.porcentajePuntualidad),
    motivo: reasonFor(row, parameters)
  };
}

function summaryFor(row, segment) {
  const common = { totalClientes: Number(row.totalClientes || 0) };
  if (['frecuentes', 'mayor_compra'].includes(segment)) return {
    ...common,
    totalComprado: row.totalComprado,
    ticketPromedio: row.ticketPromedio
  };
  if (segment === 'inactivos') return common;
  if (segment === 'buenos_pagadores') return {
    ...common,
    totalComprado: row.totalComprado,
    porcentajePuntualPromedio: row.porcentajePuntualPromedio === null ? null : Number(row.porcentajePuntualPromedio)
  };
  return {
    ...common,
    saldoPendiente: row.saldoPendiente,
    saldoVencido: row.saldoVencido,
    clientesConDeuda: Number(row.clientesConDeuda || 0),
    clientesVencidos: Number(row.clientesVencidos || 0)
  };
}

async function segmentCustomers(connection, idTienda, query = {}) {
  const parameters = normalizeParameters(query);
  const filtered = filteredConditions(parameters);
  const ctes = metricCtes();
  const baseParams = cteParameters(idTienda, parameters);
  const offset = (parameters.page - 1) * parameters.pageSize;
  const [rowsResult, summaryResult] = await Promise.all([
    connection.query(
      `${ctes}, filtrados AS (SELECT * FROM metricas WHERE ${filtered.sql})
       SELECT * FROM filtrados ORDER BY ${orderSql(parameters)} LIMIT ? OFFSET ?`,
      [...baseParams, ...filtered.params, parameters.pageSize, offset]
    ),
    connection.query(
      `${ctes}, filtrados AS (SELECT * FROM metricas WHERE ${filtered.sql})
       SELECT COUNT(*) totalClientes,
              COALESCE(SUM(totalComprado),0) totalComprado,
              CASE WHEN COALESCE(SUM(cantidadCompras),0)>0
                   THEN ROUND(SUM(totalComprado)/SUM(cantidadCompras),2) ELSE 0 END ticketPromedio,
              COALESCE(SUM(saldoPendiente),0) saldoPendiente,
              COALESCE(SUM(saldoVencido),0) saldoVencido,
              SUM(saldoPendiente>0) clientesConDeuda,
              SUM(saldoVencido>0) clientesVencidos,
              AVG(porcentajePuntualidad) porcentajePuntualPromedio
       FROM filtrados`,
      [...baseParams, ...filtered.params]
    )
  ]);
  const rows = rowsResult[0];
  const summaryRow = summaryResult[0][0];
  const total = Number(summaryRow.totalClientes || 0);
  const totalPages = Math.max(1, Math.ceil(total / parameters.pageSize));
  return {
    segmento: parameters.segmento,
    descripcion: DESCRIPTIONS[parameters.segmento],
    criterios: criterionText(parameters),
    parametrosAplicados: {
      estadoCliente: parameters.estadoCliente,
      busqueda: parameters.busqueda || null,
      fechaDesde: parameters.periodFrom,
      fechaHasta: parameters.periodThrough,
      dias: parameters.dias,
      diasSinCompra: parameters.diasSinCompra,
      comprasMinimas: parameters.comprasMinimas,
      minimoFiadosCerrados: parameters.minimoFiadosCerrados,
      porcentajePuntualMinimo: parameters.porcentajePuntualMinimo,
      periodoDias: parameters.periodoDias,
      saldoMinimo: parameters.saldoMinimoCents === null ? null : centsToDecimal(parameters.saldoMinimoCents),
      saldoMaximo: parameters.saldoMaximoCents === null ? null : centsToDecimal(parameters.saldoMaximoCents),
      orden: parameters.order || null,
      direccion: parameters.direction
    },
    resumen: summaryFor(summaryRow, parameters.segmento),
    resultados: rows.map((row) => publicRow(row, parameters)),
    paginacion: {
      page: parameters.page,
      pageSize: parameters.pageSize,
      total,
      totalPages,
      hasNextPage: parameters.page < totalPages,
      hasPreviousPage: parameters.page > 1
    }
  };
}

module.exports = {
  SEGMENTS,
  normalizeParameters,
  segmentCustomers
};
