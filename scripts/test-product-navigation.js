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
  "{ id: 'reportes', label: 'Reportes'",
  "{ id: 'tiendaOnline', label: 'Tienda online'"
].every((value) => app.includes(value)));
check('Configuracion, equipo y auditoria viven en la tuerca',
  !app.includes("{ id: 'administracion', label: 'Administracion y configuracion'")
  && html.includes('id="settingsStoreButton"')
  && html.includes('id="settingsAuditButton"')
  && html.includes('id="settingsTeamButton"')
  && !html.includes('id="settingsOnlineStoreButton"')
  && app.includes("const settingsViews = new Set(['configuracion', 'equipo', 'auditoria'])")
  && app.includes("const isDedicatedWorkspace = settingsViews.has(id) || id === 'ayuda';")
  && css.includes('.layout.settings-workspace .sidebar')
  && app.includes('const hideQuickActions = id === \'ayuda\' || settingsViews.has(id);')
  && css.includes('.quick-actions[hidden] { display: none !important; }'));
check('Ventas conserva POS, historial, cobranza y devoluciones',
  app.includes("sections: ['ventas', 'historialVentas', 'pagos', 'compensaciones']"));
check('Inventario conserva sus destinos en el orden operativo solicitado',
  app.includes("sections: ['productos', 'compras', 'proveedores', 'movimientosStock', 'inventarioInteligente', 'inventarioOperativo', 'lotesVencimientos']"));
check('Mi plan usa una ruta existente y segura',
  html.includes('href="/suscripcion.html"') && html.includes('id="accountMenu"') && !html.includes('subscriptionSummary" class="subscription-summary" href'));
check('Compensaciones usa solo el texto visible aprobado',
  app.includes("['compensaciones', 'Devoluciones y anulaciones'") && !app.includes("['compensaciones', 'Compensaciones'"));
check('Los accesos por plan se conservan y los modulos bloqueados permanecen visibles',
  app.includes('function sectionAvailable(id)')
  && app.includes("features.includes('anulaciones_operativas')")
  && app.includes("button.textContent = available ? label : `${label} 🔒`;")
  && app.includes('function openPlanAccessNotice(id)'));
check('Tienda online aparece debajo de Reportes y se bloquea antes de Standard',
  app.indexOf("{ id: 'tiendaOnline', label: 'Tienda online'") > app.indexOf("{ id: 'reportes', label: 'Reportes'")
  && app.includes("features.includes('portal_clientes')")
  && app.includes("id === 'tiendaOnline' ? 'Standard' : null"));
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
  /\.sidebar > \* \{\s*transition: opacity \.16s ease, transform \.22s cubic-bezier\(\.22, \.75, \.25, 1\);/.test(css)
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
