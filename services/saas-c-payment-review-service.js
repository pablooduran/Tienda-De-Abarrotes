const crypto = require('crypto');
const pool = require('../config/db');
const { REVIEW_STATES } = require('../config/saas-c-payment-review-contract');
const { canonicalPayload } = require('./subscription-lifecycle-service');
const { administrativeAuditService } = require('./administrative-audit-service');
const { createPrivateReceiptStorage } = require('./private-receipt-storage');
const { addLocalDays, formatLocalDateTime, getLocalNow } = require('../utils/local-datetime');

const OPERATION_TTL_DAYS = 2;
const DECISION_TO_SCHEMA = Object.freeze({ observada: 'observar', rechazada: 'rechazar' });

function reviewError(status, message, code) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

async function withTransaction(database, callback) {
  const connection = await database.getConnection();
  try {
    await connection.beginTransaction();
    const result = await callback(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    connection.release();
  }
}

async function validateSuperadmin(database, idAdministrador) {
  const id = Number(idAdministrador);
  if (!Number.isSafeInteger(id) || id < 1) {
    throw reviewError(403, 'La operacion requiere un superadministrador.', 'SUPERADMIN_REQUIRED');
  }
  const [rows] = await database.query(
    `SELECT idAdministrador FROM administrador
     WHERE idAdministrador=? AND rol='superadmin' AND idTienda IS NULL
       AND activo=1 AND estadoAcceso='activo' LIMIT 1`,
    [id]
  );
  if (!rows.length) throw reviewError(403, 'La operacion requiere un superadministrador.', 'SUPERADMIN_REQUIRED');
  return id;
}

async function requestLocator(database, reference) {
  const [rows] = await database.query(
    `SELECT idTienda,idSolicitudPago,idSuscripcion
     FROM solicitudPagoSuscripcion WHERE referenciaPublica=? LIMIT 1`,
    [reference]
  );
  if (!rows.length) throw reviewError(404, 'La solicitud no existe.', 'PAYMENT_REQUEST_NOT_FOUND');
  return {
    idTienda: Number(rows[0].idTienda),
    idSolicitudPago: Number(rows[0].idSolicitudPago),
    idSuscripcion: Number(rows[0].idSuscripcion)
  };
}

async function lockStoreAndRequest(connection, locator, reference) {
  const [stores] = await connection.query('SELECT idTienda FROM tienda WHERE idTienda=? FOR UPDATE', [locator.idTienda]);
  if (!stores.length) throw reviewError(404, 'La solicitud no existe.', 'PAYMENT_REQUEST_NOT_FOUND');
  const [rows] = await connection.query(
    `SELECT s.*,t.nombre tienda,c.idComprobantePago,c.referenciaPublica comprobanteReferencia,
            c.mimeDetectado,c.nombreOriginalSanitizado,c.claveAlmacenamiento
     FROM solicitudPagoSuscripcion s
     JOIN tienda t ON t.idTienda=s.idTienda
     LEFT JOIN comprobantePagoSuscripcion c
       ON c.idTienda=s.idTienda AND c.idSolicitudPago=s.idSolicitudPago
      AND c.idSolicitudActiva=s.idSolicitudPago
     WHERE s.idTienda=? AND s.idSolicitudPago=? AND s.referenciaPublica=? LIMIT 1 FOR UPDATE`,
    [locator.idTienda, locator.idSolicitudPago, reference]
  );
  if (!rows.length) throw reviewError(404, 'La solicitud no existe.', 'PAYMENT_REQUEST_NOT_FOUND');
  return rows[0];
}

async function requestByReference(database, reference) {
  const [rows] = await database.query(
    `SELECT s.*,t.nombre tienda,c.idComprobantePago,c.referenciaPublica comprobanteReferencia,
            c.mimeDetectado,c.nombreOriginalSanitizado,c.claveAlmacenamiento
     FROM solicitudPagoSuscripcion s
     JOIN tienda t ON t.idTienda=s.idTienda
     LEFT JOIN comprobantePagoSuscripcion c
       ON c.idTienda=s.idTienda AND c.idSolicitudPago=s.idSolicitudPago
      AND c.idSolicitudActiva=s.idSolicitudPago
     WHERE s.referenciaPublica=? LIMIT 1`,
    [reference]
  );
  if (!rows.length) throw reviewError(404, 'La solicitud no existe.', 'PAYMENT_REQUEST_NOT_FOUND');
  return rows[0];
}

async function claimReviewOperation(connection, input, now) {
  const keyHash = crypto.createHash('sha256').update(input.idempotencyKey).digest('hex');
  const payloadHash = crypto.createHash('sha256').update(canonicalPayload(input.payload)).digest('hex');
  const [rows] = await connection.query(
    `SELECT idOperacionPago,huellaPayload,estado,resultadoReferencia
     FROM operacionPagoSuscripcion
     WHERE idTiendaClave=? AND actorTipo='superadmin' AND idActorClave=?
       AND alcance='revisar' AND claveHash=? FOR UPDATE`,
    [input.idTienda, input.idAdministrador, keyHash]
  );
  if (rows.length) {
    if (rows[0].huellaPayload !== payloadHash) {
      throw reviewError(409, 'La clave de operacion ya fue utilizada con otros datos.', 'PAYMENT_OPERATION_KEY_CONFLICT');
    }
    if (rows[0].estado === 'completada') return { replayed: true, row: rows[0] };
    throw reviewError(409, 'La operacion ya esta en proceso.', 'PAYMENT_OPERATION_IN_PROGRESS');
  }
  const stamp = formatLocalDateTime(now);
  const [created] = await connection.query(
    `INSERT INTO operacionPagoSuscripcion
      (idTienda,idSolicitudPago,actorTipo,idAdministradorActor,alcance,claveHash,
       huellaPayload,estado,creadaEn,expiraEn,actualizadaEn)
     VALUES (?,?,'superadmin',?,'revisar',?,?,'en_proceso',?,?,?)`,
    [input.idTienda, input.idSolicitudPago, input.idAdministrador, keyHash, payloadHash,
      stamp, formatLocalDateTime(addLocalDays(now, OPERATION_TTL_DAYS)), stamp]
  );
  return { replayed: false, id: Number(created.insertId) };
}

async function completeReviewOperation(connection, operationId, request, code, now) {
  const stamp = formatLocalDateTime(now);
  await connection.query(
    `UPDATE operacionPagoSuscripcion
     SET estado='completada',resultadoReferencia=?,codigoResultado=?,completadaEn=?,actualizadaEn=?
     WHERE idOperacionPago=?`,
    [request.referenciaPublica, code, stamp, stamp, operationId]
  );
}

function safeRequest(row) {
  return Object.freeze({
    referencia: row.referenciaPublica,
    tienda: row.tienda,
    operacion: row.operacion,
    plan: Object.freeze({ codigo: row.planCodigoSnapshot, nombre: row.planNombreSnapshot }),
    monto: Object.freeze({ moneda: row.monedaCobro, valor: row.montoFinalBOB }),
    metodo: row.metodoNombreSnapshot,
    estado: row.estado,
    creadaEn: row.creadaEn,
    venceEn: row.venceEn,
    comprobanteDisponible: Boolean(row.idComprobantePago)
  });
}

function createSaasCPaymentReviewService({
  database = pool,
  storage = createPrivateReceiptStorage(),
  clock = getLocalNow
} = {}) {
  async function list(input) {
    await validateSuperadmin(database, input.idAdministrador);
    const { estado, orden, pagina, limite } = input.query;
    const conditions = [`s.estado IN (${REVIEW_STATES.map(() => '?').join(',')})`];
    const values = [...REVIEW_STATES];
    if (estado) { conditions.push('s.estado=?'); values.push(estado); }
    const order = orden === 'antiguas' ? 's.creadaEn ASC'
      : orden === 'vencimiento' ? 's.venceEn ASC' : 's.creadaEn DESC';
    const [[count]] = await database.query(
      `SELECT COUNT(*) total FROM solicitudPagoSuscripcion s WHERE ${conditions.join(' AND ')}`,
      values
    );
    const [rows] = await database.query(
      `SELECT s.*,t.nombre tienda,c.idComprobantePago
       FROM solicitudPagoSuscripcion s JOIN tienda t ON t.idTienda=s.idTienda
       LEFT JOIN comprobantePagoSuscripcion c
         ON c.idTienda=s.idTienda AND c.idSolicitudPago=s.idSolicitudPago
        AND c.idSolicitudActiva=s.idSolicitudPago
       WHERE ${conditions.join(' AND ')}
       ORDER BY ${order},s.idSolicitudPago DESC LIMIT ? OFFSET ?`,
      [...values, limite, (pagina - 1) * limite]
    );
    return Object.freeze({
      resultados: Object.freeze(rows.map(safeRequest)),
      paginacion: Object.freeze({
        pagina, limite, total: Number(count.total),
        paginas: Math.max(1, Math.ceil(Number(count.total) / limite))
      })
    });
  }

  async function detail(input) {
    await validateSuperadmin(database, input.idAdministrador);
    const row = await requestByReference(database, input.reference);
    const [features] = await database.query(
      `SELECT codigoFuncionalidad codigo,nombreFuncionalidad nombre
       FROM solicitudPagoFuncionalidadSnapshot
       WHERE idTienda=? AND idSolicitudPago=? ORDER BY codigoFuncionalidad`,
      [row.idTienda, row.idSolicitudPago]
    );
    const [reviews] = await database.query(
      `SELECT decision,motivo,observacion,creadoEn
       FROM revisionPagoSuscripcion
       WHERE idTienda=? AND idSolicitudPago=? ORDER BY creadoEn,idRevisionPago`,
      [row.idTienda, row.idSolicitudPago]
    );
    const [history] = await database.query(
      `SELECT evento,estadoAnterior,estadoNuevo,creadoEn
       FROM historialSolicitudPagoSuscripcion
       WHERE idTienda=? AND idSolicitudPago=? ORDER BY creadoEn,idHistorialSolicitudPago`,
      [row.idTienda, row.idSolicitudPago]
    );
    return Object.freeze({
      ...safeRequest(row),
      planActual: Object.freeze({ codigo: row.planActualCodigoSnapshot, nombre: row.planActualNombreSnapshot }),
      tipoCambio: Object.freeze({
        valor: row.tipoCambioUsdBob,
        fuente: row.fuenteTipoCambioSnapshot,
        fechaEfectiva: row.fechaEfectivaTipoCambioSnapshot
      }),
      snapshot: Object.freeze({
        periodo: row.periodo,
        meses: Number(row.cantidadMeses),
        precioUSD: row.precioBaseUSD,
        monedaBase: row.monedaBase,
        monedaCobro: row.monedaCobro,
        limites: Object.freeze({
          propietarios: row.limitePropietariosSnapshot,
          productos: row.limiteProductosSnapshot,
          clientes: row.limiteClientesSnapshot,
          proveedores: row.limiteProveedoresSnapshot
        }),
        funcionalidades: Object.freeze(features)
      }),
      comprobante: row.comprobanteReferencia ? Object.freeze({
        referencia: row.comprobanteReferencia,
        mime: row.mimeDetectado,
        nombre: row.nombreOriginalSanitizado
      }) : null,
      revisiones: Object.freeze(reviews),
      historial: Object.freeze(history)
    });
  }

  async function transition(input) {
    const idAdministrador = await validateSuperadmin(database, input.idAdministrador);
    const locator = await requestLocator(database, input.reference);
    const now = input.now || clock();
    return withTransaction(database, async (connection) => {
      const request = await lockStoreAndRequest(connection, locator, input.reference);
      const operation = await claimReviewOperation(connection, {
        idTienda: locator.idTienda,
        idSolicitudPago: locator.idSolicitudPago,
        idAdministrador,
        idempotencyKey: input.idempotencyKey,
        payload: { referencia: input.reference, decision: input.decision, ...input.body }
      }, now);
      if (operation.replayed) return Object.freeze({ estado: request.estado, replayed: true });
      if (!REVIEW_STATES.includes(request.estado)) {
        throw reviewError(409, 'La transicion de revision no esta permitida.', 'PAYMENT_REVIEW_TRANSITION_NOT_ALLOWED');
      }
      const target = input.decision;
      const schemaDecision = DECISION_TO_SCHEMA[target];
      if (!schemaDecision) throw reviewError(400, 'La decision no es valida.', 'INVALID_PAYMENT_REVIEW_INPUT');
      const stamp = formatLocalDateTime(now);
      await connection.query(
        `INSERT INTO revisionPagoSuscripcion
          (idTienda,idSolicitudPago,idComprobantePago,decision,estadoAnterior,estadoNuevo,
           motivo,observacion,revisadoPor,metadatos,creadoEn)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [locator.idTienda, request.idSolicitudPago, request.idComprobantePago || null,
          schemaDecision, request.estado, target, input.body.motivo, input.body.observacion,
          idAdministrador, JSON.stringify({}), stamp]
      );
      await connection.query(
        `UPDATE solicitudPagoSuscripcion
         SET estado=?,ultimaTransicionEn=?,actualizadoEn=?
         WHERE idTienda=? AND idSolicitudPago=?`,
        [target, stamp, stamp, locator.idTienda, request.idSolicitudPago]
      );
      await connection.query(
        `INSERT INTO historialSolicitudPagoSuscripcion
          (idTienda,idSolicitudPago,evento,estadoAnterior,estadoNuevo,actorTipo,
           idAdministradorActor,metadatos,creadoEn)
         VALUES (?,?,?,?,?,'superadmin',?,?,?)`,
        [locator.idTienda, request.idSolicitudPago, target, request.estado, target,
          idAdministrador, JSON.stringify({ motivoCodigo: input.body.motivo }), stamp]
      );
      const code = target === 'observada' ? 'PAYMENT_REQUEST_OBSERVED' : 'PAYMENT_REQUEST_REJECTED';
      await administrativeAuditService.recordCritical(connection, {
        action: 'revision_solicitud_pago_suscripcion',
        result: 'correcto',
        resultCode: code,
        origin: 'web',
        actorType: 'administrador',
        administratorId: idAdministrador,
        storeId: locator.idTienda,
        reference: null,
        requestId: input.requestId || null,
        before: { estado: request.estado },
        after: { estado: target },
        metadata: { motivoCodigo: input.body.motivo },
        createdAt: stamp
      });
      await completeReviewOperation(connection, operation.id, request, code, now);
      return Object.freeze({ estado: target, replayed: false });
    });
  }

  async function download(input) {
    await validateSuperadmin(database, input.idAdministrador);
    const row = await requestByReference(database, input.reference);
    if (!row.claveAlmacenamiento) {
      throw reviewError(404, 'El comprobante no existe.', 'PAYMENT_RECEIPT_NOT_FOUND');
    }
    const file = await storage.open(row.claveAlmacenamiento);
    return Object.freeze({ ...file, mime: row.mimeDetectado, filename: row.nombreOriginalSanitizado });
  }

  return Object.freeze({ detail, download, list, transition });
}

module.exports = {
  createSaasCPaymentReviewService,
  requestLocator,
  validateSuperadmin,
  withTransaction
};
