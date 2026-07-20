const { databaseConfig, databaseTarget, logDatabaseTarget } = require('../config/env');
const { createConnection } = require('./db-utils');
const { inspectAllLegacyMigrations } = require('./migration-state/legacy-migrations');

const BLOCKING_STATES = new Set(['parcial-bloqueante', 'inconsistente']);

async function main() {
  const config = databaseConfig();
  logDatabaseTarget('Comprobacion de migraciones historicas 001-003', config);
  const connection = await createConnection();
  try {
    const migrations = await inspectAllLegacyMigrations(connection, {
      schemaName: config.database
    });
    const blocking = migrations.filter((migration) => BLOCKING_STATES.has(migration.estado)
      || !migration.datosValidos);
    const summary = {
      destino: {
        entorno: String(process.env.APP_ENV || 'predeterminado'),
        base: config.database,
        conexion: databaseTarget(config)
      },
      soloLectura: true,
      nombresNormalizados: true,
      migraciones: migrations,
      resumen: {
        pre: migrations.filter((migration) => migration.estado === 'pre').length,
        parcialesRecuperables: migrations.filter(
          (migration) => migration.estado === 'parcial-recuperable'
        ).length,
        parcialesBloqueantes: migrations.filter(
          (migration) => migration.estado === 'parcial-bloqueante'
        ).length,
        completasNoRegistradas: migrations.filter(
          (migration) => migration.estado === 'completa-no-registrada'
        ).length,
        post: migrations.filter((migration) => migration.estado === 'post').length,
        inconsistentes: migrations.filter((migration) => migration.estado === 'inconsistente').length,
        requiereIntervencion: blocking.length > 0
      }
    };
    console.log(JSON.stringify(summary, null, 2));
    if (blocking.length) process.exitCode = 1;
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error('No se pudieron comprobar las migraciones historicas.');
  console.error(error.message);
  process.exit(1);
});
