-- SAAS-C1.1: corrige idempotencia global y snapshot del plan actual.
-- No crea rutas, solicitudes, tasas ni configuraciones de metodos.

ALTER TABLE solicitudPagoSuscripcion
  ADD COLUMN planActualCodigoSnapshot
    VARCHAR(50) CHARACTER SET ascii COLLATE ascii_bin NULL
    AFTER cantidadMeses;

ALTER TABLE solicitudPagoSuscripcion
  ADD COLUMN planActualNombreSnapshot VARCHAR(100) NULL
    AFTER planActualCodigoSnapshot;

ALTER TABLE solicitudPagoSuscripcion
  ADD CONSTRAINT chk_solicitudPago_plan_actual_snapshot CHECK (
    (operacion='nueva_activacion'
      AND ((idPlanActual IS NULL
          AND planActualCodigoSnapshot IS NULL
          AND planActualNombreSnapshot IS NULL)
        OR (idPlanActual IS NOT NULL
          AND planActualCodigoSnapshot REGEXP '^[a-z][a-z0-9_-]{1,49}$'
          AND CHAR_LENGTH(TRIM(planActualNombreSnapshot)) BETWEEN 1 AND 100)))
    OR (operacion IN ('renovacion','reactivacion','upgrade')
      AND idPlanActual IS NOT NULL
      AND planActualCodigoSnapshot REGEXP '^[a-z][a-z0-9_-]{1,49}$'
      AND CHAR_LENGTH(TRIM(planActualNombreSnapshot)) BETWEEN 1 AND 100)
  );

ALTER TABLE operacionPagoSuscripcion
  MODIFY COLUMN idTienda INT NULL;

ALTER TABLE operacionPagoSuscripcion
  MODIFY COLUMN alcance ENUM(
    'crear_solicitud','cargar_comprobante','enviar_revision',
    'revisar','aplicar','cancelar','registrar_tipo_cambio','configurar_metodo'
  ) NOT NULL;

ALTER TABLE operacionPagoSuscripcion
  ADD COLUMN idTipoCambioResultado BIGINT NULL AFTER codigoResultado;

ALTER TABLE operacionPagoSuscripcion
  ADD COLUMN idMetodoPagoResultado INT NULL AFTER idTipoCambioResultado;

ALTER TABLE operacionPagoSuscripcion
  ADD COLUMN idTiendaClave INT GENERATED ALWAYS AS
    (COALESCE(idTienda,0)) STORED AFTER idActorClave;

ALTER TABLE operacionPagoSuscripcion
  ADD UNIQUE INDEX uq_operacionPago_clave_ambito
    (idTiendaClave,actorTipo,idActorClave,alcance,claveHash);

ALTER TABLE operacionPagoSuscripcion
  ADD INDEX idx_operacionPago_tipoCambio_resultado (idTipoCambioResultado);

ALTER TABLE operacionPagoSuscripcion
  ADD INDEX idx_operacionPago_metodo_resultado (idMetodoPagoResultado);

ALTER TABLE operacionPagoSuscripcion
  ADD CONSTRAINT chk_operacionPago_alcance_tenant CHECK (
    (alcance IN ('registrar_tipo_cambio','configurar_metodo')
      AND idTienda IS NULL
      AND idSolicitudPago IS NULL
      AND actorTipo='superadmin'
      AND idAdministradorActor IS NOT NULL)
    OR (alcance IN (
        'crear_solicitud','cargar_comprobante','enviar_revision',
        'revisar','aplicar','cancelar'
      ) AND idTienda IS NOT NULL)
  );

ALTER TABLE operacionPagoSuscripcion
  ADD CONSTRAINT chk_operacionPago_resultado_tipado CHECK (
    (alcance='registrar_tipo_cambio'
      AND resultadoReferencia IS NULL
      AND ((estado='completada'
          AND idTipoCambioResultado IS NOT NULL
          AND idMetodoPagoResultado IS NULL)
        OR (estado IN ('en_proceso','fallida')
          AND idTipoCambioResultado IS NULL
          AND idMetodoPagoResultado IS NULL)))
    OR (alcance='configurar_metodo'
      AND resultadoReferencia IS NULL
      AND ((estado='completada'
          AND idTipoCambioResultado IS NULL
          AND idMetodoPagoResultado IS NOT NULL)
        OR (estado IN ('en_proceso','fallida')
          AND idTipoCambioResultado IS NULL
          AND idMetodoPagoResultado IS NULL)))
    OR (alcance IN (
        'crear_solicitud','cargar_comprobante','enviar_revision',
        'revisar','aplicar','cancelar'
      )
      AND idTipoCambioResultado IS NULL
      AND idMetodoPagoResultado IS NULL)
  );

ALTER TABLE operacionPagoSuscripcion
  ADD CONSTRAINT fk_operacionPago_tipoCambio_resultado
    FOREIGN KEY (idTipoCambioResultado)
    REFERENCES tipoCambioSuscripcion(idTipoCambioSuscripcion)
    ON UPDATE RESTRICT ON DELETE RESTRICT;

ALTER TABLE operacionPagoSuscripcion
  ADD CONSTRAINT fk_operacionPago_metodo_resultado
    FOREIGN KEY (idMetodoPagoResultado)
    REFERENCES metodoPagoSuscripcion(idMetodoPagoSuscripcion)
    ON UPDATE RESTRICT ON DELETE RESTRICT;
