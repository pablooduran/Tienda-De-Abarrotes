const { centsToDecimal, creditError, moneyToCents } = require('./customer-credit-service');

function positiveId(value) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw creditError(400, 'El cobro no es valido.', 'COBRO_INVALIDO');
  return id;
}

async function getCollectionReceipt(connection, idTienda, idCobroFiado) {
  const id = positiveId(idCobroFiado);
  const [headers] = await connection.query(
    `SELECT cf.idCobroFiado,cf.idCliente,cf.fechaCobro,cf.montoTotal,cf.metodoPago,
            cf.montoRecibido,cf.cambio,cf.referencia,cf.observacion,cf.esLegado,
            c.nombre cliente,c.telefono,c.documentoIdentidad,c.activo clienteActivo,
            t.nombre tienda,a.usuario administrador
     FROM cobroFiado cf
     JOIN cliente c ON c.idTienda=cf.idTienda AND c.idCliente=cf.idCliente
     JOIN tienda t ON t.idTienda=cf.idTienda
     LEFT JOIN administrador a ON a.idTienda=cf.idTienda AND a.idAdministrador=cf.idAdministrador
     WHERE cf.idTienda=? AND cf.idCobroFiado=?`,
    [idTienda, id]
  );
  if (!headers.length) throw creditError(404, 'Cobro no encontrado.', 'COBRO_NO_ENCONTRADO');
  const header = headers[0];
  const [applications] = await connection.query(
    `SELECT pf.idPagoFiado,pf.idFiado,pf.fechaPago,pf.monto,pf.observacion,
            f.totalFiado,f.fechaInicio,f.fechaVencimiento,f.fechaPrometidaPago,f.idVenta,
            v.codigoComprobante,
            COALESCE((
              SELECT SUM(prev.monto)
              FROM pagoFiado prev
              JOIN cobroFiado prevc ON prevc.idTienda=prev.idTienda AND prevc.idCobroFiado=prev.idCobroFiado
              WHERE prev.idTienda=pf.idTienda AND prev.idFiado=pf.idFiado
                AND (prevc.fechaCobro<cf.fechaCobro
                  OR (prevc.fechaCobro=cf.fechaCobro AND prevc.idCobroFiado<cf.idCobroFiado)
                  OR (prevc.fechaCobro=cf.fechaCobro AND prevc.idCobroFiado=cf.idCobroFiado
                    AND prev.idPagoFiado<pf.idPagoFiado))
            ),0) pagadoAntes
     FROM pagoFiado pf
     JOIN cobroFiado cf ON cf.idTienda=pf.idTienda AND cf.idCobroFiado=pf.idCobroFiado
     JOIN fiado f ON f.idTienda=pf.idTienda AND f.idFiado=pf.idFiado
     LEFT JOIN venta v ON v.idTienda=f.idTienda AND v.idVenta=f.idVenta
     WHERE pf.idTienda=? AND pf.idCobroFiado=?
     ORDER BY pf.idPagoFiado`,
    [idTienda, id]
  );
  if (!applications.length) {
    throw creditError(409, 'El cobro no tiene distribuciones asociadas.', 'COBRO_SIN_DISTRIBUCION');
  }
  const distributions = applications.map((row) => {
    const totalCents = moneyToCents(row.totalFiado, 'El total del fiado');
    const paidBeforeCents = moneyToCents(row.pagadoAntes, 'Los pagos anteriores');
    const amountCents = moneyToCents(row.monto, 'El monto distribuido');
    const beforeCents = totalCents - paidBeforeCents;
    const afterCents = beforeCents - amountCents;
    if (beforeCents < amountCents || afterCents < 0) {
      throw creditError(409, 'La historia del cobro no puede reconciliarse.', 'COBRO_HISTORIAL_INCONSISTENTE');
    }
    return {
      idPagoFiado: row.idPagoFiado,
      idFiado: row.idFiado,
      idVenta: row.idVenta,
      comprobanteVenta: row.codigoComprobante,
      fechaPago: row.fechaPago,
      fechaInicio: row.fechaInicio,
      fechaVencimiento: row.fechaVencimiento,
      fechaPrometidaPago: row.fechaPrometidaPago,
      monto: centsToDecimal(amountCents),
      saldoAnterior: centsToDecimal(beforeCents),
      saldoPosterior: centsToDecimal(afterCents),
      observacion: row.observacion
    };
  });
  const distributedCents = distributions.reduce((sum, row) => sum + moneyToCents(row.monto, 'La distribucion'), 0);
  const headerCents = moneyToCents(header.montoTotal, 'El total del cobro');
  if (distributedCents !== headerCents) {
    throw creditError(409, 'La distribucion no coincide con el total del cobro.', 'COBRO_DISTRIBUCION_INCONSISTENTE');
  }
  const beforeCents = distributions.reduce((sum, row) => sum + moneyToCents(row.saldoAnterior, 'El saldo anterior'), 0);
  const afterCents = distributions.reduce((sum, row) => sum + moneyToCents(row.saldoPosterior, 'El saldo posterior'), 0);
  return {
    comprobante: {
      numero: `COB-${String(header.idCobroFiado).padStart(8, '0')}`,
      idCobroFiado: header.idCobroFiado,
      fechaCobro: header.fechaCobro,
      montoTotal: header.montoTotal,
      metodoPago: header.metodoPago,
      montoRecibido: header.montoRecibido,
      cambio: header.cambio,
      referencia: header.referencia,
      observacion: header.observacion,
      esLegado: Boolean(header.esLegado),
      saldoAnterior: centsToDecimal(beforeCents),
      saldoPosterior: centsToDecimal(afterCents)
    },
    tienda: { nombre: header.tienda },
    cliente: {
      idCliente: header.idCliente,
      nombre: header.cliente,
      telefono: header.telefono,
      documentoIdentidad: header.documentoIdentidad,
      activo: Boolean(header.clienteActivo)
    },
    administrador: header.administrador || null,
    distribuciones: distributions,
    limitacionHistorica: 'El nombre de la tienda, del cliente y del responsable reflejan el registro actual; los importes, fechas y distribuciones provienen del cobro inmutable.'
  };
}

module.exports = { getCollectionReceipt };
