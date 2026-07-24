SET @fecha_local_014 = __MIGRATION_LOCAL_DATETIME__;

ALTER TABLE venta
  ADD COLUMN estadoOperacion
    ENUM('vigente','devuelta_parcial','anulada') NULL AFTER estadoPago;

UPDATE venta
SET estadoOperacion='vigente'
WHERE estadoOperacion IS NULL;

ALTER TABLE venta
  MODIFY COLUMN estadoOperacion
    ENUM('vigente','devuelta_parcial','anulada') NOT NULL DEFAULT 'vigente';

ALTER TABLE venta
  ADD INDEX idx_venta_tienda_estado_operacion_fecha
    (idTienda, estadoOperacion, fecha, idVenta);

ALTER TABLE venta
  ADD CONSTRAINT chk_venta_estado_operacion
    CHECK (estadoOperacion IN ('vigente','devuelta_parcial','anulada'));

CREATE TABLE IF NOT EXISTS operacionCompensatoria (
  idOperacionCompensatoria BIGINT NOT NULL AUTO_INCREMENT,
  idTienda INT NOT NULL,
  tipoOperacion ENUM(
    'anulacion_venta',
    'devolucion_venta',
    'correccion_pago_venta',
    'anulacion_fiado',
    'anulacion_cobro_fiado',
    'correccion_saldo'
  ) NOT NULL,
  estado ENUM(
    'solicitada',
    'pendiente_aprobacion',
    'aprobada',
    'aplicada',
    'rechazada',
    'fallida',
    'cancelada'
  ) NOT NULL DEFAULT 'solicitada',
  motivoCodigo ENUM(
    'error_cantidad',
    'error_producto',
    'error_cliente',
    'error_metodo_pago',
    'operacion_duplicada',
    'devolucion_cliente',
    'mercaderia_danada',
    'otro_controlado'
  ) NOT NULL,
  observacion VARCHAR(1000) NULL,
  requiereAprobacion TINYINT(1) NOT NULL DEFAULT 0,
  idAdministradorSolicitante INT NOT NULL,
  idAdministradorAprobador INT NULL,
  claveOperacion VARCHAR(160)
    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  huellaSolicitud CHAR(64)
    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  fechaSolicitud DATETIME NOT NULL,
  fechaAprobacion DATETIME NULL,
  fechaAplicacion DATETIME NULL,
  creadoEn DATETIME NOT NULL,
  actualizadoEn DATETIME NOT NULL,
  PRIMARY KEY (idOperacionCompensatoria)
) ENGINE=InnoDB;

ALTER TABLE operacionCompensatoria
  ADD UNIQUE INDEX uq_operacionCompensatoria_tienda_id
    (idTienda, idOperacionCompensatoria);

ALTER TABLE operacionCompensatoria
  ADD UNIQUE INDEX uq_operacionCompensatoria_tienda_clave
    (idTienda, claveOperacion);

ALTER TABLE operacionCompensatoria
  ADD INDEX idx_operacionCompensatoria_tienda_tipo_estado
    (idTienda, tipoOperacion, estado);

ALTER TABLE operacionCompensatoria
  ADD INDEX idx_operacionCompensatoria_tienda_fecha
    (idTienda, fechaSolicitud, idOperacionCompensatoria);

ALTER TABLE operacionCompensatoria
  ADD INDEX idx_operacionCompensatoria_tienda_solicitante
    (idTienda, idAdministradorSolicitante, fechaSolicitud);

ALTER TABLE operacionCompensatoria
  ADD INDEX idx_operacionCompensatoria_tienda_aprobador
    (idTienda, idAdministradorAprobador, fechaAprobacion);

ALTER TABLE operacionCompensatoria
  ADD CONSTRAINT chk_operacionCompensatoria_aprobacion
    CHECK (requiereAprobacion IN (0,1));

ALTER TABLE operacionCompensatoria
  ADD CONSTRAINT chk_operacionCompensatoria_clave
    CHECK (
      CHAR_LENGTH(claveOperacion) BETWEEN 1 AND 160
      AND CONVERT(claveOperacion USING utf8mb4)
        REGEXP '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
    );

ALTER TABLE operacionCompensatoria
  ADD CONSTRAINT chk_operacionCompensatoria_huella
    CHECK (
      CONVERT(huellaSolicitud USING utf8mb4) REGEXP '^[0-9A-Fa-f]{64}$'
      AND huellaSolicitud=LOWER(huellaSolicitud)
    );

ALTER TABLE operacionCompensatoria
  ADD CONSTRAINT chk_operacionCompensatoria_motivo
    CHECK (
      motivoCodigo<>'otro_controlado'
      OR (observacion IS NOT NULL AND CHAR_LENGTH(TRIM(observacion))>=8)
    );

ALTER TABLE operacionCompensatoria
  ADD CONSTRAINT chk_operacionCompensatoria_fechas
    CHECK (
      fechaSolicitud=creadoEn
      AND actualizadoEn>=creadoEn
      AND (
        (idAdministradorAprobador IS NULL AND fechaAprobacion IS NULL)
        OR (
          idAdministradorAprobador IS NOT NULL
          AND fechaAprobacion IS NOT NULL
          AND fechaAprobacion>=fechaSolicitud
        )
      )
      AND (
        (estado='aplicada' AND fechaAplicacion IS NOT NULL AND fechaAplicacion>=fechaSolicitud)
        OR (estado<>'aplicada' AND fechaAplicacion IS NULL)
      )
      AND (
        estado<>'aprobada'
        OR (idAdministradorAprobador IS NOT NULL AND fechaAprobacion IS NOT NULL)
      )
      AND (
        requiereAprobacion=0
        OR estado NOT IN ('aprobada','aplicada')
        OR (idAdministradorAprobador IS NOT NULL AND fechaAprobacion IS NOT NULL)
      )
    );

ALTER TABLE operacionCompensatoria
  ADD CONSTRAINT fk_operacionCompensatoria_tienda
    FOREIGN KEY (idTienda)
    REFERENCES tienda(idTienda) ON UPDATE RESTRICT ON DELETE RESTRICT;

ALTER TABLE operacionCompensatoria
  ADD CONSTRAINT fk_operacionCompensatoria_solicitante
    FOREIGN KEY (idTienda, idAdministradorSolicitante)
    REFERENCES administrador(idTienda, idAdministrador)
    ON UPDATE RESTRICT ON DELETE RESTRICT;

ALTER TABLE operacionCompensatoria
  ADD CONSTRAINT fk_operacionCompensatoria_aprobador
    FOREIGN KEY (idTienda, idAdministradorAprobador)
    REFERENCES administrador(idTienda, idAdministrador)
    ON UPDATE RESTRICT ON DELETE RESTRICT;

INSERT INTO funcionalidad
  (codigo, nombre, descripcion, activo, creadoEn, actualizadoEn)
VALUES (
  'anulaciones_operativas',
  'Anulaciones operativas',
  'Base protegida para operaciones compensatorias con trazabilidad.',
  1,
  @fecha_local_014,
  @fecha_local_014
)
ON DUPLICATE KEY UPDATE
  nombre=VALUES(nombre),
  descripcion=VALUES(descripcion),
  activo=1,
  actualizadoEn=@fecha_local_014;

INSERT INTO planFuncionalidad
  (idPlan, idFuncionalidad, habilitada, creadoEn)
SELECT p.idPlan, f.idFuncionalidad, 1, @fecha_local_014
FROM plan p
JOIN funcionalidad f ON f.codigo='anulaciones_operativas'
WHERE p.codigo IN ('basico','avanzado')
ON DUPLICATE KEY UPDATE habilitada=1;
