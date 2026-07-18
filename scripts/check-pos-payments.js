const mysql = require('mysql2/promise');
const { databaseTarget, requireLocalhostDatabase } = require('../config/env');
const {
  hasCheckConstraint,
  hasColumns,
  hasForeignKeyConstraint,
  hasIndex,
  hasTable
} = require('./db-utils');

const expectedColumns = {
  producto: ['codigoBarras', 'precioVentaPaquete', 'favoritoPos'],
  venta: ['subtotal', 'descuento', 'montoPagado', 'saldoPendiente', 'estadoPago', 'codigoComprobante'],
  pagoVenta: ['idPagoVenta', 'idTienda', 'idVenta', 'idPagoFiado', 'metodoPago', 'monto', 'montoRecibido', 'cambio', 'referencia', 'claveOperacion', 'idAdministrador', 'creadoEn']
};

const expectedIndexes = [
  ['pagoFiado', 'uq_pagoFiado_tienda_id', ['idTienda', 'idPagoFiado'], true],
  ['fiado', 'uq_fiado_tienda_venta_unica', ['idTienda', 'idVenta'], true],
  ['producto', 'uq_producto_tienda_codigoBarras', ['idTienda', 'codigoBarras'], true],
  ['producto', 'idx_producto_tienda_favorito_nombre', ['idTienda', 'favoritoPos', 'activo', 'nombre'], false],
  ['venta', 'uq_venta_tienda_comprobante', ['idTienda', 'codigoComprobante'], true],
  ['venta', 'idx_venta_tienda_estado_fecha', ['idTienda', 'estadoPago', 'fecha'], false],
  ['pagoVenta', 'uq_pagoVenta_tienda_clave', ['idTienda', 'claveOperacion'], true],
  ['pagoVenta', 'uq_pagoVenta_tienda_pagoFiado', ['idTienda', 'idPagoFiado'], true],
  ['pagoVenta', 'idx_pagoVenta_tienda_venta', ['idTienda', 'idVenta', 'creadoEn'], false],
  ['pagoVenta', 'idx_pagoVenta_tienda_metodo_fecha', ['idTienda', 'metodoPago', 'creadoEn'], false],
  ['pagoVenta', 'idx_pagoVenta_tienda_admin_fecha', ['idTienda', 'idAdministrador', 'creadoEn'], false]
];

const expectedChecks = [
  ['pagoVenta', 'chk_pagoVenta_monto'],
  ['pagoVenta', 'chk_pagoVenta_metodo'],
  ['pagoVenta', 'chk_pagoVenta_efectivo'],
  ['venta', 'chk_venta_totales_pos'],
  ['venta', 'chk_venta_saldo_pos'],
  ['venta', 'chk_venta_estado_pos']
];

const expectedForeignKeys = [
  ['pagoVenta', 'fk_pagoVenta_tienda', ['idTienda'], 'tienda', ['idTienda'], 'RESTRICT', 'RESTRICT'],
  ['pagoVenta', 'fk_pagoVenta_venta', ['idTienda', 'idVenta'], 'venta', ['idTienda', 'idVenta'], 'RESTRICT', 'RESTRICT'],
  ['pagoVenta', 'fk_pagoVenta_pagoFiado', ['idTienda', 'idPagoFiado'], 'pagoFiado', ['idTienda', 'idPagoFiado'], 'RESTRICT', 'RESTRICT'],
  ['pagoVenta', 'fk_pagoVenta_administrador', ['idTienda', 'idAdministrador'], 'administrador', ['idTienda', 'idAdministrador'], 'RESTRICT', 'RESTRICT']
];

async function scalar(connection, sql, params = []) {
  const [[row]] = await connection.query(sql, params);
  return Number(row.total || 0);
}

async function main() {
  const config = { ...requireLocalhostDatabase('La comprobacion de pagos POS'), decimalNumbers: true };
  const connection = await mysql.createConnection(config);
  try {
    const migrationTable = await hasTable(connection, 'schema_migrations');
    const migrationRecorded = migrationTable
      ? await scalar(connection, "SELECT COUNT(*) total FROM schema_migrations WHERE nombre='008_punto_venta_pagos.sql'") === 1
      : false;
    const paymentTable = await hasTable(connection, 'pagoVenta');
    const columnState = {};
    let anyNewColumn = false;
    for (const [table, columns] of Object.entries(expectedColumns)) {
      const tableExists = await hasTable(connection, table);
      columnState[table] = tableExists && await hasColumns(connection, table, columns);
      if (tableExists) {
        for (const column of columns) {
          if (await hasColumns(connection, table, [column])) anyNewColumn = true;
        }
      }
    }
    const newColumnsPresent = anyNewColumn || paymentTable;
    if (!paymentTable || !Object.values(columnState).every(Boolean)) {
      console.log(JSON.stringify({
        destino: databaseTarget(config),
        estado: newColumnsPresent ? 'estructura-parcial' : 'pre-migracion',
        migracion008Registrada: migrationRecorded,
        tablaPagoVenta: paymentTable,
        columnas: columnState
      }, null, 2));
      return;
    }

    const indexState = {};
    for (const [table, name, columns, unique] of expectedIndexes) {
      indexState[`${table}.${name}`] = await hasIndex(connection, table, name, columns, unique);
    }
    const checkState = {};
    for (const [table, name] of expectedChecks) {
      checkState[`${table}.${name}`] = await hasCheckConstraint(connection, table, name);
    }
    const foreignKeyState = {};
    for (const relation of expectedForeignKeys) {
      foreignKeyState[`${relation[0]}.${relation[1]}`] = await hasForeignKeyConstraint(connection, ...relation);
    }

    const invalidSales = await scalar(connection,
      `SELECT COUNT(*) total FROM venta
       WHERE subtotal<0 OR descuento<0 OR total<0 OR montoPagado<0 OR saldoPendiente<0
          OR descuento>subtotal OR ABS((subtotal-descuento)-total)>=0.01
          OR codigoComprobante IS NULL OR codigoComprobante=''`);
    const invalidPayments = await scalar(connection,
      `SELECT COUNT(*) total FROM pagoVenta
       WHERE monto<=0 OR metodoPago NOT IN ('efectivo','qr','no_especificado')
          OR (metodoPago='efectivo' AND (montoRecibido IS NULL OR montoRecibido<monto OR cambio<0 OR ABS((montoRecibido-monto)-cambio)>=0.01))
          OR (metodoPago<>'efectivo' AND (montoRecibido IS NOT NULL OR cambio<>0))`);
    const crossStorePayments = await scalar(connection,
      `SELECT COUNT(*) total FROM pagoVenta pv
       LEFT JOIN venta v ON v.idTienda=pv.idTienda AND v.idVenta=pv.idVenta
       WHERE v.idVenta IS NULL`);
    const orphanDebtPayments = await scalar(connection,
      `SELECT COUNT(*) total FROM pagoVenta pv
       LEFT JOIN pagoFiado pf ON pf.idTienda=pv.idTienda AND pf.idPagoFiado=pv.idPagoFiado
       WHERE pv.idPagoFiado IS NOT NULL AND pf.idPagoFiado IS NULL`);
    const paymentsAboveTotal = await scalar(connection,
      `SELECT COUNT(*) total FROM (
         SELECT v.idTienda, v.idVenta, v.total, COALESCE(SUM(pv.monto),0) pagos
         FROM venta v LEFT JOIN pagoVenta pv ON pv.idTienda=v.idTienda AND pv.idVenta=v.idVenta
         GROUP BY v.idTienda, v.idVenta, v.total HAVING pagos-v.total>=0.01
       ) excesos`);
    const paymentSumDifferences = await scalar(connection,
      `SELECT COUNT(*) total FROM (
         SELECT v.idTienda, v.idVenta, v.montoPagado, COALESCE(SUM(pv.monto),0) pagos
         FROM venta v LEFT JOIN pagoVenta pv ON pv.idTienda=v.idTienda AND pv.idVenta=v.idVenta
         WHERE v.estadoPago<>'legado'
         GROUP BY v.idTienda, v.idVenta, v.montoPagado HAVING ABS(pagos-v.montoPagado)>=0.01
       ) diferencias`);
    const incorrectBalances = await scalar(connection,
      `SELECT COUNT(*) total FROM venta
       WHERE estadoPago<>'legado' AND ABS((montoPagado+saldoPendiente)-total)>=0.01`);
    const incorrectStates = await scalar(connection,
      `SELECT COUNT(*) total FROM venta
       WHERE (estadoPago='pagada' AND (saldoPendiente<>0 OR montoPagado<>total))
          OR (estadoPago='parcial' AND (montoPagado<=0 OR saldoPendiente<=0))
          OR (estadoPago='pendiente' AND (montoPagado<>0 OR saldoPendiente<>total OR saldoPendiente<=0))
          OR (estadoPago IN ('pendiente','parcial') AND tipo<>'fiada')`);
    const debtsWithoutClient = await scalar(connection,
      "SELECT COUNT(*) total FROM venta WHERE estadoPago IN ('pendiente','parcial') AND idCliente IS NULL");
    const duplicateDebts = await scalar(connection,
      `SELECT COUNT(*) total FROM (
         SELECT idTienda, idVenta FROM fiado WHERE idVenta IS NOT NULL
         GROUP BY idTienda, idVenta HAVING COUNT(*)>1
       ) duplicados`);
    const salesWithoutDebt = await scalar(connection,
      `SELECT COUNT(*) total FROM venta v
       LEFT JOIN fiado f ON f.idTienda=v.idTienda AND f.idVenta=v.idVenta
       WHERE v.estadoPago IN ('pendiente','parcial') AND f.idFiado IS NULL`);
    const debtBalanceDifferences = await scalar(connection,
      `SELECT COUNT(*) total FROM venta v
       JOIN fiado f ON f.idTienda=v.idTienda AND f.idVenta=v.idVenta
       WHERE v.estadoPago<>'legado' AND ABS(v.saldoPendiente-f.saldoPendiente)>=0.01`);
    const pendingSalesWithPayments = await scalar(connection,
      `SELECT COUNT(*) total FROM venta v
       WHERE v.estadoPago='pendiente' AND EXISTS (
         SELECT 1 FROM pagoVenta pv WHERE pv.idTienda=v.idTienda AND pv.idVenta=v.idVenta
        )`);
    const debtPaymentsLinkedToAnotherSale = await scalar(connection,
      `SELECT COUNT(*) total FROM pagoVenta pv
       JOIN pagoFiado pf ON pf.idTienda=pv.idTienda AND pf.idPagoFiado=pv.idPagoFiado
       JOIN fiado f ON f.idTienda=pf.idTienda AND f.idFiado=pf.idFiado
       WHERE pv.idPagoFiado IS NOT NULL AND (f.idVenta IS NULL OR f.idVenta<>pv.idVenta)`);
    const invalidPaymentResponsibles = await scalar(connection,
      `SELECT COUNT(*) total FROM pagoVenta pv
       LEFT JOIN administrador a ON a.idTienda=pv.idTienda AND a.idAdministrador=pv.idAdministrador
       WHERE pv.idAdministrador IS NOT NULL AND a.idAdministrador IS NULL`);
    const duplicateOperationKeys = await scalar(connection,
      `SELECT COUNT(*) total FROM (
         SELECT idTienda, claveOperacion FROM venta WHERE claveOperacion IS NOT NULL
         GROUP BY idTienda, claveOperacion HAVING COUNT(*)>1
       ) duplicados`);
    const duplicateBarcodes = await scalar(connection,
      `SELECT COUNT(*) total FROM (
         SELECT idTienda, codigoBarras FROM producto
         WHERE codigoBarras IS NOT NULL AND codigoBarras<>''
         GROUP BY idTienda, codigoBarras HAVING COUNT(*)>1
       ) duplicados`);
    const negativeStock = await scalar(connection,
      'SELECT COUNT(*) total FROM producto WHERE stockUnidadesTotal<0 OR stock<0');
    const duplicateSaleMovements = await scalar(connection,
      `SELECT COUNT(*) total FROM (
         SELECT idTienda, idDetalleVenta FROM movimientoStock
         WHERE origen='venta' AND idDetalleVenta IS NOT NULL
         GROUP BY idTienda, idDetalleVenta HAVING COUNT(*)>1
       ) duplicados`);
    const featureAccess = await scalar(connection,
      `SELECT COUNT(DISTINCT CONCAT(p.codigo, ':', f.codigo)) total
       FROM planFuncionalidad pf
       JOIN plan p ON p.idPlan=pf.idPlan
       JOIN funcionalidad f ON f.idFuncionalidad=pf.idFuncionalidad
       WHERE p.codigo IN ('basico','avanzado')
         AND f.codigo IN ('punto_venta','pagos_multiples','recibos_whatsapp')
         AND p.activo=1 AND f.activo=1 AND pf.habilitada=1`);
    const [byMethod] = await connection.query(
      'SELECT metodoPago, COUNT(*) total, COALESCE(SUM(monto),0) monto FROM pagoVenta GROUP BY metodoPago ORDER BY metodoPago'
    );
    const [byState] = await connection.query(
      'SELECT estadoPago, COUNT(*) total, COALESCE(SUM(total),0) monto FROM venta GROUP BY estadoPago ORDER BY estadoPago'
    );

    const structureComplete = Object.values(columnState).every(Boolean)
      && Object.values(indexState).every(Boolean)
      && Object.values(checkState).every(Boolean)
      && Object.values(foreignKeyState).every(Boolean);
    const inconsistencies = invalidSales + invalidPayments + crossStorePayments + orphanDebtPayments
      + paymentsAboveTotal + paymentSumDifferences + incorrectBalances + incorrectStates
      + debtsWithoutClient + duplicateDebts + salesWithoutDebt + debtBalanceDifferences + pendingSalesWithPayments
      + debtPaymentsLinkedToAnotherSale + invalidPaymentResponsibles + duplicateOperationKeys
      + duplicateBarcodes + negativeStock + duplicateSaleMovements;

    console.log(JSON.stringify({
      destino: databaseTarget(config),
      estado: migrationRecorded && structureComplete && inconsistencies === 0 && featureAccess === 6
        ? 'post-migracion'
        : 'estructura-incompleta-o-inconsistente',
      migracion008Registrada: migrationRecorded,
      tablaPagoVenta: paymentTable,
      columnas: columnState,
      indices: indexState,
      checks: checkState,
      clavesForaneas: foreignKeyState,
      accesosPlanFuncion: featureAccess,
      ventasConTotalesInvalidos: invalidSales,
      pagosInvalidos: invalidPayments,
      pagosDeOtraTiendaOSinVenta: crossStorePayments,
      pagosFiadoHuerfanos: orphanDebtPayments,
      ventasConPagosSuperioresAlTotal: paymentsAboveTotal,
      diferenciasSumaPagos: paymentSumDifferences,
      saldosIncorrectos: incorrectBalances,
      estadosPagoIncoherentes: incorrectStates,
      ventasConSaldoSinCliente: debtsWithoutClient,
      ventasConFiadoDuplicado: duplicateDebts,
      ventasConSaldoSinFiado: salesWithoutDebt,
      diferenciasSaldoVentaFiado: debtBalanceDifferences,
      ventasPendientesConPagos: pendingSalesWithPayments,
      pagosFiadoLigadosAOtraVenta: debtPaymentsLinkedToAnotherSale,
      responsablesPagoInvalidos: invalidPaymentResponsibles,
      clavesOperacionDuplicadas: duplicateOperationKeys,
      codigosBarrasDuplicados: duplicateBarcodes,
      productosConStockNegativo: negativeStock,
      movimientosVentaDuplicados: duplicateSaleMovements,
      conteosPorMetodo: byMethod,
      conteosPorEstado: byState
    }, null, 2));
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error('No se pudo comprobar la estructura de pagos POS.');
  console.error(error.message);
  process.exit(1);
});
