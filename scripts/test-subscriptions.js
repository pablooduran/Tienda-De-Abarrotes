const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { createDatabaseConnection } = require('../config/database-connection');
const { requireLocalhostDatabase } = require('../config/env');
const { addLocalDays, formatLocalDateTime, getLocalNow, parseLocalDateTime } = require('../utils/local-datetime');
const { applyTestRequestSecurity } = require('./http-test-security');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

let capturedAuditRequestIds = null;

class HttpSession {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
    this.cookie = '';
    this.diagnosticContext = null;
  }

  async request(path, options = {}) {
    const request = { ...options, headers: { ...(options.headers || {}) } };
    if (request.body && typeof request.body !== 'string') {
      request.headers['content-type'] = 'application/json';
      request.body = JSON.stringify(request.body);
    }
    applyTestRequestSecurity(this.baseUrl, request);
    if (this.cookie) request.headers.cookie = this.cookie;
    const response = await fetch(`${this.baseUrl}${path}`, { ...request, redirect: 'manual' });
    const requestId = response.headers.get('x-request-id');
    if (capturedAuditRequestIds && requestId) capturedAuditRequestIds.add(requestId);
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) this.cookie = setCookie.split(';')[0];
    const text = await response.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = text; }
    return { status: response.status, body };
  }
}

async function expect(session, path, options, status, label) {
  const response = await session.request(path, options);
  if (response.status !== status) {
    throw new Error(`${label}: diagnostico seguro:\n${JSON.stringify({
      metodo: options?.method || 'GET',
      ruta: path,
      statusEsperado: status,
      statusRecibido: response.status,
      respuesta: safeDiagnosticValue(response.body),
      contextoTienda: safeDiagnosticValue(session.diagnosticContext)
    }, null, 2)}`);
  }
  return response.body;
}

function safeDiagnosticValue(value) {
  if (Array.isArray(value)) return value.map(safeDiagnosticValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !/(password|contrasena|cookie|session|token|secret|hash)/i.test(key))
    .map(([key, item]) => [key, safeDiagnosticValue(item)]));
}

function subscriptionSnapshot(context) {
  return {
    tiendaSlug: context?.tienda?.slug ?? null,
    planCodigo: context?.plan?.codigo ?? null,
    estado: context?.suscripcion?.estado ?? null,
    estadoEfectivo: context?.suscripcion?.estadoEfectivo ?? null,
    fechaInicio: context?.suscripcion?.fechaInicio ?? null,
    fechaFin: context?.suscripcion?.fechaFin ?? null,
    soloLectura: context?.soloLectura ?? null
  };
}

async function expectWithSubscriptionDiagnostic(session, path, options, status, label, subscriptionStates) {
  const response = await session.request(path, options);
  if (response.status !== status) {
    throw new Error(`${label}: diagnostico seguro:\n${JSON.stringify({
      metodo: options?.method || 'GET',
      ruta: path,
      statusEsperado: status,
      statusRecibido: response.status,
      respuesta: safeDiagnosticValue(response.body),
      suscripcionAntesDeRenovar: subscriptionSnapshot(subscriptionStates.before),
      suscripcionDespuesDeRenovar: subscriptionSnapshot(subscriptionStates.after)
    }, null, 2)}`);
  }
  return response.body;
}

function containsPassword(value) {
  if (Array.isArray(value)) return value.some(containsPassword);
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(([key, item]) => (
    ['password', 'passwordHash', 'hash'].includes(key) || containsPassword(item)
  ));
}

function assertUniformLoginRejection(body, referenceBody, forbiddenValues = []) {
  assert(body?.code === 'INVALID_CREDENTIALS', 'El login de tienda inactiva no devolvio INVALID_CREDENTIALS.');
  assert(body?.error === 'Credenciales incorrectas.', 'El login de tienda inactiva expuso un mensaje diferente.');
  assert(body.error === referenceBody.error && body.code === referenceBody.code,
    'El login de tienda inactiva no coincide con una contrasena incorrecta.');
  const unexpectedKeys = Object.keys(body || {}).filter((key) => !['error', 'code', 'requestId'].includes(key));
  assert(unexpectedKeys.length === 0, `El login expuso campos internos: ${unexpectedKeys.join(', ')}.`);
  const serialized = JSON.stringify({ error: body?.error, code: body?.code }).toLowerCase();
  for (const value of forbiddenValues.filter(Boolean)) {
    assert(!serialized.includes(String(value).toLowerCase()), `El login expuso informacion sobre ${value}.`);
  }
}

const BASIC_REQUIRED_FEATURES = Object.freeze([
  'gastos',
  'reportes_financieros',
  'dashboard_financiero',
  'inventario_resumen',
  'alertas_stock',
  'ranking_productos',
  'valor_inventario_basico',
  'clientes_basico',
  'fiados_basico',
  'pagos_fiado',
  'estado_cuenta_basico'
]);

const ADVANCED_ONLY_FEATURES = Object.freeze([
  'reportes_avanzados',
  'exportacion_reportes',
  'compras_sugeridas',
  'recordatorios_fiado',
  'cierre_caja',
  'rentabilidad_producto',
  'rotacion_inventario',
  'dias_cobertura',
  'inventario_sin_movimiento',
  'exportacion_inventario',
  'limites_credito',
  'seguimiento_cobranza',
  'segmentacion_clientes',
  'exportacion_clientes_fiados',
  'vencimientos_lote',
  'portal_clientes'
]);

async function resolveSubscriptionTestPlans(connection, apiPlans) {
  const [rows] = await connection.query(
    `SELECT p.idPlan, f.codigo funcionalidad
     FROM plan p
     JOIN planFuncionalidad pf ON pf.idPlan=p.idPlan AND pf.habilitada=1
     JOIN funcionalidad f ON f.idFuncionalidad=pf.idFuncionalidad AND f.activo=1
     WHERE p.activo=1`
  );
  const features = new Map();
  for (const row of rows) {
    const idPlan = Number(row.idPlan);
    if (!features.has(idPlan)) features.set(idPlan, new Set());
    features.get(idPlan).add(row.funcionalidad);
  }
  const activePlans = apiPlans.filter((plan) => Number(plan.activo) === 1).map((plan) => ({
    ...plan,
    idPlan: Number(plan.idPlan),
    funcionalidades: features.get(Number(plan.idPlan)) || new Set()
  }));
  const basic = activePlans.find((plan) =>
    BASIC_REQUIRED_FEATURES.every((feature) => plan.funcionalidades.has(feature))
      && ADVANCED_ONLY_FEATURES.every((feature) => !plan.funcionalidades.has(feature))
  );
  const advanced = activePlans.find((plan) =>
    BASIC_REQUIRED_FEATURES.every((feature) => plan.funcionalidades.has(feature))
      && ADVANCED_ONLY_FEATURES.every((feature) => plan.funcionalidades.has(feature))
  );
  assert(basic, 'No existe un plan activo con las funciones basicas esperadas.');
  assert(advanced, 'No existe un plan activo con las funciones avanzadas esperadas.');
  return { basic, advanced };
}

function basicContextComparison(context, expectedSlug, expectedPlanCode) {
  const limits = context?.limites || {};
  const features = Array.isArray(context?.caracteristicas) ? context.caracteristicas : [];
  const start = context?.suscripcion?.fechaInicio ? parseLocalDateTime(context.suscripcion.fechaInicio) : null;
  const end = context?.suscripcion?.fechaFin ? parseLocalDateTime(context.suscripcion.fechaFin) : null;
  const validDates = Boolean(start && end
    && !Number.isNaN(start.getTime())
    && !Number.isNaN(end.getTime())
    && start < end);
  const fields = {
    tienda: context?.tienda?.slug === expectedSlug,
    plan: context?.plan?.codigo === expectedPlanCode,
    estadoEfectivo: context?.suscripcion?.estadoEfectivo === 'activa',
    soloLectura: context?.soloLectura === false,
    limitePropietarios: limits.propietarios === 1,
    limiteProductos: limits.productos === 500,
    limiteClientes: limits.clientes === 25,
    limiteProveedores: limits.proveedores === 15,
    funcionesBasicasPresentes: BASIC_REQUIRED_FEATURES.every((code) => features.includes(code)),
    sinFuncionesExclusivasAvanzado: !features.some((code) => ADVANCED_ONLY_FEATURES.includes(code)),
    fechasValidas: validDates
  };
  return {
    valid: Object.values(fields).every(Boolean),
    fields,
    expected: {
      tiendaSlug: expectedSlug,
      planCodigo: expectedPlanCode,
      estadoEfectivo: 'activa',
      soloLectura: false,
      limites: { propietarios: 1, productos: 500, clientes: 25, proveedores: 15 },
      funcionesRequeridasBasico: BASIC_REQUIRED_FEATURES,
      funcionesExclusivasAvanzado: [],
      fechasValidas: true
    },
    received: {
      tiendaSlug: context?.tienda?.slug ?? null,
      planCodigo: context?.plan?.codigo ?? null,
      estadoSuscripcion: context?.suscripcion?.estado ?? null,
      estadoEfectivo: context?.suscripcion?.estadoEfectivo ?? null,
      soloLectura: context?.soloLectura ?? null,
      limites: {
        propietarios: limits.propietarios ?? null,
        productos: limits.productos ?? null,
        clientes: limits.clientes ?? null,
        proveedores: limits.proveedores ?? null
      },
      funcionesRequeridasBasicoPresentes: features.filter((code) => BASIC_REQUIRED_FEATURES.includes(code)),
      funcionesExclusivasAvanzadoPresentes: features.filter((code) => ADVANCED_ONLY_FEATURES.includes(code)),
      fechaInicio: context?.suscripcion?.fechaInicio ?? null,
      fechaFin: context?.suscripcion?.fechaFin ?? null
    }
  };
}

function assertBasicContext(context, expectedSlug, expectedPlanCode) {
  const comparison = basicContextComparison(context, expectedSlug, expectedPlanCode);
  if (!comparison.valid) {
    throw new Error(`El contexto basico es incorrecto. Comparacion segura:\n${JSON.stringify({
      camposComparados: comparison.fields,
      esperado: comparison.expected,
      recibido: comparison.received
    }, null, 2)}`);
  }
}

function storePayload(marker, suffix, planCodigo, tipo, duration = 30) {
  const password = `Owner-${suffix}-${crypto.randomBytes(10).toString('hex')}!`;
  return {
    password,
    body: {
      nombre: `Tienda suscripcion ${suffix} ${marker}`,
      slug: `tienda-sus-${suffix}-${marker}`,
      estado: 'activa',
      activo: true,
      propietario: {
        usuario: `owner_sus_${suffix}_${marker}`,
        password,
        confirmacionPassword: password,
        activo: true
      },
      suscripcion: { planCodigo, tipo, duracionDias: duration }
    }
  };
}

async function bulkInsert(connection, table, columns, rows) {
  if (!rows.length) return;
  const placeholders = rows.map(() => `(${columns.map(() => '?').join(',')})`).join(',');
  await connection.query(
    `INSERT INTO ${table} (${columns.join(',')}) VALUES ${placeholders}`,
    rows.flat()
  );
}

async function cleanupStore(connection, idTienda) {
  await connection.query('DELETE FROM cierreCaja WHERE idTienda=?', [idTienda]);
  await connection.query('DELETE FROM gasto WHERE idTienda=?', [idTienda]);
  await connection.query('DELETE FROM categoriaGasto WHERE idTienda=?', [idTienda]);
  await connection.query('DELETE FROM movimientoStock WHERE idTienda=?', [idTienda]);
  await connection.query('DELETE FROM seguimientoCobranza WHERE idTienda=?', [idTienda]);
  await connection.query('DELETE FROM pagoVenta WHERE idTienda=?', [idTienda]);
  await connection.query('DELETE FROM pagoFiado WHERE idTienda=?', [idTienda]);
  await connection.query('DELETE FROM cobroFiado WHERE idTienda=?', [idTienda]);
  await connection.query('DELETE FROM detalleFiado WHERE idTienda=?', [idTienda]);
  await connection.query('DELETE FROM detalleVenta WHERE idTienda=?', [idTienda]);
  await connection.query('DELETE FROM detalleCompra WHERE idTienda=?', [idTienda]);
  await connection.query('DELETE FROM fiado WHERE idTienda=?', [idTienda]);
  await connection.query('DELETE FROM venta WHERE idTienda=?', [idTienda]);
  await connection.query('DELETE FROM compra WHERE idTienda=?', [idTienda]);
  await connection.query('DELETE FROM producto WHERE idTienda=?', [idTienda]);
  await connection.query('DELETE FROM cliente WHERE idTienda=?', [idTienda]);
  await connection.query('DELETE FROM proveedor WHERE idTienda=?', [idTienda]);
  await connection.query('DELETE FROM plantillaCobranzaTienda WHERE idTienda=?', [idTienda]);
  await connection.query('DELETE FROM configuracionCreditoTienda WHERE idTienda=?', [idTienda]);
  await connection.query('DELETE FROM configuracionInventarioTienda WHERE idTienda=?', [idTienda]);
  await connection.query('DELETE FROM configuracionTienda WHERE idTienda=?', [idTienda]);
  await connection.query('DELETE FROM operacionSuscripcionTienda WHERE idTienda=?', [idTienda]);
  await connection.query('DELETE FROM historialSuscripcionTienda WHERE idTienda=?', [idTienda]);
  await connection.query('DELETE FROM suscripcionFuncionalidadSnapshot WHERE idTienda=?', [idTienda]);
  await connection.query('DELETE FROM suscripcionTienda WHERE idTienda=?', [idTienda]);
  await connection.query('DELETE FROM administrador WHERE idTienda=?', [idTienda]);
  await connection.query('DELETE FROM tienda WHERE idTienda=?', [idTienda]);
}

async function deleteFixtureAudit(connection, { storeIds = [], administratorIds = [], requestIds = [] } = {}) {
  const predicates = [];
  const parameters = [];
  if (storeIds.length) {
    predicates.push('idTienda IN (?)');
    parameters.push(storeIds);
  }
  if (administratorIds.length) {
    predicates.push('idAdministradorActor IN (?)');
    parameters.push(administratorIds);
  }
  if (requestIds.length) {
    predicates.push('requestId IN (?)');
    parameters.push(requestIds);
  }
  if (!predicates.length) return;
  await connection.query(
    `DELETE FROM eventoAuditoriaAdministrativa WHERE ${predicates.join(' OR ')}`,
    parameters
  );
}

async function cleanup(connection, fixture) {
  if (!connection) return;
  await connection.beginTransaction();
  try {
    const [stores] = await connection.query(
      `SELECT idTienda FROM tienda
     WHERE slug LIKE ? OR slug IN (?, ?)`,
      [`tienda-sus-%-${fixture.marker}`, fixture.invalidPlanSlug, fixture.inactivePlanSlug]
    );
    const storeIds = stores.map((store) => Number(store.idTienda));
    const [administrators] = await connection.query(
      `SELECT idAdministrador FROM administrador
       WHERE usuario=? OR idTienda IN (?)`,
      [fixture.superUser, storeIds.length ? storeIds : [0]]
    );
    await deleteFixtureAudit(connection, {
      storeIds,
      administratorIds: administrators.map((row) => Number(row.idAdministrador)),
      requestIds: [...(capturedAuditRequestIds || [])]
    });
    for (const store of stores) await cleanupStore(connection, store.idTienda);
    if (fixture.inactivePlanCode) {
      await connection.query('DELETE FROM plan WHERE codigo=?', [fixture.inactivePlanCode]);
    }
    if (fixture.superUser) {
      await connection.query('DELETE FROM administrador WHERE usuario=?', [fixture.superUser]);
    }
    await connection.commit();
  } catch (error) {
    try { await connection.rollback(); } catch { /* La conexion puede estar cerrada. */ }
    throw error;
  }
}

async function main() {
  const config = { ...requireLocalhostDatabase('La prueba de planes y suscripciones'), decimalNumbers: true };
  if (!/(prueba|test)/i.test(config.database)) {
    throw new Error('La prueba solo puede ejecutarse sobre una base cuyo nombre contenga prueba o test.');
  }

  const baseUrl = process.env.TEST_BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
  const marker = crypto.randomBytes(6).toString('hex');
  const fixture = {
    marker,
    superUser: `super_sus_test_${marker}`,
    inactivePlanCode: `plan_inactivo_${marker}`,
    invalidPlanSlug: `tienda-plan-invalido-${marker}`,
    inactivePlanSlug: `tienda-plan-inactivo-${marker}`
  };
  const superPassword = `Super-${crypto.randomBytes(12).toString('hex')}!`;
  const sessions = [];
  capturedAuditRequestIds = new Set();
  let connection;

  try {
    connection = await createDatabaseConnection(config);
    const [[migration]] = await connection.query(
      "SELECT COUNT(*) total FROM schema_migrations WHERE nombre='005_planes_suscripciones.sql'"
    );
    assert(Number(migration.total) === 1, 'La migracion 005 debe estar aplicada antes de ejecutar esta prueba.');

    const superHash = await bcrypt.hash(superPassword, 12);
    await connection.query(
      "INSERT INTO administrador (idTienda, usuario, password, rol, activo) VALUES (NULL, ?, ?, 'superadmin', 1)",
      [fixture.superUser, superHash]
    );
    await connection.query(
      `INSERT INTO plan
       (codigo, nombre, descripcion, activo, precioMensual, duracionDias, limitePropietarios, limiteProductos, limiteClientes, limiteProveedores)
       VALUES (?, 'Plan inactivo de prueba', 'Solo para prueba local', 0, 0, 30, 1, 1, 1, 1)`,
      [fixture.inactivePlanCode]
    );

    const superSession = new HttpSession(baseUrl);
    const advancedContextSession = new HttpSession(baseUrl);
    sessions.push(superSession, advancedContextSession);
    await expect(superSession, '/auth/login', {
      method: 'POST', body: { usuario: fixture.superUser, password: superPassword }
    }, 200, 'Login superadmin');

    const plans = await expect(superSession, '/api/admin/planes', {}, 200, 'Listado de planes');
    const resolvedPlans = await resolveSubscriptionTestPlans(connection, plans);
    assert(!containsPassword(plans), 'El listado de planes expuso una contrasena.');

    const invalidPayload = storePayload(marker, 'invalid', 'no_existe', 'pagada');
    invalidPayload.body.slug = fixture.invalidPlanSlug;
    await expect(superSession, '/api/admin/tiendas', { method: 'POST', body: invalidPayload.body }, 400, 'Plan inexistente');
    const inactivePayload = storePayload(marker, 'inactive', fixture.inactivePlanCode, 'pagada');
    inactivePayload.body.slug = fixture.inactivePlanSlug;
    await expect(superSession, '/api/admin/tiendas', { method: 'POST', body: inactivePayload.body }, 409, 'Plan inactivo');

    const basic = storePayload(marker, 'basic', resolvedPlans.basic.codigo, 'pagada');
    const advanced = storePayload(marker, 'advanced', resolvedPlans.advanced.codigo, 'cortesia');
    const trial = storePayload(marker, 'trial', resolvedPlans.basic.codigo, 'prueba', 14);
    const basicCreated = await expect(superSession, '/api/admin/tiendas', { method: 'POST', body: basic.body }, 201, 'Tienda basica');
    const advancedCreated = await expect(superSession, '/api/admin/tiendas', { method: 'POST', body: advanced.body }, 201, 'Tienda avanzada');
    const trialCreated = await expect(superSession, '/api/admin/tiendas', { method: 'POST', body: trial.body }, 201, 'Tienda de prueba');
    assert(basicCreated.suscripcion.planCodigo === resolvedPlans.basic.codigo, 'La tienda basica recibio un plan incorrecto.');
    assert(advancedCreated.suscripcion.planCodigo === resolvedPlans.advanced.codigo, 'La tienda avanzada recibio un plan incorrecto.');
    assert(trialCreated.suscripcion.tipo === 'prueba', 'La prueba gratuita no se registro como tipo prueba.');
    assert(!containsPassword([basicCreated, advancedCreated, trialCreated]), 'La creacion de tienda expuso una contrasena.');

    fixture.basicStore = basicCreated.tienda.idTienda;
    fixture.basicOwner = basicCreated.propietario.idAdministrador;
    const trialDays = (parseLocalDateTime(trialCreated.suscripcion.fechaFin)
      - parseLocalDateTime(trialCreated.suscripcion.fechaInicio)) / 86400000;
    assert(Math.abs(trialDays - 14) < 0.01, 'La prueba gratuita no tiene 14 dias.');

    const [[transactional]] = await connection.query(
      `SELECT
        (SELECT COUNT(*) FROM tienda WHERE idTienda=?) tiendas,
        (SELECT COUNT(*) FROM administrador WHERE idTienda=?) propietarios,
        (SELECT COUNT(*) FROM suscripcionTienda WHERE idTienda=?) suscripciones`,
      [fixture.basicStore, fixture.basicStore, fixture.basicStore]
    );
    assert(Number(transactional.tiendas) === 1 && Number(transactional.propietarios) === 1
      && Number(transactional.suscripciones) === 1, 'La creacion transaccional quedo incompleta.');

    const duplicate = storePayload(marker, 'duplicate', resolvedPlans.basic.codigo, 'pagada');
    duplicate.body.propietario.usuario = basic.body.propietario.usuario;
    await expect(superSession, '/api/admin/tiendas', { method: 'POST', body: duplicate.body }, 409, 'Rollback por usuario duplicado');
    const [[orphan]] = await connection.query('SELECT COUNT(*) total FROM tienda WHERE slug=?', [duplicate.body.slug]);
    assert(Number(orphan.total) === 0, 'El rollback dejo una tienda huerfana.');

    advancedContextSession.diagnosticContext = {
      tiendaActiva: advancedCreated.tienda,
      plan: advancedCreated.suscripcion.planCodigo,
      estadoSuscripcion: advancedCreated.suscripcion.estado
    };
    await expect(advancedContextSession, '/auth/login', {
      method: 'POST', body: { usuario: advanced.body.propietario.usuario, password: advanced.password }
    }, 200, 'Login tienda avanzada temporal');
    const advancedContext = await expect(advancedContextSession, '/api/contexto', {}, 200, 'Contexto tienda avanzada temporal');
    assert(advancedContext.soloLectura === false, 'La tienda avanzada temporal perdio acceso de escritura.');
    assert(advancedContext.plan?.codigo === resolvedPlans.advanced.codigo, 'La tienda temporal no conserva el plan avanzado seleccionado.');
    const missingAdvancedFeatures = ADVANCED_ONLY_FEATURES
      .filter((code) => !advancedContext.caracteristicas?.includes(code));
    assert(missingAdvancedFeatures.length === 0,
      `El plan avanzado no incluye todas sus funciones exclusivas: ${JSON.stringify(missingAdvancedFeatures)}.`);

    const basicSession = new HttpSession(baseUrl);
    sessions.push(basicSession);
    basicSession.diagnosticContext = {
      tiendaActiva: basicCreated.tienda,
      plan: basicCreated.suscripcion.planCodigo,
      estadoSuscripcion: basicCreated.suscripcion.estado
    };
    await expect(basicSession, '/auth/login', {
      method: 'POST', body: { usuario: basic.body.propietario.usuario, password: basic.password }
    }, 200, 'Login tienda basica');
    const uniformLoginSession = new HttpSession(baseUrl);
    sessions.push(uniformLoginSession);
    const wrongPasswordLogin = await expect(uniformLoginSession, '/auth/login', {
      method: 'POST', body: { usuario: basic.body.propietario.usuario, password: `${basic.password}-incorrecta` }
    }, 401, 'Contrasena incorrecta antes de desactivar tienda');
    assert(wrongPasswordLogin.code === 'INVALID_CREDENTIALS'
      && wrongPasswordLogin.error === 'Credenciales incorrectas.',
    'La contrasena incorrecta no usa el contrato uniforme de login.');
    const context = await expect(basicSession, '/api/contexto', {}, 200, 'Contexto tienda basica');
    assertBasicContext(context, basic.body.slug, resolvedPlans.basic.codigo);
    assert(!Object.prototype.hasOwnProperty.call(context.plan, 'precioMensual'), 'El contexto expuso el precio interno.');
    assert(!Object.prototype.hasOwnProperty.call(context.suscripcion, 'observacion'), 'El contexto expuso una observacion administrativa.');
    await expect(basicSession, '/api/admin/planes', {}, 403, 'Dueno bloqueado de administracion');
    await expect(basicSession, `/api/admin/tiendas/${fixture.basicStore}/suscripciones`, {
      method: 'POST', body: { planCodigo: resolvedPlans.advanced.codigo, tipo: 'pagada', duracionDias: 30 }
    }, 403, 'Dueno no modifica su plan');

    await expect(superSession, `/api/admin/tiendas/${fixture.basicStore}/propietarios`, {
      method: 'POST',
      body: {
        usuario: `segundo_owner_${marker}`,
        password: `Second-${crypto.randomBytes(12).toString('hex')}!`,
        confirmacionPassword: `no-coincide-${marker}`,
        activo: true
      }
    }, 400, 'Validacion previa de segundo propietario');
    const secondPassword = `Second-${crypto.randomBytes(12).toString('hex')}!`;
    await expect(superSession, `/api/admin/tiendas/${fixture.basicStore}/propietarios`, {
      method: 'POST',
      body: { usuario: `segundo_owner_${marker}`, password: secondPassword, confirmacionPassword: secondPassword, activo: true }
    }, 409, 'Limite de propietarios basico');

    const fechaInicioSeguimiento = formatLocalDateTime();
    const productRows = Array.from(
      { length: 500 },
      (_, index) => [
        fixture.basicStore, `Producto limite ${marker} ${index}`, 1, 1, 0, 1,
        fechaInicioSeguimiento
      ]
    );
    const clientRows = Array.from(
      { length: 500 },
      (_, index) => [fixture.basicStore, `Cliente limite ${marker} ${index}`, 1, fechaInicioSeguimiento, fechaInicioSeguimiento]
    );
    const providerRows = Array.from({ length: 100 }, (_, index) => [fixture.basicStore, `Proveedor limite ${marker} ${index}`]);
    await bulkInsert(
      connection,
      'producto',
      ['idTienda', 'nombre', 'precioVenta', 'unidadesPorPaquete', 'permiteVentaPorPaquete',
        'permiteVentaPorUnidad', 'fechaInicioSeguimiento'],
      productRows
    );
    await bulkInsert(connection, 'cliente', ['idTienda', 'nombre', 'activo', 'creadoEn', 'actualizadoEn'], clientRows);
    await bulkInsert(connection, 'proveedor', ['idTienda', 'nombre'], providerRows);
    const [hiddenClient] = await connection.query(
      `INSERT INTO cliente (idTienda, nombre, activo, eliminadoEn, creadoEn, actualizadoEn)
       VALUES (?, ?, 0, ?, ?, ?)`,
      [fixture.basicStore, `Cliente oculto ${marker}`, fechaInicioSeguimiento,
        fechaInicioSeguimiento, fechaInicioSeguimiento]
    );

    await expect(basicSession, '/api/productos', {
      method: 'POST',
      body: {
        nombre: `Producto extra ${marker}`, categoria: 'OTROS', unidadMedida: 'unidad', unidadesPorPaquete: 1,
        paquetesPorCaja: 1, precioVenta: 2, stockMinimo: 1, stockUnidadesTotal: 0,
        permiteVentaPorPaquete: false, permiteVentaPorUnidad: true
      }
    }, 409, 'Limite de productos');
    await expect(basicSession, '/api/clientes', {
      method: 'POST', body: { nombre: `Cliente extra ${marker}`, telefono: '70000001' }
    }, 409, 'Limite de clientes');
    await expect(basicSession, '/api/proveedores', {
      method: 'POST', body: { nombre: `Proveedor extra ${marker}`, telefono: '70000002' }
    }, 409, 'Limite de proveedores');
    await expect(basicSession, `/api/clientes/${hiddenClient.insertId}/restaurar`, {
      method: 'PATCH', body: { passwordAdministrador: basic.password }
    }, 409, 'Restauracion respeta limite');

    const [[firstProduct]] = await connection.query(
      'SELECT * FROM producto WHERE idTienda=? ORDER BY idProducto LIMIT 1',
      [fixture.basicStore]
    );
    const updateProduct = {
      nombre: firstProduct.nombre,
      idProveedor: firstProduct.idProveedor,
      categoria: firstProduct.categoria,
      unidadMedida: firstProduct.unidadMedida,
      unidadesPorPaquete: firstProduct.unidadesPorPaquete,
      paquetesPorCaja: firstProduct.paquetesPorCaja,
      precioVenta: firstProduct.precioVenta,
      stockMinimo: firstProduct.stockMinimo,
      stockUnidadesTotal: firstProduct.stockUnidadesTotal,
      ultimoPrecioCompra: firstProduct.ultimoPrecioCompra,
      permiteVentaPorPaquete: Boolean(firstProduct.permiteVentaPorPaquete),
      permiteVentaPorUnidad: Boolean(firstProduct.permiteVentaPorUnidad)
    };

    const expirationReference = getLocalNow();
    await connection.query(
      `UPDATE suscripcionTienda SET estado='activa', fechaInicio=?, fechaFin=?
       WHERE idSuscripcion=?`,
      [formatLocalDateTime(addLocalDays(expirationReference, -30)),
        formatLocalDateTime(addLocalDays(expirationReference, -1)), basicCreated.suscripcion.idSuscripcion]
    );
    const contextBeforeRenewal = await expect(
      basicSession, '/api/contexto', {}, 200, 'Contexto antes de renovar'
    );
    assert(
      contextBeforeRenewal.suscripcion?.estadoEfectivo === 'gracia' && contextBeforeRenewal.soloLectura === true,
      `El contexto de gracia es incorrecto: ${JSON.stringify(subscriptionSnapshot(contextBeforeRenewal))}`
    );
    await expect(basicSession, '/api/productos', {}, 200, 'Lectura con suscripcion en gracia');
    await expect(basicSession, `/api/productos/${firstProduct.idProducto}`, {
      method: 'PUT', body: updateProduct
    }, 403, 'Escritura bloqueada por vencimiento');

    const renewed = await expect(superSession, `/api/admin/tiendas/${fixture.basicStore}/suscripciones`, {
      method: 'POST', body: { planCodigo: resolvedPlans.basic.codigo, tipo: 'pagada', duracionDias: 30, observacion: 'Renovacion de prueba' }
    }, 201, 'Renovacion manual');
    const contextAfterRenewal = await expect(
      basicSession, '/api/contexto', {}, 200, 'Contexto despues de renovar'
    );
    assert(
      contextAfterRenewal.suscripcion?.estadoEfectivo === 'activa' && contextAfterRenewal.soloLectura === false,
      `La renovacion no reactivo la suscripcion: ${JSON.stringify(subscriptionSnapshot(contextAfterRenewal))}`
    );
    await expectWithSubscriptionDiagnostic(basicSession, `/api/productos/${firstProduct.idProducto}`, {
      method: 'PUT', body: updateProduct
    }, 200, 'Renovacion reactiva escrituras', {
      before: contextBeforeRenewal,
      after: contextAfterRenewal
    });

    await expect(superSession, `/api/admin/suscripciones/${renewed.suscripcion.idSuscripcion}/suspender`, {
      method: 'PATCH'
    }, 200, 'Suspension de suscripcion');
    await expect(basicSession, '/api/productos', {}, 200, 'Lectura permitida en modo solo lectura suspendido');
    await expect(basicSession, `/api/productos/${firstProduct.idProducto}`, {
      method: 'PUT', body: updateProduct
    }, 403, 'Escritura bloqueada por suspension');

    await expect(superSession, `/api/admin/tiendas/${fixture.basicStore}/suscripciones`, {
      method: 'POST', body: { planCodigo: resolvedPlans.advanced.codigo, tipo: 'pagada', duracionDias: 30, observacion: 'Cambio a avanzado' }
    }, 201, 'Cambio de plan y reactivacion');
    await expect(basicSession, `/api/productos/${firstProduct.idProducto}`, {
      method: 'PUT', body: updateProduct
    }, 200, 'Plan avanzado permite escritura');
    const history = await expect(
      superSession, `/api/admin/tiendas/${fixture.basicStore}/suscripciones`, {}, 200, 'Historial de suscripciones'
    );
    assert(history.length >= 3, 'El cambio de plan no conservo el historial.');

    await expect(superSession, `/api/admin/tiendas/${fixture.basicStore}/desactivar`, {
      method: 'PATCH', body: { estado: 'inactiva' }
    }, 200, 'Desactivacion administrativa');
    const revokedStoreSession = await expect(
      basicSession, '/api/productos', {}, 403, 'Sesion existente bloqueada por tienda inactiva'
    );
    assert(revokedStoreSession.code === 'STORE_UNAVAILABLE', 'La tienda inactiva no devolvio STORE_UNAVAILABLE.');
    const inactiveStoreLogin = await expect(basicSession, '/auth/login', {
      method: 'POST', body: { usuario: basic.body.propietario.usuario, password: basic.password }
    }, 401, 'Tienda inactiva bloquea login nuevo');
    assertUniformLoginRejection(inactiveStoreLogin, wrongPasswordLogin, [
      basic.body.propietario.usuario, basic.body.slug, 'tienda', 'inactiva', 'store_unavailable'
    ]);
    await expect(superSession, `/api/admin/tiendas/${fixture.basicStore}/activar`, { method: 'PATCH' }, 200, 'Reactivacion administrativa');
    await expect(basicSession, '/api/productos', {}, 401, 'Reactivar no revive la sesion anterior');
    await expect(basicSession, '/auth/login', {
      method: 'POST', body: { usuario: basic.body.propietario.usuario, password: basic.password }
    }, 200, 'Login nuevo funciona despues de reactivar tienda');

    console.log('Prueba de planes y suscripciones completada correctamente.');
  } finally {
    for (const session of sessions) {
      try { await session.request('/auth/logout', { method: 'POST' }); } catch { /* El servidor puede haber finalizado. */ }
    }
    try { await cleanup(connection, fixture); } finally {
      capturedAuditRequestIds = null;
      if (connection) await connection.end();
    }
  }
}

main().catch((error) => {
  console.error('La prueba de planes y suscripciones fallo.');
  console.error(error.message);
  process.exit(1);
});
