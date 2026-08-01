const fs = require('fs');
const path = require('path');
const { logDatabaseTarget } = require('../config/env');
const { formatLocalDateTime } = require('../utils/local-datetime');
const {
  createConnection,
  hasTable,
  hasColumns,
  hasColumnTypes,
  hasForeignKey,
  hasForeignKeyConstraint,
  hasIndex,
  hasIndexNamed,
  hasConstraint,
  hasCheckConstraint,
  readSqlStatements
} = require('./db-utils');
const {
  inspectLegacyMigration,
  isLegacyMigration,
  migrateLegacyMigration
} = require('./migration-state/legacy-migrations');
const {
  COLLECTION_COMPENSATION_TYPES,
  COLLECTION_OPERATION_STATES,
  COLLECTION_PAYMENT_METHODS,
  COMPENSATION_FEATURE,
  COMPENSATION_REASONS,
  COMPENSATION_STATES,
  COMPENSATION_TYPES,
  INVENTORY_RETURN_RESULTS,
  INVENTORY_RETURN_TREATMENTS,
  MATERIAL_SETTLEMENT_TYPES,
  REFUND_OBLIGATION_STATES,
  SALE_PAYMENT_METHODS,
  SALE_COMPENSATION_TYPES,
  SALE_OPERATION_STATES
} = require('../config/compensation-contract');

const MIGRATION_LOCAL_DATETIME_TOKEN = '__MIGRATION_LOCAL_DATETIME__';

function prepareMigrationStatement(file, statement, context = {}) {
  if (![
    '010_inteligencia_inventario.sql',
    '011_lotes_vencimientos.sql',
    '012_clientes_fiados_comunicacion.sql',
    '014_operaciones_compensatorias.sql',
    '021_configuracion_base_tienda.sql'
  ].includes(file)
    || !statement.includes(MIGRATION_LOCAL_DATETIME_TOKEN)) {
    return { sql: statement, params: [] };
  }
  if (!context.localDateTime) {
    throw new Error(`La migracion ${file} requiere una marca de fecha local explicita.`);
  }
  const occurrences = statement.split(MIGRATION_LOCAL_DATETIME_TOKEN).length - 1;
  return {
    sql: statement.split(MIGRATION_LOCAL_DATETIME_TOKEN).join('?'),
    params: Array(occurrences).fill(context.localDateTime)
  };
}

const migrationRequirements = {
  '004_multitienda_base.sql': {
    columns: {
      tienda: ['idTienda', 'nombre', 'slug', 'activo', 'estado', 'creadoEn', 'actualizadoEn'],
      administrador: ['idTienda', 'rol', 'activo'],
      cliente: ['idTienda'],
      proveedor: ['idTienda'],
      producto: ['idTienda'],
      venta: ['idTienda'],
      compra: ['idTienda'],
      fiado: ['idTienda'],
      detalleVenta: ['idTienda'],
      detalleCompra: ['idTienda'],
      detalleFiado: ['idTienda'],
      pagoFiado: ['idTienda']
    },
    indexes: [
      ['tienda', 'uq_tienda_slug', ['slug'], true],
      ['administrador', 'idx_administrador_tienda_activo', ['idTienda', 'activo'], false],
      ['cliente', 'uq_cliente_tienda_id', ['idTienda', 'idCliente'], true],
      ['cliente', 'idx_cliente_tienda_activo_nombre', ['idTienda', 'activo', 'nombre'], false],
      ['proveedor', 'uq_proveedor_tienda_id', ['idTienda', 'idProveedor'], true],
      ['proveedor', 'idx_proveedor_tienda_nombre', ['idTienda', 'nombre'], false],
      ['producto', 'uq_producto_tienda_id', ['idTienda', 'idProducto'], true],
      ['producto', 'idx_producto_tienda_proveedor', ['idTienda', 'idProveedor'], false],
      ['producto', 'idx_producto_tienda_categoria_nombre', ['idTienda', 'categoria', 'nombre'], false],
      ['venta', 'uq_venta_tienda_id', ['idTienda', 'idVenta'], true],
      ['venta', 'idx_venta_tienda_fecha', ['idTienda', 'fecha'], false],
      ['venta', 'idx_venta_tienda_cliente', ['idTienda', 'idCliente'], false],
      ['compra', 'uq_compra_tienda_id', ['idTienda', 'idCompra'], true],
      ['compra', 'idx_compra_tienda_fecha', ['idTienda', 'fecha'], false],
      ['compra', 'idx_compra_tienda_proveedor', ['idTienda', 'idProveedor'], false],
      ['fiado', 'uq_fiado_tienda_id', ['idTienda', 'idFiado'], true],
      ['fiado', 'idx_fiado_tienda_estado_fecha', ['idTienda', 'activo', 'estado', 'fechaInicio'], false],
      ['fiado', 'idx_fiado_tienda_cliente', ['idTienda', 'idCliente'], false],
      ['fiado', 'idx_fiado_tienda_venta', ['idTienda', 'idVenta'], false],
      ['detalleVenta', 'idx_detalleVenta_tienda_venta', ['idTienda', 'idVenta'], false],
      ['detalleVenta', 'idx_detalleVenta_tienda_producto', ['idTienda', 'idProducto'], false],
      ['detalleCompra', 'idx_detalleCompra_tienda_compra', ['idTienda', 'idCompra'], false],
      ['detalleCompra', 'idx_detalleCompra_tienda_producto', ['idTienda', 'idProducto'], false],
      ['detalleFiado', 'idx_detalleFiado_tienda_fiado', ['idTienda', 'idFiado'], false],
      ['detalleFiado', 'idx_detalleFiado_tienda_producto', ['idTienda', 'idProducto'], false],
      ['pagoFiado', 'idx_pagoFiado_tienda_fiado', ['idTienda', 'idFiado'], false]
    ],
    checks: [
      ['administrador', 'chk_administrador_rol_tienda']
    ],
    foreignKeyConstraints: [
      ['administrador', 'fk_administrador_tienda', ['idTienda'], 'tienda', ['idTienda']],
      ['cliente', 'fk_cliente_tienda', ['idTienda'], 'tienda', ['idTienda']],
      ['proveedor', 'fk_proveedor_tienda', ['idTienda'], 'tienda', ['idTienda']],
      ['producto', 'fk_producto_tienda', ['idTienda'], 'tienda', ['idTienda']],
      ['venta', 'fk_venta_tienda', ['idTienda'], 'tienda', ['idTienda']],
      ['compra', 'fk_compra_tienda', ['idTienda'], 'tienda', ['idTienda']],
      ['fiado', 'fk_fiado_tienda', ['idTienda'], 'tienda', ['idTienda']],
      ['detalleVenta', 'fk_detalleVenta_tienda', ['idTienda'], 'tienda', ['idTienda']],
      ['detalleCompra', 'fk_detalleCompra_tienda', ['idTienda'], 'tienda', ['idTienda']],
      ['detalleFiado', 'fk_detalleFiado_tienda', ['idTienda'], 'tienda', ['idTienda']],
      ['pagoFiado', 'fk_pagoFiado_tienda', ['idTienda'], 'tienda', ['idTienda']],
      ['producto', 'fk_producto_tienda_proveedor', ['idTienda', 'idProveedor'], 'proveedor', ['idTienda', 'idProveedor']],
      ['venta', 'fk_venta_tienda_cliente', ['idTienda', 'idCliente'], 'cliente', ['idTienda', 'idCliente']],
      ['compra', 'fk_compra_tienda_proveedor', ['idTienda', 'idProveedor'], 'proveedor', ['idTienda', 'idProveedor']],
      ['fiado', 'fk_fiado_tienda_cliente', ['idTienda', 'idCliente'], 'cliente', ['idTienda', 'idCliente']],
      ['fiado', 'fk_fiado_tienda_venta', ['idTienda', 'idVenta'], 'venta', ['idTienda', 'idVenta']],
      ['detalleVenta', 'fk_detalleVenta_tienda_venta', ['idTienda', 'idVenta'], 'venta', ['idTienda', 'idVenta']],
      ['detalleVenta', 'fk_detalleVenta_tienda_producto', ['idTienda', 'idProducto'], 'producto', ['idTienda', 'idProducto']],
      ['detalleCompra', 'fk_detalleCompra_tienda_compra', ['idTienda', 'idCompra'], 'compra', ['idTienda', 'idCompra']],
      ['detalleCompra', 'fk_detalleCompra_tienda_producto', ['idTienda', 'idProducto'], 'producto', ['idTienda', 'idProducto']],
      ['detalleFiado', 'fk_detalleFiado_tienda_fiado', ['idTienda', 'idFiado'], 'fiado', ['idTienda', 'idFiado']],
      ['detalleFiado', 'fk_detalleFiado_tienda_producto', ['idTienda', 'idProducto'], 'producto', ['idTienda', 'idProducto']],
      ['pagoFiado', 'fk_pagoFiado_tienda_fiado', ['idTienda', 'idFiado'], 'fiado', ['idTienda', 'idFiado']]
    ]
  },
  '005_planes_suscripciones.sql': {
    columns: {
      plan: ['idPlan', 'codigo', 'nombre', 'activo', 'precioMensual', 'duracionDias', 'limitePropietarios', 'limiteProductos', 'limiteClientes', 'limiteProveedores', 'creadoEn', 'actualizadoEn'],
      funcionalidad: ['idFuncionalidad', 'codigo', 'nombre', 'activo', 'creadoEn', 'actualizadoEn'],
      planFuncionalidad: ['idPlan', 'idFuncionalidad', 'habilitada', 'creadoEn'],
      suscripcionTienda: ['idSuscripcion', 'idTienda', 'idPlan', 'tipo', 'estado', 'fechaInicio', 'fechaFin', 'renovacionAutomatica', 'observacion', 'creadoPor', 'creadoEn', 'actualizadoEn']
    },
    indexes: [
      ['plan', 'uq_plan_codigo', ['codigo'], true],
      ['funcionalidad', 'uq_funcionalidad_codigo', ['codigo'], true],
      ['planFuncionalidad', 'idx_planFuncionalidad_funcionalidad', ['idFuncionalidad'], false],
      ['suscripcionTienda', 'idx_suscripcion_tienda_estado_fechas', ['idTienda', 'estado', 'fechaInicio', 'fechaFin'], false],
      ['suscripcionTienda', 'idx_suscripcion_plan', ['idPlan'], false],
      ['suscripcionTienda', 'idx_suscripcion_creadoPor', ['creadoPor'], false]
    ],
    foreignKeyConstraints: [
      ['planFuncionalidad', 'fk_planFuncionalidad_plan', ['idPlan'], 'plan', ['idPlan']],
      ['planFuncionalidad', 'fk_planFuncionalidad_funcionalidad', ['idFuncionalidad'], 'funcionalidad', ['idFuncionalidad']],
      ['suscripcionTienda', 'fk_suscripcion_tienda', ['idTienda'], 'tienda', ['idTienda']],
      ['suscripcionTienda', 'fk_suscripcion_plan', ['idPlan'], 'plan', ['idPlan']],
      ['suscripcionTienda', 'fk_suscripcion_creadoPor', ['creadoPor'], 'administrador', ['idAdministrador']]
    ]
  },
  '006_catalogo_maestro.sql': {
    columns: {
      categoriaMaestra: ['idCategoriaMaestra', 'nombre', 'nombreNormalizado', 'activo', 'creadoEn', 'actualizadoEn'],
      marcaMaestra: ['idMarcaMaestra', 'nombre', 'nombreNormalizado', 'activo', 'creadoEn', 'actualizadoEn'],
      productoMaestro: ['idProductoMaestro', 'nombre', 'nombreNormalizado', 'descripcion', 'idCategoriaMaestra', 'idMarcaMaestra', 'codigoBarras', 'presentacion', 'contenidoCantidad', 'contenidoUnidad', 'unidadesPorPaquete', 'permiteVentaPorUnidad', 'permiteVentaPorPaquete', 'huellaDuplicado', 'activo', 'creadoEn', 'actualizadoEn'],
      auditoriaCatalogo: ['idAuditoriaCatalogo', 'idAdministrador', 'accion', 'entidad', 'idEntidad', 'detalle', 'creadoEn'],
      producto: ['idProductoMaestro']
    },
    indexes: [
      ['categoriaMaestra', 'uq_categoriaMaestra_normalizada', ['nombreNormalizado'], true],
      ['categoriaMaestra', 'idx_categoriaMaestra_activo_nombre', ['activo', 'nombre'], false],
      ['marcaMaestra', 'uq_marcaMaestra_normalizada', ['nombreNormalizado'], true],
      ['marcaMaestra', 'idx_marcaMaestra_activo_nombre', ['activo', 'nombre'], false],
      ['productoMaestro', 'uq_productoMaestro_codigoBarras', ['codigoBarras'], true],
      ['productoMaestro', 'idx_productoMaestro_busqueda', ['activo', 'nombreNormalizado'], false],
      ['productoMaestro', 'idx_productoMaestro_categoria', ['idCategoriaMaestra', 'activo'], false],
      ['productoMaestro', 'idx_productoMaestro_marca', ['idMarcaMaestra', 'activo'], false],
      ['productoMaestro', 'idx_productoMaestro_huella', ['huellaDuplicado'], false],
      ['auditoriaCatalogo', 'idx_auditoriaCatalogo_admin_fecha', ['idAdministrador', 'creadoEn'], false],
      ['auditoriaCatalogo', 'idx_auditoriaCatalogo_entidad', ['entidad', 'idEntidad', 'creadoEn'], false],
      ['producto', 'idx_producto_productoMaestro', ['idProductoMaestro'], false],
      ['producto', 'uq_producto_tienda_maestro', ['idTienda', 'idProductoMaestro'], true]
    ],
    foreignKeyConstraints: [
      ['productoMaestro', 'fk_productoMaestro_categoria', ['idCategoriaMaestra'], 'categoriaMaestra', ['idCategoriaMaestra'], 'CASCADE', 'RESTRICT'],
      ['productoMaestro', 'fk_productoMaestro_marca', ['idMarcaMaestra'], 'marcaMaestra', ['idMarcaMaestra'], 'CASCADE', 'RESTRICT'],
      ['auditoriaCatalogo', 'fk_auditoriaCatalogo_admin', ['idAdministrador'], 'administrador', ['idAdministrador'], 'CASCADE', 'RESTRICT'],
      ['producto', 'fk_producto_productoMaestro', ['idProductoMaestro'], 'productoMaestro', ['idProductoMaestro'], 'CASCADE', 'RESTRICT']
    ]
  },
  '007_movimientos_stock.sql': {
    columns: {
      producto: ['activo', 'eliminadoEn'],
      venta: ['claveOperacion'],
      compra: ['claveOperacion'],
      movimientoStock: [
        'idMovimientoStock', 'idTienda', 'idProducto', 'tipoMovimiento', 'origen', 'cantidad',
        'stockAnterior', 'stockPosterior', 'cantidadOperacion', 'unidadOperacion', 'motivo',
        'observacion', 'idDetalleVenta', 'idDetalleCompra', 'referenciaTipo', 'referenciaId',
        'claveOperacion', 'idAdministrador', 'creadoEn'
      ]
    },
    indexes: [
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
    ],
    checks: [
      ['movimientoStock', 'chk_movimiento_cantidad'],
      ['movimientoStock', 'chk_movimiento_stock_no_negativo'],
      ['movimientoStock', 'chk_movimiento_balance'],
      ['movimientoStock', 'chk_movimiento_tipo'],
      ['movimientoStock', 'chk_movimiento_origen'],
      ['movimientoStock', 'chk_movimiento_signo'],
      ['movimientoStock', 'chk_movimiento_cantidad_operacion']
    ],
    foreignKeyConstraints: [
      ['movimientoStock', 'fk_movimiento_tienda', ['idTienda'], 'tienda', ['idTienda'], 'RESTRICT', 'RESTRICT'],
      ['movimientoStock', 'fk_movimiento_producto', ['idTienda', 'idProducto'], 'producto', ['idTienda', 'idProducto'], 'RESTRICT', 'RESTRICT'],
      ['movimientoStock', 'fk_movimiento_administrador', ['idTienda', 'idAdministrador'], 'administrador', ['idTienda', 'idAdministrador'], 'RESTRICT', 'RESTRICT'],
      ['movimientoStock', 'fk_movimiento_detalleVenta', ['idTienda', 'idDetalleVenta'], 'detalleVenta', ['idTienda', 'idDetalleVenta'], 'RESTRICT', 'RESTRICT'],
      ['movimientoStock', 'fk_movimiento_detalleCompra', ['idTienda', 'idDetalleCompra'], 'detalleCompra', ['idTienda', 'idDetalleCompra'], 'RESTRICT', 'RESTRICT']
    ]
  },
  '008_punto_venta_pagos.sql': {
    columns: {
      producto: ['codigoBarras', 'precioVentaPaquete', 'favoritoPos'],
      venta: ['subtotal', 'descuento', 'montoPagado', 'saldoPendiente', 'estadoPago', 'codigoComprobante'],
      pagoVenta: [
        'idPagoVenta', 'idTienda', 'idVenta', 'idPagoFiado', 'metodoPago', 'monto', 'montoRecibido', 'cambio',
        'referencia', 'claveOperacion', 'idAdministrador', 'creadoEn'
      ]
    },
    indexes: [
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
    ],
    checks: [
      ['pagoVenta', 'chk_pagoVenta_monto'],
      ['pagoVenta', 'chk_pagoVenta_metodo'],
      ['pagoVenta', 'chk_pagoVenta_efectivo'],
      ['venta', 'chk_venta_totales_pos'],
      ['venta', 'chk_venta_saldo_pos'],
      ['venta', 'chk_venta_estado_pos']
    ],
    foreignKeyConstraints: [
      ['pagoVenta', 'fk_pagoVenta_tienda', ['idTienda'], 'tienda', ['idTienda'], 'RESTRICT', 'RESTRICT'],
      ['pagoVenta', 'fk_pagoVenta_venta', ['idTienda', 'idVenta'], 'venta', ['idTienda', 'idVenta'], 'RESTRICT', 'RESTRICT'],
      ['pagoVenta', 'fk_pagoVenta_pagoFiado', ['idTienda', 'idPagoFiado'], 'pagoFiado', ['idTienda', 'idPagoFiado'], 'RESTRICT', 'RESTRICT'],
      ['pagoVenta', 'fk_pagoVenta_administrador', ['idTienda', 'idAdministrador'], 'administrador', ['idTienda', 'idAdministrador'], 'RESTRICT', 'RESTRICT']
    ]
  },
  '009_finanzas_reportes_caja.sql': {
    columns: {
      detalleVenta: ['origenCosto'],
      categoriaGasto: ['idCategoriaGasto', 'idTienda', 'nombre', 'nombreNormalizado', 'descripcion', 'activo', 'creadoEn', 'actualizadoEn'],
      gasto: [
        'idGasto', 'idTienda', 'idCategoriaGasto', 'idAdministrador', 'idAdministradorModifica',
        'idAdministradorAnula', 'fechaGasto', 'concepto', 'monto', 'metodoPago', 'referencia',
        'observacion', 'recurrente', 'estado', 'motivoAnulacion', 'creadoEn', 'actualizadoEn', 'anuladoEn'
      ],
      cierreCaja: [
        'idCierreCaja', 'idTienda', 'idAdministrador', 'idAdministradorAnula', 'fechaInicio',
        'fechaFin', 'efectivoInicial', 'efectivoVentasEsperado', 'efectivoFiadosCobrado',
        'gastosEfectivo', 'efectivoEsperado', 'efectivoContado', 'diferencia', 'totalQR',
        'totalNoEspecificado', 'totalCobrado', 'totalVentas', 'totalFiadoGenerado',
        'totalGastos', 'totalCompras', 'observacion', 'estado', 'motivoAnulacion',
        'claveOperacion', 'creadoEn', 'anuladoEn'
      ]
    },
    indexes: [
      ['categoriaGasto', 'uq_categoriaGasto_tienda_id', ['idTienda', 'idCategoriaGasto'], true],
      ['categoriaGasto', 'uq_categoriaGasto_tienda_normalizada', ['idTienda', 'nombreNormalizado'], true],
      ['categoriaGasto', 'idx_categoriaGasto_tienda_activo_nombre', ['idTienda', 'activo', 'nombre'], false],
      ['gasto', 'uq_gasto_tienda_id', ['idTienda', 'idGasto'], true],
      ['gasto', 'idx_gasto_tienda_fecha_estado', ['idTienda', 'fechaGasto', 'estado'], false],
      ['gasto', 'idx_gasto_tienda_categoria_fecha', ['idTienda', 'idCategoriaGasto', 'fechaGasto'], false],
      ['gasto', 'idx_gasto_tienda_metodo_fecha', ['idTienda', 'metodoPago', 'fechaGasto'], false],
      ['cierreCaja', 'uq_cierreCaja_tienda_id', ['idTienda', 'idCierreCaja'], true],
      ['cierreCaja', 'uq_cierreCaja_tienda_clave', ['idTienda', 'claveOperacion'], true],
      ['cierreCaja', 'idx_cierreCaja_tienda_estado_periodo', ['idTienda', 'estado', 'fechaInicio', 'fechaFin'], false],
      ['cierreCaja', 'idx_cierreCaja_tienda_admin_fecha', ['idTienda', 'idAdministrador', 'creadoEn'], false]
    ],
    checks: [
      ['gasto', 'chk_gasto_monto'],
      ['gasto', 'chk_gasto_estado'],
      ['cierreCaja', 'chk_cierreCaja_periodo'],
      ['cierreCaja', 'chk_cierreCaja_montos'],
      ['cierreCaja', 'chk_cierreCaja_balance'],
      ['cierreCaja', 'chk_cierreCaja_estado']
    ],
    foreignKeyConstraints: [
      ['categoriaGasto', 'fk_categoriaGasto_tienda', ['idTienda'], 'tienda', ['idTienda'], 'RESTRICT', 'RESTRICT'],
      ['gasto', 'fk_gasto_tienda', ['idTienda'], 'tienda', ['idTienda'], 'RESTRICT', 'RESTRICT'],
      ['gasto', 'fk_gasto_categoria', ['idTienda', 'idCategoriaGasto'], 'categoriaGasto', ['idTienda', 'idCategoriaGasto'], 'RESTRICT', 'RESTRICT'],
      ['gasto', 'fk_gasto_creador', ['idTienda', 'idAdministrador'], 'administrador', ['idTienda', 'idAdministrador'], 'RESTRICT', 'RESTRICT'],
      ['gasto', 'fk_gasto_modificador', ['idTienda', 'idAdministradorModifica'], 'administrador', ['idTienda', 'idAdministrador'], 'RESTRICT', 'RESTRICT'],
      ['gasto', 'fk_gasto_anulador', ['idTienda', 'idAdministradorAnula'], 'administrador', ['idTienda', 'idAdministrador'], 'RESTRICT', 'RESTRICT'],
      ['cierreCaja', 'fk_cierreCaja_tienda', ['idTienda'], 'tienda', ['idTienda'], 'RESTRICT', 'RESTRICT'],
      ['cierreCaja', 'fk_cierreCaja_creador', ['idTienda', 'idAdministrador'], 'administrador', ['idTienda', 'idAdministrador'], 'RESTRICT', 'RESTRICT'],
      ['cierreCaja', 'fk_cierreCaja_anulador', ['idTienda', 'idAdministradorAnula'], 'administrador', ['idTienda', 'idAdministrador'], 'RESTRICT', 'RESTRICT']
    ]
  },
  '010_inteligencia_inventario.sql': {
    columns: {
      configuracionInventarioTienda: [
        'idTienda', 'periodoAnalisisDias', 'diasHistorialMinimo', 'diasReposicionDefault',
        'diasCoberturaDefault', 'diasProductoNuevo', 'creadoEn', 'actualizadoEn',
        'idAdministradorActualiza'
      ],
      producto: [
        'diasReposicion', 'diasCoberturaObjetivo', 'presentacionCompraSugerida',
        'fechaInicioSeguimiento'
      ]
    },
    indexes: [
      ['configuracionInventarioTienda', 'PRIMARY', ['idTienda'], true],
      ['configuracionInventarioTienda', 'idx_configInventario_tienda_admin', ['idTienda', 'idAdministradorActualiza'], false],
      ['producto', 'idx_producto_tienda_inventario', ['idTienda', 'activo', 'stockUnidadesTotal', 'stockMinimo'], false],
      ['producto', 'idx_producto_tienda_categoria_activo', ['idTienda', 'categoria', 'activo'], false],
      ['producto', 'idx_producto_tienda_proveedor_activo', ['idTienda', 'idProveedor', 'activo'], false],
      ['producto', 'idx_producto_tienda_seguimiento', ['idTienda', 'fechaInicioSeguimiento'], false],
      ['detalleVenta', 'idx_detalleVenta_tienda_producto_venta', ['idTienda', 'idProducto', 'idVenta'], false],
      ['detalleCompra', 'idx_detalleCompra_tienda_producto_compra', ['idTienda', 'idProducto', 'idCompra'], false]
    ],
    checks: [
      ['configuracionInventarioTienda', 'chk_configInventario_periodos'],
      ['configuracionInventarioTienda', 'chk_configInventario_reposicion'],
      ['configuracionInventarioTienda', 'chk_configInventario_cobertura'],
      ['configuracionInventarioTienda', 'chk_configInventario_producto_nuevo'],
      ['producto', 'chk_producto_dias_reposicion'],
      ['producto', 'chk_producto_dias_cobertura']
    ],
    foreignKeyConstraints: [
      ['configuracionInventarioTienda', 'fk_configInventario_tienda', ['idTienda'], 'tienda', ['idTienda'], 'RESTRICT', 'RESTRICT'],
      ['configuracionInventarioTienda', 'fk_configInventario_administrador', ['idTienda', 'idAdministradorActualiza'], 'administrador', ['idTienda', 'idAdministrador'], 'RESTRICT', 'RESTRICT']
    ]
  },
  '011_lotes_vencimientos.sql': {
    columns: {
      configuracionInventarioTienda: ['diasAlertaVencimientoDefault'],
      producto: ['controlaLotes', 'controlaVencimiento', 'diasAlertaVencimiento', 'lotesActivadosEn'],
      loteProducto: [
        'idLoteProducto', 'idTienda', 'idProducto', 'idProveedor', 'idDetalleCompra',
        'codigoLote', 'origen', 'fechaIngreso', 'fechaVencimiento', 'cantidadInicial',
        'cantidadRestante', 'costoUnitarioBase', 'estadoOperativo', 'claveOperacion',
        'creadoEn', 'actualizadoEn', 'idAdministradorCrea', 'idAdministradorActualiza'
      ],
      movimientoLote: [
        'idMovimientoLote', 'idTienda', 'idProducto', 'idLoteProducto',
        'idMovimientoStock', 'tipoRegistro', 'cantidad', 'cantidadAnterior',
        'cantidadPosterior', 'claveOperacion', 'creadoEn', 'idAdministrador'
      ]
    },
    indexes: [
      ['detalleCompra', 'uq_detalleCompra_tienda_producto_id', ['idTienda', 'idProducto', 'idDetalleCompra'], true],
      ['movimientoStock', 'uq_movimiento_tienda_producto_id', ['idTienda', 'idProducto', 'idMovimientoStock'], true],
      ['loteProducto', 'PRIMARY', ['idLoteProducto'], true],
      ['loteProducto', 'uq_lote_tienda_producto_id', ['idTienda', 'idProducto', 'idLoteProducto'], true],
      ['loteProducto', 'uq_lote_tienda_clave', ['idTienda', 'claveOperacion'], true],
      ['loteProducto', 'idx_lote_tienda_producto_estado_vencimiento', ['idTienda', 'idProducto', 'estadoOperativo', 'fechaVencimiento'], false],
      ['loteProducto', 'idx_lote_tienda_producto_ingreso', ['idTienda', 'idProducto', 'fechaIngreso', 'idLoteProducto'], false],
      ['loteProducto', 'idx_lote_tienda_proveedor_ingreso', ['idTienda', 'idProveedor', 'fechaIngreso'], false],
      ['loteProducto', 'idx_lote_tienda_detalleCompra', ['idTienda', 'idDetalleCompra'], false],
      ['loteProducto', 'idx_lote_tienda_codigo', ['idTienda', 'codigoLote'], false],
      ['loteProducto', 'idx_lote_tienda_estado_vencimiento', ['idTienda', 'estadoOperativo', 'fechaVencimiento'], false],
      ['movimientoLote', 'PRIMARY', ['idMovimientoLote'], true],
      ['movimientoLote', 'uq_movimientoLote_tienda_clave', ['idTienda', 'claveOperacion'], true],
      ['movimientoLote', 'idx_movimientoLote_tienda_lote_fecha', ['idTienda', 'idLoteProducto', 'creadoEn'], false],
      ['movimientoLote', 'idx_movimientoLote_tienda_movimiento', ['idTienda', 'idMovimientoStock'], false],
      ['movimientoLote', 'idx_movimientoLote_tienda_producto_fecha', ['idTienda', 'idProducto', 'creadoEn'], false],
      ['movimientoLote', 'idx_movimientoLote_tienda_tipo_fecha', ['idTienda', 'tipoRegistro', 'creadoEn'], false]
    ],
    checks: [
      ['configuracionInventarioTienda', 'chk_configInventario_alerta_vencimiento'],
      ['producto', 'chk_producto_controla_lotes'],
      ['producto', 'chk_producto_controla_vencimiento'],
      ['producto', 'chk_producto_vencimiento_requiere_lotes'],
      ['producto', 'chk_producto_dias_alerta_vencimiento'],
      ['producto', 'chk_producto_lotes_activacion'],
      ['loteProducto', 'chk_lote_cantidades'],
      ['loteProducto', 'chk_lote_costo'],
      ['loteProducto', 'chk_lote_fecha_vencimiento'],
      ['loteProducto', 'chk_lote_codigo'],
      ['loteProducto', 'chk_lote_origen_detalle'],
      ['loteProducto', 'chk_lote_anulado_sin_saldo'],
      ['movimientoLote', 'chk_movimientoLote_cantidad'],
      ['movimientoLote', 'chk_movimientoLote_balance'],
      ['movimientoLote', 'chk_movimientoLote_referencia']
    ],
    foreignKeyConstraints: [
      ['loteProducto', 'fk_lote_tienda', ['idTienda'], 'tienda', ['idTienda'], 'RESTRICT', 'RESTRICT'],
      ['loteProducto', 'fk_lote_producto', ['idTienda', 'idProducto'], 'producto', ['idTienda', 'idProducto'], 'RESTRICT', 'RESTRICT'],
      ['loteProducto', 'fk_lote_proveedor', ['idTienda', 'idProveedor'], 'proveedor', ['idTienda', 'idProveedor'], 'RESTRICT', 'RESTRICT'],
      ['loteProducto', 'fk_lote_detalleCompra', ['idTienda', 'idProducto', 'idDetalleCompra'], 'detalleCompra', ['idTienda', 'idProducto', 'idDetalleCompra'], 'RESTRICT', 'RESTRICT'],
      ['loteProducto', 'fk_lote_admin_crea', ['idTienda', 'idAdministradorCrea'], 'administrador', ['idTienda', 'idAdministrador'], 'RESTRICT', 'RESTRICT'],
      ['loteProducto', 'fk_lote_admin_actualiza', ['idTienda', 'idAdministradorActualiza'], 'administrador', ['idTienda', 'idAdministrador'], 'RESTRICT', 'RESTRICT'],
      ['movimientoLote', 'fk_movimientoLote_tienda', ['idTienda'], 'tienda', ['idTienda'], 'RESTRICT', 'RESTRICT'],
      ['movimientoLote', 'fk_movimientoLote_producto', ['idTienda', 'idProducto'], 'producto', ['idTienda', 'idProducto'], 'RESTRICT', 'RESTRICT'],
      ['movimientoLote', 'fk_movimientoLote_lote', ['idTienda', 'idProducto', 'idLoteProducto'], 'loteProducto', ['idTienda', 'idProducto', 'idLoteProducto'], 'RESTRICT', 'RESTRICT'],
      ['movimientoLote', 'fk_movimientoLote_movimientoStock', ['idTienda', 'idProducto', 'idMovimientoStock'], 'movimientoStock', ['idTienda', 'idProducto', 'idMovimientoStock'], 'RESTRICT', 'RESTRICT'],
      ['movimientoLote', 'fk_movimientoLote_administrador', ['idTienda', 'idAdministrador'], 'administrador', ['idTienda', 'idAdministrador'], 'RESTRICT', 'RESTRICT']
    ]
  },
  '012_clientes_fiados_comunicacion.sql': {
    columns: {
      cliente: [
        'direccion', 'telefonoAlternativo', 'telefonoNormalizado', 'documentoIdentidad',
        'documentoNormalizado', 'correo', 'notas', 'limiteCredito', 'permiteFiado',
        'diasCreditoDefault', 'canalPreferido', 'aceptaRecordatorios', 'horarioPreferido',
        'creadoEn', 'actualizadoEn', 'idAdministradorCrea', 'idAdministradorActualiza'
      ],
      fiado: [
        'fechaVencimiento', 'fechaPrometidaPago', 'observacionCredito', 'cerradoEn',
        'idAdministradorCrea'
      ],
      pagoFiado: ['idCobroFiado', 'claveDistribucion'],
      configuracionCreditoTienda: [
        'idTienda', 'limiteCreditoDefault', 'diasCreditoDefault', 'diasAvisoVencimiento',
        'politicaFiadoVencido', 'requiereTelefonoParaFiado', 'permiteFiadoSinFecha',
        'codigoPaisWhatsApp', 'creadoEn', 'actualizadoEn', 'idAdministradorActualiza'
      ],
      cobroFiado: [
        'idCobroFiado', 'idTienda', 'idCliente', 'fechaCobro', 'montoTotal', 'metodoPago',
        'montoRecibido', 'cambio', 'referencia', 'observacion', 'claveOperacion',
        'creadoEn', 'idAdministrador', 'esLegado'
      ],
      seguimientoCobranza: [
        'idSeguimientoCobranza', 'idTienda', 'idCliente', 'idFiado', 'tipo', 'canal',
        'detalle', 'fechaCompromiso', 'creadoEn', 'idAdministrador'
      ],
      plantillaCobranzaTienda: [
        'idPlantillaCobranza', 'idTienda', 'tipo', 'nombre', 'contenido', 'activo',
        'creadoEn', 'actualizadoEn', 'idAdministradorActualiza'
      ]
    },
    indexes: [
      ['cliente', 'idx_cliente_tienda_activo_nombre', ['idTienda', 'activo', 'nombre'], false],
      ['cliente', 'uq_cliente_tienda_documento_normalizado', ['idTienda', 'documentoNormalizado'], true],
      ['cliente', 'idx_cliente_tienda_telefono_normalizado', ['idTienda', 'telefonoNormalizado'], false],
      ['cliente', 'idx_cliente_tienda_permite_fiado_activo', ['idTienda', 'permiteFiado', 'activo'], false],
      ['cliente', 'idx_cliente_tienda_admin_crea', ['idTienda', 'idAdministradorCrea'], false],
      ['cliente', 'idx_cliente_tienda_admin_actualiza', ['idTienda', 'idAdministradorActualiza'], false],
      ['fiado', 'uq_fiado_tienda_cliente_id', ['idTienda', 'idCliente', 'idFiado'], true],
      ['fiado', 'idx_fiado_tienda_cliente_saldo', ['idTienda', 'idCliente', 'saldoPendiente'], false],
      ['fiado', 'idx_fiado_tienda_vencimiento_saldo', ['idTienda', 'fechaVencimiento', 'saldoPendiente'], false],
      ['fiado', 'idx_fiado_tienda_promesa_saldo', ['idTienda', 'fechaPrometidaPago', 'saldoPendiente'], false],
      ['fiado', 'idx_fiado_tienda_estado_activo', ['idTienda', 'estado', 'activo'], false],
      ['fiado', 'idx_fiado_tienda_venta', ['idTienda', 'idVenta'], false],
      ['fiado', 'idx_fiado_tienda_admin_crea', ['idTienda', 'idAdministradorCrea'], false],
      ['configuracionCreditoTienda', 'PRIMARY', ['idTienda'], true],
      ['configuracionCreditoTienda', 'idx_configCredito_tienda_admin', ['idTienda', 'idAdministradorActualiza'], false],
      ['cobroFiado', 'PRIMARY', ['idCobroFiado'], true],
      ['cobroFiado', 'uq_cobroFiado_tienda_id', ['idTienda', 'idCobroFiado'], true],
      ['cobroFiado', 'uq_cobroFiado_tienda_clave', ['idTienda', 'claveOperacion'], true],
      ['cobroFiado', 'idx_cobroFiado_tienda_cliente_fecha', ['idTienda', 'idCliente', 'fechaCobro'], false],
      ['cobroFiado', 'idx_cobroFiado_tienda_fecha_metodo', ['idTienda', 'fechaCobro', 'metodoPago'], false],
      ['cobroFiado', 'idx_cobroFiado_tienda_admin_fecha', ['idTienda', 'idAdministrador', 'fechaCobro'], false],
      ['pagoFiado', 'uq_pagoFiado_tienda_clave_distribucion', ['idTienda', 'claveDistribucion'], true],
      ['pagoFiado', 'idx_pagoFiado_tienda_cobro_fiado', ['idTienda', 'idCobroFiado', 'idFiado'], false],
      ['seguimientoCobranza', 'PRIMARY', ['idSeguimientoCobranza'], true],
      ['seguimientoCobranza', 'idx_seguimientoCobranza_tienda_cliente_fecha', ['idTienda', 'idCliente', 'creadoEn'], false],
      ['seguimientoCobranza', 'idx_seguimientoCobranza_tienda_fiado_fecha', ['idTienda', 'idFiado', 'creadoEn'], false],
      ['seguimientoCobranza', 'idx_seguimientoCobranza_tienda_tipo_fecha', ['idTienda', 'tipo', 'creadoEn'], false],
      ['seguimientoCobranza', 'idx_seguimientoCobranza_tienda_compromiso', ['idTienda', 'fechaCompromiso'], false],
      ['seguimientoCobranza', 'idx_seguimientoCobranza_tienda_admin', ['idTienda', 'idAdministrador'], false],
      ['plantillaCobranzaTienda', 'PRIMARY', ['idPlantillaCobranza'], true],
      ['plantillaCobranzaTienda', 'uq_plantillaCobranza_tienda_tipo_nombre', ['idTienda', 'tipo', 'nombre'], true],
      ['plantillaCobranzaTienda', 'idx_plantillaCobranza_tienda_activo_tipo', ['idTienda', 'activo', 'tipo'], false],
      ['plantillaCobranzaTienda', 'idx_plantillaCobranza_tienda_admin', ['idTienda', 'idAdministradorActualiza'], false]
    ],
    checks: [
      ['cliente', 'chk_cliente_limite_credito'],
      ['cliente', 'chk_cliente_permite_fiado'],
      ['cliente', 'chk_cliente_acepta_recordatorios'],
      ['cliente', 'chk_cliente_dias_credito'],
      ['cliente', 'chk_cliente_contacto_normalizado'],
      ['fiado', 'chk_fiado_cierre_credito'],
      ['configuracionCreditoTienda', 'chk_configCredito_limite'],
      ['configuracionCreditoTienda', 'chk_configCredito_dias'],
      ['configuracionCreditoTienda', 'chk_configCredito_booleanos'],
      ['configuracionCreditoTienda', 'chk_configCredito_codigo_pais'],
      ['cobroFiado', 'chk_cobroFiado_monto'],
      ['cobroFiado', 'chk_cobroFiado_cambio'],
      ['cobroFiado', 'chk_cobroFiado_legado'],
      ['seguimientoCobranza', 'chk_seguimientoCobranza_detalle'],
      ['seguimientoCobranza', 'chk_seguimientoCobranza_compromiso'],
      ['plantillaCobranzaTienda', 'chk_plantillaCobranza_texto'],
      ['plantillaCobranzaTienda', 'chk_plantillaCobranza_activo']
    ],
    foreignKeyConstraints: [
      ['cliente', 'fk_cliente_admin_crea', ['idTienda', 'idAdministradorCrea'], 'administrador', ['idTienda', 'idAdministrador'], 'RESTRICT', 'RESTRICT'],
      ['cliente', 'fk_cliente_admin_actualiza', ['idTienda', 'idAdministradorActualiza'], 'administrador', ['idTienda', 'idAdministrador'], 'RESTRICT', 'RESTRICT'],
      ['fiado', 'fk_fiado_admin_crea', ['idTienda', 'idAdministradorCrea'], 'administrador', ['idTienda', 'idAdministrador'], 'RESTRICT', 'RESTRICT'],
      ['configuracionCreditoTienda', 'fk_configCredito_tienda', ['idTienda'], 'tienda', ['idTienda'], 'RESTRICT', 'RESTRICT'],
      ['configuracionCreditoTienda', 'fk_configCredito_administrador', ['idTienda', 'idAdministradorActualiza'], 'administrador', ['idTienda', 'idAdministrador'], 'RESTRICT', 'RESTRICT'],
      ['cobroFiado', 'fk_cobroFiado_tienda', ['idTienda'], 'tienda', ['idTienda'], 'RESTRICT', 'RESTRICT'],
      ['cobroFiado', 'fk_cobroFiado_cliente', ['idTienda', 'idCliente'], 'cliente', ['idTienda', 'idCliente'], 'RESTRICT', 'RESTRICT'],
      ['cobroFiado', 'fk_cobroFiado_administrador', ['idTienda', 'idAdministrador'], 'administrador', ['idTienda', 'idAdministrador'], 'RESTRICT', 'RESTRICT'],
      ['pagoFiado', 'fk_pagoFiado_cobro', ['idTienda', 'idCobroFiado'], 'cobroFiado', ['idTienda', 'idCobroFiado'], 'RESTRICT', 'RESTRICT'],
      ['seguimientoCobranza', 'fk_seguimientoCobranza_tienda', ['idTienda'], 'tienda', ['idTienda'], 'RESTRICT', 'RESTRICT'],
      ['seguimientoCobranza', 'fk_seguimientoCobranza_cliente', ['idTienda', 'idCliente'], 'cliente', ['idTienda', 'idCliente'], 'RESTRICT', 'RESTRICT'],
      ['seguimientoCobranza', 'fk_seguimientoCobranza_fiado', ['idTienda', 'idCliente', 'idFiado'], 'fiado', ['idTienda', 'idCliente', 'idFiado'], 'RESTRICT', 'RESTRICT'],
      ['seguimientoCobranza', 'fk_seguimientoCobranza_administrador', ['idTienda', 'idAdministrador'], 'administrador', ['idTienda', 'idAdministrador'], 'RESTRICT', 'RESTRICT'],
      ['plantillaCobranzaTienda', 'fk_plantillaCobranza_tienda', ['idTienda'], 'tienda', ['idTienda'], 'RESTRICT', 'RESTRICT'],
      ['plantillaCobranzaTienda', 'fk_plantillaCobranza_administrador', ['idTienda', 'idAdministradorActualiza'], 'administrador', ['idTienda', 'idAdministrador'], 'RESTRICT', 'RESTRICT']
    ]
  },
  '013_seguridad_sesiones.sql': {
    columns: {
      administrador: ['versionSesion']
    },
    columnTypes: {
      administrador: { versionSesion: 'int' }
    },
    checks: [
      ['administrador', 'chk_administrador_version_sesion']
    ]
  },
  '014_operaciones_compensatorias.sql': {
    columns: {
      venta: ['estadoOperacion'],
      operacionCompensatoria: [
        'idOperacionCompensatoria', 'idTienda', 'tipoOperacion', 'estado',
        'motivoCodigo', 'observacion', 'requiereAprobacion',
        'idAdministradorSolicitante', 'idAdministradorAprobador',
        'claveOperacion', 'huellaSolicitud', 'fechaSolicitud',
        'fechaAprobacion', 'fechaAplicacion', 'creadoEn', 'actualizadoEn'
      ]
    },
    indexes: [
      ['venta', 'idx_venta_tienda_estado_operacion_fecha', ['idTienda', 'estadoOperacion', 'fecha', 'idVenta'], false],
      ['operacionCompensatoria', 'PRIMARY', ['idOperacionCompensatoria'], true],
      ['operacionCompensatoria', 'uq_operacionCompensatoria_tienda_id', ['idTienda', 'idOperacionCompensatoria'], true],
      ['operacionCompensatoria', 'uq_operacionCompensatoria_tienda_clave', ['idTienda', 'claveOperacion'], true],
      ['operacionCompensatoria', 'idx_operacionCompensatoria_tienda_tipo_estado', ['idTienda', 'tipoOperacion', 'estado'], false],
      ['operacionCompensatoria', 'idx_operacionCompensatoria_tienda_fecha', ['idTienda', 'fechaSolicitud', 'idOperacionCompensatoria'], false],
      ['operacionCompensatoria', 'idx_operacionCompensatoria_tienda_solicitante', ['idTienda', 'idAdministradorSolicitante', 'fechaSolicitud'], false],
      ['operacionCompensatoria', 'idx_operacionCompensatoria_tienda_aprobador', ['idTienda', 'idAdministradorAprobador', 'fechaAprobacion'], false]
    ],
    checks: [
      ['venta', 'chk_venta_estado_operacion'],
      ['operacionCompensatoria', 'chk_operacionCompensatoria_aprobacion'],
      ['operacionCompensatoria', 'chk_operacionCompensatoria_clave'],
      ['operacionCompensatoria', 'chk_operacionCompensatoria_huella'],
      ['operacionCompensatoria', 'chk_operacionCompensatoria_motivo'],
      ['operacionCompensatoria', 'chk_operacionCompensatoria_fechas']
    ],
    foreignKeyConstraints: [
      ['operacionCompensatoria', 'fk_operacionCompensatoria_tienda', ['idTienda'], 'tienda', ['idTienda'], 'RESTRICT', 'RESTRICT'],
      ['operacionCompensatoria', 'fk_operacionCompensatoria_solicitante', ['idTienda', 'idAdministradorSolicitante'], 'administrador', ['idTienda', 'idAdministrador'], 'RESTRICT', 'RESTRICT'],
      ['operacionCompensatoria', 'fk_operacionCompensatoria_aprobador', ['idTienda', 'idAdministradorAprobador'], 'administrador', ['idTienda', 'idAdministrador'], 'RESTRICT', 'RESTRICT']
    ]
  },
  '015_compensaciones_venta_inventario.sql': {
    columns: {
      compensacionVenta: [
        'idCompensacionVenta', 'idTienda', 'idOperacionCompensatoria', 'idVenta',
        'tipoCompensacion', 'montoCompensado', 'costoCompensado', 'creadoEn'
      ],
      liquidacionCompensacionVenta: [
        'idLiquidacionCompensacionVenta', 'idTienda', 'idCompensacionVenta',
        'montoCompensado', 'montoReduccionDeudaPendiente',
        'montoReembolsoPendiente', 'estado', 'creadoEn', 'resueltoEn'
      ],
      detalleCompensacionVenta: [
        'idDetalleCompensacionVenta', 'idTienda', 'idCompensacionVenta',
        'idDetalleVenta', 'idProducto', 'unidadesDevueltas', 'montoCompensado',
        'costoCompensado', 'tratamientoInventario', 'resultadoInventario',
        'idMovimientoStock', 'creadoEn'
      ],
      detalleCompensacionLote: [
        'idDetalleCompensacionLote', 'idTienda', 'idProducto',
        'idDetalleCompensacionVenta', 'idMovimientoLoteSalida',
        'idLoteProductoOrigen', 'idLoteProductoDestino',
        'idMovimientoLoteCompensatorio', 'unidadesDevueltas',
        'resultadoInventario', 'costoUnitarioHistorico',
        'fechaVencimientoHistorica', 'creadoEn'
      ]
    },
    indexes: [
      ['compensacionVenta', 'uq_compensacionVenta_tienda_id', ['idTienda', 'idCompensacionVenta'], true],
      ['compensacionVenta', 'uq_compensacionVenta_tienda_operacion', ['idTienda', 'idOperacionCompensatoria'], true],
      ['compensacionVenta', 'idx_compensacionVenta_tienda_venta', ['idTienda', 'idVenta', 'idCompensacionVenta'], false],
      ['liquidacionCompensacionVenta', 'uq_liquidacionCompensacion_tienda_compensacion', ['idTienda', 'idCompensacionVenta'], true],
      ['detalleCompensacionVenta', 'uq_detalleCompensacionVenta_tienda_id', ['idTienda', 'idProducto', 'idDetalleCompensacionVenta'], true],
      ['detalleCompensacionVenta', 'uq_detalleCompensacionVenta_tienda_detalle', ['idTienda', 'idCompensacionVenta', 'idDetalleVenta'], true],
      ['movimientoLote', 'uq_movimientoLote_tienda_producto_id', ['idTienda', 'idProducto', 'idMovimientoLote'], true],
      ['detalleCompensacionLote', 'uq_detalleCompensacionLote_tienda_id', ['idTienda', 'idProducto', 'idDetalleCompensacionLote'], true],
      ['detalleCompensacionLote', 'uq_detalleCompensacionLote_tienda_fuente', ['idTienda', 'idDetalleCompensacionVenta', 'idMovimientoLoteSalida'], true]
    ],
    checks: [
      ['compensacionVenta', 'chk_compensacionVenta_montos'],
      ['liquidacionCompensacionVenta', 'chk_liquidacionCompensacion_montos'],
      ['liquidacionCompensacionVenta', 'chk_liquidacionCompensacion_estado'],
      ['detalleCompensacionVenta', 'chk_detalleCompensacionVenta_valores'],
      ['detalleCompensacionVenta', 'chk_detalleCompensacionVenta_movimiento'],
      ['detalleCompensacionLote', 'chk_detalleCompensacionLote_unidades'],
      ['detalleCompensacionLote', 'chk_detalleCompensacionLote_destino']
    ],
    foreignKeyConstraints: [
      ['compensacionVenta', 'fk_compensacionVenta_operacion', ['idTienda', 'idOperacionCompensatoria'], 'operacionCompensatoria', ['idTienda', 'idOperacionCompensatoria'], 'RESTRICT', 'RESTRICT'],
      ['compensacionVenta', 'fk_compensacionVenta_venta', ['idTienda', 'idVenta'], 'venta', ['idTienda', 'idVenta'], 'RESTRICT', 'RESTRICT'],
      ['liquidacionCompensacionVenta', 'fk_liquidacionCompensacion_compensacion', ['idTienda', 'idCompensacionVenta'], 'compensacionVenta', ['idTienda', 'idCompensacionVenta'], 'RESTRICT', 'RESTRICT'],
      ['detalleCompensacionVenta', 'fk_detalleCompensacionVenta_compensacion', ['idTienda', 'idCompensacionVenta'], 'compensacionVenta', ['idTienda', 'idCompensacionVenta'], 'RESTRICT', 'RESTRICT'],
      ['detalleCompensacionVenta', 'fk_detalleCompensacionVenta_detalle', ['idTienda', 'idDetalleVenta'], 'detalleVenta', ['idTienda', 'idDetalleVenta'], 'RESTRICT', 'RESTRICT'],
      ['detalleCompensacionVenta', 'fk_detalleCompensacionVenta_producto', ['idTienda', 'idProducto'], 'producto', ['idTienda', 'idProducto'], 'RESTRICT', 'RESTRICT'],
      ['detalleCompensacionVenta', 'fk_detalleCompensacionVenta_movimiento', ['idTienda', 'idProducto', 'idMovimientoStock'], 'movimientoStock', ['idTienda', 'idProducto', 'idMovimientoStock'], 'RESTRICT', 'RESTRICT'],
      ['detalleCompensacionLote', 'fk_detalleCompensacionLote_detalle', ['idTienda', 'idProducto', 'idDetalleCompensacionVenta'], 'detalleCompensacionVenta', ['idTienda', 'idProducto', 'idDetalleCompensacionVenta'], 'RESTRICT', 'RESTRICT'],
      ['detalleCompensacionLote', 'fk_detalleCompensacionLote_salida', ['idTienda', 'idProducto', 'idMovimientoLoteSalida'], 'movimientoLote', ['idTienda', 'idProducto', 'idMovimientoLote'], 'RESTRICT', 'RESTRICT'],
      ['detalleCompensacionLote', 'fk_detalleCompensacionLote_lote_origen', ['idTienda', 'idProducto', 'idLoteProductoOrigen'], 'loteProducto', ['idTienda', 'idProducto', 'idLoteProducto'], 'RESTRICT', 'RESTRICT'],
      ['detalleCompensacionLote', 'fk_detalleCompensacionLote_lote_destino', ['idTienda', 'idProducto', 'idLoteProductoDestino'], 'loteProducto', ['idTienda', 'idProducto', 'idLoteProducto'], 'RESTRICT', 'RESTRICT'],
      ['detalleCompensacionLote', 'fk_detalleCompensacionLote_movimiento', ['idTienda', 'idProducto', 'idMovimientoLoteCompensatorio'], 'movimientoLote', ['idTienda', 'idProducto', 'idMovimientoLote'], 'RESTRICT', 'RESTRICT']
    ]
  },
  '016_compensaciones_financieras.sql': {
    columns: {
      venta: ['montoCompensado'],
      fiado: ['totalCompensado'],
      cobroFiado: ['estadoOperacion'],
      resolucionLiquidacionVenta: [
        'idResolucionLiquidacionVenta', 'idTienda', 'idOperacionCompensatoria',
        'idLiquidacionCompensacionVenta', 'idFiado', 'montoReduccionDeuda',
        'montoReembolso', 'periodoOriginalCerrado', 'creadoEn', 'idAdministrador'
      ],
      obligacionReembolsoVenta: [
        'idObligacionReembolsoVenta', 'idTienda', 'idResolucionLiquidacionVenta',
        'idVenta', 'monto', 'estado', 'creadoEn', 'resueltoEn',
        'idAdministradorResuelve'
      ],
      detalleObligacionReembolsoPago: [
        'idDetalleObligacionReembolsoPago', 'idTienda',
        'idObligacionReembolsoVenta', 'idPagoVenta', 'metodoOriginal',
        'monto', 'creadoEn'
      ],
      compensacionCobroFiado: [
        'idCompensacionCobroFiado', 'idTienda', 'idOperacionCompensatoria',
        'idCobroFiado', 'tipoCompensacion', 'montoCompensado',
        'metodoOriginal', 'metodoDestino', 'montoRecibidoDestino',
        'cambioDestino', 'referenciaDestino', 'periodoOriginalCerrado', 'creadoEn'
      ],
      detalleCompensacionCobro: [
        'idDetalleCompensacionCobro', 'idTienda', 'idCompensacionCobroFiado',
        'idPagoFiado', 'idPagoVenta', 'idFiado', 'montoCompensado', 'creadoEn'
      ],
      compensacionPagoVenta: [
        'idCompensacionPagoVenta', 'idTienda', 'idOperacionCompensatoria',
        'idPagoVenta', 'idVenta', 'monto', 'metodoOriginal', 'metodoDestino',
        'montoRecibidoDestino', 'cambioDestino', 'referenciaDestino',
        'periodoOriginalCerrado', 'creadoEn'
      ]
    },
    indexes: [
      ['pagoVenta', 'uq_pagoVenta_tienda_id', ['idTienda', 'idPagoVenta'], true],
      ['resolucionLiquidacionVenta', 'uq_resolucionLiquidacion_tienda_operacion', ['idTienda', 'idOperacionCompensatoria'], true],
      ['resolucionLiquidacionVenta', 'uq_resolucionLiquidacion_tienda_liquidacion', ['idTienda', 'idLiquidacionCompensacionVenta'], true],
      ['obligacionReembolsoVenta', 'uq_obligacionReembolso_tienda_resolucion', ['idTienda', 'idResolucionLiquidacionVenta'], true],
      ['detalleObligacionReembolsoPago', 'uq_detalleReembolso_tienda_pago', ['idTienda', 'idObligacionReembolsoVenta', 'idPagoVenta'], true],
      ['compensacionCobroFiado', 'uq_compensacionCobro_tienda_operacion', ['idTienda', 'idOperacionCompensatoria'], true],
      ['compensacionCobroFiado', 'uq_compensacionCobro_tienda_tipo', ['idTienda', 'idCobroFiado', 'tipoCompensacion'], true],
      ['detalleCompensacionCobro', 'uq_detalleCompensacionCobro_tienda_pago_fiado', ['idTienda', 'idPagoFiado'], true],
      ['compensacionPagoVenta', 'uq_compensacionPago_tienda_operacion', ['idTienda', 'idOperacionCompensatoria'], true],
      ['compensacionPagoVenta', 'uq_compensacionPago_tienda_pago', ['idTienda', 'idPagoVenta'], true]
    ],
    checks: [
      ['venta', 'chk_venta_saldo_pos'],
      ['venta', 'chk_venta_estado_pos'],
      ['venta', 'chk_venta_monto_compensado'],
      ['fiado', 'chk_fiado_compensacion_financiera'],
      ['cobroFiado', 'chk_cobroFiado_estado_operacion'],
      ['resolucionLiquidacionVenta', 'chk_resolucionLiquidacion_montos'],
      ['resolucionLiquidacionVenta', 'chk_resolucionLiquidacion_periodo'],
      ['obligacionReembolsoVenta', 'chk_obligacionReembolso_monto'],
      ['obligacionReembolsoVenta', 'chk_obligacionReembolso_estado'],
      ['detalleObligacionReembolsoPago', 'chk_detalleReembolso_monto'],
      ['compensacionCobroFiado', 'chk_compensacionCobro_monto'],
      ['compensacionCobroFiado', 'chk_compensacionCobro_metodo'],
      ['compensacionCobroFiado', 'chk_compensacionCobro_periodo'],
      ['detalleCompensacionCobro', 'chk_detalleCompensacionCobro_monto'],
      ['compensacionPagoVenta', 'chk_compensacionPago_monto'],
      ['compensacionPagoVenta', 'chk_compensacionPago_metodo'],
      ['compensacionPagoVenta', 'chk_compensacionPago_periodo']
    ],
    foreignKeyConstraints: [
      ['resolucionLiquidacionVenta', 'fk_resolucionLiquidacion_operacion', ['idTienda', 'idOperacionCompensatoria'], 'operacionCompensatoria', ['idTienda', 'idOperacionCompensatoria'], 'RESTRICT', 'RESTRICT'],
      ['resolucionLiquidacionVenta', 'fk_resolucionLiquidacion_liquidacion', ['idTienda', 'idLiquidacionCompensacionVenta'], 'liquidacionCompensacionVenta', ['idTienda', 'idLiquidacionCompensacionVenta'], 'RESTRICT', 'RESTRICT'],
      ['resolucionLiquidacionVenta', 'fk_resolucionLiquidacion_fiado', ['idTienda', 'idFiado'], 'fiado', ['idTienda', 'idFiado'], 'RESTRICT', 'RESTRICT'],
      ['resolucionLiquidacionVenta', 'fk_resolucionLiquidacion_administrador', ['idTienda', 'idAdministrador'], 'administrador', ['idTienda', 'idAdministrador'], 'RESTRICT', 'RESTRICT'],
      ['obligacionReembolsoVenta', 'fk_obligacionReembolso_resolucion', ['idTienda', 'idResolucionLiquidacionVenta'], 'resolucionLiquidacionVenta', ['idTienda', 'idResolucionLiquidacionVenta'], 'RESTRICT', 'RESTRICT'],
      ['obligacionReembolsoVenta', 'fk_obligacionReembolso_venta', ['idTienda', 'idVenta'], 'venta', ['idTienda', 'idVenta'], 'RESTRICT', 'RESTRICT'],
      ['obligacionReembolsoVenta', 'fk_obligacionReembolso_administrador', ['idTienda', 'idAdministradorResuelve'], 'administrador', ['idTienda', 'idAdministrador'], 'RESTRICT', 'RESTRICT'],
      ['detalleObligacionReembolsoPago', 'fk_detalleReembolso_obligacion', ['idTienda', 'idObligacionReembolsoVenta'], 'obligacionReembolsoVenta', ['idTienda', 'idObligacionReembolsoVenta'], 'RESTRICT', 'RESTRICT'],
      ['detalleObligacionReembolsoPago', 'fk_detalleReembolso_pago', ['idTienda', 'idPagoVenta'], 'pagoVenta', ['idTienda', 'idPagoVenta'], 'RESTRICT', 'RESTRICT'],
      ['compensacionCobroFiado', 'fk_compensacionCobro_operacion', ['idTienda', 'idOperacionCompensatoria'], 'operacionCompensatoria', ['idTienda', 'idOperacionCompensatoria'], 'RESTRICT', 'RESTRICT'],
      ['compensacionCobroFiado', 'fk_compensacionCobro_cobro', ['idTienda', 'idCobroFiado'], 'cobroFiado', ['idTienda', 'idCobroFiado'], 'RESTRICT', 'RESTRICT'],
      ['detalleCompensacionCobro', 'fk_detalleCompensacionCobro_compensacion', ['idTienda', 'idCompensacionCobroFiado'], 'compensacionCobroFiado', ['idTienda', 'idCompensacionCobroFiado'], 'RESTRICT', 'RESTRICT'],
      ['detalleCompensacionCobro', 'fk_detalleCompensacionCobro_pago_fiado', ['idTienda', 'idPagoFiado'], 'pagoFiado', ['idTienda', 'idPagoFiado'], 'RESTRICT', 'RESTRICT'],
      ['detalleCompensacionCobro', 'fk_detalleCompensacionCobro_pago_venta', ['idTienda', 'idPagoVenta'], 'pagoVenta', ['idTienda', 'idPagoVenta'], 'RESTRICT', 'RESTRICT'],
      ['detalleCompensacionCobro', 'fk_detalleCompensacionCobro_fiado', ['idTienda', 'idFiado'], 'fiado', ['idTienda', 'idFiado'], 'RESTRICT', 'RESTRICT'],
      ['compensacionPagoVenta', 'fk_compensacionPago_operacion', ['idTienda', 'idOperacionCompensatoria'], 'operacionCompensatoria', ['idTienda', 'idOperacionCompensatoria'], 'RESTRICT', 'RESTRICT'],
      ['compensacionPagoVenta', 'fk_compensacionPago_pago', ['idTienda', 'idPagoVenta'], 'pagoVenta', ['idTienda', 'idPagoVenta'], 'RESTRICT', 'RESTRICT'],
      ['compensacionPagoVenta', 'fk_compensacionPago_venta', ['idTienda', 'idVenta'], 'venta', ['idTienda', 'idVenta'], 'RESTRICT', 'RESTRICT']
    ]
  },
  '017_integracion_compensaciones.sql': {
    columns: {
      movimientoLiquidacionCompensacion: [
        'idMovimientoLiquidacionCompensacion', 'idTienda',
        'idOperacionCompensatoria', 'idObligacionReembolsoVenta',
        'tipoLiquidacion', 'metodoLiquidacion', 'monto', 'referencia',
        'observacion', 'periodoOriginalCerrado', 'fechaMovimiento',
        'idAdministrador'
      ],
      cierreCaja: [
        'compensacionesEfectivo', 'reembolsosEfectivo',
        'compensacionesCobroTotal', 'reembolsosTotal',
        'compensacionesVenta', 'liquidacionesOtroMedio'
      ]
    },
    indexes: [
      ['movimientoLiquidacionCompensacion',
        'uq_movimientoLiquidacion_tienda_operacion',
        ['idTienda', 'idOperacionCompensatoria'], true],
      ['movimientoLiquidacionCompensacion',
        'idx_movimientoLiquidacion_tienda_obligacion',
        ['idTienda', 'idObligacionReembolsoVenta', 'fechaMovimiento',
          'idMovimientoLiquidacionCompensacion'], false],
      ['movimientoLiquidacionCompensacion',
        'idx_movimientoLiquidacion_tienda_fecha_metodo',
        ['idTienda', 'fechaMovimiento', 'metodoLiquidacion',
          'idMovimientoLiquidacionCompensacion'], false]
    ],
    checks: [
      ['movimientoLiquidacionCompensacion', 'chk_movimientoLiquidacion_monto'],
      ['movimientoLiquidacionCompensacion', 'chk_movimientoLiquidacion_periodo'],
      ['movimientoLiquidacionCompensacion', 'chk_movimientoLiquidacion_referencia'],
      ['cierreCaja', 'chk_cierreCaja_compensaciones']
    ],
    foreignKeyConstraints: [
      ['movimientoLiquidacionCompensacion',
        'fk_movimientoLiquidacion_operacion',
        ['idTienda', 'idOperacionCompensatoria'],
        'operacionCompensatoria', ['idTienda', 'idOperacionCompensatoria'],
        'RESTRICT', 'RESTRICT'],
      ['movimientoLiquidacionCompensacion',
        'fk_movimientoLiquidacion_obligacion',
        ['idTienda', 'idObligacionReembolsoVenta'],
        'obligacionReembolsoVenta', ['idTienda', 'idObligacionReembolsoVenta'],
        'RESTRICT', 'RESTRICT'],
      ['movimientoLiquidacionCompensacion',
        'fk_movimientoLiquidacion_administrador',
        ['idTienda', 'idAdministrador'],
        'administrador', ['idTienda', 'idAdministrador'],
        'RESTRICT', 'RESTRICT']
    ]
  },
  '018_auditoria_administrativa_critica.sql': {
    columns: {
      eventoAuditoriaAdministrativa: [
        'idEventoAuditoria', 'idTienda', 'actorTipo', 'idAdministradorActor',
        'categoria', 'accion', 'resultado', 'codigoResultado', 'origen',
        'entidadTipo', 'referenciaSegura', 'requestId', 'datosAnteriores',
        'datosPosteriores', 'metadatos', 'creadoEn'
      ]
    },
    indexes: [
      ['eventoAuditoriaAdministrativa',
        'uq_eventoAuditoria_request_accion_resultado',
        ['requestId', 'accion', 'resultado'], true],
      ['eventoAuditoriaAdministrativa',
        'idx_eventoAuditoria_tienda_fecha',
        ['idTienda', 'creadoEn', 'idEventoAuditoria'], false],
      ['eventoAuditoriaAdministrativa',
        'idx_eventoAuditoria_actor_fecha',
        ['idAdministradorActor', 'creadoEn', 'idEventoAuditoria'], false],
      ['eventoAuditoriaAdministrativa',
        'idx_eventoAuditoria_categoria_accion_fecha',
        ['categoria', 'accion', 'creadoEn', 'idEventoAuditoria'], false],
      ['eventoAuditoriaAdministrativa',
        'idx_eventoAuditoria_resultado_fecha',
        ['resultado', 'creadoEn', 'idEventoAuditoria'], false]
    ],
    checks: [
      ['eventoAuditoriaAdministrativa', 'chk_eventoAuditoria_actor'],
      ['eventoAuditoriaAdministrativa', 'chk_eventoAuditoria_categoria_accion'],
      ['eventoAuditoriaAdministrativa', 'chk_eventoAuditoria_codigo'],
      ['eventoAuditoriaAdministrativa', 'chk_eventoAuditoria_referencia'],
      ['eventoAuditoriaAdministrativa', 'chk_eventoAuditoria_request']
    ],
    foreignKeyConstraints: [
      ['eventoAuditoriaAdministrativa', 'fk_eventoAuditoria_tienda',
        ['idTienda'], 'tienda', ['idTienda'], 'RESTRICT', 'RESTRICT'],
      ['eventoAuditoriaAdministrativa', 'fk_eventoAuditoria_actor',
        ['idAdministradorActor'], 'administrador', ['idAdministrador'],
        'RESTRICT', 'RESTRICT']
    ]
  },
  '019_stock_vendible_ajustes.sql': {
    columns: {
      loteProducto: ['clasificacionInventario'],
      ajusteInventario: [
        'idAjusteInventario', 'idTienda', 'idProducto', 'idMovimientoStock',
        'idLoteProducto', 'tipoAjuste', 'cantidad', 'motivoCodigo',
        'observacion', 'modoLotes', 'clasificacionInventario',
        'stockFisicoAnterior', 'stockFisicoPosterior', 'stockVendibleAnterior',
        'stockVendiblePosterior', 'claveOperacion', 'huellaSolicitud',
        'idAdministrador', 'creadoEn'
      ]
    },
    indexes: [
      ['loteProducto', 'idx_lote_tienda_clasificacion_vencimiento',
        ['idTienda', 'clasificacionInventario', 'fechaVencimiento'], false],
      ['ajusteInventario', 'uq_ajusteInventario_tienda_id',
        ['idTienda', 'idAjusteInventario'], true],
      ['ajusteInventario', 'uq_ajusteInventario_tienda_clave',
        ['idTienda', 'claveOperacion'], true],
      ['ajusteInventario', 'uq_ajusteInventario_tienda_movimiento',
        ['idTienda', 'idProducto', 'idMovimientoStock'], true],
      ['ajusteInventario', 'idx_ajusteInventario_tienda_fecha',
        ['idTienda', 'creadoEn', 'idAjusteInventario'], false],
      ['ajusteInventario', 'idx_ajusteInventario_tienda_producto_fecha',
        ['idTienda', 'idProducto', 'creadoEn', 'idAjusteInventario'], false],
      ['ajusteInventario', 'idx_ajusteInventario_tienda_lote',
        ['idTienda', 'idProducto', 'idLoteProducto'], false]
    ],
    checks: [
      ['loteProducto', 'chk_lote_clasificacion_operativa'],
      ['loteProducto', 'chk_lote_tecnico_reversion'],
      ['ajusteInventario', 'chk_ajusteInventario_cantidad'],
      ['ajusteInventario', 'chk_ajusteInventario_stock'],
      ['ajusteInventario', 'chk_ajusteInventario_otro'],
      ['ajusteInventario', 'chk_ajusteInventario_lotes'],
      ['ajusteInventario', 'chk_ajusteInventario_clave']
    ],
    foreignKeyConstraints: [
      ['ajusteInventario', 'fk_ajusteInventario_tienda',
        ['idTienda'], 'tienda', ['idTienda'], 'RESTRICT', 'RESTRICT'],
      ['ajusteInventario', 'fk_ajusteInventario_producto',
        ['idTienda', 'idProducto'], 'producto', ['idTienda', 'idProducto'],
        'RESTRICT', 'RESTRICT'],
      ['ajusteInventario', 'fk_ajusteInventario_movimiento',
        ['idTienda', 'idProducto', 'idMovimientoStock'],
        'movimientoStock', ['idTienda', 'idProducto', 'idMovimientoStock'],
        'RESTRICT', 'RESTRICT'],
      ['ajusteInventario', 'fk_ajusteInventario_lote',
        ['idTienda', 'idProducto', 'idLoteProducto'],
        'loteProducto', ['idTienda', 'idProducto', 'idLoteProducto'],
        'RESTRICT', 'RESTRICT'],
      ['ajusteInventario', 'fk_ajusteInventario_administrador',
        ['idTienda', 'idAdministrador'],
        'administrador', ['idTienda', 'idAdministrador'],
        'RESTRICT', 'RESTRICT']
    ]
  },
  '020_registro_publico_onboarding.sql': {
    columns: {
      administrador: ['correoNormalizado', 'correoVerificadoEn', 'estadoAcceso'],
      tienda: ['estadoOnboarding', 'onboardingCompletadoEn'],
      tokenAccesoAdministrador: ['idTokenAcceso', 'idAdministrador', 'tipo', 'tokenHash', 'expiraEn', 'usadoEn', 'invalidadoEn', 'creadoEn'],
      solicitudRegistroPublico: ['idSolicitudRegistro', 'claveHash', 'huellaSolicitud', 'estado', 'idTienda', 'idAdministrador', 'completadaEn', 'creadoEn', 'actualizadoEn']
    },
    indexes: [
      ['administrador', 'uq_administrador_correo_normalizado', ['correoNormalizado'], true],
      ['administrador', 'idx_administrador_estado_acceso', ['estadoAcceso', 'activo'], false],
      ['tienda', 'idx_tienda_onboarding', ['estadoOnboarding', 'activo'], false],
      ['tokenAccesoAdministrador', 'uq_tokenAcceso_hash', ['tokenHash'], true],
      ['tokenAccesoAdministrador', 'idx_tokenAcceso_administrador_tipo_estado', ['idAdministrador', 'tipo', 'usadoEn', 'invalidadoEn', 'expiraEn'], false],
      ['solicitudRegistroPublico', 'uq_solicitudRegistro_clave_hash', ['claveHash'], true],
      ['solicitudRegistroPublico', 'idx_solicitudRegistro_estado_fecha', ['estado', 'actualizadoEn'], false],
      ['solicitudRegistroPublico', 'idx_solicitudRegistro_tienda', ['idTienda'], false],
      ['solicitudRegistroPublico', 'idx_solicitudRegistro_administrador', ['idAdministrador'], false]
    ],
    checks: [
      ['tokenAccesoAdministrador', 'chk_tokenAcceso_hash'],
      ['tokenAccesoAdministrador', 'chk_tokenAcceso_fechas'],
      ['solicitudRegistroPublico', 'chk_solicitudRegistro_hashes'],
      ['solicitudRegistroPublico', 'chk_solicitudRegistro_resultado']
    ],
    foreignKeyConstraints: [
      ['tokenAccesoAdministrador', 'fk_tokenAcceso_administrador', ['idAdministrador'], 'administrador', ['idAdministrador'], 'RESTRICT', 'RESTRICT'],
      ['solicitudRegistroPublico', 'fk_solicitudRegistro_tienda', ['idTienda'], 'tienda', ['idTienda'], 'RESTRICT', 'RESTRICT'],
      ['solicitudRegistroPublico', 'fk_solicitudRegistro_administrador', ['idAdministrador'], 'administrador', ['idAdministrador'], 'RESTRICT', 'RESTRICT']
    ]
  },
  '021_configuracion_base_tienda.sql': {
    columns: {
      configuracionTienda: [
        'idConfiguracionTienda', 'idTienda', 'nombreMostrado', 'moneda',
        'zonaHoraria', 'telefono', 'direccion', 'datoFiscalBasico',
        'creadoEn', 'actualizadoEn'
      ]
    },
    columnTypes: {
      configuracionTienda: {
        idConfiguracionTienda: 'bigint',
        idTienda: 'int',
        nombreMostrado: 'varchar',
        moneda: 'char',
        zonaHoraria: 'varchar',
        telefono: 'varchar',
        direccion: 'varchar',
        datoFiscalBasico: 'varchar',
        creadoEn: 'datetime',
        actualizadoEn: 'datetime'
      }
    },
    indexes: [
      ['configuracionTienda', 'PRIMARY', ['idConfiguracionTienda'], true],
      ['configuracionTienda', 'uq_configuracionTienda_tienda', ['idTienda'], true]
    ],
    checks: [
      ['configuracionTienda', 'chk_configuracionTienda_nombre'],
      ['configuracionTienda', 'chk_configuracionTienda_moneda'],
      ['configuracionTienda', 'chk_configuracionTienda_zona'],
      ['configuracionTienda', 'chk_configuracionTienda_opcionales']
    ],
    foreignKeyConstraints: [
      ['configuracionTienda', 'fk_configuracionTienda_tienda',
        ['idTienda'], 'tienda', ['idTienda'], 'RESTRICT', 'RESTRICT']
    ]
  },
  '022_ciclo_vida_suscripciones.sql': {
    columns: {
      suscripcionTienda: [
        'fechaFinGracia', 'suspendidaEn', 'reactivadaEn', 'canceladaEn',
        'motivoTransicion', 'idPlanSiguiente', 'fechaAplicacionPlanSiguiente',
        'planCodigoSnapshot', 'planNombreSnapshot', 'tipoPeriodoSnapshot',
        'duracionDiasSnapshot', 'precioReferenciaSnapshot',
        'limitePropietariosSnapshot', 'limiteProductosSnapshot',
        'limiteClientesSnapshot', 'limiteProveedoresSnapshot'
      ],
      suscripcionFuncionalidadSnapshot: [
        'idTienda', 'idSuscripcion', 'codigoFuncionalidad',
        'nombreFuncionalidad', 'creadoEn'
      ],
      historialSuscripcionTienda: [
        'idHistorialSuscripcion', 'idTienda', 'idSuscripcion',
        'estadoAnterior', 'estadoNuevo', 'tipoOperacion', 'motivo',
        'actorTipo', 'idAdministradorActor', 'metadatos', 'creadoEn'
      ],
      operacionSuscripcionTienda: [
        'idOperacionSuscripcion', 'idTienda', 'tipoOperacion', 'claveHash',
        'huellaSolicitud', 'estado', 'idSuscripcionResultado',
        'idHistorialResultado', 'codigoResultado', 'completadaEn',
        'fallidaEn', 'expiraEn', 'creadoEn', 'actualizadoEn'
      ]
    },
    indexes: [
      ['suscripcionTienda', 'uq_suscripcion_tienda_id',
        ['idTienda', 'idSuscripcion'], true],
      ['suscripcionTienda', 'idx_suscripcion_tienda_gracia',
        ['idTienda', 'estado', 'fechaFin', 'fechaFinGracia'], false],
      ['suscripcionTienda', 'idx_suscripcion_plan_siguiente',
        ['idPlanSiguiente', 'fechaAplicacionPlanSiguiente'], false],
      ['suscripcionFuncionalidadSnapshot', 'PRIMARY',
        ['idTienda', 'idSuscripcion', 'codigoFuncionalidad'], true],
      ['suscripcionFuncionalidadSnapshot', 'idx_suscripcionFuncionalidad_codigo',
        ['codigoFuncionalidad'], false],
      ['historialSuscripcionTienda', 'idx_historialSuscripcion_tienda_fecha',
        ['idTienda', 'creadoEn', 'idHistorialSuscripcion'], false],
      ['historialSuscripcionTienda', 'idx_historialSuscripcion_suscripcion_fecha',
        ['idTienda', 'idSuscripcion', 'creadoEn', 'idHistorialSuscripcion'], false],
      ['historialSuscripcionTienda', 'idx_historialSuscripcion_actor_fecha',
        ['idAdministradorActor', 'creadoEn', 'idHistorialSuscripcion'], false],
      ['operacionSuscripcionTienda', 'uq_operacionSuscripcion_clave',
        ['idTienda', 'tipoOperacion', 'claveHash'], true],
      ['operacionSuscripcionTienda', 'idx_operacionSuscripcion_estado_expira',
        ['estado', 'expiraEn', 'idOperacionSuscripcion'], false],
      ['operacionSuscripcionTienda', 'idx_operacionSuscripcion_resultado',
        ['idTienda', 'idSuscripcionResultado'], false]
    ],
    checks: [
      ['suscripcionTienda', 'chk_suscripcion_fechas_ciclo'],
      ['suscripcionTienda', 'chk_suscripcion_plan_siguiente'],
      ['suscripcionTienda', 'chk_suscripcion_snapshot'],
      ['suscripcionFuncionalidadSnapshot', 'chk_suscripcionFuncionalidad_codigo'],
      ['historialSuscripcionTienda', 'chk_historialSuscripcion_actor'],
      ['operacionSuscripcionTienda', 'chk_operacionSuscripcion_hashes'],
      ['operacionSuscripcionTienda', 'chk_operacionSuscripcion_fechas']
    ],
    foreignKeyConstraints: [
      ['suscripcionTienda', 'fk_suscripcion_plan_siguiente',
        ['idPlanSiguiente'], 'plan', ['idPlan'], 'RESTRICT', 'RESTRICT'],
      ['suscripcionFuncionalidadSnapshot', 'fk_suscripcionFuncionalidad_suscripcion',
        ['idTienda', 'idSuscripcion'], 'suscripcionTienda',
        ['idTienda', 'idSuscripcion'], 'RESTRICT', 'RESTRICT'],
      ['historialSuscripcionTienda', 'fk_historialSuscripcion_suscripcion',
        ['idTienda', 'idSuscripcion'], 'suscripcionTienda',
        ['idTienda', 'idSuscripcion'], 'RESTRICT', 'RESTRICT'],
      ['historialSuscripcionTienda', 'fk_historialSuscripcion_actor',
        ['idAdministradorActor'], 'administrador', ['idAdministrador'],
        'RESTRICT', 'RESTRICT'],
      ['operacionSuscripcionTienda', 'fk_operacionSuscripcion_tienda',
        ['idTienda'], 'tienda', ['idTienda'], 'RESTRICT', 'RESTRICT'],
      ['operacionSuscripcionTienda', 'fk_operacionSuscripcion_resultado',
        ['idTienda', 'idSuscripcionResultado'], 'suscripcionTienda',
        ['idTienda', 'idSuscripcion'], 'RESTRICT', 'RESTRICT'],
      ['operacionSuscripcionTienda', 'fk_operacionSuscripcion_historial',
        ['idHistorialResultado'], 'historialSuscripcionTienda',
        ['idHistorialSuscripcion'], 'RESTRICT', 'RESTRICT']
    ]
  },
  '023_estructura_pagos_suscripcion.sql': {
    columns: {
      plan: ['visiblePublicamente', 'esLegado', 'ordenComercial'],
      precioPlanPeriodo: [
        'idPrecioPlanPeriodo', 'idPlan', 'periodo', 'monedaBase', 'monto',
        'cantidadMeses', 'versionPrecio', 'vigenteDesde', 'vigenteHasta',
        'activo', 'actorTipo', 'creadoPor', 'vigenciaActiva'
      ],
      tipoCambioSuscripcion: [
        'idTipoCambioSuscripcion', 'monedaOrigen', 'monedaDestino', 'valor',
        'direccion', 'fuente', 'fechaEfectiva', 'vigenteDesde', 'vigenteHasta',
        'versionTipoCambio', 'activo', 'registradoPor', 'vigenciaActiva'
      ],
      metodoPagoSuscripcion: [
        'idMetodoPagoSuscripcion', 'codigo', 'tipo', 'nombre', 'instrucciones',
        'configurado', 'visiblePropietario', 'activo', 'requiereComprobante',
        'soloAdministracion', 'orden', 'configuradoPor'
      ],
      solicitudPagoSuscripcion: [
        'idSolicitudPago', 'referenciaPublica', 'idTienda', 'idSuscripcion',
        'idPlanActual', 'idPlanObjetivo', 'idPrecioPlanPeriodo',
        'idTipoCambioSuscripcion', 'idMetodoPagoSuscripcion', 'operacion',
        'periodo', 'cantidadMeses', 'planCodigoSnapshot', 'planNombreSnapshot',
        'versionPrecioSnapshot', 'precioBaseUSD', 'tipoCambioUsdBob',
        'montoCalculadoBOB', 'montoFinalBOB', 'monedaBase', 'monedaCobro',
        'estado', 'creadaPor', 'creadaEn', 'venceEn', 'ultimaTransicionEn',
        'idTiendaAbierta'
      ],
      solicitudPagoFuncionalidadSnapshot: [
        'idTienda', 'idSolicitudPago', 'codigoFuncionalidad',
        'nombreFuncionalidad', 'creadoEn'
      ],
      comprobantePagoSuscripcion: [
        'idComprobantePago', 'referenciaPublica', 'idTienda', 'idSolicitudPago',
        'versionComprobante', 'estado', 'nombreGenerado',
        'nombreOriginalSanitizado', 'extensionDetectada', 'mimeDetectado',
        'tamanoBytes', 'hashSha256', 'claveAlmacenamiento', 'cargadoPor',
        'cargadoEn', 'reemplazadoEn', 'idSolicitudActiva'
      ],
      revisionPagoSuscripcion: [
        'idRevisionPago', 'idTienda', 'idSolicitudPago', 'idComprobantePago',
        'decision', 'estadoAnterior', 'estadoNuevo', 'motivo', 'observacion',
        'revisadoPor', 'metadatos', 'creadoEn'
      ],
      historialSolicitudPagoSuscripcion: [
        'idHistorialSolicitudPago', 'idTienda', 'idSolicitudPago', 'evento',
        'estadoAnterior', 'estadoNuevo', 'actorTipo',
        'idAdministradorActor', 'metadatos', 'creadoEn'
      ],
      aplicacionPagoSuscripcion: [
        'idAplicacionPago', 'idTienda', 'idSolicitudPago', 'idSuscripcion',
        'operacionAplicada', 'idOperacionSuscripcion',
        'idHistorialSuscripcion', 'idPlanAnterior', 'idPlanNuevo', 'periodo',
        'fechaInicio', 'fechaFin', 'codigoResultado', 'aplicadaPor', 'aplicadaEn'
      ],
      operacionPagoSuscripcion: [
        'idOperacionPago', 'idTienda', 'idSolicitudPago', 'actorTipo',
        'idAdministradorActor', 'alcance', 'claveHash', 'huellaPayload',
        'estado', 'resultadoReferencia', 'codigoResultado', 'creadaEn',
        'completadaEn', 'fallidaEn', 'expiraEn', 'idActorClave'
      ]
    },
    indexes: [
      ['plan', 'idx_plan_catalogo_publico',
        ['activo', 'visiblePublicamente', 'esLegado', 'ordenComercial', 'codigo'], false],
      ['historialSuscripcionTienda', 'uq_historialSuscripcion_tienda_id',
        ['idTienda', 'idHistorialSuscripcion'], true],
      ['operacionSuscripcionTienda', 'uq_operacionSuscripcion_tienda_id',
        ['idTienda', 'idOperacionSuscripcion'], true],
      ['precioPlanPeriodo', 'uq_precioPlan_version',
        ['idPlan', 'periodo', 'monedaBase', 'versionPrecio'], true],
      ['precioPlanPeriodo', 'uq_precioPlan_activo',
        ['idPlan', 'periodo', 'monedaBase', 'vigenciaActiva'], true],
      ['tipoCambioSuscripcion', 'uq_tipoCambio_activo',
        ['monedaOrigen', 'monedaDestino', 'vigenciaActiva'], true],
      ['metodoPagoSuscripcion', 'uq_metodoPago_codigo', ['codigo'], true],
      ['solicitudPagoSuscripcion', 'uq_solicitudPago_referencia',
        ['referenciaPublica'], true],
      ['solicitudPagoSuscripcion', 'uq_solicitudPago_abierta',
        ['idTiendaAbierta'], true],
      ['solicitudPagoSuscripcion', 'idx_solicitudPago_cola',
        ['estado', 'ultimaTransicionEn', 'idSolicitudPago'], false],
      ['solicitudPagoFuncionalidadSnapshot', 'PRIMARY',
        ['idTienda', 'idSolicitudPago', 'codigoFuncionalidad'], true],
      ['comprobantePagoSuscripcion', 'uq_comprobantePago_version',
        ['idTienda', 'idSolicitudPago', 'versionComprobante'], true],
      ['comprobantePagoSuscripcion', 'uq_comprobantePago_activo',
        ['idSolicitudActiva'], true],
      ['revisionPagoSuscripcion', 'idx_revisionPago_solicitud',
        ['idTienda', 'idSolicitudPago', 'creadoEn', 'idRevisionPago'], false],
      ['historialSolicitudPagoSuscripcion', 'idx_historialSolicitudPago_solicitud',
        ['idTienda', 'idSolicitudPago', 'creadoEn', 'idHistorialSolicitudPago'], false],
      ['aplicacionPagoSuscripcion', 'uq_aplicacionPago_solicitud',
        ['idTienda', 'idSolicitudPago'], true],
      ['operacionPagoSuscripcion', 'uq_operacionPago_clave',
        ['idTienda', 'actorTipo', 'idActorClave', 'alcance', 'claveHash'], true]
    ],
    checks: [
      ['plan', 'chk_plan_presentacion'],
      ['precioPlanPeriodo', 'chk_precioPlan_valores'],
      ['precioPlanPeriodo', 'chk_precioPlan_actor'],
      ['tipoCambioSuscripcion', 'chk_tipoCambio_valores'],
      ['metodoPagoSuscripcion', 'chk_metodoPago_flags'],
      ['metodoPagoSuscripcion', 'chk_metodoPago_codigo'],
      ['solicitudPagoSuscripcion', 'chk_solicitudPago_referencia'],
      ['solicitudPagoSuscripcion', 'chk_solicitudPago_importes'],
      ['solicitudPagoSuscripcion', 'chk_solicitudPago_snapshot'],
      ['solicitudPagoSuscripcion', 'chk_solicitudPago_fechas'],
      ['solicitudPagoFuncionalidadSnapshot', 'chk_solicitudPagoFuncion_codigo'],
      ['comprobantePagoSuscripcion', 'chk_comprobantePago_referencia'],
      ['comprobantePagoSuscripcion', 'chk_comprobantePago_archivo'],
      ['comprobantePagoSuscripcion', 'chk_comprobantePago_fechas'],
      ['revisionPagoSuscripcion', 'chk_revisionPago_transicion'],
      ['historialSolicitudPagoSuscripcion', 'chk_historialSolicitudPago_actor'],
      ['aplicacionPagoSuscripcion', 'chk_aplicacionPago_resultado'],
      ['operacionPagoSuscripcion', 'chk_operacionPago_hashes'],
      ['operacionPagoSuscripcion', 'chk_operacionPago_actor'],
      ['operacionPagoSuscripcion', 'chk_operacionPago_fechas']
    ],
    foreignKeyConstraints: [
      ['precioPlanPeriodo', 'fk_precioPlan_plan',
        ['idPlan'], 'plan', ['idPlan'], 'RESTRICT', 'RESTRICT'],
      ['tipoCambioSuscripcion', 'fk_tipoCambio_actor',
        ['registradoPor'], 'administrador', ['idAdministrador'], 'RESTRICT', 'RESTRICT'],
      ['solicitudPagoSuscripcion', 'fk_solicitudPago_suscripcion',
        ['idTienda', 'idSuscripcion'], 'suscripcionTienda',
        ['idTienda', 'idSuscripcion'], 'RESTRICT', 'RESTRICT'],
      ['solicitudPagoSuscripcion', 'fk_solicitudPago_precio',
        ['idPrecioPlanPeriodo', 'idPlanObjetivo', 'periodo'], 'precioPlanPeriodo',
        ['idPrecioPlanPeriodo', 'idPlan', 'periodo'], 'RESTRICT', 'RESTRICT'],
      ['solicitudPagoFuncionalidadSnapshot', 'fk_solicitudPagoFuncion_solicitud',
        ['idTienda', 'idSolicitudPago'], 'solicitudPagoSuscripcion',
        ['idTienda', 'idSolicitudPago'], 'RESTRICT', 'RESTRICT'],
      ['comprobantePagoSuscripcion', 'fk_comprobantePago_solicitud',
        ['idTienda', 'idSolicitudPago'], 'solicitudPagoSuscripcion',
        ['idTienda', 'idSolicitudPago'], 'RESTRICT', 'RESTRICT'],
      ['revisionPagoSuscripcion', 'fk_revisionPago_solicitud',
        ['idTienda', 'idSolicitudPago'], 'solicitudPagoSuscripcion',
        ['idTienda', 'idSolicitudPago'], 'RESTRICT', 'RESTRICT'],
      ['historialSolicitudPagoSuscripcion', 'fk_historialSolicitudPago_solicitud',
        ['idTienda', 'idSolicitudPago'], 'solicitudPagoSuscripcion',
        ['idTienda', 'idSolicitudPago'], 'RESTRICT', 'RESTRICT'],
      ['aplicacionPagoSuscripcion', 'fk_aplicacionPago_solicitud',
        ['idTienda', 'idSolicitudPago'], 'solicitudPagoSuscripcion',
        ['idTienda', 'idSolicitudPago'], 'RESTRICT', 'RESTRICT'],
      ['aplicacionPagoSuscripcion', 'fk_aplicacionPago_operacion',
        ['idTienda', 'idOperacionSuscripcion'], 'operacionSuscripcionTienda',
        ['idTienda', 'idOperacionSuscripcion'], 'RESTRICT', 'RESTRICT'],
      ['operacionPagoSuscripcion', 'fk_operacionPago_solicitud',
        ['idTienda', 'idSolicitudPago'], 'solicitudPagoSuscripcion',
        ['idTienda', 'idSolicitudPago'], 'RESTRICT', 'RESTRICT']
    ]
  }
};

const LOTS_FEATURES = Object.freeze([
  'vencimientos_lote',
  'control_lotes',
  'alertas_vencimiento',
  'trazabilidad_lotes',
  'exportacion_lotes'
]);

const LOTS_COLUMN_DEFINITIONS = Object.freeze({
  configuracionInventarioTienda: {
    diasAlertaVencimientoDefault: { type: 'int', nullable: false, defaultValue: 30 }
  },
  producto: {
    controlaLotes: { type: 'tinyint(1)', nullable: false, defaultValue: 0 },
    controlaVencimiento: { type: 'tinyint(1)', nullable: false, defaultValue: 0 },
    diasAlertaVencimiento: { type: 'int', nullable: true, defaultValue: null },
    lotesActivadosEn: { type: 'datetime', nullable: true, defaultValue: null, extra: '' },
    ultimoPrecioCompra: { type: 'decimal(14,6)', nullable: false, defaultValue: 0 }
  },
  detalleVenta: {
    costoUnitario: { type: 'decimal(14,6)', nullable: false, defaultValue: 0 }
  },
  loteProducto: {
    idLoteProducto: { type: 'bigint', nullable: false, defaultValue: null, extraIncludes: 'auto_increment' },
    idTienda: { type: 'int', nullable: false, defaultValue: null },
    idProducto: { type: 'int', nullable: false, defaultValue: null },
    idProveedor: { type: 'int', nullable: true, defaultValue: null },
    idDetalleCompra: { type: 'int', nullable: true, defaultValue: null },
    codigoLote: { type: 'varchar(80)', nullable: true, defaultValue: null },
    origen: { type: "enum('compra','distribucion_inicial','ajuste_positivo','reversion')", nullable: false, defaultValue: null },
    fechaIngreso: { type: 'datetime', nullable: false, defaultValue: null, extra: '' },
    fechaVencimiento: { type: 'date', nullable: true, defaultValue: null, extra: '' },
    cantidadInicial: { type: 'int', nullable: false, defaultValue: null },
    cantidadRestante: { type: 'int', nullable: false, defaultValue: null },
    costoUnitarioBase: { type: 'decimal(14,6)', nullable: true, defaultValue: null },
    estadoOperativo: { type: "enum('disponible','bloqueado','anulado')", nullable: false, defaultValue: 'disponible' },
    claveOperacion: { type: 'varchar(160)', nullable: false, defaultValue: null },
    creadoEn: { type: 'datetime', nullable: false, defaultValue: null, extra: '' },
    actualizadoEn: { type: 'datetime', nullable: false, defaultValue: null, extra: '' },
    idAdministradorCrea: { type: 'int', nullable: false, defaultValue: null },
    idAdministradorActualiza: { type: 'int', nullable: true, defaultValue: null }
  },
  movimientoLote: {
    idMovimientoLote: { type: 'bigint', nullable: false, defaultValue: null, extraIncludes: 'auto_increment' },
    idTienda: { type: 'int', nullable: false, defaultValue: null },
    idProducto: { type: 'int', nullable: false, defaultValue: null },
    idLoteProducto: { type: 'bigint', nullable: false, defaultValue: null },
    idMovimientoStock: { type: 'bigint', nullable: true, defaultValue: null },
    tipoRegistro: { type: "enum('movimiento_stock','distribucion_inicial')", nullable: false, defaultValue: null },
    cantidad: { type: 'int', nullable: false, defaultValue: null },
    cantidadAnterior: { type: 'int', nullable: false, defaultValue: null },
    cantidadPosterior: { type: 'int', nullable: false, defaultValue: null },
    claveOperacion: { type: 'varchar(160)', nullable: false, defaultValue: null },
    creadoEn: { type: 'datetime', nullable: false, defaultValue: null, extra: '' },
    idAdministrador: { type: 'int', nullable: false, defaultValue: null }
  }
});

const CUSTOMER_CREDIT_CORE_FEATURES = Object.freeze([
  'clientes_basico', 'fiados_basico', 'pagos_fiado', 'estado_cuenta_basico'
]);
const CUSTOMER_CREDIT_ADVANCED_FEATURES = Object.freeze([
  'limites_credito', 'seguimiento_cobranza', 'segmentacion_clientes',
  'exportacion_clientes_fiados', 'recordatorios_fiado'
]);
const CUSTOMER_CREDIT_FEATURES = Object.freeze([
  ...CUSTOMER_CREDIT_CORE_FEATURES,
  ...CUSTOMER_CREDIT_ADVANCED_FEATURES
]);
const CUSTOMER_CREDIT_COLUMN_DEFINITIONS = Object.freeze({
  cliente: {
    direccion: { type: 'varchar(255)', nullable: true, defaultValue: null },
    telefonoAlternativo: { type: 'varchar(30)', nullable: true, defaultValue: null },
    telefonoNormalizado: { type: 'varchar(30)', nullable: true, defaultValue: null },
    documentoIdentidad: { type: 'varchar(50)', nullable: true, defaultValue: null },
    documentoNormalizado: { type: 'varchar(50)', nullable: true, defaultValue: null },
    correo: { type: 'varchar(160)', nullable: true, defaultValue: null },
    notas: { type: 'varchar(1000)', nullable: true, defaultValue: null },
    limiteCredito: { type: 'decimal(12,2)', nullable: true, defaultValue: null },
    permiteFiado: { type: 'tinyint(1)', nullable: false, defaultValue: 1 },
    diasCreditoDefault: { type: 'int', nullable: true, defaultValue: null },
    canalPreferido: {
      type: "enum('ninguno','whatsapp','telefono','correo','presencial')",
      nullable: false,
      defaultValue: 'ninguno'
    },
    aceptaRecordatorios: { type: 'tinyint(1)', nullable: false, defaultValue: 1 },
    horarioPreferido: { type: 'varchar(120)', nullable: true, defaultValue: null },
    creadoEn: { type: 'datetime', nullable: false, defaultValue: null, extra: '' },
    actualizadoEn: { type: 'datetime', nullable: false, defaultValue: null, extra: '' },
    idAdministradorCrea: { type: 'int', nullable: true, defaultValue: null },
    idAdministradorActualiza: { type: 'int', nullable: true, defaultValue: null }
  },
  fiado: {
    fechaVencimiento: { type: 'date', nullable: true, defaultValue: null, extra: '' },
    fechaPrometidaPago: { type: 'date', nullable: true, defaultValue: null, extra: '' },
    observacionCredito: { type: 'varchar(1000)', nullable: true, defaultValue: null },
    cerradoEn: { type: 'datetime', nullable: true, defaultValue: null, extra: '' },
    idAdministradorCrea: { type: 'int', nullable: true, defaultValue: null }
  },
  pagoFiado: {
    idCobroFiado: { type: 'bigint', nullable: false, defaultValue: null },
    claveDistribucion: { type: 'varchar(160)', nullable: false, defaultValue: null }
  },
  configuracionCreditoTienda: {
    idTienda: { type: 'int', nullable: false, defaultValue: null },
    limiteCreditoDefault: { type: 'decimal(12,2)', nullable: true, defaultValue: null },
    diasCreditoDefault: { type: 'int', nullable: false, defaultValue: 30 },
    diasAvisoVencimiento: { type: 'int', nullable: false, defaultValue: 3 },
    politicaFiadoVencido: {
      type: "enum('permitir','advertir','bloquear')", nullable: false, defaultValue: 'advertir'
    },
    requiereTelefonoParaFiado: { type: 'tinyint(1)', nullable: false, defaultValue: 0 },
    permiteFiadoSinFecha: { type: 'tinyint(1)', nullable: false, defaultValue: 1 },
    codigoPaisWhatsApp: { type: 'varchar(8)', nullable: true, defaultValue: null },
    creadoEn: { type: 'datetime', nullable: false, defaultValue: null, extra: '' },
    actualizadoEn: { type: 'datetime', nullable: false, defaultValue: null, extra: '' },
    idAdministradorActualiza: { type: 'int', nullable: true, defaultValue: null }
  },
  cobroFiado: {
    idCobroFiado: { type: 'bigint', nullable: false, defaultValue: null, extraIncludes: 'auto_increment' },
    idTienda: { type: 'int', nullable: false, defaultValue: null },
    idCliente: { type: 'int', nullable: false, defaultValue: null },
    fechaCobro: { type: 'datetime', nullable: false, defaultValue: null, extra: '' },
    montoTotal: { type: 'decimal(12,2)', nullable: false, defaultValue: null },
    metodoPago: {
      type: "enum('efectivo','qr','transferencia','tarjeta','otro','no_especificado')",
      nullable: false,
      defaultValue: null
    },
    montoRecibido: { type: 'decimal(12,2)', nullable: true, defaultValue: null },
    cambio: { type: 'decimal(12,2)', nullable: false, defaultValue: 0 },
    referencia: { type: 'varchar(160)', nullable: true, defaultValue: null },
    observacion: { type: 'varchar(1000)', nullable: true, defaultValue: null },
    claveOperacion: { type: 'varchar(160)', nullable: false, defaultValue: null },
    creadoEn: { type: 'datetime', nullable: false, defaultValue: null, extra: '' },
    idAdministrador: { type: 'int', nullable: true, defaultValue: null },
    esLegado: { type: 'tinyint(1)', nullable: false, defaultValue: 0 }
  },
  seguimientoCobranza: {
    idSeguimientoCobranza: { type: 'bigint', nullable: false, defaultValue: null, extraIncludes: 'auto_increment' },
    idTienda: { type: 'int', nullable: false, defaultValue: null },
    idCliente: { type: 'int', nullable: false, defaultValue: null },
    idFiado: { type: 'int', nullable: true, defaultValue: null },
    tipo: {
      type: "enum('nota','recordatorio_preparado','llamada','mensaje_enviado_manual','compromiso_pago','visita')",
      nullable: false,
      defaultValue: null
    },
    canal: {
      type: "enum('ninguno','whatsapp','telefono','presencial','correo')",
      nullable: false,
      defaultValue: 'ninguno'
    },
    detalle: { type: 'varchar(2000)', nullable: false, defaultValue: null },
    fechaCompromiso: { type: 'date', nullable: true, defaultValue: null, extra: '' },
    creadoEn: { type: 'datetime', nullable: false, defaultValue: null, extra: '' },
    idAdministrador: { type: 'int', nullable: false, defaultValue: null }
  },
  plantillaCobranzaTienda: {
    idPlantillaCobranza: { type: 'bigint', nullable: false, defaultValue: null, extraIncludes: 'auto_increment' },
    idTienda: { type: 'int', nullable: false, defaultValue: null },
    tipo: {
      type: "enum('recordatorio_previo','deuda_vencida','confirmacion_pago','estado_cuenta')",
      nullable: false,
      defaultValue: null
    },
    nombre: { type: 'varchar(100)', nullable: false, defaultValue: null },
    contenido: { type: 'varchar(2000)', nullable: false, defaultValue: null },
    activo: { type: 'tinyint(1)', nullable: false, defaultValue: 1 },
    creadoEn: { type: 'datetime', nullable: false, defaultValue: null, extra: '' },
    actualizadoEn: { type: 'datetime', nullable: false, defaultValue: null, extra: '' },
    idAdministradorActualiza: { type: 'int', nullable: true, defaultValue: null }
  }
});

function normalizedIdentifier(value) {
  return String(value || '').toLocaleLowerCase('en-US');
}

function normalizedColumnDefault(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim().toLocaleLowerCase('en-US');
  if (/^-?\d+(?:\.\d+)?$/.test(text)) return Number(text);
  return text;
}

async function normalizedHasTable(connection, table) {
  const [[row]] = await connection.query(
    `SELECT COUNT(*) total FROM information_schema.TABLES
     WHERE TABLE_SCHEMA=? AND LOWER(TABLE_NAME)=LOWER(?)`,
    [process.env.DB_NAME, table]
  );
  return Number(row.total) > 0;
}

async function normalizedColumnDetails(connection, table, columns) {
  if (!columns.length) return {};
  const placeholders = columns.map(() => 'LOWER(?)').join(',');
  const [rows] = await connection.query(
    `SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, EXTRA
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA=? AND LOWER(TABLE_NAME)=LOWER(?)
       AND LOWER(COLUMN_NAME) IN (${placeholders})`,
    [process.env.DB_NAME, table, ...columns]
  );
  return Object.fromEntries(rows.map((row) => [normalizedIdentifier(row.COLUMN_NAME), row]));
}

function columnDefinitionMatches(actual, expected) {
  if (!actual) return false;
  const actualType = normalizedIdentifier(actual.COLUMN_TYPE);
  const expectedType = normalizedIdentifier(expected.type);
  return actualType === expectedType
    && (actual.IS_NULLABLE === 'YES') === expected.nullable
    && normalizedColumnDefault(actual.COLUMN_DEFAULT) === normalizedColumnDefault(expected.defaultValue)
    && (expected.extra === undefined || normalizedIdentifier(actual.EXTRA) === normalizedIdentifier(expected.extra))
    && (!expected.extraIncludes || normalizedIdentifier(actual.EXTRA).includes(normalizedIdentifier(expected.extraIncludes)));
}

async function normalizedHasIndex(connection, table, indexName, columns, unique = false) {
  const [rows] = await connection.query(
    `SELECT COLUMN_NAME, NON_UNIQUE FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA=? AND LOWER(TABLE_NAME)=LOWER(?) AND LOWER(INDEX_NAME)=LOWER(?)
     ORDER BY SEQ_IN_INDEX`,
    [process.env.DB_NAME, table, indexName]
  );
  if (rows.length !== columns.length) return false;
  return rows.every((row, index) => normalizedIdentifier(row.COLUMN_NAME) === normalizedIdentifier(columns[index])
    && Number(row.NON_UNIQUE) === (unique ? 0 : 1));
}

async function normalizedHasConstraint(connection, table, constraintName, type = null) {
  const params = [process.env.DB_NAME, table, constraintName];
  const typeClause = type ? ' AND CONSTRAINT_TYPE=?' : '';
  if (type) params.push(type);
  const [[row]] = await connection.query(
    `SELECT COUNT(*) total FROM information_schema.TABLE_CONSTRAINTS
     WHERE CONSTRAINT_SCHEMA=? AND LOWER(TABLE_NAME)=LOWER(?)
       AND LOWER(CONSTRAINT_NAME)=LOWER(?)${typeClause}`,
    params
  );
  return Number(row.total) > 0;
}

async function normalizedHasForeignKeyConstraint(connection, relation) {
  const [table, name, columns, parentTable, parentColumns, updateRule, deleteRule] = relation;
  const [rows] = await connection.query(
    `SELECT COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
     FROM information_schema.KEY_COLUMN_USAGE
     WHERE TABLE_SCHEMA=? AND LOWER(TABLE_NAME)=LOWER(?)
       AND LOWER(CONSTRAINT_NAME)=LOWER(?)
     ORDER BY ORDINAL_POSITION`,
    [process.env.DB_NAME, table, name]
  );
  if (rows.length !== columns.length) return false;
  const columnsMatch = rows.every((row, index) => normalizedIdentifier(row.COLUMN_NAME) === normalizedIdentifier(columns[index])
    && normalizedIdentifier(row.REFERENCED_TABLE_NAME) === normalizedIdentifier(parentTable)
    && normalizedIdentifier(row.REFERENCED_COLUMN_NAME) === normalizedIdentifier(parentColumns[index]));
  if (!columnsMatch) return false;
  const [rules] = await connection.query(
    `SELECT UPDATE_RULE, DELETE_RULE FROM information_schema.REFERENTIAL_CONSTRAINTS
     WHERE CONSTRAINT_SCHEMA=? AND LOWER(TABLE_NAME)=LOWER(?)
       AND LOWER(CONSTRAINT_NAME)=LOWER(?)`,
    [process.env.DB_NAME, table, name]
  );
  return rules.length === 1
    && normalizedIdentifier(rules[0].UPDATE_RULE) === normalizedIdentifier(updateRule)
    && normalizedIdentifier(rules[0].DELETE_RULE) === normalizedIdentifier(deleteRule);
}

async function requirementsSatisfied(connection, file) {
  if (file === '011_lotes_vencimientos.sql') {
    const estado011 = await inspect011State(connection, false, { log: false });
    return estado011.estructuraCompleta && estado011.datosValidos;
  }
  if (file === '012_clientes_fiados_comunicacion.sql') {
    const estado012 = await inspect012State(connection, false, { log: false });
    return estado012.estructuraCompleta && estado012.datosValidos;
  }
  if (file === '013_seguridad_sesiones.sql') {
    const details = await normalizedColumnDetails(connection, 'administrador', ['versionSesion']);
    const definitionValid = columnDefinitionMatches(details.versionsesion, {
      type: 'int unsigned', nullable: false, defaultValue: 1, extra: ''
    });
    if (!definitionValid
      || !await normalizedHasConstraint(
        connection, 'administrador', 'chk_administrador_version_sesion', 'CHECK'
      )) return false;
    const [[invalid]] = await connection.query(
      'SELECT COUNT(*) total FROM administrador WHERE versionSesion IS NULL OR versionSesion<1'
    );
    return Number(invalid.total) === 0;
  }
  const requirements = migrationRequirements[file];
  if (!requirements) return false;
  for (const [table, columns] of Object.entries(requirements.columns || {})) {
    if (!await hasColumns(connection, table, columns)) return false;
  }
  for (const [table, types] of Object.entries(requirements.columnTypes || {})) {
    if (!await hasColumnTypes(connection, table, types)) return false;
  }
  for (const relation of requirements.foreignKeys || []) {
    if (!await hasForeignKey(connection, ...relation)) return false;
  }
  for (const index of requirements.indexes || []) {
    if (!await hasIndex(connection, ...index)) return false;
  }
  for (const check of requirements.checks || []) {
    if (!await hasCheckConstraint(connection, ...check)) return false;
  }
  for (const relation of requirements.foreignKeyConstraints || []) {
    if (!await hasForeignKeyConstraint(connection, ...relation)) return false;
  }
  if (file === '015_compensaciones_venta_inventario.sql') {
    const expectedDefinitions = {
      compensacionVenta: {
        tipoCompensacion: {
          type: `enum('${SALE_COMPENSATION_TYPES.join("','")}')`,
          nullable: false,
          defaultValue: null,
          extra: ''
        }
      },
      liquidacionCompensacionVenta: {
        estado: {
          type: "enum('sin_efecto','pendiente_c3','resuelta')",
          nullable: false,
          defaultValue: null,
          extra: ''
        }
      },
      detalleCompensacionVenta: {
        tratamientoInventario: {
          type: `enum('${INVENTORY_RETURN_TREATMENTS.join("','")}')`,
          nullable: false,
          defaultValue: null,
          extra: ''
        },
        resultadoInventario: {
          type: `enum('${INVENTORY_RETURN_RESULTS.join("','")}')`,
          nullable: false,
          defaultValue: null,
          extra: ''
        }
      }
    };
    for (const [table, definitions] of Object.entries(expectedDefinitions)) {
      const details = await normalizedColumnDetails(connection, table, Object.keys(definitions));
      for (const [column, expected] of Object.entries(definitions)) {
        if (!columnDefinitionMatches(details[normalizedIdentifier(column)], expected)) return false;
      }
    }
    const [[engines]] = await connection.query(
      `SELECT COUNT(*) total FROM information_schema.TABLES
       WHERE TABLE_SCHEMA=?
         AND LOWER(TABLE_NAME) IN (
           'compensacionventa',
           'liquidacioncompensacionventa',
           'detallecompensacionventa',
           'detallecompensacionlote'
         )
         AND LOWER(ENGINE)='innodb'`,
      [process.env.DB_NAME]
    );
    const [[invalid]] = await connection.query(
      `SELECT
         (
           SELECT COUNT(*) FROM compensacionVenta cv
           JOIN operacionCompensatoria oc
             ON oc.idTienda=cv.idTienda
            AND oc.idOperacionCompensatoria=cv.idOperacionCompensatoria
           WHERE oc.estado<>'aplicada'
              OR (cv.tipoCompensacion='anulacion_total' AND oc.tipoOperacion<>'anulacion_venta')
              OR (cv.tipoCompensacion='devolucion_parcial' AND oc.tipoOperacion<>'devolucion_venta')
         ) operacionesInvalidas,
         (
           SELECT COUNT(*) FROM (
             SELECT dcv.idTienda, dcv.idDetalleVenta
             FROM detalleCompensacionVenta dcv
             JOIN detalleVenta dv
               ON dv.idTienda=dcv.idTienda
              AND dv.idDetalleVenta=dcv.idDetalleVenta
             GROUP BY dcv.idTienda, dcv.idDetalleVenta, dv.cantidadEquivalenteUnidades
             HAVING SUM(dcv.unidadesDevueltas)>dv.cantidadEquivalenteUnidades
           ) excesos
         ) devolucionesExcedidas,
         (
           SELECT COUNT(*) FROM liquidacionCompensacionVenta
           WHERE ABS(
             montoCompensado
             - montoReduccionDeudaPendiente
             - montoReembolsoPendiente
           )>=0.01
         ) liquidacionesInvalidas,
         (
           SELECT COUNT(*) FROM detalleCompensacionVenta
           WHERE (
                  resultadoInventario IN ('no_reintegrado','aislado_no_vendible')
                  AND idMovimientoStock IS NOT NULL
                )
              OR (
                  resultadoInventario NOT IN ('no_reintegrado','aislado_no_vendible')
                  AND idMovimientoStock IS NULL
                )
         ) inventarioInvalido`
    );
    return Number(engines.total) === 4
      && Number(invalid.operacionesInvalidas) === 0
      && Number(invalid.devolucionesExcedidas) === 0
      && Number(invalid.liquidacionesInvalidas) === 0
      && Number(invalid.inventarioInvalido) === 0;
  }
  if (file === '016_compensaciones_financieras.sql') {
    const expectedDefinitions = {
      venta: {
        montoCompensado: {
          type: 'decimal(12,2)', nullable: false, defaultValue: 0, extra: ''
        }
      },
      fiado: {
        totalCompensado: {
          type: 'decimal(12,2)', nullable: false, defaultValue: 0, extra: ''
        }
      },
      cobroFiado: {
        estadoOperacion: {
          type: `enum('${COLLECTION_OPERATION_STATES.join("','")}')`,
          nullable: false,
          defaultValue: 'vigente',
          extra: ''
        }
      },
      obligacionReembolsoVenta: {
        estado: {
          type: `enum('${REFUND_OBLIGATION_STATES.join("','")}')`,
          nullable: false,
          defaultValue: 'pendiente',
          extra: ''
        }
      },
      compensacionCobroFiado: {
        tipoCompensacion: {
          type: `enum('${COLLECTION_COMPENSATION_TYPES.join("','")}')`,
          nullable: false,
          defaultValue: null,
          extra: ''
        },
        metodoOriginal: {
          type: `enum('${COLLECTION_PAYMENT_METHODS.join("','")}')`,
          nullable: false,
          defaultValue: null,
          extra: ''
        }
      },
      compensacionPagoVenta: {
        metodoOriginal: {
          type: `enum('${SALE_PAYMENT_METHODS.join("','")}')`,
          nullable: false,
          defaultValue: null,
          extra: ''
        }
      }
    };
    for (const [table, definitions] of Object.entries(expectedDefinitions)) {
      const details = await normalizedColumnDetails(connection, table, Object.keys(definitions));
      for (const [column, expected] of Object.entries(definitions)) {
        if (!columnDefinitionMatches(details[normalizedIdentifier(column)], expected)) return false;
      }
    }
    const [[engines]] = await connection.query(
      `SELECT COUNT(*) total
       FROM information_schema.TABLES
       WHERE TABLE_SCHEMA=?
         AND LOWER(TABLE_NAME) IN (
           'resolucionliquidacionventa',
           'obligacionreembolsoventa',
           'detalleobligacionreembolsopago',
           'compensacioncobrofiado',
           'detallecompensacioncobro',
           'compensacionpagoventa'
         )
         AND LOWER(ENGINE)='innodb'`,
      [process.env.DB_NAME]
    );
    const [[invalid]] = await connection.query(
      `SELECT
         (
           SELECT COUNT(*) FROM venta
           WHERE montoCompensado<0 OR montoCompensado>total+0.01
              OR saldoPendiente<0
              OR ABS(saldoPendiente-GREATEST(total-montoPagado-montoCompensado, 0))>=0.01
         ) ventasInvalidas,
         (
           SELECT COUNT(*) FROM fiado
           WHERE totalCompensado<0 OR saldoPendiente<0
              OR totalPagado+totalCompensado>totalFiado+0.01
              OR ABS(saldoPendiente-(totalFiado-totalPagado-totalCompensado))>=0.01
         ) fiadosInvalidos,
         (
           SELECT COUNT(*) FROM resolucionLiquidacionVenta rlv
           JOIN liquidacionCompensacionVenta lcv
             ON lcv.idTienda=rlv.idTienda
            AND lcv.idLiquidacionCompensacionVenta=rlv.idLiquidacionCompensacionVenta
           WHERE lcv.estado<>'resuelta'
              OR ABS(
                lcv.montoCompensado
                - rlv.montoReduccionDeuda
                - rlv.montoReembolso
              )>=0.01
         ) liquidacionesInvalidas,
         (
           SELECT COUNT(*) FROM (
             SELECT ore.idTienda, ore.idObligacionReembolsoVenta, ore.monto,
                    COALESCE(SUM(dorp.monto),0) distribuido
             FROM obligacionReembolsoVenta ore
             LEFT JOIN detalleObligacionReembolsoPago dorp
               ON dorp.idTienda=ore.idTienda
              AND dorp.idObligacionReembolsoVenta=ore.idObligacionReembolsoVenta
             GROUP BY ore.idTienda, ore.idObligacionReembolsoVenta, ore.monto
             HAVING ABS(ore.monto-distribuido)>=0.01
           ) diferencias
         ) reembolsosInvalidos,
         (
           SELECT COUNT(*) FROM compensacionCobroFiado ccf
           JOIN cobroFiado cf
             ON cf.idTienda=ccf.idTienda AND cf.idCobroFiado=ccf.idCobroFiado
           WHERE ccf.tipoCompensacion='anulacion_total'
             AND cf.estadoOperacion<>'compensado'
         ) cobrosInvalidos`
    );
    return Number(engines.total) === 6
      && Number(invalid.ventasInvalidas) === 0
      && Number(invalid.fiadosInvalidos) === 0
      && Number(invalid.liquidacionesInvalidas) === 0
      && Number(invalid.reembolsosInvalidos) === 0
      && Number(invalid.cobrosInvalidos) === 0;
  }
  if (file === '017_integracion_compensaciones.sql') {
    const details = await normalizedColumnDetails(
      connection,
      'movimientoLiquidacionCompensacion',
      ['tipoLiquidacion', 'metodoLiquidacion']
    );
    if (!columnDefinitionMatches(details.tipoliquidacion, {
      type: `enum('${MATERIAL_SETTLEMENT_TYPES.join("','")}')`,
      nullable: false,
      defaultValue: null,
      extra: ''
    }) || !columnDefinitionMatches(details.metodoliquidacion, {
      type: `enum('${COLLECTION_PAYMENT_METHODS.join("','")}')`,
      nullable: false,
      defaultValue: null,
      extra: ''
    })) return false;
    const [[invalid]] = await connection.query(
      `SELECT COUNT(*) total
       FROM (
         SELECT ore.idTienda, ore.idObligacionReembolsoVenta, ore.monto,
                ore.estado, COALESCE(SUM(mlc.monto),0) liquidado,
                COUNT(DISTINCT mlc.tipoLiquidacion) tipos,
                MIN(mlc.tipoLiquidacion) tipo,
                SUM(CASE WHEN oc.estado<>'aplicada' THEN 1 ELSE 0 END)
                  operacionesNoAplicadas
         FROM obligacionReembolsoVenta ore
         LEFT JOIN movimientoLiquidacionCompensacion mlc
           ON mlc.idTienda=ore.idTienda
          AND mlc.idObligacionReembolsoVenta=ore.idObligacionReembolsoVenta
         LEFT JOIN operacionCompensatoria oc
           ON oc.idTienda=mlc.idTienda
          AND oc.idOperacionCompensatoria=mlc.idOperacionCompensatoria
         GROUP BY ore.idTienda, ore.idObligacionReembolsoVenta,
                  ore.monto, ore.estado
         HAVING liquidado>ore.monto+0.01
            OR operacionesNoAplicadas>0
            OR (ore.estado='pendiente' AND liquidado>=ore.monto-0.01)
            OR (ore.estado='reembolsado'
                AND (ABS(liquidado-ore.monto)>=0.01
                     OR tipos<>1 OR tipo<>'reembolso_realizado'))
            OR (ore.estado='compensado'
                AND ABS(liquidado-ore.monto)>=0.01)
       ) inconsistencias`
    );
    return Number(invalid.total) === 0;
  }
  if (file === '014_operaciones_compensatorias.sql') {
    const expectedDefinitions = {
      venta: {
        estadoOperacion: {
          type: `enum('${SALE_OPERATION_STATES.join("','")}')`,
          nullable: false,
          defaultValue: 'vigente',
          extra: ''
        }
      },
      operacionCompensatoria: {
        idOperacionCompensatoria: {
          type: 'bigint',
          nullable: false,
          defaultValue: null,
          extraIncludes: 'auto_increment'
        },
        idTienda: { type: 'int', nullable: false, defaultValue: null, extra: '' },
        tipoOperacion: {
          type: `enum('${COMPENSATION_TYPES.join("','")}')`,
          nullable: false,
          defaultValue: null,
          extra: ''
        },
        estado: {
          type: `enum('${COMPENSATION_STATES.join("','")}')`,
          nullable: false,
          defaultValue: 'solicitada',
          extra: ''
        },
        motivoCodigo: {
          type: `enum('${COMPENSATION_REASONS.join("','")}')`,
          nullable: false,
          defaultValue: null,
          extra: ''
        },
        observacion: { type: 'varchar(1000)', nullable: true, defaultValue: null, extra: '' },
        requiereAprobacion: { type: 'tinyint(1)', nullable: false, defaultValue: 0, extra: '' },
        idAdministradorSolicitante: { type: 'int', nullable: false, defaultValue: null, extra: '' },
        idAdministradorAprobador: { type: 'int', nullable: true, defaultValue: null, extra: '' },
        claveOperacion: { type: 'varchar(160)', nullable: false, defaultValue: null, extra: '' },
        huellaSolicitud: { type: 'char(64)', nullable: false, defaultValue: null, extra: '' },
        fechaSolicitud: { type: 'datetime', nullable: false, defaultValue: null, extra: '' },
        fechaAprobacion: { type: 'datetime', nullable: true, defaultValue: null, extra: '' },
        fechaAplicacion: { type: 'datetime', nullable: true, defaultValue: null, extra: '' },
        creadoEn: { type: 'datetime', nullable: false, defaultValue: null, extra: '' },
        actualizadoEn: { type: 'datetime', nullable: false, defaultValue: null, extra: '' }
      }
    };
    for (const [table, definitions] of Object.entries(expectedDefinitions)) {
      const details = await normalizedColumnDetails(connection, table, Object.keys(definitions));
      for (const [column, expected] of Object.entries(definitions)) {
        if (!columnDefinitionMatches(details[normalizedIdentifier(column)], expected)) return false;
      }
    }
    const [[engine]] = await connection.query(
      `SELECT COUNT(*) total FROM information_schema.TABLES
       WHERE TABLE_SCHEMA=? AND LOWER(TABLE_NAME)='operacioncompensatoria'
         AND LOWER(ENGINE)='innodb'`,
      [process.env.DB_NAME]
    );
    if (Number(engine.total) !== 1) return false;
    const [[invalidSaleStates]] = await connection.query(
      `SELECT COUNT(*) total FROM venta
       WHERE estadoOperacion IS NULL OR estadoOperacion NOT IN (?)`,
      [SALE_OPERATION_STATES]
    );
    const [[invalidOperations]] = await connection.query(
      `SELECT COUNT(*) total FROM operacionCompensatoria
       WHERE idTienda IS NULL
          OR idAdministradorSolicitante IS NULL
          OR tipoOperacion NOT IN (?)
          OR estado NOT IN (?)
          OR motivoCodigo NOT IN (?)
          OR CONVERT(claveOperacion USING utf8mb4)
             NOT REGEXP '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
          OR CHAR_LENGTH(claveOperacion)>160
          OR CONVERT(huellaSolicitud USING utf8mb4) NOT REGEXP '^[0-9A-Fa-f]{64}$'
          OR huellaSolicitud<>LOWER(huellaSolicitud)
          OR requiereAprobacion NOT IN (0,1)
          OR (motivoCodigo='otro_controlado'
              AND (observacion IS NULL OR CHAR_LENGTH(TRIM(observacion))<8))
          OR fechaSolicitud<>creadoEn
          OR actualizadoEn<creadoEn
          OR ((idAdministradorAprobador IS NULL)<>(fechaAprobacion IS NULL))
          OR (fechaAprobacion IS NOT NULL AND fechaAprobacion<fechaSolicitud)
          OR (estado='aplicada' AND (fechaAplicacion IS NULL OR fechaAplicacion<fechaSolicitud))
          OR (estado<>'aplicada' AND fechaAplicacion IS NOT NULL)
          OR (estado='aprobada' AND idAdministradorAprobador IS NULL)
          OR (
            requiereAprobacion=1
            AND estado IN ('aprobada','aplicada')
            AND idAdministradorAprobador IS NULL
          )`,
      [COMPENSATION_TYPES, COMPENSATION_STATES, COMPENSATION_REASONS]
    );
    const [[feature]] = await connection.query(
      `SELECT COUNT(*) total FROM funcionalidad
       WHERE codigo=? AND activo=1`,
      [COMPENSATION_FEATURE]
    );
    const [[planAccess]] = await connection.query(
      `SELECT COUNT(DISTINCT p.codigo) total
       FROM planFuncionalidad pf
       JOIN plan p ON p.idPlan=pf.idPlan
       JOIN funcionalidad f ON f.idFuncionalidad=pf.idFuncionalidad
       WHERE p.codigo IN ('basico','avanzado')
         AND f.codigo=?
         AND f.activo=1
         AND pf.habilitada=1`,
      [COMPENSATION_FEATURE]
    );
    return Number(invalidSaleStates.total) === 0
      && Number(invalidOperations.total) === 0
      && Number(feature.total) === 1
      && Number(planAccess.total) === 2;
  }
  if (file === '004_multitienda_base.sql') {
    const [[shop]] = await connection.query("SELECT COUNT(*) total FROM tienda WHERE slug='tienda-deisy'");
    if (Number(shop.total) !== 1) return false;
    const tenantTables = ['cliente', 'proveedor', 'producto', 'venta', 'compra', 'fiado', 'detalleVenta', 'detalleCompra', 'detalleFiado', 'pagoFiado'];
    for (const table of tenantTables) {
      const [[missing]] = await connection.query(`SELECT COUNT(*) total FROM ${table} WHERE idTienda IS NULL`);
      if (Number(missing.total) > 0) return false;
    }
    const [[ownersWithoutShop]] = await connection.query(
      "SELECT COUNT(*) total FROM administrador WHERE rol='dueno_tienda' AND idTienda IS NULL"
    );
    if (Number(ownersWithoutShop.total) > 0) return false;
  }
  if (file === '005_planes_suscripciones.sql') {
    const [[plans]] = await connection.query(
      "SELECT COUNT(DISTINCT codigo) total FROM plan WHERE codigo IN ('basico','avanzado')"
    );
    if (Number(plans.total) !== 2) return false;
    const [[features]] = await connection.query(
      `SELECT COUNT(DISTINCT codigo) total FROM funcionalidad
       WHERE codigo IN ('reportes_avanzados','compras_sugeridas','historial_stock','recibos_whatsapp','recordatorios_fiado','gastos','cierre_caja','vencimientos_lote','portal_clientes')`
    );
    if (Number(features.total) !== 9) return false;
    const [[advancedFeatures]] = await connection.query(
      `SELECT COUNT(*) total
       FROM planFuncionalidad pf
       JOIN plan p ON p.idPlan=pf.idPlan
       JOIN funcionalidad f ON f.idFuncionalidad=pf.idFuncionalidad
       WHERE p.codigo='avanzado' AND pf.habilitada=1 AND f.activo=1`
    );
    if (Number(advancedFeatures.total) < 9) return false;
    const [[storesWithoutSubscription]] = await connection.query(
      `SELECT COUNT(*) total FROM tienda t
       WHERE NOT EXISTS (SELECT 1 FROM suscripcionTienda s WHERE s.idTienda=t.idTienda)`
    );
    if (Number(storesWithoutSubscription.total) > 0) return false;
    const [[invalidDates]] = await connection.query(
      'SELECT COUNT(*) total FROM suscripcionTienda WHERE fechaFin <= fechaInicio'
    );
    if (Number(invalidDates.total) > 0) return false;
    const [[overlaps]] = await connection.query(
      `SELECT COUNT(*) total
       FROM suscripcionTienda a
       JOIN suscripcionTienda b ON b.idTienda=a.idTienda AND b.idSuscripcion>a.idSuscripcion
       WHERE a.estado IN ('pendiente','activa')
         AND b.estado IN ('pendiente','activa')
         AND a.fechaInicio < b.fechaFin AND b.fechaInicio < a.fechaFin`
    );
    if (Number(overlaps.total) > 0) return false;
  }
  if (file === '007_movimientos_stock.sql') {
    const [[features]] = await connection.query(
      "SELECT COUNT(DISTINCT codigo) total FROM funcionalidad WHERE codigo IN ('historial_stock','ajuste_stock') AND activo=1"
    );
    if (Number(features.total) !== 2) return false;
    const [[planAccess]] = await connection.query(
      `SELECT COUNT(DISTINCT CONCAT(p.codigo, ':', f.codigo)) total
       FROM planFuncionalidad pf
       JOIN plan p ON p.idPlan=pf.idPlan
       JOIN funcionalidad f ON f.idFuncionalidad=pf.idFuncionalidad
       WHERE p.codigo IN ('basico','avanzado')
         AND f.codigo IN ('historial_stock','ajuste_stock')
         AND p.activo=1 AND f.activo=1 AND pf.habilitada=1`
    );
    if (Number(planAccess.total) !== 4) return false;
    const [[negativeStock]] = await connection.query(
      'SELECT COUNT(*) total FROM producto WHERE stockUnidadesTotal<0'
    );
    if (Number(negativeStock.total) > 0) return false;
    const [[invalidMovements]] = await connection.query(
      `SELECT COUNT(*) total FROM movimientoStock
       WHERE cantidad=0 OR stockAnterior<0 OR stockPosterior<0
          OR stockPosterior<>stockAnterior+cantidad
          OR tipoMovimiento NOT IN ('entrada','salida','ajuste_positivo','ajuste_negativo','inventario_inicial')
          OR origen NOT IN ('compra','venta','ajuste_manual','alta_producto','migracion_inicial','correccion_sistema','otro')
          OR (tipoMovimiento IN ('entrada','ajuste_positivo','inventario_inicial') AND cantidad<0)
          OR (tipoMovimiento IN ('salida','ajuste_negativo') AND cantidad>0)`
    );
    if (Number(invalidMovements.total) > 0) return false;
    const [[invalidMovementReferences]] = await connection.query(
      `SELECT COUNT(*) total FROM movimientoStock
       WHERE (idDetalleVenta IS NOT NULL AND idDetalleCompra IS NOT NULL)
          OR (origen='compra' AND (idDetalleCompra IS NULL OR idDetalleVenta IS NOT NULL))
          OR (origen='venta' AND (idDetalleVenta IS NULL OR idDetalleCompra IS NOT NULL))
          OR (origen NOT IN ('compra','venta') AND (idDetalleVenta IS NOT NULL OR idDetalleCompra IS NOT NULL))`
    );
    if (Number(invalidMovementReferences.total) > 0) return false;
    const [[reconciliation]] = await connection.query(
      `SELECT COUNT(*) total FROM (
         SELECT p.idTienda, p.idProducto
         FROM producto p
         LEFT JOIN movimientoStock ms ON ms.idTienda=p.idTienda AND ms.idProducto=p.idProducto
         GROUP BY p.idTienda, p.idProducto, p.stockUnidadesTotal
         HAVING COALESCE(SUM(ms.cantidad),0)<>p.stockUnidadesTotal
       ) diferencias`
    );
    if (Number(reconciliation.total) > 0) return false;
  }
  if (file === '008_punto_venta_pagos.sql') {
    const [[features]] = await connection.query(
      "SELECT COUNT(DISTINCT codigo) total FROM funcionalidad WHERE codigo IN ('punto_venta','pagos_multiples','recibos_whatsapp') AND activo=1"
    );
    if (Number(features.total) !== 3) return false;
    const [[planAccess]] = await connection.query(
      `SELECT COUNT(DISTINCT CONCAT(p.codigo, ':', f.codigo)) total
       FROM planFuncionalidad pf
       JOIN plan p ON p.idPlan=pf.idPlan
       JOIN funcionalidad f ON f.idFuncionalidad=pf.idFuncionalidad
       WHERE p.codigo IN ('basico','avanzado')
         AND f.codigo IN ('punto_venta','pagos_multiples','recibos_whatsapp')
         AND p.activo=1 AND f.activo=1 AND pf.habilitada=1`
    );
    if (Number(planAccess.total) !== 6) return false;
    const [[invalidSales]] = await connection.query(
      `SELECT COUNT(*) total FROM venta v
       WHERE v.subtotal<0 OR v.descuento<0 OR v.total<0 OR v.montoPagado<0 OR v.saldoPendiente<0
          OR v.descuento>v.subtotal OR ABS((v.subtotal-v.descuento)-v.total)>=0.01
          OR (v.estadoPago<>'legado' AND ABS((v.montoPagado+v.saldoPendiente)-v.total)>=0.01)
          OR (v.estadoPago='pagada' AND (v.saldoPendiente<>0 OR v.montoPagado<>v.total))
          OR (v.estadoPago='parcial' AND (v.montoPagado<=0 OR v.saldoPendiente<=0 OR v.idCliente IS NULL))
          OR (v.estadoPago='pendiente' AND (v.montoPagado<>0 OR v.saldoPendiente<>v.total OR v.saldoPendiente<=0 OR v.idCliente IS NULL))
          OR (v.estadoPago IN ('pendiente','parcial') AND v.tipo<>'fiada')
          OR v.codigoComprobante IS NULL OR v.codigoComprobante=''`
    );
    if (Number(invalidSales.total) > 0) return false;
    const [[invalidPayments]] = await connection.query(
      `SELECT COUNT(*) total FROM pagoVenta pv
       LEFT JOIN venta v ON v.idTienda=pv.idTienda AND v.idVenta=pv.idVenta
       LEFT JOIN pagoFiado pf ON pf.idTienda=pv.idTienda AND pf.idPagoFiado=pv.idPagoFiado
       LEFT JOIN fiado f ON f.idTienda=pf.idTienda AND f.idFiado=pf.idFiado
       LEFT JOIN administrador a ON a.idTienda=pv.idTienda AND a.idAdministrador=pv.idAdministrador
       WHERE pv.monto<=0 OR pv.metodoPago NOT IN ('efectivo','qr','no_especificado')
          OR (pv.metodoPago='efectivo' AND (pv.montoRecibido IS NULL OR pv.montoRecibido<pv.monto OR pv.cambio<0 OR ABS((pv.montoRecibido-pv.monto)-pv.cambio)>=0.01))
          OR (pv.metodoPago<>'efectivo' AND (pv.montoRecibido IS NOT NULL OR pv.cambio<>0))
          OR v.idVenta IS NULL
          OR (pv.idPagoFiado IS NOT NULL AND (pf.idPagoFiado IS NULL OR f.idVenta IS NULL OR f.idVenta<>pv.idVenta))
          OR (pv.idAdministrador IS NOT NULL AND a.idAdministrador IS NULL)`
    );
    if (Number(invalidPayments.total) > 0) return false;
    const [[paymentDifferences]] = await connection.query(
      `SELECT COUNT(*) total FROM (
         SELECT v.idTienda, v.idVenta, v.montoPagado, COALESCE(SUM(pv.monto),0) pagos
         FROM venta v
         LEFT JOIN pagoVenta pv ON pv.idTienda=v.idTienda AND pv.idVenta=v.idVenta
         WHERE v.estadoPago<>'legado'
         GROUP BY v.idTienda, v.idVenta, v.montoPagado
         HAVING ABS(pagos-v.montoPagado)>=0.01
       ) diferencias`
    );
    if (Number(paymentDifferences.total) > 0) return false;
    const [[duplicateDebts]] = await connection.query(
      `SELECT COUNT(*) total FROM (
         SELECT idTienda, idVenta FROM fiado
         WHERE idVenta IS NOT NULL GROUP BY idTienda, idVenta HAVING COUNT(*)>1
       ) duplicados`
    );
    if (Number(duplicateDebts.total) > 0) return false;
    const [[invalidDebtLinks]] = await connection.query(
      `SELECT COUNT(*) total FROM venta v
       LEFT JOIN fiado f ON f.idTienda=v.idTienda AND f.idVenta=v.idVenta
       WHERE v.estadoPago IN ('pendiente','parcial')
         AND (f.idFiado IS NULL OR ABS(f.saldoPendiente-v.saldoPendiente)>=0.01)`
    );
    if (Number(invalidDebtLinks.total) > 0) return false;
  }
  if (file === '009_finanzas_reportes_caja.sql') {
    const [[features]] = await connection.query(
      `SELECT COUNT(DISTINCT codigo) total FROM funcionalidad
       WHERE codigo IN ('gastos','reportes_financieros','rentabilidad_producto','exportacion_reportes','cierre_caja','dashboard_financiero')
         AND activo=1`
    );
    if (Number(features.total) !== 6) return false;
    const [[planAccess]] = await connection.query(
      `SELECT COUNT(DISTINCT CONCAT(p.codigo, ':', f.codigo)) total
       FROM planFuncionalidad pf
       JOIN plan p ON p.idPlan=pf.idPlan
       JOIN funcionalidad f ON f.idFuncionalidad=pf.idFuncionalidad
       WHERE pf.habilitada=1 AND p.activo=1 AND f.activo=1
         AND ((p.codigo IN ('basico','avanzado') AND f.codigo IN ('gastos','reportes_financieros','exportacion_reportes','dashboard_financiero'))
           OR (p.codigo='avanzado' AND f.codigo IN ('rentabilidad_producto','cierre_caja')))`
    );
    if (Number(planAccess.total) !== 10) return false;
    const [[storesWithoutCategories]] = await connection.query(
      `SELECT COUNT(*) total FROM tienda t
       WHERE NOT EXISTS (SELECT 1 FROM categoriaGasto cg WHERE cg.idTienda=t.idTienda)`
    );
    if (Number(storesWithoutCategories.total) > 0) return false;
    const [[invalidCosts]] = await connection.query(
      `SELECT COUNT(*) total FROM detalleVenta
       WHERE costoUnitario<0 OR subtotalCosto<0
          OR origenCosto NOT IN ('real','estimado','desconocido')
          OR (origenCosto IN ('real','estimado') AND costoUnitario<=0)
          OR (origenCosto='desconocido' AND costoUnitario>0 AND cantidadEquivalenteUnidades>0)
          OR (cantidadEquivalenteUnidades>0 AND ABS(subtotalCosto-(costoUnitario*cantidadEquivalenteUnidades))>=0.02)`
    );
    if (Number(invalidCosts.total) > 0) return false;
    const [[invalidExpenses]] = await connection.query(
      `SELECT COUNT(*) total FROM gasto g
       LEFT JOIN categoriaGasto cg ON cg.idTienda=g.idTienda AND cg.idCategoriaGasto=g.idCategoriaGasto
       LEFT JOIN administrador a ON a.idTienda=g.idTienda AND a.idAdministrador=g.idAdministrador
       LEFT JOIN administrador am ON am.idTienda=g.idTienda AND am.idAdministrador=g.idAdministradorModifica
       LEFT JOIN administrador aa ON aa.idTienda=g.idTienda AND aa.idAdministrador=g.idAdministradorAnula
       WHERE g.monto<=0 OR cg.idCategoriaGasto IS NULL OR a.idAdministrador IS NULL
          OR (g.idAdministradorModifica IS NOT NULL AND am.idAdministrador IS NULL)
          OR (g.idAdministradorAnula IS NOT NULL AND aa.idAdministrador IS NULL)
          OR (g.estado='registrado' AND (g.anuladoEn IS NOT NULL OR g.idAdministradorAnula IS NOT NULL OR g.motivoAnulacion IS NOT NULL))
          OR (g.estado='anulado' AND (g.anuladoEn IS NULL OR g.idAdministradorAnula IS NULL OR g.motivoAnulacion IS NULL))`
    );
    if (Number(invalidExpenses.total) > 0) return false;
    const [[invalidClosures]] = await connection.query(
      `SELECT COUNT(*) total FROM cierreCaja c
       LEFT JOIN administrador a ON a.idTienda=c.idTienda AND a.idAdministrador=c.idAdministrador
       LEFT JOIN administrador aa ON aa.idTienda=c.idTienda AND aa.idAdministrador=c.idAdministradorAnula
       WHERE c.fechaFin<=c.fechaInicio OR a.idAdministrador IS NULL
          OR c.efectivoInicial<0 OR c.efectivoVentasEsperado<0 OR c.efectivoFiadosCobrado<0
          OR c.gastosEfectivo<0 OR c.efectivoEsperado<0 OR c.efectivoContado<0
          OR ABS(c.efectivoEsperado-(c.efectivoInicial+c.efectivoVentasEsperado+c.efectivoFiadosCobrado-c.gastosEfectivo))>=0.01
          OR ABS(c.diferencia-(c.efectivoContado-c.efectivoEsperado))>=0.01
          OR (c.estado='cerrado' AND (c.anuladoEn IS NOT NULL OR c.idAdministradorAnula IS NOT NULL OR c.motivoAnulacion IS NOT NULL))
          OR (c.estado='anulado' AND (c.anuladoEn IS NULL OR c.idAdministradorAnula IS NULL OR c.motivoAnulacion IS NULL OR aa.idAdministrador IS NULL))`
    );
    if (Number(invalidClosures.total) > 0) return false;
    const [[overlappingClosures]] = await connection.query(
      `SELECT COUNT(*) total FROM cierreCaja a
       JOIN cierreCaja b ON b.idTienda=a.idTienda AND b.idCierreCaja>a.idCierreCaja
       WHERE a.estado='cerrado' AND b.estado='cerrado'
         AND a.fechaInicio<b.fechaFin AND b.fechaInicio<a.fechaFin`
    );
    if (Number(overlappingClosures.total) > 0) return false;
  }
  if (file === '010_inteligencia_inventario.sql') {
    const [temporalColumns] = await connection.query(
      `SELECT TABLE_NAME, COLUMN_NAME, IS_NULLABLE, COLUMN_DEFAULT, EXTRA
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA=? AND (
         (TABLE_NAME='producto' AND COLUMN_NAME='fechaInicioSeguimiento')
         OR (TABLE_NAME='configuracionInventarioTienda' AND COLUMN_NAME IN ('creadoEn','actualizadoEn'))
       )`,
      [process.env.DB_NAME]
    );
    const temporalColumnKey = (table, column) => `${String(table).toLocaleLowerCase('en-US')}.${String(column).toLocaleLowerCase('en-US')}`;
    const temporalMetadata = new Map(
      temporalColumns.map((column) => [temporalColumnKey(column.TABLE_NAME, column.COLUMN_NAME), column])
    );
    const trackingDate = temporalMetadata.get(temporalColumnKey('producto', 'fechaInicioSeguimiento'));
    const configurationCreatedAt = temporalMetadata.get(temporalColumnKey('configuracionInventarioTienda', 'creadoEn'));
    const configurationUpdatedAt = temporalMetadata.get(temporalColumnKey('configuracionInventarioTienda', 'actualizadoEn'));
    if (!trackingDate || trackingDate.IS_NULLABLE !== 'NO' || trackingDate.COLUMN_DEFAULT !== null
      || String(trackingDate.EXTRA || '') !== '') return false;
    if (!configurationCreatedAt || configurationCreatedAt.IS_NULLABLE !== 'NO'
      || configurationCreatedAt.COLUMN_DEFAULT !== null
      || String(configurationCreatedAt.EXTRA || '') !== '') return false;
    if (!configurationUpdatedAt || configurationUpdatedAt.IS_NULLABLE !== 'NO'
      || configurationUpdatedAt.COLUMN_DEFAULT !== null
      || String(configurationUpdatedAt.EXTRA || '') !== '') return false;
    const [[storesWithoutConfiguration]] = await connection.query(
      `SELECT COUNT(*) total FROM tienda t
       WHERE NOT EXISTS (
         SELECT 1 FROM configuracionInventarioTienda c WHERE c.idTienda=t.idTienda
       )`
    );
    if (Number(storesWithoutConfiguration.total) > 0) return false;
    const [[invalidConfiguration]] = await connection.query(
      `SELECT COUNT(*) total FROM configuracionInventarioTienda c
       LEFT JOIN tienda t ON t.idTienda=c.idTienda
       LEFT JOIN administrador a ON a.idTienda=c.idTienda AND a.idAdministrador=c.idAdministradorActualiza
       WHERE t.idTienda IS NULL
          OR c.periodoAnalisisDias NOT BETWEEN 7 AND 365
          OR c.diasHistorialMinimo NOT BETWEEN 1 AND c.periodoAnalisisDias
          OR c.diasReposicionDefault NOT BETWEEN 0 AND 365
          OR c.diasCoberturaDefault NOT BETWEEN 1 AND 365
          OR c.diasProductoNuevo NOT BETWEEN 1 AND 365
          OR (c.idAdministradorActualiza IS NOT NULL AND a.idAdministrador IS NULL)`
    );
    if (Number(invalidConfiguration.total) > 0) return false;
    const [[invalidProducts]] = await connection.query(
      `SELECT COUNT(*) total FROM producto
       WHERE fechaInicioSeguimiento IS NULL
          OR (diasReposicion IS NOT NULL AND diasReposicion NOT BETWEEN 0 AND 365)
          OR (diasCoberturaObjetivo IS NOT NULL AND diasCoberturaObjetivo NOT BETWEEN 1 AND 365)
          OR (presentacionCompraSugerida IS NOT NULL
              AND presentacionCompraSugerida NOT IN ('unidad','paquete'))`
    );
    if (Number(invalidProducts.total) > 0) return false;
    const [[features]] = await connection.query(
      `SELECT COUNT(DISTINCT codigo) total FROM funcionalidad
       WHERE codigo IN (
         'inventario_resumen','alertas_stock','ranking_productos','valor_inventario_basico',
         'compras_sugeridas','rotacion_inventario','dias_cobertura',
         'inventario_sin_movimiento','exportacion_inventario'
       ) AND activo=1`
    );
    if (Number(features.total) !== 9) return false;
    const [[planAccess]] = await connection.query(
      `SELECT COUNT(DISTINCT CONCAT(p.codigo, ':', f.codigo)) total
       FROM planFuncionalidad pf
       JOIN plan p ON p.idPlan=pf.idPlan
       JOIN funcionalidad f ON f.idFuncionalidad=pf.idFuncionalidad
       WHERE pf.habilitada=1 AND p.activo=1 AND f.activo=1
         AND ((p.codigo IN ('basico','avanzado')
               AND f.codigo IN ('inventario_resumen','alertas_stock','ranking_productos','valor_inventario_basico'))
           OR (p.codigo='avanzado'
               AND f.codigo IN ('compras_sugeridas','rotacion_inventario','dias_cobertura',
                                'inventario_sin_movimiento','exportacion_inventario')))`
    );
    if (Number(planAccess.total) !== 13) return false;
    const [[advancedInBasic]] = await connection.query(
      `SELECT COUNT(*) total FROM planFuncionalidad pf
       JOIN plan p ON p.idPlan=pf.idPlan
       JOIN funcionalidad f ON f.idFuncionalidad=pf.idFuncionalidad
       WHERE p.codigo='basico' AND pf.habilitada=1
         AND f.codigo IN ('compras_sugeridas','rotacion_inventario','dias_cobertura',
                          'inventario_sin_movimiento','exportacion_inventario','vencimientos_lote')`
    );
    if (Number(advancedInBasic.total) > 0) return false;
  }
  if (file === '022_ciclo_vida_suscripciones.sql') {
    const [[invalid]] = await connection.query(
      `SELECT
         (SELECT COUNT(*) FROM suscripcionTienda
          WHERE planCodigoSnapshot IS NULL
             OR planNombreSnapshot IS NULL
             OR tipoPeriodoSnapshot IS NULL
             OR duracionDiasSnapshot<1
             OR precioReferenciaSnapshot<0
             OR fechaFin<=fechaInicio
             OR (fechaFinGracia IS NOT NULL AND fechaFinGracia<=fechaFin)
             OR (estado='gracia' AND fechaFinGracia IS NULL)
             OR ((idPlanSiguiente IS NULL)<>(fechaAplicacionPlanSiguiente IS NULL))
         ) suscripcionesInvalidas,
         (SELECT COUNT(*) FROM historialSuscripcionTienda h
          WHERE (h.actorTipo='administrador' AND h.idAdministradorActor IS NULL)
             OR (h.actorTipo<>'administrador' AND h.idAdministradorActor IS NOT NULL)
         ) historialInvalido,
         (SELECT COUNT(*) FROM operacionSuscripcionTienda
          WHERE claveHash NOT REGEXP '^[0-9a-f]{64}$'
             OR huellaSolicitud NOT REGEXP '^[0-9a-f]{64}$'
         ) operacionesInvalidas`
    );
    if (Object.values(invalid).some((value) => Number(value) > 0)) return false;
  }
  if (file === '023_estructura_pagos_suscripcion.sql') {
    const [[catalog]] = await connection.query(
      `SELECT
         (SELECT COUNT(*) FROM plan
          WHERE codigo IN ('basico','standard','pro')
            AND activo=1 AND visiblePublicamente=1 AND esLegado=0) publicPlans,
         (SELECT COUNT(*) FROM plan
          WHERE codigo='avanzado' AND esLegado=1 AND visiblePublicamente=0) legacyPlans,
         (SELECT COUNT(*) FROM precioPlanPeriodo pp
          JOIN plan p ON p.idPlan=pp.idPlan
          WHERE p.codigo IN ('basico','standard','pro')
            AND pp.monedaBase='USD' AND pp.versionPrecio=1
            AND pp.periodo IN ('mensual','trimestral','anual')) seededPrices,
         (SELECT COUNT(*) FROM metodoPagoSuscripcion
          WHERE codigo IN ('qr_manual','transferencia_deposito','efectivo_administrativo')) methods,
         (SELECT COUNT(*) FROM plan p
          JOIN planFuncionalidad pf ON pf.idPlan=p.idPlan AND pf.habilitada=1
          JOIN funcionalidad f ON f.idFuncionalidad=pf.idFuncionalidad
          WHERE p.codigo IN ('basico','standard','pro')
            AND f.codigo IN ('portal_clientes','reportes_avanzados')) excludedFeatures`
    );
    if (Number(catalog.publicPlans) !== 3
      || Number(catalog.legacyPlans) !== 1
      || Number(catalog.seededPrices) !== 9
      || Number(catalog.methods) !== 3
      || Number(catalog.excludedFeatures) !== 0) return false;
    const [[invalid]] = await connection.query(
      `SELECT
         (SELECT COUNT(*) FROM precioPlanPeriodo
          WHERE monedaBase<>'USD' OR monto<=0 OR versionPrecio<1) prices,
         (SELECT COUNT(*) FROM tipoCambioSuscripcion
          WHERE monedaOrigen<>'USD' OR monedaDestino<>'BOB' OR valor<=0) rates,
         (SELECT COUNT(*) FROM solicitudPagoSuscripcion
          WHERE monedaBase<>'USD' OR monedaCobro<>'BOB'
             OR precioBaseUSD<=0 OR tipoCambioUsdBob<=0
             OR montoCalculadoBOB<=0 OR montoFinalBOB<=0) requests,
         (SELECT COUNT(*) FROM comprobantePagoSuscripcion
          WHERE hashSha256 NOT REGEXP '^[0-9a-f]{64}$'
             OR tamanoBytes NOT BETWEEN 1 AND 5242880) receipts,
         (SELECT COUNT(*) FROM operacionPagoSuscripcion
          WHERE claveHash NOT REGEXP '^[0-9a-f]{64}$'
             OR huellaPayload NOT REGEXP '^[0-9a-f]{64}$') operations`
    );
    if (Object.values(invalid).some((value) => Number(value) > 0)) return false;
  }
  return true;
}

async function validatePosMigrationData(connection) {
  const [[duplicateDebts]] = await connection.query(
    `SELECT COUNT(*) total FROM (
       SELECT idTienda, idVenta FROM fiado
       WHERE idVenta IS NOT NULL GROUP BY idTienda, idVenta HAVING COUNT(*)>1
     ) duplicados`
  );
  if (Number(duplicateDebts.total) > 0) {
    throw new Error(`La migracion 008 no puede continuar: existen ${duplicateDebts.total} ventas con mas de un fiado asociado.`);
  }
  const [[inconsistentDebts]] = await connection.query(
    `SELECT COUNT(*) total
     FROM fiado f
     JOIN venta v ON v.idTienda=f.idTienda AND v.idVenta=f.idVenta
     WHERE ABS((f.totalPagado+f.saldoPendiente)-v.total)>=0.01`
  );
  if (Number(inconsistentDebts.total) > 0) {
    throw new Error(`La migracion 008 no puede continuar: existen ${inconsistentDebts.total} fiados cuyo pago y saldo no coinciden con la venta original.`);
  }
  if (await hasColumns(connection, 'producto', ['codigoBarras'])) {
    const [[duplicateBarcodes]] = await connection.query(
      `SELECT COUNT(*) total FROM (
         SELECT idTienda, codigoBarras FROM producto
         WHERE codigoBarras IS NOT NULL AND codigoBarras<>''
         GROUP BY idTienda, codigoBarras HAVING COUNT(*)>1
       ) duplicados`
    );
    if (Number(duplicateBarcodes.total) > 0) {
      throw new Error(`La migracion 008 no puede continuar: existen ${duplicateBarcodes.total} codigos de barras locales duplicados por tienda.`);
    }
  }
}

const multitenantTables = [
  'cliente',
  'proveedor',
  'producto',
  'venta',
  'compra',
  'fiado',
  'detalleVenta',
  'detalleCompra',
  'detalleFiado',
  'pagoFiado'
];

const multitenantRelations = [
  ['producto', 'idProveedor', 'proveedor', 'idProveedor'],
  ['venta', 'idCliente', 'cliente', 'idCliente'],
  ['compra', 'idProveedor', 'proveedor', 'idProveedor'],
  ['fiado', 'idCliente', 'cliente', 'idCliente'],
  ['fiado', 'idVenta', 'venta', 'idVenta'],
  ['detalleVenta', 'idVenta', 'venta', 'idVenta'],
  ['detalleVenta', 'idProducto', 'producto', 'idProducto'],
  ['detalleCompra', 'idCompra', 'compra', 'idCompra'],
  ['detalleCompra', 'idProducto', 'producto', 'idProducto'],
  ['detalleFiado', 'idFiado', 'fiado', 'idFiado'],
  ['detalleFiado', 'idProducto', 'producto', 'idProducto'],
  ['pagoFiado', 'idFiado', 'fiado', 'idFiado']
];

const catalogForeignKeyDefinitions = {
  fk_productoMaestro_categoria: {
    childTable: 'productoMaestro',
    childColumn: 'idCategoriaMaestra',
    parentTable: 'categoriaMaestra',
    parentColumn: 'idCategoriaMaestra'
  },
  fk_productoMaestro_marca: {
    childTable: 'productoMaestro',
    childColumn: 'idMarcaMaestra',
    parentTable: 'marcaMaestra',
    parentColumn: 'idMarcaMaestra'
  },
  fk_producto_productoMaestro: {
    childTable: 'producto',
    childColumn: 'idProductoMaestro',
    parentTable: 'productoMaestro',
    parentColumn: 'idProductoMaestro'
  },
  fk_auditoriaCatalogo_admin: {
    childTable: 'auditoriaCatalogo',
    childColumn: 'idAdministrador',
    parentTable: 'administrador',
    parentColumn: 'idAdministrador'
  }
};

async function columnDefinition(connection, table, column) {
  const [rows] = await connection.query(
    `SELECT COLUMN_TYPE, IS_NULLABLE, CHARACTER_SET_NAME, COLLATION_NAME
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND COLUMN_NAME=?`,
    [process.env.DB_NAME, table, column]
  );
  return rows[0] || null;
}

async function tableEngine(connection, table) {
  const [rows] = await connection.query(
    `SELECT ENGINE FROM information_schema.TABLES
     WHERE TABLE_SCHEMA=? AND TABLE_NAME=?`,
    [process.env.DB_NAME, table]
  );
  return rows[0]?.ENGINE || null;
}

async function hasPrimaryIndexOnColumn(connection, table, column) {
  const [[row]] = await connection.query(
    `SELECT COUNT(*) total FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND INDEX_NAME='PRIMARY'
       AND COLUMN_NAME=? AND SEQ_IN_INDEX=1`,
    [process.env.DB_NAME, table, column]
  );
  return Number(row.total) > 0;
}

async function validateCatalogForeignKey(connection, element, stepLabel) {
  const definition = catalogForeignKeyDefinitions[element?.name];
  if (!definition) return;
  const [child, parent, childEngine, parentEngine, parentIndexed] = await Promise.all([
    columnDefinition(connection, definition.childTable, definition.childColumn),
    columnDefinition(connection, definition.parentTable, definition.parentColumn),
    tableEngine(connection, definition.childTable),
    tableEngine(connection, definition.parentTable),
    hasPrimaryIndexOnColumn(connection, definition.parentTable, definition.parentColumn)
  ]);
  if (!child || !parent) {
    throw new Error(`${stepLabel}: faltan columnas para crear ${element.name}.`);
  }
  if (String(child.COLUMN_TYPE).toLowerCase() !== String(parent.COLUMN_TYPE).toLowerCase()) {
    throw new Error(
      `${stepLabel}: tipos incompatibles para ${element.name}: `
      + `${definition.childTable}.${definition.childColumn}=${child.COLUMN_TYPE}, `
      + `${definition.parentTable}.${definition.parentColumn}=${parent.COLUMN_TYPE}.`
    );
  }
  if (String(childEngine).toLowerCase() !== 'innodb' || String(parentEngine).toLowerCase() !== 'innodb') {
    throw new Error(
      `${stepLabel}: ${element.name} requiere InnoDB; `
      + `${definition.childTable}=${childEngine || 'sin motor'}, ${definition.parentTable}=${parentEngine || 'sin motor'}.`
    );
  }
  if (!parentIndexed) {
    throw new Error(`${stepLabel}: ${definition.parentTable}.${definition.parentColumn} no tiene la clave primaria esperada.`);
  }
  const [[orphans]] = await connection.query(
    `SELECT COUNT(*) total
     FROM \`${definition.childTable}\` childRow
     LEFT JOIN \`${definition.parentTable}\` parentRow
       ON parentRow.\`${definition.parentColumn}\`=childRow.\`${definition.childColumn}\`
     WHERE childRow.\`${definition.childColumn}\` IS NOT NULL
       AND parentRow.\`${definition.parentColumn}\` IS NULL`
  );
  if (Number(orphans.total) > 0) {
    throw new Error(
      `${stepLabel}: ${element.name} no puede crearse; existen ${orphans.total} referencias huerfanas `
      + `en ${definition.childTable}.${definition.childColumn}.`
    );
  }
  console.log(
    `${stepLabel}: validacion de ${element.name} correcta `
    + `(tipo ${child.COLUMN_TYPE}, hijo nullable=${child.IS_NULLABLE}, padre nullable=${parent.IS_NULLABLE}, InnoDB, huerfanos=0).`
  );
}

async function validateMultitenantData(connection) {
  const problems = [];
  const [[shop]] = await connection.query("SELECT COUNT(*) total FROM tienda WHERE slug='tienda-deisy'");
  if (Number(shop.total) !== 1) problems.push(`slug tienda-deisy: ${shop.total} registros`);

  const [[invalidAdmins]] = await connection.query(
    `SELECT COUNT(*) total
     FROM administrador a
     LEFT JOIN tienda t ON t.idTienda=a.idTienda
     WHERE (a.rol='superadmin' AND a.idTienda IS NOT NULL)
        OR (a.rol='dueno_tienda' AND (a.idTienda IS NULL OR t.idTienda IS NULL))`
  );
  if (Number(invalidAdmins.total) > 0) {
    problems.push(`administrador: ${invalidAdmins.total} roles sin una tienda valida`);
  }

  for (const table of multitenantTables) {
    const [[invalidTenant]] = await connection.query(
      `SELECT COUNT(*) total
       FROM \`${table}\` r
       LEFT JOIN tienda t ON t.idTienda=r.idTienda
       WHERE r.idTienda IS NULL OR t.idTienda IS NULL`
    );
    if (Number(invalidTenant.total) > 0) {
      problems.push(`${table}: ${invalidTenant.total} registros sin tienda valida`);
    }
  }

  for (const [child, childColumn, parent, parentColumn] of multitenantRelations) {
    const [[mismatch]] = await connection.query(
      `SELECT COUNT(*) total
       FROM \`${child}\` c
       LEFT JOIN \`${parent}\` p ON p.\`${parentColumn}\`=c.\`${childColumn}\`
       WHERE c.\`${childColumn}\` IS NOT NULL
         AND (p.\`${parentColumn}\` IS NULL OR NOT (c.idTienda <=> p.idTienda))`
    );
    if (Number(mismatch.total) > 0) {
      problems.push(`${child}.${childColumn} -> ${parent}.${parentColumn}: ${mismatch.total} relaciones huerfanas o cruzadas`);
    }
  }

  if (problems.length) {
    throw new Error(`Validacion previa de 004 rechazada. No se crearon indices ni restricciones multi-tienda: ${problems.join('; ')}.`);
  }
}

function beginsMultitenantConstraintPhase(statement) {
  const normalized = statement.replace(/\s+/g, ' ').trim();
  return /^ALTER TABLE .+ ADD (?:(?:UNIQUE )?INDEX|CONSTRAINT)\b/i.test(normalized);
}

function structureElementFromStatement(statement) {
  const normalized = statement.replace(/\s+/g, ' ').trim();
  const column = normalized.match(/^ALTER TABLE\s+`?([A-Za-z0-9_]+)`?\s+ADD COLUMN\s+`?([A-Za-z0-9_]+)`?/i);
  if (column) return { type: 'columna', table: column[1], name: column[2] };

  const modifiedColumn = normalized.match(
    /^ALTER TABLE\s+`?([A-Za-z0-9_]+)`?\s+MODIFY COLUMN\s+`?([A-Za-z0-9_]+)`?\s+([A-Za-z]+(?:\(\d+(?:,\d+)?\))?)(.*)$/i
  );
  if (modifiedColumn) {
    const defaultMatch = modifiedColumn[4].match(/\bDEFAULT\s+('(?:[^']|'')*'|[^\s,]+)/i);
    const rawDefault = defaultMatch ? defaultMatch[1].replace(/^'|'$/g, '') : null;
    return {
      type: 'definicion_columna',
      table: modifiedColumn[1],
      name: modifiedColumn[2],
      expected: {
        type: modifiedColumn[3],
        nullable: !/\bNOT NULL\b/i.test(modifiedColumn[4]),
        defaultValue: rawDefault
      }
    };
  }

  const index = normalized.match(/^ALTER TABLE\s+`?([A-Za-z0-9_]+)`?\s+ADD\s+(?:UNIQUE\s+)?INDEX\s+`?([A-Za-z0-9_]+)`?/i);
  if (index) return { type: 'indice', table: index[1], name: index[2] };

  const droppedCheck = normalized.match(
    /^ALTER TABLE\s+`?([A-Za-z0-9_]+)`?\s+DROP CHECK\s+`?([A-Za-z0-9_]+)`?/i
  );
  if (droppedCheck) {
    return { type: 'restriccion_eliminada', table: droppedCheck[1], name: droppedCheck[2] };
  }

  const constraint = normalized.match(/^ALTER TABLE\s+`?([A-Za-z0-9_]+)`?\s+ADD CONSTRAINT\s+`?([A-Za-z0-9_]+)`?/i);
  if (constraint) return { type: 'restriccion', table: constraint[1], name: constraint[2] };

  return null;
}

async function structureElementExists(connection, element, file = null) {
  if (!element) return false;
  if (element.type === 'restriccion_eliminada') {
    return !await normalizedHasConstraint(connection, element.table, element.name);
  }
  if (element.type === 'definicion_columna') {
    const details = await normalizedColumnDetails(connection, element.table, [element.name]);
    return columnDefinitionMatches(details[normalizedIdentifier(element.name)], element.expected);
  }
  if ([
    '011_lotes_vencimientos.sql',
    '012_clientes_fiados_comunicacion.sql',
    '013_seguridad_sesiones.sql',
    '014_operaciones_compensatorias.sql',
    '015_compensaciones_venta_inventario.sql',
    '016_compensaciones_financieras.sql',
    '017_integracion_compensaciones.sql',
    '018_auditoria_administrativa_critica.sql'
  ].includes(file)) {
    if (element.type === 'columna') {
      const details = await normalizedColumnDetails(connection, element.table, [element.name]);
      return Boolean(details[normalizedIdentifier(element.name)]);
    }
    if (element.type === 'indice') {
      const [[row]] = await connection.query(
        `SELECT COUNT(*) total FROM information_schema.STATISTICS
         WHERE TABLE_SCHEMA=? AND LOWER(TABLE_NAME)=LOWER(?) AND LOWER(INDEX_NAME)=LOWER(?)`,
        [process.env.DB_NAME, element.table, element.name]
      );
      return Number(row.total) > 0;
    }
    return normalizedHasConstraint(connection, element.table, element.name);
  }
  if (element.type === 'columna') return hasColumns(connection, element.table, [element.name]);
  if (element.type === 'indice') return hasIndexNamed(connection, element.table, element.name);
  return hasConstraint(connection, element.table, element.name);
}

function presenceSummary(items) {
  return {
    presentes: items.filter((item) => item.exists).length,
    esperados: items.length,
    faltantes: items.filter((item) => !item.exists).map((item) => item.name)
  };
}

async function inspect004State(connection, recorded) {
  const storeTableExists = await hasTable(connection, 'tienda');
  let deisyStores = 0;
  if (storeTableExists) {
    const [[row]] = await connection.query("SELECT COUNT(*) total FROM tienda WHERE slug='tienda-deisy'");
    deisyStores = Number(row.total);
  }

  const idTiendaTables = ['administrador', ...multitenantTables];
  const columns = [];
  for (const table of idTiendaTables) {
    columns.push({
      name: `${table}.idTienda`,
      exists: await hasColumns(connection, table, ['idTienda'])
    });
  }

  const requirements = migrationRequirements['004_multitienda_base.sql'];
  const indexes = [];
  for (const [table, name] of requirements.indexes) {
    indexes.push({ name: `${table}.${name}`, exists: await hasIndexNamed(connection, table, name) });
  }

  const constraints = [];
  for (const [table, name] of [...requirements.checks, ...requirements.foreignKeyConstraints]) {
    constraints.push({ name: `${table}.${name}`, exists: await hasConstraint(connection, table, name) });
  }

  console.log('Estado previo detectado para 004_multitienda_base.sql:');
  console.log(JSON.stringify({
    registradaEnSchemaMigrations: recorded,
    tablaTienda: storeTableExists,
    tiendasConSlugDeisy: deisyStores,
    columnasIdTienda: presenceSummary(columns),
    indices004: presenceSummary(indexes),
    restricciones004: presenceSummary(constraints)
  }, null, 2));
}

async function read006State(connection, recorded) {
  const requirements = migrationRequirements['006_catalogo_maestro.sql'];
  const estado006 = {
    migracion006Registrada: Boolean(recorded),
    tablas: {},
    columnas: {},
    indices: {},
    clavesForaneas: {},
    datos: {
      funcionalidadesCatalogoMaestro: null,
      planesConCatalogoMaestro: null,
      vinculosDuplicados: null,
      referenciasMaestrasInvalidas: null,
      vinculosLocalesInvalidos: null
    },
    estructuraCompleta: false,
    datosValidos: false
  };

  const relatedTables = [
    ...Object.keys(requirements.columns),
    'plan',
    'funcionalidad',
    'planFuncionalidad'
  ];
  for (const table of relatedTables) {
    estado006.tablas[table] = await hasTable(connection, table);
  }
  for (const [table, requiredColumns] of Object.entries(requirements.columns)) {
    estado006.columnas[table] = await hasColumns(connection, table, requiredColumns);
  }
  for (const [table, name, indexedColumns, unique] of requirements.indexes) {
    estado006.indices[`${table}.${name}`] = await hasIndex(connection, table, name, indexedColumns, unique);
  }
  for (const relation of requirements.foreignKeyConstraints) {
    const [table, name] = relation;
    estado006.clavesForaneas[`${table}.${name}`] = await hasForeignKeyConstraint(
      connection, ...relation
    );
  }

  const catalogTables = Object.keys(requirements.columns);
  estado006.estructuraCompleta = catalogTables.every((table) => estado006.tablas[table])
    && Object.values(estado006.columnas).every(Boolean)
    && Object.values(estado006.indices).every(Boolean)
    && Object.values(estado006.clavesForaneas).every(Boolean);

  const subscriptionTablesReady = ['plan', 'funcionalidad', 'planFuncionalidad']
    .every((table) => estado006.tablas[table]);
  if (subscriptionTablesReady) {
    const [[feature]] = await connection.query(
      "SELECT COUNT(*) total FROM funcionalidad WHERE codigo='catalogo_maestro'"
    );
    estado006.datos.funcionalidadesCatalogoMaestro = Number(feature.total);
    const [[planAccess]] = await connection.query(
      `SELECT COUNT(DISTINCT p.codigo) total
       FROM planFuncionalidad pf
       JOIN plan p ON p.idPlan=pf.idPlan
       JOIN funcionalidad f ON f.idFuncionalidad=pf.idFuncionalidad
       WHERE f.codigo='catalogo_maestro' AND pf.habilitada=1
         AND f.activo=1 AND p.codigo IN ('basico','avanzado')`
    );
    estado006.datos.planesConCatalogoMaestro = Number(planAccess.total);
  }

  if (estado006.estructuraCompleta) {
    const [[duplicateLinks]] = await connection.query(
      `SELECT COUNT(*) total FROM (
         SELECT idTienda, idProductoMaestro
         FROM producto
         WHERE idProductoMaestro IS NOT NULL
         GROUP BY idTienda, idProductoMaestro HAVING COUNT(*)>1
       ) duplicados`
    );
    estado006.datos.vinculosDuplicados = Number(duplicateLinks.total);
    const [[invalidMasterTaxonomy]] = await connection.query(
      `SELECT COUNT(*) total
       FROM productoMaestro pm
       LEFT JOIN categoriaMaestra c ON c.idCategoriaMaestra=pm.idCategoriaMaestra
       LEFT JOIN marcaMaestra m ON m.idMarcaMaestra=pm.idMarcaMaestra
       WHERE (pm.idCategoriaMaestra IS NOT NULL AND c.idCategoriaMaestra IS NULL)
          OR (pm.idMarcaMaestra IS NOT NULL AND m.idMarcaMaestra IS NULL)`
    );
    estado006.datos.referenciasMaestrasInvalidas = Number(invalidMasterTaxonomy.total);
    const [[invalidLocalMaster]] = await connection.query(
      `SELECT COUNT(*) total
       FROM producto p
       LEFT JOIN productoMaestro pm ON pm.idProductoMaestro=p.idProductoMaestro
       WHERE p.idProductoMaestro IS NOT NULL AND pm.idProductoMaestro IS NULL`
    );
    estado006.datos.vinculosLocalesInvalidos = Number(invalidLocalMaster.total);
  }

  estado006.datosValidos = estado006.datos.funcionalidadesCatalogoMaestro === 1
    && estado006.datos.planesConCatalogoMaestro === 2
    && estado006.datos.vinculosDuplicados === 0
    && estado006.datos.referenciasMaestrasInvalidas === 0
    && estado006.datos.vinculosLocalesInvalidos === 0;

  return estado006;
}

function inspect006State(estado006) {
  console.log('Estado previo detectado para 006_catalogo_maestro.sql:');
  console.log(JSON.stringify(estado006, null, 2));
}

function decide006Action(estado006) {
  const complete = estado006.estructuraCompleta && estado006.datosValidos;
  if (estado006.migracion006Registrada) {
    return complete ? 'continuar' : 'detener';
  }
  return complete ? 'registrar' : 'recuperar';
}

async function missingRequirementElements(connection, file) {
  const requirements = migrationRequirements[file] || {};
  const missing = [];
  for (const [table, columns] of Object.entries(requirements.columns || {})) {
    for (const column of columns) {
      if (!await hasColumns(connection, table, [column])) missing.push(`columna ${table}.${column}`);
    }
  }
  for (const [table, name, columns, unique] of requirements.indexes || []) {
    if (!await hasIndex(connection, table, name, columns, unique)) missing.push(`indice ${table}.${name}`);
  }
  for (const [table, name] of requirements.checks || []) {
    if (!await hasCheckConstraint(connection, table, name)) missing.push(`check ${table}.${name}`);
  }
  for (const relation of requirements.foreignKeyConstraints || []) {
    const [table, name] = relation;
    if (!await hasForeignKeyConstraint(connection, ...relation)) {
      missing.push(`restriccion ${table}.${name}`);
    }
  }
  return missing;
}

async function inspect008State(connection, recorded) {
  const requirements = migrationRequirements['008_punto_venta_pagos.sql'];
  const state = {
    migracion008Registrada: Boolean(recorded),
    tablaPagoVenta: await hasTable(connection, 'pagoVenta'),
    columnas: {},
    indices: {},
    checks: {},
    clavesForaneas: {},
    estructuraCompleta: false,
    datosValidos: false
  };
  for (const [table, columns] of Object.entries(requirements.columns)) {
    state.columnas[table] = await hasTable(connection, table) && await hasColumns(connection, table, columns);
  }
  for (const [table, name, columns, unique] of requirements.indexes) {
    state.indices[`${table}.${name}`] = await hasIndex(connection, table, name, columns, unique);
  }
  for (const [table, name] of requirements.checks) {
    state.checks[`${table}.${name}`] = await hasCheckConstraint(connection, table, name);
  }
  for (const relation of requirements.foreignKeyConstraints) {
    state.clavesForaneas[`${relation[0]}.${relation[1]}`] = await hasForeignKeyConstraint(connection, ...relation);
  }
  state.estructuraCompleta = state.tablaPagoVenta
    && Object.values(state.columnas).every(Boolean)
    && Object.values(state.indices).every(Boolean)
    && Object.values(state.checks).every(Boolean)
    && Object.values(state.clavesForaneas).every(Boolean);
  if (state.estructuraCompleta) state.datosValidos = await requirementsSatisfied(connection, '008_punto_venta_pagos.sql');
  console.log('Estado previo detectado para 008_punto_venta_pagos.sql:');
  console.log(JSON.stringify(state, null, 2));
  return state;
}

async function inspect009State(connection, recorded) {
  const requirements = migrationRequirements['009_finanzas_reportes_caja.sql'];
  const estado009 = {
    migracion009Registrada: Boolean(recorded),
    tablas: {},
    columnas: {},
    indices: {},
    checks: {},
    clavesForaneas: {},
    estructuraCompleta: false,
    datosValidos: false
  };
  for (const table of Object.keys(requirements.columns)) {
    estado009.tablas[table] = await hasTable(connection, table);
  }
  for (const [table, columns] of Object.entries(requirements.columns)) {
    estado009.columnas[table] = estado009.tablas[table] && await hasColumns(connection, table, columns);
  }
  for (const [table, name, columns, unique] of requirements.indexes) {
    estado009.indices[`${table}.${name}`] = await hasIndex(connection, table, name, columns, unique);
  }
  for (const [table, name] of requirements.checks) {
    estado009.checks[`${table}.${name}`] = await hasCheckConstraint(connection, table, name);
  }
  for (const relation of requirements.foreignKeyConstraints) {
    estado009.clavesForaneas[`${relation[0]}.${relation[1]}`] = await hasForeignKeyConstraint(connection, ...relation);
  }
  estado009.estructuraCompleta = Object.values(estado009.tablas).every(Boolean)
    && Object.values(estado009.columnas).every(Boolean)
    && Object.values(estado009.indices).every(Boolean)
    && Object.values(estado009.checks).every(Boolean)
    && Object.values(estado009.clavesForaneas).every(Boolean);
  if (estado009.estructuraCompleta) {
    estado009.datosValidos = await requirementsSatisfied(connection, '009_finanzas_reportes_caja.sql');
  }
  console.log('Estado previo detectado para 009_finanzas_reportes_caja.sql:');
  console.log(JSON.stringify(estado009, null, 2));
  return estado009;
}

async function inspect010State(connection, recorded) {
  const requirements = migrationRequirements['010_inteligencia_inventario.sql'];
  const estado010 = {
    migracion010Registrada: Boolean(recorded),
    tablas: {},
    columnas: {},
    indices: {},
    checks: {},
    clavesForaneas: {},
    estructuraCompleta: false,
    datosValidos: false
  };
  for (const table of Object.keys(requirements.columns)) {
    estado010.tablas[table] = await hasTable(connection, table);
  }
  for (const [table, columns] of Object.entries(requirements.columns)) {
    estado010.columnas[table] = estado010.tablas[table] && await hasColumns(connection, table, columns);
  }
  for (const [table, name, columns, unique] of requirements.indexes) {
    estado010.indices[`${table}.${name}`] = await hasIndex(connection, table, name, columns, unique);
  }
  for (const [table, name] of requirements.checks) {
    estado010.checks[`${table}.${name}`] = await hasCheckConstraint(connection, table, name);
  }
  for (const relation of requirements.foreignKeyConstraints) {
    estado010.clavesForaneas[`${relation[0]}.${relation[1]}`] = await hasForeignKeyConstraint(connection, ...relation);
  }
  estado010.estructuraCompleta = Object.values(estado010.tablas).every(Boolean)
    && Object.values(estado010.columnas).every(Boolean)
    && Object.values(estado010.indices).every(Boolean)
    && Object.values(estado010.checks).every(Boolean)
    && Object.values(estado010.clavesForaneas).every(Boolean);
  if (estado010.estructuraCompleta) {
    estado010.datosValidos = await requirementsSatisfied(connection, '010_inteligencia_inventario.sql');
  }
  console.log('Estado previo detectado para 010_inteligencia_inventario.sql:');
  console.log(JSON.stringify(estado010, null, 2));
  return estado010;
}

async function migrationCount(connection, sql, params = []) {
  const [[row]] = await connection.query(sql, params);
  return Number(row.total || 0);
}

async function inspect011Data(connection, estado011) {
  const datos = {
    configuracionesAlertaInvalidas: null,
    productosConfiguracionLotesInvalida: null,
    productosActivacionIncoherente: null,
    productosConLotesActivos: null,
    lotesInvalidos: null,
    lotesReferenciasInvalidas: null,
    lotesEnProductosSinControl: null,
    lotesSinVencimientoRequerido: null,
    lotesClavesDuplicadas: null,
    lotesSinMovimiento: null,
    lotesSaldoFinalIncoherente: null,
    movimientosLoteInvalidos: null,
    movimientosLoteReferenciasInvalidas: null,
    movimientosLoteClavesDuplicadas: null,
    reconciliacionesInvalidas: null,
    movimientosStockSinCoberturaLote: null,
    funcionalidadesActivas: null,
    accesosAvanzado: null,
    accesosBasico: null,
    funcionalidadesDuplicadas: null,
    accesosPlanDuplicados: null,
    lotes: null,
    movimientosLote: null
  };

  if (estado011.columnas.configuracionInventarioTienda) {
    datos.configuracionesAlertaInvalidas = await migrationCount(connection,
      `SELECT COUNT(*) total FROM configuracionInventarioTienda
       WHERE diasAlertaVencimientoDefault NOT BETWEEN 1 AND 365`);
  }
  if (estado011.columnas.producto) {
    datos.productosConfiguracionLotesInvalida = await migrationCount(connection,
      `SELECT COUNT(*) total FROM producto
       WHERE controlaLotes NOT IN (0,1)
          OR controlaVencimiento NOT IN (0,1)
          OR (controlaVencimiento=1 AND controlaLotes=0)
          OR (diasAlertaVencimiento IS NOT NULL AND diasAlertaVencimiento NOT BETWEEN 1 AND 365)`);
    datos.productosActivacionIncoherente = await migrationCount(connection,
      `SELECT COUNT(*) total FROM producto
       WHERE (controlaLotes=0 AND lotesActivadosEn IS NOT NULL)
          OR (controlaLotes=1 AND lotesActivadosEn IS NULL)`);
    datos.productosConLotesActivos = await migrationCount(connection,
      'SELECT COUNT(*) total FROM producto WHERE controlaLotes=1');
  }

  if (estado011.columnas.loteProducto) {
    datos.lotes = await migrationCount(connection, 'SELECT COUNT(*) total FROM loteProducto');
    datos.lotesInvalidos = await migrationCount(connection,
      `SELECT COUNT(*) total FROM loteProducto
       WHERE cantidadInicial<=0 OR cantidadRestante<0 OR cantidadRestante>cantidadInicial
          OR costoUnitarioBase<0
          OR (fechaVencimiento IS NOT NULL AND fechaVencimiento<DATE(fechaIngreso))
          OR (codigoLote IS NOT NULL AND CHAR_LENGTH(TRIM(codigoLote))=0)
          OR (origen='compra' AND idDetalleCompra IS NULL)
          OR (origen<>'compra' AND idDetalleCompra IS NOT NULL)
          OR (estadoOperativo='anulado' AND cantidadRestante<>0)`);
    datos.lotesReferenciasInvalidas = await migrationCount(connection,
      `SELECT COUNT(*) total FROM loteProducto l
       LEFT JOIN tienda t ON t.idTienda=l.idTienda
       LEFT JOIN producto p ON p.idTienda=l.idTienda AND p.idProducto=l.idProducto
       LEFT JOIN proveedor pr ON pr.idTienda=l.idTienda AND pr.idProveedor=l.idProveedor
       LEFT JOIN detalleCompra dc
         ON dc.idTienda=l.idTienda AND dc.idProducto=l.idProducto
        AND dc.idDetalleCompra=l.idDetalleCompra
       LEFT JOIN compra c ON c.idTienda=dc.idTienda AND c.idCompra=dc.idCompra
       LEFT JOIN administrador ac
         ON ac.idTienda=l.idTienda AND ac.idAdministrador=l.idAdministradorCrea
       LEFT JOIN administrador au
         ON au.idTienda=l.idTienda AND au.idAdministrador=l.idAdministradorActualiza
       WHERE t.idTienda IS NULL OR p.idProducto IS NULL OR ac.idAdministrador IS NULL
          OR (l.idProveedor IS NOT NULL AND pr.idProveedor IS NULL)
          OR (l.idDetalleCompra IS NOT NULL AND dc.idDetalleCompra IS NULL)
          OR (l.origen='compra' AND c.idCompra IS NULL)
          OR (l.idProveedor IS NOT NULL AND c.idProveedor IS NOT NULL AND l.idProveedor<>c.idProveedor)
          OR (l.idAdministradorActualiza IS NOT NULL AND au.idAdministrador IS NULL)`);
    datos.lotesEnProductosSinControl = await migrationCount(connection,
      `SELECT COUNT(*) total FROM loteProducto l
       JOIN producto p ON p.idTienda=l.idTienda AND p.idProducto=l.idProducto
       WHERE p.controlaLotes=0`);
    datos.lotesSinVencimientoRequerido = await migrationCount(connection,
      `SELECT COUNT(*) total FROM loteProducto l
       JOIN producto p ON p.idTienda=l.idTienda AND p.idProducto=l.idProducto
       WHERE p.controlaVencimiento=1 AND l.estadoOperativo<>'anulado'
         AND l.cantidadRestante>0 AND l.fechaVencimiento IS NULL`);
    datos.lotesClavesDuplicadas = await migrationCount(connection,
      `SELECT COUNT(*) total FROM (
         SELECT idTienda, claveOperacion FROM loteProducto
         GROUP BY idTienda, claveOperacion HAVING COUNT(*)>1
       ) duplicados`);
  }

  if (estado011.columnas.movimientoLote) {
    datos.movimientosLote = await migrationCount(connection, 'SELECT COUNT(*) total FROM movimientoLote');
    datos.movimientosLoteInvalidos = await migrationCount(connection,
      `SELECT COUNT(*) total FROM movimientoLote
       WHERE cantidad=0 OR cantidadAnterior<0 OR cantidadPosterior<0
          OR cantidadPosterior<>cantidadAnterior+cantidad
          OR (tipoRegistro='distribucion_inicial'
              AND (idMovimientoStock IS NOT NULL OR cantidad<=0))
          OR (tipoRegistro='movimiento_stock' AND idMovimientoStock IS NULL)`);
    datos.movimientosLoteReferenciasInvalidas = await migrationCount(connection,
      `SELECT COUNT(*) total FROM movimientoLote ml
       LEFT JOIN producto p ON p.idTienda=ml.idTienda AND p.idProducto=ml.idProducto
       LEFT JOIN loteProducto l
         ON l.idTienda=ml.idTienda AND l.idProducto=ml.idProducto
        AND l.idLoteProducto=ml.idLoteProducto
       LEFT JOIN movimientoStock ms
         ON ms.idTienda=ml.idTienda AND ms.idProducto=ml.idProducto
        AND ms.idMovimientoStock=ml.idMovimientoStock
       LEFT JOIN administrador a
         ON a.idTienda=ml.idTienda AND a.idAdministrador=ml.idAdministrador
       WHERE p.idProducto IS NULL OR l.idLoteProducto IS NULL OR a.idAdministrador IS NULL
          OR (ml.idMovimientoStock IS NOT NULL AND ms.idMovimientoStock IS NULL)`);
    datos.movimientosLoteClavesDuplicadas = await migrationCount(connection,
      `SELECT COUNT(*) total FROM (
         SELECT idTienda, claveOperacion FROM movimientoLote
         GROUP BY idTienda, claveOperacion HAVING COUNT(*)>1
       ) duplicados`);
  }

  if (estado011.columnas.loteProducto && estado011.columnas.movimientoLote) {
    datos.lotesSinMovimiento = await migrationCount(connection,
      `SELECT COUNT(*) total FROM loteProducto l
       WHERE NOT EXISTS (
         SELECT 1 FROM movimientoLote ml
         WHERE ml.idTienda=l.idTienda AND ml.idProducto=l.idProducto
           AND ml.idLoteProducto=l.idLoteProducto
       )`);
    datos.lotesSaldoFinalIncoherente = await migrationCount(connection,
      `SELECT COUNT(*) total FROM loteProducto l
       JOIN movimientoLote ml ON ml.idMovimientoLote=(
         SELECT MAX(ultimo.idMovimientoLote) FROM movimientoLote ultimo
         WHERE ultimo.idTienda=l.idTienda AND ultimo.idProducto=l.idProducto
           AND ultimo.idLoteProducto=l.idLoteProducto
       )
       WHERE ml.cantidadPosterior<>l.cantidadRestante`);
  }

  if (estado011.columnas.producto && estado011.columnas.loteProducto) {
    datos.reconciliacionesInvalidas = await migrationCount(connection,
      `SELECT COUNT(*) total FROM (
         SELECT p.idTienda, p.idProducto
         FROM producto p
         LEFT JOIN loteProducto l
           ON l.idTienda=p.idTienda AND l.idProducto=p.idProducto
          AND l.estadoOperativo<>'anulado'
         WHERE p.controlaLotes=1
         GROUP BY p.idTienda, p.idProducto, p.stockUnidadesTotal
         HAVING COALESCE(SUM(l.cantidadRestante),0)<>p.stockUnidadesTotal
       ) diferencias`);
  }
  if (estado011.columnas.producto && estado011.columnas.movimientoLote
    && await normalizedHasTable(connection, 'movimientoStock')) {
    datos.movimientosStockSinCoberturaLote = await migrationCount(connection,
      `SELECT COUNT(*) total FROM (
         SELECT ms.idTienda, ms.idProducto, ms.idMovimientoStock, ms.cantidad
         FROM movimientoStock ms
         JOIN producto p ON p.idTienda=ms.idTienda AND p.idProducto=ms.idProducto
         LEFT JOIN movimientoLote ml
           ON ml.idTienda=ms.idTienda AND ml.idProducto=ms.idProducto
          AND ml.idMovimientoStock=ms.idMovimientoStock
          AND ml.tipoRegistro='movimiento_stock'
         WHERE p.controlaLotes=1 AND p.lotesActivadosEn IS NOT NULL
            AND ms.creadoEn>p.lotesActivadosEn
         GROUP BY ms.idTienda, ms.idProducto, ms.idMovimientoStock, ms.cantidad
         HAVING COALESCE(SUM(ml.cantidad),0)<>ms.cantidad
       ) diferencias`);
  }

  const featureTablesExist = await normalizedHasTable(connection, 'funcionalidad')
    && await normalizedHasTable(connection, 'plan')
    && await normalizedHasTable(connection, 'planFuncionalidad');
  if (featureTablesExist) {
    const placeholders = LOTS_FEATURES.map(() => '?').join(',');
    datos.funcionalidadesActivas = await migrationCount(connection,
      `SELECT COUNT(DISTINCT codigo) total FROM funcionalidad
       WHERE activo=1 AND codigo IN (${placeholders})`, LOTS_FEATURES);
    datos.accesosAvanzado = await migrationCount(connection,
      `SELECT COUNT(DISTINCT f.codigo) total FROM planFuncionalidad pf
       JOIN plan p ON p.idPlan=pf.idPlan
       JOIN funcionalidad f ON f.idFuncionalidad=pf.idFuncionalidad
       WHERE p.codigo='avanzado' AND p.activo=1 AND f.activo=1 AND pf.habilitada=1
         AND f.codigo IN (${placeholders})`, LOTS_FEATURES);
    datos.accesosBasico = await migrationCount(connection,
      `SELECT COUNT(DISTINCT f.codigo) total FROM planFuncionalidad pf
       JOIN plan p ON p.idPlan=pf.idPlan
       JOIN funcionalidad f ON f.idFuncionalidad=pf.idFuncionalidad
       WHERE p.codigo='basico' AND f.activo=1 AND pf.habilitada=1
         AND f.codigo IN (${placeholders})`, LOTS_FEATURES);
    datos.funcionalidadesDuplicadas = await migrationCount(connection,
      `SELECT COUNT(*) total FROM (
         SELECT codigo FROM funcionalidad GROUP BY codigo HAVING COUNT(*)>1
       ) duplicados`);
    datos.accesosPlanDuplicados = await migrationCount(connection,
      `SELECT COUNT(*) total FROM (
         SELECT idPlan, idFuncionalidad FROM planFuncionalidad
         GROUP BY idPlan, idFuncionalidad HAVING COUNT(*)>1
       ) duplicados`);
  }
  return datos;
}

function lotsExpirationDataValid(datos) {
  const zeroChecks = [
    'configuracionesAlertaInvalidas', 'productosConfiguracionLotesInvalida',
    'productosActivacionIncoherente', 'lotesInvalidos', 'lotesReferenciasInvalidas',
    'lotesEnProductosSinControl', 'lotesSinVencimientoRequerido',
    'lotesClavesDuplicadas', 'lotesSinMovimiento', 'lotesSaldoFinalIncoherente',
    'movimientosLoteInvalidos', 'movimientosLoteReferenciasInvalidas',
    'movimientosLoteClavesDuplicadas', 'reconciliacionesInvalidas',
    'movimientosStockSinCoberturaLote', 'funcionalidadesDuplicadas',
    'accesosPlanDuplicados'
  ];
  return zeroChecks.every((key) => datos[key] === 0)
    && datos.funcionalidadesActivas === LOTS_FEATURES.length
    && datos.accesosAvanzado === LOTS_FEATURES.length
    && datos.accesosBasico === 0;
}

async function inspect011State(connection, recorded, { log = true } = {}) {
  const requirements = migrationRequirements['011_lotes_vencimientos.sql'];
  const estado011 = {
    migracion011Registrada: Boolean(recorded),
    tablas: {},
    columnas: {},
    tiposNulabilidadDefaults: {},
    indices: {},
    checks: {},
    clavesForaneas: {},
    motores: {},
    estructuraCompleta: false,
    datosValidos: false,
    datos: null
  };
  const tables = new Set([
    ...Object.keys(requirements.columns),
    ...Object.keys(LOTS_COLUMN_DEFINITIONS),
    'detalleCompra', 'movimientoStock'
  ]);
  for (const table of tables) estado011.tablas[table] = await normalizedHasTable(connection, table);
  for (const [table, columns] of Object.entries(requirements.columns)) {
    const details = estado011.tablas[table] ? await normalizedColumnDetails(connection, table, columns) : {};
    estado011.columnas[table] = columns.every((column) => Boolean(details[normalizedIdentifier(column)]));
  }
  for (const [table, definitions] of Object.entries(LOTS_COLUMN_DEFINITIONS)) {
    const details = estado011.tablas[table]
      ? await normalizedColumnDetails(connection, table, Object.keys(definitions)) : {};
    estado011.tiposNulabilidadDefaults[table] = {};
    for (const [column, expected] of Object.entries(definitions)) {
      estado011.tiposNulabilidadDefaults[table][column] = columnDefinitionMatches(
        details[normalizedIdentifier(column)], expected
      );
    }
  }
  for (const [table, name, columns, unique] of requirements.indexes) {
    estado011.indices[`${table}.${name}`] = await normalizedHasIndex(connection, table, name, columns, unique);
  }
  for (const [table, name] of requirements.checks) {
    estado011.checks[`${table}.${name}`] = await normalizedHasConstraint(connection, table, name, 'CHECK');
  }
  for (const relation of requirements.foreignKeyConstraints) {
    estado011.clavesForaneas[`${relation[0]}.${relation[1]}`] = await normalizedHasForeignKeyConstraint(connection, relation);
  }
  for (const table of ['loteProducto', 'movimientoLote']) {
    if (!estado011.tablas[table]) {
      estado011.motores[table] = false;
      continue;
    }
    const [[engine]] = await connection.query(
      `SELECT ENGINE FROM information_schema.TABLES
       WHERE TABLE_SCHEMA=? AND LOWER(TABLE_NAME)=LOWER(?)`,
      [process.env.DB_NAME, table]
    );
    estado011.motores[table] = normalizedIdentifier(engine?.ENGINE) === 'innodb';
  }
  estado011.estructuraCompleta = Object.values(estado011.tablas).every(Boolean)
    && Object.values(estado011.columnas).every(Boolean)
    && Object.values(estado011.tiposNulabilidadDefaults)
      .every((table) => Object.values(table).every(Boolean))
    && Object.values(estado011.indices).every(Boolean)
    && Object.values(estado011.checks).every(Boolean)
    && Object.values(estado011.clavesForaneas).every(Boolean)
    && Object.values(estado011.motores).every(Boolean);
  estado011.datos = await inspect011Data(connection, estado011);
  estado011.datosValidos = estado011.estructuraCompleta && lotsExpirationDataValid(estado011.datos);
  if (log) {
    console.log('Estado previo detectado para 011_lotes_vencimientos.sql:');
    console.log(JSON.stringify(estado011, null, 2));
  }
  return estado011;
}

async function customerCreditFeatureAccess(connection, planCode, codes) {
  const placeholders = codes.map(() => '?').join(',');
  return migrationCount(connection,
    `SELECT COUNT(DISTINCT f.codigo) total FROM planFuncionalidad pf
     JOIN plan p ON p.idPlan=pf.idPlan
     JOIN funcionalidad f ON f.idFuncionalidad=pf.idFuncionalidad
     WHERE p.codigo=? AND p.activo=1 AND f.activo=1 AND pf.habilitada=1
       AND f.codigo IN (${placeholders})`,
    [planCode, ...codes]);
}

async function inspect012Data(connection, estado012) {
  const data = {
    tiendasSinConfiguracion: null,
    configuracionesInvalidas: null,
    tiendasSinPlantillasDefault: null,
    plantillasDuplicadas: null,
    plantillasInvalidas: null,
    variablesPlantillaInvalidas: null,
    clientesInvalidos: null,
    documentosNormalizadosDuplicados: null,
    fiadosInvalidos: null,
    fiadosSaldoNoReconciliado: null,
    fiadosPagosNoReconciliados: null,
    fiadosFechasIncoherentes: null,
    fiadosCierreIncoherente: null,
    cobrosInvalidos: null,
    cobrosReferenciasCruzadas: null,
    clavesCobroDuplicadas: null,
    cobrosSinDistribucion: null,
    cobrosSumaDistribucionInvalida: null,
    pagosSinCobroOClave: null,
    clavesDistribucionDuplicadas: null,
    pagosCruzados: null,
    cabecerasLegadoInvalidas: null,
    pagosLegadoSinCabeceraDeterministica: null,
    cabecerasLegadoSinPago: null,
    pagosVentaDuplicadosPorPagoFiado: null,
    seguimientosInvalidos: null,
    seguimientosCruzados: null,
    funcionalidadesActivas: null,
    accesosBasicoCore: null,
    accesosAvanzadoCore: null,
    accesosAvanzadoExclusivos: null,
    funcionesAvanzadasEnBasico: null,
    funcionalidadesDuplicadas: null,
    accesosPlanDuplicados: null
  };
  if (estado012.columnas.configuracionCreditoTienda) {
    data.tiendasSinConfiguracion = await migrationCount(connection,
      `SELECT COUNT(*) total FROM tienda t WHERE NOT EXISTS (
         SELECT 1 FROM configuracionCreditoTienda c WHERE c.idTienda=t.idTienda
       )`);
    data.configuracionesInvalidas = await migrationCount(connection,
      `SELECT COUNT(*) total FROM configuracionCreditoTienda c
       LEFT JOIN tienda t ON t.idTienda=c.idTienda
       LEFT JOIN administrador a
         ON a.idTienda=c.idTienda AND a.idAdministrador=c.idAdministradorActualiza
       WHERE t.idTienda IS NULL OR c.creadoEn IS NULL OR c.actualizadoEn IS NULL
          OR (c.limiteCreditoDefault IS NOT NULL AND c.limiteCreditoDefault<0)
          OR c.diasCreditoDefault NOT BETWEEN 1 AND 365
          OR c.diasAvisoVencimiento NOT BETWEEN 0 AND 90
          OR c.requiereTelefonoParaFiado NOT IN (0,1)
          OR c.permiteFiadoSinFecha NOT IN (0,1)
          OR (c.codigoPaisWhatsApp IS NOT NULL
              AND c.codigoPaisWhatsApp NOT REGEXP '^[0-9]{1,8}$')
          OR (c.idAdministradorActualiza IS NOT NULL AND a.idAdministrador IS NULL)`);
  }
  if (estado012.columnas.plantillaCobranzaTienda) {
    data.tiendasSinPlantillasDefault = await migrationCount(connection,
      `SELECT COUNT(*) total FROM tienda t WHERE (
         SELECT COUNT(*) FROM plantillaCobranzaTienda p
         WHERE p.idTienda=t.idTienda AND (
           (p.tipo='recordatorio_previo' AND p.nombre='Recordatorio previo')
           OR (p.tipo='deuda_vencida' AND p.nombre='Deuda vencida')
           OR (p.tipo='confirmacion_pago' AND p.nombre='Confirmacion de pago')
           OR (p.tipo='estado_cuenta' AND p.nombre='Estado de cuenta')
         )
       )<>4`);
    data.plantillasInvalidas = await migrationCount(connection,
      `SELECT COUNT(*) total FROM plantillaCobranzaTienda p
       LEFT JOIN tienda t ON t.idTienda=p.idTienda
       LEFT JOIN administrador a
         ON a.idTienda=p.idTienda AND a.idAdministrador=p.idAdministradorActualiza
       WHERE t.idTienda IS NULL OR p.creadoEn IS NULL OR p.actualizadoEn IS NULL
          OR CHAR_LENGTH(TRIM(p.nombre))=0 OR CHAR_LENGTH(TRIM(p.contenido))=0
          OR p.activo NOT IN (0,1)
          OR (p.idAdministradorActualiza IS NOT NULL AND a.idAdministrador IS NULL)`);
    data.plantillasDuplicadas = await migrationCount(connection,
      `SELECT COUNT(*) total FROM (
         SELECT idTienda, tipo, nombre FROM plantillaCobranzaTienda
         GROUP BY idTienda, tipo, nombre HAVING COUNT(*)>1
       ) duplicadas`);
    const [templates] = await connection.query('SELECT contenido FROM plantillaCobranzaTienda');
    const allowedVariables = new Set([
      'tienda', 'cliente', 'saldo', 'vencimiento', 'dias_atraso', 'comprobante'
    ]);
    data.variablesPlantillaInvalidas = templates.filter((template) => {
      const tokens = String(template.contenido || '').match(/\{[^{}]+\}/g) || [];
      return tokens.some((token) => !allowedVariables.has(token.slice(1, -1)));
    }).length;
  }
  if (estado012.columnas.cliente) {
    data.clientesInvalidos = await migrationCount(connection,
      `SELECT COUNT(*) total FROM cliente c
       LEFT JOIN administrador ac
         ON ac.idTienda=c.idTienda AND ac.idAdministrador=c.idAdministradorCrea
       LEFT JOIN administrador au
         ON au.idTienda=c.idTienda AND au.idAdministrador=c.idAdministradorActualiza
       WHERE c.creadoEn IS NULL OR c.actualizadoEn IS NULL
          OR (c.limiteCredito IS NOT NULL AND c.limiteCredito<0)
          OR c.permiteFiado NOT IN (0,1) OR c.aceptaRecordatorios NOT IN (0,1)
          OR (c.diasCreditoDefault IS NOT NULL AND c.diasCreditoDefault NOT BETWEEN 1 AND 365)
          OR (c.correo IS NOT NULL AND CHAR_LENGTH(TRIM(c.correo))=0)
          OR (c.documentoNormalizado IS NOT NULL AND CHAR_LENGTH(TRIM(c.documentoNormalizado))=0)
          OR (c.telefonoNormalizado IS NOT NULL AND CHAR_LENGTH(TRIM(c.telefonoNormalizado))=0)
          OR (c.idAdministradorCrea IS NOT NULL AND ac.idAdministrador IS NULL)
          OR (c.idAdministradorActualiza IS NOT NULL AND au.idAdministrador IS NULL)`);
    data.documentosNormalizadosDuplicados = await migrationCount(connection,
      `SELECT COUNT(*) total FROM (
         SELECT idTienda, documentoNormalizado FROM cliente
         WHERE documentoNormalizado IS NOT NULL
         GROUP BY idTienda, documentoNormalizado HAVING COUNT(*)>1
       ) duplicados`);
  }
  if (estado012.columnas.fiado) {
    data.fiadosInvalidos = await migrationCount(connection,
      `SELECT COUNT(*) total FROM fiado f
       LEFT JOIN administrador a
         ON a.idTienda=f.idTienda AND a.idAdministrador=f.idAdministradorCrea
       WHERE f.totalFiado<0 OR f.totalPagado<0 OR f.saldoPendiente<0
          OR f.totalPagado>f.totalFiado
          OR (f.idAdministradorCrea IS NOT NULL AND a.idAdministrador IS NULL)`);
    data.fiadosSaldoNoReconciliado = await migrationCount(connection,
      'SELECT COUNT(*) total FROM fiado WHERE ABS((totalFiado-totalPagado)-saldoPendiente)>=0.01');
    data.fiadosPagosNoReconciliados = await migrationCount(connection,
      `SELECT COUNT(*) total FROM (
         SELECT f.idTienda, f.idFiado, f.totalFiado, f.totalPagado, f.saldoPendiente
         FROM fiado f
         LEFT JOIN pagoFiado pf ON pf.idTienda=f.idTienda AND pf.idFiado=f.idFiado
         GROUP BY f.idTienda, f.idFiado, f.totalFiado, f.totalPagado, f.saldoPendiente
         HAVING ABS(COALESCE(SUM(pf.monto),0)-f.totalPagado)>=0.01
            OR ABS((f.totalFiado-COALESCE(SUM(pf.monto),0))-f.saldoPendiente)>=0.01
       ) diferencias`);
    data.fiadosFechasIncoherentes = await migrationCount(connection,
      `SELECT COUNT(*) total FROM fiado f
       JOIN venta v ON v.idTienda=f.idTienda AND v.idVenta=f.idVenta
       WHERE f.fechaVencimiento IS NOT NULL AND f.fechaVencimiento<DATE(v.fecha)`);
    data.fiadosCierreIncoherente = await migrationCount(connection,
      `SELECT COUNT(*) total FROM fiado
       WHERE (saldoPendiente>0 AND cerradoEn IS NOT NULL)
          OR (saldoPendiente=0 AND cerradoEn IS NULL)`);
  }
  if (estado012.columnas.cobroFiado && estado012.columnas.pagoFiado) {
    data.cobrosInvalidos = await migrationCount(connection,
      `SELECT COUNT(*) total FROM cobroFiado
       WHERE montoTotal<=0 OR cambio<0 OR esLegado NOT IN (0,1)
          OR (montoRecibido IS NULL AND cambio<>0)
          OR (montoRecibido IS NOT NULL AND (
                montoRecibido<montoTotal OR ABS((montoRecibido-montoTotal)-cambio)>=0.01
              ))`);
    data.cobrosReferenciasCruzadas = await migrationCount(connection,
      `SELECT COUNT(*) total FROM cobroFiado c
       LEFT JOIN cliente cl ON cl.idTienda=c.idTienda AND cl.idCliente=c.idCliente
       LEFT JOIN administrador a
         ON a.idTienda=c.idTienda AND a.idAdministrador=c.idAdministrador
       WHERE cl.idCliente IS NULL OR (c.idAdministrador IS NOT NULL AND a.idAdministrador IS NULL)`);
    data.clavesCobroDuplicadas = await migrationCount(connection,
      `SELECT COUNT(*) total FROM (
         SELECT idTienda, claveOperacion FROM cobroFiado
         GROUP BY idTienda, claveOperacion HAVING COUNT(*)>1
       ) duplicados`);
    data.cobrosSinDistribucion = await migrationCount(connection,
      `SELECT COUNT(*) total FROM cobroFiado c WHERE NOT EXISTS (
         SELECT 1 FROM pagoFiado pf
         WHERE pf.idTienda=c.idTienda AND pf.idCobroFiado=c.idCobroFiado
       )`);
    data.cobrosSumaDistribucionInvalida = await migrationCount(connection,
      `SELECT COUNT(*) total FROM (
         SELECT c.idTienda, c.idCobroFiado, c.montoTotal
         FROM cobroFiado c
         LEFT JOIN pagoFiado pf
           ON pf.idTienda=c.idTienda AND pf.idCobroFiado=c.idCobroFiado
         GROUP BY c.idTienda, c.idCobroFiado, c.montoTotal
         HAVING ABS(COALESCE(SUM(pf.monto),0)-c.montoTotal)>=0.01
       ) diferencias`);
    data.pagosSinCobroOClave = await migrationCount(connection,
      `SELECT COUNT(*) total FROM pagoFiado
       WHERE idCobroFiado IS NULL OR claveDistribucion IS NULL
          OR CHAR_LENGTH(TRIM(claveDistribucion))=0`);
    data.clavesDistribucionDuplicadas = await migrationCount(connection,
      `SELECT COUNT(*) total FROM (
         SELECT idTienda, claveDistribucion FROM pagoFiado
         GROUP BY idTienda, claveDistribucion HAVING COUNT(*)>1
       ) duplicados`);
    data.pagosCruzados = await migrationCount(connection,
      `SELECT COUNT(*) total FROM pagoFiado pf
       LEFT JOIN fiado f ON f.idTienda=pf.idTienda AND f.idFiado=pf.idFiado
       LEFT JOIN cobroFiado c ON c.idTienda=pf.idTienda AND c.idCobroFiado=pf.idCobroFiado
       WHERE f.idFiado IS NULL OR c.idCobroFiado IS NULL OR f.idCliente<>c.idCliente`);
    data.cabecerasLegadoInvalidas = await migrationCount(connection,
      `SELECT COUNT(*) total FROM cobroFiado c
       WHERE c.esLegado=1 AND (
         c.claveOperacion NOT REGEXP '^legado:pago-fiado:[0-9]+$'
         OR c.montoRecibido IS NOT NULL OR c.cambio<>0
       )`);
    data.pagosLegadoSinCabeceraDeterministica = await migrationCount(connection,
      `SELECT COUNT(*) total FROM pagoFiado pf
       LEFT JOIN cobroFiado c
         ON c.idTienda=pf.idTienda AND c.idCobroFiado=pf.idCobroFiado
       LEFT JOIN pagoVenta pv
         ON pv.idTienda=pf.idTienda AND pv.idPagoFiado=pf.idPagoFiado
       WHERE pf.claveDistribucion=CONCAT('legado:distribucion:',pf.idPagoFiado)
         AND (c.idCobroFiado IS NULL OR c.esLegado<>1
              OR c.claveOperacion<>CONCAT('legado:pago-fiado:',pf.idPagoFiado)
              OR c.montoTotal<>pf.monto OR c.fechaCobro<>pf.fechaPago
              OR c.metodoPago<>COALESCE(pv.metodoPago,'no_especificado')
              OR NOT (c.idAdministrador <=> pv.idAdministrador)
              OR NOT (c.referencia <=> pv.referencia))`);
    data.cabecerasLegadoSinPago = await migrationCount(connection,
      `SELECT COUNT(*) total FROM cobroFiado c
       WHERE c.esLegado=1 AND NOT EXISTS (
         SELECT 1 FROM pagoFiado pf
         WHERE pf.idTienda=c.idTienda AND pf.idCobroFiado=c.idCobroFiado
           AND c.claveOperacion=CONCAT('legado:pago-fiado:',pf.idPagoFiado)
       )`);
  }
  if (estado012.tablas.pagoVenta) {
    data.pagosVentaDuplicadosPorPagoFiado = await migrationCount(connection,
      `SELECT COUNT(*) total FROM (
         SELECT idTienda, idPagoFiado FROM pagoVenta
         WHERE idPagoFiado IS NOT NULL
         GROUP BY idTienda, idPagoFiado HAVING COUNT(*)>1
       ) duplicados`);
  }
  if (estado012.columnas.seguimientoCobranza) {
    data.seguimientosInvalidos = await migrationCount(connection,
      `SELECT COUNT(*) total FROM seguimientoCobranza
       WHERE CHAR_LENGTH(TRIM(detalle))=0
          OR (tipo='compromiso_pago' AND fechaCompromiso IS NULL)`);
    data.seguimientosCruzados = await migrationCount(connection,
      `SELECT COUNT(*) total FROM seguimientoCobranza s
       LEFT JOIN cliente c ON c.idTienda=s.idTienda AND c.idCliente=s.idCliente
       LEFT JOIN fiado f
         ON f.idTienda=s.idTienda AND f.idCliente=s.idCliente AND f.idFiado=s.idFiado
       LEFT JOIN administrador a
         ON a.idTienda=s.idTienda AND a.idAdministrador=s.idAdministrador
       WHERE c.idCliente IS NULL OR a.idAdministrador IS NULL
          OR (s.idFiado IS NOT NULL AND f.idFiado IS NULL)`);
  }
  const featureTablesReady = ['funcionalidad', 'plan', 'planFuncionalidad']
    .every((table) => estado012.tablas[table]);
  if (featureTablesReady) {
    const placeholders = CUSTOMER_CREDIT_FEATURES.map(() => '?').join(',');
    data.funcionalidadesActivas = await migrationCount(connection,
      `SELECT COUNT(DISTINCT codigo) total FROM funcionalidad
       WHERE activo=1 AND codigo IN (${placeholders})`, CUSTOMER_CREDIT_FEATURES);
    data.accesosBasicoCore = await customerCreditFeatureAccess(
      connection, 'basico', CUSTOMER_CREDIT_CORE_FEATURES
    );
    data.accesosAvanzadoCore = await customerCreditFeatureAccess(
      connection, 'avanzado', CUSTOMER_CREDIT_CORE_FEATURES
    );
    data.accesosAvanzadoExclusivos = await customerCreditFeatureAccess(
      connection, 'avanzado', CUSTOMER_CREDIT_ADVANCED_FEATURES
    );
    data.funcionesAvanzadasEnBasico = await customerCreditFeatureAccess(
      connection, 'basico', CUSTOMER_CREDIT_ADVANCED_FEATURES
    );
    data.funcionalidadesDuplicadas = await migrationCount(connection,
      `SELECT COUNT(*) total FROM (
         SELECT codigo FROM funcionalidad GROUP BY codigo HAVING COUNT(*)>1
       ) duplicados`);
    data.accesosPlanDuplicados = await migrationCount(connection,
      `SELECT COUNT(*) total FROM (
         SELECT idPlan, idFuncionalidad FROM planFuncionalidad
         GROUP BY idPlan, idFuncionalidad HAVING COUNT(*)>1
       ) duplicados`);
  }
  return data;
}

function customerCreditDataValid(data) {
  const zeroChecks = [
    'tiendasSinConfiguracion', 'configuracionesInvalidas', 'tiendasSinPlantillasDefault',
    'plantillasDuplicadas', 'plantillasInvalidas', 'variablesPlantillaInvalidas',
    'clientesInvalidos', 'documentosNormalizadosDuplicados',
    'fiadosInvalidos', 'fiadosSaldoNoReconciliado', 'fiadosPagosNoReconciliados',
    'fiadosFechasIncoherentes',
    'fiadosCierreIncoherente', 'cobrosInvalidos', 'cobrosReferenciasCruzadas',
    'clavesCobroDuplicadas',
    'cobrosSinDistribucion', 'cobrosSumaDistribucionInvalida', 'pagosSinCobroOClave',
    'clavesDistribucionDuplicadas', 'pagosCruzados', 'cabecerasLegadoInvalidas',
    'pagosLegadoSinCabeceraDeterministica', 'cabecerasLegadoSinPago',
    'pagosVentaDuplicadosPorPagoFiado',
    'seguimientosInvalidos', 'seguimientosCruzados', 'funcionesAvanzadasEnBasico',
    'funcionalidadesDuplicadas', 'accesosPlanDuplicados'
  ];
  return zeroChecks.every((key) => data[key] === 0)
    && data.funcionalidadesActivas === CUSTOMER_CREDIT_FEATURES.length
    && data.accesosBasicoCore === CUSTOMER_CREDIT_CORE_FEATURES.length
    && data.accesosAvanzadoCore === CUSTOMER_CREDIT_CORE_FEATURES.length
    && data.accesosAvanzadoExclusivos === CUSTOMER_CREDIT_ADVANCED_FEATURES.length;
}

async function inspect012State(connection, recorded, { log = true } = {}) {
  const requirements = migrationRequirements['012_clientes_fiados_comunicacion.sql'];
  const estado012 = {
    migracion012Registrada: Boolean(recorded),
    tablas: {},
    columnas: {},
    tiposNulabilidadDefaults: {},
    indices: {},
    checks: {},
    clavesForaneas: {},
    motores: {},
    estructuraCompleta: false,
    datosValidos: false,
    datos: null
  };
  const tables = new Set([
    ...Object.keys(requirements.columns),
    ...Object.keys(CUSTOMER_CREDIT_COLUMN_DEFINITIONS),
    'tienda', 'administrador', 'plan', 'funcionalidad', 'planFuncionalidad', 'pagoVenta'
  ]);
  for (const table of tables) estado012.tablas[table] = await normalizedHasTable(connection, table);
  for (const [table, columns] of Object.entries(requirements.columns)) {
    const details = estado012.tablas[table]
      ? await normalizedColumnDetails(connection, table, columns) : {};
    estado012.columnas[table] = columns.every(
      (column) => Boolean(details[normalizedIdentifier(column)])
    );
  }
  for (const [table, definitions] of Object.entries(CUSTOMER_CREDIT_COLUMN_DEFINITIONS)) {
    const details = estado012.tablas[table]
      ? await normalizedColumnDetails(connection, table, Object.keys(definitions)) : {};
    estado012.tiposNulabilidadDefaults[table] = {};
    for (const [column, expected] of Object.entries(definitions)) {
      estado012.tiposNulabilidadDefaults[table][column] = columnDefinitionMatches(
        details[normalizedIdentifier(column)], expected
      );
    }
  }
  for (const [table, name, columns, unique] of requirements.indexes) {
    estado012.indices[`${table}.${name}`] = await normalizedHasIndex(
      connection, table, name, columns, unique
    );
  }
  for (const [table, name] of requirements.checks) {
    estado012.checks[`${table}.${name}`] = await normalizedHasConstraint(
      connection, table, name, 'CHECK'
    );
  }
  for (const relation of requirements.foreignKeyConstraints) {
    estado012.clavesForaneas[`${relation[0]}.${relation[1]}`]
      = await normalizedHasForeignKeyConstraint(connection, relation);
  }
  for (const table of [
    'cliente', 'fiado', 'pagoFiado', 'configuracionCreditoTienda', 'cobroFiado',
    'seguimientoCobranza', 'plantillaCobranzaTienda'
  ]) {
    if (!estado012.tablas[table]) {
      estado012.motores[table] = false;
      continue;
    }
    const [[engine]] = await connection.query(
      `SELECT ENGINE FROM information_schema.TABLES
       WHERE TABLE_SCHEMA=? AND LOWER(TABLE_NAME)=LOWER(?)`,
      [process.env.DB_NAME, table]
    );
    estado012.motores[table] = normalizedIdentifier(engine?.ENGINE) === 'innodb';
  }
  estado012.estructuraCompleta = Object.values(estado012.columnas).every(Boolean)
    && Object.values(estado012.tiposNulabilidadDefaults)
      .every((table) => Object.values(table).every(Boolean))
    && Object.values(estado012.indices).every(Boolean)
    && Object.values(estado012.checks).every(Boolean)
    && Object.values(estado012.clavesForaneas).every(Boolean)
    && Object.values(estado012.motores).every(Boolean);
  estado012.datos = await inspect012Data(connection, estado012);
  estado012.datosValidos = estado012.estructuraCompleta
    && customerCreditDataValid(estado012.datos);
  if (log) {
    console.log('Estado previo detectado para 012_clientes_fiados_comunicacion.sql:');
    console.log(JSON.stringify(estado012, null, 2));
  }
  return estado012;
}

async function validateFinancialMigrationData(connection) {
  if (await hasColumns(connection, 'detalleVenta', ['origenCosto'])) {
    const [[invalidCosts]] = await connection.query(
      `SELECT COUNT(*) total FROM detalleVenta
       WHERE costoUnitario<0 OR subtotalCosto<0
          OR origenCosto NOT IN ('real','estimado','desconocido')`
    );
    if (Number(invalidCosts.total) > 0) {
      throw new Error(`La migracion 009 no puede continuar: existen ${invalidCosts.total} detalles con costo invalido.`);
    }
  }
  if (await hasColumns(connection, 'categoriaGasto', ['idTienda', 'nombreNormalizado'])) {
    const [[duplicates]] = await connection.query(
      `SELECT COUNT(*) total FROM (
         SELECT idTienda, nombreNormalizado FROM categoriaGasto
         GROUP BY idTienda, nombreNormalizado HAVING COUNT(*)>1
       ) duplicados`
    );
    if (Number(duplicates.total) > 0) {
      throw new Error(`La migracion 009 no puede continuar: existen ${duplicates.total} categorias de gasto duplicadas por tienda.`);
    }
    const [[invalidCategoryTenants]] = await connection.query(
      `SELECT COUNT(*) total FROM categoriaGasto cg
       LEFT JOIN tienda t ON t.idTienda=cg.idTienda
       WHERE t.idTienda IS NULL`
    );
    if (Number(invalidCategoryTenants.total) > 0) {
      throw new Error(`La migracion 009 no puede continuar: existen ${invalidCategoryTenants.total} categorias ligadas a tiendas inexistentes.`);
    }
  }
  if (await hasColumns(connection, 'categoriaGasto', ['idTienda', 'idCategoriaGasto'])
    && await hasColumns(connection, 'gasto', ['idTienda', 'idCategoriaGasto', 'idAdministrador', 'monto'])) {
    const [[invalidExpenses]] = await connection.query(
      `SELECT COUNT(*) total FROM gasto g
       LEFT JOIN categoriaGasto cg ON cg.idTienda=g.idTienda AND cg.idCategoriaGasto=g.idCategoriaGasto
       LEFT JOIN administrador a ON a.idTienda=g.idTienda AND a.idAdministrador=g.idAdministrador
       WHERE g.monto<=0 OR cg.idCategoriaGasto IS NULL OR a.idAdministrador IS NULL`
    );
    if (Number(invalidExpenses.total) > 0) {
      throw new Error(`La migracion 009 no puede continuar: existen ${invalidExpenses.total} gastos con relaciones o montos invalidos.`);
    }
  }
  if (await hasColumns(connection, 'cierreCaja', ['idCierreCaja', 'idTienda', 'fechaInicio', 'fechaFin', 'estado'])) {
    const [[invalidClosures]] = await connection.query(
      'SELECT COUNT(*) total FROM cierreCaja WHERE fechaFin<=fechaInicio'
    );
    if (Number(invalidClosures.total) > 0) {
      throw new Error(`La migracion 009 no puede continuar: existen ${invalidClosures.total} cierres con periodo invalido.`);
    }
    const [[overlaps]] = await connection.query(
      `SELECT COUNT(*) total FROM cierreCaja a
       JOIN cierreCaja b ON b.idTienda=a.idTienda AND b.idCierreCaja>a.idCierreCaja
       WHERE a.estado='cerrado' AND b.estado='cerrado'
         AND a.fechaInicio<b.fechaFin AND b.fechaInicio<a.fechaFin`
    );
    if (Number(overlaps.total) > 0) {
      throw new Error(`La migracion 009 no puede continuar: existen ${overlaps.total} cierres vigentes superpuestos.`);
    }
  }
}

async function validateInventoryIntelligenceMigrationData(connection) {
  if (await hasColumns(connection, 'configuracionInventarioTienda', [
    'idTienda', 'periodoAnalisisDias', 'diasHistorialMinimo', 'diasReposicionDefault',
    'diasCoberturaDefault', 'diasProductoNuevo', 'idAdministradorActualiza'
  ])) {
    const [[invalidConfiguration]] = await connection.query(
      `SELECT COUNT(*) total FROM configuracionInventarioTienda c
       LEFT JOIN tienda t ON t.idTienda=c.idTienda
       LEFT JOIN administrador a ON a.idTienda=c.idTienda AND a.idAdministrador=c.idAdministradorActualiza
       WHERE t.idTienda IS NULL
          OR c.periodoAnalisisDias NOT BETWEEN 7 AND 365
          OR c.diasHistorialMinimo NOT BETWEEN 1 AND c.periodoAnalisisDias
          OR c.diasReposicionDefault NOT BETWEEN 0 AND 365
          OR c.diasCoberturaDefault NOT BETWEEN 1 AND 365
          OR c.diasProductoNuevo NOT BETWEEN 1 AND 365
          OR (c.idAdministradorActualiza IS NOT NULL AND a.idAdministrador IS NULL)`
    );
    if (Number(invalidConfiguration.total) > 0) {
      throw new Error(`La migracion 010 no puede continuar: existen ${invalidConfiguration.total} configuraciones de inventario invalidas.`);
    }
  }
  if (await hasColumns(connection, 'producto', ['diasReposicion'])) {
    const [[invalidRestockDays]] = await connection.query(
      'SELECT COUNT(*) total FROM producto WHERE diasReposicion IS NOT NULL AND diasReposicion NOT BETWEEN 0 AND 365'
    );
    if (Number(invalidRestockDays.total) > 0) {
      throw new Error(`La migracion 010 no puede continuar: existen ${invalidRestockDays.total} productos con dias de reposicion invalidos.`);
    }
  }
  if (await hasColumns(connection, 'producto', ['diasCoberturaObjetivo'])) {
    const [[invalidCoverageDays]] = await connection.query(
      'SELECT COUNT(*) total FROM producto WHERE diasCoberturaObjetivo IS NOT NULL AND diasCoberturaObjetivo NOT BETWEEN 1 AND 365'
    );
    if (Number(invalidCoverageDays.total) > 0) {
      throw new Error(`La migracion 010 no puede continuar: existen ${invalidCoverageDays.total} productos con dias de cobertura invalidos.`);
    }
  }
}

async function validateLotsExpirationMigrationData(connection) {
  const [[invalidCosts]] = await connection.query(
    `SELECT
       (SELECT COUNT(*) FROM producto WHERE ultimoPrecioCompra<0)
       + (SELECT COUNT(*) FROM detalleVenta WHERE costoUnitario<0) total`
  );
  if (Number(invalidCosts.total) > 0) {
    throw new Error(`La migracion 011 no puede continuar: existen ${invalidCosts.total} costos negativos.`);
  }
  const estado = await inspect011State(connection, false, { log: false });
  const invalidKeys = [
    'configuracionesAlertaInvalidas', 'productosConfiguracionLotesInvalida',
    'productosActivacionIncoherente', 'lotesInvalidos', 'lotesReferenciasInvalidas',
    'lotesEnProductosSinControl', 'lotesSinVencimientoRequerido',
    'lotesClavesDuplicadas', 'lotesSinMovimiento', 'lotesSaldoFinalIncoherente',
    'movimientosLoteInvalidos', 'movimientosLoteReferenciasInvalidas',
    'movimientosLoteClavesDuplicadas', 'reconciliacionesInvalidas',
    'movimientosStockSinCoberturaLote', 'funcionalidadesDuplicadas',
    'accesosPlanDuplicados'
  ].filter((key) => estado.datos[key] !== null && estado.datos[key] > 0);
  if (invalidKeys.length) {
    const detail = invalidKeys.map((key) => `${key}=${estado.datos[key]}`).join(', ');
    throw new Error(`La migracion 011 no puede continuar por datos incompatibles: ${detail}.`);
  }
  if (estado.datos.accesosBasico !== null && estado.datos.accesosBasico > 0) {
    throw new Error('La migracion 011 no puede continuar: el plan basico tiene funciones de lotes habilitadas.');
  }
}

async function validateCustomerCreditMigrationData(connection) {
  const [[invalidFiados]] = await connection.query(
    `SELECT COUNT(*) total FROM fiado
     WHERE totalFiado<0 OR totalPagado<0 OR saldoPendiente<0
        OR totalPagado>totalFiado
        OR ABS((totalFiado-totalPagado)-saldoPendiente)>=0.01`
  );
  if (Number(invalidFiados.total) > 0) {
    throw new Error(
      `La migracion 012 no puede continuar: existen ${invalidFiados.total} fiados con saldos incompatibles.`
    );
  }
  const [[unreconciledPayments]] = await connection.query(
    `SELECT COUNT(*) total FROM (
       SELECT f.idTienda, f.idFiado, f.totalFiado, f.totalPagado, f.saldoPendiente
       FROM fiado f
       LEFT JOIN pagoFiado pf ON pf.idTienda=f.idTienda AND pf.idFiado=f.idFiado
       GROUP BY f.idTienda, f.idFiado, f.totalFiado, f.totalPagado, f.saldoPendiente
       HAVING ABS(COALESCE(SUM(pf.monto),0)-f.totalPagado)>=0.01
          OR ABS((f.totalFiado-COALESCE(SUM(pf.monto),0))-f.saldoPendiente)>=0.01
     ) diferencias`
  );
  if (Number(unreconciledPayments.total) > 0) {
    throw new Error(
      `La migracion 012 no puede continuar: existen ${unreconciledPayments.total} fiados no reconciliados con sus pagos.`
    );
  }
  const [[invalidPayments]] = await connection.query(
    `SELECT COUNT(*) total FROM pagoFiado pf
     LEFT JOIN fiado f ON f.idTienda=pf.idTienda AND f.idFiado=pf.idFiado
     WHERE pf.monto<=0 OR f.idFiado IS NULL`
  );
  if (Number(invalidPayments.total) > 0) {
    throw new Error(
      `La migracion 012 no puede continuar: existen ${invalidPayments.total} pagos de fiado invalidos o cruzados.`
    );
  }
  if (await hasColumns(connection, 'cliente', ['documentoNormalizado'])) {
    const [[duplicates]] = await connection.query(
      `SELECT COUNT(*) total FROM (
         SELECT idTienda, documentoNormalizado FROM cliente
         WHERE documentoNormalizado IS NOT NULL
         GROUP BY idTienda, documentoNormalizado HAVING COUNT(*)>1
       ) duplicados`
    );
    if (Number(duplicates.total) > 0) {
      throw new Error(
        `La migracion 012 no puede continuar: existen ${duplicates.total} documentos normalizados duplicados por tienda.`
      );
    }
  }
  if (await hasColumns(connection, 'pagoFiado', ['idCobroFiado', 'claveDistribucion'])
    && await hasTable(connection, 'cobroFiado')) {
    const estado012 = await inspect012State(connection, false, { log: false });
    const incompatible = [
      'cobrosInvalidos', 'cobrosReferenciasCruzadas', 'cabecerasLegadoInvalidas'
    ].filter((key) => estado012.datos[key] !== null && estado012.datos[key] > 0);
    if (incompatible.length) {
      const detail = incompatible.map((key) => `${key}=${estado012.datos[key]}`).join(', ');
      throw new Error(`La migracion 012 no puede continuar por datos incompatibles: ${detail}.`);
    }
  }
}

function isExistingStructureError(error) {
  return [
    'ER_DUP_FIELDNAME',
    'ER_DUP_KEYNAME',
    'ER_FK_DUP_NAME',
    'ER_DUP_CONSTRAINT_NAME',
    'ER_CHECK_CONSTRAINT_DUP_NAME'
  ].includes(error.code);
}

async function main() {
  logDatabaseTarget('Aplicacion de migraciones');
  const connection = await createConnection();
  try {
    await connection.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        nombre VARCHAR(255) PRIMARY KEY,
        aplicadaEn DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    const migrationsDir = path.join(__dirname, '..', 'database', 'migrations');
    const files = fs.readdirSync(migrationsDir).filter((file) => file.endsWith('.sql')).sort();

    for (const file of files) {
      if (isLegacyMigration(file)) {
        const initialState = await inspectLegacyMigration(connection, file, {
          schemaName: process.env.DB_NAME
        });
        console.log(`Estado fisico de ${file}:`);
        console.log(JSON.stringify(initialState, null, 2));
        const result = await migrateLegacyMigration(connection, file, {
          schemaName: process.env.DB_NAME,
          log: (message) => console.log(message)
        });
        console.log(`Decision para ${file}: ${result.action}. Estado final: ${result.state.estado}.`);
        continue;
      }
      const [recorded] = await connection.query('SELECT nombre FROM schema_migrations WHERE nombre=?', [file]);
      let estado006 = null;
      let estado010 = null;
      let estado011 = null;
      let estado012 = null;
      if (file === '004_multitienda_base.sql') {
        await inspect004State(connection, recorded.length > 0);
      }
      if (file === '006_catalogo_maestro.sql') {
        estado006 = await read006State(connection, recorded.length > 0);
        inspect006State(estado006);
        console.log(`Decision para 006_catalogo_maestro.sql: ${decide006Action(estado006)}.`);
      }
      if (file === '008_punto_venta_pagos.sql') {
        await inspect008State(connection, recorded.length > 0);
      }
      if (file === '009_finanzas_reportes_caja.sql') {
        await inspect009State(connection, recorded.length > 0);
      }
      if (file === '010_inteligencia_inventario.sql') {
        estado010 = await inspect010State(connection, recorded.length > 0);
      }
      if (file === '011_lotes_vencimientos.sql') {
        estado011 = await inspect011State(connection, recorded.length > 0);
      }
      if (file === '012_clientes_fiados_comunicacion.sql') {
        estado012 = await inspect012State(connection, recorded.length > 0);
      }
      if (recorded.length) {
        const registeredMigrationIsIncomplete = file === '006_catalogo_maestro.sql'
          ? decide006Action(estado006) === 'detener'
          : file === '010_inteligencia_inventario.sql'
            ? !(estado010.estructuraCompleta && estado010.datosValidos)
            : file === '011_lotes_vencimientos.sql'
              ? !(estado011.estructuraCompleta && estado011.datosValidos)
              : file === '012_clientes_fiados_comunicacion.sql'
                ? !(estado012.estructuraCompleta && estado012.datosValidos)
            : [
              '004_multitienda_base.sql',
              '005_planes_suscripciones.sql',
              '007_movimientos_stock.sql',
              '008_punto_venta_pagos.sql',
              '009_finanzas_reportes_caja.sql',
              '013_seguridad_sesiones.sql',
              '014_operaciones_compensatorias.sql',
              '015_compensaciones_venta_inventario.sql',
              '016_compensaciones_financieras.sql',
              '017_integracion_compensaciones.sql',
              '018_auditoria_administrativa_critica.sql',
              '019_stock_vendible_ajustes.sql',
              '020_registro_publico_onboarding.sql',
              '021_configuracion_base_tienda.sql',
              '022_ciclo_vida_suscripciones.sql',
              '023_estructura_pagos_suscripcion.sql'
            ].includes(file)
            && !await requirementsSatisfied(connection, file);
        if (registeredMigrationIsIncomplete) {
          throw new Error(`La migracion ${file} figura en schema_migrations, pero su estructura o sus datos estan incompletos. No se aplicaron cambios adicionales.`);
        }
        console.log(`Migracion ya registrada: ${file}`);
        continue;
      }

      const existingMigrationIsComplete = file === '006_catalogo_maestro.sql'
        ? decide006Action(estado006) === 'registrar'
        : file === '010_inteligencia_inventario.sql'
          ? estado010.estructuraCompleta && estado010.datosValidos
          : file === '011_lotes_vencimientos.sql'
            ? estado011.estructuraCompleta && estado011.datosValidos
            : file === '012_clientes_fiados_comunicacion.sql'
              ? estado012.estructuraCompleta && estado012.datosValidos
          : await requirementsSatisfied(connection, file);
      if (existingMigrationIsComplete) {
        if ([
          '010_inteligencia_inventario.sql',
          '011_lotes_vencimientos.sql',
          '012_clientes_fiados_comunicacion.sql',
          '013_seguridad_sesiones.sql',
          '014_operaciones_compensatorias.sql',
          '015_compensaciones_venta_inventario.sql',
          '016_compensaciones_financieras.sql',
          '017_integracion_compensaciones.sql',
          '018_auditoria_administrativa_critica.sql',
          '019_stock_vendible_ajustes.sql',
          '020_registro_publico_onboarding.sql',
          '021_configuracion_base_tienda.sql',
          '022_ciclo_vida_suscripciones.sql',
          '023_estructura_pagos_suscripcion.sql'
        ].includes(file)) {
          await connection.query('INSERT IGNORE INTO schema_migrations (nombre) VALUES (?)', [file]);
          const [finalRecord] = await connection.query(
            'SELECT nombre FROM schema_migrations WHERE nombre=?', [file]
          );
          if (file === '010_inteligencia_inventario.sql') {
            estado010 = await inspect010State(connection, finalRecord.length > 0);
            if (!estado010.migracion010Registrada || !estado010.estructuraCompleta || !estado010.datosValidos) {
              throw new Error('La migracion 010 no pudo confirmar su registro y estado fisico final.');
            }
          } else if (file === '011_lotes_vencimientos.sql') {
            estado011 = await inspect011State(connection, finalRecord.length > 0);
            if (!estado011.migracion011Registrada || !estado011.estructuraCompleta || !estado011.datosValidos) {
              throw new Error('La migracion 011 no pudo confirmar su registro y estado fisico final.');
            }
          } else if (file === '012_clientes_fiados_comunicacion.sql') {
            estado012 = await inspect012State(connection, finalRecord.length > 0);
            if (!estado012.migracion012Registrada || !estado012.estructuraCompleta || !estado012.datosValidos) {
              throw new Error('La migracion 012 no pudo confirmar su registro y estado fisico final.');
            }
          } else if (finalRecord.length !== 1 || !await requirementsSatisfied(connection, file)) {
            throw new Error(`La migracion ${file} no pudo confirmar su registro y estado fisico final.`);
          }
        } else {
          await connection.query('INSERT INTO schema_migrations (nombre) VALUES (?)', [file]);
        }
        console.log(`Migracion existente registrada sin repetir cambios: ${file}`);
        continue;
      }

      const statements = readSqlStatements(path.join(migrationsDir, file));
      const migrationContext = [
        '010_inteligencia_inventario.sql',
        '011_lotes_vencimientos.sql',
        '012_clientes_fiados_comunicacion.sql',
        '014_operaciones_compensatorias.sql',
        '021_configuracion_base_tienda.sql'
      ].includes(file)
        ? { localDateTime: formatLocalDateTime() }
        : {};
      let multitenantDataValidated = false;
      if (file === '008_punto_venta_pagos.sql') {
        await validatePosMigrationData(connection);
        console.log('Datos existentes validados antes de recuperar la estructura POS y sus pagos.');
      }
      if (file === '009_finanzas_reportes_caja.sql') {
        await validateFinancialMigrationData(connection);
        console.log('Datos financieros existentes validados antes de recuperar la estructura 009.');
      }
      if (file === '010_inteligencia_inventario.sql') {
        await validateInventoryIntelligenceMigrationData(connection);
        console.log('Datos de inventario existentes validados antes de recuperar la estructura 010.');
      }
      if (file === '011_lotes_vencimientos.sql') {
        await validateLotsExpirationMigrationData(connection);
        console.log('Datos existentes validados antes de recuperar la estructura de lotes 011.');
      }
      if (file === '012_clientes_fiados_comunicacion.sql') {
        await validateCustomerCreditMigrationData(connection);
        console.log('Datos existentes validados antes de recuperar la estructura de credito 012.');
      }
      for (let index = 0; index < statements.length; index += 1) {
        const statement = statements[index];
        if (file === '004_multitienda_base.sql'
          && !multitenantDataValidated
          && beginsMultitenantConstraintPhase(statement)) {
          await validateMultitenantData(connection);
          multitenantDataValidated = true;
          console.log('Datos multi-tienda validados antes de crear indices y restricciones.');
        }

        const element = [
          '004_multitienda_base.sql',
          '006_catalogo_maestro.sql',
          '007_movimientos_stock.sql',
          '008_punto_venta_pagos.sql',
          '009_finanzas_reportes_caja.sql',
          '010_inteligencia_inventario.sql',
          '011_lotes_vencimientos.sql',
          '012_clientes_fiados_comunicacion.sql',
          '013_seguridad_sesiones.sql',
          '014_operaciones_compensatorias.sql',
          '015_compensaciones_venta_inventario.sql',
          '016_compensaciones_financieras.sql',
          '017_integracion_compensaciones.sql',
          '018_auditoria_administrativa_critica.sql'
        ].includes(file)
          ? structureElementFromStatement(statement)
          : null;
        if (element && await structureElementExists(connection, element, file)) {
          console.log(`Paso ${index + 1}/${statements.length} omitido; ${element.type} existente: ${element.table}.${element.name}.`);
          continue;
        }

        if (file === '006_catalogo_maestro.sql' && element?.type === 'restriccion') {
          await validateCatalogForeignKey(
            connection,
            element,
            `Paso ${index + 1}/${statements.length} (${element.table}.${element.name})`
          );
        }

        try {
          if (element) {
            console.log(`Paso ${index + 1}/${statements.length}: creando ${element.type} ${element.table}.${element.name}.`);
          }
          const executable = prepareMigrationStatement(file, statement, migrationContext);
          await connection.query(executable.sql, executable.params);
        } catch (error) {
          if (isExistingStructureError(error) && element && await structureElementExists(connection, element, file)) {
            console.log(`Paso ${index + 1}/${statements.length}: elemento existente; se verificara al finalizar.`);
            continue;
          }
          const description = element
            ? `${element.type} ${element.table}.${element.name}`
            : statement.replace(/\s+/g, ' ').trim().slice(0, 100);
          throw new Error(
            `Fallo ${file} en el paso ${index + 1}/${statements.length} (${description}). `
            + `MySQL ${error.code || 'ERROR'}: ${error.message}`
          );
        }
      }

      if (file === '004_multitienda_base.sql' && !multitenantDataValidated) {
        await validateMultitenantData(connection);
      }

      if (file === '006_catalogo_maestro.sql') {
        estado006 = await read006State(connection, false);
        console.log('Estado final validado para 006_catalogo_maestro.sql:');
        console.log(JSON.stringify(estado006, null, 2));
      }
      if (file === '010_inteligencia_inventario.sql') {
        estado010 = await inspect010State(connection, false);
      }
      if (file === '011_lotes_vencimientos.sql') {
        estado011 = await inspect011State(connection, false);
      }
      if (file === '012_clientes_fiados_comunicacion.sql') {
        estado012 = await inspect012State(connection, false);
      }
      const migrationCompleted = file === '006_catalogo_maestro.sql'
        ? estado006.estructuraCompleta && estado006.datosValidos
        : file === '010_inteligencia_inventario.sql'
          ? estado010.estructuraCompleta && estado010.datosValidos
          : file === '011_lotes_vencimientos.sql'
            ? estado011.estructuraCompleta && estado011.datosValidos
            : file === '012_clientes_fiados_comunicacion.sql'
              ? estado012.estructuraCompleta && estado012.datosValidos
          : await requirementsSatisfied(connection, file);
      if (!migrationCompleted) {
        const missing = await missingRequirementElements(connection, file);
        throw new Error(
          `La migracion ${file} termino sin completar la estructura o validacion esperada. `
          + `Elementos faltantes: ${missing.length ? missing.join(', ') : 'ninguno; revise datos y configuracion de la migracion'}.`
        );
      }
      if ([
        '010_inteligencia_inventario.sql',
        '011_lotes_vencimientos.sql',
        '012_clientes_fiados_comunicacion.sql',
        '013_seguridad_sesiones.sql',
        '014_operaciones_compensatorias.sql',
        '015_compensaciones_venta_inventario.sql',
        '016_compensaciones_financieras.sql',
        '017_integracion_compensaciones.sql',
        '018_auditoria_administrativa_critica.sql'
      ].includes(file)) {
        await connection.query('INSERT IGNORE INTO schema_migrations (nombre) VALUES (?)', [file]);
        const [finalRecord] = await connection.query(
          'SELECT nombre FROM schema_migrations WHERE nombre=?', [file]
        );
        if (file === '010_inteligencia_inventario.sql') {
          estado010 = await inspect010State(connection, finalRecord.length > 0);
          if (!estado010.migracion010Registrada || !estado010.estructuraCompleta || !estado010.datosValidos) {
            throw new Error('La migracion 010 no pudo confirmar su registro y estado fisico final.');
          }
        } else if (file === '011_lotes_vencimientos.sql') {
          estado011 = await inspect011State(connection, finalRecord.length > 0);
          if (!estado011.migracion011Registrada || !estado011.estructuraCompleta || !estado011.datosValidos) {
            throw new Error('La migracion 011 no pudo confirmar su registro y estado fisico final.');
          }
        } else if (file === '012_clientes_fiados_comunicacion.sql') {
          estado012 = await inspect012State(connection, finalRecord.length > 0);
          if (!estado012.migracion012Registrada || !estado012.estructuraCompleta || !estado012.datosValidos) {
            throw new Error('La migracion 012 no pudo confirmar su registro y estado fisico final.');
          }
        } else if (finalRecord.length !== 1 || !await requirementsSatisfied(connection, file)) {
          throw new Error(`La migracion ${file} no pudo confirmar su registro y estado fisico final.`);
        }
      } else {
        await connection.query('INSERT INTO schema_migrations (nombre) VALUES (?)', [file]);
      }
      console.log(`Migracion aplicada: ${file}`);
    }

    console.log('Migraciones completadas. No se cargaron datos de demostracion.');
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error('No se pudieron aplicar las migraciones.');
  console.error(error.message);
  process.exit(1);
});
