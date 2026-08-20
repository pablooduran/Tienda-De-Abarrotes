const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const app = read('public/js/app.js');
const help = read('public/js/help-center.js');
const welcome = read('public/js/welcome-guide.js');
const html = read('public/app.html');
const subscription = read('public/js/subscription-ui.js');
const css = read('public/css/styles.css');
const docs = read('docs/PRODUCTO_0_DECISIONES.md');
const packageJson = JSON.parse(read('package.json'));

const checks = [
  ['El comando HELP existe', packageJson.scripts['test:help'] === 'node scripts/test-help.js'],
  ['El arnes browser HELP existe', packageJson.scripts['test:help-browser'] === 'node scripts/test-help-browser.js'],
  ['El centro carga antes de la aplicacion', html.indexOf('/js/help-center.js') < html.indexOf('/js/app.js')],
  ['La entrada global conserva Ayuda como utilidad', html.includes('id="helpBtn"') && app.includes('helpButton?.addEventListener')],
  ['El centro tiene categorias de funciones existentes', ['primeros-pasos', 'ventas', 'inventario', 'clientes-credito', 'reportes', 'configuracion', 'mi-plan', 'cuenta-acceso'].every((category) => help.includes(category))],
  ['La busqueda es local y normaliza acentos', help.includes("normalize('NFD')") && help.includes("input.addEventListener('input'" ) && !help.includes('/api/')],
  ['Los articulos responden que hace, como hacerlo y que pasa despues', help.includes('Que hace') && help.includes('Como hacerlo') && help.includes('Que pasa despues')],
  ['La ayuda contextual cubre las superficies operativas', ['ventas', 'productos', 'clientes', 'configuracion'].every((section) => app.includes(`${section}: { topic:`))],
  ['Mi plan enlaza con su tema de ayuda', subscription.includes('/app.html?help=mi-plan')],
  ['La guia Welcome se reutiliza sin duplicar su checklist', help.includes('data-help-welcome') && welcome.includes('function show(context)')],
  ['La ayuda no controla tenant ni expone rutas privadas', !help.includes('idTienda') && !help.includes('/api/')],
  ['HELP conserva estilos responsive y foco nativo', css.includes('.help-center') && css.includes('.help-article > summary') && css.includes('.help-categories')],
  ['La documentacion registra WELCOME publicado y HELP implementado', docs.includes('31808668518') && docs.includes('HELP queda implementado')]
];

for (const [name, ok] of checks) {
  assert(ok, `FALLO: ${name}`);
  console.log(`OK: ${name}`);
}

console.log('test:help OK');
