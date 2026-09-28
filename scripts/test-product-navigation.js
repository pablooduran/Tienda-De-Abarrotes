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

check('Las familias operativas del propietario son explicitas', [
  "{ id: 'inicio', label: 'Inicio'",
  "{ id: 'ventas', label: 'Ventas'",
  "{ id: 'inventario', label: 'Inventario'",
  "{ id: 'clientes', label: 'Clientes'",
  "{ id: 'reportes', label: 'Reportes'"
].every((value) => app.includes(value)));
check('Configuracion y auditoria viven fuera de la barra operativa',
  !app.includes("{ id: 'administracion', label: 'Administracion y configuracion'")
  && html.includes('id="settingsStoreButton"')
  && html.includes('id="settingsAuditButton"')
  && app.includes("const settingsViews = new Set(['configuracion', 'auditoria'])")
  && css.includes('.layout.settings-workspace .sidebar'));
check('Ventas conserva POS, historial, cobranza y devoluciones',
  app.includes("sections: ['ventas', 'historialVentas', 'pagos', 'compensaciones']"));
check('Inventario conserva sus destinos existentes',
  app.includes("sections: ['productos', 'movimientosStock', 'compras', 'proveedores', 'inventarioInteligente', 'inventarioOperativo', 'lotesVencimientos']"));
check('Mi plan usa una ruta existente y segura',
  html.includes('href="/suscripcion.html"') && html.includes('id="accountMenu"') && !html.includes('subscriptionSummary" class="subscription-summary" href'));
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
  css.includes('.layout.sidebar-open .sidebar')
  && css.includes('transform: translateX(-102%);')
  && css.includes('overflow-x: hidden;'));
check('El control para ocultar navegacion permanece disponible al desplazarse',
  css.includes('.navigation-toggle {\n  position: fixed;')
  && css.includes('left: 0;')
  && css.includes('.layout.sidebar-collapsed .content { padding-left: max(56px, clamp(12px, 2.5vw, 24px)); }')
  && css.includes('.layout.sidebar-open .navigation-toggle')
  && css.includes('border-radius: 10px;')
  && app.includes('function setNavigationToggleState(open)')
  && app.includes("navigationToggle.textContent = open ? '‹' : '›'"));
check('La apertura de la barra revela su contenido de forma gradual',
  css.includes('.sidebar > * {\n  transition: opacity .16s ease, transform .22s cubic-bezier(.22, .75, .25, 1);')
  && css.includes('.layout.sidebar-open .sidebar > * { opacity: 1; transform: translateX(0); transition-delay: .1s; }')
  && css.includes('transition-delay: .08s;'));
check('La pantalla activa se conserva al refrescar sin persistir formularios',
  app.includes("const ACTIVE_VIEW_STORAGE_KEY = 'tienda-active-view'")
  && app.includes('window.sessionStorage.setItem(ACTIVE_VIEW_STORAGE_KEY, id)')
  && app.includes("window.sessionStorage.getItem(ACTIVE_VIEW_STORAGE_KEY) || 'inicio'")
  && app.includes('await loadView(rememberedView);'));
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
