const assert = require('assert');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { createDatabaseConnection } = require('../config/database-connection');
const { requireLocalhostDatabase } = require('../config/env');
const pool = require('../config/db');
const { comparePlanEntitlements, PLAN_CHANGE_TYPES } = require('../config/subscription-plan-change-contract');
const { renewSubscription } = require('../services/subscription-lifecycle-service');
const { createSubscription } = require('../services/subscription-service');
const { createSubscriptionPlanService } = require('../services/subscription-plan-service');
const { addLocalDays, formatLocalDateTime, getLocalNow, parseLocalDateTime } = require('../utils/local-datetime');
const { applyTestRequestSecurity } = require('./http-test-security');

function dateText(value) {
  return formatLocalDateTime(value instanceof Date ? value : parseLocalDateTime(value));
}

function expectCode(action, code) {
  return action().then(
    () => { throw new Error(`Se esperaba ${code}.`); },
    (error) => assert.strictEqual(error.code, code)
  );
}

async function catalogPlans(connection) {
  const [rows] = await connection.query(
    `SELECT idPlan,codigo,nombre,precioMensual,duracionDias,
            limitePropietarios,limiteProductos,limiteClientes,limiteProveedores
     FROM plan
     WHERE activo=1 AND visiblePublicamente=1 AND esLegado=0
       AND codigo IN ('basico','standard','pro')
     ORDER BY ordenComercial,codigo`
  );
  for (const row of rows) {
    const [features] = await connection.query(
      `SELECT f.codigo FROM planFuncionalidad pf
       JOIN funcionalidad f ON f.idFuncionalidad=pf.idFuncionalidad
       WHERE pf.idPlan=? AND pf.habilitada=1 AND f.activo=1`,
      [row.idPlan]
    );
    row.limites = {
      propietarios: row.limitePropietarios,
      productos: row.limiteProductos,
      clientes: row.limiteClientes,
      proveedores: row.limiteProveedores
    };
    row.funcionalidades = features.map((item) => item.codigo);
  }
  for (const current of rows) {
    for (const target of rows) {
      if (comparePlanEntitlements(current, target).tipo === PLAN_CHANGE_TYPES.UPGRADE) {
        return { lower: current, upper: target };
      }
    }
  }
  throw new Error('El catalogo no contiene una pareja de upgrade demostrable.');
}

class HttpSession {
  constructor(baseUrl) { this.baseUrl = baseUrl; this.cookie = ''; }
  async request(path, options = {}, secure = true) {
    const request = { ...options, headers: { ...(options.headers || {}) } };
    if (request.body && typeof request.body !== 'string') {
      request.headers['content-type'] = 'application/json';
      request.body = JSON.stringify(request.body);
    }
    if (secure) applyTestRequestSecurity(this.baseUrl, request);
    if (this.cookie) request.headers.cookie = this.cookie;
    const response = await fetch(`${this.baseUrl}${path}`, { ...request, redirect: 'manual' });
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) this.cookie = setCookie.split(';')[0];
    const body = await response.json().catch(() => ({}));
    return { status: response.status, body, headers: response.headers };
  }
}

async function createFixture(connection, marker, plan, suffix) {
  const password = `Plan-${marker}-${suffix}-Password!`;
  const passwordHash = await bcrypt.hash(password, 12);
  await connection.beginTransaction();
  try {
    const [store] = await connection.query(
      `INSERT INTO tienda (nombre,slug,activo,estado,estadoOnboarding)
       VALUES (?, ?, 1, 'activa', 'completado')`,
      [`Plan change ${suffix} ${marker}`, `plan-change-${suffix}-${marker}`]
    );
    const idTienda = Number(store.insertId);
    const [admin] = await connection.query(
      `INSERT INTO administrador (idTienda,usuario,password,rol,activo,estadoAcceso)
       VALUES (?, ?, ?, 'dueno_tienda', 1, 'activo')`,
      [idTienda, `plan_change_${suffix}_${marker}`, passwordHash]
    );
    const now = getLocalNow();
    const subscription = await createSubscription(connection, {
      idTienda,
      planCodigo: plan.codigo,
      tipo: 'cortesia',
      fechaInicio: formatLocalDateTime(addLocalDays(now, -1)),
      fechaFin: formatLocalDateTime(addLocalDays(now, 30)),
      creadoPor: Number(admin.insertId),
      actorTipo: 'administrador'
    });
    await connection.commit();
    return {
      idTienda,
      idAdministrador: Number(admin.insertId),
      idSuscripcion: subscription.idSuscripcion,
      usuario: `plan_change_${suffix}_${marker}`,
      password
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  }
}

async function cleanup(connection, fixtures) {
  const stores = fixtures.map((item) => item.idTienda).filter(Boolean);
  if (!stores.length) return;
  await connection.beginTransaction();
  try {
    await connection.query('DELETE FROM eventoAuditoriaAdministrativa WHERE idTienda IN (?)', [stores]);
    await connection.query('DELETE FROM operacionSuscripcionTienda WHERE idTienda IN (?)', [stores]);
    await connection.query('DELETE FROM historialSuscripcionTienda WHERE idTienda IN (?)', [stores]);
    await connection.query('DELETE FROM suscripcionFuncionalidadSnapshot WHERE idTienda IN (?)', [stores]);
    await connection.query('DELETE FROM suscripcionTienda WHERE idTienda IN (?)', [stores]);
    await connection.query('DELETE FROM configuracionTienda WHERE idTienda IN (?)', [stores]);
    await connection.query('DELETE FROM administrador WHERE idTienda IN (?)', [stores]);
    await connection.query('DELETE FROM tienda WHERE idTienda IN (?)', [stores]);
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  }
}

async function main() {
  const config = { ...requireLocalhostDatabase('cambios de plan'), decimalNumbers: true };
  if (!/(prueba|test)/i.test(config.database)) throw new Error('La prueba requiere una base local de prueba.');
  const connection = await createDatabaseConnection(config);
  const service = createSubscriptionPlanService({ database: pool });
  const marker = crypto.randomBytes(7).toString('hex');
  const baseUrl = process.env.TEST_BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
  const fixtures = [];
  try {
    const plans = await catalogPlans(connection);
    const first = await createFixture(connection, marker, plans.lower, 'a');
    const second = await createFixture(connection, marker, plans.lower, 'b');
    fixtures.push(first, second);

    const list = await service.list({ ...first, uso: { propietarios: 1, productos: 0, clientes: 0, proveedores: 0 } });
    assert(list.planes.some((plan) => plan.codigo === plans.upper.codigo && plan.tipoCambio === 'upgrade'));
    assert(!JSON.stringify(list).includes('idPlan'), 'El catalogo publico expuso identificadores internos.');

    const upgradeInput = {
      ...first,
      body: { codigoPlan: plans.upper.codigo },
      idempotencyKey: `upgrade:${marker}:same`,
      requestId: null
    };
    const upgrades = await Promise.all([
      service.upgrade(upgradeInput),
      service.upgrade(upgradeInput)
    ]);
    assert.strictEqual(upgrades.filter((item) => item.replayed).length, 1);
    const [[upgraded]] = await connection.query(
      `SELECT planCodigoSnapshot,fechaInicio,fechaFin,idPlanSiguiente
       FROM suscripcionTienda WHERE idTienda=? AND idSuscripcion=?`,
      [first.idTienda, first.idSuscripcion]
    );
    assert.strictEqual(upgraded.planCodigoSnapshot, plans.upper.codigo);
    assert.strictEqual(upgraded.idPlanSiguiente, null);

    await expectCode(() => service.upgrade({
      ...upgradeInput,
      body: { codigoPlan: plans.lower.codigo }
    }), 'OPERATION_KEY_CONFLICT');
    await expectCode(() => service.scheduleDowngrade({
      ...first,
      body: { codigoPlan: plans.lower.codigo, idTienda: second.idTienda },
      idempotencyKey: `downgrade:${marker}:forbidden`
    }), 'PLAN_CHANGE_FIELDS_NOT_ALLOWED');

    const downgradeInput = {
      ...first,
      body: { codigoPlan: plans.lower.codigo },
      idempotencyKey: `downgrade:${marker}:same`,
      requestId: null
    };
    const downgrades = await Promise.all([
      service.scheduleDowngrade(downgradeInput),
      service.scheduleDowngrade(downgradeInput)
    ]);
    assert.strictEqual(downgrades.filter((item) => item.replayed).length, 1);
    const [[scheduled]] = await connection.query(
      `SELECT planCodigoSnapshot,idPlanSiguiente,fechaAplicacionPlanSiguiente,fechaFin
       FROM suscripcionTienda WHERE idTienda=? AND idSuscripcion=?`,
      [first.idTienda, first.idSuscripcion]
    );
    assert.strictEqual(scheduled.planCodigoSnapshot, plans.upper.codigo, 'El downgrade altero el snapshot vigente.');
    assert.strictEqual(dateText(scheduled.fechaAplicacionPlanSiguiente), dateText(scheduled.fechaFin));

    const renewal = await renewSubscription(pool, {
      ...first,
      claveOperacion: `renew-plan:${marker}:next`,
      periodo: 'mensual',
      actorTipo: 'administrador',
      now: getLocalNow()
    });
    assert.notStrictEqual(renewal.idSuscripcion, first.idSuscripcion);
    const [[next]] = await connection.query(
      `SELECT planCodigoSnapshot,fechaInicio,fechaFin FROM suscripcionTienda
       WHERE idTienda=? AND idSuscripcion=?`,
      [first.idTienda, renewal.idSuscripcion]
    );
    assert.strictEqual(next.planCodigoSnapshot, plans.lower.codigo);
    assert.strictEqual(dateText(next.fechaInicio), dateText(scheduled.fechaFin));
    const [[old]] = await connection.query(
      'SELECT idPlanSiguiente,planCodigoSnapshot FROM suscripcionTienda WHERE idTienda=? AND idSuscripcion=?',
      [first.idTienda, first.idSuscripcion]
    );
    assert.strictEqual(old.idPlanSiguiente, null);
    assert.strictEqual(old.planCodigoSnapshot, plans.upper.codigo);
    const appliedList = await service.list({ ...first, uso: {} });
    assert.strictEqual(appliedList.planProgramado.codigo, plans.lower.codigo);
    const replayAfterPeriodCreation = await service.scheduleDowngrade({
      ...downgradeInput,
      idSuscripcion: renewal.idSuscripcion
    });
    assert.strictEqual(replayAfterPeriodCreation.replayed, true);
    assert.strictEqual(dateText(replayAfterPeriodCreation.fechaAplicacion), dateText(scheduled.fechaFin));
    await expectCode(() => renewSubscription(pool, {
      ...first,
      claveOperacion: `renew-plan:${marker}:duplicate-period`,
      periodo: 'mensual',
      actorTipo: 'administrador',
      now: getLocalNow()
    }), 'SUBSCRIPTION_NEXT_PERIOD_EXISTS');
    const [[periods]] = await connection.query(
      'SELECT COUNT(*) total FROM suscripcionTienda WHERE idTienda=?',
      [first.idTienda]
    );
    assert.strictEqual(Number(periods.total), 2, 'La renovacion duplicada creo un periodo solapado.');

    const [[history]] = await connection.query(
      `SELECT
        SUM(tipoOperacion='upgrade') upgrades,
        SUM(tipoOperacion='downgrade_programado') scheduled,
        SUM(tipoOperacion='downgrade_aplicado') applied
       FROM historialSuscripcionTienda WHERE idTienda=?`,
      [first.idTienda]
    );
    assert.deepStrictEqual([Number(history.upgrades), Number(history.scheduled), Number(history.applied)], [1, 1, 1]);

    const session = new HttpSession(baseUrl);
    const login = await session.request('/auth/login', {
      method: 'POST', body: { usuario: second.usuario, password: second.password }
    });
    assert.strictEqual(login.status, 200);
    const catalog = await session.request('/api/suscripcion/planes');
    assert.strictEqual(catalog.status, 200);
    assert.match(catalog.headers.get('cache-control') || '', /no-store/);
    assert(!JSON.stringify(catalog.body).includes('idPlan'));
    const noCsrf = await session.request('/api/suscripcion/upgrade', {
      method: 'POST',
      headers: { 'Idempotency-Key': `upgrade-http:${marker}:csrf` },
      body: { codigoPlan: plans.upper.codigo }
    }, false);
    assert.strictEqual(noCsrf.status, 403);
    const forbidden = await session.request('/api/suscripcion/upgrade', {
      method: 'POST',
      headers: { 'Idempotency-Key': `upgrade-http:${marker}:forbidden` },
      body: { codigoPlan: plans.upper.codigo, idTienda: first.idTienda }
    });
    assert.strictEqual(forbidden.status, 400);
    const httpUpgrade = await session.request('/api/suscripcion/upgrade', {
      method: 'POST',
      headers: { 'Idempotency-Key': `upgrade-http:${marker}:valid` },
      body: { codigoPlan: plans.upper.codigo }
    });
    assert.strictEqual(httpUpgrade.status, 200);
    assert(!JSON.stringify(httpUpgrade.body).match(/idTienda|idSuscripcion|idHistorial|idPlan/));
    const [[otherTenant]] = await connection.query(
      'SELECT planCodigoSnapshot,idPlanSiguiente FROM suscripcionTienda WHERE idTienda=? AND idSuscripcion=?',
      [second.idTienda, second.idSuscripcion]
    );
    assert.strictEqual(otherTenant.planCodigoSnapshot, plans.upper.codigo);
    assert.strictEqual(otherTenant.idPlanSiguiente, null);
    const [[audit]] = await connection.query(
      `SELECT
        SUM(accion='upgrade_suscripcion') upgrades,
        SUM(accion='downgrade_suscripcion_programado') downgrades
       FROM eventoAuditoriaAdministrativa WHERE idTienda=?`,
      [first.idTienda]
    );
    assert.strictEqual(Number(audit.upgrades), 1);
    assert.strictEqual(Number(audit.downgrades), 1);
    console.log('test:subscription-plan-changes OK');
  } finally {
    try { await cleanup(connection, fixtures); } finally {
      await connection.end();
      await pool.end();
    }
  }
}

main().catch((error) => {
  console.error(`test:subscription-plan-changes FAIL: ${error.message}`);
  process.exitCode = 1;
});
