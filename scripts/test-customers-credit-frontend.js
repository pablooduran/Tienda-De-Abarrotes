const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const appHtml = read('public/app.html');
const appJs = read('public/js/app.js');
const creditJs = read('public/js/customer-credit-ui.js');
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
check('Modo solo lectura conserva cobro',
  appJs.includes('allowReadOnlyWrite') && creditJs.includes('data-readonly-operational'));
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
