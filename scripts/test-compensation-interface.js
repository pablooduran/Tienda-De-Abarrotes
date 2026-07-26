const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const {
  buildCompensationExport,
  buildCsv
} = require('../services/compensation-export-service');
const {
  buildOperationFilter,
  listCompensations
} = require('../services/compensation-query-service');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function operationFixture() {
  return {
    idOperacionCompensatoria: 7,
    tipoOperacion: 'devolucion_venta',
    estado: 'aplicada',
    motivoCodigo: 'devolucion_cliente',
    observacion: '=SUM(1,1)',
    fechaSolicitud: '2026-07-26 10:00:00',
    fechaAplicacion: '2026-07-26 10:00:01',
    administrador: '+CMD',
    idVenta: 11,
    codigoVenta: '@HYPERLINK',
    cliente: '\t-1+1',
    idCompensacionVenta: 3,
    tipoCompensacionVenta: 'devolucion_parcial',
    montoCompensado: '15.50',
    costoCompensado: '8.00',
    tipoComprobante: 'venta',
    idComprobante: 3
  };
}

function fakeConnection() {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      if (/SELECT COUNT\(\*\) total,\s+COALESCE/s.test(sql)) {
        return [[{
          total: 1,
          compensacionComercial: '15.50',
          liquidacionesMateriales: '0.00',
          aplicadas: 1,
          pendientes: 0
        }]];
      }
      if (/SELECT COUNT\(\*\) total/.test(sql)) return [[{ total: 1 }]];
      if (/SELECT oc\.idOperacionCompensatoria/.test(sql)) return [[operationFixture()]];
      throw new Error(`Consulta de prueba no reconocida: ${sql.slice(0, 80)}`);
    }
  };
}

async function rejects(callback, code) {
  try {
    await callback();
  } catch (error) {
    assert(error.code === code, `Codigo ${error.code}, esperado ${code}`);
    return;
  }
  throw new Error(`Se esperaba ${code}.`);
}

async function main() {
  const connection = fakeConnection();
  const result = await listCompensations(connection, 41, {
    tipo: 'devolucion_venta',
    estado: 'aplicada',
    fechaDesde: '2026-07-01',
    fechaHasta: '2026-07-31',
    usuario: 'owner',
    cliente: 'cliente',
    venta: '11',
    page: '1',
    pageSize: '25'
  });
  assert(result.paginacion.total === 1 && result.resultados.length === 1,
    'Listado paginado inconsistente.');
  assert(connection.calls.every((call) => !/\b(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE)\b/i.test(call.sql)),
    'Las consultas C4B deben ser estrictamente de lectura.');
  assert(connection.calls.every((call) => Number(call.params[0]) === 41),
    'Todas las consultas deben comenzar con el tenant.');
  assert(connection.calls.some((call) => call.sql.includes('oc.idTienda=?')),
    'Falta aislamiento de operacionCompensatoria.');
  console.log('OK: listado, filtros, paginacion y aislamiento tenant.');

  await rejects(
    () => listCompensations(fakeConnection(), 41, { tipo: 'sql_libre' }),
    'INVALID_COMPENSATION_FILTER'
  );
  await rejects(
    () => listCompensations(fakeConnection(), 41, {
      fechaDesde: '2026-08-01', fechaHasta: '2026-07-01'
    }),
    'INVALID_COMPENSATION_FILTER'
  );
  await rejects(
    () => listCompensations(fakeConnection(), 41, { pageSize: 101 }),
    'INVALID_COMPENSATION_PAGINATION'
  );
  assert(buildOperationFilter(41, { cliente: 'x' }).where.includes('COALESCE(c.nombre'),
    'El filtro de cliente debe aplicarse en SQL.');
  console.log('OK: valores invalidos y orden SQL libre rechazados.');

  const csv = buildCsv([{
    Normal: 'Texto normal',
    Formula1: '=SUM(1,1)',
    Formula2: '+CMD',
    Formula3: '-1+1',
    Formula4: '@HYPERLINK',
    Oculta: '\t=2+2',
    Numero: 12.5
  }]).toString('utf8');
  for (const formula of ["'=SUM(1,1)", "'+CMD", "'-1+1", "'@HYPERLINK", "'\t=2+2"]) {
    assert(csv.includes(formula), `No se neutralizo ${JSON.stringify(formula)}.`);
  }
  assert(csv.includes('Texto normal') && csv.includes('12.5'),
    'Texto normal o numero se alteraron.');
  console.log('OK: inyeccion CSV neutralizada, numeros y texto preservados.');

  const csvConnection = fakeConnection();
  const csvExport = await buildCompensationExport(
    csvConnection, 41, 'historial', 'csv', { fechaDesde: '2026-07-01', fechaHasta: '2026-07-31' }
  );
  assert(csvExport.contentType.startsWith('text/csv')
    && csvExport.fileName.endsWith('.csv'), 'Contrato CSV incorrecto.');
  const xlsxExport = await buildCompensationExport(
    fakeConnection(), 41, 'historial', 'xlsx', {}
  );
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(xlsxExport.buffer);
  const sheet = workbook.worksheets[0];
  const headers = sheet.getRow(1).values;
  const observationColumn = headers.indexOf('Observacion');
  const amountColumn = headers.indexOf('CompensacionComercial');
  const dateColumn = headers.indexOf('Fecha');
  assert(String(sheet.getRow(2).getCell(observationColumn).value).startsWith("'="),
    'XLSX no neutralizo la formula.');
  assert(typeof sheet.getRow(2).getCell(amountColumn).value === 'number',
    'XLSX no preservo el importe como numero.');
  assert(sheet.getRow(2).getCell(dateColumn).value instanceof Date,
    'XLSX no preservo la fecha como fecha real.');
  assert(sheet.views[0]?.state === 'frozen' && sheet.autoFilter,
    'XLSX no congela encabezado o no tiene autofiltro.');
  console.log('OK: contratos CSV/XLSX, tipos reales, encabezado y autofiltro.');

  const routeSource = fs.readFileSync(
    path.join(__dirname, '..', 'routes', 'financial-compensations.js'), 'utf8'
  );
  const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert(routeSource.includes("requirePlanFeature(COMPENSATION_FEATURE)")
    && routeSource.includes("requirePlanFeature('exportacion_reportes')")
    && routeSource.includes('requireExportSubscription'),
  'Faltan permisos backend en exportaciones.');
  assert(serverSource.includes("app.use('/api/compensaciones/exportaciones', rateLimiters.export)"),
    'Falta rate limiting dedicado de exportaciones.');
  assert(/app\.use\(\s*['"]\/api['"],\s*requireAuth,\s*requireTenant,\s*resolveSubscription,\s*requireActiveSubscription,[\s\S]*financialCompensationRoutes/.test(serverSource),
  'La ruta no esta detras de autenticacion, tenant y suscripcion.');
  console.log('OK: permisos, suscripcion, CSRF global y rate limiting conservados.');

  console.log('\nPruebas de interfaz backend C4B completadas sin conexiones a base.');
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
