const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const appHtml = read('public/app.html');
const appJs = read('public/js/app.js');
const experience = read('public/js/workspace-experience.js');
const styles = read('public/css/styles.css');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(appHtml.includes('id="workspaceTools"'), 'Falta el acceso a herramientas del espacio de trabajo.');
assert(appHtml.includes('id="customizeDashboardButton"'), 'Personalizar inicio debe vivir dentro del menú de configuración.');
assert(appHtml.includes('/js/workspace-experience.js'), 'El módulo de experiencia no está cargado.');
assert(appHtml.indexOf('/js/workspace-experience.js') < appHtml.indexOf('/js/app.js'), 'El módulo debe cargarse antes de app.js.');

[
  'data-workspace-search',
  'data-workspace-notifications',
  "event.key.toLocaleLowerCase() === 'k'",
  "event.key === 'F2'",
  'data-dashboard-widget',
  "saveDraft(name, payload)",
  "api('/api/auditoria?page=1&pageSize=5')"
].forEach((fragment) => assert(experience.includes(fragment), `Falta el contrato de experiencia: ${fragment}`));

assert(!experience.includes('idTienda'), 'La experiencia del navegador no debe enviar ni decidir el tenant.');
assert(appJs.includes('workspaceExperience?.afterView(id)'), 'Las mejoras no se aplican después de cada vista.');
assert(appJs.includes("workspaceExperience?.clearDraft('ventas')"), 'La venta no limpia su borrador al completarse.');
assert(appJs.includes('workspaceExperience?.clearDraft(kind)'), 'La operación no limpia su borrador al completarse.');
assert(appJs.includes('confirmation-impact'), 'Las confirmaciones no muestran el impacto de la operación.');
assert(appJs.includes('workspaceExperience?.openDashboardCustomizer()'), 'La tuerca no abre la personalización del inicio.');
assert(!experience.includes('<kbd>Ctrl K</kbd>'), 'El acceso Buscar no debe mostrar el atajo Ctrl K.');
assert(!experience.includes('¿Qué puedo hacer aquí?'), 'Los estados vacíos no deben repetir ayuda genérica.');

[
  '.workspace-command',
  '.workspace-drawer',
  '.workspace-sticky-action',
  '@media (max-width: 700px)',
  '@media (prefers-reduced-motion: reduce)'
].forEach((fragment) => assert(styles.includes(fragment), `Falta el estilo transversal: ${fragment}`));

console.log('PASS: experiencia transversal, borradores, actividad y responsive verificados.');
