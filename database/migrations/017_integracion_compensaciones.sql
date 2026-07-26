CREATE TABLE IF NOT EXISTS movimientoLiquidacionCompensacion (
  idMovimientoLiquidacionCompensacion BIGINT NOT NULL AUTO_INCREMENT,
  idTienda INT NOT NULL,
  idOperacionCompensatoria BIGINT NOT NULL,
  idObligacionReembolsoVenta BIGINT NOT NULL,
  tipoLiquidacion ENUM(
    'reembolso_realizado',
    'compensacion_otro_medio'
  ) NOT NULL,
  metodoLiquidacion ENUM(
    'efectivo',
    'qr',
    'transferencia',
    'tarjeta',
    'otro',
    'no_especificado'
  ) NOT NULL,
  monto DECIMAL(12,2) NOT NULL,
  referencia VARCHAR(160) NULL,
  observacion VARCHAR(500) NULL,
  periodoOriginalCerrado TINYINT(1) NOT NULL DEFAULT 0,
  fechaMovimiento DATETIME NOT NULL,
  idAdministrador INT NOT NULL,
  PRIMARY KEY (idMovimientoLiquidacionCompensacion)
) ENGINE=InnoDB;

ALTER TABLE movimientoLiquidacionCompensacion
  ADD UNIQUE INDEX uq_movimientoLiquidacion_tienda_id
    (idTienda, idMovimientoLiquidacionCompensacion);

ALTER TABLE movimientoLiquidacionCompensacion
  ADD UNIQUE INDEX uq_movimientoLiquidacion_tienda_operacion
    (idTienda, idOperacionCompensatoria);

ALTER TABLE movimientoLiquidacionCompensacion
  ADD INDEX idx_movimientoLiquidacion_tienda_obligacion
    (idTienda, idObligacionReembolsoVenta, fechaMovimiento,
     idMovimientoLiquidacionCompensacion);

ALTER TABLE movimientoLiquidacionCompensacion
  ADD INDEX idx_movimientoLiquidacion_tienda_fecha_metodo
    (idTienda, fechaMovimiento, metodoLiquidacion,
     idMovimientoLiquidacionCompensacion);

ALTER TABLE movimientoLiquidacionCompensacion
  ADD CONSTRAINT chk_movimientoLiquidacion_monto
    CHECK (monto>0);

ALTER TABLE movimientoLiquidacionCompensacion
  ADD CONSTRAINT chk_movimientoLiquidacion_periodo
    CHECK (periodoOriginalCerrado IN (0,1));

ALTER TABLE movimientoLiquidacionCompensacion
  ADD CONSTRAINT chk_movimientoLiquidacion_referencia
    CHECK (
      metodoLiquidacion='efectivo'
      OR (referencia IS NOT NULL AND CHAR_LENGTH(TRIM(referencia))>0)
    );

ALTER TABLE movimientoLiquidacionCompensacion
  ADD CONSTRAINT fk_movimientoLiquidacion_operacion
    FOREIGN KEY (idTienda, idOperacionCompensatoria)
    REFERENCES operacionCompensatoria(idTienda, idOperacionCompensatoria)
    ON UPDATE RESTRICT ON DELETE RESTRICT;

ALTER TABLE movimientoLiquidacionCompensacion
  ADD CONSTRAINT fk_movimientoLiquidacion_obligacion
    FOREIGN KEY (idTienda, idObligacionReembolsoVenta)
    REFERENCES obligacionReembolsoVenta(idTienda, idObligacionReembolsoVenta)
    ON UPDATE RESTRICT ON DELETE RESTRICT;

ALTER TABLE movimientoLiquidacionCompensacion
  ADD CONSTRAINT fk_movimientoLiquidacion_administrador
    FOREIGN KEY (idTienda, idAdministrador)
    REFERENCES administrador(idTienda, idAdministrador)
    ON UPDATE RESTRICT ON DELETE RESTRICT;

ALTER TABLE cierreCaja
  ADD COLUMN compensacionesEfectivo DECIMAL(12,2) NOT NULL DEFAULT 0
    AFTER gastosEfectivo;

ALTER TABLE cierreCaja
  ADD COLUMN reembolsosEfectivo DECIMAL(12,2) NOT NULL DEFAULT 0
    AFTER compensacionesEfectivo;

ALTER TABLE cierreCaja
  ADD COLUMN compensacionesCobroTotal DECIMAL(12,2) NOT NULL DEFAULT 0
    AFTER reembolsosEfectivo;

ALTER TABLE cierreCaja
  ADD COLUMN reembolsosTotal DECIMAL(12,2) NOT NULL DEFAULT 0
    AFTER compensacionesCobroTotal;

ALTER TABLE cierreCaja
  ADD COLUMN compensacionesVenta DECIMAL(12,2) NOT NULL DEFAULT 0
    AFTER totalVentas;

ALTER TABLE cierreCaja
  ADD COLUMN liquidacionesOtroMedio DECIMAL(12,2) NOT NULL DEFAULT 0
    AFTER compensacionesVenta;

ALTER TABLE cierreCaja
  ADD CONSTRAINT chk_cierreCaja_compensaciones
    CHECK (
      compensacionesEfectivo>=0
      AND reembolsosEfectivo>=0
      AND compensacionesCobroTotal>=0
      AND reembolsosTotal>=0
      AND compensacionesVenta>=0
      AND liquidacionesOtroMedio>=0
    );

ALTER TABLE cierreCaja
  DROP CHECK chk_cierreCaja_balance;

ALTER TABLE cierreCaja
  ADD CONSTRAINT chk_cierreCaja_balance
    CHECK (
      ABS(
        efectivoEsperado
        - (
          efectivoInicial
          + efectivoVentasEsperado
          + efectivoFiadosCobrado
          - gastosEfectivo
          - compensacionesEfectivo
          - reembolsosEfectivo
        )
      )<0.01
      AND ABS(diferencia-(efectivoContado-efectivoEsperado))<0.01
    );
