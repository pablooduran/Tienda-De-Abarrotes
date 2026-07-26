CREATE TABLE IF NOT EXISTS eventoAuditoriaAdministrativa (
  idEventoAuditoria BIGINT NOT NULL AUTO_INCREMENT,
  idTienda INT NULL,
  actorTipo ENUM('administrador','sistema','anonimo') NOT NULL,
  idAdministradorActor INT NULL,
  categoria VARCHAR(40)
    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  accion VARCHAR(64)
    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  resultado ENUM('correcto','rechazado','fallido','limitado') NOT NULL,
  codigoResultado VARCHAR(80)
    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  origen ENUM('web','sistema','script') NOT NULL,
  entidadTipo VARCHAR(40)
    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  referenciaSegura VARCHAR(96)
    CHARACTER SET ascii COLLATE ascii_bin NULL,
  requestId CHAR(36)
    CHARACTER SET ascii COLLATE ascii_bin NULL,
  datosAnteriores JSON NULL,
  datosPosteriores JSON NULL,
  metadatos JSON NULL,
  creadoEn DATETIME NOT NULL,
  PRIMARY KEY (idEventoAuditoria)
) ENGINE=InnoDB;

ALTER TABLE eventoAuditoriaAdministrativa
  ADD UNIQUE INDEX uq_eventoAuditoria_request_accion_resultado
    (requestId, accion, resultado);

ALTER TABLE eventoAuditoriaAdministrativa
  ADD INDEX idx_eventoAuditoria_tienda_fecha
    (idTienda, creadoEn, idEventoAuditoria);

ALTER TABLE eventoAuditoriaAdministrativa
  ADD INDEX idx_eventoAuditoria_actor_fecha
    (idAdministradorActor, creadoEn, idEventoAuditoria);

ALTER TABLE eventoAuditoriaAdministrativa
  ADD INDEX idx_eventoAuditoria_categoria_accion_fecha
    (categoria, accion, creadoEn, idEventoAuditoria);

ALTER TABLE eventoAuditoriaAdministrativa
  ADD INDEX idx_eventoAuditoria_resultado_fecha
    (resultado, creadoEn, idEventoAuditoria);

ALTER TABLE eventoAuditoriaAdministrativa
  ADD CONSTRAINT chk_eventoAuditoria_actor
    CHECK (
      (actorTipo='administrador' AND idAdministradorActor IS NOT NULL)
      OR (actorTipo IN ('sistema','anonimo') AND idAdministradorActor IS NULL)
    );

ALTER TABLE eventoAuditoriaAdministrativa
  ADD CONSTRAINT chk_eventoAuditoria_categoria_accion
    CHECK (
      categoria REGEXP '^[a-z][a-z0-9_]{1,39}$'
      AND accion REGEXP '^[a-z][a-z0-9_]{1,63}$'
      AND entidadTipo REGEXP '^[a-z][a-z0-9_]{1,39}$'
    );

ALTER TABLE eventoAuditoriaAdministrativa
  ADD CONSTRAINT chk_eventoAuditoria_codigo
    CHECK (codigoResultado REGEXP '^[A-Z][A-Z0-9_]{1,79}$');

ALTER TABLE eventoAuditoriaAdministrativa
  ADD CONSTRAINT chk_eventoAuditoria_referencia
    CHECK (
      referenciaSegura IS NULL
      OR referenciaSegura REGEXP '^[a-z][a-z0-9_]{1,39}:[0-9]{1,20}$'
    );

ALTER TABLE eventoAuditoriaAdministrativa
  ADD CONSTRAINT chk_eventoAuditoria_request
    CHECK (
      requestId IS NULL
      OR requestId REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    );

ALTER TABLE eventoAuditoriaAdministrativa
  ADD CONSTRAINT fk_eventoAuditoria_tienda
    FOREIGN KEY (idTienda)
    REFERENCES tienda(idTienda) ON UPDATE RESTRICT ON DELETE RESTRICT;

ALTER TABLE eventoAuditoriaAdministrativa
  ADD CONSTRAINT fk_eventoAuditoria_actor
    FOREIGN KEY (idAdministradorActor)
    REFERENCES administrador(idAdministrador) ON UPDATE RESTRICT ON DELETE RESTRICT;
