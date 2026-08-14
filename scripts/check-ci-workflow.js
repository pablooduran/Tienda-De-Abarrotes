const assert = require('assert');
const fs = require('fs');
const path = require('path');

const workflowPath = path.join(__dirname, '..', '.github', 'workflows', 'ci.yml');

function checkWorkflow(source) {
  const required = [
    'pull_request:',
    'push:',
    'contents: read',
    'actions/checkout@v4',
    'actions/setup-node@v4',
    'node-version: 20.x',
    'image: mysql:8.0',
    'MYSQL_DATABASE: tienda_abarrotes_pruebas',
    'APP_ENV: local',
    'DB_HOST: localhost',
    'npm ci',
    'npm run check:ci-environment',
    'npm run test:staging-configuration',
    'npm run db:init',
    'npm run db:migrate',
    'npm run test:saas-c-schema',
    'npm run db:check-saas-c',
    'npm run test:tenant-isolation',
    'npm run test:administrative-audit',
    'npm run test:e2e-critical-business',
    'npm run check:web-security',
    'npm run test:web-security'
  ];
  for (const item of required) assert(source.includes(item), `Falta contrato CI: ${item}.`);

  for (const forbidden of [/\.env\.local/i, /aiven/i, /render\.com/i, /deploy/i, /DATABASE_URL\s*:/i]) {
    assert(!forbidden.test(source), `El workflow incluye una referencia no permitida: ${forbidden}.`);
  }
  assert(!/playwright\s+install/i.test(source),
    'El gate browser no debe descargar navegadores durante CI.');
}

try {
  checkWorkflow(fs.readFileSync(workflowPath, 'utf8'));
  console.log('CI_WORKFLOW_OK: contrato estatico del workflow verificado.');
} catch (error) {
  console.error(`CI_WORKFLOW_ERROR: ${error.message}`);
  process.exitCode = 1;
}

module.exports = { checkWorkflow };
