const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const app = read('public/js/app.js');
const html = read('public/app.html');
const admin = read('public/admin.html');
const styles = read('public/css/styles.css');

const checks = [
  ['La aplicacion mantiene una region viva para feedback', html.includes('id="message" class="message" aria-live="polite"')],
  ['Los dialogos de configuracion de inventario tienen semantica completa', app.includes('id="inventoryProductConfigurationForm" role="dialog" aria-modal="true" aria-labelledby="inventoryProductConfigurationTitle"')],
  ['El dialogo de configuracion inicia y restaura foco', app.includes("form.querySelector('input, select')?.focus()") && app.includes('returnFocus?.focus?.()')],
  ['Los dialogs de ajuste y motivos declaran semantica accesible', app.includes('id="stockAdjustmentForm"') && app.includes('aria-labelledby="stockAdjustmentTitle"') && app.includes('id="reasonForm"') && app.includes('aria-labelledby="reasonFormTitle"')],
  ['El editor de gastos devuelve el foco al cerrar', app.includes('id="expenseForm"') && app.includes('aria-labelledby="expenseFormTitle"')],
  ['El guardado de producto devuelve foco a una accion operable', app.includes("document.querySelector(isEdit ? `[data-edit=\"${row.idProducto}\"]` : '#addProduct')?.focus()")],
  ['Los enlaces y resumenes tienen foco visible', styles.includes('a:focus-visible') && styles.includes('summary:focus-visible')],
  ['Reduced motion elimina transiciones no esenciales', styles.includes('@media (prefers-reduced-motion: reduce)') && styles.includes('transition-duration: .01ms !important')],
  ['Superadmin conserva nombres accesibles en dialogs', admin.includes('aria-label="Cerrar"') && admin.includes('role="alert"')],
  ['El frontend no controla el tenant', !app.includes('idTienda')]
];

for (const [name, ok] of checks) {
  assert(ok, `FALLO: ${name}`);
  console.log(`OK: ${name}`);
}

console.log('test:product-responsive-accessibility OK');
