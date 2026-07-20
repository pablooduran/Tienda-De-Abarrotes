require('../config/env');
const { testRestore } = require('./backup-utils');

const filePath = process.argv[2];
if (!filePath) {
  console.error('Uso: npm.cmd run db:test-restore -- <archivo.sql>');
  process.exitCode = 1;
} else {
  testRestore(filePath).then((result) => {
    console.log(JSON.stringify({ resultado: 'ok', ...result }, null, 2));
  }).catch((error) => {
    console.error(`La restauracion de prueba fallo (${error.code || 'RESTORE_ERROR'}): ${error.message}`);
    process.exitCode = 1;
  });
}
