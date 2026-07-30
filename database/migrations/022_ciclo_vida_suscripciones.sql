-- Contrato estructural del ciclo de vida. El motor de transiciones se implementa en SAAS-B2.

ALTER TABLE suscripcionTienda
  MODIFY COLUMN estado
    ENUM('pendiente','activa','gracia','vencida','suspendida','cancelada')
    NOT NULL DEFAULT 'pendiente';

ALTER TABLE suscripcionTienda
  ADD COLUMN fechaFinGracia DATETIME NULL AFTER fechaFin;

ALTER TABLE suscripcionTienda
  ADD COLUMN suspendidaEn DATETIME NULL AFTER fechaFinGracia;

ALTER TABLE suscripcionTienda
  ADD COLUMN reactivadaEn DATETIME NULL AFTER suspendidaEn;

ALTER TABLE suscripcionTienda
  ADD COLUMN canceladaEn DATETIME NULL AFTER reactivadaEn;

ALTER TABLE suscripcionTienda
  ADD COLUMN motivoTransicion
    ENUM(
      'inicio_prueba','asignacion_administrativa','fin_vigencia','fin_gracia',
      'renovacion','cambio_plan','reemplazo_periodo',
      'suspension_administrativa','cancelacion_administrativa',
      'reactivacion_administrativa','migracion_inicial','otro_controlado'
    ) NULL AFTER canceladaEn;

ALTER TABLE suscripcionTienda
  ADD COLUMN idPlanSiguiente INT NULL AFTER motivoTransicion;

ALTER TABLE suscripcionTienda
  ADD COLUMN fechaAplicacionPlanSiguiente DATETIME NULL AFTER idPlanSiguiente;

ALTER TABLE suscripcionTienda
  ADD COLUMN planCodigoSnapshot VARCHAR(50)
    CHARACTER SET ascii COLLATE ascii_bin NULL AFTER fechaAplicacionPlanSiguiente;

ALTER TABLE suscripcionTienda
  ADD COLUMN planNombreSnapshot VARCHAR(100) NULL AFTER planCodigoSnapshot;

ALTER TABLE suscripcionTienda
  ADD COLUMN tipoPeriodoSnapshot
    ENUM('mensual','anual','personalizada') NULL AFTER planNombreSnapshot;

ALTER TABLE suscripcionTienda
  ADD COLUMN duracionDiasSnapshot INT UNSIGNED NULL AFTER tipoPeriodoSnapshot;

ALTER TABLE suscripcionTienda
  ADD COLUMN precioReferenciaSnapshot DECIMAL(10,2) NULL AFTER duracionDiasSnapshot;

ALTER TABLE suscripcionTienda
  ADD COLUMN limitePropietariosSnapshot INT NULL AFTER precioReferenciaSnapshot;

ALTER TABLE suscripcionTienda
  ADD COLUMN limiteProductosSnapshot INT NULL AFTER limitePropietariosSnapshot;

ALTER TABLE suscripcionTienda
  ADD COLUMN limiteClientesSnapshot INT NULL AFTER limiteProductosSnapshot;

ALTER TABLE suscripcionTienda
  ADD COLUMN limiteProveedoresSnapshot INT NULL AFTER limiteClientesSnapshot;

UPDATE suscripcionTienda s
JOIN plan p ON p.idPlan=s.idPlan
SET s.planCodigoSnapshot=p.codigo,
    s.planNombreSnapshot=p.nombre,
    s.tipoPeriodoSnapshot=CASE
      WHEN TIMESTAMPDIFF(DAY,s.fechaInicio,s.fechaFin)=30 THEN 'mensual'
      WHEN TIMESTAMPDIFF(DAY,s.fechaInicio,s.fechaFin)=365 THEN 'anual'
      ELSE 'personalizada'
    END,
    s.duracionDiasSnapshot=GREATEST(1,TIMESTAMPDIFF(DAY,s.fechaInicio,s.fechaFin)),
    s.precioReferenciaSnapshot=p.precioMensual,
    s.limitePropietariosSnapshot=p.limitePropietarios,
    s.limiteProductosSnapshot=p.limiteProductos,
    s.limiteClientesSnapshot=p.limiteClientes,
    s.limiteProveedoresSnapshot=p.limiteProveedores;

ALTER TABLE suscripcionTienda
  MODIFY COLUMN planCodigoSnapshot VARCHAR(50)
    CHARACTER SET ascii COLLATE ascii_bin NOT NULL;

ALTER TABLE suscripcionTienda
  MODIFY COLUMN planNombreSnapshot VARCHAR(100) NOT NULL;

ALTER TABLE suscripcionTienda
  MODIFY COLUMN tipoPeriodoSnapshot
    ENUM('mensual','anual','personalizada') NOT NULL;

ALTER TABLE suscripcionTienda
  MODIFY COLUMN duracionDiasSnapshot INT UNSIGNED NOT NULL;

ALTER TABLE suscripcionTienda
  MODIFY COLUMN precioReferenciaSnapshot DECIMAL(10,2) NOT NULL;

ALTER TABLE suscripcionTienda
  ADD UNIQUE INDEX uq_suscripcion_tienda_id (idTienda,idSuscripcion);

ALTER TABLE suscripcionTienda
  ADD INDEX idx_suscripcion_tienda_gracia
    (idTienda,estado,fechaFin,fechaFinGracia);

ALTER TABLE suscripcionTienda
  ADD INDEX idx_suscripcion_plan_siguiente
    (idPlanSiguiente,fechaAplicacionPlanSiguiente);

ALTER TABLE suscripcionTienda
  ADD CONSTRAINT chk_suscripcion_fechas_ciclo
    CHECK (
      fechaFin>fechaInicio
      AND (fechaFinGracia IS NULL OR fechaFinGracia>fechaFin)
      AND (suspendidaEn IS NULL OR suspendidaEn>=fechaInicio)
      AND (reactivadaEn IS NULL OR reactivadaEn>=fechaInicio)
      AND (canceladaEn IS NULL OR canceladaEn>=fechaInicio)
      AND (estado<>'gracia' OR fechaFinGracia IS NOT NULL)
    );

ALTER TABLE suscripcionTienda
  ADD CONSTRAINT chk_suscripcion_plan_siguiente
    CHECK (
      (idPlanSiguiente IS NULL AND fechaAplicacionPlanSiguiente IS NULL)
      OR (
        idPlanSiguiente IS NOT NULL
        AND fechaAplicacionPlanSiguiente IS NOT NULL
        AND fechaAplicacionPlanSiguiente>=fechaFin
      )
    );

ALTER TABLE suscripcionTienda
  ADD CONSTRAINT chk_suscripcion_snapshot
    CHECK (
      planCodigoSnapshot REGEXP '^[a-z][a-z0-9_-]{1,49}$'
      AND CHAR_LENGTH(TRIM(planNombreSnapshot)) BETWEEN 1 AND 100
      AND duracionDiasSnapshot>0
      AND precioReferenciaSnapshot>=0
      AND (limitePropietariosSnapshot IS NULL OR limitePropietariosSnapshot>=0)
      AND (limiteProductosSnapshot IS NULL OR limiteProductosSnapshot>=0)
      AND (limiteClientesSnapshot IS NULL OR limiteClientesSnapshot>=0)
      AND (limiteProveedoresSnapshot IS NULL OR limiteProveedoresSnapshot>=0)
    );

ALTER TABLE suscripcionTienda
  ADD CONSTRAINT fk_suscripcion_plan_siguiente
    FOREIGN KEY (idPlanSiguiente) REFERENCES plan(idPlan)
    ON UPDATE RESTRICT ON DELETE RESTRICT;

CREATE TABLE IF NOT EXISTS suscripcionFuncionalidadSnapshot (
  idTienda INT NOT NULL,
  idSuscripcion INT NOT NULL,
  codigoFuncionalidad VARCHAR(80)
    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  nombreFuncionalidad VARCHAR(120) NOT NULL,
  creadoEn DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (idTienda,idSuscripcion,codigoFuncionalidad),
  KEY idx_suscripcionFuncionalidad_codigo (codigoFuncionalidad),
  CONSTRAINT chk_suscripcionFuncionalidad_codigo
    CHECK (codigoFuncionalidad REGEXP '^[a-z][a-z0-9_]{1,79}$'),
  CONSTRAINT fk_suscripcionFuncionalidad_suscripcion
    FOREIGN KEY (idTienda,idSuscripcion)
    REFERENCES suscripcionTienda(idTienda,idSuscripcion)
    ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB;

INSERT INTO suscripcionFuncionalidadSnapshot
  (idTienda,idSuscripcion,codigoFuncionalidad,nombreFuncionalidad,creadoEn)
SELECT s.idTienda,s.idSuscripcion,f.codigo,f.nombre,s.creadoEn
FROM suscripcionTienda s
JOIN planFuncionalidad pf ON pf.idPlan=s.idPlan AND pf.habilitada=1
JOIN funcionalidad f ON f.idFuncionalidad=pf.idFuncionalidad AND f.activo=1
WHERE NOT EXISTS (
  SELECT 1 FROM suscripcionFuncionalidadSnapshot sf
  WHERE sf.idTienda=s.idTienda
    AND sf.idSuscripcion=s.idSuscripcion
    AND sf.codigoFuncionalidad=f.codigo
);

CREATE TABLE IF NOT EXISTS historialSuscripcionTienda (
  idHistorialSuscripcion BIGINT NOT NULL AUTO_INCREMENT,
  idTienda INT NOT NULL,
  idSuscripcion INT NOT NULL,
  estadoAnterior
    ENUM('pendiente','activa','gracia','vencida','suspendida','cancelada') NULL,
  estadoNuevo
    ENUM('pendiente','activa','gracia','vencida','suspendida','cancelada') NOT NULL,
  tipoOperacion
    ENUM(
      'migracion_inicial','inicio_prueba','activacion','entrada_gracia',
      'vencimiento','suspension','reactivacion','renovacion','upgrade',
      'downgrade_programado','downgrade_aplicado','cancelacion'
    ) NOT NULL,
  motivo
    ENUM(
      'inicio_prueba','asignacion_administrativa','fin_vigencia','fin_gracia',
      'renovacion','cambio_plan','reemplazo_periodo',
      'suspension_administrativa','cancelacion_administrativa',
      'reactivacion_administrativa','migracion_inicial','otro_controlado'
    ) NOT NULL,
  actorTipo ENUM('administrador','sistema','anonimo','migracion') NOT NULL,
  idAdministradorActor INT NULL,
  metadatos JSON NULL,
  creadoEn DATETIME NOT NULL,
  PRIMARY KEY (idHistorialSuscripcion),
  KEY idx_historialSuscripcion_tienda_fecha
    (idTienda,creadoEn,idHistorialSuscripcion),
  KEY idx_historialSuscripcion_suscripcion_fecha
    (idTienda,idSuscripcion,creadoEn,idHistorialSuscripcion),
  KEY idx_historialSuscripcion_actor_fecha
    (idAdministradorActor,creadoEn,idHistorialSuscripcion),
  CONSTRAINT chk_historialSuscripcion_actor
    CHECK (
      (actorTipo='administrador' AND idAdministradorActor IS NOT NULL)
      OR (actorTipo IN ('sistema','anonimo','migracion') AND idAdministradorActor IS NULL)
    ),
  CONSTRAINT fk_historialSuscripcion_suscripcion
    FOREIGN KEY (idTienda,idSuscripcion)
    REFERENCES suscripcionTienda(idTienda,idSuscripcion)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_historialSuscripcion_actor
    FOREIGN KEY (idAdministradorActor) REFERENCES administrador(idAdministrador)
    ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS operacionSuscripcionTienda (
  idOperacionSuscripcion BIGINT NOT NULL AUTO_INCREMENT,
  idTienda INT NOT NULL,
  tipoOperacion ENUM('renovar','suspender','reactivar','cancelar','cambiar_plan') NOT NULL,
  claveHash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  huellaSolicitud CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  estado ENUM('en_proceso','completada','fallida') NOT NULL DEFAULT 'en_proceso',
  idSuscripcionResultado INT NULL,
  idHistorialResultado BIGINT NULL,
  codigoResultado VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NULL,
  completadaEn DATETIME NULL,
  fallidaEn DATETIME NULL,
  expiraEn DATETIME NOT NULL,
  creadoEn DATETIME NOT NULL,
  actualizadoEn DATETIME NOT NULL,
  PRIMARY KEY (idOperacionSuscripcion),
  UNIQUE KEY uq_operacionSuscripcion_clave
    (idTienda,tipoOperacion,claveHash),
  KEY idx_operacionSuscripcion_estado_expira
    (estado,expiraEn,idOperacionSuscripcion),
  KEY idx_operacionSuscripcion_resultado
    (idTienda,idSuscripcionResultado),
  CONSTRAINT chk_operacionSuscripcion_hashes
    CHECK (
      claveHash REGEXP '^[0-9a-f]{64}$'
      AND huellaSolicitud REGEXP '^[0-9a-f]{64}$'
    ),
  CONSTRAINT chk_operacionSuscripcion_fechas
    CHECK (
      expiraEn>creadoEn
      AND (
        (estado='en_proceso' AND completadaEn IS NULL AND fallidaEn IS NULL)
        OR (estado='completada' AND completadaEn IS NOT NULL AND fallidaEn IS NULL)
        OR (estado='fallida' AND completadaEn IS NULL AND fallidaEn IS NOT NULL)
      )
    ),
  CONSTRAINT fk_operacionSuscripcion_tienda
    FOREIGN KEY (idTienda) REFERENCES tienda(idTienda)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_operacionSuscripcion_resultado
    FOREIGN KEY (idTienda,idSuscripcionResultado)
    REFERENCES suscripcionTienda(idTienda,idSuscripcion)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_operacionSuscripcion_historial
    FOREIGN KEY (idHistorialResultado)
    REFERENCES historialSuscripcionTienda(idHistorialSuscripcion)
    ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB;
