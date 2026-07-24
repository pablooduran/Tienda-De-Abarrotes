ALTER TABLE venta
  ADD COLUMN montoCompensado DECIMAL(12,2) NOT NULL DEFAULT 0
    AFTER montoPagado;

ALTER TABLE venta
  DROP CHECK chk_venta_saldo_pos;

ALTER TABLE venta
  ADD CONSTRAINT chk_venta_saldo_pos
    CHECK (
      montoPagado>=0
      AND montoCompensado>=0
      AND saldoPendiente>=0
      AND (
        estadoPago='legado'
        OR ABS(
          saldoPendiente
          - GREATEST(total-montoPagado-montoCompensado, 0)
        )<0.01
      )
    );

ALTER TABLE venta
  DROP CHECK chk_venta_estado_pos;

ALTER TABLE venta
  ADD CONSTRAINT chk_venta_estado_pos
    CHECK (
      estadoPago='legado'
      OR (
        estadoPago='pagada'
        AND saldoPendiente=0
        AND montoPagado+montoCompensado>=total-0.01
      )
      OR (
        estadoPago='parcial'
        AND montoPagado>0
        AND saldoPendiente>0
      )
      OR (
        estadoPago='pendiente'
        AND montoPagado=0
        AND saldoPendiente>0
      )
    );

ALTER TABLE venta
  ADD CONSTRAINT chk_venta_monto_compensado
    CHECK (montoCompensado>=0 AND montoCompensado<=total);

ALTER TABLE fiado
  ADD COLUMN totalCompensado DECIMAL(12,2) NOT NULL DEFAULT 0
    AFTER totalPagado;

ALTER TABLE fiado
  ADD CONSTRAINT chk_fiado_compensacion_financiera
    CHECK (
      totalCompensado>=0
      AND totalPagado+totalCompensado<=totalFiado+0.01
      AND ABS(saldoPendiente-(totalFiado-totalPagado-totalCompensado))<0.01
    );

ALTER TABLE cobroFiado
  ADD COLUMN estadoOperacion ENUM('vigente','compensado')
    NOT NULL DEFAULT 'vigente' AFTER esLegado;

ALTER TABLE cobroFiado
  ADD INDEX idx_cobroFiado_tienda_estado_operacion
    (idTienda, estadoOperacion, fechaCobro, idCobroFiado);

ALTER TABLE cobroFiado
  ADD CONSTRAINT chk_cobroFiado_estado_operacion
    CHECK (estadoOperacion IN ('vigente','compensado'));

ALTER TABLE pagoVenta
  ADD UNIQUE INDEX uq_pagoVenta_tienda_id
    (idTienda, idPagoVenta);

CREATE TABLE IF NOT EXISTS resolucionLiquidacionVenta (
  idResolucionLiquidacionVenta BIGINT NOT NULL AUTO_INCREMENT,
  idTienda INT NOT NULL,
  idOperacionCompensatoria BIGINT NOT NULL,
  idLiquidacionCompensacionVenta BIGINT NOT NULL,
  idFiado INT NULL,
  montoReduccionDeuda DECIMAL(12,2) NOT NULL,
  montoReembolso DECIMAL(12,2) NOT NULL,
  periodoOriginalCerrado TINYINT(1) NOT NULL DEFAULT 0,
  creadoEn DATETIME NOT NULL,
  idAdministrador INT NOT NULL,
  PRIMARY KEY (idResolucionLiquidacionVenta)
) ENGINE=InnoDB;

ALTER TABLE resolucionLiquidacionVenta
  ADD UNIQUE INDEX uq_resolucionLiquidacion_tienda_id
    (idTienda, idResolucionLiquidacionVenta);

ALTER TABLE resolucionLiquidacionVenta
  ADD UNIQUE INDEX uq_resolucionLiquidacion_tienda_operacion
    (idTienda, idOperacionCompensatoria);

ALTER TABLE resolucionLiquidacionVenta
  ADD UNIQUE INDEX uq_resolucionLiquidacion_tienda_liquidacion
    (idTienda, idLiquidacionCompensacionVenta);

ALTER TABLE resolucionLiquidacionVenta
  ADD INDEX idx_resolucionLiquidacion_tienda_fiado
    (idTienda, idFiado, creadoEn);

ALTER TABLE resolucionLiquidacionVenta
  ADD CONSTRAINT chk_resolucionLiquidacion_montos
    CHECK (
      montoReduccionDeuda>=0
      AND montoReembolso>=0
      AND montoReduccionDeuda+montoReembolso>0
    );

ALTER TABLE resolucionLiquidacionVenta
  ADD CONSTRAINT chk_resolucionLiquidacion_periodo
    CHECK (periodoOriginalCerrado IN (0,1));

ALTER TABLE resolucionLiquidacionVenta
  ADD CONSTRAINT fk_resolucionLiquidacion_operacion
    FOREIGN KEY (idTienda, idOperacionCompensatoria)
    REFERENCES operacionCompensatoria(idTienda, idOperacionCompensatoria)
    ON UPDATE RESTRICT ON DELETE RESTRICT;

ALTER TABLE resolucionLiquidacionVenta
  ADD CONSTRAINT fk_resolucionLiquidacion_liquidacion
    FOREIGN KEY (idTienda, idLiquidacionCompensacionVenta)
    REFERENCES liquidacionCompensacionVenta(idTienda, idLiquidacionCompensacionVenta)
    ON UPDATE RESTRICT ON DELETE RESTRICT;

ALTER TABLE resolucionLiquidacionVenta
  ADD CONSTRAINT fk_resolucionLiquidacion_fiado
    FOREIGN KEY (idTienda, idFiado)
    REFERENCES fiado(idTienda, idFiado)
    ON UPDATE RESTRICT ON DELETE RESTRICT;

ALTER TABLE resolucionLiquidacionVenta
  ADD CONSTRAINT fk_resolucionLiquidacion_administrador
    FOREIGN KEY (idTienda, idAdministrador)
    REFERENCES administrador(idTienda, idAdministrador)
    ON UPDATE RESTRICT ON DELETE RESTRICT;

CREATE TABLE IF NOT EXISTS obligacionReembolsoVenta (
  idObligacionReembolsoVenta BIGINT NOT NULL AUTO_INCREMENT,
  idTienda INT NOT NULL,
  idResolucionLiquidacionVenta BIGINT NOT NULL,
  idVenta INT NOT NULL,
  monto DECIMAL(12,2) NOT NULL,
  estado ENUM(
    'pendiente',
    'reembolsado',
    'credito_a_favor',
    'compensado'
  ) NOT NULL DEFAULT 'pendiente',
  creadoEn DATETIME NOT NULL,
  resueltoEn DATETIME NULL,
  idAdministradorResuelve INT NULL,
  PRIMARY KEY (idObligacionReembolsoVenta)
) ENGINE=InnoDB;

ALTER TABLE obligacionReembolsoVenta
  ADD UNIQUE INDEX uq_obligacionReembolso_tienda_id
    (idTienda, idObligacionReembolsoVenta);

ALTER TABLE obligacionReembolsoVenta
  ADD UNIQUE INDEX uq_obligacionReembolso_tienda_resolucion
    (idTienda, idResolucionLiquidacionVenta);

ALTER TABLE obligacionReembolsoVenta
  ADD INDEX idx_obligacionReembolso_tienda_estado
    (idTienda, estado, creadoEn);

ALTER TABLE obligacionReembolsoVenta
  ADD INDEX idx_obligacionReembolso_tienda_venta
    (idTienda, idVenta, creadoEn);

ALTER TABLE obligacionReembolsoVenta
  ADD CONSTRAINT chk_obligacionReembolso_monto
    CHECK (monto>0);

ALTER TABLE obligacionReembolsoVenta
  ADD CONSTRAINT chk_obligacionReembolso_estado
    CHECK (
      (
        estado='pendiente'
        AND resueltoEn IS NULL
        AND idAdministradorResuelve IS NULL
      )
      OR (
        estado IN ('reembolsado','credito_a_favor','compensado')
        AND resueltoEn IS NOT NULL
        AND idAdministradorResuelve IS NOT NULL
      )
    );

ALTER TABLE obligacionReembolsoVenta
  ADD CONSTRAINT fk_obligacionReembolso_resolucion
    FOREIGN KEY (idTienda, idResolucionLiquidacionVenta)
    REFERENCES resolucionLiquidacionVenta(idTienda, idResolucionLiquidacionVenta)
    ON UPDATE RESTRICT ON DELETE RESTRICT;

ALTER TABLE obligacionReembolsoVenta
  ADD CONSTRAINT fk_obligacionReembolso_venta
    FOREIGN KEY (idTienda, idVenta)
    REFERENCES venta(idTienda, idVenta)
    ON UPDATE RESTRICT ON DELETE RESTRICT;

ALTER TABLE obligacionReembolsoVenta
  ADD CONSTRAINT fk_obligacionReembolso_administrador
    FOREIGN KEY (idTienda, idAdministradorResuelve)
    REFERENCES administrador(idTienda, idAdministrador)
    ON UPDATE RESTRICT ON DELETE RESTRICT;

CREATE TABLE IF NOT EXISTS detalleObligacionReembolsoPago (
  idDetalleObligacionReembolsoPago BIGINT NOT NULL AUTO_INCREMENT,
  idTienda INT NOT NULL,
  idObligacionReembolsoVenta BIGINT NOT NULL,
  idPagoVenta BIGINT NOT NULL,
  metodoOriginal ENUM(
    'efectivo','qr','transferencia','tarjeta','otro','no_especificado'
  ) NOT NULL,
  monto DECIMAL(12,2) NOT NULL,
  creadoEn DATETIME NOT NULL,
  PRIMARY KEY (idDetalleObligacionReembolsoPago)
) ENGINE=InnoDB;

ALTER TABLE detalleObligacionReembolsoPago
  ADD UNIQUE INDEX uq_detalleReembolso_tienda_id
    (idTienda, idDetalleObligacionReembolsoPago);

ALTER TABLE detalleObligacionReembolsoPago
  ADD UNIQUE INDEX uq_detalleReembolso_tienda_pago
    (idTienda, idObligacionReembolsoVenta, idPagoVenta);

ALTER TABLE detalleObligacionReembolsoPago
  ADD INDEX idx_detalleReembolso_tienda_obligacion
    (idTienda, idObligacionReembolsoVenta, idDetalleObligacionReembolsoPago);

ALTER TABLE detalleObligacionReembolsoPago
  ADD CONSTRAINT chk_detalleReembolso_monto
    CHECK (monto>0);

ALTER TABLE detalleObligacionReembolsoPago
  ADD CONSTRAINT fk_detalleReembolso_obligacion
    FOREIGN KEY (idTienda, idObligacionReembolsoVenta)
    REFERENCES obligacionReembolsoVenta(idTienda, idObligacionReembolsoVenta)
    ON UPDATE RESTRICT ON DELETE RESTRICT;

ALTER TABLE detalleObligacionReembolsoPago
  ADD CONSTRAINT fk_detalleReembolso_pago
    FOREIGN KEY (idTienda, idPagoVenta)
    REFERENCES pagoVenta(idTienda, idPagoVenta)
    ON UPDATE RESTRICT ON DELETE RESTRICT;

CREATE TABLE IF NOT EXISTS compensacionCobroFiado (
  idCompensacionCobroFiado BIGINT NOT NULL AUTO_INCREMENT,
  idTienda INT NOT NULL,
  idOperacionCompensatoria BIGINT NOT NULL,
  idCobroFiado BIGINT NOT NULL,
  tipoCompensacion ENUM('anulacion_total','correccion_metodo') NOT NULL,
  montoCompensado DECIMAL(12,2) NOT NULL,
  metodoOriginal ENUM(
    'efectivo','qr','transferencia','tarjeta','otro','no_especificado'
  ) NOT NULL,
  metodoDestino ENUM(
    'efectivo','qr','transferencia','tarjeta','otro','no_especificado'
  ) NULL,
  montoRecibidoDestino DECIMAL(12,2) NULL,
  cambioDestino DECIMAL(12,2) NOT NULL DEFAULT 0,
  referenciaDestino VARCHAR(160) NULL,
  periodoOriginalCerrado TINYINT(1) NOT NULL DEFAULT 0,
  creadoEn DATETIME NOT NULL,
  PRIMARY KEY (idCompensacionCobroFiado)
) ENGINE=InnoDB;

ALTER TABLE compensacionCobroFiado
  ADD UNIQUE INDEX uq_compensacionCobro_tienda_id
    (idTienda, idCompensacionCobroFiado);

ALTER TABLE compensacionCobroFiado
  ADD UNIQUE INDEX uq_compensacionCobro_tienda_operacion
    (idTienda, idOperacionCompensatoria);

ALTER TABLE compensacionCobroFiado
  ADD UNIQUE INDEX uq_compensacionCobro_tienda_tipo
    (idTienda, idCobroFiado, tipoCompensacion);

ALTER TABLE compensacionCobroFiado
  ADD INDEX idx_compensacionCobro_tienda_cobro
    (idTienda, idCobroFiado, creadoEn);

ALTER TABLE compensacionCobroFiado
  ADD CONSTRAINT chk_compensacionCobro_monto
    CHECK (montoCompensado>0);

ALTER TABLE compensacionCobroFiado
  ADD CONSTRAINT chk_compensacionCobro_metodo
    CHECK (
      (
        tipoCompensacion='anulacion_total'
        AND metodoDestino IS NULL
        AND montoRecibidoDestino IS NULL
        AND cambioDestino=0
        AND referenciaDestino IS NULL
      )
      OR (
        tipoCompensacion='correccion_metodo'
        AND metodoDestino IS NOT NULL
        AND metodoDestino<>metodoOriginal
        AND (
          (
            metodoDestino='efectivo'
            AND montoRecibidoDestino IS NOT NULL
            AND montoRecibidoDestino>=montoCompensado
            AND ABS(
              (montoRecibidoDestino-montoCompensado)-cambioDestino
            )<0.01
          )
          OR (
            metodoDestino<>'efectivo'
            AND montoRecibidoDestino IS NULL
            AND cambioDestino=0
          )
        )
      )
    );

ALTER TABLE compensacionCobroFiado
  ADD CONSTRAINT chk_compensacionCobro_periodo
    CHECK (periodoOriginalCerrado IN (0,1));

ALTER TABLE compensacionCobroFiado
  ADD CONSTRAINT fk_compensacionCobro_operacion
    FOREIGN KEY (idTienda, idOperacionCompensatoria)
    REFERENCES operacionCompensatoria(idTienda, idOperacionCompensatoria)
    ON UPDATE RESTRICT ON DELETE RESTRICT;

ALTER TABLE compensacionCobroFiado
  ADD CONSTRAINT fk_compensacionCobro_cobro
    FOREIGN KEY (idTienda, idCobroFiado)
    REFERENCES cobroFiado(idTienda, idCobroFiado)
    ON UPDATE RESTRICT ON DELETE RESTRICT;

CREATE TABLE IF NOT EXISTS detalleCompensacionCobro (
  idDetalleCompensacionCobro BIGINT NOT NULL AUTO_INCREMENT,
  idTienda INT NOT NULL,
  idCompensacionCobroFiado BIGINT NOT NULL,
  idPagoFiado INT NOT NULL,
  idPagoVenta BIGINT NULL,
  idFiado INT NOT NULL,
  montoCompensado DECIMAL(12,2) NOT NULL,
  creadoEn DATETIME NOT NULL,
  PRIMARY KEY (idDetalleCompensacionCobro)
) ENGINE=InnoDB;

ALTER TABLE detalleCompensacionCobro
  ADD UNIQUE INDEX uq_detalleCompensacionCobro_tienda_id
    (idTienda, idDetalleCompensacionCobro);

ALTER TABLE detalleCompensacionCobro
  ADD UNIQUE INDEX uq_detalleCompensacionCobro_tienda_pago_fiado
    (idTienda, idPagoFiado);

ALTER TABLE detalleCompensacionCobro
  ADD INDEX idx_detalleCompensacionCobro_tienda_compensacion
    (idTienda, idCompensacionCobroFiado, idDetalleCompensacionCobro);

ALTER TABLE detalleCompensacionCobro
  ADD INDEX idx_detalleCompensacionCobro_tienda_pago_venta
    (idTienda, idPagoVenta);

ALTER TABLE detalleCompensacionCobro
  ADD CONSTRAINT chk_detalleCompensacionCobro_monto
    CHECK (montoCompensado>0);

ALTER TABLE detalleCompensacionCobro
  ADD CONSTRAINT fk_detalleCompensacionCobro_compensacion
    FOREIGN KEY (idTienda, idCompensacionCobroFiado)
    REFERENCES compensacionCobroFiado(idTienda, idCompensacionCobroFiado)
    ON UPDATE RESTRICT ON DELETE RESTRICT;

ALTER TABLE detalleCompensacionCobro
  ADD CONSTRAINT fk_detalleCompensacionCobro_pago_fiado
    FOREIGN KEY (idTienda, idPagoFiado)
    REFERENCES pagoFiado(idTienda, idPagoFiado)
    ON UPDATE RESTRICT ON DELETE RESTRICT;

ALTER TABLE detalleCompensacionCobro
  ADD CONSTRAINT fk_detalleCompensacionCobro_pago_venta
    FOREIGN KEY (idTienda, idPagoVenta)
    REFERENCES pagoVenta(idTienda, idPagoVenta)
    ON UPDATE RESTRICT ON DELETE RESTRICT;

ALTER TABLE detalleCompensacionCobro
  ADD CONSTRAINT fk_detalleCompensacionCobro_fiado
    FOREIGN KEY (idTienda, idFiado)
    REFERENCES fiado(idTienda, idFiado)
    ON UPDATE RESTRICT ON DELETE RESTRICT;

CREATE TABLE IF NOT EXISTS compensacionPagoVenta (
  idCompensacionPagoVenta BIGINT NOT NULL AUTO_INCREMENT,
  idTienda INT NOT NULL,
  idOperacionCompensatoria BIGINT NOT NULL,
  idPagoVenta BIGINT NOT NULL,
  idVenta INT NOT NULL,
  monto DECIMAL(12,2) NOT NULL,
  metodoOriginal ENUM('efectivo','qr','no_especificado') NOT NULL,
  metodoDestino ENUM('efectivo','qr','no_especificado') NOT NULL,
  montoRecibidoDestino DECIMAL(12,2) NULL,
  cambioDestino DECIMAL(12,2) NOT NULL DEFAULT 0,
  referenciaDestino VARCHAR(120) NULL,
  periodoOriginalCerrado TINYINT(1) NOT NULL DEFAULT 0,
  creadoEn DATETIME NOT NULL,
  PRIMARY KEY (idCompensacionPagoVenta)
) ENGINE=InnoDB;

ALTER TABLE compensacionPagoVenta
  ADD UNIQUE INDEX uq_compensacionPago_tienda_id
    (idTienda, idCompensacionPagoVenta);

ALTER TABLE compensacionPagoVenta
  ADD UNIQUE INDEX uq_compensacionPago_tienda_operacion
    (idTienda, idOperacionCompensatoria);

ALTER TABLE compensacionPagoVenta
  ADD UNIQUE INDEX uq_compensacionPago_tienda_pago
    (idTienda, idPagoVenta);

ALTER TABLE compensacionPagoVenta
  ADD INDEX idx_compensacionPago_tienda_venta
    (idTienda, idVenta, creadoEn);

ALTER TABLE compensacionPagoVenta
  ADD CONSTRAINT chk_compensacionPago_monto
    CHECK (monto>0);

ALTER TABLE compensacionPagoVenta
  ADD CONSTRAINT chk_compensacionPago_metodo
    CHECK (
      metodoDestino<>metodoOriginal
      AND (
        (
          metodoDestino='efectivo'
          AND montoRecibidoDestino IS NOT NULL
          AND montoRecibidoDestino>=monto
          AND ABS((montoRecibidoDestino-monto)-cambioDestino)<0.01
        )
        OR (
          metodoDestino<>'efectivo'
          AND montoRecibidoDestino IS NULL
          AND cambioDestino=0
        )
      )
    );

ALTER TABLE compensacionPagoVenta
  ADD CONSTRAINT chk_compensacionPago_periodo
    CHECK (periodoOriginalCerrado IN (0,1));

ALTER TABLE compensacionPagoVenta
  ADD CONSTRAINT fk_compensacionPago_operacion
    FOREIGN KEY (idTienda, idOperacionCompensatoria)
    REFERENCES operacionCompensatoria(idTienda, idOperacionCompensatoria)
    ON UPDATE RESTRICT ON DELETE RESTRICT;

ALTER TABLE compensacionPagoVenta
  ADD CONSTRAINT fk_compensacionPago_pago
    FOREIGN KEY (idTienda, idPagoVenta)
    REFERENCES pagoVenta(idTienda, idPagoVenta)
    ON UPDATE RESTRICT ON DELETE RESTRICT;

ALTER TABLE compensacionPagoVenta
  ADD CONSTRAINT fk_compensacionPago_venta
    FOREIGN KEY (idTienda, idVenta)
    REFERENCES venta(idTienda, idVenta)
    ON UPDATE RESTRICT ON DELETE RESTRICT;
