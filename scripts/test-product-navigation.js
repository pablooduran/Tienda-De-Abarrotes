const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const app = read('public/js/app.js');
const html = read('public/app.html');
const css = read('public/css/styles.css');
const admin = read('public/admin.html');
const checks = [];

function check(name, condition) {
  checks.push({ name, ok: Boolean(condition) });
}

check('Las familias del propietario son explicitas', [
  "{ id: 'inicio', label: 'Inicio'",
  "{ id: 'ventas', label: 'Ventas'",
  "{ id: 'inventario', label: 'Inventario'",
  "{ id: 'clientes', label: 'Clientes'",
  "{ id: 'reportes', label: 'Reportes'",
  "{ id: 'administracion', label: 'Administracion y configuracion'",
  "{ id: 'plan', label: 'Mi plan'"
].every((value) => app.includes(value)));
check('Ventas conserva POS, historial, cobranza y devoluciones',
  app.includes("sections: ['ventas', 'historialVentas', 'pagos', 'compensaciones']"));
check('Inventario conserva sus destinos existentes',
  app.includes("sections: ['productos', 'movimientosStock', 'compras', 'proveedores', 'inventarioInteligente', 'inventarioOperativo', 'lotesVencimientos']"));
check('Mi plan usa una ruta existente y segura',
  app.includes("href: '/suscripcion.html'") && !html.includes('subscriptionSummary" class="subscription-summary" href'));
check('Compensaciones usa solo el texto visible aprobado',
  app.includes("['compensaciones', 'Devoluciones y anulaciones'") && !app.includes("['compensaciones', 'Compensaciones'"));
check('Los guards existentes de plan se conservan',
  app.includes('function sectionAllowed(id)') && app.includes("features.includes('anulaciones_operativas')"));
check('La navegacion usa grupos accesibles y foco visible',
  app.includes("document.createElement('details')")
  && app.includes("document.createElement('summary')")
  && css.includes('.nav-family > summary:focus-visible')
  && css.includes('.nav-destination:focus-visible'));
check('Movil conserva una navegacion compacta sin scroll horizontal',
  css.includes('grid-template-columns: repeat(2, minmax(0, 1fr));')
  && css.includes('overflow-x: hidden;'));
check('Superadmin conserva su navegacion independiente',
  admin.includes('Navegación administrativa')
  && admin.includes('Suscripciones SaaS')
  && admin.includes('Pagos de suscripción'));
check('El frontend de navegacion no envia tenant', !/idTienda\s*:/.test(app));

const failures = checks.filter((item) => !item.ok);
checks.forEach((item) => console.log(`${item.ok ? 'OK' : 'FALLO'}: ${item.name}`));
if (failures.length) {
  console.error(`\n${failures.length} comprobacion(es) de navegacion fallaron.`);
  process.exitCode = 1;
} else {
  console.log(`\n${checks.length} comprobaciones de navegacion completadas.`);
}
