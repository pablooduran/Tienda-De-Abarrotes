const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const app = read('public/js/app.js');
const admin = read('public/js/admin.js');
const paymentUi = read('public/js/payment-subscription-ui.js');
const styles = read('public/css/styles.css');
const adminStyles = read('public/css/admin.css');

const checks = [
  ['Inicio tiene una jerarquia orientada a la tarea', app.includes('<h3>Resumen de hoy</h3>') && app.includes('Ventas, cobros, inventario y alertas para decidir que revisar.')],
  ['Los dialogos pasivos usan Cerrar', app.includes("confirmText = 'Cerrar'") && app.includes("confirmText: 'Cerrar'")],
  ['Productos usa acciones concretas de guardado', app.includes("confirmText: isEdit ? 'Guardar cambios' : 'Agregar producto'")],
  ['Mi plan mantiene cotizacion como accion primaria', paymentUi.includes('button-link payment-primary') && paymentUi.includes('Crear solicitud de pago')],
  ['La accion primaria de pagos tiene estilo compartido', styles.includes('.payment-form-actions .payment-primary')],
  ['Superadmin agrupa acciones poco frecuentes', admin.includes('function adminMoreActions(buttons)') && admin.includes("summary.textContent = 'Mas opciones'")],
  ['El menu administrativo conserva foco visible', adminStyles.includes('.admin-more-actions summary:focus-visible')],
  ['No se modifican contratos de tenant desde la interfaz', !paymentUi.includes('idTienda')]
];

for (const [name, ok] of checks) {
  assert(ok, `FALLO: ${name}`);
  console.log(`OK: ${name}`);
}

console.log('test:product-design-consistency OK');
