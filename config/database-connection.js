const mysql = require('mysql2/promise');
const { databaseConfig } = require('./env');
const { setBusinessSessionTimeZone } = require('./database-options');

async function createDatabaseConnection(options = databaseConfig(), { onPhase } = {}) {
  onPhase?.('CONNECTION');
  const connection = await mysql.createConnection(options);
  onPhase?.('SESSION_TIME_ZONE');
  return setBusinessSessionTimeZone(connection);
}

module.exports = { createDatabaseConnection };
