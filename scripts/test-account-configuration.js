const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const assert = (condition, message) => { if (!condition) throw new Error(message); };

const migration = read('database/migrations/035_datos_cuenta_administrador.sql');
const schema = read('database/tienda_abarrotes.sql');
const migrator = read('scripts/migrate-db.js');
const service = read('services/account-profile-service.js');
const routes = read('routes/auth.js');
const configuration = read('services/store-configuration-service.js');
const ui = read('public/js/store-configuration-ui.js');

for (const field of ['correoPendiente', 'telefono']) {
  assert(migration.includes(field) && schema.includes(field), `Falta ${field} en la migración o el esquema base.`);
}
assert(migrator.includes("'035_datos_cuenta_administrador.sql'"), 'La migración de cuenta no tiene contrato físico.');
assert(service.includes('verificationCodeHash') && service.includes('sendVerification'), 'El correo no se verifica con un código enviado.');
assert(service.includes('idAdministrador=? AND idTienda=?'), 'Los datos de cuenta no están aislados por usuario y tienda.');
assert(routes.includes("router.get('/account', requireAuth")
  && routes.includes("router.patch('/account', requireAuth")
  && routes.includes("router.post('/account/email/confirm', requireAuth"), 'Faltan rutas autenticadas de cuenta.');
assert(!configuration.includes("|| !administrator.correoVerificadoEn"), 'Una cuenta creada manualmente sigue bloqueada sin correo.');
for (const label of ['Datos de tu cuenta', 'Teléfono de la cuenta', 'Cambiar contraseña', 'Código de verificación']) {
  assert(ui.includes(label), `La interfaz no muestra ${label}.`);
}
assert(ui.includes("api('/auth/change-password'") && ui.includes("api('/auth/account/email/confirm'"), 'La interfaz no conecta las acciones seguras de cuenta.');

console.log('test:account-configuration OK');
