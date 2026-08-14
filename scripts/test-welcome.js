const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const app = read('public/js/app.js');
const guide = read('public/js/welcome-guide.js');
const html = read('public/app.html');
const css = read('public/css/styles.css');
const docs = read('docs/PRODUCTO_0_DECISIONES.md');
const packageJson = JSON.parse(read('package.json'));

const checks = [
  ['El comando Welcome existe', packageJson.scripts['test:welcome'] === 'node scripts/test-welcome.js'],
  ['El arnes browser Welcome existe', packageJson.scripts['test:welcome-browser'] === 'node scripts/test-welcome-browser.js'],
  ['La guia carga antes de la aplicacion', html.indexOf('/js/welcome-guide.js') < html.indexOf('/js/app.js')],
  ['El progreso se infiere de producto, stock y venta reales', guide.includes('stockUnidadesTotal') && guide.includes('saleRows.length')],
  ['La preferencia visual se separa del progreso', guide.includes('localStorage') && guide.includes('function progress')],
  ['La guia no confia en idTienda ni crea rutas', !guide.includes('idTienda') && !guide.includes('/api/')],
  ['Los CTA reutilizan vistas existentes', guide.includes("view: 'productos'") && guide.includes("view: 'compras'") && guide.includes("view: 'ventas'")],
  ['El modo solo lectura no habilita acciones', guide.includes('context?.soloLectura') && guide.includes('disabled aria-disabled="true"')],
  ['Existe cierre breve al completar el recorrido', guide.includes('Tu tienda ya esta lista para operar.')],
  ['La guia conserva mobile y foco mediante estilos compartidos', css.includes('.welcome-steps') && css.includes('.welcome-guide-heading')],
  ['PRODUCTO-1 y TECH-026 constan cerrados', docs.includes('TECH-026 queda resuelto') && docs.includes('PRODUCTO-1 P1-P8 cerrado')]
];

for (const [name, ok] of checks) {
  assert(ok, `FALLO: ${name}`);
  console.log(`OK: ${name}`);
}

console.log('test:welcome OK');
