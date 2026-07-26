const { stockError } = require('./stock-movement-service');

function positiveId(value) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw stockError(400, 'El comprobante solicitado no es valido.',
      'INVALID_COMPENSATION_REFERENCE');
  }
  return id;
}

function publicNumber(prefix, value) {
  return `${prefix}-${String(value).padStart(8, '0')}`;
}

async function saleCompensationReceipt(connection, idTienda, sourceId) {
  const id = positiveId(sourceId);
  const [headers] = await connection.query(
    `SELECT cv.idCompensacionVenta, cv.tipoCompensacion, cv.montoCompensado,
            cv.costoCompensado, cv.creadoEn, v.codigoComprobante,
            v.estadoOperacion, oc.motivoCodigo, oc.observacion,
            a.usuario responsable, t.nombre tienda,
            COALESCE(c.nombre,'Cliente ocasional') cliente,
            lcv.estado estadoLiquidacion,
            lcv.montoReduccionDeudaPendiente, lcv.montoReembolsoPendiente,
            ore.idObligacionReembolsoVenta, ore.estado estadoReembolso,
            ore.monto montoReembolso
     FROM compensacionVenta cv
     JOIN venta v ON v.idTienda=cv.idTienda AND v.idVenta=cv.idVenta
     LEFT JOIN cliente c ON c.idTienda=v.idTienda AND c.idCliente=v.idCliente
     JOIN operacionCompensatoria oc
       ON oc.idTienda=cv.idTienda
      AND oc.idOperacionCompensatoria=cv.idOperacionCompensatoria
     JOIN administrador a
       ON a.idTienda=oc.idTienda
      AND a.idAdministrador=oc.idAdministradorSolicitante
     JOIN tienda t ON t.idTienda=cv.idTienda
     LEFT JOIN liquidacionCompensacionVenta lcv
       ON lcv.idTienda=cv.idTienda AND lcv.idCompensacionVenta=cv.idCompensacionVenta
     LEFT JOIN resolucionLiquidacionVenta rlv
       ON rlv.idTienda=lcv.idTienda
      AND rlv.idLiquidacionCompensacionVenta=lcv.idLiquidacionCompensacionVenta
     LEFT JOIN obligacionReembolsoVenta ore
       ON ore.idTienda=rlv.idTienda
      AND ore.idResolucionLiquidacionVenta=rlv.idResolucionLiquidacionVenta
     WHERE cv.idTienda=? AND cv.idCompensacionVenta=?`,
    [idTienda, id]
  );
  if (!headers.length) {
    throw stockError(404, 'Comprobante de compensacion no encontrado.',
      'COMPENSATION_RECEIPT_NOT_FOUND');
  }
  const header = headers[0];
  const [details] = await connection.query(
    `SELECT p.nombre producto, dcv.unidadesDevueltas,
            dcv.montoCompensado, dcv.costoCompensado,
            dcv.tratamientoInventario, dcv.resultadoInventario
     FROM detalleCompensacionVenta dcv
     JOIN producto p ON p.idTienda=dcv.idTienda AND p.idProducto=dcv.idProducto
     WHERE dcv.idTienda=? AND dcv.idCompensacionVenta=?
     ORDER BY dcv.idDetalleCompensacionVenta`,
    [idTienda, id]
  );
  return {
    comprobante: {
      numero: publicNumber('COMP-VTA', header.idCompensacionVenta),
      tipo: header.tipoCompensacion,
      operacionOriginal: header.codigoComprobante || 'Venta sin comprobante historico',
      fecha: header.creadoEn,
      monto: header.montoCompensado,
      costoRevertido: header.costoCompensado,
      motivo: header.motivoCodigo,
      observacion: header.observacion,
      estadoVenta: header.estadoOperacion,
      tratamientoFinanciero: {
        estado: header.estadoLiquidacion,
        reduccionDeuda: header.montoReduccionDeudaPendiente,
        reembolsoPendiente: header.montoReembolsoPendiente,
        estadoReembolso: header.estadoReembolso || null,
        montoReembolso: header.montoReembolso || null
      }
    },
    tienda: { nombre: header.tienda },
    cliente: { nombre: header.cliente },
    responsable: header.responsable,
    detalles: details
  };
}

async function materialSettlementReceipt(connection, idTienda, sourceId) {
  const id = positiveId(sourceId);
  const [rows] = await connection.query(
    `SELECT mlc.idMovimientoLiquidacionCompensacion,
            mlc.tipoLiquidacion, mlc.metodoLiquidacion, mlc.monto,
            mlc.referencia, mlc.observacion, mlc.fechaMovimiento,
            mlc.periodoOriginalCerrado, v.codigoComprobante,
            ore.estado estadoObligacion, ore.monto montoObligacion,
            oc.motivoCodigo, a.usuario responsable, t.nombre tienda,
            COALESCE(c.nombre,'Cliente ocasional') cliente
     FROM movimientoLiquidacionCompensacion mlc
     JOIN obligacionReembolsoVenta ore
       ON ore.idTienda=mlc.idTienda
      AND ore.idObligacionReembolsoVenta=mlc.idObligacionReembolsoVenta
     JOIN venta v ON v.idTienda=ore.idTienda AND v.idVenta=ore.idVenta
     LEFT JOIN cliente c ON c.idTienda=v.idTienda AND c.idCliente=v.idCliente
     JOIN operacionCompensatoria oc
       ON oc.idTienda=mlc.idTienda
      AND oc.idOperacionCompensatoria=mlc.idOperacionCompensatoria
     JOIN administrador a
       ON a.idTienda=mlc.idTienda AND a.idAdministrador=mlc.idAdministrador
     JOIN tienda t ON t.idTienda=mlc.idTienda
     WHERE mlc.idTienda=? AND mlc.idMovimientoLiquidacionCompensacion=?`,
    [idTienda, id]
  );
  if (!rows.length) {
    throw stockError(404, 'Comprobante de liquidacion no encontrado.',
      'COMPENSATION_RECEIPT_NOT_FOUND');
  }
  const row = rows[0];
  return {
    comprobante: {
      numero: publicNumber('LIQ-COMP', row.idMovimientoLiquidacionCompensacion),
      tipo: row.tipoLiquidacion,
      operacionOriginal: row.codigoComprobante || 'Venta sin comprobante historico',
      fecha: row.fechaMovimiento,
      monto: row.monto,
      metodo: row.metodoLiquidacion,
      referencia: row.referencia,
      observacion: row.observacion,
      motivo: row.motivoCodigo,
      periodoOriginalCerrado: Boolean(row.periodoOriginalCerrado),
      estadoObligacion: row.estadoObligacion,
      montoObligacion: row.montoObligacion
    },
    tienda: { nombre: row.tienda },
    cliente: { nombre: row.cliente },
    responsable: row.responsable
  };
}

async function collectionCompensationReceipt(connection, idTienda, sourceId) {
  const id = positiveId(sourceId);
  const [rows] = await connection.query(
    `SELECT ccf.idCompensacionCobroFiado, ccf.tipoCompensacion,
            ccf.montoCompensado, ccf.metodoOriginal, ccf.metodoDestino,
            ccf.referenciaDestino, ccf.creadoEn, ccf.periodoOriginalCerrado,
            cf.idCobroFiado, oc.motivoCodigo, oc.observacion,
            a.usuario responsable, t.nombre tienda,c.nombre cliente
     FROM compensacionCobroFiado ccf
     JOIN cobroFiado cf
       ON cf.idTienda=ccf.idTienda AND cf.idCobroFiado=ccf.idCobroFiado
     JOIN cliente c ON c.idTienda=cf.idTienda AND c.idCliente=cf.idCliente
     JOIN operacionCompensatoria oc
       ON oc.idTienda=ccf.idTienda
      AND oc.idOperacionCompensatoria=ccf.idOperacionCompensatoria
     JOIN administrador a
       ON a.idTienda=oc.idTienda
      AND a.idAdministrador=oc.idAdministradorSolicitante
     JOIN tienda t ON t.idTienda=ccf.idTienda
     WHERE ccf.idTienda=? AND ccf.idCompensacionCobroFiado=?`,
    [idTienda, id]
  );
  if (!rows.length) {
    throw stockError(404, 'Comprobante de compensacion no encontrado.',
      'COMPENSATION_RECEIPT_NOT_FOUND');
  }
  const row = rows[0];
  return {
    comprobante: {
      numero: publicNumber('COMP-COB', row.idCompensacionCobroFiado),
      tipo: row.tipoCompensacion,
      operacionOriginal: publicNumber('COB', row.idCobroFiado),
      fecha: row.creadoEn,
      monto: row.montoCompensado,
      metodoOriginal: row.metodoOriginal,
      metodoDestino: row.metodoDestino,
      referencia: row.referenciaDestino,
      motivo: row.motivoCodigo,
      observacion: row.observacion,
      periodoOriginalCerrado: Boolean(row.periodoOriginalCerrado)
    },
    tienda: { nombre: row.tienda },
    cliente: { nombre: row.cliente },
    responsable: row.responsable
  };
}

async function paymentCorrectionReceipt(connection, idTienda, sourceId) {
  const id = positiveId(sourceId);
  const [rows] = await connection.query(
    `SELECT cpv.idCompensacionPagoVenta, cpv.monto, cpv.metodoOriginal,
            cpv.metodoDestino, cpv.referenciaDestino, cpv.creadoEn,
            cpv.periodoOriginalCerrado, v.codigoComprobante,
            oc.motivoCodigo, oc.observacion, a.usuario responsable,
            t.nombre tienda,COALESCE(c.nombre,'Cliente ocasional') cliente
     FROM compensacionPagoVenta cpv
     JOIN venta v ON v.idTienda=cpv.idTienda AND v.idVenta=cpv.idVenta
     LEFT JOIN cliente c ON c.idTienda=v.idTienda AND c.idCliente=v.idCliente
     JOIN operacionCompensatoria oc
       ON oc.idTienda=cpv.idTienda
      AND oc.idOperacionCompensatoria=cpv.idOperacionCompensatoria
     JOIN administrador a
       ON a.idTienda=oc.idTienda
      AND a.idAdministrador=oc.idAdministradorSolicitante
     JOIN tienda t ON t.idTienda=cpv.idTienda
     WHERE cpv.idTienda=? AND cpv.idCompensacionPagoVenta=?`,
    [idTienda, id]
  );
  if (!rows.length) {
    throw stockError(404, 'Comprobante de correccion no encontrado.',
      'COMPENSATION_RECEIPT_NOT_FOUND');
  }
  const row = rows[0];
  return {
    comprobante: {
      numero: publicNumber('CORR-PAGO', row.idCompensacionPagoVenta),
      tipo: 'correccion_metodo_pago',
      operacionOriginal: row.codigoComprobante || 'Venta sin comprobante historico',
      fecha: row.creadoEn,
      monto: row.monto,
      metodoOriginal: row.metodoOriginal,
      metodoDestino: row.metodoDestino,
      referencia: row.referenciaDestino,
      motivo: row.motivoCodigo,
      observacion: row.observacion,
      periodoOriginalCerrado: Boolean(row.periodoOriginalCerrado)
    },
    tienda: { nombre: row.tienda },
    cliente: { nombre: row.cliente },
    responsable: row.responsable
  };
}

module.exports = {
  collectionCompensationReceipt,
  materialSettlementReceipt,
  paymentCorrectionReceipt,
  saleCompensationReceipt
};
