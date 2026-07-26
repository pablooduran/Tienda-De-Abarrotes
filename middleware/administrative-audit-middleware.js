const {
  administrativeAuditService,
  administratorActor
} = require('../services/administrative-audit-service');

const MUTATIONS = Object.freeze([
  ['POST', /^\/clientes\/?$/, 'creacion_cliente', 'cliente', null, { after: { activo: true } }],
  ['PATCH|PUT', /^\/clientes\/(\d+)\/?$/, 'modificacion_cliente', 'cliente'],
  ['DELETE', /^\/clientes\/(\d+)\/?$/, 'ocultamiento_cliente', 'cliente', 1, {
    before: { activo: true }, after: { activo: false }
  }],
  ['PATCH', /^\/clientes\/(\d+)\/restaurar\/?$/, 'restauracion_cliente', 'cliente', 1, {
    before: { activo: false }, after: { activo: true }
  }],
  ['PUT', /^\/configuracion-credito\/?$/, 'configuracion_credito', 'configuracion_credito'],
  ['POST', /^\/productos\/?$/, 'creacion_producto', 'producto', null, { after: { activo: true } }],
  ['PUT', /^\/productos\/(\d+)\/?$/, 'modificacion_producto', 'producto', 1],
  ['DELETE', /^\/productos\/(\d+)\/?$/, 'ocultamiento_producto', 'producto', 1, {
    before: { activo: true }, after: { activo: false }
  }],
  ['PATCH', /^\/productos\/(\d+)\/restaurar\/?$/, 'restauracion_producto', 'producto', 1, {
    before: { activo: false }, after: { activo: true }
  }],
  ['POST', /^\/productos\/(\d+)\/ajustar-stock\/?$/, 'ajuste_stock', 'producto', 1],
  ['PATCH', /^\/productos\/(\d+)\/configuracion-lotes\/?$/, 'configuracion_lotes', 'producto', 1],
  ['POST', /^\/lotes\/distribucion-inicial\/?$/, 'distribucion_lotes', 'producto'],
  ['POST', /^\/compras\/?$/, 'registro_compra', 'compra'],
  ['POST', /^\/(?:pos\/)?ventas\/?$/, 'registro_venta', 'venta'],
  ['DELETE', /^\/fiados\/(\d+)\/?$/, 'ocultamiento_fiado', 'fiado', 1, {
    before: { activo: true }, after: { activo: false }
  }],
  ['PATCH', /^\/fiados\/(\d+)\/restaurar\/?$/, 'restauracion_fiado', 'fiado', 1, {
    before: { activo: false }, after: { activo: true }
  }],
  ['POST', /^\/(?:fiados\/(\d+)\/pagos|pagos-fiado(?:\/cliente)?)\/?$/, 'registro_pago_fiado', 'cobro_fiado', 1],
  ['PATCH', /^\/fiados\/(\d+)\/fecha-prometida\/?$/, 'actualizacion_promesa_pago', 'fiado', 1],
  ['POST', /^\/cobranza\/seguimientos\/?$/, 'registro_seguimiento_cobranza', 'seguimiento_cobranza'],
  ['POST', /^\/gastos\/?$/, 'creacion_gasto', 'gasto', null, { after: { estado: 'registrado' } }],
  ['PUT', /^\/gastos\/(\d+)\/?$/, 'modificacion_gasto', 'gasto', 1],
  ['POST', /^\/gastos\/(\d+)\/anular\/?$/, 'anulacion_gasto', 'gasto', 1, {
    before: { estado: 'registrado' }, after: { estado: 'anulado' }
  }],
  ['POST', /^\/caja\/cierres\/?$/, 'cierre_caja', 'cierre_caja', null, { after: { estado: 'cerrado' } }],
  ['POST', /^\/caja\/cierres\/(\d+)\/anular\/?$/, 'anulacion_cierre_caja', 'cierre_caja', 1, {
    before: { estado: 'cerrado' }, after: { estado: 'anulado' }
  }],
  ['POST', /^\/ventas\/(\d+)\/compensaciones\/?$/, 'compensacion_venta', 'venta', 1],
  ['POST', /^\/liquidaciones-compensacion\/(\d+)\/resolver\/?$/, 'resolucion_liquidacion', 'liquidacion_compensacion', 1],
  ['POST', /^\/cobros-fiado\/(\d+)\/compensaciones\/?$/, 'compensacion_cobro', 'cobro_fiado', 1],
  ['POST', /^\/pagos-venta\/(\d+)\/compensaciones\/metodo\/?$/, 'correccion_metodo_pago', 'pago_venta', 1],
  ['POST', /^\/obligaciones-reembolso\/(\d+)\/liquidaciones\/?$/, 'liquidacion_reembolso', 'liquidacion_reembolso', 1]
]);

const EXPORTS = Object.freeze([
  /^\/exportaciones\/([a-z0-9_-]+)\.xlsx\/?$/,
  /^\/(?:clientes|fiados|lotes)\/exportacion\.xlsx\/?$/,
  /^\/clientes\/\d+\/estado-cuenta\/exportacion\.xlsx\/?$/,
  /^\/inventario-inteligente\/exportacion\.xlsx\/?$/,
  /^\/compensaciones\/exportaciones\/([a-z0-9_-]+)\.(csv|xlsx)\/?$/
]);

function matchMethod(pattern, method) {
  return pattern.split('|').includes(method);
}

function descriptorFor(req) {
  const method = String(req.method || '').toUpperCase();
  const pathname = String(req.path || '').split('?')[0];
  if (method === 'GET') {
    for (const pattern of EXPORTS) {
      const match = pathname.match(pattern);
      if (match) {
        const format = pathname.endsWith('.csv') ? 'csv' : 'xlsx';
        return {
          action: 'exportacion_datos',
          entity: 'exportacion',
          reference: null,
          metadata: {
            formato: format,
            tipoExportacion: String(match[1] || pathname.split('/').filter(Boolean)[0] || 'datos')
              .replace(/-/g, '_')
              .slice(0, 64)
          }
        };
      }
    }
    return null;
  }
  for (const [methods, pattern, action, entity, idGroup = null, payload = {}] of MUTATIONS) {
    if (!matchMethod(methods, method)) continue;
    const match = pathname.match(pattern);
    if (!match) continue;
    const rawId = idGroup ? match[idGroup] : null;
    return {
      action,
      entity,
      reference: rawId ? `${entity}:${rawId}` : null,
      ...payload
    };
  }
  return null;
}

function resultForStatus(status, exportEvent) {
  if (status >= 200 && status < 400) {
    return { result: 'correcto', resultCode: exportEvent ? 'EXPORT_COMPLETED' : 'COMMERCIAL_OPERATION_OK' };
  }
  if (status === 429) {
    return { result: 'limitado', resultCode: exportEvent ? 'EXPORT_LIMITED' : 'COMMERCIAL_OPERATION_LIMITED' };
  }
  if (status >= 400 && status < 500) {
    return { result: 'rechazado', resultCode: exportEvent ? 'EXPORT_REJECTED' : 'COMMERCIAL_OPERATION_REJECTED' };
  }
  return { result: 'fallido', resultCode: exportEvent ? 'EXPORT_FAILED' : 'COMMERCIAL_OPERATION_FAILED' };
}

function createCommercialAuditMiddleware({ auditService = administrativeAuditService } = {}) {
  return (req, res, next) => {
    const descriptor = descriptorFor(req);
    if (!descriptor) return next();
    let responseBody = null;
    const originalJson = res.json.bind(res);
    res.json = (body) => {
      responseBody = body && typeof body === 'object' && !Array.isArray(body) ? body : null;
      return originalJson(body);
    };
    res.once('finish', () => {
      if (responseBody?.repetida === true || responseBody?.repetido === true) return;
      const actor = administratorActor(req.auth || req.session?.admin);
      const status = resultForStatus(res.statusCode, descriptor.action === 'exportacion_datos');
      const responseIdentifiers = {
        cliente: 'idCliente',
        producto: 'idProducto',
        compra: 'idCompra',
        venta: 'idVenta',
        gasto: 'idGasto',
        cierre_caja: 'idCierreCaja',
        seguimiento_cobranza: 'idSeguimientoCobranza',
        cobro_fiado: 'idCobroFiado',
        operacion_compensatoria: 'idOperacionCompensatoria',
        liquidacion_compensacion: 'idLiquidacionCompensacionVenta',
        pago_venta: 'idCompensacionPagoVenta',
        liquidacion_reembolso: 'idMovimientoLiquidacionCompensacion'
      };
      const responseId = responseBody?.[responseIdentifiers[descriptor.entity]];
      const reference = descriptor.reference
        || (Number.isSafeInteger(Number(responseId)) && Number(responseId) > 0
          ? `${descriptor.entity}:${Number(responseId)}`
          : null);
      void auditService.recordOutcome({
        ...actor,
        action: descriptor.action,
        ...status,
        origin: 'web',
        reference,
        requestId: req.requestId,
        before: descriptor.before,
        after: descriptor.after,
        metadata: descriptor.metadata
      });
    });
    return next();
  };
}

module.exports = {
  createCommercialAuditMiddleware,
  descriptorFor,
  resultForStatus
};
