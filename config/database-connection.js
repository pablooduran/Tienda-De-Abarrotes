const mysql = require('mysql2/promise');
const { databaseConfig } = require('./env');
const { setBusinessSessionTimeZone } = require('./database-options');

async function createDatabaseConnection(options = databaseConfig()) {
  const connection = await mysql.createConnection(options);
  return setBusinessSessionTimeZone(connection);
}

module.exports = { createDatabaseConnection };
