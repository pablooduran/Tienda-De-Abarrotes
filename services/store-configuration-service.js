const pool = require('../config/db');
const { normalizeOnboardingPatch, onboardingError } = require('../config/onboarding-contract');
const { administrativeAuditService } = require('./administrative-audit-service');
const { formatLocalDateTime } = require('../utils/local-datetime');

function publicConfiguration(row) {
  return Object.freeze({
    nombreMostrado: row.nombreMostrado,
    moneda: row.moneda,
    zonaHoraria: row.zonaHoraria,
    telefono: row.telefono || null,
    direccion: row.direccion || null,
    datoFiscalBasico: row.datoFiscalBasico || null
  });
}

function positiveId(value, label) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw onboardingError(403, 'CONFIGURATION_ACCESS_DENIED', `${label} no es valido.`);
  }
  return parsed;
}

function auditInput(context, fields) {
  return {
    storeId: context.idTienda,
    actorType: 'administrador',
    administratorId: context.idAdministrador,
    action: 'onboarding_progreso_guardado',
    result: 'correcto',
    resultCode: 'ONBOARDING_PROGRESS_SAVED',
    origin: 'web',
    reference: `tienda:${context.idTienda}`,
    requestId: context.requestId,
    before: { estado: 'completado' },
    after: { estado: 'completado' },
    metadata: { camposModificados: fields }
  };
}

function createStoreConfigurationService({ database = pool, audit = administrativeAuditService, clock = () => formatLocalDateTime() } = {}) {
  function contextFrom(input) {
    return Object.freeze({
      idTienda: positiveId(input?.idTienda, 'La tienda'),
      idAdministrador: positiveId(input?.idAdministrador, 'El administrador'),
      requestId: input?.requestId || null
    });
  }

  async function readAccess(connection, context, { lock = false } = {}) {
    const suffix = lock ? ' FOR UPDATE' : '';
    const [stores] = await connection.query(
      `SELECT idTienda, activo, estado, estadoOnboarding FROM tienda WHERE idTienda=? LIMIT 1${suffix}`,
      [context.idTienda]
    );
    const [administrators] = await connection.query(
      `SELECT idAdministrador, idTienda, rol, activo, estadoAcceso, correoVerificadoEn
       FROM administrador WHERE idAdministrador=? LIMIT 1${suffix}`,
      [context.idAdministrador]
    );
    const store = stores[0];
    const administrator = administrators[0];
    if (!store || !Number(store.activo) || store.estado !== 'activa'
      || !administrator || Number(administrator.idTienda) !== context.idTienda
      || administrator.rol !== 'dueno_tienda' || !Number(administrator.activo)
      || administrator.estadoAcceso !== 'activo' || !administrator.correoVerificadoEn) {
      throw onboardingError(403, 'CONFIGURATION_ACCESS_DENIED', 'No tiene acceso a la configuracion.');
    }
    const [rows] = await connection.query(
      `SELECT nombreMostrado, moneda, zonaHoraria, telefono, direccion, datoFiscalBasico
       FROM configuracionTienda WHERE idTienda=? LIMIT 1${suffix}`,
      [context.idTienda]
    );
    if (!rows[0]) throw onboardingError(409, 'CONFIGURATION_MISSING', 'La configuracion de la tienda no esta disponible.');
    return { store, configuration: rows[0] };
  }

  async function get(input) {
    const context = contextFrom(input);
    const access = await readAccess(database, context);
    return { configuracion: publicConfiguration(access.configuration), onboardingCompletado: access.store.estadoOnboarding === 'completado' };
  }

  async function save(input, body) {
    const context = contextFrom(input);
    const patch = normalizeOnboardingPatch(body);
    let connection;
    try {
      connection = await database.getConnection();
      await connection.beginTransaction();
      const access = await readAccess(connection, context, { lock: true });
      const fields = Object.keys(patch);
      if (!fields.length) throw onboardingError(400, 'CONFIGURATION_INPUT_INVALID', 'No se enviaron campos permitidos.');
      const assignments = fields.map((field) => `${field}=?`).join(', ');
      await connection.query(
        `UPDATE configuracionTienda SET ${assignments}, actualizadoEn=? WHERE idTienda=?`,
        [...fields.map((field) => patch[field]), clock(), context.idTienda]
      );
      await audit.recordCritical(connection, auditInput(context, fields));
      await connection.commit();
      return { configuracion: publicConfiguration({ ...access.configuration, ...patch }), onboardingCompletado: access.store.estadoOnboarding === 'completado' };
    } catch (error) {
      if (connection) await connection.rollback();
      throw error;
    } finally {
      connection?.release?.();
    }
  }

  return Object.freeze({ get, save });
}

const storeConfigurationService = createStoreConfigurationService();
module.exports = { createStoreConfigurationService, storeConfigurationService, publicConfiguration };
