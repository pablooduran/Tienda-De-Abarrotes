const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');

process.env.APP_ENV = 'local';
process.env.DB_HOST = 'localhost';
process.env.DB_USER = 'oauth_test';
process.env.DB_PASSWORD = 'synthetic-oauth-test-password';
process.env.DB_NAME = 'tienda_abarrotes_pruebas';
process.env.DB_PORT = '3306';

const { googleOauthConfig } = require('../config/google-oauth');
const { createGoogleIdentityService } = require('../services/google-identity-service');

const ROOT = path.resolve(__dirname, '..');
const NOW = '2026-09-26 12:00:00';

function owner(overrides = {}) {
  return {
    idAdministrador: 7, usuario: 'propietario', rol: 'dueno_tienda', idTienda: 4,
    activo: 1, estadoAcceso: 'activo', versionSesion: 1,
    correoNormalizado: 'owner@example.test', tiendaActiva: 1,
    estadoTienda: 'activa', estadoOnboarding: 'pendiente', ...overrides
  };
}

function fakeDatabase(handler) {
  const calls = [];
  const connection = {
    beginTransaction: async () => calls.push('BEGIN'),
    commit: async () => calls.push('COMMIT'),
    rollback: async () => calls.push('ROLLBACK'),
    release: () => calls.push('RELEASE'),
    query: async (sql, params = []) => {
      calls.push({ sql: String(sql).replace(/\s+/g, ' ').trim(), params });
      return handler(sql, params, calls);
    }
  };
  return { database: { getConnection: async () => connection }, calls };
}

function dependencies(database, extras = {}) {
  return {
    database,
    clock: () => NOW,
    bcryptLib: { hash: async () => 'synthetic-password-hash' },
    bootstrap: async () => {},
    subscriptionCreator: async () => ({ planCodigo: 'basico', tipo: 'prueba' }),
    auditService: { recordCritical: async () => {} },
    analytics: { accountRegistered: () => {} },
    ...extras
  };
}

async function main() {
  assert.deepStrictEqual(googleOauthConfig({ APP_ENV: 'local' }), { enabled: false });
  assert.throws(() => googleOauthConfig({ APP_ENV: 'local', GOOGLE_OAUTH_CLIENT_ID: 'only.apps.googleusercontent.com' }),
    /requiere client ID, client secret y redirect URI juntos/);
  const local = googleOauthConfig({
    APP_ENV: 'local', GOOGLE_OAUTH_CLIENT_ID: 'test.apps.googleusercontent.com',
    GOOGLE_OAUTH_CLIENT_SECRET: 'synthetic-secret-value',
    GOOGLE_OAUTH_REDIRECT_URI: 'http://localhost:3000/auth/google/callback'
  });
  assert.strictEqual(local.enabled, true);
  assert.throws(() => googleOauthConfig({
    APP_ENV: 'staging', APP_BASE_URL: 'https://staging.example.test',
    GOOGLE_OAUTH_CLIENT_ID: 'test.apps.googleusercontent.com',
    GOOGLE_OAUTH_CLIENT_SECRET: 'synthetic-secret-value',
    GOOGLE_OAUTH_REDIRECT_URI: 'http://staging.example.test/auth/google/callback'
  }), /exige una redirect URI HTTPS/);
  assert.throws(() => googleOauthConfig({
    APP_ENV: 'staging', APP_BASE_URL: 'https://staging.example.test',
    GOOGLE_OAUTH_CLIENT_ID: 'test.apps.googleusercontent.com',
    GOOGLE_OAUTH_CLIENT_SECRET: 'synthetic-secret-value',
    GOOGLE_OAUTH_REDIRECT_URI: 'https://other.example.test/auth/google/callback'
  }), /mismo origen/);

  const linkedFixture = fakeDatabase(async (sql) => {
    if (String(sql).includes("i.subjectProveedor=?")) return [[owner()]];
    if (String(sql).includes('UPDATE identidadOauthAdministrador')) return [{ affectedRows: 1 }];
    throw new Error(`SQL inesperado en identidad vinculada: ${sql}`);
  });
  const linked = await createGoogleIdentityService(dependencies(linkedFixture.database)).authenticate({
    subject: 'google-subject-123', email: 'owner@example.test'
  });
  assert.strictEqual(linked.created, false);
  assert(linkedFixture.calls.includes('COMMIT'));

  const linkFixture = fakeDatabase(async (sql) => {
    const query = String(sql);
    if (query.includes("i.subjectProveedor=?")) return [[]];
    if (query.includes('WHERE a.correoNormalizado=?')) return [[owner({ estadoAcceso: 'pendiente_verificacion' })]];
    if (query.includes('INSERT INTO identidadOauthAdministrador')) return [{ insertId: 9 }];
    if (query.includes('UPDATE administrador')) return [{ affectedRows: 1 }];
    if (query.includes('UPDATE identidadOauthAdministrador')) return [{ affectedRows: 1 }];
    throw new Error(`SQL inesperado al vincular: ${sql}`);
  });
  const linkedByEmail = await createGoogleIdentityService(dependencies(linkFixture.database)).authenticate({
    subject: 'google-subject-456', email: 'OWNER@example.test'
  });
  assert.strictEqual(linkedByEmail.admin.estadoAcceso, 'activo');
  assert(linkFixture.calls.some((call) => call.sql?.includes('correoVerificadoEn=COALESCE')));

  const missingFixture = fakeDatabase(async (sql) => {
    if (String(sql).includes('SELECT a.idAdministrador')) return [[]];
    throw new Error(`SQL inesperado en cuenta ausente: ${sql}`);
  });
  await assert.rejects(
    createGoogleIdentityService(dependencies(missingFixture.database)).authenticate({
      subject: 'google-subject-789', email: 'missing@example.test'
    }),
    (error) => error.code === 'GOOGLE_ACCOUNT_NOT_FOUND'
  );
  assert(missingFixture.calls.includes('ROLLBACK'));

  const events = [];
  const registerFixture = fakeDatabase(async (sql) => {
    const query = String(sql);
    if (query.includes('SELECT a.idAdministrador')) return [[]];
    if (query.includes('INSERT INTO tienda')) return [{ insertId: 12 }];
    if (query.includes('INSERT INTO administrador')) return [{ insertId: 18 }];
    if (query.includes('INSERT INTO identidadOauthAdministrador')) return [{ insertId: 22 }];
    throw new Error(`SQL inesperado en registro: ${sql}`);
  });
  const registered = await createGoogleIdentityService(dependencies(registerFixture.database, {
    bootstrap: async (_connection, idTienda) => events.push(`bootstrap:${idTienda}`),
    subscriptionCreator: async (_connection, input) => {
      events.push(`subscription:${input.idTienda}`);
      return { planCodigo: 'basico', tipo: 'prueba' };
    },
    auditService: { recordCritical: async (_connection, event) => events.push(event.action) },
    analytics: { accountRegistered: (event) => events.push(`analytics:${event.plan}`) }
  })).authenticate({
    subject: 'google-subject-new', email: 'new@example.test', mode: 'register',
    registration: { usuario: 'owner_google' }
  });
  assert.strictEqual(registered.created, true);
  assert.strictEqual(registered.admin.idTienda, 12);
  assert.deepStrictEqual(events, [
    'registro_publico_solicitado', 'bootstrap:12', 'subscription:12',
    'registro_publico_completado', 'analytics:basico'
  ]);

  const migration = fs.readFileSync(path.join(ROOT, 'database', 'migrations', '025_google_oauth_identities.sql'), 'utf8');
  assert.match(migration, /UNIQUE KEY uq_identidadOauth_proveedor_subject \(proveedor, subjectProveedor\)/);
  assert.match(migration, /UNIQUE KEY uq_identidadOauth_administrador_proveedor \(idAdministrador, proveedor\)/);
  assert(!/accessToken|refreshToken|idToken/i.test(migration), 'La migracion no debe guardar tokens OAuth.');
  const loginScript = fs.readFileSync(path.join(ROOT, 'public', 'js', 'login.js'), 'utf8');
  assert(!/clientSecret|GOOGLE_OAUTH_CLIENT_SECRET/.test(loginScript), 'El frontend no debe contener el secreto OAuth.');

  console.log('test:google-oauth OK');
}

main().catch((error) => {
  console.error(`test:google-oauth FAIL: ${error.message}`);
  process.exitCode = 1;
});
