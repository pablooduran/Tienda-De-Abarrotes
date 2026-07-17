const mysql = require('mysql2/promise');
const { databaseConfig } = require('./env');

const pool = mysql.createPool(databaseConfig({
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  decimalNumbers: true
}));

module.exports = pool;
