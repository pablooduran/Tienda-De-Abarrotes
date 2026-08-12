const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const bcrypt = require('bcryptjs');
const { createDatabaseConnection } = require('../config/database-connection');
const { requireLocalhostDatabase } = require('../config/env');
const { createPrivateReceiptStorage } = require('../services/private-receipt-storage');
const { createSubscription } = require('../services/subscription-service');
const { addLocalDays, formatLocalDateTime, getLocalNow } = require('../utils/local-datetime');
const { applyTestRequestSecurity } = require('./http-test-security');

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
);
const JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAACAAIDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD8rZ55LmaSaaRpZZGLvI7EszE5JJPUmiiis6fwL0OvF/7xU/xP8z//2Q==',
  'base64'
);
const PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\nxref\n0 2\n0000000000 65535 f \n0000000009 00000 n \ntrailer\n<< /Root 1 0 R /Size 2 >>\nstartxref\n45\n%%EOF\n',
  'ascii'
);

class Session {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
    this.cookie = '';
    this.requestIds = [];
  }

  async request(route, options = {}, secure = true) {
    const request = { ...options, headers: { ...(options.headers || {}) } };
    const binary = Boolean(request.binary);
    delete request.binary;
    if (request.body && !(request.body instanceof FormData) && typeof request.body !== 'string') {
      request.headers['content-type'] = 'application/json';
      request.body = JSON.stringify(request.body);
    }
    if (secure) applyTestRequestSecurity(this.baseUrl, request);
    if (this.cookie) request.headers.cookie = this.cookie;
    const response = await fetch(`${this.baseUrl}${route}`, { ...request, redirect: 'manual' });
    const cookie = response.headers.get('set-cookie');
    if (cookie) this.cookie = cookie.split(';')[0];
    const requestId = response.headers.get('x-request-id');
    if (requestId) this.requestIds.push(requestId);
    return {
      status: response.status,
      body: binary ? Buffer.from(await response.arrayBuffer()) : await response.json().catch(() => ({})),
      headers: response.headers
    };
  }
}

async function expect(session, route, options, status, label, secure = true) {
  const response = await session.request(route, options, secure);
  assert.strictEqual(response.status, status, `${label}: HTTP ${response.status} ${JSON.stringify(response.body)}`);
  return response;
}

function uploadBody(buffer, name, mime) {
  const body = new FormData();
  body.append('comprobante', new Blob([buffer], { type: mime }), name);
  return body;
}

async function createStore(connection, marker, suffix) {
  const now = getLocalNow();
  const password = `Receipt-${marker}-${suffix}-Password!`;
  const user = `receipt_owner_${suffix}_${marker}`;
  const [store] = await connection.query(
    `INSERT INTO tienda (nombre,slug,activo,estado,estadoOnboarding,onboardingCompletadoEn)
     VALUES (?, ?,1,'activa','completado',?)`,
    [`Receipt test ${suffix} ${marker}`, `receipt-test-${suffix}-${marker}`, formatLocalDateTime(now)]
  );
  const idTienda = Number(store.insertId);
  const [owner] = await connection.query(
    `INSERT INTO administrador
      (idTienda,usuario,password,rol,activo,estadoAcceso,versionSesion)
     VALUES (?, ?, ?,'dueno_tienda',1,'activo',1)`,
    [idTienda, user, await bcrypt.hash(password, 12)]
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
  return { idTienda, idAdministrador: Number(owner.insertId), idSuscripcion: subscription.idSuscripcion, user, password };
}

async function paymentMethodSnapshot(connection) {
  const [rows] = await connection.query(
    `SELECT idMetodoPagoSuscripcion,instrucciones,configurado,visiblePropietario,
            activo,configuradoPor,actualizadoEn FROM metodoPagoSuscripcion`
  );
  return rows;
}

async function restoreMethods(connection, rows) {
  for (const row of rows) {
    await connection.query(
      `UPDATE metodoPagoSuscripcion SET instrucciones=?,configurado=?,visiblePropietario=?,
         activo=?,configuradoPor=?,actualizadoEn=? WHERE idMetodoPagoSuscripcion=?`,
      [row.instrucciones, row.configurado, row.visiblePropietario, row.activo,
        row.configuradoPor, row.actualizadoEn, row.idMetodoPagoSuscripcion]
    );
  }
}

async function cleanup(connection, fixture, methodRows, sessions, storage) {
  const ids = fixture.stores.map((item) => item.idTienda);
  const admins = [fixture.idSuperadmin, ...fixture.stores.map((item) => item.idAdministrador)].filter(Boolean);
  const [objects] = ids.length
    ? await connection.query('SELECT claveAlmacenamiento FROM comprobantePagoSuscripcion WHERE idTienda IN (?)', [ids])
    : [[]];
  for (const object of objects) await storage.remove(object.claveAlmacenamiento).catch(() => {});
  await connection.beginTransaction();
  try {
    if (ids.length || admins.length) {
      await connection.query(
        'DELETE FROM eventoAuditoriaAdministrativa WHERE idTienda IN (?) OR idAdministradorActor IN (?)',
        [ids.length ? ids : [-1], admins.length ? admins : [-1]]
      );
      await connection.query(
        'DELETE FROM operacionPagoSuscripcion WHERE idTienda IN (?) OR idAdministradorActor IN (?)',
        [ids.length ? ids : [-1], admins.length ? admins : [-1]]
      );
    }
    for (const idTienda of ids) {
      await connection.query('DELETE FROM comprobantePagoSuscripcion WHERE idTienda=?', [idTienda]);
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
    if (fixture.idSuperadmin) {
      await connection.query('DELETE FROM tipoCambioSuscripcion WHERE registradoPor=?', [fixture.idSuperadmin]);
      await restoreMethods(connection, methodRows);
      await connection.query('DELETE FROM administrador WHERE idAdministrador=?', [fixture.idSuperadmin]);
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  }
  for (const session of sessions) session.cookie = '';
}

function paymentBody() {
  return { plan: 'basico', periodo: 'mensual', operacion: 'renovacion', metodo: 'qr_manual' };
}

async function main() {
  const config = { ...requireLocalhostDatabase('prueba de comprobantes SAAS-C3'), decimalNumbers: true };
  if (!/(prueba|test)/i.test(config.database)) throw new Error('La prueba requiere una base local de pruebas.');
  const root = path.resolve(process.env.PAYMENT_RECEIPT_STORAGE_DIR || '');
  const relativeTemp = path.relative(os.tmpdir(), root);
  if (!process.env.PAYMENT_RECEIPT_STORAGE_DIR || relativeTemp.startsWith('..')
    || !path.basename(root).startsWith('tienda-saas-c3-http-')) {
    throw new Error('PAYMENT_RECEIPT_STORAGE_DIR debe ser una carpeta temporal atribuible a SAAS-C3.');
  }
  const connection = await createDatabaseConnection(config);
  const storage = createPrivateReceiptStorage({ rootDirectory: root });
  const baseUrl = process.env.TEST_BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
  const marker = crypto.randomBytes(6).toString('hex');
  const methodRows = await paymentMethodSnapshot(connection);
  const sessions = [new Session(baseUrl), new Session(baseUrl), new Session(baseUrl), new Session(baseUrl)];
  const fixture = { idSuperadmin: null, stores: [] };
  try {
    const superUser = `receipt_super_${marker}`;
    const superPassword = `Receipt-Super-${marker}-Password!`;
    const [superadmin] = await connection.query(
      `INSERT INTO administrador
        (idTienda,usuario,password,rol,activo,estadoAcceso,versionSesion)
       VALUES (NULL,?,?,'superadmin',1,'activo',1)`,
      [superUser, await bcrypt.hash(superPassword, 12)]
    );
    fixture.idSuperadmin = Number(superadmin.insertId);
    fixture.stores.push(await createStore(connection, marker, 'a'));
    fixture.stores.push(await createStore(connection, marker, 'b'));
    await expect(sessions[0], '/auth/login', { method: 'POST', body: { usuario: superUser, password: superPassword } }, 200, 'Login superadmin');
    for (let index = 0; index < fixture.stores.length; index += 1) {
      await expect(sessions[index + 1], '/auth/login', {
        method: 'POST', body: { usuario: fixture.stores[index].user, password: fixture.stores[index].password }
      }, 200, `Login propietario ${index + 1}`);
    }
    const [[activeRate]] = await connection.query(
      "SELECT COUNT(*) total FROM tipoCambioSuscripcion WHERE monedaOrigen='USD' AND monedaDestino='BOB' AND activo=1"
    );
    if (Number(activeRate.total)) throw new Error('La prueba no modifica una tasa activa preexistente.');
    await expect(sessions[0], '/api/admin/pagos-suscripcion/tipos-cambio', {
      method: 'POST', headers: { 'Idempotency-Key': `receipt:${marker}:rate` },
      body: { valor: '7.00000000', fuente: 'Fuente sintetica C3' }
    }, 201, 'Tasa sintetica');
    await expect(sessions[0], '/api/admin/pagos-suscripcion/metodos/qr_manual', {
      method: 'PATCH', headers: { 'Idempotency-Key': `receipt:${marker}:method` },
      body: { activo: true, visiblePropietario: true, instrucciones: 'Configuracion sintetica C3.' }
    }, 200, 'Metodo sintetico');
    const created = await expect(sessions[1], '/api/pagos-suscripcion/solicitudes', {
      method: 'POST', headers: { 'Idempotency-Key': `receipt:${marker}:request` }, body: paymentBody()
    }, 201, 'Solicitud base');
    const reference = created.body.referencia;
    const secondRequest = await expect(sessions[2], '/api/pagos-suscripcion/solicitudes', {
      method: 'POST', headers: { 'Idempotency-Key': `receipt:${marker}:request-b` }, body: paymentBody()
    }, 201, 'Solicitud concurrente base');
    const concurrentKey = `receipt:${marker}:concurrent`;
    const concurrentUploads = await Promise.all([
      sessions[2].request(`/api/pagos-suscripcion/solicitudes/${secondRequest.body.referencia}/comprobantes`, {
        method: 'POST', headers: { 'Idempotency-Key': concurrentKey },
        body: uploadBody(PDF, 'concurrente.pdf', 'application/pdf')
      }),
      sessions[2].request(`/api/pagos-suscripcion/solicitudes/${secondRequest.body.referencia}/comprobantes`, {
        method: 'POST', headers: { 'Idempotency-Key': concurrentKey },
        body: uploadBody(PDF, 'concurrente.pdf', 'application/pdf')
      })
    ]);
    assert.deepStrictEqual(concurrentUploads.map((item) => item.status).sort(), [200, 201]);
    assert.strictEqual(concurrentUploads.filter((item) => item.body.comprobante.replayed).length, 1);
    const [[concurrentCount]] = await connection.query(
      'SELECT COUNT(*) total FROM comprobantePagoSuscripcion WHERE idTienda=?',
      [fixture.stores[1].idTienda]
    );
    assert.strictEqual(Number(concurrentCount.total), 1);
    const [[snapshotBefore]] = await connection.query(
      `SELECT planActualCodigoSnapshot,planCodigoSnapshot,precioBaseUSD,tipoCambioUsdBob,
              montoFinalBOB,periodo,metodoCodigoSnapshot
       FROM solicitudPagoSuscripcion WHERE idTienda=? AND referenciaPublica=?`,
      [fixture.stores[0].idTienda, reference]
    );

    await expect(sessions[1], `/api/pagos-suscripcion/solicitudes/${reference}/comprobantes`, {
      method: 'POST', headers: { 'Idempotency-Key': `receipt:${marker}:empty` }, body: new FormData()
    }, 400, 'Archivo vacio');
    await expect(sessions[1], `/api/pagos-suscripcion/solicitudes/${reference}/comprobantes`, {
      method: 'POST', headers: { 'Idempotency-Key': `receipt:${marker}:large` },
      body: uploadBody(Buffer.alloc(5 * 1024 * 1024 + 1), 'grande.pdf', 'application/pdf')
    }, 413, 'Limite de archivo');
    await expect(sessions[1], `/api/pagos-suscripcion/solicitudes/${reference}/comprobantes`, {
      method: 'POST', headers: { 'Idempotency-Key': `receipt:${marker}:mime` },
      body: uploadBody(PNG, 'falso.png', 'application/pdf')
    }, 400, 'MIME falso');
    await expect(sessions[1], `/api/pagos-suscripcion/solicitudes/${reference}/comprobantes`, {
      method: 'POST', headers: { 'Idempotency-Key': `receipt:${marker}:extension` },
      body: uploadBody(PNG, 'falso.pdf', 'image/png')
    }, 400, 'Extension falsa');
    await expect(sessions[1], `/api/pagos-suscripcion/solicitudes/${reference}/comprobantes`, {
      method: 'POST', headers: { 'Idempotency-Key': `receipt:${marker}:csrf` },
      body: uploadBody(PDF, 'csrf.pdf', 'application/pdf')
    }, 403, 'CSRF', false);

    const firstKey = `receipt:${marker}:pdf`;
    const first = await expect(sessions[1], `/api/pagos-suscripcion/solicitudes/${reference}/comprobantes`, {
      method: 'POST', headers: { 'Idempotency-Key': firstKey },
      body: uploadBody(PDF, 'pago inicial.pdf', 'application/pdf')
    }, 201, 'PDF valido');
    assert.strictEqual(first.body.estadoSolicitud, 'pendiente_revision');
    assert.strictEqual(first.body.comprobante.version, 1);
    const replay = await expect(sessions[1], `/api/pagos-suscripcion/solicitudes/${reference}/comprobantes`, {
      method: 'POST', headers: { 'Idempotency-Key': firstKey },
      body: uploadBody(PDF, 'pago inicial.pdf', 'application/pdf')
    }, 200, 'Replay de carga');
    assert.strictEqual(replay.body.comprobante.replayed, true);
    await expect(sessions[1], `/api/pagos-suscripcion/solicitudes/${reference}/comprobantes`, {
      method: 'POST', headers: { 'Idempotency-Key': firstKey },
      body: uploadBody(JPEG, 'otro.jpg', 'image/jpeg')
    }, 409, 'Conflicto de idempotencia');

    const firstDownload = await expect(
      sessions[1],
      `/api/pagos-suscripcion/solicitudes/${reference}/comprobantes/${first.body.comprobante.referencia}`,
      { binary: true }, 200, 'Descarga autenticada'
    );
    assert(firstDownload.body.equals(PDF));
    assert.match(firstDownload.headers.get('cache-control') || '', /no-store/);
    assert.strictEqual(firstDownload.headers.get('x-content-type-options'), 'nosniff');
    await expect(
      sessions[3],
      `/api/pagos-suscripcion/solicitudes/${reference}/comprobantes/${first.body.comprobante.referencia}`,
      { binary: true }, 401, 'Descarga sin sesion'
    );
    await expect(
      sessions[2],
      `/api/pagos-suscripcion/solicitudes/${reference}/comprobantes/${first.body.comprobante.referencia}`,
      {}, 404, 'Descarga cruzada'
    );
    await expect(sessions[2], `/api/pagos-suscripcion/solicitudes/${reference}/comprobantes`, {}, 404, 'Metadata cruzada');

    await connection.query(
      `UPDATE solicitudPagoSuscripcion SET estado='observada',venceEn=DATE_ADD(NOW(), INTERVAL 72 HOUR),
         ultimaTransicionEn=NOW(),actualizadoEn=NOW() WHERE idTienda=? AND referenciaPublica=?`,
      [fixture.stores[0].idTienda, reference]
    );
    const second = await expect(sessions[1], `/api/pagos-suscripcion/solicitudes/${reference}/comprobantes`, {
      method: 'POST', headers: { 'Idempotency-Key': `receipt:${marker}:jpeg` },
      body: uploadBody(JPEG, 'correccion.jpg', 'image/jpeg')
    }, 201, 'JPEG valido');
    assert.strictEqual(second.body.comprobante.version, 2);
    await connection.query(
      `UPDATE solicitudPagoSuscripcion SET estado='observada',venceEn=DATE_ADD(NOW(), INTERVAL 72 HOUR),
         ultimaTransicionEn=NOW(),actualizadoEn=NOW() WHERE idTienda=? AND referenciaPublica=?`,
      [fixture.stores[0].idTienda, reference]
    );
    const third = await expect(sessions[1], `/api/pagos-suscripcion/solicitudes/${reference}/comprobantes`, {
      method: 'POST', headers: { 'Idempotency-Key': `receipt:${marker}:png` },
      body: uploadBody(PNG, 'correccion final.png', 'image/png')
    }, 201, 'PNG valido');
    assert.strictEqual(third.body.comprobante.version, 3);
    await expect(sessions[1], `/api/pagos-suscripcion/solicitudes/${reference}/comprobantes`, {
      method: 'POST', headers: { 'Idempotency-Key': `receipt:${marker}:invalid-state` },
      body: uploadBody(PNG, 'fuera estado.png', 'image/png')
    }, 409, 'Estado incompatible');

    const metadata = await expect(sessions[1], `/api/pagos-suscripcion/solicitudes/${reference}/comprobantes`, {}, 200, 'Metadata');
    assert.strictEqual(metadata.body.comprobantes.length, 3);
    assert.strictEqual(metadata.body.comprobantes.filter((item) => item.activo).length, 1);
    assert(!/idTienda|idSolicitud|claveAlmacenamiento|hashSha256/i.test(JSON.stringify(metadata.body)));
    assert.match(metadata.headers.get('cache-control') || '', /no-store/);
    const latestDownload = await expect(
      sessions[1],
      `/api/pagos-suscripcion/solicitudes/${reference}/comprobantes/${third.body.comprobante.referencia}`,
      { binary: true }, 200, 'Descarga vigente'
    );
    assert(latestDownload.body.equals(PNG));

    const [[effects], [snapshotRows]] = await Promise.all([
      connection.query(
        `SELECT
          (SELECT COUNT(*) FROM comprobantePagoSuscripcion WHERE idTienda=? AND idSolicitudActiva IS NOT NULL) activos,
          (SELECT COUNT(*) FROM historialSolicitudPagoSuscripcion WHERE idTienda=? AND evento IN ('comprobante_cargado','comprobante_reemplazado')) historial,
          (SELECT COUNT(*) FROM eventoAuditoriaAdministrativa WHERE idTienda=? AND accion='carga_comprobante_pago_suscripcion') auditorias`,
        [fixture.stores[0].idTienda, fixture.stores[0].idTienda, fixture.stores[0].idTienda]
      ),
      connection.query(
        `SELECT planActualCodigoSnapshot,planCodigoSnapshot,precioBaseUSD,tipoCambioUsdBob,
                montoFinalBOB,periodo,metodoCodigoSnapshot
         FROM solicitudPagoSuscripcion WHERE idTienda=? AND referenciaPublica=?`,
        [fixture.stores[0].idTienda, reference]
      )
    ]);
    assert.deepStrictEqual([effects[0].activos, effects[0].historial, effects[0].auditorias].map(Number), [1, 3, 3]);
    assert.deepStrictEqual(snapshotRows[0], snapshotBefore);
    console.log('test:saas-c-payment-receipts OK');
  } finally {
    for (const session of sessions) {
      try { if (session.cookie) await session.request('/auth/logout', { method: 'POST' }); } catch { /* cleanup continua */ }
    }
    try {
      await cleanup(connection, fixture, methodRows, sessions, storage);
    } finally {
      await connection.end();
      await fs.promises.rm(root, { recursive: true, force: true });
    }
  }
}

main().catch((error) => {
  console.error(`test:saas-c-payment-receipts FAIL: ${error.message}`);
  process.exitCode = 1;
});
