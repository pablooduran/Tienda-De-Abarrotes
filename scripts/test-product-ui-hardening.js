const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const app = read('public/js/app.js');
const patterns = read('public/js/ui-patterns.js');
const styles = read('public/css/styles.css');
const packageJson = JSON.parse(read('package.json'));

const checks = [
  ['Hay una prueba browser aislada para edge cases', packageJson.scripts['test:product-ui-hardening-browser'] === 'node scripts/test-product-ui-hardening-browser.js'],
  ['Las mutaciones bloquean accion repetida y anuncian actividad', patterns.includes('if (!button || button.disabled) return null;') && patterns.includes("button.setAttribute('aria-busy', 'true');")],
  ['Las mutaciones restauran el estado accesible original', patterns.includes("button.removeAttribute('aria-busy');")],
  ['Los mensajes seguros no devuelven errores crudos', patterns.includes('No pudimos completar la operación') && !patterns.includes('return error.message')],
  ['El renderizado escapa caracteres HTML', app.includes("replace(/[&<>\"']/g" )],
  ['El frontend no decide el tenant', !app.includes('idTienda')],
  ['Las tablas conservan scroll interno', styles.includes('.table-wrap { overflow-x: auto; }')],
  ['Las superficies comunes aceptan contenido largo', styles.includes('overflow-wrap: anywhere;') && styles.includes('.table-wrap { min-width: 0; max-width: 100%; }')]
];

for (const [name, ok] of checks) {
  assert(ok, `FALLO: ${name}`);
  console.log(`OK: ${name}`);
}

console.log('test:product-ui-hardening OK');
