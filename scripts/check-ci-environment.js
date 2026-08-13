const assert = require('assert');

const REQUIRED = [
  'DB_USER',
  'DB_PASSWORD',
  'BACKUP_RESTORE_USER',
  'BACKUP_RESTORE_PASSWORD',
  'SESSION_SECRET'
];

function checkCiEnvironment(environment = process.env) {
  assert.strictEqual(String(environment.CI || '').trim().toLowerCase(), 'true',
    'La validacion de CI requiere CI=true.');
  assert.strictEqual(String(environment.APP_ENV || '').trim().toLowerCase(), 'local',
    'CI debe usar APP_ENV=local para conservar la barrera de localhost.');
  assert.strictEqual(String(environment.NODE_ENV || '').trim().toLowerCase(), 'test',
    'CI debe usar NODE_ENV=test.');
  assert.strictEqual(String(environment.DB_HOST || '').trim().toLowerCase(), 'localhost',
    'CI solo admite DB_HOST=localhost; no se permite fallback remoto.');
  assert.strictEqual(String(environment.DB_PORT || '').trim(), '3306',
    'CI debe usar el puerto efimero MySQL 3306.');
  assert.strictEqual(String(environment.DB_NAME || '').trim(), 'tienda_abarrotes_pruebas',
    'CI debe usar exclusivamente la base efimera tienda_abarrotes_pruebas.');
  assert.strictEqual(String(environment.DB_SSL_ENABLED || '').trim().toLowerCase(), 'false',
    'CI no debe intentar TLS ni una CA remota.');
  for (const name of REQUIRED) {
    assert(String(environment[name] || '').trim(), `Falta ${name} en CI.`);
  }
  assert(String(environment.SESSION_SECRET).length >= 32,
    'SESSION_SECRET de CI debe tener al menos 32 caracteres.');
  assert(!String(environment.DATABASE_URL || '').trim(),
    'CI no admite DATABASE_URL para evitar destinos alternativos.');
  assert(!String(environment.DB_SSL_CA || '').trim() && !String(environment.DB_SSL_CA_PATH || '').trim(),
    'CI no admite certificados ni rutas de CA de MySQL.');
}

try {
  checkCiEnvironment();
  console.log('CI_ENVIRONMENT_OK: localhost/MySQL efimero verificado.');
} catch (error) {
  console.error(`CI_ENVIRONMENT_ERROR: ${error.message}`);
  process.exitCode = 1;
}

module.exports = { checkCiEnvironment };
