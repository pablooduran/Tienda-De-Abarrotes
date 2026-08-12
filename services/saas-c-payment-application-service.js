const crypto = require('crypto');
const pool = require('../config/db');
const { PLAN_CHANGE_TYPES, comparePlanEntitlements } = require('../config/subscription-plan-change-contract');
const {
  canonicalPayload,
  claimOperation,
  completeOperation,
  computeEffectiveStatus,
  insertHistory,
  lockStoreAndSubscription
} = require('./subscription-lifecycle-service');
const { planFromSubscription, replaceSnapshot } = require('./subscription-plan-service');
const { administrativeAuditService } = require('./administrative-audit-service');
const { requestLocator, validateSuperadmin, withTransaction } = require('./saas-c-payment-review-service');
const {
  addLocalDays,
  dateTimeParts,
  formatLocalDateTime,
  getLocalNow,
  parseLocalDateTime
} = require('../utils/local-datetime');

const OPERATION_TTL_DAYS = 2;
const APPLICATION_RESULT = 'PAYMENT_REQUEST_APPLIED';
const OPERATION_MAP = Object.freeze({
  renovacion: 'renovar',
  reactivacion: 'reactivar',
  upgrade: 'cambiar_plan'
});

function applicationError(status, message, code) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function addCalendarMonths(value, months) {
  const amount = Number(months);
  if (![1, 3, 12].includes(amount)) {
    throw applicationError(409, 'El periodo congelado no es valido.', 'PAYMENT_SNAPSHOT_PERIOD_INVALID');
  }
  const date = value instanceof Date ? value : parseLocalDateTime(value);
  const parts = dateTimeParts(date);
  const targetMonth = parts.month - 1 + amount;
  const targetYear = parts.year + Math.floor(targetMonth / 12);
  const normalizedMonth = ((targetMonth % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, normalizedMonth + 1, 0)).getUTCDate();
  const day = Math.min(parts.day, lastDay);
  const text = `${targetYear}-${String(normalizedMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')} `
    + `${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}:${String(parts.second).padStart(2, '0')}`;
  return parseLocalDateTime(text);
}

function durationDays(start, end) {
  return Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000));
}

async function lockRequest(connection, locator, reference) {
  const [rows] = await connection.query(
    `SELECT s.*,c.idComprobantePago,c.estado comprobanteEstado
     FROM solicitudPagoSuscripcion s
     LEFT JOIN comprobantePagoSuscripcion c
       ON c.idTienda=s.idTienda AND c.idSolicitudPago=s.idSolicitudPago
      AND c.idSolicitudActiva=s.idSolicitudPago
     WHERE s.idTienda=? AND s.idSolicitudPago=? AND s.referenciaPublica=?
     LIMIT 1 FOR UPDATE`,
    [locator.idTienda, locator.idSolicitudPago, reference]
  );
  if (!rows.length) throw applicationError(404, 'La solicitud no existe.', 'PAYMENT_REQUEST_NOT_FOUND');
  return rows[0];
}

async function requestFeatures(connection, request) {
  const [rows] = await connection.query(
    `SELECT codigoFuncionalidad codigo,nombreFuncionalidad nombre
     FROM solicitudPagoFuncionalidadSnapshot
     WHERE idTienda=? AND idSolicitudPago=? ORDER BY codigoFuncionalidad`,
    [request.idTienda, request.idSolicitudPago]
  );
  return rows;
}

function frozenPlan(request, features) {
  return Object.freeze({
    idPlan: Number(request.idPlanObjetivo),
    codigo: request.planCodigoSnapshot,
    nombre: request.planNombreSnapshot,
    precioMensual: request.precioBaseUSD,
    limitePropietarios: request.limitePropietariosSnapshot,
    limiteProductos: request.limiteProductosSnapshot,
    limiteClientes: request.limiteClientesSnapshot,
    limiteProveedores: request.limiteProveedoresSnapshot,
    limites: Object.freeze({
      propietarios: request.limitePropietariosSnapshot,
      productos: request.limiteProductosSnapshot,
      clientes: request.limiteClientesSnapshot,
      proveedores: request.limiteProveedoresSnapshot
    }),
    funcionalidades: Object.freeze(features.map((item) => item.codigo)),
    funcionalidadesDetalle: Object.freeze(features)
  });
}

async function claimPaymentOperation(connection, input, now) {
  const keyHash = crypto.createHash('sha256').update(input.idempotencyKey).digest('hex');
  const payloadHash = crypto.createHash('sha256').update(canonicalPayload(input.payload)).digest('hex');
  const [rows] = await connection.query(
    `SELECT idOperacionPago,huellaPayload,estado,resultadoReferencia,codigoResultado
     FROM operacionPagoSuscripcion
     WHERE idTiendaClave=? AND actorTipo='superadmin' AND idActorClave=?
       AND alcance='aplicar' AND claveHash=? FOR UPDATE`,
    [input.idTienda, input.idAdministrador, keyHash]
  );
  if (rows.length) {
    if (rows[0].huellaPayload !== payloadHash) {
      throw applicationError(409, 'La clave de operacion ya fue utilizada con otros datos.', 'PAYMENT_OPERATION_KEY_CONFLICT');
    }
    if (rows[0].estado === 'completada') return { replayed: true, id: Number(rows[0].idOperacionPago) };
    throw applicationError(409, 'La operacion ya esta en proceso.', 'PAYMENT_OPERATION_IN_PROGRESS');
  }
  const stamp = formatLocalDateTime(now);
  const [result] = await connection.query(
    `INSERT INTO operacionPagoSuscripcion
      (idTienda,idSolicitudPago,actorTipo,idAdministradorActor,alcance,claveHash,
       huellaPayload,estado,creadaEn,expiraEn,actualizadaEn)
     VALUES (?,?,'superadmin',?,'aplicar',?,?,'en_proceso',?,?,?)`,
    [input.idTienda, input.idSolicitudPago, input.idAdministrador, keyHash, payloadHash,
      stamp, formatLocalDateTime(addLocalDays(now, OPERATION_TTL_DAYS)), stamp]
  );
  return { replayed: false, id: Number(result.insertId) };
}

async function completePaymentOperation(connection, idOperacionPago, reference, now) {
  const stamp = formatLocalDateTime(now);
  await connection.query(
    `UPDATE operacionPagoSuscripcion
     SET estado='completada',resultadoReferencia=?,codigoResultado=?,completadaEn=?,actualizadaEn=?
     WHERE idOperacionPago=?`,
    [reference, APPLICATION_RESULT, stamp, stamp, idOperacionPago]
  );
}

async function existingApplication(connection, request) {
  const [rows] = await connection.query(
    `SELECT a.operacionAplicada,a.fechaInicio,a.fechaFin,s.estado,s.planCodigoSnapshot
     FROM aplicacionPagoSuscripcion a
     JOIN suscripcionTienda s ON s.idTienda=a.idTienda AND s.idSuscripcion=a.idSuscripcion
     WHERE a.idTienda=? AND a.idSolicitudPago=? LIMIT 1 FOR UPDATE`,
    [request.idTienda, request.idSolicitudPago]
  );
  return rows[0] || null;
}

function safeResult(request, subscription, application, replayed) {
  return Object.freeze({
    referencia: request.referenciaPublica,
    estado: 'aplicada',
    operacion: request.operacion,
    suscripcion: Object.freeze({
      estado: subscription.estado,
      plan: subscription.planCodigoSnapshot,
      fechaInicio: application.fechaInicio,
      fechaFin: application.fechaFin
    }),
    replayed: Boolean(replayed)
  });
}

function assertFrozenRequest(request, subscription) {
  if (request.estado !== 'pendiente_revision') {
    throw applicationError(409, 'La solicitud no esta pendiente de revision.', 'PAYMENT_APPLICATION_STATE_INVALID');
  }
  if (!request.idComprobantePago || !['cargado', 'aceptado'].includes(request.comprobanteEstado)) {
    throw applicationError(409, 'La solicitud no tiene un comprobante activo.', 'PAYMENT_APPLICATION_RECEIPT_REQUIRED');
  }
  if (Number(subscription.idPlan) !== Number(request.idPlanActual)
    || subscription.planCodigoSnapshot !== request.planActualCodigoSnapshot
    || subscription.planNombreSnapshot !== request.planActualNombreSnapshot) {
    throw applicationError(409, 'La suscripcion cambio despues de crear la solicitud.', 'PAYMENT_APPLICATION_SNAPSHOT_STALE');
  }
  if (subscription.idPlanSiguiente || subscription.fechaAplicacionPlanSiguiente) {
    throw applicationError(409, 'Existe un cambio de plan programado incompatible.', 'PAYMENT_APPLICATION_SCHEDULED_PLAN_CONFLICT');
  }
}

async function applySubscriptionEffect(connection, input) {
  const { request, subscription, targetPlan, now } = input;
  const currentPlan = await planFromSubscription(connection, subscription);
  const effective = computeEffectiveStatus(subscription, now);
  const operationType = OPERATION_MAP[request.operacion];
  if (!operationType) {
    throw applicationError(409, 'La operacion congelada no se puede aplicar.', 'PAYMENT_APPLICATION_OPERATION_INVALID');
  }
  const lifecycleOperation = await claimOperation(connection, {
    idTienda: request.idTienda,
    tipoOperacion: operationType,
    claveOperacion: `payment-application:${request.referenciaPublica}`,
    payload: { referencia: request.referenciaPublica, operacion: request.operacion }
  }, now);
  if (lifecycleOperation.replayed) {
    throw applicationError(409, 'La operacion de suscripcion ya fue aplicada.', 'PAYMENT_SUBSCRIPTION_EFFECT_EXISTS');
  }

  const previousState = subscription.estado;
  let nextState = previousState;
  let start = parseLocalDateTime(subscription.fechaInicio);
  let end = parseLocalDateTime(subscription.fechaFin);
  let historyType;
  let historyReason;
  let metadata;
  let resultCode;

  if (request.operacion === 'upgrade') {
    const comparison = comparePlanEntitlements(currentPlan, targetPlan);
    if (effective !== 'activa' || comparison.tipo !== PLAN_CHANGE_TYPES.UPGRADE) {
      throw applicationError(409, 'La suscripcion ya no admite el upgrade solicitado.', 'PAYMENT_UPGRADE_NOT_ALLOWED');
    }
    await replaceSnapshot(connection, subscription, targetPlan, formatLocalDateTime(now));
    historyType = 'upgrade';
    historyReason = 'cambio_plan';
    metadata = { planCodigoAnterior: currentPlan.codigo, planCodigoNuevo: targetPlan.codigo };
    resultCode = 'SUBSCRIPTION_PLAN_UPGRADED';
  } else {
    const automaticSuspension = effective === 'suspendida'
      && (subscription.estado !== 'suspendida' || subscription.motivoTransicion === 'fin_gracia');
    if (request.operacion === 'reactivacion' && !automaticSuspension) {
      throw applicationError(409, 'La suscripcion ya no admite reactivacion.', 'PAYMENT_REACTIVATION_NOT_ALLOWED');
    }
    if (request.operacion === 'renovacion'
      && !['activa', 'gracia'].includes(effective) && !automaticSuspension) {
      throw applicationError(409, 'La suscripcion ya no admite renovacion.', 'PAYMENT_RENEWAL_NOT_ALLOWED');
    }
    if (targetPlan.codigo !== currentPlan.codigo) {
      throw applicationError(409, 'La vigencia debe conservar el plan congelado.', 'PAYMENT_APPLICATION_PLAN_MISMATCH');
    }
    const startsNow = automaticSuspension;
    start = startsNow ? now : parseLocalDateTime(subscription.fechaInicio);
    const base = startsNow ? now : parseLocalDateTime(subscription.fechaFin);
    end = addCalendarMonths(base, Number(request.cantidadMeses));
    nextState = 'activa';
    await replaceSnapshot(connection, subscription, targetPlan, formatLocalDateTime(now));
    await connection.query(
      `UPDATE suscripcionTienda
       SET tipo='pagada',estado='activa',fechaInicio=?,fechaFin=?,fechaFinGracia=?,
           suspendidaEn=NULL,reactivadaEn=?,canceladaEn=NULL,motivoTransicion=?,
           tipoPeriodoSnapshot=?,duracionDiasSnapshot=?,actualizadoEn=?
       WHERE idTienda=? AND idSuscripcion=?`,
      [formatLocalDateTime(start), formatLocalDateTime(end), formatLocalDateTime(addLocalDays(end, 7)),
        request.operacion === 'reactivacion' || startsNow ? formatLocalDateTime(now) : subscription.reactivadaEn,
        request.operacion === 'reactivacion' ? 'reactivacion_administrativa' : 'renovacion',
        request.periodo, durationDays(start, end), formatLocalDateTime(now),
        request.idTienda, request.idSuscripcion]
    );
    historyType = request.operacion === 'reactivacion' ? 'reactivacion' : 'renovacion';
    historyReason = request.operacion === 'reactivacion' ? 'reactivacion_administrativa' : 'renovacion';
    metadata = historyType === 'renovacion'
      ? { planCodigo: targetPlan.codigo, tipoPeriodo: request.periodo }
      : {};
    resultCode = request.operacion === 'reactivacion' ? 'SUBSCRIPTION_REACTIVATED' : 'SUBSCRIPTION_RENEWED';
  }

  const historyId = await insertHistory(connection, {
    idTienda: request.idTienda,
    idSuscripcion: request.idSuscripcion,
    estadoAnterior: previousState,
    estadoNuevo: nextState,
    tipoOperacion: historyType,
    motivo: historyReason,
    actorTipo: 'administrador',
    idAdministrador: input.idAdministrador,
    metadatos: metadata,
    now
  });
  await completeOperation(connection, lifecycleOperation.id, {
    idSuscripcion: request.idSuscripcion,
    idHistorial: historyId,
    codigo: resultCode
  }, now);
  const [rows] = await connection.query(
    'SELECT * FROM suscripcionTienda WHERE idTienda=? AND idSuscripcion=? LIMIT 1',
    [request.idTienda, request.idSuscripcion]
  );
  return { subscription: rows[0], historyId, operationId: lifecycleOperation.id, start, end };
}

function createSaasCPaymentApplicationService({
  database = pool,
  clock = getLocalNow,
  auditService = administrativeAuditService
} = {}) {
  async function apply(input) {
    const idAdministrador = await validateSuperadmin(database, input.idAdministrador);
    const locator = await requestLocator(database, input.reference);
    const now = input.now || clock();
    return withTransaction(database, async (connection) => {
      const subscription = await lockStoreAndSubscription(connection, locator.idTienda, locator.idSuscripcion);
      const request = await lockRequest(connection, locator, input.reference);
      const operation = await claimPaymentOperation(connection, {
        idTienda: locator.idTienda,
        idSolicitudPago: locator.idSolicitudPago,
        idAdministrador,
        idempotencyKey: input.idempotencyKey,
        payload: { referencia: input.reference }
      }, now);
      const existing = await existingApplication(connection, request);
      if (existing) {
        if (!operation.replayed) {
          await completePaymentOperation(connection, operation.id, request.referenciaPublica, now);
        }
        return safeResult(request, {
          estado: existing.estado,
          planCodigoSnapshot: existing.planCodigoSnapshot
        }, existing, true);
      }
      if (operation.replayed) {
        throw applicationError(409, 'La aplicacion registrada no esta disponible.', 'PAYMENT_APPLICATION_RESULT_MISSING');
      }
      assertFrozenRequest(request, subscription);
      const features = await requestFeatures(connection, request);
      const targetPlan = frozenPlan(request, features);
      const effect = await applySubscriptionEffect(connection, {
        request,
        subscription,
        targetPlan,
        idAdministrador,
        now
      });
      const stamp = formatLocalDateTime(now);
      const operationApplied = OPERATION_MAP[request.operacion];
      await connection.query(
        `INSERT INTO aplicacionPagoSuscripcion
          (idTienda,idSolicitudPago,idSuscripcion,operacionAplicada,idOperacionSuscripcion,
           idHistorialSuscripcion,idPlanAnterior,idPlanNuevo,periodo,fechaInicio,fechaFin,
           codigoResultado,aplicadaPor,aplicadaEn,creadoEn)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [request.idTienda, request.idSolicitudPago, request.idSuscripcion, operationApplied,
          effect.operationId, effect.historyId, request.idPlanActual, request.idPlanObjetivo,
          request.periodo, formatLocalDateTime(effect.start), formatLocalDateTime(effect.end),
          APPLICATION_RESULT, idAdministrador, stamp, stamp]
      );
      await connection.query(
        `INSERT INTO revisionPagoSuscripcion
          (idTienda,idSolicitudPago,idComprobantePago,decision,estadoAnterior,estadoNuevo,
           motivo,observacion,revisadoPor,metadatos,creadoEn)
         VALUES (?,?,?,'aplicar','pendiente_revision','aplicada','aprobacion_manual',NULL,?,?,?)`,
        [request.idTienda, request.idSolicitudPago, request.idComprobantePago,
          idAdministrador, JSON.stringify({ operacion: request.operacion }), stamp]
      );
      await connection.query(
        `UPDATE comprobantePagoSuscripcion SET estado='aceptado',actualizadoEn=?
         WHERE idTienda=? AND idSolicitudPago=? AND idComprobantePago=?`,
        [stamp, request.idTienda, request.idSolicitudPago, request.idComprobantePago]
      );
      await connection.query(
        `UPDATE solicitudPagoSuscripcion
         SET estado='aplicada',aplicadaEn=?,ultimaTransicionEn=?,actualizadoEn=?
         WHERE idTienda=? AND idSolicitudPago=?`,
        [stamp, stamp, stamp, request.idTienda, request.idSolicitudPago]
      );
      await connection.query(
        `INSERT INTO historialSolicitudPagoSuscripcion
          (idTienda,idSolicitudPago,evento,estadoAnterior,estadoNuevo,actorTipo,
           idAdministradorActor,metadatos,creadoEn)
         VALUES (?,?,'aplicada','pendiente_revision','aplicada','superadmin',?,?,?)`,
        [request.idTienda, request.idSolicitudPago, idAdministrador,
          JSON.stringify({ operacion: request.operacion }), stamp]
      );
      await auditService.recordCritical(connection, {
        action: 'aplicacion_pago_suscripcion',
        result: 'correcto',
        resultCode: APPLICATION_RESULT,
        origin: 'web',
        actorType: 'administrador',
        administratorId: idAdministrador,
        storeId: request.idTienda,
        reference: null,
        requestId: input.requestId || null,
        before: { estado: 'pendiente_revision' },
        after: { estado: 'aplicada' },
        metadata: {
          tipoOperacion: request.operacion,
          planCodigo: request.planCodigoSnapshot,
          periodo: request.periodo
        },
        createdAt: stamp
      });
      await completePaymentOperation(connection, operation.id, request.referenciaPublica, now);
      return safeResult(request, effect.subscription, {
        fechaInicio: formatLocalDateTime(effect.start),
        fechaFin: formatLocalDateTime(effect.end)
      }, false);
    });
  }

  return Object.freeze({ apply });
}

module.exports = {
  addCalendarMonths,
  createSaasCPaymentApplicationService
};
