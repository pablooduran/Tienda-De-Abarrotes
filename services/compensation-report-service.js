async function salesCompensationMetrics(connection, idTienda, range) {
  const [rows] = await connection.query(
    `SELECT
       COALESCE(SUM(dcv.montoCompensado),0) montoCompensado,
       COALESCE(SUM(dcv.costoCompensado),0) costoCompensado,
       COALESCE(SUM(CASE WHEN dv.origenCosto='real'
                         THEN dcv.costoCompensado ELSE 0 END),0) costoRealCompensado,
       COALESCE(SUM(CASE WHEN dv.origenCosto='estimado'
                         THEN dcv.costoCompensado ELSE 0 END),0) costoEstimadoCompensado,
       COALESCE(SUM(CASE WHEN dv.origenCosto='desconocido'
                         THEN dcv.montoCompensado ELSE 0 END),0) ventasSinCostoCompensadas,
       SUM(CASE WHEN dv.origenCosto='desconocido' THEN 1 ELSE 0 END)
         detallesCostoDesconocidoCompensados,
       COALESCE(SUM(CASE WHEN dv.origenCosto='real'
                         THEN dcv.montoCompensado-dcv.costoCompensado ELSE 0 END),0)
         gananciaRealCompensada,
       COALESCE(SUM(CASE WHEN dv.origenCosto='estimado'
                         THEN dcv.montoCompensado-dcv.costoCompensado ELSE 0 END),0)
         gananciaEstimadaCompensada,
       COALESCE(SUM(CASE WHEN dv.origenCosto<>'desconocido'
                         THEN dcv.montoCompensado-dcv.costoCompensado ELSE 0 END),0)
         gananciaCalculableCompensada,
       COUNT(DISTINCT cv.idCompensacionVenta) cantidadCompensaciones
     FROM compensacionVenta cv
     JOIN detalleCompensacionVenta dcv
       ON dcv.idTienda=cv.idTienda
      AND dcv.idCompensacionVenta=cv.idCompensacionVenta
     JOIN detalleVenta dv
       ON dv.idTienda=dcv.idTienda AND dv.idDetalleVenta=dcv.idDetalleVenta
     WHERE cv.idTienda=? AND cv.creadoEn>=? AND cv.creadoEn<?`,
    [idTienda, range.inicio, range.finExclusivo]
  );
  return rows[0];
}

async function materialSettlementMetrics(connection, idTienda, range) {
  const [rows] = await connection.query(
    `SELECT
       COALESCE(SUM(CASE WHEN tipoLiquidacion='reembolso_realizado'
                         THEN monto ELSE 0 END),0) reembolsosRealizados,
       COALESCE(SUM(CASE WHEN tipoLiquidacion='compensacion_otro_medio'
                         THEN monto ELSE 0 END),0) liquidacionesOtroMedio,
       COUNT(*) cantidadLiquidaciones
     FROM movimientoLiquidacionCompensacion
     WHERE idTienda=? AND fechaMovimiento>=? AND fechaMovimiento<?`,
    [idTienda, range.inicio, range.finExclusivo]
  );
  return rows[0];
}

async function debtCompensationMetrics(connection, idTienda, range) {
  const [rows] = await connection.query(
    `SELECT COALESCE(SUM(montoReduccionDeuda),0) deudaCompensada,
            COUNT(*) cantidadResoluciones
     FROM resolucionLiquidacionVenta
     WHERE idTienda=? AND creadoEn>=? AND creadoEn<?`,
    [idTienda, range.inicio, range.finExclusivo]
  );
  return rows[0];
}

async function paymentFlowsByMethod(connection, idTienda, range) {
  const params = [idTienda, range.inicio, range.finExclusivo];
  const [rows] = await connection.query(
    `WITH eventos AS (
       SELECT
         CASE WHEN pv.idPagoFiado IS NULL
              THEN pv.metodoPago ELSE COALESCE(cf.metodoPago,pv.metodoPago) END metodo,
         CASE WHEN pv.idPagoFiado IS NULL THEN 'venta' ELSE 'fiado' END ambito,
         'bruto' clase, pv.monto importe, 1 cantidad
       FROM pagoVenta pv
       LEFT JOIN pagoFiado pf
         ON pf.idTienda=pv.idTienda AND pf.idPagoFiado=pv.idPagoFiado
       LEFT JOIN cobroFiado cf
         ON cf.idTienda=pf.idTienda AND cf.idCobroFiado=pf.idCobroFiado
       WHERE pv.idTienda=? AND pv.creadoEn>=? AND pv.creadoEn<?

       UNION ALL

       SELECT ccf.metodoOriginal, 'fiado', 'ajuste',
              -ccf.montoCompensado, 0
       FROM compensacionCobroFiado ccf
       WHERE ccf.idTienda=? AND ccf.creadoEn>=? AND ccf.creadoEn<?

       UNION ALL

       SELECT ccf.metodoDestino, 'fiado', 'ajuste',
              ccf.montoCompensado, 0
       FROM compensacionCobroFiado ccf
       WHERE ccf.idTienda=? AND ccf.creadoEn>=? AND ccf.creadoEn<?
         AND ccf.tipoCompensacion='correccion_metodo'

       UNION ALL

       SELECT cpv.metodoOriginal, 'venta', 'ajuste', -cpv.monto, 0
       FROM compensacionPagoVenta cpv
       WHERE cpv.idTienda=? AND cpv.creadoEn>=? AND cpv.creadoEn<?

       UNION ALL

       SELECT cpv.metodoDestino, 'venta', 'ajuste', cpv.monto, 0
       FROM compensacionPagoVenta cpv
       WHERE cpv.idTienda=? AND cpv.creadoEn>=? AND cpv.creadoEn<?

       UNION ALL

       SELECT mlc.metodoLiquidacion, 'reembolso', 'reembolso',
              -mlc.monto, 0
       FROM movimientoLiquidacionCompensacion mlc
       WHERE mlc.idTienda=? AND mlc.fechaMovimiento>=? AND mlc.fechaMovimiento<?
         AND mlc.tipoLiquidacion='reembolso_realizado'
     )
     SELECT metodo,
       COALESCE(SUM(CASE WHEN clase='bruto' THEN importe ELSE 0 END),0) bruto,
       COALESCE(SUM(CASE WHEN clase='ajuste' THEN importe ELSE 0 END),0)
         ajustesCompensatorios,
       COALESCE(-SUM(CASE WHEN clase='ajuste' AND importe<0
                          THEN importe ELSE 0 END),0) salidasCompensatorias,
       COALESCE(SUM(CASE WHEN clase='ajuste' AND importe>0
                         THEN importe ELSE 0 END),0) entradasCompensatorias,
       COALESCE(-SUM(CASE WHEN clase='reembolso' THEN importe ELSE 0 END),0)
         reembolsos,
       COALESCE(SUM(importe),0) neto,
       COALESCE(SUM(CASE WHEN ambito='venta' THEN importe ELSE 0 END),0)
         pagosInicialesNetos,
       COALESCE(SUM(CASE WHEN ambito='fiado' THEN importe ELSE 0 END),0)
         cobrosFiadoNetos,
       COALESCE(SUM(CASE WHEN ambito='venta' AND clase='bruto'
                         THEN importe ELSE 0 END),0) pagosInicialesBrutos,
       COALESCE(SUM(CASE WHEN ambito='fiado' AND clase='bruto'
                         THEN importe ELSE 0 END),0) cobrosFiadoBrutos,
       COALESCE(SUM(CASE WHEN ambito='venta' AND clase='ajuste' AND importe>0
                         THEN importe ELSE 0 END),0) entradasVenta,
       COALESCE(-SUM(CASE WHEN ambito='venta' AND clase='ajuste' AND importe<0
                          THEN importe ELSE 0 END),0) salidasVenta,
       COALESCE(SUM(CASE WHEN ambito='fiado' AND clase='ajuste' AND importe>0
                         THEN importe ELSE 0 END),0) entradasFiado,
       COALESCE(-SUM(CASE WHEN ambito='fiado' AND clase='ajuste' AND importe<0
                          THEN importe ELSE 0 END),0) salidasFiado,
       COALESCE(-SUM(CASE WHEN ambito='reembolso' THEN importe ELSE 0 END),0)
         reembolsosAplicados,
       SUM(cantidad) cantidad
     FROM eventos
     WHERE metodo IS NOT NULL
     GROUP BY metodo
     ORDER BY neto DESC, metodo`,
    [...params, ...params, ...params, ...params, ...params, ...params]
  );
  return rows;
}

async function salesCompensationsByDay(connection, idTienda, range) {
  const [rows] = await connection.query(
    `SELECT DATE_FORMAT(cv.creadoEn,'%Y-%m-%d') fecha,
            COUNT(DISTINCT cv.idCompensacionVenta) cantidadCompensaciones,
            COALESCE(SUM(dcv.montoCompensado),0) montoCompensado,
            COALESCE(SUM(dcv.costoCompensado),0) costoCompensado,
            COALESCE(SUM(CASE WHEN dv.origenCosto<>'desconocido'
                         THEN dcv.montoCompensado-dcv.costoCompensado ELSE 0 END),0)
              gananciaCalculableCompensada
     FROM compensacionVenta cv
     JOIN detalleCompensacionVenta dcv
       ON dcv.idTienda=cv.idTienda
      AND dcv.idCompensacionVenta=cv.idCompensacionVenta
     JOIN detalleVenta dv
       ON dv.idTienda=dcv.idTienda AND dv.idDetalleVenta=dcv.idDetalleVenta
     WHERE cv.idTienda=? AND cv.creadoEn>=? AND cv.creadoEn<?
     GROUP BY DATE_FORMAT(cv.creadoEn,'%Y-%m-%d')
     ORDER BY fecha`,
    [idTienda, range.inicio, range.finExclusivo]
  );
  return rows;
}

module.exports = {
  debtCompensationMetrics,
  materialSettlementMetrics,
  paymentFlowsByMethod,
  salesCompensationMetrics,
  salesCompensationsByDay
};
