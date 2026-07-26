const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const ui = read('public/js/compensation-ui.js');
const app = read('public/js/app.js');
const html = read('public/app.html');
const css = read('public/css/styles.css');
const routes = read('routes/financial-compensations.js');
const queryService = read('services/compensation-query-service.js');
const exportService = read('services/compensation-export-service.js');
const server = read('server.js');

const checks = [];
function check(name, condition) {
  checks.push({ name, ok: Boolean(condition) });
}
function includesAll(source, values) {
  return values.every((value) => source.includes(value));
}

check('Modulo frontend cargado antes de app.js',
  html.indexOf('/js/compensation-ui.js') > 0
  && html.indexOf('/js/compensation-ui.js') < html.indexOf('/js/app.js'));
check('Seccion protegida por anulaciones_operativas',
  app.includes("id === 'compensaciones'")
  && app.includes("features.includes('anulaciones_operativas')"));
check('API canonica de consulta usa funcionalidad',
  routes.includes("'/compensaciones'")
  && routes.includes('requirePlanFeature(COMPENSATION_FEATURE)'));
check('Exportaciones exigen permiso adicional',
  routes.includes("requirePlanFeature('exportacion_reportes')")
  && routes.includes('requireExportSubscription')
  && server.includes("app.use('/api/compensaciones/exportaciones', rateLimiters.export)"));
check('Consultas y conteos filtran tenant',
  queryService.includes("conditions = ['oc.idTienda=?']")
  && queryService.includes('WHERE lcv.idTienda=?')
  && queryService.includes('WHERE ore.idTienda=?'));
check('Filtros estables antes de paginar',
  includesAll(queryService, [
    'fechaDesde', 'fechaHasta', 'tipo', 'estado', 'usuario', 'cliente', 'venta',
    'ORDER BY oc.fechaSolicitud DESC', 'LIMIT ? OFFSET ?'
  ]));
check('Limite de exportacion es explicito y no trunca',
  queryService.includes('MAX_EXPORT_ROWS = 10000')
  && queryService.includes('COMPENSATION_EXPORT_LIMIT_EXCEEDED'));
check('CSV y XLSX disponibles',
  exportService.includes("['csv', 'xlsx']")
  && ui.includes("['historial', 'Historial']")
  && ui.includes('data-compensation-export'));
check('Neutralizacion de formulas compartida',
  exportService.includes('sanitizeSpreadsheetCell')
  && exportService.includes('safeText(value)'));
check('Reportes separan bruto compensacion reembolso y neto',
  includesAll(exportService, [
    'VentasBrutas', 'CompensacionComercial', 'VentasNetas',
    'ReembolsosMateriales', 'FlujoCobradoNeto', 'ReduccionDeuda'
  ]));
check('Interfaz no envia idTienda', !/idTienda\s*:/.test(ui));
check('Clave idempotente permanece dentro del formulario',
  includesAll(ui, [
    'const key = `comp-ui-sale:${newOperationKey()}`',
    'const key = `comp-ui-collection:${newOperationKey()}`',
    'const key = `comp-ui-payment:${newOperationKey()}`',
    'button.disabled = true'
  ]) && !ui.includes('data-operation-key'));
check('Conflicto idempotente tiene mensaje seguro',
  ui.includes("error.code === 'OPERATION_KEY_CONFLICT'")
  && !ui.includes('huellaSolicitud'));
check('Resumen previo y preservacion del original',
  ui.includes('Resumen previo')
  && ui.includes('registro original permanecera en el historial')
  && !/Eliminar (venta|pago|cobro)/i.test(ui));
check('Motivo controlado y observacion validados',
  ui.includes("reason === 'otro_controlado'")
  && ui.includes('observacion de al menos 8 caracteres'));
check('Credito a favor permanece no disponible',
  ui.includes('El credito a favor no esta disponible')
  && !ui.includes("option('credito_a_favor'"));
check('Contenido dinamico se escapa',
  ui.includes('escapeHtml: e')
  && includesAll(ui, [
    '${e(row.cliente)}', '${e(row.administrador)}', '${e(row.observacion',
    '${e(receipt.observacion)}', '${e(data.responsable'
  ]));
const receiptSource = ui.slice(
  ui.indexOf('function receiptMarkup'),
  ui.indexOf('async function openReceipt')
);
check('Comprobante no muestra claves ni huellas',
  ui.includes('Comprobante de compensacion')
  && !/claveOperacion|huellaSolicitud|token CSRF/i.test(receiptSource));
check('Impresion distingue documento no fiscal',
  ui.includes('No es una factura fiscal')
  && css.includes('body.printing-compensation')
  && css.includes('.modal-actions { display: none !important; }'));
check('Accesibilidad basica presente',
  includesAll(ui, [
    'role="dialog"', 'aria-modal="true"', 'aria-labelledby=',
    'role="alert"', 'aria-live="assertive"', 'role="tablist"', 'aria-selected='
  ]));
check('Responsive para tablet y movil',
  css.includes('@media (max-width: 900px)')
  && css.includes('@media (max-width: 560px)')
  && css.includes('.compensation-mobile-list'));
check('Respuestas obsoletas no reemplazan otra vista',
  ui.includes('const request = ++ui.request')
  && ui.includes('if (request !== ui.request) return;')
  && ui.includes('async function switchTab(tab) {\n      ui.request += 1;'));
check('No existe borrado fisico en C4B',
  !/DELETE\s+FROM/i.test(queryService + exportService + routes));
check('Las rutas de escritura existentes no se duplicaron',
  (routes.match(/'\/ventas\/:idVenta\/compensaciones'/g) || []).length === 0
  && (routes.match(/'\/obligaciones-reembolso\/:idObligacion\/liquidaciones'/g) || []).length === 1);

const failures = checks.filter((item) => !item.ok);
checks.forEach((item) => console.log(`${item.ok ? 'OK' : 'FALLO'}: ${item.name}`));
if (failures.length) {
  console.error(`\n${failures.length} comprobacion(es) frontend fallaron.`);
  process.exitCode = 1;
} else {
  console.log(`\n${checks.length} comprobaciones frontend de compensaciones completadas.`);
}
