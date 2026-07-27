ALTER TABLE loteProducto
  ADD COLUMN clasificacionInventario
    ENUM('vendible','bloqueado','aislado','tecnico')
    NOT NULL DEFAULT 'vendible'
    AFTER estadoOperativo;

UPDATE loteProducto
SET clasificacionInventario=CASE
  WHEN origen='reversion' THEN 'tecnico'
  WHEN estadoOperativo='bloqueado' THEN 'bloqueado'
  ELSE 'vendible'
END;

ALTER TABLE loteProducto
  ADD INDEX idx_lote_tienda_clasificacion_vencimiento
    (idTienda, clasificacionInventario, fechaVencimiento);

ALTER TABLE loteProducto
  ADD CONSTRAINT chk_lote_clasificacion_operativa
    CHECK (
      estadoOperativo='anulado'
      OR (
        clasificacionInventario='vendible'
        AND estadoOperativo='disponible'
      )
      OR (
        clasificacionInventario IN ('bloqueado','aislado','tecnico')
        AND estadoOperativo='bloqueado'
      )
    );

ALTER TABLE loteProducto
  ADD CONSTRAINT chk_lote_tecnico_reversion
    CHECK (
      clasificacionInventario<>'tecnico'
      OR origen='reversion'
    );

CREATE TABLE IF NOT EXISTS ajusteInventario (
  idAjusteInventario BIGINT NOT NULL AUTO_INCREMENT,
  idTienda INT NOT NULL,
  idProducto INT NOT NULL,
  idMovimientoStock BIGINT NULL,
  idLoteProducto BIGINT NULL,
  tipoAjuste ENUM('positivo','negativo') NOT NULL,
  cantidad INT NOT NULL,
  motivoCodigo ENUM(
    'conteo_fisico',
    'merma',
    'danio',
    'vencimiento',
    'correccion_registro',
    'otro_controlado'
  ) NOT NULL,
  observacion VARCHAR(500) NULL,
  modoLotes ENUM(
    'no_aplica',
    'fefo_fifo',
    'lote_explicito',
    'lote_nuevo'
  ) NOT NULL,
  clasificacionInventario
    ENUM('vendible','bloqueado','aislado','tecnico')
    NOT NULL,
  stockFisicoAnterior INT NOT NULL,
  stockFisicoPosterior INT NOT NULL,
  stockVendibleAnterior INT NOT NULL,
  stockVendiblePosterior INT NOT NULL,
  claveOperacion VARCHAR(64)
    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  huellaSolicitud CHAR(64)
    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  idAdministrador INT NOT NULL,
  creadoEn DATETIME NOT NULL,
  PRIMARY KEY (idAjusteInventario)
) ENGINE=InnoDB;

ALTER TABLE ajusteInventario
  ADD UNIQUE INDEX uq_ajusteInventario_tienda_id
    (idTienda, idAjusteInventario);

ALTER TABLE ajusteInventario
  ADD UNIQUE INDEX uq_ajusteInventario_tienda_clave
    (idTienda, claveOperacion);

ALTER TABLE ajusteInventario
  ADD UNIQUE INDEX uq_ajusteInventario_tienda_movimiento
    (idTienda, idProducto, idMovimientoStock);

ALTER TABLE ajusteInventario
  ADD INDEX idx_ajusteInventario_tienda_fecha
    (idTienda, creadoEn, idAjusteInventario);

ALTER TABLE ajusteInventario
  ADD INDEX idx_ajusteInventario_tienda_producto_fecha
    (idTienda, idProducto, creadoEn, idAjusteInventario);

ALTER TABLE ajusteInventario
  ADD INDEX idx_ajusteInventario_tienda_lote
    (idTienda, idProducto, idLoteProducto);

ALTER TABLE ajusteInventario
  ADD CONSTRAINT chk_ajusteInventario_cantidad
    CHECK (cantidad>0);

ALTER TABLE ajusteInventario
  ADD CONSTRAINT chk_ajusteInventario_stock
    CHECK (
      stockFisicoAnterior>=0
      AND stockFisicoPosterior>=0
      AND stockVendibleAnterior>=0
      AND stockVendiblePosterior>=0
      AND stockVendibleAnterior<=stockFisicoAnterior
      AND stockVendiblePosterior<=stockFisicoPosterior
      AND (
        (tipoAjuste='positivo' AND stockFisicoPosterior=stockFisicoAnterior+cantidad)
        OR
        (tipoAjuste='negativo' AND stockFisicoPosterior=stockFisicoAnterior-cantidad)
      )
    );

ALTER TABLE ajusteInventario
  ADD CONSTRAINT chk_ajusteInventario_otro
    CHECK (
      motivoCodigo<>'otro_controlado'
      OR CHAR_LENGTH(TRIM(observacion))>=5
    );

ALTER TABLE ajusteInventario
  ADD CONSTRAINT chk_ajusteInventario_lotes
    CHECK (
      (modoLotes='no_aplica' AND idLoteProducto IS NULL AND clasificacionInventario='vendible')
      OR (modoLotes='fefo_fifo' AND idLoteProducto IS NULL)
      OR (modoLotes IN ('lote_explicito','lote_nuevo') AND idLoteProducto IS NOT NULL)
    );

ALTER TABLE ajusteInventario
  ADD CONSTRAINT chk_ajusteInventario_clave
    CHECK (
      claveOperacion REGEXP '^[A-Za-z0-9._:-]{8,64}$'
      AND huellaSolicitud REGEXP '^[0-9a-f]{64}$'
    );

ALTER TABLE ajusteInventario
  ADD CONSTRAINT fk_ajusteInventario_tienda
    FOREIGN KEY (idTienda)
    REFERENCES tienda(idTienda) ON UPDATE RESTRICT ON DELETE RESTRICT;

ALTER TABLE ajusteInventario
  ADD CONSTRAINT fk_ajusteInventario_producto
    FOREIGN KEY (idTienda, idProducto)
    REFERENCES producto(idTienda, idProducto) ON UPDATE RESTRICT ON DELETE RESTRICT;

ALTER TABLE ajusteInventario
  ADD CONSTRAINT fk_ajusteInventario_movimiento
    FOREIGN KEY (idTienda, idProducto, idMovimientoStock)
    REFERENCES movimientoStock(idTienda, idProducto, idMovimientoStock)
    ON UPDATE RESTRICT ON DELETE RESTRICT;

ALTER TABLE ajusteInventario
  ADD CONSTRAINT fk_ajusteInventario_lote
    FOREIGN KEY (idTienda, idProducto, idLoteProducto)
    REFERENCES loteProducto(idTienda, idProducto, idLoteProducto)
    ON UPDATE RESTRICT ON DELETE RESTRICT;

ALTER TABLE ajusteInventario
  ADD CONSTRAINT fk_ajusteInventario_administrador
    FOREIGN KEY (idTienda, idAdministrador)
    REFERENCES administrador(idTienda, idAdministrador)
    ON UPDATE RESTRICT ON DELETE RESTRICT;
