const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const appHtml = read('public/app.html');
const appJs = read('public/js/app.js');
const creditJs = read('public/js/customer-credit-ui.js');
const creditRoutes = read('routes/customers-credit.js');
const apiRoutes = read('routes/api.js');
const creditService = read('services/customer-credit-service.js');
const posRoutes = read('routes/pos.js');
const posService = read('services/pos-sale-service.js');
const css = read('public/css/styles.css');

const checks = [];
function check(name, condition, detail = '') {
  checks.push({ name, ok: Boolean(condition), detail });
}
function includesAll(source, values) { return values.every((value) => source.includes(value)); }

check('Modulo cargado antes de app.js',
  appHtml.indexOf('/js/customer-credit-ui.js') >= 0
  && appHtml.indexOf('/js/customer-credit-ui.js') < appHtml.indexOf('/js/app.js'));
check('Navegacion Clientes', appJs.includes("['clientes', 'Clientes'"));
check('Navegacion Cobranza', appJs.includes("['pagos', 'Cobranza'"));
check('Permisos basico y avanzado', includesAll(appJs + creditJs, [
  'clientes_basico', 'fiados_basico', 'pagos_fiado', 'recordatorios_fiado',
  'seguimiento_cobranza', 'limites_credito'
]));
check('Formulario ampliado de cliente', includesAll(creditJs, [
  'telefonoAlternativo', 'documentoIdentidad', 'correo', 'direccion', 'limiteCredito',
  'diasCreditoDefault', 'canalPreferido', 'aceptaRecordatorios', 'horarioPreferido', 'notas'
]));
check('Filtro explicito de estado de clientes', includesAll(creditJs + creditRoutes, [
  "customerFilters: { estado: 'activos' }", "option('activos', 'Activos'", "option('ocultos', 'Ocultos'",
  "option('todos', 'Todos'", "new Set(['activos', 'ocultos', 'todos'])", "INVALID_CUSTOMER_STATE"
]));
check('Cambio de estado reinicia la paginacion', creditJs.includes('ui.customerPage = 1;')
  && creditJs.includes('await renderCustomers();'));
check('Acciones ocultar y restaurar en UI nueva', includesAll(creditJs, [
  'data-customer-hide', 'data-customer-restore', 'data-profile-restore', 'Ocultar cliente', 'Restaurar cliente'
]));
check('Cliente oculto tiene badge y fecha', creditJs.includes("statusBadge(customer.activo ? 'activo' : 'oculto')")
  && creditJs.includes('customer.eliminadoEn') && css.includes('.status-oculto'));
check('Confirmacion explica preservacion de historial', includesAll(creditJs, [
  'No se eliminara su historial', 'no se modificaran ventas, fiados o pagos', 'seguira visible y podra cobrarse'
]));
check('Ocultar y restaurar evitan doble envio', creditJs.includes("setBusy(button, true, restore ? 'Restaurando...' : 'Ocultando...')")
  && creditJs.includes('button?.disabled'));
check('Ruta nueva es canonica y la heredada no duplica SQL',
  creditRoutes.includes("router.delete('/clientes/:id'")
  && creditRoutes.includes("router.patch('/clientes/:id/restaurar'")
  && !apiRoutes.includes("router.get('/clientes/ocultos'")
  && !apiRoutes.includes("router.patch('/clientes/:id/restaurar'"));
check('Servicio central preserva el historial', creditService.includes('async function setCustomerVisibility')
  && creditService.includes('SET activo=?, eliminadoEn=?, actualizadoEn=?, idAdministradorActualiza=?')
  && !/DELETE\s+FROM\s+cliente/i.test(creditRoutes + creditService));
check('POS excluye y valida clientes ocultos', posRoutes.includes('FROM cliente WHERE idTienda=? AND activo=1')
  && posService.includes("lockCustomer(connection, idTienda, idCliente, { requireActive: true })"));
check('Cobranza identifica clientes ocultos sin perder pagos', creditRoutes.includes('c.activo clienteActivo')
  && creditJs.includes('row.clienteActivo') && creditJs.includes('data-debt-pay'));
check('Codigo visual heredado de clientes ocultos retirado',
  !appJs.includes('showHiddenClients') && !appJs.includes('data-restore-client'));
check('No envia idTienda', !/idTienda\s*:/.test(creditJs));
check('Pagos especifico y acumulado', includesAll(creditJs, [
  '/api/fiados/${debt.idFiado}/pagos', '/api/pagos-fiado/cliente'
]));
check('Clave de operacion estable por formulario',
  creditJs.includes('const operationKey = `cobro-ui:${newOperationKey()}`')
  && creditJs.includes('name="claveOperacion"'));
check('Prevencion de doble envio', includesAll(creditJs, ['setBusy(button, true)', 'button.disabled = true']));
check('Calculo visual de cambio', creditJs.includes('Math.max(0, tendered - applied)'));
check('Fecha prometida', creditJs.includes('/fecha-prometida'));
check('Seguimiento inmutable sin editar o borrar',
  creditJs.includes('/api/cobranza/seguimientos')
  && !creditJs.includes("method: 'DELETE'"));
check('WhatsApp se prepara en backend', creditJs.includes('/api/cobranza/mensaje-whatsapp/preparar'));
check('Abrir WhatsApp no marca envio',
  creditJs.includes('Abrir WhatsApp no registra el mensaje como enviado.')
  && creditJs.includes('data-mark-manual'));
check('Estado de cuenta imprimible',
  creditJs.includes('/estado-cuenta') && creditJs.includes('window.print()') && css.includes('@media print'));
check('Integracion POS de credito', includesAll(appJs + creditJs, [
  'posCreditSummary', 'posCreditPayload', 'confirmarDeudaVencida', 'motivoDeudaVencida'
]));
check('Cliente ocasional sin fiado', creditJs.includes('El cliente ocasional solo puede pagar al contado.'));
check('Politica advertir exige confirmacion y motivo',
  creditJs.includes('debes confirmar la decision e indicar un motivo'));
check('Modo solo lectura bloquea cobros y conserva consulta',
  creditJs.includes("if (readOnly()) return showError('La suscripcion esta inactiva")
  && !creditJs.includes('allowReadOnlyWrite: true')
  && !creditJs.includes('data-readonly-operational'));
check('Seguimiento depende de capacidad devuelta por backend',
  creditJs.includes('data.permisos?.seguimientoCobranza')
  && creditRoutes.includes('permisos: { seguimientoCobranza: canReadFollowups }')
  && creditJs.includes("can('seguimiento_cobranza') && !readOnly() ? `<button type=\"button\" class=\"small secondary\" data-debt-promise"));
check('Permisos explicitos por endpoint', includesAll(creditRoutes + apiRoutes, [
  "requirePlanFeature('clientes_basico')",
  "requirePlanFeature('fiados_basico')",
  "requirePlanFeature('pagos_fiado')",
  "requirePlanFeature('estado_cuenta_basico')",
  "requirePlanFeature('seguimiento_cobranza')",
  "requirePlanFeature('recordatorios_fiado')"
]));
check('Totales de cobranza vienen del backend',
  creditJs.includes('const summary = data.resumen || {}')
  && creditJs.includes('Deuda total filtrada')
  && !creditJs.includes('rows.reduce((sum, row) => sum + Number(row.saldoPendiente'));
check('Filtros globales no se aplican sobre la pagina',
  creditJs.includes("Object.entries(ui.collectionFilters)")
  && !creditJs.includes('rows = rows.filter'));
check('Busqueda reinicia pagina y usa debounce',
  creditJs.includes('ui.collectionSearchTimer = setTimeout')
  && creditJs.includes('ui.collectionPage = 1;'));
check('Respuestas obsoletas de cobranza se ignoran',
  creditJs.includes('const request = ++ui.collectionRequest')
  && (creditJs.match(/request !== ui\.collectionRequest/g) || []).length >= 2);
check('Ficha declara historial reciente y truncamiento',
  creditJs.includes('historyNotice(data.historial?.compras)')
  && creditJs.includes('historyNotice(data.historial?.pagos)')
  && creditJs.includes('data.historial.fiados'));
check('Estado de cuenta informa pagina y total',
  creditJs.includes('Mostrando ${data.movimientos.length} de ${Number(page.total')
  && creditJs.includes('data-statement-page'));
check('Estados de carga, vacio y error', includesAll(creditJs, ['loading-state', 'empty-state', 'error-state']));
check('Contenido dinamico usa escape central', creditJs.includes('escapeHtml: e'));
check('Sin listeners globales duplicados en modulo',
  (creditJs.match(/document\.addEventListener/g) || []).length === 0);
check('Responsive 360/768/1366 por reglas fluidas',
  css.includes('@media (max-width: 560px)')
  && css.includes('@media (max-width: 900px)')
  && css.includes('.customer-mobile-list'));
check('Sin XLSX o PDF en frontend de credito', !/xlsx|\.pdf|application\/pdf/i.test(creditJs));
check('Sin almacenamiento sensible', !/localStorage|sessionStorage/.test(creditJs));
check('Sin fechas UTC serializadas', !creditJs.includes('toISOString('));
check('Sin URL wa.me construida en frontend de cobranza', !creditJs.includes('https://wa.me/'));
check('Un solo handler activo de pagos', (appJs.match(/async function pagos\(\)/g) || []).length === 1);

const failed = checks.filter((item) => !item.ok);
checks.forEach((item) => console.log(`${item.ok ? 'OK' : 'FALLO'}: ${item.name}${item.detail ? ` - ${item.detail}` : ''}`));
if (failed.length) {
  console.error(`\n${failed.length} validacion(es) frontend fallaron.`);
  process.exitCode = 1;
} else {
  console.log(`\n${checks.length} validaciones frontend completadas.`);
}
