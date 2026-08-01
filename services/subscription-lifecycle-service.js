const pool = require('../config/db');
const { administrativeAuditService } = require('./administrative-audit-service');
const {
  addLocalDays,
  formatLocalDateTime,
  getLocalNow,
  parseLocalDateTime
} = require('../utils/local-datetime');
const {
  SUBSCRIPTION_ACTOR_TYPES,
  SUBSCRIPTION_PERIOD_TYPES,
  SUBSCRIPTION_TRANSITION_REASONS,
  sha256,
  sanitizeLifecycleMetadata
} = require('../config/subscription-lifecycle-contract');

const PERIOD_DAYS = Object.freeze({ mensual: 30, anual: 365 });
const MANUAL_SUSPENSION_REASONS = Object.freeze([
  'falta_pago',
  'incumplimiento',
  'solicitud_administrativa',
  'seguridad',
  'otro_controlado'
]);
const REASON_TO_SCHEMA_MOTIVE = Object.freeze({
  falta_pago: 'suspension_administrativa',
  incumplimiento: 'suspension_administrativa',
  solicitud_administrativa: 'suspension_administrativa',
  seguridad: 'suspension_administrativa',
  otro_controlado: 'suspension_administrativa'
});
const OPERATION_TYPES = new Set(['renovar', 'suspender', 'reactivar', 'cancelar', 'cambiar_plan']);
const OPERATION_TTL_DAYS = 2;
const LIMIT_USAGE_SQL = Object.freeze({
  propietarios: "SELECT COUNT(*) total FROM administrador WHERE idTienda=? AND rol='dueno_tienda' AND activo=1",
  productos: 'SELECT COUNT(*) total FROM producto WHERE idTienda=? AND activo=1',
  clientes: 'SELECT COUNT(*) total FROM cliente WHERE idTienda=? AND activo=1',
  proveedores: 'SELECT COUNT(*) total FROM proveedor WHERE idTienda=?'
});

function lifecycleError(status, message, code) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function normalizeNow(value) {
  if (value instanceof Date) return new Date(value.getTime());
  if (value === undefined || value === null) return getLocalNow();
  return parseLocalDateTime(value);
}

function localText(value) {
  return formatLocalDateTime(normalizeNow(value));
}

function positiveId(value, label) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw lifecycleError(400, `${label} no es valido.`, 'INVALID_SUBSCRIPTION_LIFECYCLE_INPUT');
  }
  return id;
}

function operationKey(value) {
  const key = String(value || '').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$/.test(key)) {
    throw lifecycleError(400, 'La clave de operacion no es valida.', 'INVALID_OPERATION_KEY');
  }
  return key;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

function canonicalPayload(value) {
  return JSON.stringify(canonicalize(value || {}));
}

function computeEffectiveStatus(subscription, now = getLocalNow()) {
  if (!subscription?.idSuscripcion) return 'sin_suscripcion';
  const current = String(subscription.estado || '');
  if (current === 'cancelada') return 'cancelada';
  if (current === 'suspendida') return 'suspendida';

  const at = normalizeNow(now);
  const start = parseLocalDateTime(subscription.fechaInicio);
  const end = parseLocalDateTime(subscription.fechaFin);
  if (at < start) return 'pendiente';
  if (current === 'gracia') {
    const graceEnd = subscription.fechaFinGracia
      ? parseLocalDateTime(subscription.fechaFinGracia)
      : addLocalDays(end, 7);
    return at < graceEnd ? 'gracia' : 'suspendida';
  }
  if (at < end) return current === 'pendiente' ? 'activa' : 'activa';

  const graceEnd = subscription.fechaFinGracia
    ? parseLocalDateTime(subscription.fechaFinGracia)
    : addLocalDays(end, 7);
  return at < graceEnd ? 'gracia' : 'suspendida';
}

function assertPeriod(period) {
  const normalized = String(period || 'mensual').trim().toLowerCase();
  if (!SUBSCRIPTION_PERIOD_TYPES.includes(normalized) || !PERIOD_DAYS[normalized]) {
    throw lifecycleError(400, 'El periodo de suscripcion no es valido.', 'INVALID_SUBSCRIPTION_PERIOD');
  }
  return normalized;
}

function assertManualReason(reason) {
  const normalized = String(reason || '').trim().toLowerCase();
  if (!MANUAL_SUSPENSION_REASONS.includes(normalized)) {
    throw lifecycleError(400, 'El motivo de suspension no es valido.', 'INVALID_SUSPENSION_REASON');
  }
  return normalized;
}

function actorFor(input, allowSystem = false) {
  const actorTipo = String(input.actorTipo || (input.idAdministrador ? 'administrador' : 'sistema'));
  if (!SUBSCRIPTION_ACTOR_TYPES.includes(actorTipo)
    || (!allowSystem && actorTipo !== 'administrador')) {
    throw lifecycleError(400, 'El actor de la operacion no es valido.', 'INVALID_SUBSCRIPTION_ACTOR');
  }
  const idAdministrador = actorTipo === 'administrador' ? positiveId(input.idAdministrador, 'El administrador') : null;
  return { actorTipo, idAdministrador };
}

async function withTransaction(database, callback) {
  const connection = await database.getConnection();
  try {
    await connection.beginTransaction();
    const result = await callback(connection);
    await connection.commit();
    return result;
  } catch (error) {
    try { await connection.rollback(); } catch { /* La conexion puede estar cerrada. */ }
    throw error;
  } finally {
    connection.release();
  }
}

async function lockStoreAndSubscription(connection, idTienda, idSuscripcion) {
  const [stores] = await connection.query(
    'SELECT idTienda FROM tienda WHERE idTienda=? FOR UPDATE',
    [idTienda]
  );
  if (!stores.length) throw lifecycleError(404, 'La tienda no existe.', 'STORE_NOT_FOUND');
  const [subscriptions] = await connection.query(
    `SELECT * FROM suscripcionTienda
     WHERE idTienda=? AND idSuscripcion=?
     FOR UPDATE`,
    [idTienda, idSuscripcion]
  );
  if (!subscriptions.length) {
    throw lifecycleError(404, 'La suscripcion no existe.', 'SUBSCRIPTION_NOT_FOUND');
  }
  return subscriptions[0];
}

async function claimOperation(connection, input, now) {
  const type = String(input.tipoOperacion || '').trim();
  if (!OPERATION_TYPES.has(type)) {
    throw lifecycleError(400, 'La operacion de suscripcion no es valida.', 'INVALID_SUBSCRIPTION_OPERATION');
  }
  const key = operationKey(input.claveOperacion);
  const keyHash = sha256(key);
  const requestHash = sha256(canonicalPayload(input.payload));
  const [existing] = await connection.query(
    `SELECT idOperacionSuscripcion, estado, huellaSolicitud,
            idSuscripcionResultado, idHistorialResultado, codigoResultado
     FROM operacionSuscripcionTienda
     WHERE idTienda=? AND tipoOperacion=? AND claveHash=?
     FOR UPDATE`,
    [input.idTienda, type, keyHash]
  );
  if (existing.length) {
    const row = existing[0];
    if (row.huellaSolicitud !== requestHash) {
      throw lifecycleError(409, 'La clave de operacion ya fue utilizada.', 'OPERATION_KEY_CONFLICT');
    }
    if (row.estado === 'completada') {
      return { replayed: true, id: Number(row.idOperacionSuscripcion), result: row };
    }
    throw lifecycleError(409, 'La operacion ya esta en proceso.', 'OPERATION_IN_PROGRESS');
  }
  const nowText = formatLocalDateTime(now);
  const expiresText = formatLocalDateTime(addLocalDays(now, OPERATION_TTL_DAYS));
  const [result] = await connection.query(
    `INSERT INTO operacionSuscripcionTienda
      (idTienda,tipoOperacion,claveHash,huellaSolicitud,estado,expiraEn,creadoEn,actualizadoEn)
     VALUES (?, ?, ?, ?, 'en_proceso', ?, ?, ?)`,
    [input.idTienda, type, keyHash, requestHash, expiresText, nowText, nowText]
  );
  return { replayed: false, id: Number(result.insertId), result: null };
}

async function completeOperation(connection, operationId, result, now) {
  await connection.query(
    `UPDATE operacionSuscripcionTienda
     SET estado='completada', idSuscripcionResultado=?, idHistorialResultado=?,
         codigoResultado=?, completadaEn=?, actualizadoEn=?
     WHERE idOperacionSuscripcion=?`,
    [result.idSuscripcion, result.idHistorial || null, result.codigo, formatLocalDateTime(now),
      formatLocalDateTime(now), operationId]
  );
}

function operationResult(subscription, historyId, code, replayed = false) {
  return {
    idSuscripcion: Number(subscription.idSuscripcion),
    estado: subscription.estado,
    estadoEfectivo: subscription.estadoEfectivo || subscription.estado,
    fechaInicio: subscription.fechaInicio,
    fechaFin: subscription.fechaFin,
    fechaFinGracia: subscription.fechaFinGracia,
    idHistorial: historyId ? Number(historyId) : null,
    codigo: code,
    replayed
  };
}

async function insertHistory(connection, input) {
  const metadata = sanitizeLifecycleMetadata(input.tipoOperacion, input.metadatos);
  const actorTipo = input.actorTipo || 'sistema';
  const idAdministrador = actorTipo === 'administrador' ? Number(input.idAdministrador) : null;
  const [result] = await connection.query(
    `INSERT INTO historialSuscripcionTienda
      (idTienda,idSuscripcion,estadoAnterior,estadoNuevo,tipoOperacion,motivo,
       actorTipo,idAdministradorActor,metadatos,creadoEn)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [input.idTienda, input.idSuscripcion, input.estadoAnterior || null, input.estadoNuevo,
      input.tipoOperacion, input.motivo, actorTipo, idAdministrador,
      Object.keys(metadata).length ? JSON.stringify(metadata) : null, formatLocalDateTime(input.now)]
  );
  return Number(result.insertId);
}

async function recordManualAudit(connection, input) {
  return administrativeAuditService.recordCritical(connection, {
    action: input.action,
    result: 'correcto',
    resultCode: input.resultCode,
    origin: input.origin || 'sistema',
    actorType: 'administrador',
    administratorId: input.idAdministrador,
    storeId: input.idTienda,
    reference: `suscripcion:${input.idSuscripcion}`,
    requestId: input.requestId || null,
    before: { estado: input.estadoAnterior },
    after: { estado: input.estadoNuevo },
    metadata: { motivoCodigo: input.motivoCodigo },
    createdAt: formatLocalDateTime(input.now)
  });
}

async function cancelSubscription(database = pool, input = {}) {
  const idTienda = positiveId(input.idTienda, 'La tienda');
  const idSuscripcion = positiveId(input.idSuscripcion, 'La suscripcion');
  const actor = actorFor(input);
  const reason = assertManualReason(input.motivoCodigo);
  const now = normalizeNow(input.now);
  return withTransaction(database, async (connection) => {
    let subscription = await lockStoreAndSubscription(connection, idTienda, idSuscripcion);
    const operation = await claimOperation(connection, {
      idTienda, tipoOperacion: 'cancelar', claveOperacion: input.claveOperacion,
      payload: { idSuscripcion, motivoCodigo: reason }
    }, now);
    if (operation.replayed) return { ...subscriptionOutput(subscription, now), replayed: true };
    if (subscription.estado === 'cancelada') {
      const result = operationResult(subscriptionOutput(subscription, now), null, 'SUBSCRIPTION_ALREADY_CANCELLED');
      await completeOperation(connection, operation.id, result, now);
      return result;
    }
    const nowText = formatLocalDateTime(now);
    await connection.query(
      `UPDATE suscripcionTienda
       SET estado='cancelada', canceladaEn=?, motivoTransicion='cancelacion_administrativa',
           idPlanSiguiente=NULL, fechaAplicacionPlanSiguiente=NULL, actualizadoEn=?
       WHERE idTienda=? AND idSuscripcion=?`,
      [nowText, nowText, idTienda, idSuscripcion]
    );
    const historyId = await insertHistory(connection, {
      idTienda, idSuscripcion, estadoAnterior: subscription.estado, estadoNuevo: 'cancelada',
      tipoOperacion: 'cancelacion', motivo: 'cancelacion_administrativa',
      actorTipo: actor.actorTipo, idAdministrador: actor.idAdministrador, now, metadatos: {}
    });
    await recordManualAudit(connection, {
      action: 'cancelacion_suscripcion', resultCode: 'SUBSCRIPTION_CANCELLED',
      idTienda, idSuscripcion, idAdministrador: actor.idAdministrador,
      estadoAnterior: subscription.estado, estadoNuevo: 'cancelada', motivoCodigo: reason,
      requestId: input.requestId, now
    });
    subscription = { ...subscription, estado: 'cancelada', canceladaEn: nowText };
    const result = operationResult(subscriptionOutput(subscription, now), historyId, 'SUBSCRIPTION_CANCELLED');
    await completeOperation(connection, operation.id, result, now);
    return result;
  });
}

function subscriptionOutput(subscription, now) {
  return {
    ...subscription,
    estadoEfectivo: computeEffectiveStatus(subscription, now),
    idSuscripcion: Number(subscription.idSuscripcion),
    idTienda: Number(subscription.idTienda)
  };
}

async function materializeSubscriptionLifecycle(database = pool, input = {}) {
  const idTienda = positiveId(input.idTienda, 'La tienda');
  const idSuscripcion = positiveId(input.idSuscripcion, 'La suscripcion');
  const now = normalizeNow(input.now);
  return withTransaction(database, async (connection) => {
    let subscription = await lockStoreAndSubscription(connection, idTienda, idSuscripcion);
    const at = computeEffectiveStatus(subscription, now);
    let transition = null;
    if (['activa', 'pendiente', 'vencida'].includes(subscription.estado) && now >= parseLocalDateTime(subscription.fechaFin)) {
      const graceEnd = subscription.fechaFinGracia || formatLocalDateTime(addLocalDays(parseLocalDateTime(subscription.fechaFin), 7));
      if (now < parseLocalDateTime(graceEnd)) transition = { state: 'gracia', operation: 'entrada_gracia', reason: 'fin_vigencia', code: 'SUBSCRIPTION_GRACE_ENTERED', graceEnd };
      else transition = { state: 'suspendida', operation: 'suspension', reason: 'fin_gracia', code: 'SUBSCRIPTION_SUSPENDED' };
    } else if (subscription.estado === 'gracia' && (!subscription.fechaFinGracia || now >= parseLocalDateTime(subscription.fechaFinGracia))) {
      transition = { state: 'suspendida', operation: 'suspension', reason: 'fin_gracia', code: 'SUBSCRIPTION_SUSPENDED' };
    }
    if (!transition || at === 'cancelada' || subscription.estado === 'suspendida') {
      return { ...subscriptionOutput(subscription, now), transition: null, idHistorial: null, replayed: true };
    }

    const operation = await claimOperation(connection, {
      idTienda,
      tipoOperacion: 'suspender',
      claveOperacion: `system:${transition.operation}:${idSuscripcion}:${formatLocalDateTime(now).replace(' ', 'T')}`,
      payload: { idSuscripcion, transition: transition.operation, graceEnd: transition.graceEnd || null }
    }, now);
    if (operation.replayed) return { ...subscriptionOutput(subscription, now), transition: null, idHistorial: operation.result.idHistorialResultado, replayed: true };

    const updates = transition.state === 'gracia'
      ? `estado='gracia', fechaFinGracia=?, motivoTransicion='fin_vigencia'`
      : `estado='suspendida', suspendidaEn=?, motivoTransicion='fin_gracia'`;
    const params = transition.state === 'gracia'
      ? [transition.graceEnd, formatLocalDateTime(now), idTienda, idSuscripcion]
      : [formatLocalDateTime(now), formatLocalDateTime(now), idTienda, idSuscripcion];
    await connection.query(`UPDATE suscripcionTienda SET ${updates}, actualizadoEn=? WHERE idTienda=? AND idSuscripcion=?`, params);
    const historyId = await insertHistory(connection, {
      idTienda, idSuscripcion, estadoAnterior: subscription.estado, estadoNuevo: transition.state,
      tipoOperacion: transition.operation, motivo: transition.reason, actorTipo: 'sistema', now,
      metadatos: {}
    });
    subscription = { ...subscription, estado: transition.state, fechaFinGracia: transition.graceEnd || subscription.fechaFinGracia, suspendidaEn: transition.state === 'suspendida' ? formatLocalDateTime(now) : subscription.suspendidaEn };
    const result = operationResult(subscriptionOutput(subscription, now), historyId, transition.code);
    await completeOperation(connection, operation.id, result, now);
    return { ...result, transition: transition.operation };
  });
}

async function suspendSubscription(database = pool, input = {}) {
  const idTienda = positiveId(input.idTienda, 'La tienda');
  const idSuscripcion = positiveId(input.idSuscripcion, 'La suscripcion');
  const actor = actorFor(input);
  const reason = assertManualReason(input.motivoCodigo);
  const now = normalizeNow(input.now);
  return withTransaction(database, async (connection) => {
    let subscription = await lockStoreAndSubscription(connection, idTienda, idSuscripcion);
    const operation = await claimOperation(connection, {
      idTienda, tipoOperacion: 'suspender', claveOperacion: input.claveOperacion,
      payload: { idSuscripcion, motivoCodigo: reason, tipo: 'manual' }
    }, now);
    if (operation.replayed) return { ...subscriptionOutput(subscription, now), replayed: true };
    if (subscription.estado === 'cancelada') throw lifecycleError(409, 'La suscripcion cancelada no puede suspenderse.', 'SUBSCRIPTION_CANCELLED');
    if (subscription.estado === 'suspendida') {
      const result = operationResult(subscriptionOutput(subscription, now), null, 'SUBSCRIPTION_ALREADY_SUSPENDED');
      await completeOperation(connection, operation.id, result, now);
      return result;
    }
    await connection.query(
      `UPDATE suscripcionTienda SET estado='suspendida', suspendidaEn=?, motivoTransicion='suspension_administrativa', actualizadoEn=?
       WHERE idTienda=? AND idSuscripcion=?`,
      [formatLocalDateTime(now), formatLocalDateTime(now), idTienda, idSuscripcion]
    );
    const historyId = await insertHistory(connection, {
      idTienda, idSuscripcion, estadoAnterior: subscription.estado, estadoNuevo: 'suspendida',
      tipoOperacion: 'suspension', motivo: 'suspension_administrativa', actorTipo: actor.actorTipo,
      idAdministrador: actor.idAdministrador, now, metadatos: {}
    });
    await recordManualAudit(connection, {
      action: 'suspension_suscripcion', resultCode: 'SUBSCRIPTION_SUSPENDED', idTienda, idSuscripcion,
      idAdministrador: actor.idAdministrador, estadoAnterior: subscription.estado, estadoNuevo: 'suspendida',
      motivoCodigo: reason, requestId: input.requestId, now
    });
    subscription = { ...subscription, estado: 'suspendida', suspendidaEn: formatLocalDateTime(now) };
    const result = operationResult(subscriptionOutput(subscription, now), historyId, 'SUBSCRIPTION_SUSPENDED');
    await completeOperation(connection, operation.id, result, now);
    return result;
  });
}

async function reactivateSubscription(database = pool, input = {}) {
  const idTienda = positiveId(input.idTienda, 'La tienda');
  const idSuscripcion = positiveId(input.idSuscripcion, 'La suscripcion');
  const actor = actorFor(input);
  const period = assertPeriod(input.periodo);
  const now = normalizeNow(input.now);
  return withTransaction(database, async (connection) => {
    let subscription = await lockStoreAndSubscription(connection, idTienda, idSuscripcion);
    const operation = await claimOperation(connection, {
      idTienda, tipoOperacion: 'reactivar', claveOperacion: input.claveOperacion,
      payload: { idSuscripcion, periodo: period }
    }, now);
    if (operation.replayed) return { ...subscriptionOutput(subscription, now), replayed: true };
    if (subscription.estado === 'cancelada') throw lifecycleError(409, 'La suscripcion cancelada no puede reactivarse.', 'SUBSCRIPTION_CANCELLED');
    if (subscription.estado === 'activa') {
      const result = operationResult(subscriptionOutput(subscription, now), null, 'SUBSCRIPTION_ALREADY_ACTIVE');
      await completeOperation(connection, operation.id, result, now);
      return result;
    }
    const expired = now >= parseLocalDateTime(subscription.fechaFin);
    const start = expired ? now : parseLocalDateTime(subscription.fechaInicio);
    const end = expired ? addLocalDays(now, PERIOD_DAYS[period]) : parseLocalDateTime(subscription.fechaFin);
    await connection.query(
      `UPDATE suscripcionTienda
       SET estado='activa', fechaInicio=?, fechaFin=?, fechaFinGracia=?, suspendidaEn=NULL,
           reactivadaEn=?, motivoTransicion='reactivacion_administrativa', actualizadoEn=?
       WHERE idTienda=? AND idSuscripcion=?`,
      [formatLocalDateTime(start), formatLocalDateTime(end), formatLocalDateTime(addLocalDays(end, 7)),
        formatLocalDateTime(now), formatLocalDateTime(now), idTienda, idSuscripcion]
    );
    const historyId = await insertHistory(connection, {
      idTienda, idSuscripcion, estadoAnterior: subscription.estado, estadoNuevo: 'activa',
      tipoOperacion: 'reactivacion', motivo: 'reactivacion_administrativa', actorTipo: actor.actorTipo,
      idAdministrador: actor.idAdministrador, now, metadatos: {}
    });
    await recordManualAudit(connection, {
      action: 'reactivacion_suscripcion', resultCode: 'SUBSCRIPTION_REACTIVATED', idTienda, idSuscripcion,
      idAdministrador: actor.idAdministrador, estadoAnterior: subscription.estado, estadoNuevo: 'activa',
      motivoCodigo: 'reactivacion_administrativa', requestId: input.requestId, now
    });
    subscription = { ...subscription, estado: 'activa', fechaInicio: formatLocalDateTime(start), fechaFin: formatLocalDateTime(end), fechaFinGracia: formatLocalDateTime(addLocalDays(end, 7)), suspendidaEn: null, reactivadaEn: formatLocalDateTime(now) };
    const result = operationResult(subscriptionOutput(subscription, now), historyId, 'SUBSCRIPTION_REACTIVATED');
    await completeOperation(connection, operation.id, result, now);
    return result;
  });
}

async function renewSubscription(database = pool, input = {}) {
  const idTienda = positiveId(input.idTienda, 'La tienda');
  const idSuscripcion = positiveId(input.idSuscripcion, 'La suscripcion');
  const actor = actorFor(input, true);
  const period = assertPeriod(input.periodo);
  const now = normalizeNow(input.now);
  return withTransaction(database, async (connection) => {
    let subscription = await lockStoreAndSubscription(connection, idTienda, idSuscripcion);
    const previousState = subscription.estado;
    const operation = await claimOperation(connection, {
      idTienda, tipoOperacion: 'renovar', claveOperacion: input.claveOperacion,
      payload: { idSuscripcion, periodo: period }
    }, now);
    if (operation.replayed) return { ...subscriptionOutput(subscription, now), replayed: true };
    if (subscription.estado === 'cancelada') throw lifecycleError(409, 'La suscripcion cancelada no puede renovarse.', 'SUBSCRIPTION_CANCELLED');
    const suspendedOrExpired = subscription.estado === 'suspendida'
      || now >= parseLocalDateTime(subscription.fechaFin);
    if (subscription.idPlanSiguiente) {
      const [plans] = await connection.query(
        `SELECT idPlan,codigo,nombre,precioMensual,duracionDias,
                limitePropietarios,limiteProductos,limiteClientes,limiteProveedores
         FROM plan WHERE idPlan=? FOR UPDATE`,
        [subscription.idPlanSiguiente]
      );
      if (!plans.length) {
        throw lifecycleError(409, 'El plan programado ya no esta disponible.', 'SCHEDULED_PLAN_NOT_AVAILABLE');
      }
      const target = plans[0];
      const start = suspendedOrExpired ? now : parseLocalDateTime(subscription.fechaFin);
      const end = addLocalDays(start, PERIOD_DAYS[period]);
      const startText = formatLocalDateTime(start);
      const endText = formatLocalDateTime(end);
      const graceText = formatLocalDateTime(addLocalDays(end, 7));
      const nowText = formatLocalDateTime(now);
      const [created] = await connection.query(
        `INSERT INTO suscripcionTienda
          (idTienda,idPlan,tipo,estado,fechaInicio,fechaFin,fechaFinGracia,
           motivoTransicion,planCodigoSnapshot,planNombreSnapshot,tipoPeriodoSnapshot,
           duracionDiasSnapshot,precioReferenciaSnapshot,limitePropietariosSnapshot,
           limiteProductosSnapshot,limiteClientesSnapshot,limiteProveedoresSnapshot,
           renovacionAutomatica,observacion,creadoPor,creadoEn,actualizadoEn)
         VALUES (?, ?, ?, 'activa', ?, ?, ?, 'reemplazo_periodo', ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
        [idTienda, target.idPlan, subscription.tipo, startText, endText, graceText,
          target.codigo, target.nombre, period, PERIOD_DAYS[period], target.precioMensual,
          target.limitePropietarios, target.limiteProductos, target.limiteClientes,
          target.limiteProveedores, subscription.observacion, actor.idAdministrador,
          nowText, nowText]
      );
      const nextId = Number(created.insertId);
      await connection.query(
        `INSERT INTO suscripcionFuncionalidadSnapshot
          (idTienda,idSuscripcion,codigoFuncionalidad,nombreFuncionalidad,creadoEn)
         SELECT ?, ?, f.codigo, f.nombre, ?
         FROM planFuncionalidad pf
         JOIN funcionalidad f ON f.idFuncionalidad=pf.idFuncionalidad
         WHERE pf.idPlan=? AND pf.habilitada=1 AND f.activo=1`,
        [idTienda, nextId, nowText, target.idPlan]
      );
      await connection.query(
        `UPDATE suscripcionTienda
         SET idPlanSiguiente=NULL,fechaAplicacionPlanSiguiente=NULL,
             motivoTransicion='reemplazo_periodo',actualizadoEn=?
         WHERE idTienda=? AND idSuscripcion=?`,
        [nowText, idTienda, idSuscripcion]
      );
      const limitColumns = {
        propietarios: target.limitePropietarios,
        productos: target.limiteProductos,
        clientes: target.limiteClientes,
        proveedores: target.limiteProveedores
      };
      const exceeded = [];
      for (const [key, sql] of Object.entries(LIMIT_USAGE_SQL)) {
        const [[usage]] = await connection.query(sql, [idTienda]);
        if (limitColumns[key] !== null && Number(usage.total) > Number(limitColumns[key])) exceeded.push(key);
      }
      const historyId = await insertHistory(connection, {
        idTienda, idSuscripcion: nextId, estadoAnterior: null, estadoNuevo: 'activa',
        tipoOperacion: 'downgrade_aplicado', motivo: 'reemplazo_periodo',
        actorTipo: actor.actorTipo, idAdministrador: actor.idAdministrador, now,
        metadatos: {
          planCodigoAnterior: subscription.planCodigoSnapshot,
          planCodigoNuevo: target.codigo,
          limitesExcedidos: exceeded.join(',')
        }
      });
      const nextSubscription = {
        ...subscription,
        idSuscripcion: nextId,
        idPlan: target.idPlan,
        estado: 'activa',
        fechaInicio: startText,
        fechaFin: endText,
        fechaFinGracia: graceText,
        planCodigoSnapshot: target.codigo,
        planNombreSnapshot: target.nombre,
        idPlanSiguiente: null,
        fechaAplicacionPlanSiguiente: null,
        suspendidaEn: null
      };
      const result = operationResult(subscriptionOutput(nextSubscription, now), historyId, 'SUBSCRIPTION_RENEWED_WITH_SCHEDULED_PLAN');
      if (actor.actorTipo === 'administrador') {
        await recordManualAudit(connection, {
          action: 'renovacion_suscripcion', resultCode: 'SUBSCRIPTION_RENEWED',
          idTienda, idSuscripcion: nextId, idAdministrador: actor.idAdministrador,
          estadoAnterior: previousState, estadoNuevo: 'activa',
          motivoCodigo: 'renovacion', requestId: input.requestId, now
        });
      }
      await completeOperation(connection, operation.id, result, now);
      return result;
    }
    const [futurePeriods] = await connection.query(
      `SELECT idSuscripcion FROM suscripcionTienda
       WHERE idTienda=? AND idSuscripcion<>? AND fechaInicio>=?
       ORDER BY fechaInicio,idSuscripcion LIMIT 1 FOR UPDATE`,
      [idTienda, idSuscripcion, subscription.fechaFin]
    );
    if (futurePeriods.length) {
      throw lifecycleError(409, 'La suscripcion ya tiene un periodo siguiente.', 'SUBSCRIPTION_NEXT_PERIOD_EXISTS');
    }
    const start = suspendedOrExpired ? now : parseLocalDateTime(subscription.fechaInicio);
    const base = suspendedOrExpired ? now : parseLocalDateTime(subscription.fechaFin);
    const end = addLocalDays(base, PERIOD_DAYS[period]);
    await connection.query(
      `UPDATE suscripcionTienda
       SET estado='activa', fechaInicio=?, fechaFin=?, fechaFinGracia=?, suspendidaEn=NULL,
           reactivadaEn=?, motivoTransicion='renovacion', actualizadoEn=?
       WHERE idTienda=? AND idSuscripcion=?`,
      [formatLocalDateTime(start), formatLocalDateTime(end), formatLocalDateTime(addLocalDays(end, 7)),
        suspendedOrExpired ? formatLocalDateTime(now) : subscription.reactivadaEn,
        formatLocalDateTime(now), idTienda, idSuscripcion]
    );
    const historyId = await insertHistory(connection, {
      idTienda, idSuscripcion, estadoAnterior: subscription.estado, estadoNuevo: 'activa',
      tipoOperacion: 'renovacion', motivo: 'renovacion', actorTipo: actor.actorTipo,
      idAdministrador: actor.idAdministrador, now, metadatos: {
        planCodigo: subscription.planCodigoSnapshot,
        tipoPeriodo: period
      }
    });
    subscription = { ...subscription, estado: 'activa', fechaInicio: formatLocalDateTime(start), fechaFin: formatLocalDateTime(end), fechaFinGracia: formatLocalDateTime(addLocalDays(end, 7)), suspendidaEn: null };
    const result = operationResult(subscriptionOutput(subscription, now), historyId, 'SUBSCRIPTION_RENEWED');
    if (actor.actorTipo === 'administrador') {
      await recordManualAudit(connection, {
        action: 'renovacion_suscripcion', resultCode: 'SUBSCRIPTION_RENEWED',
        idTienda, idSuscripcion, idAdministrador: actor.idAdministrador,
        estadoAnterior: previousState, estadoNuevo: 'activa',
        motivoCodigo: 'renovacion', requestId: input.requestId, now
      });
    }
    await completeOperation(connection, operation.id, result, now);
    return result;
  });
}

module.exports = {
  MANUAL_SUSPENSION_REASONS,
  PERIOD_DAYS,
  assertManualReason,
  assertPeriod,
  canonicalPayload,
  cancelSubscription,
  claimOperation,
  completeOperation,
  computeEffectiveStatus,
  insertHistory,
  lifecycleError,
  lockStoreAndSubscription,
  materializeSubscriptionLifecycle,
  reactivateSubscription,
  renewSubscription,
  suspendSubscription,
  withTransaction
};
