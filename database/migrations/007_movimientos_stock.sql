ALTER TABLE producto
  ADD COLUMN activo TINYINT(1) NOT NULL DEFAULT 1 AFTER permiteVentaPorUnidad;

ALTER TABLE producto
  ADD COLUMN eliminadoEn DATETIME NULL AFTER activo;

ALTER TABLE venta
  ADD COLUMN claveOperacion VARCHAR(64) NULL AFTER idCliente;

ALTER TABLE compra
  ADD COLUMN claveOperacion VARCHAR(64) NULL AFTER idProveedor;

ALTER TABLE administrador
  ADD UNIQUE INDEX uq_administrador_tienda_id (idTienda, idAdministrador);

ALTER TABLE producto
  ADD INDEX idx_producto_tienda_activo_nombre (idTienda, activo, nombre);

ALTER TABLE venta
  ADD UNIQUE INDEX uq_venta_tienda_claveOperacion (idTienda, claveOperacion);

ALTER TABLE compra
  ADD UNIQUE INDEX uq_compra_tienda_claveOperacion (idTienda, claveOperacion);

ALTER TABLE detalleVenta
  ADD UNIQUE INDEX uq_detalleVenta_tienda_id (idTienda, idDetalleVenta);

ALTER TABLE detalleCompra
  ADD UNIQUE INDEX uq_detalleCompra_tienda_id (idTienda, idDetalleCompra);

CREATE TABLE IF NOT EXISTS movimientoStock (
  idMovimientoStock BIGINT AUTO_INCREMENT PRIMARY KEY,
  idTienda INT NOT NULL,
  idProducto INT NOT NULL,
  tipoMovimiento ENUM('entrada','salida','ajuste_positivo','ajuste_negativo','inventario_inicial') NOT NULL,
  origen ENUM('compra','venta','ajuste_manual','alta_producto','migracion_inicial','correccion_sistema','otro') NOT NULL,
  cantidad INT NOT NULL,
  stockAnterior INT NOT NULL,
  stockPosterior INT NOT NULL,
  cantidadOperacion DECIMAL(10,2) NULL,
  unidadOperacion VARCHAR(30) NULL,
  motivo VARCHAR(160) NOT NULL,
  observacion VARCHAR(500) NULL,
  idDetalleVenta INT NULL,
  idDetalleCompra INT NULL,
  referenciaTipo VARCHAR(40) NULL,
  referenciaId BIGINT NULL,
  claveOperacion VARCHAR(160) NOT NULL,
  idAdministrador INT NULL,
  creadoEn DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_movimiento_tienda_clave (idTienda, claveOperacion),
  UNIQUE KEY uq_movimiento_tienda_detalleVenta (idTienda, idDetalleVenta),
  UNIQUE KEY uq_movimiento_tienda_detalleCompra (idTienda, idDetalleCompra),
  KEY idx_movimiento_tienda_fecha (idTienda, creadoEn, idMovimientoStock),
  KEY idx_movimiento_tienda_producto_fecha (idTienda, idProducto, creadoEn, idMovimientoStock),
  KEY idx_movimiento_tienda_tipo_origen (idTienda, tipoMovimiento, origen),
  KEY idx_movimiento_tienda_responsable (idTienda, idAdministrador, creadoEn),
  CONSTRAINT chk_movimiento_cantidad CHECK (cantidad <> 0),
  CONSTRAINT chk_movimiento_stock_no_negativo CHECK (stockAnterior >= 0 AND stockPosterior >= 0),
  CONSTRAINT chk_movimiento_balance CHECK (stockPosterior = stockAnterior + cantidad),
  CONSTRAINT chk_movimiento_tipo CHECK (
    tipoMovimiento IN ('entrada','salida','ajuste_positivo','ajuste_negativo','inventario_inicial')
  ),
  CONSTRAINT chk_movimiento_origen CHECK (
    origen IN ('compra','venta','ajuste_manual','alta_producto','migracion_inicial','correccion_sistema','otro')
  ),
  CONSTRAINT chk_movimiento_signo CHECK (
    (tipoMovimiento IN ('entrada','ajuste_positivo','inventario_inicial') AND cantidad > 0)
    OR (tipoMovimiento IN ('salida','ajuste_negativo') AND cantidad < 0)
  ),
  CONSTRAINT chk_movimiento_cantidad_operacion CHECK (cantidadOperacion IS NULL OR cantidadOperacion > 0),
  CONSTRAINT fk_movimiento_tienda FOREIGN KEY (idTienda)
    REFERENCES tienda(idTienda) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_movimiento_producto FOREIGN KEY (idTienda, idProducto)
    REFERENCES producto(idTienda, idProducto) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_movimiento_administrador FOREIGN KEY (idTienda, idAdministrador)
    REFERENCES administrador(idTienda, idAdministrador) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_movimiento_detalleVenta FOREIGN KEY (idTienda, idDetalleVenta)
    REFERENCES detalleVenta(idTienda, idDetalleVenta) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_movimiento_detalleCompra FOREIGN KEY (idTienda, idDetalleCompra)
    REFERENCES detalleCompra(idTienda, idDetalleCompra) ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB;

INSERT INTO funcionalidad (codigo, nombre, descripcion, activo)
VALUES ('historial_stock', 'Historial de stock', 'Movimientos y ajustes detallados de inventario.', 1)
ON DUPLICATE KEY UPDATE activo=1;

INSERT INTO funcionalidad (codigo, nombre, descripcion, activo)
VALUES ('ajuste_stock', 'Ajuste de stock', 'Conteo fisico y ajuste manual protegido del inventario.', 1)
ON DUPLICATE KEY UPDATE activo=1;

INSERT INTO planFuncionalidad (idPlan, idFuncionalidad, habilitada)
SELECT p.idPlan, f.idFuncionalidad, 1
FROM plan p
JOIN funcionalidad f ON f.codigo IN ('historial_stock','ajuste_stock')
WHERE p.codigo IN ('basico','avanzado')
ON DUPLICATE KEY UPDATE habilitada=1;

INSERT INTO movimientoStock
  (idTienda, idProducto, tipoMovimiento, origen, cantidad, stockAnterior, stockPosterior,
   cantidadOperacion, unidadOperacion, motivo, referenciaTipo, referenciaId, claveOperacion, idAdministrador)
SELECT p.idTienda, p.idProducto, 'inventario_inicial', 'migracion_inicial', p.stockUnidadesTotal,
       0, p.stockUnidadesTotal, p.stockUnidadesTotal, 'unidad_base',
       'Saldo inicial registrado al aplicar la migracion 007.', 'producto', p.idProducto,
       CONCAT('migracion007:producto:', p.idProducto), NULL
FROM producto p
WHERE p.stockUnidadesTotal > 0
ON DUPLICATE KEY UPDATE idMovimientoStock=idMovimientoStock;
