const pool = require('../config/db');
const { administrativeAuditService } = require('./administrative-audit-service');
const {
  PLAN_CHANGE_TYPES,
  comparePlanEntitlements,
  limitAvailability,
  validatePlanChangeBody
} = require('../config/subscription-plan-change-contract');
const {
  claimOperation,
  completeOperation,
  computeEffectiveStatus,
  insertHistory,
  lifecycleError,
  lockStoreAndSubscription,
  withTransaction
} = require('./subscription-lifecycle-service');
const { formatLocalDateTime, getLocalNow, parseLocalDateTime } = require('../utils/local-datetime');

function dateText(value) {
  return formatLocalDateTime(value instanceof Date ? value : parseLocalDateTime(value));
}

function positiveId(value, label) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw lifecycleError(400, `${label} no es valido.`, 'INVALID_PLAN_CHANGE_INPUT');
  }
  return id;
}

async function loadFeatures(connection, where, values, forUpdate = false) {
  const [rows] = await connection.query(
    `SELECT f.codigo, f.nombre
     FROM planFuncionalidad pf
     JOIN funcionalidad f ON f.idFuncionalidad=pf.idFuncionalidad
     WHERE ${where} AND pf.habilitada=1 AND f.activo=1
     ORDER BY f.codigo${forUpdate ? ' FOR UPDATE' : ''}`,
    values
  );
  return rows;
}

function planLimits(row, suffix = '') {
  const read = (name) => row[`${name}${suffix}`];
  return {
    propietarios: read('limitePropietarios') === null ? null : Number(read('limitePropietarios')),
    productos: read('limiteProductos') === null ? null : Number(read('limiteProductos')),
    clientes: read('limiteClientes') === null ? null : Number(read('limiteClientes')),
    proveedores: read('limiteProveedores') === null ? null : Number(read('limiteProveedores'))
  };
}

async function planFromCatalog(connection, code, forUpdate = false, requireActive = true) {
  const normalized = String(code || '').trim().toLowerCase();
  const [rows] = await connection.query(
    `SELECT idPlan,codigo,nombre,descripcion,activo,precioMensual,duracionDias,
            limitePropietarios,limiteProductos,limiteClientes,limiteProveedores
     FROM plan WHERE codigo=?${forUpdate ? ' FOR UPDATE' : ''}`,
    [normalized]
  );
  if (!rows.length || (requireActive && Number(rows[0].activo) !== 1)) {
    throw lifecycleError(400, 'El plan seleccionado no esta disponible.', 'PLAN_NOT_AVAILABLE');
  }
  const features = await loadFeatures(connection, 'pf.idPlan=?', [rows[0].idPlan], forUpdate);
  return {
    ...rows[0],
    tipoPeriodo: Number(rows[0].duracionDias) === 365 ? 'anual' : 'mensual',
    precioReferencia: Number(rows[0].precioMensual || 0),
    limites: planLimits(rows[0]),
    funcionalidades: features.map((item) => item.codigo),
    funcionalidadesDetalle: features
  };
}

async function planFromSubscription(connection, subscription) {
  const [features] = await connection.query(
    `SELECT codigoFuncionalidad codigo,nombreFuncionalidad nombre
     FROM suscripcionFuncionalidadSnapshot
     WHERE idTienda=? AND idSuscripcion=?
     ORDER BY codigoFuncionalidad`,
    [subscription.idTienda, subscription.idSuscripcion]
  );
  return {
    codigo: subscription.planCodigoSnapshot,
    nombre: subscription.planNombreSnapshot,
    tipoPeriodo: subscription.tipoPeriodoSnapshot,
    precioReferencia: Number(subscription.precioReferenciaSnapshot || 0),
    limites: planLimits(subscription, 'Snapshot'),
    funcionalidades: features.map((item) => item.codigo),
    funcionalidadesDetalle: features
  };
}

async function replaceSnapshot(connection, subscription, plan, now) {
  await connection.query(
    `UPDATE suscripcionTienda
     SET idPlan=?,planCodigoSnapshot=?,planNombreSnapshot=?,precioReferenciaSnapshot=?,
         limitePropietariosSnapshot=?,limiteProductosSnapshot=?,limiteClientesSnapshot=?,
         limiteProveedoresSnapshot=?,idPlanSiguiente=NULL,fechaAplicacionPlanSiguiente=NULL,
         motivoTransicion='cambio_plan',actualizadoEn=?
     WHERE idTienda=? AND idSuscripcion=?`,
    [plan.idPlan, plan.codigo, plan.nombre, plan.precioMensual,
      plan.limitePropietarios, plan.limiteProductos, plan.limiteClientes,
      plan.limiteProveedores, now, subscription.idTienda, subscription.idSuscripcion]
  );
  await connection.query(
    'DELETE FROM suscripcionFuncionalidadSnapshot WHERE idTienda=? AND idSuscripcion=?',
    [subscription.idTienda, subscription.idSuscripcion]
  );
  if (plan.funcionalidadesDetalle.length) {
    await connection.query(
      `INSERT INTO suscripcionFuncionalidadSnapshot
        (idTienda,idSuscripcion,codigoFuncionalidad,nombreFuncionalidad,creadoEn)
       VALUES ${plan.funcionalidadesDetalle.map(() => '(?,?,?,?,?)').join(',')}`,
      plan.funcionalidadesDetalle.flatMap((item) => [
        subscription.idTienda, subscription.idSuscripcion, item.codigo, item.nombre, now
      ])
    );
  }
}

async function auditPlanChange(connection, input) {
  await administrativeAuditService.recordCritical(connection, {
    action: input.tipoCambio === PLAN_CHANGE_TYPES.UPGRADE
      ? 'upgrade_suscripcion'
      : 'downgrade_suscripcion_programado',
    result: 'correcto',
    resultCode: input.tipoCambio === PLAN_CHANGE_TYPES.UPGRADE
      ? 'SUBSCRIPTION_PLAN_UPGRADED'
      : 'SUBSCRIPTION_DOWNGRADE_SCHEDULED',
    origin: 'web',
    actorType: 'administrador',
    administratorId: input.idAdministrador,
    storeId: input.idTienda,
    reference: `suscripcion:${input.idSuscripcion}`,
    requestId: input.requestId || null,
    before: { planCodigo: input.planAnterior },
    after: { planCodigo: input.planNuevo },
    createdAt: input.now
  });
}

function safeChangeResult(subscription, plan, type, replayed = false, applicationDate = null) {
  return Object.freeze({
    codigo: type === PLAN_CHANGE_TYPES.UPGRADE ? 'SUBSCRIPTION_PLAN_UPGRADED' : 'SUBSCRIPTION_DOWNGRADE_SCHEDULED',
    tipoCambio: type,
    plan: { codigo: plan.codigo, nombre: plan.nombre },
    fechaFin: subscription.fechaFin,
    fechaAplicacion: type === PLAN_CHANGE_TYPES.DOWNGRADE
      ? (applicationDate || subscription.fechaFin)
      : null,
    replayed
  });
}

async function changePlan(database, input, expectedType) {
  const idTienda = positiveId(input.idTienda, 'La tienda');
  const idSuscripcion = positiveId(input.idSuscripcion, 'La suscripcion');
  const idAdministrador = positiveId(input.idAdministrador, 'El administrador');
  const body = validatePlanChangeBody(input.body);
  const now = input.now ? new Date(input.now) : getLocalNow();
  const nowText = formatLocalDateTime(now);
  return withTransaction(database, async (connection) => {
    const subscription = await lockStoreAndSubscription(connection, idTienda, idSuscripcion);
    const target = await planFromCatalog(connection, body.codigoPlan, true, false);
    const operation = await claimOperation(connection, {
      idTienda,
      tipoOperacion: 'cambiar_plan',
      claveOperacion: input.idempotencyKey,
      payload: { accion: expectedType, codigoPlan: body.codigoPlan }
    }, now);
    const current = await planFromSubscription(connection, subscription);
    const comparison = comparePlanEntitlements(current, target);
    if (operation.replayed) {
      let applicationDate = null;
      if (expectedType === PLAN_CHANGE_TYPES.DOWNGRADE && operation.result.idHistorialResultado) {
        const [histories] = await connection.query(
          `SELECT JSON_UNQUOTE(JSON_EXTRACT(metadatos,'$.fechaAplicacion')) fechaAplicacion
           FROM historialSuscripcionTienda
           WHERE idTienda=? AND idHistorialSuscripcion=?`,
          [idTienda, operation.result.idHistorialResultado]
        );
        applicationDate = histories[0]?.fechaAplicacion || null;
      }
      return safeChangeResult(subscription, target, expectedType, true, applicationDate);
    }
    if (Number(target.activo) !== 1) {
      throw lifecycleError(400, 'El plan seleccionado no esta disponible.', 'PLAN_NOT_AVAILABLE');
    }
    if (subscription.estado === 'cancelada') {
      throw lifecycleError(409, 'La suscripcion cancelada no admite cambios de plan.', 'SUBSCRIPTION_CANCELLED');
    }
    if (computeEffectiveStatus(subscription, now) !== 'activa') {
      throw lifecycleError(409, 'El estado actual no permite cambiar el plan.', 'PLAN_CHANGE_REQUIRES_FULL_ACCESS');
    }
    if (comparison.tipo === PLAN_CHANGE_TYPES.SAME) {
      const result = safeChangeResult(subscription, target, expectedType);
      await completeOperation(connection, operation.id, {
        idSuscripcion,
        idHistorial: null,
        codigo: 'SUBSCRIPTION_PLAN_ALREADY_CURRENT'
      }, now);
      return { ...result, codigo: 'SUBSCRIPTION_PLAN_ALREADY_CURRENT' };
    }
    if (comparison.tipo !== expectedType) {
      throw lifecycleError(409, 'El cambio solicitado no corresponde al tipo de operacion.', 'PLAN_CHANGE_DIRECTION_INVALID');
    }

    let historyId;
    if (expectedType === PLAN_CHANGE_TYPES.UPGRADE) {
      await replaceSnapshot(connection, subscription, target, nowText);
      historyId = await insertHistory(connection, {
        idTienda, idSuscripcion, estadoAnterior: subscription.estado, estadoNuevo: subscription.estado,
        tipoOperacion: 'upgrade', motivo: 'cambio_plan', actorTipo: 'administrador',
        idAdministrador, now, metadatos: {
          planCodigoAnterior: current.codigo,
          planCodigoNuevo: target.codigo
        }
      });
    } else {
      const alreadyScheduled = Number(subscription.idPlanSiguiente) === Number(target.idPlan)
        && dateText(subscription.fechaAplicacionPlanSiguiente) === dateText(subscription.fechaFin);
      if (alreadyScheduled) {
        const result = safeChangeResult(subscription, target, expectedType);
        await completeOperation(connection, operation.id, {
          idSuscripcion, idHistorial: null, codigo: 'SUBSCRIPTION_DOWNGRADE_ALREADY_SCHEDULED'
        }, now);
        return { ...result, codigo: 'SUBSCRIPTION_DOWNGRADE_ALREADY_SCHEDULED' };
      }
      await connection.query(
        `UPDATE suscripcionTienda
         SET idPlanSiguiente=?,fechaAplicacionPlanSiguiente=fechaFin,
             motivoTransicion='cambio_plan',actualizadoEn=?
         WHERE idTienda=? AND idSuscripcion=?`,
        [target.idPlan, nowText, idTienda, idSuscripcion]
      );
      historyId = await insertHistory(connection, {
        idTienda, idSuscripcion, estadoAnterior: subscription.estado, estadoNuevo: subscription.estado,
        tipoOperacion: 'downgrade_programado', motivo: 'cambio_plan', actorTipo: 'administrador',
        idAdministrador, now, metadatos: {
          planCodigoAnterior: current.codigo,
          planCodigoNuevo: target.codigo,
          fechaAplicacion: dateText(subscription.fechaFin)
        }
      });
    }
    await auditPlanChange(connection, {
      idTienda, idSuscripcion, idAdministrador, requestId: input.requestId,
      planAnterior: current.codigo, planNuevo: target.codigo, now: nowText,
      tipoCambio: expectedType
    });
    const result = safeChangeResult(subscription, target, expectedType);
    await completeOperation(connection, operation.id, {
      idSuscripcion, idHistorial: historyId, codigo: result.codigo
    }, now);
    return result;
  });
}

async function listPlans(database = pool, input = {}) {
  const idTienda = positiveId(input.idTienda, 'La tienda');
  const idSuscripcion = positiveId(input.idSuscripcion, 'La suscripcion');
  const [subscriptions] = await database.query(
    `SELECT s.*,p.codigo planSiguienteCodigo,p.nombre planSiguienteNombre
     FROM suscripcionTienda s
     LEFT JOIN plan p ON p.idPlan=s.idPlanSiguiente
     WHERE s.idTienda=? AND s.idSuscripcion=?`,
    [idTienda, idSuscripcion]
  );
  if (!subscriptions.length) throw lifecycleError(404, 'La suscripcion no existe.', 'SUBSCRIPTION_NOT_FOUND');
  const subscription = subscriptions[0];
  const current = await planFromSubscription(database, subscription);
  let scheduledPlan = subscription.idPlanSiguiente ? {
    codigo: subscription.planSiguienteCodigo,
    nombre: subscription.planSiguienteNombre,
    fechaAplicacion: subscription.fechaAplicacionPlanSiguiente
  } : null;
  if (!scheduledPlan) {
    const [futurePeriods] = await database.query(
      `SELECT planCodigoSnapshot codigo,planNombreSnapshot nombre,fechaInicio fechaAplicacion
       FROM suscripcionTienda
       WHERE idTienda=? AND idSuscripcion<>? AND fechaInicio>=?
       ORDER BY fechaInicio,idSuscripcion LIMIT 1`,
      [idTienda, idSuscripcion, subscription.fechaFin]
    );
    if (futurePeriods.length) scheduledPlan = futurePeriods[0];
  }
  const [catalog] = await database.query(
    `SELECT idPlan,codigo,nombre,descripcion,precioMensual,duracionDias,
            limitePropietarios,limiteProductos,limiteClientes,limiteProveedores
     FROM plan WHERE activo=1 ORDER BY precioMensual,codigo`
  );
  const usage = input.uso || {};
  const plans = [];
  for (const row of catalog) {
    const features = await loadFeatures(database, 'pf.idPlan=?', [row.idPlan]);
    const plan = {
      ...row,
      tipoPeriodo: Number(row.duracionDias) === 365 ? 'anual' : 'mensual',
      precioReferencia: Number(row.precioMensual || 0),
      limites: planLimits(row),
      funcionalidades: features.map((item) => item.codigo)
    };
    const comparison = comparePlanEntitlements(current, plan);
    plans.push(Object.freeze({
      codigo: row.codigo,
      nombre: row.nombre,
      descripcion: row.descripcion,
      precioReferencia: Number(row.precioMensual),
      periodoDisponible: Number(row.duracionDias) === 365 ? 'anual' : 'mensual',
      limites: plan.limites,
      disponibilidad: limitAvailability(plan.limites, usage),
      funcionalidades: plan.funcionalidades,
      tipoCambio: comparison.tipo
    }));
  }
  return Object.freeze({
    planActual: { codigo: current.codigo, nombre: current.nombre },
    planProgramado: scheduledPlan,
    planes: Object.freeze(plans)
  });
}

function createSubscriptionPlanService({ database = pool } = {}) {
  return Object.freeze({
    list: (input) => listPlans(database, input),
    upgrade: (input) => changePlan(database, input, PLAN_CHANGE_TYPES.UPGRADE),
    scheduleDowngrade: (input) => changePlan(database, input, PLAN_CHANGE_TYPES.DOWNGRADE)
  });
}

const subscriptionPlanService = createSubscriptionPlanService();

module.exports = {
  createSubscriptionPlanService,
  listPlans,
  planFromCatalog,
  planFromSubscription,
  replaceSnapshot,
  subscriptionPlanService
};
