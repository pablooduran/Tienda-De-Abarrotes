const assert = require('assert');
const crypto = require('crypto');
const { createDatabaseConnection } = require('../config/database-connection');
const { requireLocalhostDatabase } = require('../config/env');
const pool = require('../config/db');
const {
  computeEffectiveStatus,
  materializeSubscriptionLifecycle,
  reactivateSubscription,
  renewSubscription,
  suspendSubscription
} = require('../services/subscription-lifecycle-service');
const { createSubscription } = require('../services/subscription-service');

function expectError(action, code) {
  return action().then(
    () => { throw new Error(`Se esperaba el error ${code}.`); },
    (error) => assert.strictEqual(error.code, code)
  );
}

async function cleanup(connection, fixture) {
  await connection.beginTransaction();
  try {
    const [admins] = await connection.query(
      'SELECT idAdministrador FROM administrador WHERE idTienda=? OR usuario=?',
      [fixture.idTienda, fixture.adminUser]
    );
    const adminIds = admins.map((row) => Number(row.idAdministrador));
    if (adminIds.length) {
      await connection.query(
        'DELETE FROM eventoAuditoriaAdministrativa WHERE idTienda=? OR idAdministradorActor IN (?)',
        [fixture.idTienda, adminIds]
      );
    } else {
      await connection.query('DELETE FROM eventoAuditoriaAdministrativa WHERE idTienda=?', [fixture.idTienda]);
    }
    await connection.query('DELETE FROM operacionSuscripcionTienda WHERE idTienda=?', [fixture.idTienda]);
    await connection.query('DELETE FROM historialSuscripcionTienda WHERE idTienda=?', [fixture.idTienda]);
    await connection.query('DELETE FROM suscripcionFuncionalidadSnapshot WHERE idTienda=?', [fixture.idTienda]);
    await connection.query('DELETE FROM suscripcionTienda WHERE idTienda=?', [fixture.idTienda]);
    await connection.query('DELETE FROM administrador WHERE idTienda=? OR usuario=?', [fixture.idTienda, fixture.adminUser]);
    await connection.query('DELETE FROM tienda WHERE idTienda=?', [fixture.idTienda]);
    await connection.commit();
  } catch (error) {
    try { await connection.rollback(); } catch { /* La conexion puede estar cerrada. */ }
    throw error;
  }
}

async function main() {
  const config = { ...requireLocalhostDatabase('motor de ciclo de vida'), decimalNumbers: true };
  if (!/(prueba|test)/i.test(config.database)) {
    throw new Error('La prueba solo puede ejecutarse sobre una base local de prueba.');
  }
  const connection = await createDatabaseConnection(config);
  connection.release = () => {};
  const marker = crypto.randomBytes(8).toString('hex');
  const fixture = { adminUser: `lifecycle_engine_${marker}`, idTienda: null, idSuscripcion: null };
  const database = { getConnection: async () => connection };

  try {
    assert.strictEqual(computeEffectiveStatus({
      idSuscripcion: 1, estado: 'activa', fechaInicio: '2030-01-01 00:00:00', fechaFin: '2030-01-10 00:00:00'
    }, '2030-01-09 23:59:59'), 'activa');
    assert.strictEqual(computeEffectiveStatus({
      idSuscripcion: 1, estado: 'activa', fechaInicio: '2030-01-01 00:00:00', fechaFin: '2030-01-10 00:00:00'
    }, '2030-01-10 00:00:00'), 'gracia');
    assert.strictEqual(computeEffectiveStatus({
      idSuscripcion: 1, estado: 'gracia', fechaInicio: '2030-01-01 00:00:00', fechaFin: '2030-01-10 00:00:00', fechaFinGracia: '2030-01-17 00:00:00'
    }, '2030-01-17 00:00:00'), 'suspendida');
    assert.strictEqual(computeEffectiveStatus({ idSuscripcion: 1, estado: 'cancelada', fechaInicio: '2030-01-01', fechaFin: '2030-01-10' }, '2040-01-01'), 'cancelada');

    await connection.beginTransaction();
    const [storeResult] = await connection.query(
      `INSERT INTO tienda (nombre,slug,activo,estado,estadoOnboarding)
       VALUES (?, ?, 1, 'activa', 'completado')`,
      [`Lifecycle ${marker}`, `lifecycle-engine-${marker}`]
    );
    fixture.idTienda = Number(storeResult.insertId);
    const [adminResult] = await connection.query(
      `INSERT INTO administrador (idTienda,usuario,password,rol,activo,estadoAcceso)
       VALUES (?, ?, ?, 'dueno_tienda', 1, 'activo')`,
      [fixture.idTienda, fixture.adminUser, 'test-only-password-hash']
    );
    const idAdministrador = Number(adminResult.insertId);
    await connection.commit();

    const subscription = await createSubscription(connection, {
      idTienda: fixture.idTienda,
      planCodigo: 'basico',
      tipo: 'cortesia',
      fechaInicio: '2030-01-01 00:00:00',
      fechaFin: '2030-01-10 00:00:00',
      creadoPor: idAdministrador,
      actorTipo: 'administrador'
    });
    fixture.idSuscripcion = subscription.idSuscripcion;
    const [[beforeSnapshot]] = await connection.query(
      'SELECT COUNT(*) total FROM suscripcionFuncionalidadSnapshot WHERE idTienda=? AND idSuscripcion=?',
      [fixture.idTienda, fixture.idSuscripcion]
    );

    const grace = await materializeSubscriptionLifecycle(database, {
      idTienda: fixture.idTienda, idSuscripcion: fixture.idSuscripcion, now: '2030-01-10 00:00:00'
    });
    assert.strictEqual(grace.estado, 'gracia');
    assert.strictEqual(grace.transition, 'entrada_gracia');
    const graceRetry = await materializeSubscriptionLifecycle(database, {
      idTienda: fixture.idTienda, idSuscripcion: fixture.idSuscripcion, now: '2030-01-10 00:00:00'
    });
    assert.strictEqual(graceRetry.replayed, true);

    const suspended = await materializeSubscriptionLifecycle(database, {
      idTienda: fixture.idTienda, idSuscripcion: fixture.idSuscripcion, now: '2030-01-17 00:00:00'
    });
    assert.strictEqual(suspended.estado, 'suspendida');
    const reactivated = await reactivateSubscription(database, {
      idTienda: fixture.idTienda, idSuscripcion: fixture.idSuscripcion,
      claveOperacion: `reactivate-${marker}-one`, periodo: 'mensual', idAdministrador,
      now: '2030-01-18 00:00:00'
    });
    assert.strictEqual(reactivated.estado, 'activa');

    const manuallySuspended = await suspendSubscription(database, {
      idTienda: fixture.idTienda, idSuscripcion: fixture.idSuscripcion,
      claveOperacion: `suspend-${marker}-one`, motivoCodigo: 'seguridad', idAdministrador,
      now: '2030-01-19 00:00:00'
    });
    assert.strictEqual(manuallySuspended.estado, 'suspendida');
    const manualRetry = await suspendSubscription(database, {
      idTienda: fixture.idTienda, idSuscripcion: fixture.idSuscripcion,
      claveOperacion: `suspend-${marker}-one`, motivoCodigo: 'seguridad', idAdministrador,
      now: '2030-01-19 00:00:00'
    });
    assert.strictEqual(manualRetry.replayed, true);
    await expectError(() => suspendSubscription(database, {
      idTienda: fixture.idTienda, idSuscripcion: fixture.idSuscripcion,
      claveOperacion: `suspend-${marker}-one`, motivoCodigo: 'falta_pago', idAdministrador,
      now: '2030-01-19 00:00:00'
    }), 'OPERATION_KEY_CONFLICT');

    const activeAgain = await reactivateSubscription(database, {
      idTienda: fixture.idTienda, idSuscripcion: fixture.idSuscripcion,
      claveOperacion: `reactivate-${marker}-two`, periodo: 'mensual', idAdministrador,
      now: '2030-01-20 00:00:00'
    });
    assert.strictEqual(activeAgain.estado, 'activa');
    const renewed = await renewSubscription(database, {
      idTienda: fixture.idTienda, idSuscripcion: fixture.idSuscripcion,
      claveOperacion: `renew-${marker}-one`, periodo: 'mensual', actorTipo: 'sistema',
      now: '2030-01-21 00:00:00'
    });
    const renewedRetry = await renewSubscription(database, {
      idTienda: fixture.idTienda, idSuscripcion: fixture.idSuscripcion,
      claveOperacion: `renew-${marker}-one`, periodo: 'mensual', actorTipo: 'sistema',
      now: '2030-01-21 00:00:00'
    });
    assert.strictEqual(renewedRetry.replayed, true);
    await expectError(() => renewSubscription(database, {
      idTienda: fixture.idTienda, idSuscripcion: fixture.idSuscripcion,
      claveOperacion: `renew-${marker}-one`, periodo: 'anual', actorTipo: 'sistema',
      now: '2030-01-21 00:00:00'
    }), 'OPERATION_KEY_CONFLICT');
    assert(renewed.fechaFin > activeAgain.fechaFin, 'La renovacion no extendio la fecha fin.');

    const concurrent = await Promise.all([
      renewSubscription(pool, {
        idTienda: fixture.idTienda, idSuscripcion: fixture.idSuscripcion,
        claveOperacion: `renew-${marker}-concurrent`, periodo: 'mensual', actorTipo: 'sistema',
        now: '2030-01-22 00:00:00'
      }),
      renewSubscription(pool, {
        idTienda: fixture.idTienda, idSuscripcion: fixture.idSuscripcion,
        claveOperacion: `renew-${marker}-concurrent`, periodo: 'mensual', actorTipo: 'sistema',
        now: '2030-01-22 00:00:00'
      })
    ]);
    assert.strictEqual(concurrent.filter((item) => item.replayed).length, 1, 'La concurrencia no fue idempotente.');

    await expectError(() => renewSubscription(database, {
      idTienda: 1, idSuscripcion: fixture.idSuscripcion,
      claveOperacion: `cross-${marker}-one`, periodo: 'mensual', actorTipo: 'sistema',
      now: '2030-01-21 00:00:00'
    }), 'SUBSCRIPTION_NOT_FOUND');

    const [[afterSnapshot]] = await connection.query(
      'SELECT COUNT(*) total FROM suscripcionFuncionalidadSnapshot WHERE idTienda=? AND idSuscripcion=?',
      [fixture.idTienda, fixture.idSuscripcion]
    );
    assert.strictEqual(Number(afterSnapshot.total), Number(beforeSnapshot.total), 'El snapshot fue alterado.');
    const [[historyCount]] = await connection.query(
      'SELECT COUNT(*) total FROM historialSuscripcionTienda WHERE idTienda=? AND idSuscripcion=?',
      [fixture.idTienda, fixture.idSuscripcion]
    );
    assert.strictEqual(Number(historyCount.total), 8, 'Se duplico o falto una transicion.');
    const [[auditCount]] = await connection.query(
      `SELECT COUNT(*) total FROM eventoAuditoriaAdministrativa
       WHERE idTienda=? AND accion IN ('suspension_suscripcion','reactivacion_suscripcion')`,
      [fixture.idTienda]
    );
    assert.strictEqual(Number(auditCount.total), 3, 'La auditoria manual no coincide.');
    console.log('SAAS-B2: estado efectivo, gracia, suspension, reactivacion, renovacion, idempotencia, tenant y limpieza verificados.');
  } finally {
    try { await cleanup(connection, fixture); } finally {
      await connection.end();
      await pool.end();
    }
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
