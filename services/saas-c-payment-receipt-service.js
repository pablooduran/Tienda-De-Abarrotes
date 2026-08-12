const crypto = require('crypto');
const pool = require('../config/db');
const {
  ALLOWED_RECEIPT_STATES,
  receiptError,
  receiptReference,
  validateReceiptFile
} = require('../config/saas-c-payment-receipt-contract');
const { requestReference } = require('../config/saas-c-payment-request-contract');
const { sha256 } = require('../config/subscription-lifecycle-contract');
const { canonicalPayload } = require('./subscription-lifecycle-service');
const { administrativeAuditService } = require('./administrative-audit-service');
const { createPrivateReceiptStorage } = require('./private-receipt-storage');
const { addLocalDays, formatLocalDateTime, getLocalNow, parseLocalDateTime } = require('../utils/local-datetime');

const OPERATION_TTL_DAYS = 2;
const ACTIVE_RECEIPT_STATES = Object.freeze(['cargado', 'aceptado']);

function positiveId(value, label) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw receiptError(400, `${label} no es valido.`, 'INVALID_RECEIPT_CONTEXT');
  }
  return id;
}

function normalizeNow(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return new Date(value.getTime());
  if (value === undefined || value === null) return getLocalNow();
  try { return parseLocalDateTime(value); } catch {
    throw receiptError(400, 'La fecha de operacion no es valida.', 'INVALID_RECEIPT_DATE');
  }
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

async function lockOwnerContext(connection, input) {
  const [stores] = await connection.query('SELECT idTienda FROM tienda WHERE idTienda=? FOR UPDATE', [input.idTienda]);
  if (!stores.length) throw receiptError(404, 'La tienda no existe.', 'STORE_NOT_FOUND');
  const [subscriptions] = await connection.query(
    'SELECT idSuscripcion FROM suscripcionTienda WHERE idTienda=? AND idSuscripcion=? FOR UPDATE',
    [input.idTienda, input.idSuscripcion]
  );
  if (!subscriptions.length) throw receiptError(409, 'La suscripcion no esta disponible.', 'SUBSCRIPTION_NOT_AVAILABLE');
  const [actors] = await connection.query(
    `SELECT idTienda,rol,activo,estadoAcceso FROM administrador
     WHERE idAdministrador=? FOR UPDATE`,
    [input.idAdministrador]
  );
  if (!actors.length || !Number(actors[0].activo) || actors[0].estadoAcceso !== 'activo'
    || actors[0].rol !== 'dueno_tienda' || Number(actors[0].idTienda) !== input.idTienda) {
    throw receiptError(403, 'La cuenta no puede cargar comprobantes para esta tienda.', 'PAYMENT_TENANT_MISMATCH');
  }
}

async function insertHistory(connection, input) {
  await connection.query(
    `INSERT INTO historialSolicitudPagoSuscripcion
      (idTienda,idSolicitudPago,evento,estadoAnterior,estadoNuevo,actorTipo,
       idAdministradorActor,metadatos,creadoEn)
     VALUES (?, ?, ?, ?, ?, 'propietario', ?, NULL, ?)`,
    [input.idTienda, input.idSolicitudPago, input.event, input.previousState,
      input.nextState, input.idAdministrador, formatLocalDateTime(input.now)]
  );
}

async function materializeExpired(connection, idTienda, now) {
  const nowText = formatLocalDateTime(now);
  const [rows] = await connection.query(
    `SELECT idSolicitudPago,estado FROM solicitudPagoSuscripcion
     WHERE idTienda=? AND estado IN ('pendiente_comprobante','observada') AND venceEn<=?
     ORDER BY idSolicitudPago FOR UPDATE`,
    [idTienda, nowText]
  );
  for (const row of rows) {
    const [updated] = await connection.query(
      `UPDATE solicitudPagoSuscripcion
       SET estado='vencida',ultimaTransicionEn=?,actualizadoEn=?
       WHERE idTienda=? AND idSolicitudPago=? AND estado=?`,
      [nowText, nowText, idTienda, row.idSolicitudPago, row.estado]
    );
    if (updated.affectedRows) {
      await connection.query(
        `INSERT INTO historialSolicitudPagoSuscripcion
          (idTienda,idSolicitudPago,evento,estadoAnterior,estadoNuevo,actorTipo,
           idAdministradorActor,metadatos,creadoEn)
         VALUES (?,?,'vencida',?,'vencida','sistema',NULL,NULL,?)`,
        [idTienda, row.idSolicitudPago, row.estado, nowText]
      );
    }
  }
}

async function lockedRequest(connection, input) {
  const [rows] = await connection.query(
    `SELECT * FROM solicitudPagoSuscripcion
     WHERE idTienda=? AND idSuscripcion=? AND referenciaPublica=? LIMIT 1 FOR UPDATE`,
    [input.idTienda, input.idSuscripcion, input.reference]
  );
  if (!rows.length) throw receiptError(404, 'La solicitud no existe.', 'PAYMENT_REQUEST_NOT_FOUND');
  return rows[0];
}

async function claimOperation(connection, input, now) {
  const keyHash = sha256(input.idempotencyKey);
  const payloadHash = sha256(canonicalPayload(input.payload));
  const [rows] = await connection.query(
    `SELECT idOperacionPago,huellaPayload,estado,resultadoReferencia,idSolicitudPago
     FROM operacionPagoSuscripcion
     WHERE idTiendaClave=? AND actorTipo='propietario' AND idActorClave=?
       AND alcance='cargar_comprobante' AND claveHash=? FOR UPDATE`,
    [input.idTienda, input.idAdministrador, keyHash]
  );
  if (rows.length) {
    if (rows[0].huellaPayload !== payloadHash) {
      throw receiptError(409, 'La clave de operacion ya fue utilizada con otro archivo.', 'PAYMENT_OPERATION_KEY_CONFLICT');
    }
    if (rows[0].estado !== 'completada') {
      throw receiptError(409, 'La carga ya esta en proceso.', 'PAYMENT_OPERATION_IN_PROGRESS');
    }
    return Object.freeze({ replayed: true, row: rows[0] });
  }
  const nowText = formatLocalDateTime(now);
  const [created] = await connection.query(
    `INSERT INTO operacionPagoSuscripcion
      (idTienda,idSolicitudPago,actorTipo,idAdministradorActor,alcance,claveHash,
       huellaPayload,estado,creadaEn,completadaEn,fallidaEn,expiraEn,actualizadaEn)
     VALUES (?,?,'propietario',?,'cargar_comprobante',?,?,'en_proceso',?,NULL,NULL,?,?)`,
    [input.idTienda, input.idSolicitudPago, input.idAdministrador, keyHash, payloadHash,
      nowText, formatLocalDateTime(addLocalDays(now, OPERATION_TTL_DAYS)), nowText]
  );
  return Object.freeze({ replayed: false, id: Number(created.insertId) });
}

async function completeOperation(connection, operationId, input, now) {
  const nowText = formatLocalDateTime(now);
  await connection.query(
    `UPDATE operacionPagoSuscripcion
     SET estado='completada',resultadoReferencia=?,codigoResultado='PAYMENT_RECEIPT_UPLOADED',
         completadaEn=?,actualizadaEn=? WHERE idOperacionPago=?`,
    [input.receiptReference, nowText, nowText, operationId]
  );
}

function safeReceipt(row, replayed = false) {
  return Object.freeze({
    referencia: row.referenciaPublica,
    version: Number(row.versionComprobante),
    estado: row.estado,
    nombre: row.nombreOriginalSanitizado,
    extension: row.extensionDetectada,
    mime: row.mimeDetectado,
    tamanoBytes: Number(row.tamanoBytes),
    cargadoEn: row.cargadoEn,
    reemplazadoEn: row.reemplazadoEn,
    activo: ACTIVE_RECEIPT_STATES.includes(row.estado),
    replayed
  });
}

async function receiptByReference(connection, input) {
  const [rows] = await connection.query(
    `SELECT c.* FROM comprobantePagoSuscripcion c
     JOIN solicitudPagoSuscripcion s
       ON s.idTienda=c.idTienda AND s.idSolicitudPago=c.idSolicitudPago
     WHERE c.idTienda=? AND s.idSuscripcion=? AND s.referenciaPublica=?
       AND c.referenciaPublica=? LIMIT 1`,
    [input.idTienda, input.idSuscripcion, input.requestReference, input.receiptReference]
  );
  if (!rows.length) throw receiptError(404, 'El comprobante no existe.', 'PAYMENT_RECEIPT_NOT_FOUND');
  return rows[0];
}

async function auditUpload(connection, input) {
  await administrativeAuditService.recordCritical(connection, {
    action: 'carga_comprobante_pago_suscripcion',
    result: 'correcto',
    resultCode: 'PAYMENT_RECEIPT_UPLOADED',
    origin: 'web',
    actorType: 'administrador',
    administratorId: input.idAdministrador,
    storeId: input.idTienda,
    reference: `suscripcion:${input.idSuscripcion}`,
    requestId: input.requestId || null,
    before: { estado: input.previousState },
    after: { estado: 'pendiente_revision' },
    metadata: { formato: input.format },
    createdAt: formatLocalDateTime(input.now)
  });
}

function createSaasCPaymentReceiptService({
  database = pool,
  storage = createPrivateReceiptStorage(),
  clock = getLocalNow,
  contentInspector = Object.freeze({ inspect: async () => Object.freeze({ accepted: true }) })
} = {}) {
  async function upload(input) {
    const idTienda = positiveId(input.idTienda, 'La tienda');
    const idSuscripcion = positiveId(input.idSuscripcion, 'La suscripcion');
    const idAdministrador = positiveId(input.idAdministrador, 'El administrador');
    const reference = requestReference(input.reference);
    const receipt = validateReceiptFile(input.file);
    const inspection = await contentInspector.inspect(receipt);
    if (!inspection || inspection.accepted !== true) {
      throw receiptError(400, 'El comprobante no supero la inspeccion de contenido.', 'RECEIPT_CONTENT_REJECTED');
    }
    const now = normalizeNow(input.now ?? clock());
    let stored = null;
    let committed = false;
    try {
      const result = await withTransaction(database, async (connection) => {
        await lockOwnerContext(connection, { idTienda, idSuscripcion, idAdministrador });
        await materializeExpired(connection, idTienda, now);
        const request = await lockedRequest(connection, { idTienda, idSuscripcion, reference });
        const operation = await claimOperation(connection, {
          idTienda,
          idAdministrador,
          idSolicitudPago: request.idSolicitudPago,
          idempotencyKey: input.idempotencyKey,
          payload: { reference, hash: receipt.sha256, size: receipt.size, mime: receipt.mime }
        }, now);
        if (operation.replayed) {
          const replay = await receiptByReference(connection, {
            idTienda,
            idSuscripcion,
            requestReference: reference,
            receiptReference: operation.row.resultadoReferencia
          });
          return Object.freeze({ comprobante: safeReceipt(replay, true), estadoSolicitud: request.estado });
        }
        if (!ALLOWED_RECEIPT_STATES.includes(request.estado)) {
          throw receiptError(409, 'El estado de la solicitud no permite cargar comprobantes.', 'PAYMENT_RECEIPT_UPLOAD_NOT_ALLOWED');
        }
        const [active] = await connection.query(
          `SELECT idComprobantePago FROM comprobantePagoSuscripcion
           WHERE idTienda=? AND idSolicitudPago=? AND estado IN ('cargado','aceptado')
           ORDER BY versionComprobante DESC FOR UPDATE`,
          [idTienda, request.idSolicitudPago]
        );
        const [[version]] = await connection.query(
          `SELECT COALESCE(MAX(versionComprobante),0)+1 siguiente
           FROM comprobantePagoSuscripcion WHERE idTienda=? AND idSolicitudPago=? FOR UPDATE`,
          [idTienda, request.idSolicitudPago]
        );
        stored = await storage.put(receipt);
        const nowText = formatLocalDateTime(now);
        if (active.length) {
          await connection.query(
            `UPDATE comprobantePagoSuscripcion
             SET estado='reemplazado',reemplazadoEn=?,actualizadoEn=?
             WHERE idTienda=? AND idSolicitudPago=? AND estado IN ('cargado','aceptado')`,
            [nowText, nowText, idTienda, request.idSolicitudPago]
          );
        }
        const publicReference = crypto.randomBytes(32).toString('base64url');
        const [created] = await connection.query(
          `INSERT INTO comprobantePagoSuscripcion
            (referenciaPublica,idTienda,idSolicitudPago,versionComprobante,estado,
             nombreGenerado,nombreOriginalSanitizado,extensionDetectada,mimeDetectado,
             tamanoBytes,hashSha256,claveAlmacenamiento,cargadoPor,cargadoEn,
             reemplazadoEn,creadoEn,actualizadoEn)
           VALUES (?,?,?,?,'cargado',?,?,?,?,?,?,?, ?,?,NULL,?,?)`,
          [publicReference, idTienda, request.idSolicitudPago, Number(version.siguiente),
            stored.generatedName, receipt.originalName, receipt.extension, receipt.mime,
            receipt.size, receipt.sha256, stored.key, idAdministrador, nowText, nowText, nowText]
        );
        await connection.query(
          `UPDATE solicitudPagoSuscripcion
           SET estado='pendiente_revision',enviadaEn=?,ultimaTransicionEn=?,actualizadoEn=?
           WHERE idTienda=? AND idSolicitudPago=?`,
          [nowText, nowText, nowText, idTienda, request.idSolicitudPago]
        );
        await insertHistory(connection, {
          idTienda,
          idSolicitudPago: request.idSolicitudPago,
          event: active.length ? 'comprobante_reemplazado' : 'comprobante_cargado',
          previousState: request.estado,
          nextState: 'pendiente_revision',
          idAdministrador,
          now
        });
        await auditUpload(connection, {
          idTienda, idSuscripcion, idAdministrador, requestId: input.requestId,
          previousState: request.estado, format: receipt.extension, now
        });
        await completeOperation(connection, operation.id, { receiptReference: publicReference }, now);
        return Object.freeze({
          comprobante: safeReceipt({
            referenciaPublica: publicReference,
            versionComprobante: Number(version.siguiente),
            estado: 'cargado',
            nombreOriginalSanitizado: receipt.originalName,
            extensionDetectada: receipt.extension,
            mimeDetectado: receipt.mime,
            tamanoBytes: receipt.size,
            cargadoEn: nowText,
            reemplazadoEn: null
          }),
          estadoSolicitud: 'pendiente_revision',
          created: Boolean(created.insertId)
        });
      });
      committed = true;
      return result;
    } finally {
      if (stored && !committed) await storage.remove(stored.key).catch(() => {});
    }
  }

  async function list(input) {
    const idTienda = positiveId(input.idTienda, 'La tienda');
    const idSuscripcion = positiveId(input.idSuscripcion, 'La suscripcion');
    const reference = requestReference(input.reference);
    const now = normalizeNow(input.now ?? clock());
    await withTransaction(database, async (connection) => {
      await lockOwnerContext(connection, { idTienda, idSuscripcion, idAdministrador: input.idAdministrador });
      await materializeExpired(connection, idTienda, now);
      await lockedRequest(connection, { idTienda, idSuscripcion, reference });
    });
    const [rows] = await database.query(
      `SELECT c.* FROM comprobantePagoSuscripcion c
       JOIN solicitudPagoSuscripcion s
         ON s.idTienda=c.idTienda AND s.idSolicitudPago=c.idSolicitudPago
       WHERE c.idTienda=? AND s.idSuscripcion=? AND s.referenciaPublica=?
       ORDER BY c.versionComprobante DESC`,
      [idTienda, idSuscripcion, reference]
    );
    return Object.freeze({ comprobantes: Object.freeze(rows.map((row) => safeReceipt(row))) });
  }

  async function download(input) {
    const idTienda = positiveId(input.idTienda, 'La tienda');
    const idSuscripcion = positiveId(input.idSuscripcion, 'La suscripcion');
    const row = await withTransaction(database, async (connection) => {
      await lockOwnerContext(connection, {
        idTienda,
        idSuscripcion,
        idAdministrador: positiveId(input.idAdministrador, 'El administrador')
      });
      return receiptByReference(connection, {
        idTienda,
        idSuscripcion,
        requestReference: requestReference(input.reference),
        receiptReference: receiptReference(input.receiptReference)
      });
    });
    const object = await storage.open(row.claveAlmacenamiento);
    if (Number(row.tamanoBytes) !== object.size) {
      object.stream.destroy();
      throw receiptError(500, 'El comprobante no esta disponible.', 'RECEIPT_OBJECT_INTEGRITY_ERROR');
    }
    return Object.freeze({
      stream: object.stream,
      size: object.size,
      mime: row.mimeDetectado,
      filename: `comprobante-v${Number(row.versionComprobante)}.${row.extensionDetectada}`
    });
  }

  return Object.freeze({ download, list, storage, upload });
}

module.exports = { createSaasCPaymentReceiptService };
