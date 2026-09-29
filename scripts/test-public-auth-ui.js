const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'public', 'login.html'), 'utf8');
const script = fs.readFileSync(path.join(ROOT, 'public', 'js', 'login.js'), 'utf8');
const styles = fs.readFileSync(path.join(ROOT, 'public', 'css', 'styles.css'), 'utf8');

const panels = ['login', 'register', 'verify', 'recovery', 'reset'];
const endpoints = [
  '/auth/login',
  '/auth/registro',
  '/auth/verificar-correo',
  '/auth/reenviar-verificacion',
  '/auth/solicitar-recuperacion',
  '/auth/restablecer-password',
  '/auth/google/complete-registration'
];

for (const panel of panels) {
  assert.match(html, new RegExp(`data-auth-panel="${panel}"`), `Falta panel publico ${panel}.`);
}
for (const endpoint of endpoints) {
  assert(script.includes(`'${endpoint}'`), `Falta integrar el contrato ${endpoint}.`);
}

assert(html.includes('Empieza') === false, 'El acceso publico no debe duplicar la guia Welcome.');
assert(html.includes('Crear cuenta'), 'Debe existir un CTA publico para crear cuenta.');
assert(html.includes('¿Olvidaste tu contraseña?'), 'Debe existir recuperacion visible.');
assert(html.includes('Correo o usuario'), 'El acceso debe ofrecer correo o usuario.');
const loginPanel = html.split('data-auth-panel="login"')[1].split('data-auth-panel="register"')[0];
const registerPanel = html.split('data-auth-panel="register"')[1].split('data-auth-panel="verify"')[0];
assert(!loginPanel.includes('data-auth-target="verify"'), 'El login no debe mostrar verificacion antes de solicitar codigo.');
assert(registerPanel.includes('data-auth-target="verify"'), 'El registro debe permitir retomar una verificacion pendiente.');
assert(registerPanel.includes('data-auth-target="recovery"'), 'El registro debe guiar a recuperar acceso cuando una cuenta ya fue creada con Google.');
assert(html.includes('aria-live="polite"'), 'El feedback asincrono debe anunciarse de forma accesible.');
assert(!/<script[^>]*>[^<]/i.test(html), 'No se permite JavaScript inline en el acceso publico.');
assert(!/\son[a-z]+\s*=/i.test(html), 'No se permiten handlers inline.');
assert(!/<style[\s>]/i.test(html), 'No se permiten estilos inline.');
assert(!html.includes('login-box'), 'La superficie anterior no debe coexistir con el acceso unificado.');

for (const id of [
  'login-user', 'login-password', 'register-user', 'register-email',
  'register-password', 'register-confirmation', 'verification-token', 'resend-email',
  'recovery-email', 'recovery-resend-email', 'recovery-token', 'new-password', 'new-password-confirmation'
]) {
  assert(html.includes(`for="${id}"`), `Falta label persistente para ${id}.`);
  assert(html.includes(`id="${id}"`), `Falta control ${id}.`);
}

assert(script.includes("'Idempotency-Key': registrationKey"), 'El registro debe conservar idempotencia.');
assert(script.includes('delete data.confirmacionRegistro'), 'La confirmacion local no debe salir al backend.');
assert(script.includes('REGISTRATION_UNAVAILABLE') && script.includes('Recuperar acceso'),
  'Un conflicto de registro debe orientar a definir una contrasena sin confirmar que exista una cuenta.');
assert(script.includes('SecurityHttp.secureFetch'), 'Las mutaciones publicas deben usar el cliente seguro.');
assert(script.includes("form.getAttribute('aria-busy') === 'true'"), 'Las mutaciones deben impedir doble envio.');
assert(script.includes("button.disabled = true"), 'El submit debe quedar deshabilitado durante la mutacion.');
assert(!/localStorage|sessionStorage/.test(script), 'Los tokens y preferencias de acceso no se almacenan en el navegador.');
assert(!/innerHTML|insertAdjacentHTML/.test(script), 'El feedback publico no debe inyectar HTML.');
assert(!/idTienda/.test(script), 'El frontend publico no debe elegir tenant.');

assert(styles.includes('@media (max-width: 820px)'), 'Falta comportamiento tablet del acceso publico.');
assert(styles.includes('@media (max-width: 560px)'), 'Falta comportamiento movil del acceso publico.');
assert(styles.includes('@media (prefers-reduced-motion: reduce)'), 'Falta respeto a reduced motion.');
assert(styles.includes('.auth-form-row { grid-template-columns: 1fr; }'), 'Los formularios deben reordenarse a una columna en movil.');
assert(styles.includes('.auth-settings') && styles.includes('background-image:'), 'El acceso debe integrar apariencia en una rueda y un fondo visual ligero.');
assert(script.includes('startResendCooldown') && html.includes('id="resendRecoveryForm"'), 'La recuperacion debe permitir reenvio con espera visible.');
assert(html.includes('data-google-action="login"') && html.includes('data-google-action="register"'),
  'El acceso debe incluir las dos entradas configurables de Google.');
assert(script.includes("'/auth/google/status'") && script.includes("SecurityHttp.secureFetch('/auth/google/start'"),
  'Google debe activarse desde backend y comenzar mediante un POST protegido.');
assert(html.includes('class="google-logo"') && html.includes('fill="#4285F4"'),
  'Google debe usar su marca multicolor reconocible, no una letra generica.');
assert(script.includes('setGoogleRegistrationMode') && script.includes("'/auth/google/complete-registration'"),
  'El registro con Google debe pedir solo el usuario despues de confirmar Google.');
assert(!/GOOGLE_OAUTH_CLIENT_SECRET|clientSecret/.test(html + script),
  'El frontend no debe contener credenciales de Google.');

console.log('test:public-auth-ui OK');
