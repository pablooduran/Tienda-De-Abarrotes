const { buildDatabaseOptions } = require('./database-options');
const {
  INITIAL_STAGING_DATABASE,
  assertRemoteStagingConnectionAuthorization
} = require('./staging-database-mutation-guard');

function buildRemoteStagingDatabaseOptions(environment = process.env, extra = {}) {
  assertRemoteStagingConnectionAuthorization(environment);
  const options = buildDatabaseOptions(environment, extra);
  if (options.database !== INITIAL_STAGING_DATABASE) {
    throw new Error('La configuracion remota no coincide con la base de staging autorizada.');
  }
  return Object.freeze(options);
}

module.exports = { buildRemoteStagingDatabaseOptions };
