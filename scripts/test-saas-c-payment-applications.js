const assert = require('assert');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const pool = require('../config/db');
const { requireLocalhostDatabase } = require('../config/env');
const { createSaasCPaymentApplicationService, addCalendarMonths } = require('../services/saas-c-payment-application-service');
const { createSaasCPaymentService } = require('../services/saas-c-payment-service');
const { createSaasCPaymentReviewService } = require('../services/saas-c-payment-review-service');
const { createSubscription } = require('../services/subscription-service');
const { addLocalDays, formatLocalDateTime, getLocalNow, parseLocalDateTime } = require('../utils/local-datetime');
const { applyTestRequestSecurity } = require('./http-test-security');

class Session {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
    this.cookie = '';
  }

  async request(route, options = {}, secure = true) {
    const request = { ...options, headers: { ...(options.headers || {}) } };
    if (request.body && typeof request.body !== 'string') {
      request.headers['content-type'] = 'application/json';
      request.body = JSON.stringify(request.body);
    }
    if (secure) applyTestRequestSecurity(this.baseUrl, request);
    if (this.cookie) request.headers.cookie = this.cookie;
    const response = await fetch(`${this.baseUrl}${route}`, { ...request, redirect: 'manual' });
    const cookie = response.headers.get('set-cookie');
    if (cookie) this.cookie = cookie.split(';')[0];
    return {
      status: response.status,
      body: await response.json().catch(() => ({})),
      headers: response.headers
    };
  }
}

function opaque() {
  return crypto.randomBytes(32).toString('base64url');
}

async function createStore(marker, suffix, now, state = 'activa') {
  const [store] = await pool.query(
    `INSERT INTO tienda (nombre,slug,activo,estado,estadoOnboarding,onboardingCompletadoEn)
     VALUES (?, ?,1,'activa','completado',?)`,
    [`Aplicacion C5 ${suffix} ${marker}`, `aplicacion-c5-${suffix}-${marker}`, formatLocalDateTime(now)]
  );
  const idTienda = Number(store.insertId);
  const [owner] = await pool.query(
    `INSERT INTO administrador
      (idTienda,usuario,password,rol,activo,estadoAcceso,versionSesion)
     VALUES (?, ?, ?,'dueno_tienda',1,'activo',1)`,
    [idTienda, `aplicacion_c5_${suffix}_${marker}`, await bcrypt.hash(`C5-${marker}-${suffix}!`, 12)]
  );
  const subscription = await createSubscription(pool, {
    idTienda,
    planCodigo: 'basico',
    tipo: 'pagada',
    fechaInicio: formatLocalDateTime(addLocalDays(now, -30)),
    fechaFin: formatLocalDateTime(addLocalDays(now, 10)),
    creadoPor: Number(owner.insertId),
    actorTipo: 'administrador'
  });
  if (state === 'gracia') {
    const end = addLocalDays(now, -1);
    await pool.query(
      `UPDATE suscripcionTienda SET estado='activa',fechaFin=?,fechaFinGracia=?,motivoTransicion='renovacion'
       WHERE idTienda=? AND idSuscripcion=?`,
      [formatLocalDateTime(end), formatLocalDateTime(addLocalDays(end, 7)), idTienda, subscription.idSuscripcion]
    );
  }
  if (state === 'suspendida') {
    const end = addLocalDays(now, -10);
    await pool.query(
      `UPDATE suscripcionTienda SET estado='suspendida',fechaFin=?,fechaFinGracia=?,
         suspendidaEn=?,motivoTransicion='fin_gracia'
       WHERE idTienda=? AND idSuscripcion=?`,
      [formatLocalDateTime(end), formatLocalDateTime(addLocalDays(end, 7)),
        formatLocalDateTime(addLocalDays(end, 7)), idTienda, subscription.idSuscripcion]
    );
  }
  return {
    idTienda,
    idAdministrador: Number(owner.insertId),
    idSuscripcion: subscription.idSuscripcion
  };
}

async function attachReceipt(store, reference, now) {
  const [[request]] = await pool.query(
    'SELECT idSolicitudPago FROM solicitudPagoSuscripcion WHERE idTienda=? AND referenciaPublica=?',
    [store.idTienda, reference]
  );
  const stamp = formatLocalDateTime(now);
  const receiptReference = opaque();
  const [receipt] = await pool.query(
    `INSERT INTO comprobantePagoSuscripcion
      (referenciaPublica,idTienda,idSolicitudPago,versionComprobante,estado,nombreGenerado,
       nombreOriginalSanitizado,extensionDetectada,mimeDetectado,tamanoBytes,hashSha256,
       claveAlmacenamiento,cargadoPor,cargadoEn,reemplazadoEn,creadoEn,actualizadoEn)
     VALUES (?,?,?,1,'cargado',?,'comprobante.pdf','pdf','application/pdf',128,?,?,?, ?,NULL,?,?)`,
    [receiptReference, store.idTienda, request.idSolicitudPago, `${opaque()}.pdf`,
      crypto.createHash('sha256').update(reference).digest('hex'), `test-c5/${opaque()}`,
      store.idAdministrador, stamp, stamp, stamp]
  );
  await pool.query(
    `UPDATE solicitudPagoSuscripcion SET estado='pendiente_revision',enviadaEn=?,
       ultimaTransicionEn=?,actualizadoEn=? WHERE idTienda=? AND idSolicitudPago=?`,
    [stamp, stamp, stamp, store.idTienda, request.idSolicitudPago]
  );
  await pool.query(
    `INSERT INTO historialSolicitudPagoSuscripcion
      (idTienda,idSolicitudPago,evento,estadoAnterior,estadoNuevo,actorTipo,idAdministradorActor,creadoEn)
     VALUES (?,?,'comprobante_cargado','pendiente_comprobante','pendiente_revision','propietario',?,?)`,
    [store.idTienda, request.idSolicitudPago, store.idAdministrador, stamp]
  );
  return Number(receipt.insertId);
}

async function createReadyRequest(paymentService, store, body, key, now) {
  const result = await paymentService.createRequest({
    ...store,
    body,
    idempotencyKey: key,
    now
  });
  await attachReceipt(store, result.referencia, now);
  return result.referencia;
}

async function counts(store, reference) {
  const [[row]] = await pool.query(
    `SELECT
      (SELECT COUNT(*) FROM aplicacionPagoSuscripcion a JOIN solicitudPagoSuscripcion s
       ON s.idTienda=a.idTienda AND s.idSolicitudPago=a.idSolicitudPago
       WHERE s.idTienda=? AND s.referenciaPublica=?) aplicaciones,
      (SELECT COUNT(*) FROM historialSolicitudPagoSuscripcion h JOIN solicitudPagoSuscripcion s
       ON s.idTienda=h.idTienda AND s.idSolicitudPago=h.idSolicitudPago
       WHERE s.idTienda=? AND s.referenciaPublica=? AND h.evento='aplicada') historialPago,
      (SELECT COUNT(*) FROM revisionPagoSuscripcion r JOIN solicitudPagoSuscripcion s
       ON s.idTienda=r.idTienda AND s.idSolicitudPago=r.idSolicitudPago
       WHERE s.idTienda=? AND s.referenciaPublica=? AND r.decision='aplicar') revisiones,
      (SELECT COUNT(*) FROM eventoAuditoriaAdministrativa
       WHERE idTienda=? AND accion='aplicacion_pago_suscripcion') auditorias`,
    [store.idTienda, reference, store.idTienda, reference, store.idTienda, reference, store.idTienda]
  );
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, Number(value)]));
}

async function cleanup(fixture) {
  const stores = fixture.stores.map((item) => item.idTienda);
  const admins = [fixture.idSuperadmin, fixture.idSecondSuperadmin,
    ...fixture.stores.map((item) => item.idAdministrador)].filter(Boolean);
  await pool.query('SET FOREIGN_KEY_CHECKS=1');
  if (stores.length || admins.length) {
    await pool.query(
      'DELETE FROM eventoAuditoriaAdministrativa WHERE idTienda IN (?) OR idAdministradorActor IN (?)',
      [stores.length ? stores : [-1], admins.length ? admins : [-1]]
    );
    await pool.query(
      'DELETE FROM operacionPagoSuscripcion WHERE idTienda IN (?) OR idAdministradorActor IN (?)',
      [stores.length ? stores : [-1], admins.length ? admins : [-1]]
    );
  }
  for (const idTienda of stores) {
    await pool.query('DELETE FROM aplicacionPagoSuscripcion WHERE idTienda=?', [idTienda]);
    await pool.query('DELETE FROM revisionPagoSuscripcion WHERE idTienda=?', [idTienda]);
    await pool.query('DELETE FROM comprobantePagoSuscripcion WHERE idTienda=?', [idTienda]);
    await pool.query('DELETE FROM historialSolicitudPagoSuscripcion WHERE idTienda=?', [idTienda]);
    await pool.query('DELETE FROM solicitudPagoFuncionalidadSnapshot WHERE idTienda=?', [idTienda]);
    await pool.query('DELETE FROM solicitudPagoSuscripcion WHERE idTienda=?', [idTienda]);
    await pool.query('DELETE FROM operacionSuscripcionTienda WHERE idTienda=?', [idTienda]);
    await pool.query('DELETE FROM historialSuscripcionTienda WHERE idTienda=?', [idTienda]);
    await pool.query('DELETE FROM suscripcionFuncionalidadSnapshot WHERE idTienda=?', [idTienda]);
    await pool.query('DELETE FROM suscripcionTienda WHERE idTienda=?', [idTienda]);
    await pool.query('DELETE FROM administrador WHERE idTienda=?', [idTienda]);
    await pool.query('DELETE FROM tienda WHERE idTienda=?', [idTienda]);
  }
  if (fixture.idRate) await pool.query('DELETE FROM tipoCambioSuscripcion WHERE idTipoCambioSuscripcion=?', [fixture.idRate]);
  for (const rate of fixture.rateSnapshot) {
    await pool.query(
      `UPDATE tipoCambioSuscripcion SET activo=?,vigenteHasta=?,actualizadoEn=?
       WHERE idTipoCambioSuscripcion=?`,
      [rate.activo, rate.vigenteHasta, rate.actualizadoEn, rate.idTipoCambioSuscripcion]
    );
  }
  for (const method of fixture.methodSnapshot) {
    await pool.query(
      `UPDATE metodoPagoSuscripcion SET instrucciones=?,configurado=?,visiblePropietario=?,activo=?,
         configuradoPor=?,actualizadoEn=? WHERE idMetodoPagoSuscripcion=?`,
      [method.instrucciones, method.configurado, method.visiblePropietario, method.activo,
        method.configuradoPor, method.actualizadoEn, method.idMetodoPagoSuscripcion]
    );
  }
  for (const price of fixture.priceSnapshot) {
    await pool.query(
      'UPDATE precioPlanPeriodo SET monto=?,actualizadoEn=? WHERE idPrecioPlanPeriodo=?',
      [price.monto, price.actualizadoEn, price.idPrecioPlanPeriodo]
    );
  }
  if (fixture.idSuperadmin) await pool.query('DELETE FROM administrador WHERE idAdministrador=?', [fixture.idSuperadmin]);
  if (fixture.idSecondSuperadmin) await pool.query('DELETE FROM administrador WHERE idAdministrador=?', [fixture.idSecondSuperadmin]);
}

async function main() {
  const config = requireLocalhostDatabase('prueba de aplicacion de pagos SAAS-C5');
  assert(/(prueba|test)/i.test(config.database), 'La prueba requiere la base local de pruebas.');
  const now = getLocalNow();
  const marker = crypto.randomBytes(6).toString('hex');
  const fixture = {
    idSuperadmin: null,
    idSecondSuperadmin: null,
    idRate: null,
    stores: [],
    rateSnapshot: [],
    methodSnapshot: [],
    priceSnapshot: []
  };
  try {
    [fixture.rateSnapshot] = await pool.query(
      `SELECT idTipoCambioSuscripcion,activo,vigenteHasta,actualizadoEn
       FROM tipoCambioSuscripcion WHERE monedaOrigen='USD' AND monedaDestino='BOB'`
    );
    [fixture.methodSnapshot] = await pool.query(
      `SELECT idMetodoPagoSuscripcion,instrucciones,configurado,visiblePropietario,activo,
              configuradoPor,actualizadoEn FROM metodoPagoSuscripcion`
    );
    const password = await bcrypt.hash(`C5-super-${marker}!`, 12);
    const [superadmin] = await pool.query(
      `INSERT INTO administrador (idTienda,usuario,password,rol,activo,estadoAcceso,versionSesion)
       VALUES (NULL,?,?,'superadmin',1,'activo',1)`,
      [`aplicacion_c5_super_${marker}`, password]
    );
    fixture.idSuperadmin = Number(superadmin.insertId);
    const [second] = await pool.query(
      `INSERT INTO administrador (idTienda,usuario,password,rol,activo,estadoAcceso,versionSesion)
       VALUES (NULL,?,?,'superadmin',1,'activo',1)`,
      [`aplicacion_c5_super_b_${marker}`, password]
    );
    fixture.idSecondSuperadmin = Number(second.insertId);

    const paymentService = createSaasCPaymentService({ database: pool, clock: () => now });
    const applicationService = createSaasCPaymentApplicationService({ database: pool, clock: () => now });
    const rate = await paymentService.registerExchangeRate({
      idAdministrador: fixture.idSuperadmin,
      idempotencyKey: `c5:${marker}:rate`,
      body: { valor: '7.00000000', fuente: 'Fuente sintetica C5' },
      now
    });
    const [[rateRow]] = await pool.query(
      'SELECT idTipoCambioSuscripcion FROM tipoCambioSuscripcion WHERE versionTipoCambio=?',
      [rate.version]
    );
    fixture.idRate = Number(rateRow.idTipoCambioSuscripcion);
    await paymentService.configurePaymentMethod({
      idAdministrador: fixture.idSuperadmin,
      idempotencyKey: `c5:${marker}:method`,
      reference: 'qr_manual',
      body: { activo: true, visiblePropietario: true, instrucciones: 'Configuracion sintetica C5.' },
      now
    });

    const active = await createStore(marker, 'active', now);
    const grace = await createStore(marker, 'grace', now, 'gracia');
    const suspended = await createStore(marker, 'suspended', now, 'suspendida');
    const upgrade = await createStore(marker, 'upgrade', now);
    const concurrent = await createStore(marker, 'concurrent', now);
    const rollback = await createStore(marker, 'rollback', now);
    const review = await createStore(marker, 'review', now);
    const httpStore = process.env.TEST_BASE_URL ? await createStore(marker, 'http', now) : null;
    fixture.stores.push(active, grace, suspended, upgrade, concurrent, rollback, review,
      ...(httpStore ? [httpStore] : []));

    const reviewReference = await createReadyRequest(paymentService, review,
      { plan: 'basico', periodo: 'mensual', operacion: 'renovacion', metodo: 'qr_manual' },
      `c5:${marker}:review-request`, now);
    const reviewService = createSaasCPaymentReviewService({ database: pool, clock: () => now });
    const observed = await reviewService.transition({
      idAdministrador: fixture.idSuperadmin,
      reference: reviewReference,
      decision: 'observada',
      body: { motivo: 'comprobante_ilegible', observacion: 'Comprobante sintetico ilegible.' },
      idempotencyKey: `c5:${marker}:observed`,
      now
    });
    assert.deepStrictEqual([observed.estado, observed.replayed], ['observada', false]);
    const observedReplay = await reviewService.transition({
      idAdministrador: fixture.idSuperadmin,
      reference: reviewReference,
      decision: 'observada',
      body: { motivo: 'comprobante_ilegible', observacion: 'Comprobante sintetico ilegible.' },
      idempotencyKey: `c5:${marker}:observed`,
      now
    });
    assert.strictEqual(observedReplay.replayed, true);
    const rejected = await reviewService.transition({
      idAdministrador: fixture.idSuperadmin,
      reference: reviewReference,
      decision: 'rechazada',
      body: { motivo: 'metodo_no_valido', observacion: 'Metodo sintetico no valido.' },
      idempotencyKey: `c5:${marker}:rejected`,
      now
    });
    assert.strictEqual(rejected.estado, 'rechazada');

    const activeRef = await createReadyRequest(paymentService, active,
      { plan: 'basico', periodo: 'mensual', operacion: 'renovacion', metodo: 'qr_manual' },
      `c5:${marker}:active-request`, now);
    const [[activeBefore]] = await pool.query(
      'SELECT fechaInicio,fechaFin FROM suscripcionTienda WHERE idTienda=? AND idSuscripcion=?',
      [active.idTienda, active.idSuscripcion]
    );
    const activeResult = await applicationService.apply({
      idAdministrador: fixture.idSuperadmin,
      reference: activeRef,
      idempotencyKey: `c5:${marker}:active-apply`,
      now
    });
    assert.strictEqual(activeResult.estado, 'aplicada');
    assert.strictEqual(activeResult.suscripcion.fechaInicio, formatLocalDateTime(parseLocalDateTime(activeBefore.fechaInicio)));
    assert.strictEqual(activeResult.suscripcion.fechaFin,
      formatLocalDateTime(addCalendarMonths(parseLocalDateTime(activeBefore.fechaFin), 1)));
    const activeReplay = await applicationService.apply({
      idAdministrador: fixture.idSuperadmin,
      reference: activeRef,
      idempotencyKey: `c5:${marker}:active-apply`,
      now
    });
    assert.strictEqual(activeReplay.replayed, true);
    assert.deepStrictEqual(await counts(active, activeRef), {
      aplicaciones: 1, historialPago: 1, revisiones: 1, auditorias: 1
    });
    const secondActiveRef = await createReadyRequest(paymentService, active,
      { plan: 'basico', periodo: 'mensual', operacion: 'renovacion', metodo: 'qr_manual' },
      `c5:${marker}:active-request-2`, now);
    await assert.rejects(() => applicationService.apply({
      idAdministrador: fixture.idSuperadmin,
      reference: secondActiveRef,
      idempotencyKey: `c5:${marker}:active-apply`,
      now
    }), (error) => error.code === 'PAYMENT_OPERATION_KEY_CONFLICT');

    const graceRef = await createReadyRequest(paymentService, grace,
      { plan: 'basico', periodo: 'trimestral', operacion: 'renovacion', metodo: 'qr_manual' },
      `c5:${marker}:grace-request`, now);
    await applicationService.apply({
      idAdministrador: fixture.idSuperadmin,
      reference: graceRef,
      idempotencyKey: `c5:${marker}:grace-apply`,
      now
    });
    const [[graceAfter]] = await pool.query(
      'SELECT estado,tipoPeriodoSnapshot FROM suscripcionTienda WHERE idTienda=?', [grace.idTienda]
    );
    assert.deepStrictEqual([graceAfter.estado, graceAfter.tipoPeriodoSnapshot], ['activa', 'trimestral']);

    const suspendedRef = await createReadyRequest(paymentService, suspended,
      { plan: 'basico', periodo: 'anual', operacion: 'reactivacion', metodo: 'qr_manual' },
      `c5:${marker}:suspended-request`, now);
    const suspendedResult = await applicationService.apply({
      idAdministrador: fixture.idSuperadmin,
      reference: suspendedRef,
      idempotencyKey: `c5:${marker}:suspended-apply`,
      now
    });
    assert.strictEqual(suspendedResult.suscripcion.fechaInicio, formatLocalDateTime(now));
    assert.strictEqual(suspendedResult.suscripcion.fechaFin, formatLocalDateTime(addCalendarMonths(now, 12)));

    const upgradeRef = await createReadyRequest(paymentService, upgrade,
      { plan: 'standard', periodo: 'mensual', operacion: 'upgrade', metodo: 'qr_manual' },
      `c5:${marker}:upgrade-request`, now);
    const [[commercialSnapshot]] = await pool.query(
      `SELECT s.idPrecioPlanPeriodo,s.precioBaseUSD,s.tipoCambioUsdBob,
              p.monto,p.actualizadoEn
       FROM solicitudPagoSuscripcion s
       JOIN precioPlanPeriodo p ON p.idPrecioPlanPeriodo=s.idPrecioPlanPeriodo
       WHERE s.idTienda=? AND s.referenciaPublica=?`,
      [upgrade.idTienda, upgradeRef]
    );
    fixture.priceSnapshot.push({
      idPrecioPlanPeriodo: commercialSnapshot.idPrecioPlanPeriodo,
      monto: commercialSnapshot.monto,
      actualizadoEn: commercialSnapshot.actualizadoEn
    });
    await pool.query(
      'UPDATE precioPlanPeriodo SET monto=monto+1,actualizadoEn=? WHERE idPrecioPlanPeriodo=?',
      [formatLocalDateTime(now), commercialSnapshot.idPrecioPlanPeriodo]
    );
    await pool.query(
      'UPDATE tipoCambioSuscripcion SET valor=valor+1,actualizadoEn=? WHERE idTipoCambioSuscripcion=?',
      [formatLocalDateTime(now), fixture.idRate]
    );
    const [[upgradeBefore]] = await pool.query(
      'SELECT fechaInicio,fechaFin FROM suscripcionTienda WHERE idTienda=?', [upgrade.idTienda]
    );
    await applicationService.apply({
      idAdministrador: fixture.idSuperadmin,
      reference: upgradeRef,
      idempotencyKey: `c5:${marker}:upgrade-apply`,
      now
    });
    const [[upgradeAfter]] = await pool.query(
      'SELECT planCodigoSnapshot,fechaInicio,fechaFin FROM suscripcionTienda WHERE idTienda=?', [upgrade.idTienda]
    );
    assert.strictEqual(upgradeAfter.planCodigoSnapshot, 'standard');
    assert.strictEqual(formatLocalDateTime(parseLocalDateTime(upgradeAfter.fechaInicio)),
      formatLocalDateTime(parseLocalDateTime(upgradeBefore.fechaInicio)));
    assert.strictEqual(formatLocalDateTime(parseLocalDateTime(upgradeAfter.fechaFin)),
      formatLocalDateTime(parseLocalDateTime(upgradeBefore.fechaFin)));
    const [[commercialAfter]] = await pool.query(
      'SELECT precioBaseUSD,tipoCambioUsdBob FROM solicitudPagoSuscripcion WHERE idTienda=? AND referenciaPublica=?',
      [upgrade.idTienda, upgradeRef]
    );
    assert.deepStrictEqual(
      [String(commercialAfter.precioBaseUSD), String(commercialAfter.tipoCambioUsdBob)],
      [String(commercialSnapshot.precioBaseUSD), String(commercialSnapshot.tipoCambioUsdBob)]
    );
    const [[frozenSnapshot]] = await pool.query(
      `SELECT s.limitePropietariosSnapshot,s.limiteProductosSnapshot,
              s.limiteClientesSnapshot,s.limiteProveedoresSnapshot,
        (SELECT COUNT(*) FROM suscripcionFuncionalidadSnapshot sf
         WHERE sf.idTienda=s.idTienda AND sf.idSuscripcion=s.idSuscripcion) funcionesSuscripcion,
        (SELECT COUNT(*) FROM solicitudPagoFuncionalidadSnapshot pf
         JOIN solicitudPagoSuscripcion p ON p.idTienda=pf.idTienda AND p.idSolicitudPago=pf.idSolicitudPago
         WHERE p.idTienda=s.idTienda AND p.referenciaPublica=?) funcionesSolicitud
       FROM suscripcionTienda s WHERE s.idTienda=? AND s.idSuscripcion=?`,
      [upgradeRef, upgrade.idTienda, upgrade.idSuscripcion]
    );
    const [[frozenRequest]] = await pool.query(
      `SELECT limitePropietariosSnapshot,limiteProductosSnapshot,
              limiteClientesSnapshot,limiteProveedoresSnapshot
       FROM solicitudPagoSuscripcion WHERE idTienda=? AND referenciaPublica=?`,
      [upgrade.idTienda, upgradeRef]
    );
    assert.deepStrictEqual(
      [frozenSnapshot.limitePropietariosSnapshot, frozenSnapshot.limiteProductosSnapshot,
        frozenSnapshot.limiteClientesSnapshot, frozenSnapshot.limiteProveedoresSnapshot].map((value) => value === null ? null : Number(value)),
      [frozenRequest.limitePropietariosSnapshot, frozenRequest.limiteProductosSnapshot,
        frozenRequest.limiteClientesSnapshot, frozenRequest.limiteProveedoresSnapshot].map((value) => value === null ? null : Number(value))
    );
    assert.strictEqual(Number(frozenSnapshot.funcionesSuscripcion), Number(frozenSnapshot.funcionesSolicitud));

    const concurrentRef = await createReadyRequest(paymentService, concurrent,
      { plan: 'basico', periodo: 'mensual', operacion: 'renovacion', metodo: 'qr_manual' },
      `c5:${marker}:concurrent-request`, now);
    const race = await Promise.all([
      applicationService.apply({ idAdministrador: fixture.idSuperadmin, reference: concurrentRef,
        idempotencyKey: `c5:${marker}:race-a`, now }),
      applicationService.apply({ idAdministrador: fixture.idSecondSuperadmin, reference: concurrentRef,
        idempotencyKey: `c5:${marker}:race-b`, now })
    ]);
    assert.strictEqual(race.filter((item) => item.replayed).length, 1);
    assert.deepStrictEqual(await counts(concurrent, concurrentRef), {
      aplicaciones: 1, historialPago: 1, revisiones: 1, auditorias: 1
    });

    const rollbackRef = await createReadyRequest(paymentService, rollback,
      { plan: 'basico', periodo: 'mensual', operacion: 'renovacion', metodo: 'qr_manual' },
      `c5:${marker}:rollback-request`, now);
    const rollbackService = createSaasCPaymentApplicationService({
      database: pool,
      clock: () => now,
      auditService: { recordCritical: async () => { throw new Error('fallo sintetico de auditoria'); } }
    });
    await assert.rejects(() => rollbackService.apply({
      idAdministrador: fixture.idSuperadmin,
      reference: rollbackRef,
      idempotencyKey: `c5:${marker}:rollback-apply`,
      now
    }), /fallo sintetico/);
    const [[rollbackState]] = await pool.query(
      `SELECT s.estado,
        (SELECT COUNT(*) FROM aplicacionPagoSuscripcion a WHERE a.idTienda=s.idTienda AND a.idSolicitudPago=s.idSolicitudPago) aplicaciones
       FROM solicitudPagoSuscripcion s WHERE s.idTienda=? AND s.referenciaPublica=?`,
      [rollback.idTienda, rollbackRef]
    );
    assert.deepStrictEqual([rollbackState.estado, Number(rollbackState.aplicaciones)], ['pendiente_revision', 0]);

    for (const state of ['pendiente_comprobante', 'observada', 'rechazada', 'cancelada', 'vencida']) {
      await pool.query(
        `UPDATE solicitudPagoSuscripcion SET estado=?,
           canceladaEn=IF(?='cancelada',?,NULL),aplicadaEn=NULL,ultimaTransicionEn=?,actualizadoEn=?
         WHERE idTienda=? AND referenciaPublica=?`,
        [state, state, formatLocalDateTime(now), formatLocalDateTime(now), formatLocalDateTime(now),
          rollback.idTienda, rollbackRef]
      );
      await assert.rejects(() => applicationService.apply({
        idAdministrador: fixture.idSuperadmin,
        reference: rollbackRef,
        idempotencyKey: `c5:${marker}:invalid-${state}`,
        now
      }), (error) => error.code === 'PAYMENT_APPLICATION_STATE_INVALID');
    }

    await assert.rejects(() => applicationService.apply({
      idAdministrador: active.idAdministrador,
      reference: activeRef,
      idempotencyKey: `c5:${marker}:owner-denied`,
      now
    }), (error) => error.code === 'SUPERADMIN_REQUIRED');

    if (httpStore) {
      const httpReference = await createReadyRequest(paymentService, httpStore,
        { plan: 'basico', periodo: 'mensual', operacion: 'renovacion', metodo: 'qr_manual' },
        `c5:${marker}:http-request`, now);
      const session = new Session(process.env.TEST_BASE_URL);
      const login = await session.request('/auth/login', {
        method: 'POST',
        body: { usuario: `aplicacion_c5_super_${marker}`, password: `C5-super-${marker}!` }
      });
      assert.strictEqual(login.status, 200, `Login HTTP C5: ${JSON.stringify(login.body)}`);
      const csrf = await session.request(
        `/api/admin/pagos-suscripcion/revision/${httpReference}/aplicar`,
        { method: 'POST', headers: { 'Idempotency-Key': `c5:${marker}:http-csrf` }, body: {} },
        false
      );
      assert.strictEqual(csrf.status, 403);
      const origin = await session.request(
        `/api/admin/pagos-suscripcion/revision/${httpReference}/aplicar`,
        {
          method: 'POST',
          headers: {
            'Idempotency-Key': `c5:${marker}:http-origin`,
            Origin: 'https://origen-invalido.example',
            'X-Requested-With': 'XMLHttpRequest'
          },
          body: {}
        },
        false
      );
      assert.strictEqual(origin.status, 403);
      const forbidden = await session.request(
        `/api/admin/pagos-suscripcion/revision/${httpReference}/aplicar`,
        { method: 'POST', headers: { 'Idempotency-Key': `c5:${marker}:http-forbidden` }, body: { idTienda: httpStore.idTienda } }
      );
      assert.strictEqual(forbidden.status, 400);
      const applied = await session.request(
        `/api/admin/pagos-suscripcion/revision/${httpReference}/aplicar`,
        { method: 'POST', headers: { 'Idempotency-Key': `c5:${marker}:http-apply` }, body: {} }
      );
      assert.strictEqual(applied.status, 200, `Aplicacion HTTP C5: ${JSON.stringify(applied.body)}`);
      assert.strictEqual(applied.body.estado, 'aplicada');
      assert.match(applied.headers.get('cache-control') || '', /no-store/);
      assert(!/idTienda|idSuscripcion|idPlan|idSolicitud/i.test(JSON.stringify(applied.body)));
    }
    console.log('test:saas-c-payment-applications OK');
  } finally {
    try { await cleanup(fixture); } finally { await pool.end(); }
  }
}

main().catch((error) => {
  console.error(`test:saas-c-payment-applications FAIL: ${error.message}`);
  process.exitCode = 1;
});
