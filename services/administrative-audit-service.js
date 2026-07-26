const pool = require('../config/db');
const {
  ACTOR_TYPES,
  AUDIT_ACTION_RESULT_CODES,
  AUDIT_ACTIONS,
  AUDIT_ORIGINS,
  AUDIT_RESULTS,
  AUDIT_RESULTS_BY_CODE,
  AUDIT_RESULT_CODES,
  VALUE_TYPES
} = require('../config/administrative-audit-contract');
const { formatLocalDateTime } = require('../utils/local-datetime');

const ACTORS = new Set(ACTOR_TYPES);
const ORIGINS = new Set(AUDIT_ORIGINS);
const RESULTS = new Set(AUDIT_RESULTS);
const RESULT_CODES = new Set(AUDIT_RESULT_CODES);
const SAFE_CODE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$/;
const SAFE_REFERENCE = /^[a-z][a-z0-9_]{1,39}:[0-9]{1,20}$/;
const REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function auditError(message) {
  const error = new Error(message);
  error.code = 'AUDIT_EVENT_INVALID';
  return error;
}

function positiveInteger(value, nullable = false) {
  if (nullable && (value === null || value === undefined)) return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw auditError('Identificador de auditoria invalido.');
  return parsed;
}

function safeCode(value, label) {
  const normalized = String(value || '').trim();
  if (!SAFE_CODE.test(normalized)) throw auditError(`${label} de auditoria invalido.`);
  return normalized;
}

function sanitizeValue(key, value) {
  const type = VALUE_TYPES[key];
  if (type === 'boolean') {
    if (value === true || value === false) return value;
    if (value === 1 || value === 0) return Boolean(value);
    throw auditError(`Valor booleano invalido para ${key}.`);
  }
  if (type === 'integer') {
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < 0) throw auditError(`Valor entero invalido para ${key}.`);
    return parsed;
  }
  if (type === 'code') return safeCode(value, key).toLowerCase();
  throw auditError(`Campo de auditoria no permitido: ${key}.`);
}

function sanitizeSection(actionDefinition, section, value) {
  if (value === null || value === undefined) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw auditError(`La seccion ${section} debe ser un objeto.`);
  }
  const allowed = new Set(actionDefinition.allowed[section]);
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    if (!allowed.has(key)) throw auditError(`Campo ${section}.${key} no permitido.`);
    result[key] = sanitizeValue(key, item);
  }
  return Object.keys(result).length ? result : null;
}

function normalizeEvent(input) {
  const action = String(input?.action || '').trim();
  const definition = AUDIT_ACTIONS[action];
  if (!definition) throw auditError('Accion de auditoria no permitida.');
  const actorType = String(input.actorType || '').trim();
  if (!ACTORS.has(actorType)) throw auditError('Tipo de actor no permitido.');
  const administratorId = positiveInteger(input.administratorId, true);
  if ((actorType === 'administrador') !== (administratorId !== null)) {
    throw auditError('El actor administrador requiere un identificador y los demas actores no lo aceptan.');
  }
  const result = String(input.result || '').trim();
  if (!RESULTS.has(result)) throw auditError('Resultado de auditoria no permitido.');
  const resultCode = String(input.resultCode || '').trim();
  if (!RESULT_CODES.has(resultCode)
    || !AUDIT_ACTION_RESULT_CODES[action].includes(resultCode)
    || !AUDIT_RESULTS_BY_CODE[resultCode]?.includes(result)) {
    throw auditError('Codigo de resultado no permitido para la accion.');
  }
  const origin = String(input.origin || 'web').trim();
  if (!ORIGINS.has(origin)) throw auditError('Origen de auditoria no permitido.');
  const requestId = input.requestId === null || input.requestId === undefined
    ? null
    : String(input.requestId).trim().toLowerCase();
  if (requestId && !REQUEST_ID.test(requestId)) throw auditError('Request ID de auditoria invalido.');
  const reference = input.reference === null || input.reference === undefined
    ? null
    : String(input.reference).trim().toLowerCase();
  if (reference && !SAFE_REFERENCE.test(reference)) throw auditError('Referencia de auditoria invalida.');
  const storeId = positiveInteger(input.storeId, true);
  if (actorType === 'anonimo' && storeId !== null) {
    throw auditError('Un actor anonimo no puede declarar una tienda.');
  }
  return Object.freeze({
    storeId,
    actorType,
    administratorId,
    category: definition.category,
    action,
    result,
    resultCode,
    origin,
    entity: definition.entity,
    reference,
    requestId,
    before: sanitizeSection(definition, 'before', input.before),
    after: sanitizeSection(definition, 'after', input.after),
    metadata: sanitizeSection(definition, 'metadata', input.metadata),
    createdAt: input.createdAt || formatLocalDateTime()
  });
}

async function validateAdministratorScope(connection, event) {
  if (event.actorType !== 'administrador') return;
  const [rows] = await connection.query(
    `SELECT idTienda, rol, activo
     FROM administrador
     WHERE idAdministrador=?
     LIMIT 1`,
    [event.administratorId]
  );
  if (!rows.length || !Number(rows[0].activo)) throw auditError('El actor de auditoria no es valido.');
  const actorStoreId = rows[0].idTienda === null ? null : Number(rows[0].idTienda);
  if (rows[0].rol === 'superadmin') {
    if (actorStoreId !== null) throw auditError('El superadministrador de auditoria tiene una asociacion invalida.');
    return;
  }
  if (rows[0].rol !== 'dueno_tienda'
    || actorStoreId === null
    || event.storeId !== actorStoreId) {
    throw auditError('El actor de auditoria no pertenece a la tienda del evento.');
  }
}

async function validateReferenceScope(connection, event) {
  if (!event.reference || event.storeId === null) return;
  const [entity, rawId] = event.reference.split(':');
  const id = Number(rawId);
  if (entity === 'tienda') {
    if (id !== event.storeId) throw auditError('La referencia no pertenece a la tienda del evento.');
    return;
  }
  if (entity === 'administrador') {
    const [rows] = await connection.query(
      `SELECT idTienda
       FROM administrador
       WHERE idAdministrador=?
       LIMIT 1`,
      [id]
    );
    if (!rows.length || Number(rows[0].idTienda) !== event.storeId) {
      throw auditError('La referencia no pertenece a la tienda del evento.');
    }
    return;
  }
  if (entity === 'suscripcion') {
    const [rows] = await connection.query(
      `SELECT idTienda
       FROM suscripcionTienda
       WHERE idSuscripcion=?
       LIMIT 1`,
      [id]
    );
    if (!rows.length || Number(rows[0].idTienda) !== event.storeId) {
      throw auditError('La referencia no pertenece a la tienda del evento.');
    }
  }
}

async function insertEvent(connection, event) {
  await validateAdministratorScope(connection, event);
  await validateReferenceScope(connection, event);
  try {
    const [result] = await connection.query(
      `INSERT INTO eventoAuditoriaAdministrativa
       (idTienda, actorTipo, idAdministradorActor, categoria, accion, resultado,
        codigoResultado, origen, entidadTipo, referenciaSegura, requestId,
        datosAnteriores, datosPosteriores, metadatos, creadoEn)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        event.storeId,
        event.actorType,
        event.administratorId,
        event.category,
        event.action,
        event.result,
        event.resultCode,
        event.origin,
        event.entity,
        event.reference,
        event.requestId,
        event.before ? JSON.stringify(event.before) : null,
        event.after ? JSON.stringify(event.after) : null,
        event.metadata ? JSON.stringify(event.metadata) : null,
        event.createdAt
      ]
    );
    return { idEventoAuditoria: Number(result.insertId), duplicated: false };
  } catch (error) {
    if (error.code !== 'ER_DUP_ENTRY' || !event.requestId) throw error;
    const [rows] = await connection.query(
      `SELECT idEventoAuditoria
       FROM eventoAuditoriaAdministrativa
       WHERE requestId=? AND accion=? AND resultado=?
       LIMIT 1`,
      [event.requestId, event.action, event.result]
    );
    if (!rows.length) throw error;
    return { idEventoAuditoria: Number(rows[0].idEventoAuditoria), duplicated: true };
  }
}

function createAdministrativeAuditService({
  database = pool,
  logger = null,
  clock = () => formatLocalDateTime()
} = {}) {
  let activeLogger = logger;

  async function recordCritical(connection, input) {
    if (!connection || typeof connection.query !== 'function') {
      throw auditError('La auditoria critica requiere una conexion transaccional.');
    }
    return insertEvent(connection, normalizeEvent({ ...input, createdAt: clock() }));
  }

  async function recordOutcome(input) {
    try {
      const event = normalizeEvent({ ...input, createdAt: clock() });
      return await insertEvent(database, event);
    } catch (error) {
      activeLogger?.error?.('administrative_audit_write_failed', {
        requestId: input?.requestId || null,
        action: AUDIT_ACTIONS[input?.action] ? input.action : 'invalid',
        errorCode: 'AUDIT_WRITE_FAILED'
      });
      return { recorded: false };
    }
  }

  function setLogger(nextLogger) {
    activeLogger = nextLogger;
  }

  return Object.freeze({ normalizeEvent, recordCritical, recordOutcome, setLogger });
}

function administratorActor(auth) {
  const id = Number(auth?.idAdministrador ?? auth?.id);
  if (!Number.isInteger(id) || id <= 0) return { actorType: 'anonimo', administratorId: null, storeId: null };
  const rawStore = auth?.idTienda;
  const storeId = rawStore === null || rawStore === undefined ? null : Number(rawStore);
  return { actorType: 'administrador', administratorId: id, storeId };
}

const administrativeAuditService = createAdministrativeAuditService();

module.exports = {
  administrativeAuditService,
  administratorActor,
  createAdministrativeAuditService,
  normalizeEvent
};
