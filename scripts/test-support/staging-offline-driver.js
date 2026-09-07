// Loaded only by the isolated child-process test, never by an operational entry point.
const fs = require('fs');
const path = require('path');
const net = require('net');
const tls = require('tls');
const assert = require('assert/strict');
const crypto = require('crypto');

const entry = path.basename(process.argv[1] || '');
const entries = new Set(['preflight-staging-remote.js', 'diagnose-staging-remote.js', 'init-db.js', 'migrate-db.js']);
if (process.env.STAGING_OFFLINE_TEST !== 'SYNTHETIC_NO_NETWORK') throw new Error('Offline fixture requires isolation.');

function trace(event, extra = {}) {
  fs.appendFileSync(process.env.STAGING_TEST_TRACE, `${JSON.stringify({ entry, event, ...extra })}\n`);
}

net.Socket.prototype.connect = function blockedNetwork() {
  trace('NETWORK_ATTEMPT');
  throw Object.assign(new Error('Offline transport blocked'), { code: 'OFFLINE_TEST_TRANSPORT' });
};
tls.connect = function blockedTls() {
  trace('NETWORK_ATTEMPT');
  throw Object.assign(new Error('Offline TLS blocked'), { code: 'OFFLINE_TEST_TRANSPORT' });
};

if (entries.has(entry)) {
  const root = path.resolve(__dirname, '..', '..');
  const mysql = require('mysql2/promise');
  const ConnectionConfig = require(path.join(path.dirname(require.resolve('mysql2/package.json')), 'lib', 'connection_config.js'));
  const { INITIAL_TABLES } = require('../../config/staging-database-mutation-guard');
  require('dotenv').config = () => {
    trace('ENV_FILE_READ');
    throw new Error('Environment files are forbidden in the remote tool test.');
  };
  const scenario = process.env.STAGING_TEST_SCENARIO;
  const sentinel = 'synthetic-secret-that-must-not-leak';
  function failure(code) {
    const error = code === 'TYPE_ERROR' ? new TypeError(sentinel) : new Error(sentinel);
    if (code !== 'TYPE_ERROR') error.code = code;
    error.sql = sentinel;
    error.sqlMessage = sentinel;
    return error;
  }

  const originalLog = console.log;
  console.log = (...args) => {
    const line = String(args[0] || '');
    if (line.startsWith('STAGING_REMOTE_')) {
      if (scenario === 'protocol-missing') return;
      if (scenario === 'protocol-unknown') return originalLog(`STAGING_REMOTE_DIAGNOSTIC: ${sentinel}`);
      if (scenario === 'protocol-duplicate') originalLog(...args);
      if (scenario === 'protocol-mixed') originalLog(`STAGING_REMOTE_DIAGNOSTIC: ${sentinel}`);
    }
    originalLog(...args);
  };
  if (scenario === 'protocol-exit') process.on('exit', () => { process.exitCode = 0; });
  if (scenario === 'protocol-success-exit') process.on('exit', () => { process.exitCode = 1; });

  let attempts = 0;
  mysql.createConnection = async (options) => {
    attempts += 1;
    assert.equal(attempts, 1, 'Each entry point must connect once only.');
    assert.equal(process.cwd(), root, 'The launcher must pin cwd.');
    assert.equal(process.env.APP_ENV, 'staging');
    assert.equal(process.env.DB_ENVIRONMENT, 'staging');
    assert.equal(process.env.NODE_ENV, 'production');
    assert.equal(options.host, 'offline-staging.invalid');
    assert.equal(options.user, 'offline-user');
    assert.equal(options.password, 'synthetic-Pa$$%&!value');
    assert.equal(options.port, 3306);
    assert.equal(options.database, 'tienda_abarrotes_staging');
    assert.equal(options.ssl.ca, tls.rootCertificates[0].trim());
    assert.equal(options.ssl.rejectUnauthorized, true);
    assert.equal(options.timezone, '-04:00');
    assert.equal(options.charset, 'utf8mb4');
    assert.equal(options.decimalNumbers, true);
    assert.deepEqual(options.dateStrings, ['DATE', 'DATETIME']);
    assert.equal(process.env.DB_SSL_CA_PATH, undefined);
    assert.equal(options.socketPath, undefined);
    assert.equal(options.stream, undefined);
    assert.equal(options.uri, undefined);
    if (entry === 'preflight-staging-remote.js') {
      assert.deepEqual(process.argv.slice(2), ['--remote-staging-preflight']);
      assert.equal(process.env.STAGING_REMOTE_PREFLIGHT_CONFIRMATION, 'PREFLIGHT_STAGING_TLS_AND_SCHEMA_ONLY');
    } else if (entry === 'diagnose-staging-remote.js') {
      assert.deepEqual(process.argv.slice(2), ['--remote-staging-diagnose']);
      assert.equal(process.env.STAGING_DB_MUTATION_CONFIRMATION, undefined);
    } else {
      assert.deepEqual(process.argv.slice(2), ['--remote-staging']);
      assert.equal(process.env.STAGING_DB_MUTATION_CONFIRMATION, 'CONFIRM_EMPTY_STAGING_001_024');
    }
    // This is the actual installed driver's normalizer, not a copy of its behavior.
    if (scenario === 'frozen-regression') Object.freeze(options.ssl);
    const effective = new ConnectionConfig(options);
    const fingerprint = crypto.createHash('sha256').update(JSON.stringify({
      host: effective.host, user: effective.user, password: effective.password,
      database: effective.database, port: effective.port, ssl: effective.ssl,
      charset: effective.charsetNumber, timezone: effective.timezone, dateStrings: effective.dateStrings,
      decimalNumbers: effective.decimalNumbers, runtime: process.execPath
    })).digest('hex');
    trace('DRIVER_NORMALIZED', { fingerprint });
    if (scenario.startsWith('connection:')) throw failure(scenario.slice('connection:'.length));
    if (scenario === 'protocol-exit') throw failure('ETIMEDOUT');
    if (scenario === 'init-failure' && entry === 'init-db.js') throw failure('ER_ACCESS_DENIED_ERROR');
    const columns = new Map();
    return {
      async query(sql, params = []) {
        const text = String(sql).trim();
        if (text === 'SET time_zone = ?') {
          trace('SESSION_TIME_ZONE');
          assert.deepEqual(params, ['-04:00']);
          if (scenario === 'session-failure') throw failure('ER_SPECIFIC_ACCESS_DENIED_ERROR');
          return [[]];
        }
        if (text === 'SHOW GRANTS') {
          trace('READ_GRANTS');
          return [[{ grant: scenario === 'no-create-privilege'
            ? 'GRANT SELECT ON *.* TO synthetic'
            : 'GRANT SELECT, CREATE ON `tienda_abarrotes_staging`.* TO synthetic' }]];
        }
        if (text.includes('information_schema.TABLES')) {
          trace('READ_TABLES');
          if (scenario === 'read-failure' || entry === 'migrate-db.js') throw failure('ER_TABLEACCESS_DENIED_ERROR');
          if (scenario === 'baseline') return [INITIAL_TABLES.map((TABLE_NAME) => ({ TABLE_NAME }))];
          if (scenario === 'partial') return [[{ TABLE_NAME: 'synthetic_unexpected' }]];
          return [[]];
        }
        if (/^SELECT 1 AS rowExists/.test(text)) {
          trace('READ_BASELINE');
          return [[]];
        }
        if (/^CREATE TABLE IF NOT EXISTS/.test(text) && entry === 'init-db.js' && scenario === 'flow') {
          trace('SIMULATED_DDL');
          const table = text.match(/^CREATE TABLE IF NOT EXISTS (\w+)/)[1];
          columns.set(table, [...text.matchAll(/^\s+(\w+)\s+(?:INT|VARCHAR|DECIMAL|DATETIME|DATE|TINYINT|ENUM|BOOLEAN)\b/gm)].map((match) => match[1]));
          return [[]];
        }
        if (text.includes('information_schema.COLUMNS') && entry === 'init-db.js' && scenario === 'flow') {
          return [(columns.get(params[1]) || []).map((COLUMN_NAME) => ({ COLUMN_NAME }))];
        }
        if (text.includes('information_schema.KEY_COLUMN_USAGE') && entry === 'init-db.js' && scenario === 'flow') return [[{ total: 1 }]];
        trace('UNEXPECTED_QUERY');
        throw failure('OFFLINE_UNEXPECTED_QUERY');
      },
      async end() {
        trace('END');
        if (scenario === 'close-failure') throw failure('ECONNRESET');
      },
      destroy() { trace('DESTROY'); }
    };
  };
}
