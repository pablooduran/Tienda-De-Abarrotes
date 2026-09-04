const fs = require('fs');
const { createDatabaseConnection } = require('../config/database-connection');

async function createConnection(config = undefined, options = {}) {
  return createDatabaseConnection(config, options);
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

async function hasTable(connection, table) {
  const [[row]] = await connection.query(
    `SELECT COUNT(*) total
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA=? AND TABLE_NAME=?`,
    [process.env.DB_NAME, table]
  );
  return Number(row.total) > 0;
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

async function hasForeignKeyConstraint(
  connection,
  table,
  constraintName,
  columns,
  referencedTable,
  referencedColumns,
  expectedUpdateRule,
  expectedDeleteRule
) {
  const [rows] = await connection.query(
    `SELECT COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
     FROM information_schema.KEY_COLUMN_USAGE
     WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND CONSTRAINT_NAME=?
     ORDER BY ORDINAL_POSITION`,
    [process.env.DB_NAME, table, constraintName]
  );
  if (rows.length !== columns.length) return false;
  const identifier = (value) => String(value || '').toLocaleLowerCase('en-US');
  const columnsMatch = rows.every((row, index) => identifier(row.COLUMN_NAME) === identifier(columns[index])
    && identifier(row.REFERENCED_TABLE_NAME) === identifier(referencedTable)
    && identifier(row.REFERENCED_COLUMN_NAME) === identifier(referencedColumns[index]));
  if (!columnsMatch) return false;
  if (!expectedUpdateRule && !expectedDeleteRule) return true;
  const [rules] = await connection.query(
    `SELECT UPDATE_RULE, DELETE_RULE
     FROM information_schema.REFERENTIAL_CONSTRAINTS
     WHERE CONSTRAINT_SCHEMA=? AND TABLE_NAME=? AND CONSTRAINT_NAME=?`,
    [process.env.DB_NAME, table, constraintName]
  );
  if (rules.length !== 1) return false;
  return (!expectedUpdateRule || identifier(rules[0].UPDATE_RULE) === identifier(expectedUpdateRule))
    && (!expectedDeleteRule || identifier(rules[0].DELETE_RULE) === identifier(expectedDeleteRule));
}

async function hasIndex(connection, table, indexName, columns, unique = false) {
  const [rows] = await connection.query(
    `SELECT COLUMN_NAME, NON_UNIQUE
     FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND INDEX_NAME=?
     ORDER BY SEQ_IN_INDEX`,
    [process.env.DB_NAME, table, indexName]
  );
  if (rows.length !== columns.length) return false;
  return rows.every((row, index) => row.COLUMN_NAME === columns[index]
    && (!unique || Number(row.NON_UNIQUE) === 0));
}

async function hasIndexNamed(connection, table, indexName) {
  const [[row]] = await connection.query(
    `SELECT COUNT(*) total
     FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND INDEX_NAME=?`,
    [process.env.DB_NAME, table, indexName]
  );
  return Number(row.total) > 0;
}

async function hasConstraint(connection, table, constraintName) {
  const [[row]] = await connection.query(
    `SELECT COUNT(*) total
     FROM information_schema.TABLE_CONSTRAINTS
     WHERE CONSTRAINT_SCHEMA=? AND TABLE_NAME=? AND CONSTRAINT_NAME=?`,
    [process.env.DB_NAME, table, constraintName]
  );
  return Number(row.total) > 0;
}

async function hasCheckConstraint(connection, table, constraintName) {
  const [[row]] = await connection.query(
    `SELECT COUNT(*) total
     FROM information_schema.TABLE_CONSTRAINTS
     WHERE CONSTRAINT_SCHEMA=? AND TABLE_NAME=? AND CONSTRAINT_NAME=?
       AND CONSTRAINT_TYPE='CHECK'`,
    [process.env.DB_NAME, table, constraintName]
  );
  return Number(row.total) > 0;
}

module.exports = {
  createConnection,
  hasTable,
  hasColumns,
  hasColumnTypes,
  hasForeignKey,
  hasForeignKeyConstraint,
  hasIndex,
  hasIndexNamed,
  hasConstraint,
  hasCheckConstraint,
  readSqlStatements
};
