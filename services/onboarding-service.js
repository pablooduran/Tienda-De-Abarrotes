const pool = require('../config/db');
const { formatLocalDateTime } = require('../utils/local-datetime');
const {
  missingRequiredFields,
  normalizeOnboardingPatch,
  onboardingError
} = require('../config/onboarding-contract');
const { administrativeAuditService } = require('./administrative-audit-service');

function positiveId(value, label) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw onboardingError(403, 'ONBOARDING_ACCESS_DENIED', `${label} no es valido.`);
  }
  return parsed;
}

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

function publicState(store, configuration, repeated = false) {
  const missingFields = missingRequiredFields(configuration);
  const completed = store.estadoOnboarding === 'completado';
  const configurationReady = missingFields.length === 0;
  return Object.freeze({
    estado: store.estadoOnboarding,
    completadoEn: store.onboardingCompletadoEn || null,
    configuracion: publicConfiguration(configuration),
    camposFaltantes: missingFields,
    progreso: completed ? 100 : (configurationReady ? 75 : 0),
    siguienteAccion: completed ? 'ir_al_panel' : (configurationReady ? 'completar' : 'guardar'),
    repetida: repeated
  });
}

async function readAccess(connection, idTienda, idAdministrador, { lock = false } = {}) {
  const suffix = lock ? ' FOR UPDATE' : '';
  const [stores] = await connection.query(
    `SELECT idTienda, activo, estado, estadoOnboarding, onboardingCompletadoEn
     FROM tienda WHERE idTienda=? LIMIT 1${suffix}`,
    [idTienda]
  );
  const store = stores[0];
  if (!store || !Number(store.activo) || store.estado !== 'activa') {
    throw onboardingError(403, 'ONBOARDING_ACCESS_DENIED', 'La tienda no esta disponible.');
  }
  const [administrators] = await connection.query(
    `SELECT idAdministrador, idTienda, rol, activo, estadoAcceso, correoVerificadoEn
     FROM administrador WHERE idAdministrador=? LIMIT 1${suffix}`,
    [idAdministrador]
  );
  const administrator = administrators[0];
  if (!administrator || Number(administrator.idTienda) !== idTienda
    || administrator.rol !== 'dueno_tienda' || !Number(administrator.activo)
    || administrator.estadoAcceso !== 'activo' || !administrator.correoVerificadoEn) {
    throw onboardingError(403, 'ONBOARDING_ACCESS_DENIED', 'No tiene acceso al onboarding.');
  }
  const [configurations] = await connection.query(
    `SELECT nombreMostrado, moneda, zonaHoraria, telefono, direccion, datoFiscalBasico
     FROM configuracionTienda WHERE idTienda=? LIMIT 1${suffix}`,
    [idTienda]
  );
  const configuration = configurations[0];
  if (!configuration) throw onboardingError(409, 'ONBOARDING_CONFIGURATION_MISSING', 'La configuracion inicial no esta disponible.');
  return { store, administrator, configuration };
}

function auditInput(context, action, result, resultCode, before, after, metadata) {
  return {
    storeId: context.idTienda,
    actorType: 'administrador',
    administratorId: context.idAdministrador,
    action,
    result,
    resultCode,
    origin: 'web',
    reference: `tienda:${context.idTienda}`,
    requestId: context.requestId,
    before,
    after,
    metadata
  };
}

function createOnboardingService({
  database = pool,
  audit = administrativeAuditService,
  clock = () => formatLocalDateTime()
} = {}) {
  function contextFrom(input) {
    return Object.freeze({
      idTienda: positiveId(input?.idTienda, 'La tienda'),
      idAdministrador: positiveId(input?.idAdministrador, 'El administrador'),
      requestId: input?.requestId || null
    });
  }

  async function get(contextInput) {
    const context = contextFrom(contextInput);
    const access = await readAccess(database, context.idTienda, context.idAdministrador);
    return publicState(access.store, access.configuration);
  }

  async function save(contextInput, body) {
    const context = contextFrom(contextInput);
    const patch = normalizeOnboardingPatch(body);
    let connection;
    try {
      connection = await database.getConnection();
      await connection.beginTransaction();
      const access = await readAccess(connection, context.idTienda, context.idAdministrador, { lock: true });
      if (access.store.estadoOnboarding === 'completado') {
        throw onboardingError(409, 'ONBOARDING_ALREADY_COMPLETED', 'El onboarding ya fue completado.');
      }
      const fields = Object.keys(patch);
      const assignments = fields.map((field) => `${field}=?`).join(', ');
      const now = clock();
      await connection.query(
        `UPDATE configuracionTienda SET ${assignments}, actualizadoEn=? WHERE idTienda=?`,
        [...fields.map((field) => patch[field]), now, context.idTienda]
      );
      const started = access.store.estadoOnboarding === 'pendiente';
      const nextState = started ? 'en_progreso' : access.store.estadoOnboarding;
      if (started) {
        await connection.query(
          `UPDATE tienda SET estadoOnboarding='en_progreso', actualizadoEn=?
           WHERE idTienda=? AND estadoOnboarding='pendiente'`,
          [now, context.idTienda]
        );
        await audit.recordCritical(connection, auditInput(
          context, 'onboarding_iniciado', 'correcto', 'ONBOARDING_STARTED',
          { estado: 'pendiente' }, { estado: 'en_progreso' }, { camposModificados: fields }
        ));
      }
      await audit.recordCritical(connection, auditInput(
        context, 'onboarding_progreso_guardado', 'correcto', 'ONBOARDING_PROGRESS_SAVED',
        { estado: access.store.estadoOnboarding }, { estado: nextState }, { camposModificados: fields }
      ));
      const configuration = { ...access.configuration, ...patch };
      const state = publicState({ ...access.store, estadoOnboarding: nextState }, configuration);
      await connection.commit();
      return state;
    } catch (error) {
      if (connection) await connection.rollback();
      const controlled = Number(error?.status || 500) < 500;
      await audit.recordOutcome(auditInput(
        context,
        'onboarding_rechazado',
        controlled ? 'rechazado' : 'fallido',
        controlled ? 'ONBOARDING_REJECTED' : 'ONBOARDING_FAILED',
        null,
        null,
        null
      ));
      throw error;
    } finally {
      connection?.release?.();
    }
  }

  async function complete(contextInput) {
    const context = contextFrom(contextInput);
    let connection;
    try {
      connection = await database.getConnection();
      await connection.beginTransaction();
      const access = await readAccess(connection, context.idTienda, context.idAdministrador, { lock: true });
      if (access.store.estadoOnboarding === 'completado') {
        await connection.commit();
        return publicState(access.store, access.configuration, true);
      }
      if (access.store.estadoOnboarding !== 'en_progreso') {
        throw onboardingError(409, 'ONBOARDING_PROGRESS_REQUIRED', 'Guarde la configuracion antes de completar el onboarding.');
      }
      const missingFields = missingRequiredFields(access.configuration);
      if (missingFields.length) {
        throw onboardingError(400, 'ONBOARDING_REQUIRED_FIELDS_MISSING', 'Complete los campos obligatorios antes de continuar.');
      }
      const now = clock();
      await connection.query(
        `UPDATE tienda
         SET estadoOnboarding='completado', onboardingCompletadoEn=?, actualizadoEn=?
         WHERE idTienda=? AND estadoOnboarding='en_progreso'`,
        [now, now, context.idTienda]
      );
      await audit.recordCritical(connection, auditInput(
        context, 'onboarding_completado', 'correcto', 'ONBOARDING_COMPLETED',
        { estado: 'en_progreso' }, { estado: 'completado' }, { camposModificados: [] }
      ));
      const state = publicState({
        ...access.store,
        estadoOnboarding: 'completado',
        onboardingCompletadoEn: now
      }, access.configuration);
      await connection.commit();
      return state;
    } catch (error) {
      if (connection) await connection.rollback();
      const controlled = Number(error?.status || 500) < 500;
      await audit.recordOutcome(auditInput(
        context,
        'onboarding_rechazado',
        controlled ? 'rechazado' : 'fallido',
        controlled ? 'ONBOARDING_REJECTED' : 'ONBOARDING_FAILED',
        null,
        null,
        null
      ));
      throw error;
    } finally {
      connection?.release?.();
    }
  }

  return Object.freeze({ complete, get, save });
}

const onboardingService = createOnboardingService();

module.exports = { createOnboardingService, onboardingService, publicState };
