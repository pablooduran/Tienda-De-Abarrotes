const { databaseConfig, databaseTarget, logDatabaseTarget } = require('../config/env');
const { createConnection } = require('./db-utils');

const MIGRATION = '013_seguridad_sesiones.sql';

function identifier(value) {
  return String(value || '').toLocaleLowerCase('en-US');
}

async function count(connection, sql, params = []) {
  const [[row]] = await connection.query(sql, params);
  return Number(row.total || 0);
}

async function hasTable(connection, table) {
  return count(connection,
    `SELECT COUNT(*) total FROM information_schema.TABLES
     WHERE TABLE_SCHEMA=? AND LOWER(TABLE_NAME)=LOWER(?)`,
    [process.env.DB_NAME, table]).then((total) => total > 0);
}

async function columnDetails(connection, table, column) {
  const [rows] = await connection.query(
    `SELECT COLUMN_NAME, DATA_TYPE, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, EXTRA
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA=? AND LOWER(TABLE_NAME)=LOWER(?) AND LOWER(COLUMN_NAME)=LOWER(?)`,
    [process.env.DB_NAME, table, column]
  );
  if (!rows.length) return null;
  const row = rows[0];
  return {
    nombre: identifier(row.COLUMN_NAME),
    tipo: identifier(row.DATA_TYPE),
    tipoCompleto: identifier(row.COLUMN_TYPE),
    nullable: row.IS_NULLABLE === 'YES',
    valorPredeterminado: row.COLUMN_DEFAULT,
    extra: identifier(row.EXTRA)
  };
}

async function hasCheck(connection, table, constraint) {
  return count(connection,
    `SELECT COUNT(*) total FROM information_schema.TABLE_CONSTRAINTS
     WHERE CONSTRAINT_SCHEMA=? AND LOWER(TABLE_NAME)=LOWER(?)
       AND LOWER(CONSTRAINT_NAME)=LOWER(?) AND CONSTRAINT_TYPE='CHECK'`,
    [process.env.DB_NAME, table, constraint]).then((total) => total === 1);
}

async function tableEngine(connection, table) {
  const [rows] = await connection.query(
    `SELECT ENGINE FROM information_schema.TABLES
     WHERE TABLE_SCHEMA=? AND LOWER(TABLE_NAME)=LOWER(?)`,
    [process.env.DB_NAME, table]
  );
  return rows.length ? identifier(rows[0].ENGINE) : null;
}

async function main() {
  const config = databaseConfig();
  logDatabaseTarget('Comprobacion de seguridad de sesiones', config);
  const connection = await createConnection();
  try {
    const schemaMigrations = await hasTable(connection, 'schema_migrations');
    const migracionRegistrada = schemaMigrations
      ? await count(
        connection,
        'SELECT COUNT(*) total FROM schema_migrations WHERE LOWER(nombre)=LOWER(?)',
        [MIGRATION]
      ) === 1
      : false;
    const tablas = {
      administrador: await hasTable(connection, 'administrador'),
      sessions: await hasTable(connection, 'sessions')
    };
    const versionSesion = tablas.administrador
      ? await columnDetails(connection, 'administrador', 'versionSesion')
      : null;
    const columnasSesion = {};
    if (tablas.sessions) {
      for (const column of ['session_id', 'expires', 'data']) {
        columnasSesion[column] = Boolean(await columnDetails(connection, 'sessions', column));
      }
    }
    const checks = {
      'administrador.chk_administrador_version_sesion': tablas.administrador
        && await hasCheck(connection, 'administrador', 'chk_administrador_version_sesion')
    };
    const tiposNulabilidadDefaults = {
      versionSesion: Boolean(versionSesion)
        && versionSesion.tipoCompleto === 'int unsigned'
        && versionSesion.nullable === false
        && Number(versionSesion.valorPredeterminado) === 1
        && versionSesion.extra === ''
    };
    const estructuraCompleta = tablas.administrador
      && tiposNulabilidadDefaults.versionSesion
      && checks['administrador.chk_administrador_version_sesion'];
    const datos = {
      administradoresSinVersionValida: versionSesion
        ? await count(
          connection,
          'SELECT COUNT(*) total FROM administrador WHERE versionSesion IS NULL OR versionSesion<1'
        )
        : null,
      estructuraSesionComprobable: tablas.sessions,
      columnasSesionCompletas: tablas.sessions
        ? Object.values(columnasSesion).every(Boolean)
        : null
    };
    const datosValidos = estructuraCompleta
      && datos.administradoresSinVersionValida === 0
      && datos.columnasSesionCompletas !== false;
    const estadoMigracion = migracionRegistrada && estructuraCompleta && datosValidos
      ? 'post-migracion'
      : (!migracionRegistrada && !versionSesion && !checks['administrador.chk_administrador_version_sesion'])
        ? 'pre-migracion'
        : 'estructura-incompleta-o-migracion-parcial';

    console.log(JSON.stringify({
      destino: {
        entorno: String(process.env.APP_ENV || 'predeterminado'),
        base: config.database,
        conexion: databaseTarget(config)
      },
      estadoMigracion,
      migracionRegistrada,
      tablas,
      columnas: { administrador: { versionSesion: Boolean(versionSesion) }, sessions: columnasSesion },
      detallesColumnas: { administrador: { versionSesion } },
      tiposNulabilidadDefaults,
      checks,
      motores: {
        administrador: await tableEngine(connection, 'administrador'),
        sessions: tablas.sessions ? await tableEngine(connection, 'sessions') : null
      },
      estructuraCompleta,
      datosValidos,
      datos
    }, null, 2));

    if (estadoMigracion === 'estructura-incompleta-o-migracion-parcial'
      || (migracionRegistrada && (!estructuraCompleta || !datosValidos))) {
      process.exitCode = 1;
    }
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error('No se pudo comprobar la seguridad de sesiones.');
  console.error(error.message);
  process.exit(1);
});
