const {
  addLocalDays,
  formatLocalDateTime,
  getLocalNow,
  parseLocalDateTime
} = require('../utils/local-datetime');
const {
  SUBSCRIPTION_ACTOR_TYPES,
  SUBSCRIPTION_GRACE_DAYS,
  sanitizeLifecycleMetadata,
  snapshotFromPlan
} = require('../config/subscription-lifecycle-contract');
const { computeEffectiveStatus } = require('./subscription-lifecycle-service');
const { limitAvailability } = require('../config/subscription-plan-change-contract');

const LIMITS = Object.freeze({
  propietarios: {
    column: 'limitePropietarios',
    label: 'propietarios activos',
    countSql: "SELECT COUNT(*) total FROM administrador WHERE idTienda=? AND rol='dueno_tienda' AND activo=1"
  },
  productos: {
    column: 'limiteProductos',
    label: 'productos activos',
    countSql: 'SELECT COUNT(*) total FROM producto WHERE idTienda=? AND activo=1'
  },
  clientes: {
    column: 'limiteClientes',
    label: 'clientes activos',
    countSql: 'SELECT COUNT(*) total FROM cliente WHERE idTienda=? AND activo=1'
  },
  proveedores: {
    column: 'limiteProveedores',
    label: 'proveedores',
    countSql: 'SELECT COUNT(*) total FROM proveedor WHERE idTienda=?'
  }
});

const SUBSCRIPTION_TYPES = new Set(['prueba', 'pagada', 'cortesia']);

function httpError(status, message, code) {
  const error = new Error(message);
  error.status = status;
  if (code) error.code = code;
  return error;
}

function cleanText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function parseDate(value, label) {
  if (!value) return null;
  try {
    return parseLocalDateTime(value);
  } catch {
    throw httpError(400, `${label} no es valida.`);
  }
}

function effectiveStatus(subscription, now = getLocalNow()) {
  return computeEffectiveStatus(subscription, now);
}

async function findPlanByCode(connection, code, { requireActive = true, forUpdate = false } = {}) {
  const normalized = cleanText(code).toLowerCase();
  if (!normalized) throw httpError(400, 'Debe seleccionar un plan.');
  const [rows] = await connection.query(
    `SELECT idPlan, codigo, nombre, descripcion, activo, precioMensual, duracionDias,
       limitePropietarios, limiteProductos, limiteClientes, limiteProveedores
     FROM plan WHERE codigo=?${forUpdate ? ' FOR UPDATE' : ''}`,
    [normalized]
  );
  if (!rows.length) throw httpError(400, 'El plan seleccionado no existe.');
  if (requireActive && Number(rows[0].activo) !== 1) {
    throw httpError(409, 'El plan seleccionado no esta disponible.');
  }
  return rows[0];
}

async function usageForStore(connection, idTienda) {
  const entries = await Promise.all(Object.entries(LIMITS).map(async ([key, definition]) => {
    const [[row]] = await connection.query(definition.countSql, [idTienda]);
    return [key, Number(row.total || 0)];
  }));
  return Object.fromEntries(entries);
}

async function enabledFeatures(connection, idTienda, idSuscripcion) {
  if (!idSuscripcion) return [];
  const [rows] = await connection.query(
    `SELECT codigoFuncionalidad codigo
     FROM suscripcionFuncionalidadSnapshot
     WHERE idTienda=? AND idSuscripcion=?
     ORDER BY codigoFuncionalidad`,
    [idTienda, idSuscripcion]
  );
  return rows.map((row) => row.codigo);
}

async function insertFeatureSnapshot(connection, subscription, plan) {
  await connection.query(
    `INSERT INTO suscripcionFuncionalidadSnapshot
      (idTienda,idSuscripcion,codigoFuncionalidad,nombreFuncionalidad,creadoEn)
     SELECT ?, ?, f.codigo, f.nombre, ?
     FROM planFuncionalidad pf
     JOIN funcionalidad f ON f.idFuncionalidad=pf.idFuncionalidad
     WHERE pf.idPlan=? AND pf.habilitada=1 AND f.activo=1`,
    [subscription.idTienda, subscription.idSuscripcion, subscription.creadoEn, plan.idPlan]
  );
}

async function insertLifecycleHistory(connection, input) {
  const actorType = SUBSCRIPTION_ACTOR_TYPES.includes(input.actorTipo)
    ? input.actorTipo
    : input.idAdministradorActor ? 'administrador' : 'sistema';
  const actorId = actorType === 'administrador' ? Number(input.idAdministradorActor) : null;
  if (actorType === 'administrador' && (!Number.isInteger(actorId) || actorId <= 0)) {
    throw new Error('El actor administrativo del historial no es valido.');
  }
  const metadata = sanitizeLifecycleMetadata(input.tipoOperacion, input.metadatos);
  const [result] = await connection.query(
    `INSERT INTO historialSuscripcionTienda
      (idTienda,idSuscripcion,estadoAnterior,estadoNuevo,tipoOperacion,motivo,
       actorTipo,idAdministradorActor,metadatos,creadoEn)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.idTienda,
      input.idSuscripcion,
      input.estadoAnterior || null,
      input.estadoNuevo,
      input.tipoOperacion,
      input.motivo,
      actorType,
      actorId,
      Object.keys(metadata).length ? JSON.stringify(metadata) : null,
      input.creadoEn
    ]
  );
  return Number(result.insertId);
}

async function resolveSubscriptionContext(connection, idTienda, options = {}) {
  const now = options.now === undefined || options.now === null
    ? getLocalNow()
    : parseLocalDateTime(options.now);
  const localNow = formatLocalDateTime(now);
  const [rows] = await connection.query(
    `SELECT t.idTienda, t.nombre AS tiendaNombre, t.slug AS tiendaSlug,
       t.activo AS tiendaActiva, t.estado AS tiendaEstado,
       s.idSuscripcion, s.tipo, s.estado, s.fechaInicio, s.fechaFin, s.fechaFinGracia,
       s.renovacionAutomatica, s.idPlan, s.idPlanSiguiente, s.fechaAplicacionPlanSiguiente,
       s.tipoPeriodoSnapshot, s.duracionDiasSnapshot,
       s.planCodigoSnapshot AS planCodigo, s.planNombreSnapshot AS planNombre,
       s.limitePropietariosSnapshot AS limitePropietarios,
       s.limiteProductosSnapshot AS limiteProductos,
       s.limiteClientesSnapshot AS limiteClientes,
       s.limiteProveedoresSnapshot AS limiteProveedores
     FROM tienda t
     LEFT JOIN suscripcionTienda s ON s.idSuscripcion=(
       SELECT s2.idSuscripcion FROM suscripcionTienda s2
       WHERE s2.idTienda=t.idTienda
       ORDER BY
         CASE WHEN s2.fechaInicio<=? THEN 0 ELSE 1 END,
         CASE WHEN s2.fechaInicio<=? THEN s2.fechaInicio END DESC,
         CASE WHEN s2.fechaInicio>? THEN s2.fechaInicio END ASC,
         s2.idSuscripcion DESC
       LIMIT 1
     )
     WHERE t.idTienda=?`,
    [localNow, localNow, localNow, idTienda]
  );
  if (!rows.length) throw httpError(404, 'La tienda no existe.');
  const row = rows[0];
  const estadoEfectivo = effectiveStatus(row, now);
  const [features, usage] = await Promise.all([
    enabledFeatures(connection, idTienda, row.idSuscripcion),
    usageForStore(connection, idTienda)
  ]);
  const limits = {
    propietarios: row.limitePropietarios === null ? null : Number(row.limitePropietarios),
    productos: row.limiteProductos === null ? null : Number(row.limiteProductos),
    clientes: row.limiteClientes === null ? null : Number(row.limiteClientes),
    proveedores: row.limiteProveedores === null ? null : Number(row.limiteProveedores)
  };
  const daysRemaining = row.fechaFin
    ? Math.max(0, Math.ceil((parseLocalDateTime(row.fechaFin).getTime() - now.getTime()) / 86400000))
    : null;
  const graceDaysRemaining = estadoEfectivo === 'gracia' && row.fechaFinGracia
    ? Math.max(0, Math.ceil((parseLocalDateTime(row.fechaFinGracia).getTime() - now.getTime()) / 86400000))
    : null;
  return {
    tienda: {
      idTienda: Number(row.idTienda),
      nombre: row.tiendaNombre,
      slug: row.tiendaSlug,
      activo: Number(row.tiendaActiva) === 1,
      estado: row.tiendaEstado
    },
    suscripcion: row.idSuscripcion ? {
      idSuscripcion: Number(row.idSuscripcion),
      tipo: row.tipo,
      estado: row.estado,
      estadoEfectivo,
      fechaInicio: row.fechaInicio,
      fechaFin: row.fechaFin,
      fechaFinGracia: row.fechaFinGracia,
      diasRestantes: daysRemaining,
      diasGraciaRestantes: graceDaysRemaining,
      tipoPeriodo: row.tipoPeriodoSnapshot,
      duracionDias: Number(row.duracionDiasSnapshot),
      renovacionAutomatica: Number(row.renovacionAutomatica) === 1,
      idPlanSiguiente: row.idPlanSiguiente === null ? null : Number(row.idPlanSiguiente),
      fechaAplicacionPlanSiguiente: row.fechaAplicacionPlanSiguiente
    } : null,
    plan: row.idPlan ? {
      idPlan: Number(row.idPlan),
      codigo: row.planCodigo,
      nombre: row.planNombre,
      activo: true
    } : null,
    caracteristicas: features,
    limites: limits,
    uso: usage,
    disponibilidad: limitAvailability(limits, usage),
    soloLectura: estadoEfectivo !== 'activa'
  };
}

async function enforcePlanLimit(connection, idTienda, entity, increment = 1) {
  const definition = LIMITS[entity];
  if (!definition) throw new Error(`Limite no configurado: ${entity}.`);
  const context = await resolveSubscriptionContext(connection, idTienda);
  if (!context.plan) throw httpError(403, 'La tienda no tiene un plan asignado.', 'SUBSCRIPTION_REQUIRED');
  const limit = context.limites[entity];
  const current = context.uso[entity];
  if (limit !== null && current + increment > limit) {
    throw httpError(
      409,
      `El plan ${context.plan.nombre} permite hasta ${limit} ${definition.label}. Uso actual: ${current}.`,
      'PLAN_LIMIT_REACHED'
    );
  }
  return { limit, current, unlimited: limit === null };
}

async function createSubscription(connection, input) {
  const idTienda = Number(input.idTienda);
  if (!Number.isInteger(idTienda) || idTienda <= 0) throw httpError(400, 'La tienda no es valida.');
  const [stores] = await connection.query('SELECT idTienda FROM tienda WHERE idTienda=? FOR UPDATE', [idTienda]);
  if (!stores.length) throw httpError(404, 'La tienda no existe.');

  const plan = await findPlanByCode(connection, input.planCodigo, {
    requireActive: true,
    forUpdate: true
  });
  const tipo = cleanText(input.tipo).toLowerCase();
  if (!SUBSCRIPTION_TYPES.has(tipo)) throw httpError(400, 'El tipo de suscripcion no es valido.');

  const now = getLocalNow();
  const start = parseDate(input.fechaInicio, 'La fecha de inicio') || now;
  let end = parseDate(input.fechaFin, 'La fecha de vencimiento');
  if (!end) {
    const defaultDays = tipo === 'prueba' ? 14 : Number(plan.duracionDias || 30);
    const duration = input.duracionDias === undefined || input.duracionDias === ''
      ? defaultDays
      : Number(input.duracionDias);
    const maximum = tipo === 'prueba' ? 90 : 3650;
    if (!Number.isInteger(duration) || duration < 1 || duration > maximum) {
      throw httpError(400, `La duracion debe ser un entero entre 1 y ${maximum} dias.`);
    }
    end = addLocalDays(start, duration);
  }
  if (end <= start) throw httpError(400, 'La fecha de vencimiento debe ser posterior a la fecha de inicio.');

  const observation = cleanText(input.observacion) || null;
  if (observation && observation.length > 500) {
    throw httpError(400, 'La observacion no puede superar 500 caracteres.');
  }
  const startSql = formatLocalDateTime(start);
  const endSql = formatLocalDateTime(end);
  const localNow = formatLocalDateTime(now);
  const status = start > now ? 'pendiente' : 'activa';
  const durationDays = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000));
  const snapshot = snapshotFromPlan(plan, durationDays);
  const graceEndSql = formatLocalDateTime(addLocalDays(end, SUBSCRIPTION_GRACE_DAYS));
  const actorType = SUBSCRIPTION_ACTOR_TYPES.includes(input.actorTipo)
    ? input.actorTipo
    : input.creadoPor ? 'administrador' : 'sistema';
  const operation = tipo === 'prueba' ? 'inicio_prueba' : 'activacion';
  const transitionReason = tipo === 'prueba' ? 'inicio_prueba' : 'asignacion_administrativa';

  await connection.query(
    `UPDATE suscripcionTienda SET estado='vencida', actualizadoEn=?
     WHERE idTienda=? AND estado='activa' AND fechaFin<=?`,
    [localNow, idTienda, localNow]
  );
  await connection.query(
    `UPDATE suscripcionTienda SET estado='cancelada', actualizadoEn=?
     WHERE idTienda=? AND estado IN ('pendiente','activa','suspendida')
       AND fechaInicio<? AND ?<fechaFin`,
    [localNow, idTienda, endSql, startSql]
  );
  const [result] = await connection.query(
    `INSERT INTO suscripcionTienda
      (idTienda,idPlan,tipo,estado,fechaInicio,fechaFin,fechaFinGracia,
       motivoTransicion,planCodigoSnapshot,planNombreSnapshot,tipoPeriodoSnapshot,
       duracionDiasSnapshot,precioReferenciaSnapshot,limitePropietariosSnapshot,
       limiteProductosSnapshot,limiteClientesSnapshot,limiteProveedoresSnapshot,
       renovacionAutomatica,observacion,creadoPor,creadoEn,actualizadoEn)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
    [
      idTienda, plan.idPlan, tipo, status, startSql, endSql, graceEndSql,
      transitionReason, snapshot.planCodigo, snapshot.planNombre,
      snapshot.tipoPeriodo, snapshot.duracionDias, snapshot.precioReferencia,
      snapshot.limitePropietarios, snapshot.limiteProductos,
      snapshot.limiteClientes, snapshot.limiteProveedores, observation,
      input.creadoPor || null, localNow, localNow
    ]
  );
  const subscription = {
    idSuscripcion: Number(result.insertId),
    idTienda,
    idPlan: plan.idPlan,
    planCodigo: plan.codigo,
    tipo,
    estado: status,
    fechaInicio: startSql,
    fechaFin: endSql,
    fechaFinGracia: graceEndSql,
    creadoEn: localNow
  };
  await insertFeatureSnapshot(connection, subscription, plan);
  await insertLifecycleHistory(connection, {
    idTienda,
    idSuscripcion: subscription.idSuscripcion,
    estadoAnterior: null,
    estadoNuevo: status,
    tipoOperacion: operation,
    motivo: transitionReason,
    actorTipo: actorType,
    idAdministradorActor: input.creadoPor || null,
    metadatos: {
      planCodigo: snapshot.planCodigo,
      tipoSuscripcion: tipo,
      tipoPeriodo: snapshot.tipoPeriodo
    },
    creadoEn: localNow
  });
  delete subscription.idTienda;
  delete subscription.creadoEn;
  return subscription;
}

module.exports = {
  LIMITS,
  createSubscription,
  effectiveStatus,
  enforcePlanLimit,
  findPlanByCode,
  resolveSubscriptionContext
};
