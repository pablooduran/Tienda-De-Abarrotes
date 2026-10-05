const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const app = read('public/js/app.js');
const shell = read('public/app.html');
const css = read('public/css/styles.css');
const pending = read('docs/PENDIENTES_Y_MEJORAS_FUTURAS.md');
const packageJson = JSON.parse(read('package.json'));

const checks = [
  ['Existe el arnés browser de polish', packageJson.scripts['test:product-ui-polish-browser'] === 'node scripts/test-product-ui-polish-browser.js'],
  ['Inicio conserva el resumen principal de cinco días', app.includes('Ventas de los últimos 5 días') && app.includes('id="dailyBars"')],
  ['La participación diaria se muestra como tarjeta fija y preserva su canvas', app.includes('class="panel chart-panel dashboard-period-chart"') && app.includes('Participación por día') && app.includes('id="dailyPie"') && !app.includes('<details class="dashboard-period-detail">')],
  ['Las métricas usan cifras escaneables', css.includes('font-variant-numeric: tabular-nums;')],
  ['Las tablas mantienen una jerarquía visual compacta y compatible con ambos temas',
    css.includes('thead { background: var(--surface); }')
      && css.includes('th { color: var(--muted); font-size: 13px; font-weight: 700; }')
      && css.includes('td { line-height: 1.4; }')],
  ['El detalle de período conserva ancho estable junto al resumen', css.includes('.dashboard-period-chart { min-width: 0; }')],
  ['Los gráficos usan curvas suaves, área y barras redondeadas', app.includes('ctx.bezierCurveTo') && app.includes('ctx.createLinearGradient') && app.includes('Math.min(10, barWidth / 2)')],
  ['Las etiquetas largas de las barras se distribuyen en dos líneas', app.includes('const labelLines = labelWords.length > 1') && app.includes('184 + lineIndex * 13')],
  ['Compras y estados conservan contraste y texto legible en modo oscuro', app.includes('class="badge normal"') && css.includes('.content .badge.normal') && css.includes('.purchase-step { border-left-color: #4ade80; }')],
  ['Compras conserva un orden breve sin textos instructivos repetidos', app.includes('<strong>1. Proveedor y productos</strong></p>') && app.includes('<strong>2. Cantidades y costos</strong></p>') && !app.includes('El proveedor elegido se registrará en esta compra.')],
  ['Los accesos rápidos indican la sección operativa activa', app.includes("button.dataset.quickView === id") && app.includes("button.classList.toggle('quick-action-active', selected)") && css.includes('.quick-actions button.quick-action-active')],
  ['Más opciones se abre anclado a su acción y dentro del área visible', css.includes('.inventory-secondary-actions > div {') && /left:\s*auto;\s*right:\s*0;\s*z-index:\s*80;/.test(css) && css.includes('width: min(280px, calc(100vw - 32px));') && css.includes('max-height: min(60vh, 420px);') && css.includes('.table-wrap:has(.row-actions[open]) { overflow: visible; }') && css.includes('.popover-align-start') && css.includes('.popover-open-up') && app.includes('function positionFloatingDisclosure') && app.includes('floatingDisclosureSelector')],
  ['La guía conserva una burbuja centrada debajo del contenido y realza el objetivo', app.includes('class="guided-tour-highlight"') && app.includes('<section class="guided-tour-card">') && css.includes('left: 50%;') && css.includes('bottom: 28px;') && css.includes('width: min(520px, calc(100vw - 32px));') && css.includes('transform: translateX(-50%);') && !app.includes('Busca el control resaltado en verde')],
  ['La guía bloquea los controles operativos y avanza solo con sus botones', css.includes('.guided-tour { position: fixed; z-index: 80; inset: 0; pointer-events: auto; }') && css.includes('.guided-tour-highlight {') && !app.includes('advanceEvent:') && !app.includes('guided-pos-product-added')],
  ['La guía conserva el avance a la derecha y reemplaza Siguiente por Cerrar al final', app.includes("data-tour-close data-modal-cancel>Salir") && app.includes("data-tour-next>Siguiente") && app.includes("data-tour-close data-modal-cancel>Cerrar")],
  ['Las ventanas flotantes superan la barra lateral y respetan el tema oscuro', css.includes('z-index: 90;') && css.includes('.modal :is(.credit-policy-help') && css.includes('.payment-subscription-section { border-bottom: 1px solid var(--line); }')],
  ['El detalle circular usa una leyenda HTML nítida sin invadir la torta', app.includes('function renderDailyParticipationLegend(labels, values)') && app.includes('id="dailyPieLegend"') && app.includes('class="dashboard-period-legend-row') && css.includes('.dashboard-period-content') && css.includes('.dashboard-period-legend-row')],
  ['El gráfico circular mantiene contraste alto en oscuro', app.includes("const muted = darkTheme ? '#c7d9ca' : '#4d624f';") && app.includes("const ink = darkTheme ? '#f2fbf3' : '#172017';") && css.includes('.dashboard-period-legend-row strong {')],
  ['La torta de participación usa únicamente tonos verdes', app.includes("'#55cf76'") && !app.includes("'#56d9ca'")],
  ['La cuenta queda a la izquierda y su menú flota completo sobre el contenido', shell.includes('class="account-menu sidebar-account-menu" id="accountMenu"') && shell.includes('data-quick-view="pagos">Fiados</button>') && shell.includes('</aside>\n    <button id="navigationToggle"') && css.includes('align-self: flex-start;') && css.includes('.sidebar:has(.sidebar-account-menu[open]) {') && css.includes('z-index: 70;') && css.includes('.sidebar-account-menu .account-menu-panel {') && css.includes('bottom: calc(100% + 10px);') && css.includes('left: 0;') && css.includes('overflow: visible;') && css.includes('z-index: 80;') && app.includes("if (collapsed) accountMenu?.removeAttribute('open');")],
  ['El recorrido inicial conduce por producto, stock y venta con un marco anclado', app.includes("'recorrido-inicial': [") && app.includes("selector: '.product-add-actions > summary'") && app.includes("selector: '#comprasProvider'") && app.includes("selector: '#posSearch'") && !app.includes('guided-tour-pointer') && app.includes('placeGuideCard(modalRoot.querySelector') && css.includes('.guided-tour-highlight::after') && css.includes("content: 'AQUÍ';") && css.includes('.guided-tour-card.is-anchored') && css.includes('.help-welcome-steps')],
  ['La aplicación avisa y recupera las lecturas cuando el servidor sale de reposo', shell.includes('id="serverWakeNotice"') && shell.includes('El servidor estaba en reposo') && app.includes('function fetchWithWakeupRecovery(url, options)') && app.includes('const canRetry = [\'GET\', \'HEAD\', \'OPTIONS\'].includes(method);') && app.includes('isRecoverableWakeupResponse(response)') && css.includes('.server-wake-notice {')],
  ['Cierre de caja organiza el arqueo en pasos y presenta un resumen antes de guardar', app.includes('class="cash-closure-workspace panel"') && app.includes('data-closure-preset="today"') && app.includes('Primero calcula, luego guarda.') && css.includes('.cash-closure-step,' ) && css.includes('.cash-closure-actions,' )],
  ['Reportes guía la selección, filtros y consulta en una misma estructura', app.includes('class="report-workspace panel"') && app.includes('REPORT_TYPE_INFO') && app.includes('id="reportDescription"') && css.includes('.report-dynamic-filters') && css.includes('.report-actions')],
  ['El fondo usa el árbol de marca como textura tenue sin cubrir el contenido', css.includes("background: url('/assets/administrau-icon.png')") && css.includes('.content::before,') && css.includes('.content > * { position: relative; z-index: 1; }') && css.includes('html[data-theme="dark"] .content::before')],
  ['La cabecera conserva su contenedor y la flecha supera el panel lateral', css.includes('.content > .topbar { z-index: 40; }') && css.includes('border: 1px solid color-mix(in srgb, var(--line) 82%, var(--brand) 18%);') && css.includes('box-shadow: 0 10px 26px rgba(29, 39, 51, .09)')],
  ['UX-005 se registra como resuelto en P7E', pending.includes('| UX-005 |') && pending.includes('Resuelto en P7E')],
  ['TECH-026 queda resuelto tras P8', pending.includes('| TECH-026 |') && pending.includes('Resuelto: local 3/3 PASS')],
  ['El frontend no controla tenant', !app.includes('idTienda')]
];

for (const [name, ok] of checks) {
  assert(ok, `FALLO: ${name}`);
  console.log(`OK: ${name}`);
}

console.log('test:product-ui-polish OK');
