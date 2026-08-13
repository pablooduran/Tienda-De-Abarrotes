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

check('Ventas conserva la familia y guards existentes', app.includes('salesWorkspaceSections') && app.includes('sectionAllowed(id)') && app.includes('data-sales-workspace'));
check('POS prioriza una venta y cliente opcional', app.includes('Registrar venta') && app.includes('Cliente opcional') && app.includes('Cliente ocasional'));
check('Busqueda POS usa debounce y teclado accesible', app.includes('setTimeout(() => searchPosCustomers(query), 250)') && app.includes("aria-autocomplete=\"list\"") && app.includes("event.key === 'ArrowDown'") && app.includes("event.key === 'Escape'"));
check('POS usa busqueda paginada y no recibe tenant del cliente', app.includes("/api/pos/clientes?q=${encodeURIComponent(normalized)}&page=1&limit=15") && !/idTienda\s*:/.test(app));
check('Ruta POS deriva tenant y valida paginacion limitada', pos.includes('tenantId(req)') && pos.includes('customerSearchPagination') && pos.includes('limit > 50') && pos.includes('Paginacion de clientes invalida'));
check('Ruta POS conserva respuesta heredada y agrega contrato paginado', pos.includes('if (!paginated) return res.json(rows)') && pos.includes('hayMas'));
check('Clientes agrupa acciones secundarias y conserva acciones reales', customers.includes('customerActions') && customers.includes('data-customer-pay') && customers.includes('data-customer-hide') && customers.includes('Más opciones'));
check('Clientes reutiliza filtros compactos, skeleton y estado vacio', customers.includes('customer-filter-disclosure') && customers.includes("uiPatterns.skeleton('rows', 4)") && customers.includes("uiPatterns.empty('No hay clientes con estos filtros'"));
check('Historial conserva detalle y comprobante con acciones compactas', app.includes('Historial de ventas') && app.includes('data-detail') && app.includes('data-receipt') && app.includes('Aún no hay ventas registradas'));
check('Estilos mantienen selector, subnavegacion y layout responsive', css.includes('.pos-customer-results') && css.includes('.sales-workspace-nav') && css.includes('@media (max-width: 560px)'));

const failures = checks.filter((item) => !item.ok);
checks.forEach((item) => console.log(`${item.ok ? 'OK' : 'FALLO'}: ${item.name}`));
if (failures.length) {
  console.error(`\n${failures.length} comprobacion(es) de PRODUCTO-1 P4 fallaron.`);
  process.exitCode = 1;
} else {
  console.log(`\n${checks.length} comprobaciones de ventas y clientes completadas.`);
}
