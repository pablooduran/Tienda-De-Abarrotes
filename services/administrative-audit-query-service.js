const pool = require('../config/db');
const {
  ACTOR_TYPES,
  AUDIT_ACTIONS,
  AUDIT_CATEGORIES,
  AUDIT_RESULTS
} = require('../config/administrative-audit-contract');
const { normalizeEvent } = require('./administrative-audit-service');

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const SAFE_CODE = /^[a-z][a-z0-9_]{1,63}$/;
const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

function queryError(message, code = 'AUDIT_QUERY_INVALID') {
  const error = new Error(message);
  error.status = 400;
  error.code = code;
  return error;
}

function positiveInteger(value, label, { optional = false } = {}) {
  if (optional && (value === null || value === undefined || value === '')) return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw queryError(`${label} no es valido.`);
  return parsed;
}

function enumValue(value, allowed, label) {
  if (value === null || value === undefined || value === '') return null;
  const normalized = String(value).trim().toLowerCase();
  if (!allowed.has(normalized)) throw queryError(`${label} no es valido.`);
  return normalized;
}

function codeValue(value, allowed, label) {
  if (value === null || value === undefined || value === '') return null;
  const normalized = String(value).trim().toLowerCase();
  if (!SAFE_CODE.test(normalized) || (allowed && !allowed.has(normalized))) {
    throw queryError(`${label} no es valido.`);
  }
  return normalized;
}

function dateValue(value, label) {
  if (value === null || value === undefined || value === '') return null;
  const normalized = String(value).trim();
  if (!DATE.test(normalized)) throw queryError(`${label} debe usar AAAA-MM-DD.`);
  const date = new Date(`${normalized}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== normalized) {
    throw queryError(`${label} no es valida.`);
  }
  return normalized;
}

function parseFilters(query = {}, { forcedStoreId = null, allowStoreFilter = false } = {}) {
  const page = positiveInteger(query.page || 1, 'La pagina');
  const pageSize = positiveInteger(query.pageSize || DEFAULT_PAGE_SIZE, 'El tamano de pagina');
  if (pageSize > MAX_PAGE_SIZE) throw queryError(`El tamano de pagina maximo es ${MAX_PAGE_SIZE}.`);
  const from = dateValue(query.fechaDesde, 'La fecha inicial');
  const to = dateValue(query.fechaHasta, 'La fecha final');
  if (from && to && from > to) throw queryError('La fecha inicial no puede ser posterior a la final.');
  const requestedStoreId = allowStoreFilter
    ? positiveInteger(query.idTienda, 'La tienda', { optional: true })
    : null;
  return Object.freeze({
    storeId: forcedStoreId === null
      ? requestedStoreId
      : positiveInteger(forcedStoreId, 'La tienda'),
    page,
    pageSize,
    offset: (page - 1) * pageSize,
    from,
    to,
    category: enumValue(query.categoria, new Set(AUDIT_CATEGORIES), 'La categoria'),
    action: codeValue(query.accion, new Set(Object.keys(AUDIT_ACTIONS)), 'La accion'),
    result: enumValue(query.resultado, new Set(AUDIT_RESULTS), 'El resultado'),
    actorType: enumValue(query.actor, new Set(ACTOR_TYPES), 'El actor'),
    administratorId: positiveInteger(query.idAdministrador, 'El administrador', { optional: true }),
    entity: codeValue(query.entidad, null, 'La entidad')
  });
}

function buildWhere(filters) {
  const conditions = [];
  const params = [];
  if (filters.storeId !== null) {
    conditions.push('ea.idTienda=?');
    params.push(filters.storeId);
  }
  if (filters.from) {
    conditions.push('ea.creadoEn>=?');
    params.push(`${filters.from} 00:00:00`);
  }
  if (filters.to) {
    conditions.push('ea.creadoEn<DATE_ADD(?, INTERVAL 1 DAY)');
    params.push(`${filters.to} 00:00:00`);
  }
  if (filters.category) {
    conditions.push('ea.categoria=?');
    params.push(filters.category);
  }
  if (filters.action) {
    conditions.push('ea.accion=?');
    params.push(filters.action);
  }
  if (filters.result) {
    conditions.push('ea.resultado=?');
    params.push(filters.result);
  }
  if (filters.actorType) {
    conditions.push('ea.actorTipo=?');
    params.push(filters.actorType);
  }
  if (filters.administratorId) {
    conditions.push('ea.idAdministradorActor=?');
    params.push(filters.administratorId);
  }
  if (filters.entity) {
    conditions.push('ea.entidadTipo=?');
    params.push(filters.entity);
  }
  return {
    sql: conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '',
    params
  };
}

function safeJson(value) {
  if (!value) return null;
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function sanitizedPayload(row) {
  try {
    const normalized = normalizeEvent({
      storeId: row.idTienda,
      actorType: row.actorTipo,
      administratorId: row.idAdministradorActor,
      action: row.accion,
      result: row.resultado,
      resultCode: row.codigoResultado,
      origin: row.origen,
      reference: row.referenciaSegura,
      requestId: row.requestId,
      before: safeJson(row.datosAnteriores),
      after: safeJson(row.datosPosteriores),
      metadata: safeJson(row.metadatos),
      createdAt: row.creadoEn
    });
    return {
      anteriores: normalized.before,
      posteriores: normalized.after,
      metadatos: normalized.metadata
    };
  } catch {
    return { anteriores: null, posteriores: null, metadatos: null };
  }
}

function publicRow(row, { includeStore = false, detail = false } = {}) {
  const item = {
    idEventoAuditoria: Number(row.idEventoAuditoria),
    categoria: row.categoria,
    accion: row.accion,
    resultado: row.resultado,
    codigoResultado: row.codigoResultado,
    actor: {
      tipo: row.actorTipo,
      idAdministrador: row.idAdministradorActor === null
        ? null
        : Number(row.idAdministradorActor)
    },
    origen: row.origen,
    entidad: row.entidadTipo,
    referencia: row.referenciaSegura,
    creadoEn: row.creadoEn
  };
  if (includeStore) item.idTienda = row.idTienda === null ? null : Number(row.idTienda);
  if (detail) Object.assign(item, sanitizedPayload(row));
  return item;
}

function createAdministrativeAuditQueryService({ database = pool } = {}) {
  async function validateStoreFilter(storeId) {
    if (storeId === null) return;
    const [rows] = await database.query(
      'SELECT idTienda FROM tienda WHERE idTienda=? LIMIT 1',
      [storeId]
    );
    if (!rows.length) {
      const error = queryError('La tienda indicada no existe.', 'AUDIT_STORE_NOT_FOUND');
      error.status = 404;
      throw error;
    }
  }

  async function list(query, options = {}) {
    const filters = parseFilters(query, options);
    if (options.allowStoreFilter) await validateStoreFilter(filters.storeId);
    const where = buildWhere(filters);
    const [[countRow], [rows]] = await Promise.all([
      database.query(
        `SELECT COUNT(*) total FROM eventoAuditoriaAdministrativa ea${where.sql}`,
        where.params
      ),
      database.query(
        `SELECT ea.idEventoAuditoria, ea.idTienda, ea.actorTipo, ea.idAdministradorActor,
                ea.categoria, ea.accion, ea.resultado, ea.codigoResultado, ea.origen,
                ea.entidadTipo, ea.referenciaSegura, ea.creadoEn
         FROM eventoAuditoriaAdministrativa ea${where.sql}
         ORDER BY ea.creadoEn DESC, ea.idEventoAuditoria DESC
         LIMIT ? OFFSET ?`,
        [...where.params, filters.pageSize, filters.offset]
      )
    ]);
    const total = Number(countRow[0]?.total ?? countRow.total ?? 0);
    const totalPages = Math.max(1, Math.ceil(total / filters.pageSize));
    return {
      resultados: rows.map((row) => publicRow(row, { includeStore: options.allowStoreFilter })),
      paginacion: {
        page: filters.page,
        pageSize: filters.pageSize,
        total,
        totalPages,
        hasNextPage: filters.page < totalPages,
        hasPreviousPage: filters.page > 1
      },
      filtrosAplicados: {
        fechaDesde: filters.from,
        fechaHasta: filters.to,
        categoria: filters.category,
        accion: filters.action,
        resultado: filters.result,
        actor: filters.actorType,
        idAdministrador: filters.administratorId,
        entidad: filters.entity,
        ...(options.allowStoreFilter ? { idTienda: filters.storeId } : {})
      }
    };
  }

  async function detail(id, options = {}) {
    const eventId = positiveInteger(id, 'El evento');
    const storeId = options.forcedStoreId === null || options.forcedStoreId === undefined
      ? null
      : positiveInteger(options.forcedStoreId, 'La tienda');
    const params = [eventId];
    let storeCondition = '';
    if (storeId !== null) {
      storeCondition = ' AND ea.idTienda=?';
      params.push(storeId);
    }
    const [rows] = await database.query(
      `SELECT ea.*
       FROM eventoAuditoriaAdministrativa ea
       WHERE ea.idEventoAuditoria=?${storeCondition}
       LIMIT 1`,
      params
    );
    if (!rows.length) {
      const error = new Error('El evento de auditoria no existe.');
      error.status = 404;
      error.code = 'AUDIT_EVENT_NOT_FOUND';
      throw error;
    }
    return publicRow(rows[0], { includeStore: options.includeStore, detail: true });
  }

  return Object.freeze({ detail, list, parseFilters });
}

module.exports = {
  MAX_PAGE_SIZE,
  buildWhere,
  createAdministrativeAuditQueryService,
  parseFilters,
  publicRow
};
