const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const ui = read('public/js/inventory-adjustment-ui.js');
const app = read('public/js/app.js');
const html = read('public/app.html');
const styles = read('public/css/styles.css');
const routes = read('routes/inventory-adjustments.js');
const stockRoutes = read('routes/stock.js');
const server = read('server.js');
const service = read('services/inventory-adjustment-service.js');
const reconciliation = read('services/inventory-reconciliation-service.js');

const checks = [];
function check(name, condition) {
  checks.push({ name, ok: Boolean(condition) });
}
function includesAll(source, values) {
  return values.every((value) => source.includes(value));
}

check('Modulo cargado antes de app.js',
  html.indexOf('/js/inventory-adjustment-ui.js') < html.indexOf('/js/app.js'));
check('Pantalla protegida por funcionalidades existentes',
  app.includes("['inventarioOperativo', 'Conciliación de inventario'")
  && includesAll(app, ['inventario_resumen', 'historial_stock', 'ajuste_stock']));
check('Frontend nunca envia idTienda', !/\bidTienda\b/.test(ui));
check('Formulario usa tipo, cantidad positiva, motivo y confirmacion',
  includesAll(ui, [
    'name="tipoAjuste"', 'name="cantidad"', 'min="1"', 'name="motivoCodigo"',
    'name="confirmado"', 'otro_controlado'
  ]));
check('Lotes permiten FEFO/FIFO, explicito y nuevo controlado',
  includesAll(ui, ['fefo_fifo', 'lote_explicito', 'lote_nuevo', 'clasificacionInventario']));
check('La clave idempotente se crea una vez por dialogo y no se muestra',
  ui.includes('const operationKey = newOperationKey()')
  && ui.includes('claveOperacion: operationKey')
  && !/type=["'](?:text|hidden)["'][^>]+claveOperacion/i.test(ui));
check('Boton bloqueado durante envio y errores anunciados',
  includesAll(ui, ['submit.disabled = true', 'aria-busy', 'role="alert"', 'aria-live="polite"']));
check('Dialogo nativo restaura foco y admite Escape',
  includesAll(ui, [
    "document.createElement('dialog')", 'dialog.showModal()', "dialog.addEventListener('close'",
    'state.trigger?.focus?.()'
  ]));
check('Tabla accesible distingue fisico, vendible y desglose',
  includesAll(ui, [
    '<caption class="sr-only">', 'scope="col"', 'scope="row"',
    'Stock fisico', 'Stock vendible', 'Vencido:', 'Bloqueado:', 'Aislado:', 'Tecnico:'
  ]));
check('Contenido dinamico se escapa', includesAll(ui, ['${e(row.nombre)}', '${e(error.message', '${e(row.producto)}']));
check('Solicitudes obsoletas no reemplazan resultados',
  ui.includes('const request = ++state.request') && ui.includes('if (request !== state.request) return'));
check('Responsive movil y tablet presente',
  styles.includes('@media (max-width: 900px)')
  && styles.includes('@media (max-width: 560px)')
  && styles.includes('.inventory-adjustment-dialog'));
check('Estados no dependen solamente del color',
  ui.includes('STATUS_LABELS') && styles.includes('border: 1px solid currentColor'));
check('API usa rutas canonicas y no-store',
  includesAll(routes, [
    "'/inventario/conciliacion'", "'/inventario/ajustes'",
    "res.set('Cache-Control', 'no-store')"
  ]));
check('La interfaz visible usa la ruta canonica y la heredada delega post-019',
  !app.includes('/ajustar-stock')
  && stockRoutes.includes('hasCanonicalInventoryAdjustments')
  && stockRoutes.includes('inventoryAdjustmentService.applyAdjustment'));
check('API conserva tenant, suscripcion, CSRF y rate limiting globales',
  server.includes('requireTenant')
  && server.includes('resolveSubscription')
  && server.includes('requireActiveSubscription')
  && server.includes('mutationProtection')
  && server.includes('rateLimiters.api')
  && server.includes('inventoryAdjustmentRoutes'));
check('Backend es autoridad de idTienda',
  routes.includes('req.tenant.idTienda') && !/req\.body\??\.idTienda/.test(routes));
check('Conciliacion es solo lectura',
  !/\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE)\b/i.test(reconciliation));
check('Ajuste usa transaccion, FOR UPDATE, idempotencia y rollback',
  includesAll(service, [
    'beginTransaction()', 'FOR UPDATE', 'huellaSolicitud', 'OPERATION_KEY_CONFLICT',
    'rollback()', 'INVENTORY_CONCURRENT_CHANGE'
  ]));
check('No hay DELETE fisicos en servicios nuevos',
  !/\bDELETE\s+FROM\b/i.test(service) && !/\bDELETE\s+FROM\b/i.test(reconciliation));
check('No se exponen secretos o huellas en la interfaz',
  !/password|cookie|csrf|sqlMessage|stack|huellaSolicitud/i.test(ui));

const failures = checks.filter((item) => !item.ok);
checks.forEach((item) => console.log(`${item.ok ? 'OK' : 'FALLO'}: ${item.name}`));
if (failures.length) {
  console.error(`\n${failures.length} comprobacion(es) frontend fallaron.`);
  process.exitCode = 1;
} else {
  console.log(`\n${checks.length} comprobaciones frontend de inventario completadas.`);
}
