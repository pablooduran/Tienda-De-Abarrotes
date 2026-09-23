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
  '/auth/restablecer-password'
];

for (const panel of panels) {
  assert.match(html, new RegExp(`data-auth-panel="${panel}"`), `Falta panel publico ${panel}.`);
}
for (const endpoint of endpoints) {
  assert(script.includes(`'${endpoint}'`), `Falta integrar el contrato ${endpoint}.`);
}

assert(html.includes('Empieza') === false, 'El acceso publico no debe duplicar la guia Welcome.');
assert(html.includes('Crear cuenta'), 'Debe existir un CTA publico para crear cuenta.');
assert(html.includes('Olvidé mi contraseña'), 'Debe existir recuperacion visible.');
assert(html.includes('Usuario o correo'), 'El acceso debe ofrecer usuario o correo verificado.');
assert(html.includes('correo verificado'), 'El acceso debe aclarar que el correo debe estar verificado.');
const loginPanel = html.split('data-auth-panel="login"')[1].split('data-auth-panel="register"')[0];
const registerPanel = html.split('data-auth-panel="register"')[1].split('data-auth-panel="verify"')[0];
assert(!loginPanel.includes('data-auth-target="verify"'), 'El login no debe mostrar verificacion antes de solicitar codigo.');
assert(registerPanel.includes('data-auth-target="verify"'), 'El registro debe permitir retomar una verificacion pendiente.');
assert(html.includes('aria-live="polite"'), 'El feedback asincrono debe anunciarse de forma accesible.');
assert(!/<script[^>]*>[^<]/i.test(html), 'No se permite JavaScript inline en el acceso publico.');
assert(!/\son[a-z]+\s*=/i.test(html), 'No se permiten handlers inline.');
assert(!/<style[\s>]/i.test(html), 'No se permiten estilos inline.');
assert(!html.includes('login-box'), 'La superficie anterior no debe coexistir con el acceso unificado.');

for (const id of [
  'login-user', 'login-password', 'register-store', 'register-user', 'register-email',
  'register-password', 'register-confirmation', 'verification-token', 'resend-email',
  'recovery-email', 'recovery-token', 'new-password', 'new-password-confirmation'
]) {
  assert(html.includes(`for="${id}"`), `Falta label persistente para ${id}.`);
  assert(html.includes(`id="${id}"`), `Falta control ${id}.`);
}

assert(script.includes("'Idempotency-Key': registrationKey"), 'El registro debe conservar idempotencia.');
assert(script.includes('delete data.confirmacionRegistro'), 'La confirmacion local no debe salir al backend.');
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
assert(!/\.auth-[^{]*\{[^}]*gradient/i.test(styles), 'La superficie publica no debe introducir gradients.');

console.log('test:public-auth-ui OK');
