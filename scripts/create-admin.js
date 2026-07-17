const bcrypt = require('bcryptjs');
const { logDatabaseTarget, requireEnvironment } = require('../config/env');
const { createConnection, hasColumns } = require('./db-utils');

async function main() {
  requireEnvironment(['ADMIN_USER', 'ADMIN_PASSWORD']);
  if (process.env.ADMIN_PASSWORD.length < 12) {
    throw new Error('ADMIN_PASSWORD debe tener al menos 12 caracteres.');
  }

  logDatabaseTarget('Creacion de administrador');
  const connection = await createConnection();
  try {
    const [existing] = await connection.query(
      'SELECT idAdministrador FROM administrador WHERE usuario=?',
      [process.env.ADMIN_USER]
    );
    if (existing.length) {
      throw new Error('El administrador indicado ya existe. No se modifico su contrasena.');
    }

    const hash = await bcrypt.hash(process.env.ADMIN_PASSWORD, 12);
    const hasStoreTable = await hasColumns(connection, 'tienda', ['idTienda', 'slug']);
    const adminTenantColumns = {
      idTienda: await hasColumns(connection, 'administrador', ['idTienda']),
      rol: await hasColumns(connection, 'administrador', ['rol']),
      activo: await hasColumns(connection, 'administrador', ['activo'])
    };
    const tenantColumnCount = Object.values(adminTenantColumns).filter(Boolean).length;

    if (hasStoreTable && tenantColumnCount === 3) {
      const [stores] = await connection.query(
        "SELECT idTienda FROM tienda WHERE slug='tienda-deisy' LIMIT 1"
      );
      if (!stores.length) {
        throw new Error('No existe Tienda Deisy. Ejecute primero las migraciones de la base local.');
      }
      await connection.query(
        `INSERT INTO administrador (idTienda, usuario, password, rol, activo)
         VALUES (?, ?, ?, 'dueno_tienda', 1)`,
        [stores[0].idTienda, process.env.ADMIN_USER, hash]
      );
    } else if (!hasStoreTable && tenantColumnCount === 0) {
      await connection.query(
        'INSERT INTO administrador (usuario, password) VALUES (?, ?)',
        [process.env.ADMIN_USER, hash]
      );
    } else {
      throw new Error('La estructura multi-tienda esta incompleta. Termine o repare la migracion 004 antes de crear el administrador.');
    }
    console.log('Administrador inicial creado correctamente.');
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error('No se pudo crear el administrador inicial.');
  console.error(error.message);
  process.exit(1);
});
