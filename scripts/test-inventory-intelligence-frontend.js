const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const app = read('public/js/app.js');
const styles = read('public/css/styles.css');
const routes = read('routes/inventory-intelligence.js');
const service = read('services/inventory-intelligence-service.js');
const exporter = read('services/inventory-intelligence-export-service.js');

const checks = [];
function check(name, value) {
  checks.push({ name, value: Boolean(value) });
}

function section(source, start, end) {
  const from = source.indexOf(start);
  const until = source.indexOf(end, from + start.length);
  return from < 0 ? '' : source.slice(from, until < 0 ? undefined : until);
}

const intelligenceUi = section(app, 'function inventoryFeature', 'function lotDate');
const alertService = section(service, 'async function inventoryAlerts', 'async function inventoryRanking');
const suggestionService = section(service, 'async function suggestedPurchases', 'async function inventoryRotation');
const rotationService = section(service, 'async function inventoryRotation', 'async function inventoryWithoutMovement');

check('La interfaz no elige ni envia idTienda', !/idTienda/.test(intelligenceUi));
check('La interfaz ofrece ventanas 7, 30 y 90 dias', ['value="7"', 'value="30"', 'value="90"']
  .every((value) => intelligenceUi.includes(value)));
check('La interfaz muestra stock fisico, vendible y no vendible', ['Físico / vendible', 'No vendible']
  .every((value) => intelligenceUi.includes(value)));
check('La interfaz expone filtros de prioridad y estado de sugerencia',
  intelligenceUi.includes('name="prioridad"') && intelligenceUi.includes('name="estadoSugerencia"'));
check('La interfaz evita respuestas obsoletas',
  intelligenceUi.includes('const request = ++inventoryUi.request') && intelligenceUi.includes('request === inventoryUi.request'));
check('La interfaz reinicia pagina al cambiar filtros o pestaña',
  (intelligenceUi.match(/inventoryUi\.page = 1/g) || []).length >= 3);
check('La exportacion conserva filtros y selecciona el informe visible',
  intelligenceUi.includes('tipoExportacion') && intelligenceUi.includes('SecurityHttp.secureFetch'));
check('Alertas legibles incluyen prioridad, tipo y explicacion',
  ['row.prioridad', 'row.tipo', 'row.mensaje'].every((value) => intelligenceUi.includes(value)));
check('Paginacion es accesible', intelligenceUi.includes('aria-label="Paginación de inventario"'));
check('Las tablas conservan caption accesible', (intelligenceUi.match(/caption class="sr-only"/g) || []).length >= 3);
check('Los estados no dependen solo del color',
  intelligenceUi.includes('inventory-status-') && styles.includes('.inventory-status-critical'));
check('Movil conserva una sola columna para sugerencias y paginacion',
  styles.includes('.inventory-suggestion-list { grid-template-columns: 1fr; }')
  && styles.includes('.inventory-pagination { display: grid; grid-template-columns: 1fr; }'));
check('Alertas se calculan sin escrituras SQL', !/\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE)\b/i.test(alertService));
check('Sugerencias se calculan sin escrituras SQL', !/\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE)\b/i.test(suggestionService));
check('Rotacion se calcula sin escrituras SQL', !/\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE)\b/i.test(rotationService));
check('Las ventas anuladas y devoluciones aplicadas se excluyen de la demanda neta',
  service.includes("v.estadoOperacion<>'anulada'") && service.includes("oc.estado='aplicada'")
  && service.includes('COALESCE(r.unidadesDevueltas,0)'));
check('Las rutas mantienen cache no-store y funcionalidades separadas',
  (routes.match(/Cache-Control', 'no-store/g) || []).length >= 6
  && routes.includes("requirePlanFeature('compras_sugeridas')")
  && routes.includes("requirePlanFeature('rotacion_inventario')")
  && routes.includes("requirePlanFeature('alertas_stock')"));
check('La exportacion neutraliza formulas con espacios y controles iniciales',
  exporter.includes('\\u200B') && exporter.includes('neutralizeFormula'));
check('La interfaz no expone claves idempotentes ni secretos',
  !/claveOperacion|huellaSolicitud|sqlMessage|SESSION_SECRET/i.test(intelligenceUi));

const failures = checks.filter((item) => !item.value);
for (const item of checks) console.log(`${item.value ? 'OK' : 'FALLO'}: ${item.name}`);
if (failures.length) {
  console.error(`\n${failures.length} comprobacion(es) de interfaz de inteligencia fallaron.`);
  process.exitCode = 1;
} else {
  console.log(`\n${checks.length} comprobaciones de interfaz de inteligencia completadas.`);
}
