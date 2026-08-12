const assert = require('assert');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { createDatabaseConnection } = require('../config/database-connection');
const { requireLocalhostDatabase } = require('../config/env');
const { createSubscription } = require('../services/subscription-service');
const { addLocalDays, formatLocalDateTime, getLocalNow } = require('../utils/local-datetime');
const { applyTestRequestSecurity } = require('./http-test-security');

class Session {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
    this.cookie = '';
    this.requestIds = [];
  }

  async request(path, options = {}, secure = true) {
    const request = { ...options, headers: { ...(options.headers || {}) } };
    if (request.body && typeof request.body !== 'string') {
      request.headers['content-type'] = 'application/json';
      request.body = JSON.stringify(request.body);
    }
    if (secure) applyTestRequestSecurity(this.baseUrl, request);
    if (this.cookie) request.headers.cookie = this.cookie;
    const response = await fetch(`${this.baseUrl}${path}`, { ...request, redirect: 'manual' });
    const cookie = response.headers.get('set-cookie');
    if (cookie) this.cookie = cookie.split(';')[0];
    const requestId = response.headers.get('x-request-id');
    if (requestId) this.requestIds.push(requestId);
    return {
      status: response.status,
      body: await response.json().catch(() => ({})),
      headers: response.headers
    };
  }
}

async function expect(session, path, options, status, label, secure = true) {
  const response = await session.request(path, options, secure);
  assert.strictEqual(response.status, status, `${label}: HTTP ${response.status} ${JSON.stringify(response.body)}`);
  return response;
}

function assertSafe(value, label) {
  const text = JSON.stringify(value);
  assert(!/idTienda|idSuscripcion|idPlan|idPrecio|idTipoCambio|idMetodo|claveHash|huellaPayload|sqlMessage|stack/i.test(text), `${label} expuso datos internos.`);
}

async function createFixture(connection, marker, suffix) {
  const password = `Payment-${marker}-${suffix}-Password!`;
  const now = getLocalNow();
  const [store] = await connection.query(
    `INSERT INTO tienda (nombre,slug,activo,estado,estadoOnboarding,onboardingCompletadoEn)
     VALUES (?, ?,1,'activa','completado',?)`,
    [`Payment request ${suffix} ${marker}`, `payment-request-${suffix}-${marker}`, formatLocalDateTime(now)]
  );
  const idTienda = Number(store.insertId);
  const [owner] = await connection.query(
    `INSERT INTO administrador
      (idTienda,usuario,password,rol,activo,estadoAcceso,versionSesion)
     VALUES (?, ?, ?,'dueno_tienda',1,'activo',1)`,
    [idTienda, `payment_owner_${suffix}_${marker}`, await bcrypt.hash(password, 12)]
  );
  const subscription = await createSubscription(connection, {
    idTienda,
    planCodigo: 'basico',
    tipo: 'pagada',
    fechaInicio: formatLocalDateTime(addLocalDays(now, -1)),
    fechaFin: formatLocalDateTime(addLocalDays(now, 30)),
    creadoPor: Number(owner.insertId),
    actorTipo: 'administrador'
  });
  return {
    idTienda,
    idAdministrador: Number(owner.insertId),
    idSuscripcion: subscription.idSuscripcion,
    usuario: `payment_owner_${suffix}_${marker}`,
    password
  };
}

async function methodSnapshot(connection) {
  const [rows] = await connection.query(
    `SELECT idMetodoPagoSuscripcion,instrucciones,configurado,visiblePropietario,
            activo,configuradoPor,actualizadoEn
     FROM metodoPagoSuscripcion ORDER BY idMetodoPagoSuscripcion`
  );
  return rows;
}

async function restoreMethods(connection, snapshots) {
  for (const row of snapshots) {
    await connection.query(
      `UPDATE metodoPagoSuscripcion
       SET instrucciones=?,configurado=?,visiblePropietario=?,activo=?,
           configuradoPor=?,actualizadoEn=?
       WHERE idMetodoPagoSuscripcion=?`,
      [row.instrucciones, row.configurado, row.visiblePropietario, row.activo,
        row.configuradoPor, row.actualizadoEn, row.idMetodoPagoSuscripcion]
    );
  }
}

async function cleanup(connection, fixture, methods, sessions) {
  const storeIds = fixture.stores.map((item) => item.idTienda);
  const adminIds = [fixture.idSuperadmin, ...fixture.stores.map((item) => item.idAdministrador)];
  const requestIds = sessions.flatMap((session) => session.requestIds);
  await connection.beginTransaction();
  try {
    if (requestIds.length || storeIds.length || adminIds.length) {
      const clauses = [];
      const values = [];
      if (requestIds.length) { clauses.push('requestId IN (?)'); values.push(requestIds); }
      if (storeIds.length) { clauses.push('idTienda IN (?)'); values.push(storeIds); }
      if (adminIds.length) { clauses.push('idAdministradorActor IN (?)'); values.push(adminIds); }
      await connection.query(`DELETE FROM eventoAuditoriaAdministrativa WHERE ${clauses.join(' OR ')}`, values);
    }
    await connection.query(
      `DELETE FROM operacionPagoSuscripcion
       WHERE idTienda IN (?) OR idAdministradorActor IN (?)`,
      [storeIds, adminIds]
    );
    for (const idTienda of storeIds) {
      await connection.query('DELETE FROM historialSolicitudPagoSuscripcion WHERE idTienda=?', [idTienda]);
      await connection.query('DELETE FROM solicitudPagoFuncionalidadSnapshot WHERE idTienda=?', [idTienda]);
      await connection.query('DELETE FROM solicitudPagoSuscripcion WHERE idTienda=?', [idTienda]);
      await connection.query('DELETE FROM operacionSuscripcionTienda WHERE idTienda=?', [idTienda]);
      await connection.query('DELETE FROM historialSuscripcionTienda WHERE idTienda=?', [idTienda]);
      await connection.query('DELETE FROM suscripcionFuncionalidadSnapshot WHERE idTienda=?', [idTienda]);
      await connection.query('DELETE FROM suscripcionTienda WHERE idTienda=?', [idTienda]);
      await connection.query('DELETE FROM administrador WHERE idTienda=?', [idTienda]);
      await connection.query('DELETE FROM tienda WHERE idTienda=?', [idTienda]);
    }
    await connection.query('DELETE FROM tipoCambioSuscripcion WHERE registradoPor=?', [fixture.idSuperadmin]);
    await restoreMethods(connection, methods);
    await connection.query('DELETE FROM administrador WHERE idAdministrador=?', [fixture.idSuperadmin]);
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  }
}

function paymentBody(overrides = {}) {
  return {
    plan: 'basico',
    periodo: 'mensual',
    operacion: 'renovacion',
    metodo: 'qr_manual',
    ...overrides
  };
}

async function main() {
  const config = { ...requireLocalhostDatabase('prueba de solicitudes de pago SAAS-C2'), decimalNumbers: true };
  if (!/(prueba|test)/i.test(config.database)) throw new Error('La prueba requiere una base local de pruebas.');
  const connection = await createDatabaseConnection(config);
  const baseUrl = process.env.TEST_BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
  const marker = crypto.randomBytes(6).toString('hex');
  const methods = await methodSnapshot(connection);
  const sessions = [new Session(baseUrl), new Session(baseUrl), new Session(baseUrl)];
  const fixture = { idSuperadmin: null, stores: [] };
  const superUser = `payment_super_${marker}`;
  const superPassword = `Payment-Super-${marker}-Password!`;
  try {
    const [superadmin] = await connection.query(
      `INSERT INTO administrador
        (idTienda,usuario,password,rol,activo,estadoAcceso,versionSesion)
       VALUES (NULL,?,?,'superadmin',1,'activo',1)`,
      [superUser, await bcrypt.hash(superPassword, 12)]
    );
    fixture.idSuperadmin = Number(superadmin.insertId);
    fixture.stores.push(await createFixture(connection, marker, 'a'));
    fixture.stores.push(await createFixture(connection, marker, 'b'));
    await expect(sessions[0], '/auth/login', {
      method: 'POST', body: { usuario: superUser, password: superPassword }
    }, 200, 'Login superadmin');
    for (let index = 0; index < fixture.stores.length; index += 1) {
      await expect(sessions[index + 1], '/auth/login', {
        method: 'POST',
        body: { usuario: fixture.stores[index].usuario, password: fixture.stores[index].password }
      }, 200, `Login propietario ${index + 1}`);
    }

    const plans = await expect(sessions[1], '/api/pagos-suscripcion/planes', {}, 200, 'Planes publicos');
    assert.deepStrictEqual(plans.body.planes.map((plan) => plan.referencia), ['basico', 'standard', 'pro']);
    assert(plans.body.planes.every((plan) => plan.periodos.length === 3));
    assert(!JSON.stringify(plans.body).includes('avanzado'));
    assertSafe(plans.body, 'Planes');
    assert.match(plans.headers.get('cache-control') || '', /no-store/);

    const emptyMethods = await expect(sessions[1], '/api/pagos-suscripcion/metodos', {}, 200, 'Metodos vacios');
    assert.strictEqual(emptyMethods.body.disponibles, false);
    await expect(sessions[1], '/api/pagos-suscripcion/cotizar', {
      method: 'POST', body: paymentBody()
    }, 409, 'Cotizacion sin tasa');

    const rateKey = `payment:${marker}:rate`;
    const rate = await expect(sessions[0], '/api/admin/pagos-suscripcion/tipos-cambio', {
      method: 'POST', headers: { 'Idempotency-Key': rateKey },
      body: { valor: '7.00000000', fuente: 'Fuente sintetica controlada' }
    }, 201, 'Registrar tasa');
    assert.strictEqual(rate.body.valor, '7.00000000');
    const rateReplay = await expect(sessions[0], '/api/admin/pagos-suscripcion/tipos-cambio', {
      method: 'POST', headers: { 'Idempotency-Key': rateKey },
      body: { valor: '7.00000000', fuente: 'Fuente sintetica controlada' }
    }, 200, 'Replay tasa');
    assert.strictEqual(rateReplay.body.replayed, true);
    await expect(sessions[0], '/api/admin/pagos-suscripcion/tipos-cambio', {
      method: 'POST', headers: { 'Idempotency-Key': rateKey },
      body: { valor: '7.10000000', fuente: 'Fuente sintetica controlada' }
    }, 409, 'Conflicto tasa');
    const rateList = await expect(sessions[0], '/api/admin/pagos-suscripcion/tipos-cambio', {}, 200, 'Historial de tasas');
    assert.strictEqual(rateList.body.vigente.valor, '7.00000000');
    assert.match(rateList.headers.get('cache-control') || '', /no-store/);
    await expect(sessions[1], '/api/admin/pagos-suscripcion/tipos-cambio', {}, 403, 'Tasas solo superadmin');
    await expect(sessions[0], '/api/admin/pagos-suscripcion/tipos-cambio', {
      method: 'POST', headers: { 'Idempotency-Key': `payment:${marker}:rate-csrf` },
      body: { valor: '7.10000000', fuente: 'Fuente sintetica controlada' }
    }, 403, 'CSRF de tasa', false);

    await new Promise((resolve) => setTimeout(resolve, 1100));
    await connection.query(
      `UPDATE tipoCambioSuscripcion
       SET activo=0,vigenteHasta=NOW()
       WHERE registradoPor=? AND activo=1`,
      [fixture.idSuperadmin]
    );
    await expect(sessions[1], '/api/pagos-suscripcion/cotizar', {
      method: 'POST', body: paymentBody()
    }, 409, 'Cotizacion con tasa vencida');
    await new Promise((resolve) => setTimeout(resolve, 1100));
    await expect(sessions[0], '/api/admin/pagos-suscripcion/tipos-cambio', {
      method: 'POST', headers: { 'Idempotency-Key': `payment:${marker}:rate-replacement` },
      body: { valor: '7.00000000', fuente: 'Tasa sintetica de reemplazo' }
    }, 201, 'Reemplazar tasa vencida');

    await expect(sessions[1], '/api/pagos-suscripcion/cotizar', {
      method: 'POST', body: paymentBody()
    }, 409, 'Metodo inactivo');

    const methodKey = `payment:${marker}:method`;
    await expect(sessions[0], '/api/admin/pagos-suscripcion/metodos/qr_manual', {
      method: 'PATCH', headers: { 'Idempotency-Key': methodKey },
      body: { activo: true, visiblePropietario: true, instrucciones: 'Instrucciones sinteticas para prueba local.' }
    }, 200, 'Configurar metodo');
    const methodReplay = await expect(sessions[0], '/api/admin/pagos-suscripcion/metodos/qr_manual', {
      method: 'PATCH', headers: { 'Idempotency-Key': methodKey },
      body: { activo: true, visiblePropietario: true, instrucciones: 'Instrucciones sinteticas para prueba local.' }
    }, 200, 'Replay metodo');
    assert.strictEqual(methodReplay.body.replayed, true);
    await expect(sessions[0], '/api/admin/pagos-suscripcion/metodos/qr_manual', {
      method: 'PATCH', headers: { 'Idempotency-Key': methodKey },
      body: { activo: false, visiblePropietario: false, instrucciones: null }
    }, 409, 'Conflicto metodo');
    await expect(sessions[0], '/api/admin/pagos-suscripcion/metodos/efectivo_administrativo', {
      method: 'PATCH', headers: { 'Idempotency-Key': `payment:${marker}:cash` },
      body: { activo: true, visiblePropietario: true, instrucciones: null }
    }, 400, 'Efectivo no publico');

    const ownerMethods = await expect(sessions[1], '/api/pagos-suscripcion/metodos', {}, 200, 'Metodo propietario');
    assert.deepStrictEqual(ownerMethods.body.metodos.map((method) => method.referencia), ['qr_manual']);
    assert(!JSON.stringify(ownerMethods.body).includes('efectivo_administrativo'));
    assertSafe(ownerMethods.body, 'Metodos propietario');
    const adminMethods = await expect(sessions[0], '/api/admin/pagos-suscripcion/metodos', {}, 200, 'Metodos administrativos');
    assert.strictEqual(adminMethods.body.metodos.length, 3);
    assertSafe(adminMethods.body, 'Metodos administrativos');

    const quote = await expect(sessions[1], '/api/pagos-suscripcion/cotizar', {
      method: 'POST', body: paymentBody()
    }, 200, 'Cotizacion');
    assert.strictEqual(quote.body.precioBase.monto, '3.00');
    assert.strictEqual(quote.body.montoCobro.monto, '21.00');
    assert.strictEqual(quote.body.periodo, 'mensual');
    assertSafe(quote.body, 'Cotizacion');
    const upgrade = await expect(sessions[1], '/api/pagos-suscripcion/cotizar', {
      method: 'POST', body: paymentBody({ plan: 'standard', operacion: 'upgrade', periodo: 'trimestral' })
    }, 200, 'Cotizacion upgrade');
    assert.strictEqual(upgrade.body.montoCobro.monto, '115.50');
    await expect(sessions[1], '/api/pagos-suscripcion/cotizar', {
      method: 'POST', body: { ...paymentBody(), idTienda: fixture.stores[1].idTienda }
    }, 400, 'Tenant prohibido');
    await expect(sessions[1], '/api/pagos-suscripcion/cotizar', {
      method: 'POST', body: paymentBody()
    }, 403, 'CSRF de cotizacion', false);
    await expect(sessions[1], '/api/pagos-suscripcion/cotizar', {
      method: 'POST', headers: { Origin: 'https://origen-invalido.example' }, body: paymentBody()
    }, 403, 'Origen invalido');

    const createKey = `payment:${marker}:create`;
    const created = await expect(sessions[1], '/api/pagos-suscripcion/solicitudes', {
      method: 'POST', headers: { 'Idempotency-Key': createKey }, body: paymentBody()
    }, 201, 'Crear solicitud');
    assert.strictEqual(created.body.estado, 'pendiente_comprobante');
    assert.strictEqual(created.body.created, true);
    const replay = await expect(sessions[1], '/api/pagos-suscripcion/solicitudes', {
      method: 'POST', headers: { 'Idempotency-Key': createKey }, body: paymentBody()
    }, 200, 'Replay solicitud');
    assert.strictEqual(replay.body.replayed, true);
    assert.strictEqual(replay.body.referencia, created.body.referencia);
    await expect(sessions[1], '/api/pagos-suscripcion/solicitudes', {
      method: 'POST', headers: { 'Idempotency-Key': createKey },
      body: paymentBody({ periodo: 'anual' })
    }, 409, 'Conflicto de payload');

    const detail = await expect(
      sessions[1], `/api/pagos-suscripcion/solicitudes/${created.body.referencia}`,
      {}, 200, 'Detalle propio'
    );
    assert.strictEqual(detail.body.planActual.codigo, 'basico');
    assert.strictEqual(detail.body.planObjetivo.codigo, 'basico');
    assert.strictEqual(detail.body.historial.length, 1);
    assertSafe(detail.body, 'Detalle');

    await expect(sessions[0], '/api/admin/pagos-suscripcion/metodos/qr_manual', {
      method: 'PATCH', headers: { 'Idempotency-Key': `payment:${marker}:method-snapshot` },
      body: { activo: true, visiblePropietario: true, instrucciones: 'Instrucciones nuevas que no deben alterar snapshots.' }
    }, 200, 'Cambiar instrucciones posteriores');
    await new Promise((resolve) => setTimeout(resolve, 1100));
    await expect(sessions[0], '/api/admin/pagos-suscripcion/tipos-cambio', {
      method: 'POST', headers: { 'Idempotency-Key': `payment:${marker}:rate-snapshot` },
      body: { valor: '7.10000000', fuente: 'Segunda fuente sintetica controlada' }
    }, 201, 'Cambiar tasa posterior');
    const immutable = await expect(
      sessions[1], `/api/pagos-suscripcion/solicitudes/${created.body.referencia}`,
      {}, 200, 'Snapshot inmutable'
    );
    assert.strictEqual(immutable.body.conversion.valor, '7.00000000');
    assert.strictEqual(immutable.body.metodo.instrucciones, 'Instrucciones sinteticas para prueba local.');
    await expect(
      sessions[2], `/api/pagos-suscripcion/solicitudes/${created.body.referencia}`,
      {}, 404, 'Detalle de otro tenant'
    );

    const cancelKey = `payment:${marker}:cancel`;
    const cancelled = await expect(
      sessions[1], `/api/pagos-suscripcion/solicitudes/${created.body.referencia}/cancelar`,
      { method: 'POST', headers: { 'Idempotency-Key': cancelKey }, body: {} },
      200, 'Cancelar solicitud'
    );
    assert.strictEqual(cancelled.body.estado, 'cancelada');
    const cancelReplay = await expect(
      sessions[1], `/api/pagos-suscripcion/solicitudes/${created.body.referencia}/cancelar`,
      { method: 'POST', headers: { 'Idempotency-Key': cancelKey }, body: {} },
      200, 'Replay cancelacion'
    );
    assert.strictEqual(cancelReplay.body.replayed, true);

    const concurrent = await Promise.all([
      sessions[1].request('/api/pagos-suscripcion/solicitudes', {
        method: 'POST', headers: { 'Idempotency-Key': `payment:${marker}:concurrent-a` }, body: paymentBody()
      }),
      sessions[1].request('/api/pagos-suscripcion/solicitudes', {
        method: 'POST', headers: { 'Idempotency-Key': `payment:${marker}:concurrent-b` }, body: paymentBody()
      })
    ]);
    assert.deepStrictEqual(concurrent.map((item) => item.status).sort(), [200, 201]);
    assert.strictEqual(concurrent[0].body.referencia, concurrent[1].body.referencia);
    const activeReference = concurrent[0].body.referencia;
    const [[oneOpen]] = await connection.query(
      `SELECT COUNT(*) total FROM solicitudPagoSuscripcion
       WHERE idTienda=? AND estado IN ('pendiente_comprobante','pendiente_revision','observada')`,
      [fixture.stores[0].idTienda]
    );
    assert.strictEqual(Number(oneOpen.total), 1);

    const secondStoreRequest = await expect(sessions[2], '/api/pagos-suscripcion/solicitudes', {
      method: 'POST', headers: { 'Idempotency-Key': `payment:${marker}:tenant-b` }, body: paymentBody()
    }, 201, 'Solicitud segundo tenant');
    assert.notStrictEqual(secondStoreRequest.body.referencia, activeReference);

    await connection.query(
      `UPDATE solicitudPagoSuscripcion
       SET creadaEn=DATE_SUB(NOW(),INTERVAL 2 HOUR),
           venceEn=DATE_SUB(NOW(),INTERVAL 1 HOUR),
           ultimaTransicionEn=DATE_SUB(NOW(),INTERVAL 2 HOUR),
           actualizadoEn=DATE_SUB(NOW(),INTERVAL 2 HOUR)
       WHERE idTienda=? AND referenciaPublica=?`,
      [fixture.stores[0].idTienda, activeReference]
    );
    const listed = await expect(sessions[1], '/api/pagos-suscripcion/solicitudes?estado=vencida', {}, 200, 'Vencimiento al listar');
    assert.strictEqual(listed.body.resultados.length, 1);
    assert.strictEqual(listed.body.resultados[0].referencia, activeReference);
    await expect(sessions[1], '/api/pagos-suscripcion/solicitudes?estado=vencida', {}, 200, 'Vencimiento idempotente');
    const [[expiredHistory]] = await connection.query(
      `SELECT COUNT(*) total FROM historialSolicitudPagoSuscripcion h
       JOIN solicitudPagoSuscripcion s
         ON s.idTienda=h.idTienda AND s.idSolicitudPago=h.idSolicitudPago
       WHERE s.referenciaPublica=? AND h.evento='vencida'`,
      [activeReference]
    );
    assert.strictEqual(Number(expiredHistory.total), 1);

    const [[effects]] = await connection.query(
      `SELECT
        (SELECT COUNT(*) FROM historialSolicitudPagoSuscripcion WHERE idTienda IN (?,?) AND evento='creada') creadas,
        (SELECT COUNT(*) FROM eventoAuditoriaAdministrativa WHERE idTienda IN (?,?) AND accion='creacion_solicitud_pago_suscripcion') auditoriasCreacion,
        (SELECT COUNT(*) FROM eventoAuditoriaAdministrativa WHERE idTienda=? AND accion='cancelacion_solicitud_pago_suscripcion') auditoriasCancelacion`,
      [fixture.stores[0].idTienda, fixture.stores[1].idTienda,
        fixture.stores[0].idTienda, fixture.stores[1].idTienda,
        fixture.stores[0].idTienda]
    );
    assert.deepStrictEqual(
      [effects.creadas, effects.auditoriasCreacion, effects.auditoriasCancelacion].map(Number),
      [3, 3, 1]
    );
    const [[plainSecrets]] = await connection.query(
      `SELECT COUNT(*) total FROM operacionPagoSuscripcion
       WHERE idAdministradorActor IN (?) AND (claveHash NOT REGEXP '^[0-9a-f]{64}$'
         OR huellaPayload NOT REGEXP '^[0-9a-f]{64}$')`,
      [[fixture.idSuperadmin, ...fixture.stores.map((item) => item.idAdministrador)]]
    );
    assert.strictEqual(Number(plainSecrets.total), 0);
    assertSafe(created.body, 'Creacion');
    console.log('test:saas-c-payment-requests OK');
  } finally {
    for (const session of sessions) {
      try { if (session.cookie) await session.request('/auth/logout', { method: 'POST' }); } catch { /* cleanup continua */ }
    }
    try { await cleanup(connection, fixture, methods, sessions); } finally { await connection.end(); }
  }
}

main().catch((error) => {
  console.error(`test:saas-c-payment-requests FAIL: ${error.message}`);
  process.exitCode = 1;
});
