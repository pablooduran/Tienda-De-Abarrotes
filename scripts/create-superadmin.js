const bcrypt = require('bcryptjs');
const {
  logDatabaseTarget,
  requireEnvironment,
  requireLocalhostDatabase
} = require('../config/env');
const { createConnection, hasColumns, hasTable } = require('./db-utils');

async function main() {
  requireEnvironment(['SUPERADMIN_USER', 'SUPERADMIN_PASSWORD']);
  const config = requireLocalhostDatabase('La creacion de superadmin local');
  if (!/(prueba|test)/i.test(config.database)) {
    throw new Error('El superadmin local solo puede crearse en una base cuyo nombre contenga prueba o test.');
  }
  if (process.env.SUPERADMIN_PASSWORD.length < 12) {
    throw new Error('SUPERADMIN_PASSWORD debe tener al menos 12 caracteres.');
  }
  if (!/^[A-Za-z0-9._-]{3,50}$/.test(process.env.SUPERADMIN_USER)) {
    throw new Error('SUPERADMIN_USER debe tener entre 3 y 50 caracteres y usar solo letras, numeros, punto, guion o guion bajo.');
  }

  logDatabaseTarget('Creacion de superadmin local', config);
  const connection = await createConnection();
  try {
    const hasStoreTable = await hasTable(connection, 'tienda');
    const hasAdminColumns = await hasColumns(connection, 'administrador', ['idTienda', 'rol', 'activo']);
    if (!hasStoreTable || !hasAdminColumns) {
      throw new Error('La estructura multi-tienda no esta completa. Ejecute primero la migracion 004 en la base local.');
    }

    const [existing] = await connection.query(
      'SELECT idAdministrador FROM administrador WHERE usuario=? LIMIT 1',
      [process.env.SUPERADMIN_USER]
    );
    if (existing.length) {
      throw new Error('El usuario indicado ya existe. No se modifico su contrasena.');
    }

    const passwordHash = await bcrypt.hash(process.env.SUPERADMIN_PASSWORD, 12);
    await connection.query(
      `INSERT INTO administrador (idTienda, usuario, password, rol, activo)
       VALUES (NULL, ?, ?, 'superadmin', 1)`,
      [process.env.SUPERADMIN_USER, passwordHash]
    );
    console.log('Superadmin local creado correctamente.');
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error('No se pudo crear el superadmin local.');
  console.error(error.message);
  process.exit(1);
});
