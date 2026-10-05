const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const app = read('public/js/app.js');
const customers = read('public/js/customer-credit-ui.js');
const pos = read('routes/pos.js');
const css = read('public/css/styles.css');
const checks = [];

function check(name, ok) { checks.push({ name, ok: Boolean(ok) }); }

check('Ventas conserva la familia y guards existentes', app.includes('salesWorkspaceSections') && app.includes('sectionAvailable(id)') && app.includes('data-sales-workspace'));
check('POS prioriza una venta y cliente opcional', app.includes('Registrar venta') && app.includes('Cliente ocasional') && app.includes('Cliente frecuente'));
check('Busqueda POS usa debounce y teclado accesible', app.includes('posSearchTimer') && app.includes('setTimeout(() => loadPosProducts(), 180)') && app.includes('Buscar o escanear producto'));
check('POS mantiene el cliente opcional y no recibe tenant del cliente', app.includes('id="posClient" disabled') && app.includes("data-pos-customer-mode=\"frecuente\"") && !/idTienda\s*:/.test(app));
check('Ruta POS deriva tenant y valida paginacion limitada', pos.includes('tenantId(req)') && pos.includes('customerSearchPagination') && pos.includes('limit > 50') && pos.includes('Paginacion de clientes invalida'));
check('Ruta POS conserva respuesta heredada y agrega contrato paginado', pos.includes('if (!paginated) return res.json(rows)') && pos.includes('hayMas'));
check('Clientes agrupa acciones secundarias y conserva acciones reales', customers.includes('customerActions') && customers.includes('data-customer-pay') && customers.includes('data-customer-hide') && customers.includes('Más opciones'));
check('Clientes usa filtros en ventana, skeleton y estado vacio', customers.includes('data-customer-filter-dialog') && customers.includes('data-open-customer-filters') && customers.includes("uiPatterns.skeleton('rows', 4)") && customers.includes("uiPatterns.empty('No hay clientes con estos filtros'"));
check('Historial conserva detalle y comprobante con acciones compactas', app.includes('Historial de ventas') && app.includes('data-detail') && app.includes('data-receipt') && app.includes('Aún no hay ventas registradas'));
check('Estilos mantienen selector, subnavegacion y layout responsive', css.includes('.pos-customer-mode') && css.includes('.sales-workspace-nav') && css.includes('@media (max-width: 560px)'));
check('POS diferencia stock agotado y bajo', app.includes('pos-stock-${stockState}') && app.includes("stockState === 'out'") && css.includes('.pos-product.pos-stock-out') && css.includes('.pos-product.pos-stock-low'));
check('POS explica y registra pagos parciales solo con cliente', app.includes('const frequentCustomer = Boolean(document.getElementById(\'posClient\')?.value)') && app.includes('Pago parcial: queda pendiente') && app.includes('Selecciona un cliente para dejar saldo pendiente.'));
check('Comprobante abre WhatsApp con alternativa si se bloquea una pestaña', app.includes('const openWhatsApp = (url)') && app.includes("window.location.assign(url)"));

const failures = checks.filter((item) => !item.ok);
checks.forEach((item) => console.log(`${item.ok ? 'OK' : 'FALLO'}: ${item.name}`));
if (failures.length) {
  console.error(`\n${failures.length} comprobacion(es) de PRODUCTO-1 P4 fallaron.`);
  process.exitCode = 1;
} else {
  console.log(`\n${checks.length} comprobaciones de ventas y clientes completadas.`);
}
