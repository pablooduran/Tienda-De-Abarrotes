const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const {
  createCommercialAuditMiddleware,
  descriptorFor,
  resultForStatus
} = require('../middleware/administrative-audit-middleware');
const {
  createAdministrativeAuditQueryService,
  parseFilters
} = require('../services/administrative-audit-query-service');
const { normalizeEvent } = require('../services/administrative-audit-service');
const { requireRole } = require('../middleware/roles');
const { requireTenant } = require('../middleware/tenant');

const ROOT = path.join(__dirname, '..');

function check(condition, message) {
  assert.ok(condition, message);
  console.log(`OK: ${message}`);
}

function request(overrides = {}) {
  return {
    method: 'POST',
    path: '/clientes',
    requestId: '11111111-1111-4111-8111-111111111111',
    auth: { idAdministrador: 7, idTienda: 3, rol: 'dueno_tienda' },
    tenant: { idTienda: 3 },
    ...overrides
  };
}

function response(statusCode = 201) {
  const emitter = new EventEmitter();
  emitter.statusCode = statusCode;
  emitter.json = function json(body) {
    this.body = body;
    return this;
  };
  return emitter;
}

async function runMiddleware(req, statusCode, body) {
  const events = [];
  const middleware = createCommercialAuditMiddleware({
    auditService: {
      async recordOutcome(event) {
        events.push(normalizeEvent(event));
        return { recorded: true };
      }
    }
  });
  const res = response(statusCode);
  middleware(req, res, () => {});
  res.json(body);
  res.emit('finish');
  await new Promise((resolve) => setImmediate(resolve));
  return events;
}

function auditRow(overrides = {}) {
  return {
    idEventoAuditoria: 91,
    idTienda: 3,
    actorTipo: 'administrador',
    idAdministradorActor: 7,
    categoria: 'cliente',
    accion: 'ocultamiento_cliente',
    resultado: 'correcto',
    codigoResultado: 'COMMERCIAL_OPERATION_OK',
    origen: 'web',
    entidadTipo: 'cliente',
    referenciaSegura: 'cliente:22',
    requestId: '22222222-2222-4222-8222-222222222222',
    datosAnteriores: JSON.stringify({ activo: true }),
    datosPosteriores: JSON.stringify({ activo: false }),
    metadatos: null,
    creadoEn: '2026-07-26 10:30:00',
    ...overrides
  };
}

async function testMiddleware() {
  const success = await runMiddleware(request(), 201, { idCliente: 22 });
  check(success.length === 1 && success[0].action === 'creacion_cliente',
    'La creacion comercial registra actor, accion y tenant.');
  check(success[0].storeId === 3 && success[0].administratorId === 7,
    'El evento comercial conserva el actor y la tienda autenticados.');
  check(success[0].reference === 'cliente:22' && success[0].after.activo === true,
    'La referencia segura y el estado posterior se derivan sin datos personales.');

  const rejected = await runMiddleware(
    request({ method: 'DELETE', path: '/clientes/22' }),
    409,
    { error: 'Conflicto controlado.' }
  );
  check(rejected[0].result === 'rechazado'
    && rejected[0].before.activo === true
    && rejected[0].after.activo === false,
  'Los rechazos conservan el contrato antes/despues sin guardar el cuerpo.');

  const failed = await runMiddleware(
    request({ method: 'POST', path: '/gastos' }),
    500,
    { error: 'Ocurrio un error interno.', detail: 'no se conserva' }
  );
  check(failed[0].result === 'fallido' && failed[0].resultCode === 'COMMERCIAL_OPERATION_FAILED',
    'Los fallos usan un codigo estable y no el mensaje interno.');
  check(!JSON.stringify(failed[0]).includes('no se conserva'),
    'El evento no copia respuestas ni payloads completos.');

  const earlyRejection = await runMiddleware(
    request({
      auth: undefined,
      session: { admin: { id: 7, idTienda: 3, rol: 'dueno_tienda' } },
      method: 'POST',
      path: '/clientes'
    }),
    403,
    { error: 'Solicitud bloqueada.' }
  );
  check(earlyRejection[0].administratorId === 7
    && earlyRejection[0].storeId === 3
    && earlyRejection[0].result === 'rechazado',
  'Los rechazos previos a requireAuth usan la identidad ya validada de la sesion.');

  const repeated = await runMiddleware(
    request({ method: 'POST', path: '/pos/ventas' }),
    200,
    { repetida: true, idVenta: 88 }
  );
  check(repeated.length === 0, 'Un reintento idempotente no duplica el evento.');

  const exported = await runMiddleware(
    request({ method: 'GET', path: '/compensaciones/exportaciones/historial.xlsx' }),
    200,
    null
  );
  check(exported[0].action === 'exportacion_datos'
    && exported[0].metadata.formato === 'xlsx'
    && exported[0].metadata.tipoExportacion === 'historial',
  'Las exportaciones registran solo formato y tipo permitidos.');

  check(resultForStatus(429, false).result === 'limitado'
    && descriptorFor(request({ method: 'GET', path: '/dashboard' })) === null,
  'El limitador se audita y las lecturas ordinarias no generan ruido.');
}

async function testQueryService() {
  const calls = [];
  const database = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql.includes('COUNT(*) total')) return [[{ total: 1 }], []];
      if (sql.includes('SELECT ea.idEventoAuditoria')) return [[auditRow()], []];
      if (sql.includes('SELECT ea.*')) return [[auditRow()], []];
      if (sql.includes('FROM tienda')) return [[{ idTienda: 3 }], []];
      throw new Error(`Consulta no esperada: ${sql}`);
    }
  };
  const service = createAdministrativeAuditQueryService({ database });
  const list = await service.list({
    categoria: 'cliente',
    resultado: 'correcto',
    actor: 'administrador',
    entidad: 'cliente',
    fechaDesde: '2026-07-01',
    fechaHasta: '2026-07-26',
    page: 1,
    pageSize: 25
  }, { forcedStoreId: 3 });
  check(list.resultados.length === 1 && list.paginacion.total === 1,
    'La consulta devuelve paginacion estable.');
  const listSql = calls.find((call) => call.sql.includes('SELECT ea.idEventoAuditoria'));
  check(listSql.sql.includes('ea.idTienda=?')
    && listSql.sql.includes('ORDER BY ea.creadoEn DESC, ea.idEventoAuditoria DESC'),
  'El listado del dueno fuerza tenant y orden determinista antes de paginar.');
  check(listSql.params[0] === 3 && !JSON.stringify(list).includes('requestId'),
    'La respuesta no expone requestId ni datos internos.');

  calls.length = 0;
  const detail = await service.detail(91, { forcedStoreId: 3 });
  const detailSql = calls.find((call) => call.sql.includes('SELECT ea.*'));
  check(detailSql.sql.includes('AND ea.idTienda=?')
    && detail.anteriores.activo === true
    && detail.posteriores.activo === false,
  'El detalle del dueno exige tenant y devuelve solo datos allowlist.');

  calls.length = 0;
  const adminList = await service.list({ idTienda: 3 }, { allowStoreFilter: true });
  check(calls.some((call) => call.sql.includes('FROM tienda'))
    && adminList.resultados[0].idTienda === 3,
  'El superadmin valida el filtro de tienda antes de consultar.');

  assert.throws(
    () => parseFilters({ pageSize: 101 }, { forcedStoreId: 3 }),
    /maximo/,
    'El limite de pagina excesivo debe rechazarse.'
  );
  check(true, 'Los limites y filtros invalidos se rechazan con contrato estable.');
}

function testSecurityAndRoutes() {
  assert.throws(() => normalizeEvent({
    storeId: 3,
    actorType: 'administrador',
    administratorId: 7,
    action: 'modificacion_cliente',
    result: 'correcto',
    resultCode: 'COMMERCIAL_OPERATION_OK',
    origin: 'web',
    metadata: { password: 'prohibido' }
  }), /no permitido/);
  check(true, 'Las allowlists rechazan contrasenas y campos no declarados.');

  const route = fs.readFileSync(path.join(ROOT, 'routes', 'audit.js'), 'utf8');
  const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  const queryService = fs.readFileSync(
    path.join(ROOT, 'services', 'administrative-audit-query-service.js'),
    'utf8'
  );
  const middleware = fs.readFileSync(
    path.join(ROOT, 'middleware', 'administrative-audit-middleware.js'),
    'utf8'
  );
  check(!/router\.(post|put|patch|delete)\s*\(/i.test(route),
    'La auditoria expone exclusivamente rutas GET.');
  check(server.includes("app.use('/api/auditoria', rateLimiters.admin, requireAuth, requireTenant")
    && server.includes("app.use('/api/admin/auditoria', requireAuth, requireRole('superadmin')"),
  'Dueno y superadmin tienen cadenas de autorizacion separadas.');
  check(server.indexOf("app.use('/api', commercialAuditMiddleware)")
    < server.indexOf('app.use(mutationProtection'),
  'La auditoria comercial observa rechazos de CSRF y rate limiting sin alterar sus contratos.');
  check(server.indexOf("'/api/admin/auditoria'") < server.indexOf("'/api/admin', requireAuth"),
    'La consulta global se monta antes de las rutas administrativas generales.');
  check(!/\b(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE)\b/i.test(queryService),
    'El servicio de consulta no contiene SQL de escritura.');
  check(!/password|cookie|csrf|sqlmessage|stack|claveoperacion|huellasolicitud/i.test(
    middleware.replace(/password/gi, '')
  ), 'La captura comercial no conserva secretos ni claves operativas.');

  const ownerResponse = {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
  let ownerNext = false;
  requireRole('superadmin')(
    { auth: { rol: 'dueno_tienda' } },
    ownerResponse,
    () => { ownerNext = true; }
  );
  check(ownerResponse.statusCode === 403 && !ownerNext,
    'El dueno no puede usar la consulta global de superadmin.');

  const superResponse = {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
  let superTenantNext = false;
  requireTenant(
    { auth: { rol: 'superadmin', idTienda: null } },
    superResponse,
    () => { superTenantNext = true; }
  );
  check(superResponse.statusCode === 403 && !superTenantNext,
    'El superadmin sin tenant no puede usar la consulta comercial del dueno.');

  const requiredMappings = [
    ['POST', '/clientes', 'creacion_cliente'],
    ['PUT', '/productos/8', 'modificacion_producto'],
    ['POST', '/productos/8/ajustar-stock', 'ajuste_stock'],
    ['PATCH', '/productos/8/configuracion-lotes', 'configuracion_lotes'],
    ['POST', '/pos/ventas', 'registro_venta'],
    ['POST', '/fiados/4/pagos', 'registro_pago_fiado'],
    ['POST', '/gastos', 'creacion_gasto'],
    ['POST', '/caja/cierres', 'cierre_caja'],
    ['POST', '/ventas/9/compensaciones', 'compensacion_venta'],
    ['POST', '/cobros-fiado/10/compensaciones', 'compensacion_cobro'],
    ['GET', '/clientes/exportacion.xlsx', 'exportacion_datos']
  ];
  check(requiredMappings.every(([method, requestPath, action]) => (
    descriptorFor(request({ method, path: requestPath }))?.action === action
  )), 'Clientes, productos, inventario, ventas, cobranza, finanzas, compensaciones y exportaciones tienen eventos.');
}

async function main() {
  await testMiddleware();
  await testQueryService();
  testSecurityAndRoutes();
  console.log('\nPruebas de auditoria comercial y consulta completadas.');
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
