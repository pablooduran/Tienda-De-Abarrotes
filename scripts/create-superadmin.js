const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const {
  databaseConfig,
  logDatabaseTarget,
  requireEnvironment
} = require('../config/env');
const { resolveSuperadminCreationMode } = require('../config/staging-database-mutation-guard');
const { createConnection, hasColumns, hasTable } = require('./db-utils');

async function main() {
  requireEnvironment(['SUPERADMIN_USER', 'SUPERADMIN_PASSWORD']);
  const mode = resolveSuperadminCreationMode({ args: process.argv.slice(2), environment: process.env });
  const config = databaseConfig();
  if (mode.type === 'local' && !/(prueba|test)/i.test(config.database)) {
    throw new Error('El superadmin local solo puede crearse en una base cuyo nombre contenga prueba o test.');
  }
  if (process.env.SUPERADMIN_PASSWORD.length < 12) {
    throw new Error('SUPERADMIN_PASSWORD debe tener al menos 12 caracteres.');
  }
  if (!/^[A-Za-z0-9._-]{3,50}$/.test(process.env.SUPERADMIN_USER)) {
    throw new Error('SUPERADMIN_USER debe tener entre 3 y 50 caracteres y usar solo letras, numeros, punto, guion o guion bajo.');
  }

  logDatabaseTarget('Creacion de superadmin local', config);
  const connection = await createConnection(config);
  let transactionStarted = false;
  try {
    const hasStoreTable = await hasTable(connection, 'tienda');
    const hasAdminColumns = await hasColumns(connection, 'administrador', ['idTienda', 'rol', 'activo']);
    if (!hasStoreTable || !hasAdminColumns) {
      throw new Error('La estructura multi-tienda no esta completa. No se creo ninguna cuenta.');
    }
    if (mode.type === 'remote-staging-superadmin') {
      if (!await hasTable(connection, 'schema_migrations')) {
        throw new Error('Staging no tiene el registro de migraciones esperado. No se creo ninguna cuenta.');
      }
      const [[lockState]] = await connection.query(
        "SELECT GET_LOCK('tienda_abarrotes_staging_superadmin_bootstrap', 5) AS acquired"
      );
      if (Number(lockState.acquired) !== 1) {
        throw new Error('Otra creacion de superadmin esta en curso. No se creo ninguna cuenta.');
      }
      const expectedMigrations = fs.readdirSync(path.join(__dirname, '..', 'database', 'migrations'))
        .filter((file) => /^\d{3}_.+\.sql$/i.test(file))
        .sort();
      const [migrationRows] = await connection.query(
        'SELECT nombre FROM schema_migrations ORDER BY nombre'
      );
      const recordedMigrations = migrationRows.map((row) => row.nombre);
      if (expectedMigrations.length !== 25
        || JSON.stringify(recordedMigrations) !== JSON.stringify(expectedMigrations)) {
        throw new Error('Staging no contiene exactamente las migraciones 001-025 esperadas. No se creo ninguna cuenta.');
      }
      await connection.beginTransaction();
      transactionStarted = true;
      const [[superadminState]] = await connection.query(
        "SELECT COUNT(*) AS total FROM administrador WHERE rol='superadmin'"
      );
      if (Number(superadminState.total) !== 0) {
        throw new Error('Staging ya tiene un superadmin. No se creo ni modifico ninguna cuenta.');
      }
    }

    const [existing] = await connection.query(
      'SELECT idAdministrador FROM administrador WHERE usuario=? LIMIT 1',
      [process.env.SUPERADMIN_USER]
    );
    if (existing.length) {
      throw new Error('El usuario indicado ya existe. No se modifico su contrasena.');
    }

    const passwordHash = await bcrypt.hash(process.env.SUPERADMIN_PASSWORD, 12);
    const [insertResult] = await connection.query(
      `INSERT INTO administrador (idTienda, usuario, password, rol, activo)
       VALUES (NULL, ?, ?, 'superadmin', 1)`,
      [process.env.SUPERADMIN_USER, passwordHash]
    );
    if (mode.type === 'remote-staging-superadmin') {
      const [createdRows] = await connection.query(
        `SELECT idTienda, usuario, rol, activo
         FROM administrador
         WHERE idAdministrador=?
         LIMIT 1`,
        [insertResult.insertId]
      );
      const created = createdRows[0];
      if (!created
        || created.idTienda !== null
        || created.usuario !== process.env.SUPERADMIN_USER
        || created.rol !== 'superadmin'
        || Number(created.activo) !== 1) {
        throw new Error('La cuenta creada no supero la verificacion final. Se revirtio la operacion.');
      }
      await connection.commit();
      transactionStarted = false;
    }
    console.log(mode.type === 'remote-staging-superadmin'
      ? 'STAGING_SUPERADMIN_CREATE: CREATED'
      : 'Superadmin local creado correctamente.');
  } catch (error) {
    if (transactionStarted) {
      await connection.rollback().catch(() => {});
      transactionStarted = false;
    }
    throw error;
  } finally {
    if (mode.type === 'remote-staging-superadmin') {
      await connection.query("SELECT RELEASE_LOCK('tienda_abarrotes_staging_superadmin_bootstrap')").catch(() => {});
    }
    await connection.end();
  }
}

main().catch((error) => {
  console.error('No se pudo crear el superadmin.');
  console.error(error.message);
  process.exit(1);
});
