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

const MIGRATION_LOCAL_DATETIME_TOKEN = '__MIGRATION_LOCAL_DATETIME__';

function prepareMigrationStatement(file, statement, context = {}) {
  if (file !== '010_inteligencia_inventario.sql'
    || !statement.includes(MIGRATION_LOCAL_DATETIME_TOKEN)) {
    return { sql: statement, params: [] };
  }
  if (!context.localDateTime) {
    throw new Error('La migracion 010 requiere una marca de fecha local explicita.');
  }
  const occurrences = statement.split(MIGRATION_LOCAL_DATETIME_TOKEN).length - 1;
  return {
    sql: statement.split(MIGRATION_LOCAL_DATETIME_TOKEN).join('?'),
    params: Array(occurrences).fill(context.localDateTime)
  };
}

const migrationRequirements = {
  '001_mejoras_tienda.sql': {
    columns: {
      producto: ['idProveedor', 'categoria', 'unidadesPorPaquete'],
      venta: ['tipo'],
      fiado: ['idVenta']
    },
    columnTypes: { producto: { stock: 'int', stockMinimo: 'int' } },
    foreignKeys: [
      ['producto', 'idProveedor', 'proveedor', 'idProveedor'],
      ['fiado', 'idVenta', 'venta', 'idVenta']
    ]
  },
  '002_mejoras_stock_reportes.sql': {
    columns: {
      producto: ['paquetesPorCaja', 'stockUnidadesTotal', 'ultimoPrecioCompra', 'permiteVentaPorPaquete', 'permiteVentaPorUnidad'],
      detalleVenta: ['costoUnitario', 'subtotalCosto', 'ganancia', 'presentacionVenta', 'cantidadEquivalenteUnidades'],
      detalleCompra: ['presentacionCompra', 'cantidadEquivalenteUnidades']
    }
  },
  '003_borrado_logico.sql': {
    columns: {
      cliente: ['activo', 'eliminadoEn'],
      fiado: ['activo', 'eliminadoEn']
    }
  },
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
  }
};

async function requirementsSatisfied(connection, file) {
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

  const index = normalized.match(/^ALTER TABLE\s+`?([A-Za-z0-9_]+)`?\s+ADD\s+(?:UNIQUE\s+)?INDEX\s+`?([A-Za-z0-9_]+)`?/i);
  if (index) return { type: 'indice', table: index[1], name: index[2] };

  const constraint = normalized.match(/^ALTER TABLE\s+`?([A-Za-z0-9_]+)`?\s+ADD CONSTRAINT\s+`?([A-Za-z0-9_]+)`?/i);
  if (constraint) return { type: 'restriccion', table: constraint[1], name: constraint[2] };

  return null;
}

async function structureElementExists(connection, element) {
  if (!element) return false;
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
      const [recorded] = await connection.query('SELECT nombre FROM schema_migrations WHERE nombre=?', [file]);
      let estado006 = null;
      let estado010 = null;
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
      if (recorded.length) {
        const registeredMigrationIsIncomplete = file === '006_catalogo_maestro.sql'
          ? decide006Action(estado006) === 'detener'
          : file === '010_inteligencia_inventario.sql'
            ? !(estado010.estructuraCompleta && estado010.datosValidos)
            : ['004_multitienda_base.sql', '005_planes_suscripciones.sql', '007_movimientos_stock.sql', '008_punto_venta_pagos.sql', '009_finanzas_reportes_caja.sql'].includes(file)
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
          : await requirementsSatisfied(connection, file);
      if (existingMigrationIsComplete) {
        if (file === '010_inteligencia_inventario.sql') {
          await connection.query('INSERT IGNORE INTO schema_migrations (nombre) VALUES (?)', [file]);
          const [finalRecord] = await connection.query(
            'SELECT nombre FROM schema_migrations WHERE nombre=?', [file]
          );
          estado010 = await inspect010State(connection, finalRecord.length > 0);
          if (!estado010.migracion010Registrada || !estado010.estructuraCompleta || !estado010.datosValidos) {
            throw new Error('La migracion 010 no pudo confirmar su registro y estado fisico final.');
          }
        } else {
          await connection.query('INSERT INTO schema_migrations (nombre) VALUES (?)', [file]);
        }
        console.log(`Migracion existente registrada sin repetir cambios: ${file}`);
        continue;
      }

      const statements = readSqlStatements(path.join(migrationsDir, file));
      const migrationContext = file === '010_inteligencia_inventario.sql'
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
      for (let index = 0; index < statements.length; index += 1) {
        const statement = statements[index];
        if (file === '004_multitienda_base.sql'
          && !multitenantDataValidated
          && beginsMultitenantConstraintPhase(statement)) {
          await validateMultitenantData(connection);
          multitenantDataValidated = true;
          console.log('Datos multi-tienda validados antes de crear indices y restricciones.');
        }

        const element = ['004_multitienda_base.sql', '006_catalogo_maestro.sql', '007_movimientos_stock.sql', '008_punto_venta_pagos.sql', '009_finanzas_reportes_caja.sql', '010_inteligencia_inventario.sql'].includes(file)
          ? structureElementFromStatement(statement)
          : null;
        if (element && await structureElementExists(connection, element)) {
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
          if (isExistingStructureError(error) && element && await structureElementExists(connection, element)) {
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
      const migrationCompleted = file === '006_catalogo_maestro.sql'
        ? estado006.estructuraCompleta && estado006.datosValidos
        : file === '010_inteligencia_inventario.sql'
          ? estado010.estructuraCompleta && estado010.datosValidos
          : await requirementsSatisfied(connection, file);
      if (!migrationCompleted) {
        const missing = await missingRequirementElements(connection, file);
        throw new Error(
          `La migracion ${file} termino sin completar la estructura o validacion esperada. `
          + `Elementos faltantes: ${missing.length ? missing.join(', ') : 'ninguno; revise datos y configuracion de la migracion'}.`
        );
      }
      if (file === '010_inteligencia_inventario.sql') {
        await connection.query('INSERT IGNORE INTO schema_migrations (nombre) VALUES (?)', [file]);
        const [finalRecord] = await connection.query(
          'SELECT nombre FROM schema_migrations WHERE nombre=?', [file]
        );
        estado010 = await inspect010State(connection, finalRecord.length > 0);
        if (!estado010.migracion010Registrada || !estado010.estructuraCompleta || !estado010.datosValidos) {
          throw new Error('La migracion 010 no pudo confirmar su registro y estado fisico final.');
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
