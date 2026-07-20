require('../config/env');
const { cleanupBackups, DELETE_CONFIRMATION } = require('./backup-utils');

function option(name) {
  const prefix = `--${name}=`;
  const value = process.argv.slice(2).find((argument) => argument.startsWith(prefix));
  return value ? value.slice(prefix.length) : undefined;
}

const apply = process.argv.slice(2).includes('--apply');
cleanupBackups({
  apply,
  confirmation: option('confirm'),
  days: option('days'),
  count: option('count')
}).then((result) => {
  console.log(JSON.stringify(result, null, 2));
  if (!apply && result.candidates.length) {
    console.log(`Dry-run: para borrar solo backups verificados repita con --apply --confirm=${DELETE_CONFIRMATION}.`);
  }
}).catch((error) => {
  console.error(`No se pudo evaluar la retencion (${error.code || 'BACKUP_CLEANUP_ERROR'}): ${error.message}`);
  process.exitCode = 1;
});
