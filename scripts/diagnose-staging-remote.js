const mysql = require('mysql2/promise');
const { databaseConfig } = require('../config/env');
const {
  REMOTE_STAGING_DIAGNOSTIC_ARGUMENT,
  STAGING_DATABASE_DIAGNOSTICS,
  diagnoseRemoteStagingDatabase,
  resolveRemoteStagingDiagnosticMode
} = require('../config/staging-database-mutation-guard');

function writeDiagnostic(category) {
  const allowed = new Set(Object.values(STAGING_DATABASE_DIAGNOSTICS));
  const result = allowed.has(category)
    ? category
    : STAGING_DATABASE_DIAGNOSTICS.CONNECTION_OR_CONFIGURATION_FAILURE;
  console.log(`STAGING_REMOTE_DIAGNOSTIC: ${result}`);
}

async function main() {
  let connection;
  try {
    resolveRemoteStagingDiagnosticMode({
      args: process.argv.slice(2), environment: process.env
    });
    const config = databaseConfig();
    connection = await mysql.createConnection(config);
    writeDiagnostic(await diagnoseRemoteStagingDatabase(connection, config.database));
  } catch {
    writeDiagnostic(STAGING_DATABASE_DIAGNOSTICS.CONNECTION_OR_CONFIGURATION_FAILURE);
    process.exitCode = 1;
  } finally {
    if (connection) await connection.end().catch(() => {});
  }
}

if (require.main === module) void main();

module.exports = { writeDiagnostic };
