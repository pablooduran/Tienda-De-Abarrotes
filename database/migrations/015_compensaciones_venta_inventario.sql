CREATE TABLE IF NOT EXISTS compensacionVenta (
  idCompensacionVenta BIGINT NOT NULL AUTO_INCREMENT,
  idTienda INT NOT NULL,
  idOperacionCompensatoria BIGINT NOT NULL,
  idVenta INT NOT NULL,
  tipoCompensacion ENUM('anulacion_total','devolucion_parcial') NOT NULL,
  montoCompensado DECIMAL(12,2) NOT NULL,
  costoCompensado DECIMAL(12,2) NOT NULL,
  creadoEn DATETIME NOT NULL,
  PRIMARY KEY (idCompensacionVenta)
) ENGINE=InnoDB;

ALTER TABLE compensacionVenta
  ADD UNIQUE INDEX uq_compensacionVenta_tienda_id
    (idTienda, idCompensacionVenta);

ALTER TABLE compensacionVenta
  ADD UNIQUE INDEX uq_compensacionVenta_tienda_operacion
    (idTienda, idOperacionCompensatoria);

ALTER TABLE compensacionVenta
  ADD INDEX idx_compensacionVenta_tienda_venta
    (idTienda, idVenta, idCompensacionVenta);

ALTER TABLE compensacionVenta
  ADD CONSTRAINT chk_compensacionVenta_montos
    CHECK (montoCompensado>=0 AND costoCompensado>=0);

ALTER TABLE compensacionVenta
  ADD CONSTRAINT fk_compensacionVenta_operacion
    FOREIGN KEY (idTienda, idOperacionCompensatoria)
    REFERENCES operacionCompensatoria(idTienda, idOperacionCompensatoria)
    ON UPDATE RESTRICT ON DELETE RESTRICT;

ALTER TABLE compensacionVenta
  ADD CONSTRAINT fk_compensacionVenta_venta
    FOREIGN KEY (idTienda, idVenta)
    REFERENCES venta(idTienda, idVenta)
    ON UPDATE RESTRICT ON DELETE RESTRICT;

CREATE TABLE IF NOT EXISTS liquidacionCompensacionVenta (
  idLiquidacionCompensacionVenta BIGINT NOT NULL AUTO_INCREMENT,
  idTienda INT NOT NULL,
  idCompensacionVenta BIGINT NOT NULL,
  montoCompensado DECIMAL(12,2) NOT NULL,
  montoReduccionDeudaPendiente DECIMAL(12,2) NOT NULL,
  montoReembolsoPendiente DECIMAL(12,2) NOT NULL,
  estado ENUM('sin_efecto','pendiente_c3','resuelta') NOT NULL,
  creadoEn DATETIME NOT NULL,
  resueltoEn DATETIME NULL,
  PRIMARY KEY (idLiquidacionCompensacionVenta)
) ENGINE=InnoDB;

ALTER TABLE liquidacionCompensacionVenta
  ADD UNIQUE INDEX uq_liquidacionCompensacion_tienda_id
    (idTienda, idLiquidacionCompensacionVenta);

ALTER TABLE liquidacionCompensacionVenta
  ADD UNIQUE INDEX uq_liquidacionCompensacion_tienda_compensacion
    (idTienda, idCompensacionVenta);

ALTER TABLE liquidacionCompensacionVenta
  ADD INDEX idx_liquidacionCompensacion_tienda_estado
    (idTienda, estado, creadoEn);

ALTER TABLE liquidacionCompensacionVenta
  ADD CONSTRAINT chk_liquidacionCompensacion_montos
    CHECK (
      montoCompensado>=0
      AND montoReduccionDeudaPendiente>=0
      AND montoReembolsoPendiente>=0
      AND ABS(
        montoCompensado
        - montoReduccionDeudaPendiente
        - montoReembolsoPendiente
      )<0.01
    );

ALTER TABLE liquidacionCompensacionVenta
  ADD CONSTRAINT chk_liquidacionCompensacion_estado
    CHECK (
      (estado='sin_efecto' AND montoCompensado=0 AND resueltoEn IS NULL)
      OR (estado='pendiente_c3' AND montoCompensado>0 AND resueltoEn IS NULL)
      OR (estado='resuelta' AND resueltoEn IS NOT NULL)
    );

ALTER TABLE liquidacionCompensacionVenta
  ADD CONSTRAINT fk_liquidacionCompensacion_compensacion
    FOREIGN KEY (idTienda, idCompensacionVenta)
    REFERENCES compensacionVenta(idTienda, idCompensacionVenta)
    ON UPDATE RESTRICT ON DELETE RESTRICT;

CREATE TABLE IF NOT EXISTS detalleCompensacionVenta (
  idDetalleCompensacionVenta BIGINT NOT NULL AUTO_INCREMENT,
  idTienda INT NOT NULL,
  idCompensacionVenta BIGINT NOT NULL,
  idDetalleVenta INT NOT NULL,
  idProducto INT NOT NULL,
  unidadesDevueltas INT NOT NULL,
  montoCompensado DECIMAL(12,2) NOT NULL,
  costoCompensado DECIMAL(12,2) NOT NULL,
  tratamientoInventario ENUM(
    'reintegrar_vendible',
    'no_reintegrar',
    'aislar_no_vendible'
  ) NOT NULL,
  resultadoInventario ENUM(
    'reintegrado_stock',
    'reintegrado_lote_original',
    'aislado_lote_tecnico',
    'aislado_no_vendible',
    'no_reintegrado'
  ) NOT NULL,
  idMovimientoStock BIGINT NULL,
  creadoEn DATETIME NOT NULL,
  PRIMARY KEY (idDetalleCompensacionVenta)
) ENGINE=InnoDB;

ALTER TABLE detalleCompensacionVenta
  ADD UNIQUE INDEX uq_detalleCompensacionVenta_tienda_id
    (idTienda, idProducto, idDetalleCompensacionVenta);

ALTER TABLE detalleCompensacionVenta
  ADD UNIQUE INDEX uq_detalleCompensacionVenta_tienda_detalle
    (idTienda, idCompensacionVenta, idDetalleVenta);

ALTER TABLE detalleCompensacionVenta
  ADD INDEX idx_detalleCompensacionVenta_tienda_venta
    (idTienda, idDetalleVenta, idDetalleCompensacionVenta);

ALTER TABLE detalleCompensacionVenta
  ADD INDEX idx_detalleCompensacionVenta_tienda_movimiento
    (idTienda, idProducto, idMovimientoStock);

ALTER TABLE detalleCompensacionVenta
  ADD CONSTRAINT chk_detalleCompensacionVenta_valores
    CHECK (
      unidadesDevueltas>0
      AND montoCompensado>=0
      AND costoCompensado>=0
    );

ALTER TABLE detalleCompensacionVenta
  ADD CONSTRAINT chk_detalleCompensacionVenta_movimiento
    CHECK (
      (
        resultadoInventario IN ('no_reintegrado','aislado_no_vendible')
        AND idMovimientoStock IS NULL
      )
      OR (
        resultadoInventario NOT IN ('no_reintegrado','aislado_no_vendible')
        AND idMovimientoStock IS NOT NULL
      )
    );

ALTER TABLE detalleCompensacionVenta
  ADD CONSTRAINT fk_detalleCompensacionVenta_compensacion
    FOREIGN KEY (idTienda, idCompensacionVenta)
    REFERENCES compensacionVenta(idTienda, idCompensacionVenta)
    ON UPDATE RESTRICT ON DELETE RESTRICT;

ALTER TABLE detalleCompensacionVenta
  ADD CONSTRAINT fk_detalleCompensacionVenta_detalle
    FOREIGN KEY (idTienda, idDetalleVenta)
    REFERENCES detalleVenta(idTienda, idDetalleVenta)
    ON UPDATE RESTRICT ON DELETE RESTRICT;

ALTER TABLE detalleCompensacionVenta
  ADD CONSTRAINT fk_detalleCompensacionVenta_producto
    FOREIGN KEY (idTienda, idProducto)
    REFERENCES producto(idTienda, idProducto)
    ON UPDATE RESTRICT ON DELETE RESTRICT;

ALTER TABLE detalleCompensacionVenta
  ADD CONSTRAINT fk_detalleCompensacionVenta_movimiento
    FOREIGN KEY (idTienda, idProducto, idMovimientoStock)
    REFERENCES movimientoStock(idTienda, idProducto, idMovimientoStock)
    ON UPDATE RESTRICT ON DELETE RESTRICT;

ALTER TABLE movimientoLote
  ADD UNIQUE INDEX uq_movimientoLote_tienda_producto_id
    (idTienda, idProducto, idMovimientoLote);

CREATE TABLE IF NOT EXISTS detalleCompensacionLote (
  idDetalleCompensacionLote BIGINT NOT NULL AUTO_INCREMENT,
  idTienda INT NOT NULL,
  idProducto INT NOT NULL,
  idDetalleCompensacionVenta BIGINT NOT NULL,
  idMovimientoLoteSalida BIGINT NOT NULL,
  idLoteProductoOrigen BIGINT NOT NULL,
  idLoteProductoDestino BIGINT NULL,
  idMovimientoLoteCompensatorio BIGINT NULL,
  unidadesDevueltas INT NOT NULL,
  resultadoInventario ENUM(
    'reintegrado_lote_original',
    'aislado_lote_tecnico',
    'no_reintegrado'
  ) NOT NULL,
  costoUnitarioHistorico DECIMAL(14,6) NULL,
  fechaVencimientoHistorica DATE NULL,
  creadoEn DATETIME NOT NULL,
  PRIMARY KEY (idDetalleCompensacionLote)
) ENGINE=InnoDB;

ALTER TABLE detalleCompensacionLote
  ADD UNIQUE INDEX uq_detalleCompensacionLote_tienda_id
    (idTienda, idProducto, idDetalleCompensacionLote);

ALTER TABLE detalleCompensacionLote
  ADD UNIQUE INDEX uq_detalleCompensacionLote_tienda_fuente
    (idTienda, idDetalleCompensacionVenta, idMovimientoLoteSalida);

ALTER TABLE detalleCompensacionLote
  ADD INDEX idx_detalleCompensacionLote_tienda_origen
    (idTienda, idProducto, idLoteProductoOrigen);

ALTER TABLE detalleCompensacionLote
  ADD INDEX idx_detalleCompensacionLote_tienda_destino
    (idTienda, idProducto, idLoteProductoDestino);

ALTER TABLE detalleCompensacionLote
  ADD INDEX idx_detalleCompensacionLote_tienda_movimiento
    (idTienda, idProducto, idMovimientoLoteCompensatorio);

ALTER TABLE detalleCompensacionLote
  ADD CONSTRAINT chk_detalleCompensacionLote_unidades
    CHECK (unidadesDevueltas>0);

ALTER TABLE detalleCompensacionLote
  ADD CONSTRAINT chk_detalleCompensacionLote_destino
    CHECK (
      (
        resultadoInventario='no_reintegrado'
        AND idLoteProductoDestino IS NULL
        AND idMovimientoLoteCompensatorio IS NULL
      )
      OR (
        resultadoInventario<>'no_reintegrado'
        AND idLoteProductoDestino IS NOT NULL
        AND idMovimientoLoteCompensatorio IS NOT NULL
      )
    );

ALTER TABLE detalleCompensacionLote
  ADD CONSTRAINT fk_detalleCompensacionLote_detalle
    FOREIGN KEY (idTienda, idProducto, idDetalleCompensacionVenta)
    REFERENCES detalleCompensacionVenta(idTienda, idProducto, idDetalleCompensacionVenta)
    ON UPDATE RESTRICT ON DELETE RESTRICT;

ALTER TABLE detalleCompensacionLote
  ADD CONSTRAINT fk_detalleCompensacionLote_salida
    FOREIGN KEY (idTienda, idProducto, idMovimientoLoteSalida)
    REFERENCES movimientoLote(idTienda, idProducto, idMovimientoLote)
    ON UPDATE RESTRICT ON DELETE RESTRICT;

ALTER TABLE detalleCompensacionLote
  ADD CONSTRAINT fk_detalleCompensacionLote_lote_origen
    FOREIGN KEY (idTienda, idProducto, idLoteProductoOrigen)
    REFERENCES loteProducto(idTienda, idProducto, idLoteProducto)
    ON UPDATE RESTRICT ON DELETE RESTRICT;

ALTER TABLE detalleCompensacionLote
  ADD CONSTRAINT fk_detalleCompensacionLote_lote_destino
    FOREIGN KEY (idTienda, idProducto, idLoteProductoDestino)
    REFERENCES loteProducto(idTienda, idProducto, idLoteProducto)
    ON UPDATE RESTRICT ON DELETE RESTRICT;

ALTER TABLE detalleCompensacionLote
  ADD CONSTRAINT fk_detalleCompensacionLote_movimiento
    FOREIGN KEY (idTienda, idProducto, idMovimientoLoteCompensatorio)
    REFERENCES movimientoLote(idTienda, idProducto, idMovimientoLote)
    ON UPDATE RESTRICT ON DELETE RESTRICT;
