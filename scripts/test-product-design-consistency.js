const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const app = read('public/js/app.js');
const admin = read('public/js/admin.js');
const paymentUi = read('public/js/payment-subscription-ui.js');
const customerCreditUi = read('public/js/customer-credit-ui.js');
const styles = read('public/css/styles.css');
const adminStyles = read('public/css/admin.css');

const checks = [
  ['Inicio tiene una jerarquia orientada a la tarea', app.includes('<h3>Resumen de hoy</h3>') && app.includes('Ventas, cobros, inventario y alertas para decidir que revisar.')],
  ['Los dialogos pasivos usan Cerrar', app.includes("confirmText = 'Cerrar'") && app.includes("confirmText: 'Cerrar'")],
  ['Productos usa acciones concretas de guardado', app.includes("confirmText: isEdit ? 'Guardar cambios' : 'Agregar producto'")],
  ['Mi plan mantiene revisar precio como accion primaria', paymentUi.includes('button-link payment-primary') && paymentUi.includes('Ver precio') && paymentUi.includes('Solicitar este plan')],
  ['La accion primaria de pagos tiene estilo compartido', styles.includes('.payment-form-actions .payment-primary')],
  ['El punto de venta calcula descuentos por porcentaje solo al solicitarlos', app.includes('id="posDiscountPercentage"') && app.includes('subtotal * (discountPercentage / 100)') && app.includes('id="posDiscountToggle"') && app.includes('id="posDiscountControl" hidden')],
  ['El punto de venta separa cliente ocasional y frecuente', app.includes('data-pos-customer-mode="ocasional"') && app.includes('data-pos-customer-mode="frecuente"') && app.includes('id="posFrequentClientPicker"') && styles.includes('.pos-frequent-client-picker[hidden] { display: none; }') && app.includes("api('/api/clientes')")],
  ['El catálogo conserva y permite cambiar el proveedor sugerido', app.includes('matchingStoreProvider(masterProvider)') && app.includes("|| 'Sin proveedor'") && app.includes('data-change-provider') && styles.includes('.catalog-provider-panel { position: relative;') && app.includes('Se registrará automáticamente si no existe')],
  ['El catálogo no repite una presentación idéntica', app.includes('function catalogSizeFor(product)') && app.includes("new Map(parts.map((part) => [String(part).trim().replace(/\\s+/g, ' ').toLocaleLowerCase('es'), part]))")],
  ['El catálogo muestra unidades por paquete solo cuando corresponde', app.includes('data-package-units') && styles.includes('.catalog-package-units[hidden] { display: none; }')],
  ['El fiado exige cliente frecuente y el efectivo calcula cambio solo al pedirlo', app.includes('updatePosPaymentOptions(frequent)') && app.includes('creditOption.hidden = !frequent') && app.includes('id="posCashReceivedToggle"') && app.includes('Cambio <strong>Bs ${money(payment.change)}</strong>')],
  ['El comprobante conserva contraste en modo oscuro', styles.includes('html[data-theme="dark"] .receipt { --ink: #172027;') && styles.includes('background: #fff; color: #172027;')],
  ['Los documentos blancos se separan visualmente del modal oscuro', styles.includes('border: 1px solid #aab8c1;') && styles.includes('box-shadow: 0 8px 20px rgba(5, 27, 16, .12);')],
  ['La alerta de cobranza es legible y se puede ocultar', customerCreditUi.includes('data-dismiss-collection-plan-notice') && customerCreditUi.includes('collectionPlanNoticeHidden') && styles.includes('html[data-theme="dark"] .collection-plan-notice { color: #ffebad;')],
  ['Los botones de filtros conservan sus palabras completas', styles.includes('.credit-filter-actions button { min-width: 78px; white-space: nowrap; }')],
  ['Superadmin agrupa acciones poco frecuentes', admin.includes('function adminMoreActions(buttons)') && admin.includes("summary.textContent = 'Mas opciones'")],
  ['El menu administrativo conserva foco visible', adminStyles.includes('.admin-more-actions summary:focus-visible')],
  ['Superadmin mantiene el documento fijo y desplaza solo el contenido', adminStyles.includes('scrollbar-gutter: stable') && adminStyles.includes('overscroll-behavior: contain') && /html,\s*body\s*\{[\s\S]*?overflow:\s*hidden/.test(adminStyles)],
  ['Pagos administrativos evita columnas desiguales', adminStyles.includes('.payment-admin-grid { display: grid; grid-template-columns: minmax(0, 1fr);')],
  ['No se modifican contratos de tenant desde la interfaz', !paymentUi.includes('idTienda')]
];

for (const [name, ok] of checks) {
  assert(ok, `FALLO: ${name}`);
  console.log(`OK: ${name}`);
}

console.log('test:product-design-consistency OK');
