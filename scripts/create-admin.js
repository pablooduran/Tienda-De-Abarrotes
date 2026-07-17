const bcrypt = require('bcryptjs');
const { logDatabaseTarget, requireEnvironment } = require('../config/env');
const { createConnection } = require('./db-utils');

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
    await connection.query(
      'INSERT INTO administrador (usuario, password) VALUES (?, ?)',
      [process.env.ADMIN_USER, hash]
    );
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
