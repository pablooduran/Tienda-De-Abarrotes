const mysql = require('mysql2/promise');
const { databaseTarget, requireLocalhostDatabase } = require('../config/env');
const {
  hasCheckConstraint,
  hasColumns,
  hasForeignKeyConstraint,
  hasIndex,
  hasTable
} = require('./db-utils');

const columns = {
  producto: ['activo', 'eliminadoEn'],
  venta: ['claveOperacion'],
  compra: ['claveOperacion'],
  movimientoStock: [
    'idMovimientoStock', 'idTienda', 'idProducto', 'tipoMovimiento', 'origen', 'cantidad',
    'stockAnterior', 'stockPosterior', 'cantidadOperacion', 'unidadOperacion', 'motivo',
    'observacion', 'idDetalleVenta', 'idDetalleCompra', 'referenciaTipo', 'referenciaId',
    'claveOperacion', 'idAdministrador', 'creadoEn'
  ]
};

const indexes = [
  ['administrador', 'uq_administrador_tienda_id', ['idTienda', 'idAdministrador'], true],
  ['producto', 'idx_producto_tienda_activo_nombre', ['idTienda', 'activo', 'nombre'], false],
  ['venta', 'uq_venta_tienda_claveOperacion', ['idTienda', 'claveOperacion'], true],
  ['compra', 'uq_compra_tienda_claveOperacion', ['idTienda', 'claveOperacion'], true],
  ['detalleVenta', 'uq_detalleVenta_tienda_id', ['idTienda', 'idDetalleVenta'], true],
  ['detalleCompra', 'uq_detalleCompra_tienda_id', ['idTienda', 'idDetalleCompra'], true],
  ['movimientoStock', 'uq_movimiento_tienda_clave', ['idTienda', 'claveOperacion'], true],
  ['movimientoStock', 'uq_movimiento_tienda_detalleVenta', ['idTienda', 'idDetalleVenta'], true],
  ['movimientoStock', 'uq_movimiento_tienda_detalleCompra', ['idTienda', 'idDetalleCompra'], true],
  ['movimientoStock', 'idx_movimiento_tienda_fecha', ['idTienda', 'creadoEn', 'idMovimientoStock'], false],
  ['movimientoStock', 'idx_movimiento_tienda_producto_fecha', ['idTienda', 'idProducto', 'creadoEn', 'idMovimientoStock'], false],
  ['movimientoStock', 'idx_movimiento_tienda_tipo_origen', ['idTienda', 'tipoMovimiento', 'origen'], false],
  ['movimientoStock', 'idx_movimiento_tienda_responsable', ['idTienda', 'idAdministrador', 'creadoEn'], false]
];

const checks = [
  'chk_movimiento_cantidad',
  'chk_movimiento_stock_no_negativo',
  'chk_movimiento_balance',
  'chk_movimiento_tipo',
  'chk_movimiento_origen',
  'chk_movimiento_signo',
  'chk_movimiento_cantidad_operacion'
];

const foreignKeys = [
  ['movimientoStock', 'fk_movimiento_tienda', ['idTienda'], 'tienda', ['idTienda'], 'RESTRICT', 'RESTRICT'],
  ['movimientoStock', 'fk_movimiento_producto', ['idTienda', 'idProducto'], 'producto', ['idTienda', 'idProducto'], 'RESTRICT', 'RESTRICT'],
  ['movimientoStock', 'fk_movimiento_administrador', ['idTienda', 'idAdministrador'], 'administrador', ['idTienda', 'idAdministrador'], 'RESTRICT', 'RESTRICT'],
  ['movimientoStock', 'fk_movimiento_detalleVenta', ['idTienda', 'idDetalleVenta'], 'detalleVenta', ['idTienda', 'idDetalleVenta'], 'RESTRICT', 'RESTRICT'],
  ['movimientoStock', 'fk_movimiento_detalleCompra', ['idTienda', 'idDetalleCompra'], 'detalleCompra', ['idTienda', 'idDetalleCompra'], 'RESTRICT', 'RESTRICT']
];

async function scalar(connection, sql, params = []) {
  const [[row]] = await connection.query(sql, params);
  return Number(row.total || 0);
}

async function main() {
  const config = { ...requireLocalhostDatabase('La comprobacion de movimientos de stock'), decimalNumbers: true };
  const connection = await mysql.createConnection(config);
  try {
    const migrationTable = await hasTable(connection, 'schema_migrations');
    const migrationRecorded = migrationTable
      ? await scalar(connection, "SELECT COUNT(*) total FROM schema_migrations WHERE nombre='007_movimientos_stock.sql'") === 1
      : false;
    const movementTable = await hasTable(connection, 'movimientoStock');
    const columnState = {};
    for (const [table, expected] of Object.entries(columns)) {
      columnState[table] = await hasTable(connection, table)
        ? await hasColumns(connection, table, expected)
        : false;
    }
    const noNewColumns = !columnState.producto && !columnState.venta && !columnState.compra;
    if (!movementTable || !Object.values(columnState).every(Boolean)) {
      console.log(JSON.stringify({
        destino: databaseTarget(config),
        estado: !movementTable && noNewColumns ? 'pre-migracion' : 'estructura-parcial',
        migracion007Registrada: migrationRecorded,
        tablaMovimientoStock: movementTable,
        columnas: columnState
      }, null, 2));
      return;
    }

    const indexState = {};
    for (const [table, name, expected, unique] of indexes) {
      indexState[`${table}.${name}`] = await hasIndex(connection, table, name, expected, unique);
    }
    const checkState = {};
    for (const name of checks) {
      checkState[`movimientoStock.${name}`] = await hasCheckConstraint(connection, 'movimientoStock', name);
    }
    const foreignKeyState = {};
    for (const relation of foreignKeys) {
      foreignKeyState[`${relation[0]}.${relation[1]}`] = await hasForeignKeyConstraint(connection, ...relation);
    }

    const invalidStores = await scalar(connection,
      `SELECT COUNT(*) total FROM movimientoStock ms
       LEFT JOIN tienda t ON t.idTienda=ms.idTienda
       WHERE t.idTienda IS NULL`);
    const crossStoreProducts = await scalar(connection,
      `SELECT COUNT(*) total FROM movimientoStock ms
       LEFT JOIN producto p ON p.idProducto=ms.idProducto AND p.idTienda=ms.idTienda
       WHERE p.idProducto IS NULL`);
    const invalidOwners = await scalar(connection,
      `SELECT COUNT(*) total FROM movimientoStock ms
       LEFT JOIN administrador a ON a.idAdministrador=ms.idAdministrador AND a.idTienda=ms.idTienda
       WHERE ms.idAdministrador IS NOT NULL AND a.idAdministrador IS NULL`);
    const inconsistentMovements = await scalar(connection,
      `SELECT COUNT(*) total FROM movimientoStock
       WHERE cantidad=0 OR stockAnterior<0 OR stockPosterior<0
          OR stockPosterior<>stockAnterior+cantidad
          OR tipoMovimiento NOT IN ('entrada','salida','ajuste_positivo','ajuste_negativo','inventario_inicial')
          OR origen NOT IN ('compra','venta','ajuste_manual','alta_producto','migracion_inicial','correccion_sistema','otro')
          OR (tipoMovimiento IN ('entrada','ajuste_positivo','inventario_inicial') AND cantidad<0)
          OR (tipoMovimiento IN ('salida','ajuste_negativo') AND cantidad>0)`);
    const invalidReferences = await scalar(connection,
      `SELECT COUNT(*) total FROM movimientoStock ms
       LEFT JOIN detalleVenta dv ON dv.idDetalleVenta=ms.idDetalleVenta AND dv.idTienda=ms.idTienda
       LEFT JOIN detalleCompra dc ON dc.idDetalleCompra=ms.idDetalleCompra AND dc.idTienda=ms.idTienda
       WHERE (ms.idDetalleVenta IS NOT NULL AND dv.idDetalleVenta IS NULL)
          OR (ms.idDetalleCompra IS NOT NULL AND dc.idDetalleCompra IS NULL)`);
    const doubleCommercialReferences = await scalar(connection,
      `SELECT COUNT(*) total FROM movimientoStock
       WHERE idDetalleVenta IS NOT NULL AND idDetalleCompra IS NOT NULL`);
    const purchasesWithoutPurchaseDetail = await scalar(connection,
      `SELECT COUNT(*) total FROM movimientoStock
       WHERE origen='compra' AND idDetalleCompra IS NULL`);
    const salesWithoutSaleDetail = await scalar(connection,
      `SELECT COUNT(*) total FROM movimientoStock
       WHERE origen='venta' AND idDetalleVenta IS NULL`);
    const commercialReferencesAgainstOrigin = await scalar(connection,
      `SELECT COUNT(*) total FROM movimientoStock
       WHERE (origen='compra' AND idDetalleVenta IS NOT NULL)
          OR (origen='venta' AND idDetalleCompra IS NOT NULL)`);
    const nonCommercialMovementsWithDetails = await scalar(connection,
      `SELECT COUNT(*) total FROM movimientoStock
       WHERE origen NOT IN ('compra','venta')
         AND (idDetalleVenta IS NOT NULL OR idDetalleCompra IS NOT NULL)`);
    const manualMovementsWithCommercialDetails = await scalar(connection,
      `SELECT COUNT(*) total FROM movimientoStock
       WHERE origen='ajuste_manual'
         AND (idDetalleVenta IS NOT NULL OR idDetalleCompra IS NOT NULL)`);
    const duplicateReferences = await scalar(connection,
      `SELECT COUNT(*) total FROM (
         SELECT idTienda, 'venta' clase, idDetalleVenta referencia
         FROM movimientoStock WHERE idDetalleVenta IS NOT NULL
         GROUP BY idTienda, idDetalleVenta HAVING COUNT(*)>1
         UNION ALL
         SELECT idTienda, 'compra' clase, idDetalleCompra referencia
         FROM movimientoStock WHERE idDetalleCompra IS NOT NULL
         GROUP BY idTienda, idDetalleCompra HAVING COUNT(*)>1
       ) duplicados`);
    const negativeProducts = await scalar(connection,
      'SELECT COUNT(*) total FROM producto WHERE stockUnidadesTotal<0 OR stock<0');
    const legacyStockDifferences = await scalar(connection,
      'SELECT COUNT(*) total FROM producto WHERE stock<>stockUnidadesTotal');
    const reconciliationDifferences = await scalar(connection,
      `SELECT COUNT(*) total FROM (
         SELECT p.idTienda, p.idProducto
         FROM producto p
         LEFT JOIN movimientoStock ms ON ms.idTienda=p.idTienda AND ms.idProducto=p.idProducto
         GROUP BY p.idTienda, p.idProducto, p.stockUnidadesTotal
         HAVING COALESCE(SUM(ms.cantidad),0)<>p.stockUnidadesTotal
       ) diferencias`);
    const productsWithoutMovement = await scalar(connection,
      `SELECT COUNT(*) total FROM producto p
       WHERE p.stockUnidadesTotal<>0 AND NOT EXISTS (
         SELECT 1 FROM movimientoStock ms WHERE ms.idTienda=p.idTienda AND ms.idProducto=p.idProducto
       )`);
    const zeroMovements = await scalar(connection, 'SELECT COUNT(*) total FROM movimientoStock WHERE cantidad=0');
    const planFeatures = await scalar(connection,
      `SELECT COUNT(DISTINCT CONCAT(p.codigo, ':', f.codigo)) total
       FROM planFuncionalidad pf
       JOIN plan p ON p.idPlan=pf.idPlan
       JOIN funcionalidad f ON f.idFuncionalidad=pf.idFuncionalidad
       WHERE p.codigo IN ('basico','avanzado')
         AND f.codigo IN ('historial_stock','ajuste_stock')
         AND p.activo=1 AND f.activo=1 AND pf.habilitada=1`);
    const [byType] = await connection.query(
      'SELECT tipoMovimiento, COUNT(*) total, COALESCE(SUM(cantidad),0) cantidad FROM movimientoStock GROUP BY tipoMovimiento ORDER BY tipoMovimiento'
    );
    const [byOrigin] = await connection.query(
      'SELECT origen, COUNT(*) total, COALESCE(SUM(cantidad),0) cantidad FROM movimientoStock GROUP BY origen ORDER BY origen'
    );
    const structureComplete = Object.values(columnState).every(Boolean)
      && Object.values(indexState).every(Boolean)
      && Object.values(checkState).every(Boolean)
      && Object.values(foreignKeyState).every(Boolean);
    const inconsistencies = invalidStores + crossStoreProducts + invalidOwners + inconsistentMovements
      + invalidReferences + doubleCommercialReferences + purchasesWithoutPurchaseDetail
      + salesWithoutSaleDetail + commercialReferencesAgainstOrigin + nonCommercialMovementsWithDetails
      + duplicateReferences + negativeProducts + reconciliationDifferences
      + productsWithoutMovement + zeroMovements;

    console.log(JSON.stringify({
      destino: databaseTarget(config),
      estado: migrationRecorded && structureComplete && inconsistencies === 0 && planFeatures === 4
        ? 'post-migracion'
        : 'estructura-incompleta-o-inconsistente',
      migracion007Registrada: migrationRecorded,
      tablaMovimientoStock: movementTable,
      columnas: columnState,
      indices: indexState,
      checks: checkState,
      clavesForaneas: foreignKeyState,
      planesYFuncionesHabilitadas: planFeatures,
      movimientosConTiendaInvalida: invalidStores,
      movimientosConProductoDeOtraTienda: crossStoreProducts,
      responsablesInvalidos: invalidOwners,
      movimientosIncoherentes: inconsistentMovements,
      referenciasInvalidas: invalidReferences,
      movimientosConDobleReferenciaComercial: doubleCommercialReferences,
      movimientosCompraSinDetalleCompra: purchasesWithoutPurchaseDetail,
      movimientosVentaSinDetalleVenta: salesWithoutSaleDetail,
      referenciasComercialesIncompatiblesConOrigen: commercialReferencesAgainstOrigin,
      movimientosNoComercialesConDetalles: nonCommercialMovementsWithDetails,
      ajustesManualesConReferenciasComerciales: manualMovementsWithCommercialDetails,
      referenciasDuplicadas: duplicateReferences,
      productosConStockNegativo: negativeProducts,
      diferenciasStockLegado: legacyStockDifferences,
      diferenciasReconciliacion: reconciliationDifferences,
      productosConStockSinMovimiento: productsWithoutMovement,
      movimientosCantidadCero: zeroMovements,
      conteosPorTipo: byType,
      conteosPorOrigen: byOrigin
    }, null, 2));
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error('No se pudieron comprobar los movimientos de stock.');
  console.error(error.message);
  process.exit(1);
});
