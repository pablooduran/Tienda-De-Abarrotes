const mysql = require('mysql2/promise');
const { databaseTarget, requireLocalhostDatabase } = require('../config/env');

const expectedTables = ['plan', 'funcionalidad', 'planFuncionalidad', 'suscripcionTienda'];

async function tableExists(connection, table) {
  const [[row]] = await connection.query(
    `SELECT COUNT(*) total FROM information_schema.TABLES
     WHERE TABLE_SCHEMA=? AND TABLE_NAME=?`,
    [process.env.DB_NAME, table]
  );
  return Number(row.total) > 0;
}

async function main() {
  const config = { ...requireLocalhostDatabase('La comprobacion de suscripciones'), decimalNumbers: true };
  const connection = await mysql.createConnection(config);
  try {
    const tableState = {};
    for (const table of expectedTables) tableState[table] = await tableExists(connection, table);
    const structureComplete = Object.values(tableState).every(Boolean);
    let migrationRecorded = false;
    if (await tableExists(connection, 'schema_migrations')) {
      const [[row]] = await connection.query(
        "SELECT COUNT(*) total FROM schema_migrations WHERE nombre='005_planes_suscripciones.sql'"
      );
      migrationRecorded = Number(row.total) > 0;
    }

    if (!structureComplete) {
      console.log(JSON.stringify({
        destino: databaseTarget(config),
        estado: 'pre-migracion-o-estructura-parcial',
        migracion005Registrada: migrationRecorded,
        tablas: tableState
      }, null, 2));
      return;
    }

    const [plans] = await connection.query(
      `SELECT codigo, nombre, activo, duracionDias, limitePropietarios,
         limiteProductos, limiteClientes, limiteProveedores
       FROM plan ORDER BY idPlan`
    );
    const requiredPlanCodes = new Set(plans.map((plan) => plan.codigo));
    const requiredPlansPresent = ['basico', 'avanzado'].every((code) => requiredPlanCodes.has(code));
    const [[features]] = await connection.query(
      `SELECT COUNT(DISTINCT codigo) total FROM funcionalidad
       WHERE codigo IN ('reportes_avanzados','compras_sugeridas','historial_stock','recibos_whatsapp','recordatorios_fiado','gastos','cierre_caja','vencimientos_lote','portal_clientes')`
    );
    const requiredFeaturesPresent = Number(features.total) === 9;
    const [[withoutSubscription]] = await connection.query(
      `SELECT COUNT(*) total FROM tienda t
       WHERE NOT EXISTS (SELECT 1 FROM suscripcionTienda s WHERE s.idTienda=t.idTienda)`
    );
    const [[invalidDates]] = await connection.query(
      'SELECT COUNT(*) total FROM suscripcionTienda WHERE fechaFin<=fechaInicio'
    );
    const [[overlaps]] = await connection.query(
      `SELECT COUNT(*) total
       FROM suscripcionTienda a
       JOIN suscripcionTienda b ON b.idTienda=a.idTienda AND b.idSuscripcion>a.idSuscripcion
       WHERE a.estado IN ('pendiente','activa')
         AND b.estado IN ('pendiente','activa')
         AND a.fechaInicio<b.fechaFin AND b.fechaInicio<a.fechaFin`
    );
    const [statusRows] = await connection.query(
      `SELECT
         CASE
           WHEN estado IN ('activa','pendiente') AND CURRENT_TIMESTAMP>=fechaFin THEN 'vencida'
           WHEN estado IN ('activa','pendiente') AND CURRENT_TIMESTAMP<fechaInicio THEN 'pendiente'
           WHEN estado='pendiente' THEN 'activa'
           ELSE estado
         END estadoEfectivo,
         COUNT(*) total
       FROM suscripcionTienda
       GROUP BY estadoEfectivo ORDER BY estadoEfectivo`
    );
    const [stores] = await connection.query(
      `SELECT t.idTienda, t.nombre, t.slug, p.codigo AS planCodigo,
         s.tipo, s.estado, s.fechaInicio, s.fechaFin
       FROM tienda t
       LEFT JOIN suscripcionTienda s ON s.idSuscripcion=(
         SELECT s2.idSuscripcion FROM suscripcionTienda s2
         WHERE s2.idTienda=t.idTienda ORDER BY s2.idSuscripcion DESC LIMIT 1
       )
       LEFT JOIN plan p ON p.idPlan=s.idPlan
       ORDER BY t.idTienda`
    );

    const problems = (requiredPlansPresent ? 0 : 1)
      + (requiredFeaturesPresent ? 0 : 1)
      + Number(withoutSubscription.total)
      + Number(invalidDates.total)
      + Number(overlaps.total);
    console.log(JSON.stringify({
      destino: databaseTarget(config),
      estado: migrationRecorded && problems === 0 ? 'post-migracion' : 'estructura-incompleta-o-inconsistente',
      migracion005Registrada: migrationRecorded,
      tablas: tableState,
      planes: plans,
      planesRequeridosPresentes: requiredPlansPresent,
      funcionalidadesRequeridasPresentes: requiredFeaturesPresent,
      tiendasSinSuscripcion: Number(withoutSubscription.total),
      suscripcionesConFechasInvalidas: Number(invalidDates.total),
      suscripcionesOperativasSuperpuestas: Number(overlaps.total),
      suscripcionesPorEstado: statusRows,
      tiendas: stores
    }, null, 2));
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error('No se pudo comprobar la estructura de suscripciones.');
  console.error(error.message);
  process.exit(1);
});
