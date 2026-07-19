const mysql = require('mysql2/promise');
const { databaseConfig } = require('./env');
const { installPoolSessionTimeZone } = require('./database-options');

const pool = installPoolSessionTimeZone(mysql.createPool(databaseConfig({
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
})));

module.exports = pool;
