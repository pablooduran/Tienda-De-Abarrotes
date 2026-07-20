require('../config/env');
const { createBackup } = require('./backup-utils');

createBackup().then((result) => {
  console.log(JSON.stringify({
    resultado: 'ok',
    archivo: result.sqlPath,
    manifiesto: result.manifestPath,
    tamano: result.manifest.backup.sizeBytes,
    sha256: result.manifest.backup.sha256
  }, null, 2));
}).catch((error) => {
  console.error(`No se pudo crear el backup (${error.code || 'BACKUP_ERROR'}): ${error.message}`);
  process.exitCode = 1;
});
