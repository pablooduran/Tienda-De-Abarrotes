require('../config/env');
const { verifyBackup } = require('./backup-utils');

const filePath = process.argv[2];
if (!filePath) {
  console.error('Uso: npm.cmd run db:verify-backup -- <archivo.sql>');
  process.exitCode = 1;
} else {
  verifyBackup(filePath).then((result) => {
    console.log(JSON.stringify({
      resultado: 'valido', archivo: result.sqlPath, manifiesto: result.manifestPath,
      base: result.database, tamano: result.sizeBytes, sha256: result.sha256
    }, null, 2));
  }).catch((error) => {
    console.error(`Backup invalido (${error.code || 'BACKUP_VERIFY_ERROR'}): ${error.message}`);
    process.exitCode = 1;
  });
}
