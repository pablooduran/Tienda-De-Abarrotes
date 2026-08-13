const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const ui = read('public/js/administrative-audit-ui.js');
const app = read('public/js/app.js');
const appHtml = read('public/app.html');
const admin = read('public/js/admin.js');
const adminHtml = read('public/admin.html');
const styles = read('public/css/styles.css');
const adminStyles = read('public/css/admin.css');
const routes = read('routes/audit.js');
const server = read('server.js');

const checks = [];
function check(name, condition) {
  checks.push({ name, ok: Boolean(condition) });
}
function includesAll(source, values) {
  return values.every((value) => source.includes(value));
}

check('Modulo compartido cargado en ambas aplicaciones',
  appHtml.indexOf('/js/administrative-audit-ui.js') < appHtml.indexOf('/js/app.js')
  && adminHtml.indexOf('/js/administrative-audit-ui.js') < adminHtml.indexOf('/js/admin.js'));
check('Pantalla del dueno disponible sin funcionalidad comercial nueva',
  app.includes("['auditoria', 'Auditoria'")
  && app.includes("mode: 'tenant'")
  && !app.includes("id === 'auditoria') return features.includes"));
check('Pantalla global exclusiva del superadmin',
  adminHtml.includes('id="auditAdminLink"')
  && admin.includes("mode: 'admin'")
  && server.includes("requireRole('superadmin'), adminAuditRoutes"));
check('Filtros completos y paginacion backend',
  includesAll(ui, [
    'fechaDesde', 'fechaHasta', 'categoria', 'resultado', 'actor',
    'idAdministrador', 'accion', 'entidad', 'idTienda', 'pageSize',
    'hasNextPage', 'hasPreviousPage'
  ]));
check('Detalle usa modal nativo y restaura foco',
  includesAll(ui, [
    "document.createElement('dialog')", "dialog.showModal()",
    "state.trigger?.focus()", "aria-labelledby"
  ]));
check('Carga, vacio, error y reintento accesibles',
  includesAll(ui, [
    'aria-busy', 'role="status"', 'role="alert"', 'data-audit-retry',
    'No hay eventos que coincidan'
  ]));
check('Tablas tienen caption y encabezados',
  ui.includes('<caption class="sr-only">Eventos de auditoria administrativa</caption>')
  && ui.includes('<thead><tr>'));
check('Contenido dinamico se escapa',
  includesAll(ui, [
    '${e(eventLabel(row.accion))}', '${e(actorLabel(row.actor))}',
    '${e(item.referencia', '${e(error.message)}'
  ]));
check('No se muestran requestId, payloads completos ni datos sensibles',
  !/requestId|password|cookie|csrf|sqlMessage|stack|claveOperacion|huellaSolicitud/i.test(ui));
check('No existe accion de escritura en la interfaz',
  !/method:\s*['"](?:POST|PUT|PATCH|DELETE)['"]/i.test(ui)
  && !/router\.(post|put|patch|delete)\s*\(/i.test(routes));
check('Responsive en movil y tablet para dueno',
  styles.includes('@media (max-width: 900px)')
  && styles.includes('@media (max-width: 560px)')
  && styles.includes('.audit-mobile-list'));
check('Responsive en movil y tablet para superadmin',
  adminStyles.includes('@media (max-width: 900px)')
  && adminStyles.includes('@media (max-width: 560px)')
  && adminStyles.includes('.audit-mobile-list'));
check('Estados no dependen unicamente del color',
  ui.includes('RESULT_LABELS')
  && ui.includes('audit-status-')
  && styles.includes('border: 1px solid currentColor'));
check('Solicitudes obsoletas no reemplazan resultados actuales',
  ui.includes('const request = ++state.request')
  && ui.includes('if (request !== state.request) return;'));
check('Consulta protegida sin cache',
  routes.includes("res.set('Cache-Control', 'no-store')")
  && /app\.use\(\s*['"]\/api\/auditoria['"]\s*,\s*rateLimiters\.admin/.test(server));

const failures = checks.filter((item) => !item.ok);
checks.forEach((item) => console.log(`${item.ok ? 'OK' : 'FALLO'}: ${item.name}`));
if (failures.length) {
  console.error(`\n${failures.length} comprobacion(es) frontend fallaron.`);
  process.exitCode = 1;
} else {
  console.log(`\n${checks.length} comprobaciones frontend de auditoria completadas.`);
}
