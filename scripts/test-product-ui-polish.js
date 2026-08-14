const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const app = read('public/js/app.js');
const css = read('public/css/styles.css');
const pending = read('docs/PENDIENTES_Y_MEJORAS_FUTURAS.md');
const packageJson = JSON.parse(read('package.json'));

const checks = [
  ['Existe el arnés browser de polish', packageJson.scripts['test:product-ui-polish-browser'] === 'node scripts/test-product-ui-polish-browser.js'],
  ['Inicio conserva el resumen principal de cinco días', app.includes('Ventas de los últimos 5 días') && app.includes('id="dailyBars"')],
  ['El detalle diario queda subordinado y preserva su canvas', app.includes('class="dashboard-period-detail"') && app.includes('Ver detalle del período') && app.includes('id="dailyPie"')],
  ['Las métricas usan cifras escaneables', css.includes('font-variant-numeric: tabular-nums;')],
  ['Las tablas mantienen una jerarquía visual compacta', css.includes('thead { background: #f8faf9; }') && css.includes('td { line-height: 1.4; }')],
  ['El detalle de período conserva foco y estado visible', css.includes('.dashboard-period-detail > summary') && css.includes('.dashboard-period-detail[open] > summary::after')],
  ['UX-005 se registra como resuelto en P7E', pending.includes('| UX-005 |') && pending.includes('Resuelto en P7E')],
  ['TECH-026 permanece pendiente para P8', pending.includes('| TECH-026 |') && pending.includes('P8 / pruebas finales')],
  ['El frontend no controla tenant', !app.includes('idTienda')]
];

for (const [name, ok] of checks) {
  assert(ok, `FALLO: ${name}`);
  console.log(`OK: ${name}`);
}

console.log('test:product-ui-polish OK');
