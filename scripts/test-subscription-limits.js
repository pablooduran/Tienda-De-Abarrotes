const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { limitAvailability, PLAN_LIMIT_KEYS } = require('../config/subscription-plan-change-contract');
const { createDatabaseConnection } = require('../config/database-connection');
const { requireLocalhostDatabase } = require('../config/env');
const { createSubscription, enforcePlanLimit } = require('../services/subscription-service');
const { addLocalDays, formatLocalDateTime, getLocalNow } = require('../utils/local-datetime');

async function attemptProduct(config, idTienda, name) {
  const connection = await createDatabaseConnection(config);
  try {
    await connection.beginTransaction();
    await connection.query('SELECT idTienda FROM tienda WHERE idTienda=? FOR UPDATE', [idTienda]);
    await enforcePlanLimit(connection, idTienda, 'productos');
    await connection.query(
      `INSERT INTO producto
        (idTienda,nombre,precioVenta,unidadesPorPaquete,permiteVentaPorPaquete,
         permiteVentaPorUnidad,fechaInicioSeguimiento)
       VALUES (?, ?, 1, 1, 0, 1, ?)`,
      [idTienda, name, formatLocalDateTime()]
    );
    await connection.commit();
    return true;
  } catch (error) {
    try { await connection.rollback(); } catch { /* La conexion puede estar cerrada. */ }
    throw error;
  } finally {
    await connection.end();
  }
}

async function main() {
  assert.deepStrictEqual(PLAN_LIMIT_KEYS, ['propietarios', 'productos', 'clientes', 'proveedores']);
  const availability = limitAvailability(
    { propietarios: 1, productos: 2, clientes: 3, proveedores: null },
    { propietarios: 0, productos: 2, clientes: 4, proveedores: 900 }
  );
  assert.strictEqual(availability.propietarios.permiteAlta, true);
  assert.strictEqual(availability.productos.alcanzado, true);
  assert.strictEqual(availability.productos.permiteAlta, false);
  assert.strictEqual(availability.clientes.excedido, true);
  assert.strictEqual(availability.clientes.permiteAlta, false);
  assert.strictEqual(availability.proveedores.limite, null);
  assert.strictEqual(availability.proveedores.permiteAlta, true);

  const root = path.join(__dirname, '..');
  const guardedSources = [
    ['routes/api.js', ['productos', 'proveedores']],
    ['routes/customers-credit.js', ['clientes']],
    ['routes/admin.js', ['propietarios']],
    ['routes/master-catalog.js', ['productos']]
  ];
  for (const [file, limits] of guardedSources) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    for (const limit of limits) {
      assert(source.includes(`enforcePlanLimit(connection, idTienda, '${limit}'`)
        || source.includes(`enforcePlanLimit(connection, owners[0].idTienda, '${limit}'`)
        || source.includes(`enforcePlanLimit(connection, storeResult.insertId, '${limit}'`),
      `${file} no aplica el limite ${limit} dentro de su operacion.`);
    }
  }
  const subscriptionService = fs.readFileSync(path.join(root, 'services/subscription-service.js'), 'utf8');
  assert(subscriptionService.includes('Snapshot AS limiteProductos'), 'Los limites no se leen desde el snapshot vigente.');

  const config = { ...requireLocalhostDatabase('concurrencia de limites'), decimalNumbers: true };
  if (!/(prueba|test)/i.test(config.database)) throw new Error('La prueba requiere una base local de prueba.');
  const connection = await createDatabaseConnection(config);
  const marker = crypto.randomBytes(7).toString('hex');
  let idTienda = null;
  try {
    await connection.beginTransaction();
    const [store] = await connection.query(
      `INSERT INTO tienda (nombre,slug,activo,estado,estadoOnboarding)
       VALUES (?, ?, 1, 'activa', 'completado')`,
      [`Limit race ${marker}`, `limit-race-${marker}`]
    );
    idTienda = Number(store.insertId);
    const [admin] = await connection.query(
      `INSERT INTO administrador (idTienda,usuario,password,rol,activo,estadoAcceso)
       VALUES (?, ?, 'test-only-hash', 'dueno_tienda', 1, 'activo')`,
      [idTienda, `limit_race_${marker}`]
    );
    const now = getLocalNow();
    const subscription = await createSubscription(connection, {
      idTienda,
      planCodigo: 'basico',
      tipo: 'cortesia',
      fechaInicio: formatLocalDateTime(addLocalDays(now, -1)),
      fechaFin: formatLocalDateTime(addLocalDays(now, 30)),
      creadoPor: Number(admin.insertId),
      actorTipo: 'administrador'
    });
    await connection.query(
      `UPDATE suscripcionTienda SET limiteProductosSnapshot=1
       WHERE idTienda=? AND idSuscripcion=?`,
      [idTienda, subscription.idSuscripcion]
    );
    await connection.commit();

    const attempts = await Promise.allSettled([
      attemptProduct(config, idTienda, `Producto A ${marker}`),
      attemptProduct(config, idTienda, `Producto B ${marker}`)
    ]);
    assert.strictEqual(attempts.filter((item) => item.status === 'fulfilled').length, 1);
    const rejected = attempts.find((item) => item.status === 'rejected');
    assert.strictEqual(rejected.reason.code, 'PLAN_LIMIT_REACHED');
    const [[products]] = await connection.query('SELECT COUNT(*) total FROM producto WHERE idTienda=?', [idTienda]);
    assert.strictEqual(Number(products.total), 1, 'Dos altas consumieron el unico cupo disponible.');
  } finally {
    if (idTienda) {
      await connection.beginTransaction();
      try {
        await connection.query('DELETE FROM producto WHERE idTienda=?', [idTienda]);
        await connection.query('DELETE FROM eventoAuditoriaAdministrativa WHERE idTienda=?', [idTienda]);
        await connection.query('DELETE FROM operacionSuscripcionTienda WHERE idTienda=?', [idTienda]);
        await connection.query('DELETE FROM historialSuscripcionTienda WHERE idTienda=?', [idTienda]);
        await connection.query('DELETE FROM suscripcionFuncionalidadSnapshot WHERE idTienda=?', [idTienda]);
        await connection.query('DELETE FROM suscripcionTienda WHERE idTienda=?', [idTienda]);
        await connection.query('DELETE FROM configuracionTienda WHERE idTienda=?', [idTienda]);
        await connection.query('DELETE FROM administrador WHERE idTienda=?', [idTienda]);
        await connection.query('DELETE FROM tienda WHERE idTienda=?', [idTienda]);
        await connection.commit();
      } catch (error) {
        await connection.rollback();
        throw error;
      }
    }
    await connection.end();
  }
  console.log('test:subscription-limits OK');
}

main().catch((error) => {
  console.error(`test:subscription-limits FAIL: ${error.message}`);
  process.exitCode = 1;
});
