const fs = require('fs');
const mysql = require('mysql2/promise');
const { databaseConfig } = require('../config/env');

async function createConnection() {
  return mysql.createConnection(databaseConfig({ decimalNumbers: true }));
}

function readSqlStatements(filePath) {
  return fs.readFileSync(filePath, 'utf8')
    .split(';')
    .map((part) => part
      .split(/\r?\n/)
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n')
      .trim())
    .filter(Boolean)
    .filter((statement) => !/^USE\s+/i.test(statement))
    .filter((statement) => !/^CREATE\s+DATABASE/i.test(statement))
    .filter((statement) => !/^DROP\s+/i.test(statement));
}

async function hasColumns(connection, table, columns) {
  const [rows] = await connection.query(
    `SELECT COLUMN_NAME
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA=? AND TABLE_NAME=?`,
    [process.env.DB_NAME, table]
  );
  const existing = new Set(rows.map((row) => row.COLUMN_NAME));
  return columns.every((column) => existing.has(column));
}

async function hasColumnTypes(connection, table, expectedTypes) {
  const [rows] = await connection.query(
    `SELECT COLUMN_NAME, DATA_TYPE
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA=? AND TABLE_NAME=?`,
    [process.env.DB_NAME, table]
  );
  const existing = new Map(rows.map((row) => [row.COLUMN_NAME, String(row.DATA_TYPE).toLowerCase()]));
  return Object.entries(expectedTypes).every(([column, type]) => existing.get(column) === type.toLowerCase());
}

async function hasForeignKey(connection, table, column, referencedTable, referencedColumn) {
  const [rows] = await connection.query(
    `SELECT COUNT(*) total
     FROM information_schema.KEY_COLUMN_USAGE
     WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND COLUMN_NAME=?
       AND REFERENCED_TABLE_NAME=? AND REFERENCED_COLUMN_NAME=?`,
    [process.env.DB_NAME, table, column, referencedTable, referencedColumn]
  );
  return Number(rows[0].total) > 0;
}

module.exports = { createConnection, hasColumns, hasColumnTypes, hasForeignKey, readSqlStatements };
