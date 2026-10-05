const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const app = read('public/js/app.js');
const operations = read('public/js/inventory-adjustment-ui.js');
const css = read('public/css/styles.css');
const checks = [];

function check(name, ok) { checks.push({ name, ok: Boolean(ok) }); }

check('Inventario conserva todos los destinos en su orden operativo', app.includes("sections: ['productos', 'compras', 'proveedores', 'movimientosStock', 'inventarioInteligente', 'inventarioOperativo', 'lotesVencimientos']"));
check('Subnavegacion reutiliza destinos y guards existentes', app.includes('inventoryWorkspaceSections') && app.includes('sectionAvailable(id)') && app.includes('data-inventory-workspace'));
check('Productos conserva filtros en ventana y prioriza agregar', ['Agregar producto', 'productSearch', 'productCategory', 'productProvider', 'productLowStock', 'productSort', 'id="productFilterDialog"', 'Limpiar'].every((value) => app.includes(value)));
check('Los selectores usan la lista propia en pantallas y ventanas', app.includes('function enhanceListMenu(select)') && app.includes('function observeListMenus(root)') && app.includes('observeListMenus(view)') && app.includes('observeListMenus(modalRoot)') && css.includes('.list-menu-popover') && css.includes('.list-menu-trigger'));
check('Las listas largas se desplazan sin mostrar barra lateral', css.includes('scrollbar-width: none;') && css.includes('.list-menu-popover::-webkit-scrollbar { display: none; }'));
check('Acciones secundarias de producto quedan agrupadas', app.includes('class="row-actions"') && app.includes('Más opciones') && ['Ajustar stock', 'Ver movimientos', 'Ocultar'].every((value) => app.includes(value)));
check('Movimientos conserva búsqueda visible y filtros en ventana', app.includes('Stock y movimientos') && app.includes('id="movementSearch"') && app.includes('id="movementFilterDialog"') && app.includes('/api/movimientos-stock?${query}'));
check('Compras conserva flujo y evita doble envio', app.includes('inventory-purchase-flow') && app.includes('1. Proveedor y productos') && app.includes('2. Cantidades y costos') && app.includes("UiPatterns.mutation(form.querySelector('button[type=\"submit\"]')"));
check('Proveedores conserva CRUD y ofrece estado vacio', app.includes("renderCrud('proveedores'") && app.includes('Agregar proveedor') && app.includes('Aún no tienes proveedores'));
check('Lotes e inteligencia usan filtros confirmados en ventanas', app.includes('id="lotFilterDialog"') && app.includes('lotUi.appliedFilters = readLotFilters(form)') && app.includes('id="inventoryFilterDialog"') && app.includes('inventoryUi.appliedFilters = formData(form)') && app.includes("UiPatterns.skeleton('rows', 4)"));
check('Inventario operativo conserva permisos, trazabilidad y mutacion', operations.includes("hasFeature('ajuste_stock')") && operations.includes('claveOperacion: operationKey') && operations.includes('data-adjustment-submit'));
check('Frontend no decide tenant ni debilita guards', !/idTienda\s*:/.test(app) && !/idTienda/.test(operations) && app.includes('applyReadOnlyUi()'));
check('Responsive preserva tablas internas y acciones accesibles', css.includes('.inventory-workspace-nav') && css.includes('.row-actions') && css.includes('@media (max-width: 560px)'));

const failures = checks.filter((item) => !item.ok);
checks.forEach((item) => console.log(`${item.ok ? 'OK' : 'FALLO'}: ${item.name}`));
if (failures.length) {
  console.error(`\n${failures.length} comprobacion(es) de PRODUCTO-1 P3 fallaron.`);
  process.exitCode = 1;
} else {
  console.log(`\n${checks.length} comprobaciones de inventario completadas.`);
}
