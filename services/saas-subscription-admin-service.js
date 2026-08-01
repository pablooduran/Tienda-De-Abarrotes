const pool = require('../config/db');
const { accessDescription } = require('../config/subscription-access-policy');
const { limitAvailability } = require('../config/subscription-plan-change-contract');
const { historyQuery, listQuery, storeReference } = require('../config/saas-subscription-admin-contract');
const {
  cancelSubscription,
  computeEffectiveStatus,
  reactivateSubscription,
  renewSubscription,
  suspendSubscription
} = require('./subscription-lifecycle-service');
const { subscriptionPlanService } = require('./subscription-plan-service');
const { resolveSubscriptionContext } = require('./subscription-service');
const {
  addLocalDays, formatLocalDateTime, getLocalNow, parseLocalDate, parseLocalDateTime
} = require('../utils/local-datetime');

function adminError(status, message, code) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

async function storeByReference(database, reference) {
  const slug = storeReference(reference);
  const [rows] = await database.query(
    'SELECT idTienda,nombre,slug,estado,activo FROM tienda WHERE slug=? LIMIT 1',
    [slug]
  );
  if (!rows.length) throw adminError(404, 'La tienda no existe.', 'STORE_NOT_FOUND');
  return rows[0];
}

function safeHistoryMetadata(raw) {
  if (!raw) return {};
  let source = raw;
  if (typeof raw === 'string') {
    try { source = JSON.parse(raw); } catch { return {}; }
  }
  const allowed = new Set([
    'planCodigo', 'tipoSuscripcion', 'tipoPeriodo', 'planCodigoAnterior',
    'planCodigoNuevo', 'fechaAplicacion', 'limitesExcedidos', 'motivoCodigo'
  ]);
  return Object.fromEntries(Object.entries(source || {}).filter(([key]) => allowed.has(key)));
}

function itemFromContext(context, now = getLocalNow()) {
  const subscription = context.suscripcion;
  const effective = subscription?.estadoEfectivo || 'sin_suscripcion';
  const access = accessDescription(effective);
  const availability = limitAvailability(context.limites || {}, context.uso || {});
  const excesses = Object.entries(availability)
    .filter(([, value]) => value.excedido)
    .map(([key]) => key);
  return Object.freeze({
    referencia: context.tienda.slug,
    tienda: context.tienda.nombre,
    estadoTienda: context.tienda.estado,
    estado: subscription?.estado || 'sin_suscripcion',
    estadoEfectivo: effective,
    acceso: access.nivel,
    siguienteAccion: access.siguienteAccion,
    tipo: subscription?.tipo || null,
    plan: context.plan ? { codigo: context.plan.codigo, nombre: context.plan.nombre } : null,
    fechaInicio: subscription?.fechaInicio || null,
    fechaFin: subscription?.fechaFin || null,
    fechaFinGracia: subscription?.fechaFinGracia || null,
    diasRestantes: subscription?.diasRestantes ?? null,
    downgradeProgramado: Boolean(subscription?.idPlanSiguiente),
    fechaPlanSiguiente: subscription?.fechaAplicacionPlanSiguiente || null,
    limites: context.limites || {},
    uso: context.uso || {},
    disponibilidad: availability,
    excesos: excesses,
    vencimientoProximo: Boolean(subscription?.fechaFin)
      && parseLocalDateTime(subscription.fechaFin) >= now
      && parseLocalDateTime(subscription.fechaFin).getTime() - now.getTime() <= 7 * 86400000
  });
}

async function allItems(database, now = getLocalNow()) {
  const [stores] = await database.query('SELECT idTienda FROM tienda ORDER BY idTienda');
  const contexts = await Promise.all(stores.map((store) => (
    resolveSubscriptionContext(database, Number(store.idTienda), { now: formatLocalDateTime(now) })
  )));
  return contexts.map((context) => itemFromContext(context, now));
}

function filterItems(items, filters) {
  const search = filters.search.toLocaleLowerCase('es');
  return items.filter((item) => {
    if (search && !item.tienda.toLocaleLowerCase('es').includes(search)
      && !item.referencia.toLocaleLowerCase('es').includes(search)) return false;
    if (filters.estado && item.estadoEfectivo !== filters.estado && item.estado !== filters.estado) return false;
    if (filters.acceso && item.acceso !== filters.acceso) return false;
    if (filters.tipo && item.tipo !== filters.tipo) return false;
    if (filters.plan && item.plan?.codigo !== filters.plan) return false;
    if (filters.vencimiento === 'proximo' && !item.vencimientoProximo) return false;
    if (filters.vencimiento === 'gracia' && item.estadoEfectivo !== 'gracia') return false;
    if (filters.downgrade && !item.downgradeProgramado) return false;
    if (filters.excedidos && !item.excesos.length) return false;
    return true;
  });
}

function sortItems(items, order) {
  const sorted = [...items];
  const text = (value) => String(value || '').localeCompare(String(value || ''), 'es');
  sorted.sort((left, right) => {
    if (order === 'tienda') return text(left.tienda, right.tienda);
    if (order === 'estado') return text(left.estadoEfectivo, right.estadoEfectivo) || text(left.tienda, right.tienda);
    if (order === 'plan') return text(left.plan?.codigo, right.plan?.codigo) || text(left.tienda, right.tienda);
    return text(left.fechaFin || '9999', right.fechaFin || '9999') || text(left.tienda, right.tienda);
  });
  return sorted;
}

async function listSubscriptions(database = pool, query = {}) {
  const filters = listQuery(query);
  const filtered = sortItems(filterItems(await allItems(database), filters), filters.orden);
  const offset = (filters.page - 1) * filters.pageSize;
  return Object.freeze({
    resultados: Object.freeze(filtered.slice(offset, offset + filters.pageSize)),
    paginacion: Object.freeze({
      pagina: filters.page,
      limite: filters.pageSize,
      total: filtered.length,
      paginas: Math.max(1, Math.ceil(filtered.length / filters.pageSize))
    })
  });
}

async function subscriptionSummary(database = pool) {
  const items = await allItems(database);
  const byPlan = {};
  const byType = {};
  const summary = {
    total: items.length, prueba: 0, activas: 0, gracia: 0, suspendidas: 0,
    canceladas: 0, vencimientosProximos: 0, limitesExcedidos: 0, downgradeProgramado: 0
  };
  for (const item of items) {
    if (item.tipo === 'prueba') summary.prueba += 1;
    if (item.estadoEfectivo === 'activa') summary.activas += 1;
    if (item.estadoEfectivo === 'gracia') summary.gracia += 1;
    if (item.estadoEfectivo === 'suspendida') summary.suspendidas += 1;
    if (item.estadoEfectivo === 'cancelada') summary.canceladas += 1;
    if (item.vencimientoProximo) summary.vencimientosProximos += 1;
    if (item.excesos.length) summary.limitesExcedidos += 1;
    if (item.downgradeProgramado) summary.downgradeProgramado += 1;
    if (item.plan?.codigo) byPlan[item.plan.codigo] = (byPlan[item.plan.codigo] || 0) + 1;
    if (item.tipo) byType[item.tipo] = (byType[item.tipo] || 0) + 1;
  }
  return Object.freeze({ ...summary, porPlan: byPlan, porTipo: byType });
}

async function subscriptionDetail(database = pool, reference, query = {}) {
  const store = await storeByReference(database, reference);
  const context = await resolveSubscriptionContext(database, Number(store.idTienda));
  const item = itemFromContext(context);
  const historyFilters = historyQuery(query);
  const conditions = ['h.idTienda=?'];
  const values = [store.idTienda];
  const add = (sql, value) => { if (value) { conditions.push(sql); values.push(value); } };
  add('h.tipoOperacion=?', historyFilters.operation);
  add('h.estadoAnterior=?', historyFilters.previousState);
  add('h.estadoNuevo=?', historyFilters.nextState);
  add('h.actorTipo=?', historyFilters.actor);
  add('h.creadoEn>=?', historyFilters.desde && formatLocalDateTime(parseLocalDate(historyFilters.desde)));
  add('h.creadoEn<?', historyFilters.hasta
    && formatLocalDateTime(addLocalDays(parseLocalDate(historyFilters.hasta), 1)));
  const [[count]] = await database.query(
    `SELECT COUNT(*) total FROM historialSuscripcionTienda h WHERE ${conditions.join(' AND ')}`,
    values
  );
  const offset = (historyFilters.page - 1) * historyFilters.pageSize;
  const [history] = await database.query(
    `SELECT h.estadoAnterior,h.estadoNuevo,h.tipoOperacion,h.motivo,h.actorTipo,h.metadatos,h.creadoEn,
            a.usuario actor
     FROM historialSuscripcionTienda h
     LEFT JOIN administrador a ON a.idAdministrador=h.idAdministradorActor
     WHERE ${conditions.join(' AND ')}
     ORDER BY h.creadoEn DESC,h.idHistorialSuscripcion DESC LIMIT ? OFFSET ?`,
    [...values, historyFilters.pageSize, offset]
  );
  const [audit] = await database.query(
    `SELECT accion,resultado,codigoResultado,metadatos,creadoEn
     FROM eventoAuditoriaAdministrativa
     WHERE idTienda=? AND categoria='suscripcion'
     ORDER BY creadoEn DESC,idEventoAuditoria DESC LIMIT 10`,
    [store.idTienda]
  );
  const plans = context.suscripcion
    ? await subscriptionPlanService.list({
      idTienda: store.idTienda,
      idSuscripcion: context.suscripcion.idSuscripcion,
      uso: context.uso
    })
    : { planActual: null, planProgramado: null, planes: [] };
  const [transitionRows] = context.suscripcion ? await database.query(
    `SELECT suspendidaEn,reactivadaEn,canceladaEn,motivoTransicion
     FROM suscripcionTienda WHERE idTienda=? AND idSuscripcion=? LIMIT 1`,
    [store.idTienda, context.suscripcion.idSuscripcion]
  ) : [[]];
  const transition = transitionRows[0] || {};
  return Object.freeze({
    ...item,
    suspendidaEn: transition.suspendidaEn || null,
    reactivadaEn: transition.reactivadaEn || null,
    canceladaEn: transition.canceladaEn || null,
    motivoTransicion: transition.motivoTransicion || null,
    planProgramado: plans.planProgramado,
    planes: plans.planes,
    funcionalidades: [...(context.caracteristicas || [])],
    historial: Object.freeze({
      resultados: history.map((row) => Object.freeze({
        estadoAnterior: row.estadoAnterior,
        estadoNuevo: row.estadoNuevo,
        operacion: row.tipoOperacion,
        motivo: row.motivo,
        actorTipo: row.actorTipo,
        actor: row.actor || row.actorTipo,
        metadata: safeHistoryMetadata(row.metadatos),
        fecha: row.creadoEn
      })),
      paginacion: Object.freeze({
        pagina: historyFilters.page,
        limite: historyFilters.pageSize,
        total: Number(count.total),
        paginas: Math.max(1, Math.ceil(Number(count.total) / historyFilters.pageSize))
      })
    }),
    accionesAdministrativas: Object.freeze(audit.map((row) => Object.freeze({
      accion: row.accion,
      resultado: row.resultado,
      codigo: row.codigoResultado,
      metadata: safeHistoryMetadata(row.metadatos),
      fecha: row.creadoEn
    })))
  });
}

async function actionTarget(database, reference) {
  const store = await storeByReference(database, reference);
  const context = await resolveSubscriptionContext(database, Number(store.idTienda));
  if (!context.suscripcion) throw adminError(404, 'La tienda no tiene una suscripcion.', 'SUBSCRIPTION_NOT_FOUND');
  return { store, context };
}

function safeMutationResult(result) {
  return Object.freeze({
    codigo: result.codigo,
    estado: result.estado,
    estadoEfectivo: result.estadoEfectivo,
    fechaInicio: result.fechaInicio,
    fechaFin: result.fechaFin,
    fechaFinGracia: result.fechaFinGracia,
    replayed: Boolean(result.replayed),
    plan: result.plan || null,
    fechaAplicacion: result.fechaAplicacion || null
  });
}

async function mutate(database, input) {
  const { store, context } = await actionTarget(database, input.reference);
  const base = {
    idTienda: Number(store.idTienda),
    idSuscripcion: context.suscripcion.idSuscripcion,
    idAdministrador: input.idAdministrador,
    actorTipo: 'administrador',
    claveOperacion: input.idempotencyKey,
    requestId: input.requestId
  };
  let result;
  if (input.action === 'suspender') {
    result = await suspendSubscription(database, { ...base, motivoCodigo: input.body.motivo });
  } else if (input.action === 'reactivar') {
    result = await reactivateSubscription(database, { ...base, periodo: input.body.periodo });
  } else if (input.action === 'renovar') {
    result = await renewSubscription(database, { ...base, periodo: input.body.periodo });
  } else if (input.action === 'cancelar') {
    result = await cancelSubscription(database, { ...base, motivoCodigo: input.body.motivo });
  } else if (input.action === 'upgrade') {
    result = await subscriptionPlanService.upgrade({
      ...base, body: { codigoPlan: input.body.codigoPlan }, idempotencyKey: input.idempotencyKey
    });
  } else if (input.action === 'downgrade') {
    result = await subscriptionPlanService.scheduleDowngrade({
      ...base, body: { codigoPlan: input.body.codigoPlan }, idempotencyKey: input.idempotencyKey
    });
  } else {
    throw adminError(400, 'La accion administrativa no es valida.', 'INVALID_SAAS_SUBSCRIPTION_ACTION');
  }
  return safeMutationResult(result);
}

function createSaasSubscriptionAdminService({ database = pool } = {}) {
  return Object.freeze({
    list: (query) => listSubscriptions(database, query),
    summary: () => subscriptionSummary(database),
    detail: (reference, query) => subscriptionDetail(database, reference, query),
    mutate: (input) => mutate(database, input)
  });
}

module.exports = {
  createSaasSubscriptionAdminService,
  listSubscriptions,
  subscriptionDetail,
  subscriptionSummary
};
