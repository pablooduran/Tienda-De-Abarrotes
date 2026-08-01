-- SAAS-C1: contrato estructural. No crea rutas, archivos, pagos ni aplicaciones reales.

ALTER TABLE plan
  ADD COLUMN visiblePublicamente TINYINT(1) NOT NULL DEFAULT 1 AFTER activo,
  ADD COLUMN esLegado TINYINT(1) NOT NULL DEFAULT 0 AFTER visiblePublicamente,
  ADD COLUMN ordenComercial SMALLINT UNSIGNED NOT NULL DEFAULT 0 AFTER esLegado,
  ADD INDEX idx_plan_catalogo_publico
    (activo,visiblePublicamente,esLegado,ordenComercial,codigo),
  ADD CONSTRAINT chk_plan_presentacion
    CHECK (
      visiblePublicamente IN (0,1)
      AND esLegado IN (0,1)
      AND NOT (visiblePublicamente=1 AND esLegado=1)
    );

ALTER TABLE suscripcionTienda
  MODIFY COLUMN tipoPeriodoSnapshot
    ENUM('mensual','trimestral','anual','personalizada') NOT NULL;

ALTER TABLE historialSuscripcionTienda
  ADD UNIQUE INDEX uq_historialSuscripcion_tienda_id
    (idTienda,idHistorialSuscripcion);

ALTER TABLE operacionSuscripcionTienda
  ADD UNIQUE INDEX uq_operacionSuscripcion_tienda_id
    (idTienda,idOperacionSuscripcion);

UPDATE plan
SET nombre='Basic',
    descripcion='Nucleo comercial para una tienda familiar.',
    precioMensual=3.00,
    limitePropietarios=1,
    limiteProductos=500,
    limiteClientes=25,
    limiteProveedores=15,
    visiblePublicamente=1,
    esLegado=0,
    ordenComercial=10
WHERE codigo='basico';

UPDATE plan
SET visiblePublicamente=0,
    esLegado=1,
    ordenComercial=90
WHERE codigo='avanzado';

INSERT INTO plan
  (codigo,nombre,descripcion,activo,visiblePublicamente,esLegado,ordenComercial,
   precioMensual,duracionDias,limitePropietarios,limiteProductos,limiteClientes,
   limiteProveedores)
SELECT 'standard','Standard','Mayor capacidad y herramientas operativas reales.',
       1,1,0,20,6.00,30,3,1200,70,50
WHERE NOT EXISTS (SELECT 1 FROM plan WHERE codigo='standard');

INSERT INTO plan
  (codigo,nombre,descripcion,activo,visiblePublicamente,esLegado,ordenComercial,
   precioMensual,duracionDias,limitePropietarios,limiteProductos,limiteClientes,
   limiteProveedores)
SELECT 'pro','Pro','Capacidad ilimitada y todas las funciones operativas disponibles.',
       1,1,0,30,10.00,30,NULL,NULL,NULL,NULL
WHERE NOT EXISTS (SELECT 1 FROM plan WHERE codigo='pro');

INSERT INTO planFuncionalidad (idPlan,idFuncionalidad,habilitada)
SELECT p.idPlan,f.idFuncionalidad,
       CASE WHEN f.codigo IN (
         'ajuste_stock','alertas_stock','anulaciones_operativas','catalogo_maestro',
         'clientes_basico','dashboard_financiero','estado_cuenta_basico',
         'fiados_basico','gastos','historial_stock','inventario_resumen',
         'pagos_fiado','pagos_multiples','punto_venta','ranking_productos',
         'recibos_whatsapp','reportes_financieros','valor_inventario_basico'
       ) THEN 1 ELSE 0 END
FROM plan p
JOIN funcionalidad f ON f.activo=1
WHERE p.codigo='basico'
ON DUPLICATE KEY UPDATE habilitada=VALUES(habilitada);

INSERT INTO planFuncionalidad (idPlan,idFuncionalidad,habilitada)
SELECT p.idPlan,f.idFuncionalidad,
       CASE WHEN f.codigo IN (
         'ajuste_stock','alertas_stock','anulaciones_operativas','catalogo_maestro',
         'clientes_basico','dashboard_financiero','estado_cuenta_basico',
         'fiados_basico','gastos','historial_stock','inventario_resumen',
         'pagos_fiado','pagos_multiples','punto_venta','ranking_productos',
         'recibos_whatsapp','reportes_financieros','valor_inventario_basico',
         'cierre_caja','compras_sugeridas','dias_cobertura',
         'exportacion_clientes_fiados','exportacion_inventario',
         'exportacion_reportes','inventario_sin_movimiento','limites_credito',
         'recordatorios_fiado','rentabilidad_producto','rotacion_inventario',
         'segmentacion_clientes','seguimiento_cobranza'
       ) THEN 1 ELSE 0 END
FROM plan p
JOIN funcionalidad f ON f.activo=1
WHERE p.codigo='standard'
ON DUPLICATE KEY UPDATE habilitada=VALUES(habilitada);

INSERT INTO planFuncionalidad (idPlan,idFuncionalidad,habilitada)
SELECT p.idPlan,f.idFuncionalidad,
       CASE WHEN f.codigo NOT IN ('portal_clientes','reportes_avanzados')
         THEN 1 ELSE 0 END
FROM plan p
JOIN funcionalidad f ON f.activo=1
WHERE p.codigo='pro'
ON DUPLICATE KEY UPDATE habilitada=VALUES(habilitada);

CREATE TABLE IF NOT EXISTS precioPlanPeriodo (
  idPrecioPlanPeriodo BIGINT NOT NULL AUTO_INCREMENT,
  idPlan INT NOT NULL,
  periodo ENUM('mensual','trimestral','anual') NOT NULL,
  monedaBase CHAR(3) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  monto DECIMAL(12,2) NOT NULL,
  cantidadMeses TINYINT UNSIGNED NOT NULL,
  versionPrecio INT UNSIGNED NOT NULL,
  vigenteDesde DATETIME NOT NULL,
  vigenteHasta DATETIME NULL,
  activo TINYINT(1) NOT NULL DEFAULT 1,
  actorTipo ENUM('migracion','superadmin') NOT NULL,
  creadoPor INT NULL,
  creadoEn DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizadoEn DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  vigenciaActiva TINYINT GENERATED ALWAYS AS
    (CASE WHEN activo=1 THEN 1 ELSE NULL END) STORED,
  PRIMARY KEY (idPrecioPlanPeriodo),
  UNIQUE KEY uq_precioPlan_version
    (idPlan,periodo,monedaBase,versionPrecio),
  UNIQUE KEY uq_precioPlan_activo
    (idPlan,periodo,monedaBase,vigenciaActiva),
  UNIQUE KEY uq_precioPlan_relacion
    (idPrecioPlanPeriodo,idPlan,periodo),
  KEY idx_precioPlan_vigencia
    (idPlan,periodo,monedaBase,vigenteDesde,vigenteHasta),
  KEY idx_precioPlan_actor (creadoPor,creadoEn),
  CONSTRAINT chk_precioPlan_valores CHECK (
    monedaBase='USD'
    AND monto>0
    AND versionPrecio>0
    AND activo IN (0,1)
    AND ((periodo='mensual' AND cantidadMeses=1)
      OR (periodo='trimestral' AND cantidadMeses=3)
      OR (periodo='anual' AND cantidadMeses=12))
    AND (vigenteHasta IS NULL OR vigenteHasta>vigenteDesde)
    AND (activo=0 OR vigenteHasta IS NULL)
  ),
  CONSTRAINT chk_precioPlan_actor CHECK (
    (actorTipo='migracion' AND creadoPor IS NULL)
    OR (actorTipo='superadmin' AND creadoPor IS NOT NULL)
  ),
  CONSTRAINT fk_precioPlan_plan FOREIGN KEY (idPlan)
    REFERENCES plan(idPlan) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_precioPlan_actor FOREIGN KEY (creadoPor)
    REFERENCES administrador(idAdministrador) ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO precioPlanPeriodo
  (idPlan,periodo,monedaBase,monto,cantidadMeses,versionPrecio,
   vigenteDesde,vigenteHasta,activo,actorTipo,creadoPor)
SELECT p.idPlan,v.periodo,'USD',v.monto,v.meses,1,
       '2026-08-01 00:00:00',NULL,1,'migracion',NULL
FROM plan p
JOIN (
  SELECT 'basico' codigo,'mensual' periodo,3.00 monto,1 meses
  UNION ALL SELECT 'basico','trimestral',8.25,3
  UNION ALL SELECT 'basico','anual',30.00,12
  UNION ALL SELECT 'standard','mensual',6.00,1
  UNION ALL SELECT 'standard','trimestral',16.50,3
  UNION ALL SELECT 'standard','anual',60.00,12
  UNION ALL SELECT 'pro','mensual',10.00,1
  UNION ALL SELECT 'pro','trimestral',27.50,3
  UNION ALL SELECT 'pro','anual',100.00,12
) v ON v.codigo=p.codigo
WHERE NOT EXISTS (
  SELECT 1 FROM precioPlanPeriodo pp
  WHERE pp.idPlan=p.idPlan AND pp.periodo=v.periodo
    AND pp.monedaBase='USD' AND pp.versionPrecio=1
);

CREATE TABLE IF NOT EXISTS tipoCambioSuscripcion (
  idTipoCambioSuscripcion BIGINT NOT NULL AUTO_INCREMENT,
  monedaOrigen CHAR(3) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  monedaDestino CHAR(3) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  valor DECIMAL(18,8) NOT NULL,
  direccion ENUM('destino_por_unidad_origen') NOT NULL,
  fuente VARCHAR(120) NOT NULL,
  fechaEfectiva DATETIME NOT NULL,
  vigenteDesde DATETIME NOT NULL,
  vigenteHasta DATETIME NULL,
  versionTipoCambio INT UNSIGNED NOT NULL,
  activo TINYINT(1) NOT NULL DEFAULT 1,
  registradoPor INT NOT NULL,
  creadoEn DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizadoEn DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  vigenciaActiva TINYINT GENERATED ALWAYS AS
    (CASE WHEN activo=1 THEN 1 ELSE NULL END) STORED,
  PRIMARY KEY (idTipoCambioSuscripcion),
  UNIQUE KEY uq_tipoCambio_version
    (monedaOrigen,monedaDestino,versionTipoCambio),
  UNIQUE KEY uq_tipoCambio_activo
    (monedaOrigen,monedaDestino,vigenciaActiva),
  KEY idx_tipoCambio_vigencia
    (monedaOrigen,monedaDestino,vigenteDesde,vigenteHasta),
  KEY idx_tipoCambio_actor (registradoPor,creadoEn),
  CONSTRAINT chk_tipoCambio_valores CHECK (
    monedaOrigen='USD'
    AND monedaDestino='BOB'
    AND valor>0
    AND versionTipoCambio>0
    AND activo IN (0,1)
    AND CHAR_LENGTH(TRIM(fuente)) BETWEEN 2 AND 120
    AND vigenteDesde>=fechaEfectiva
    AND (vigenteHasta IS NULL OR vigenteHasta>vigenteDesde)
    AND (activo=0 OR vigenteHasta IS NULL)
  ),
  CONSTRAINT fk_tipoCambio_actor FOREIGN KEY (registradoPor)
    REFERENCES administrador(idAdministrador) ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS metodoPagoSuscripcion (
  idMetodoPagoSuscripcion INT NOT NULL AUTO_INCREMENT,
  codigo VARCHAR(50) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  tipo ENUM('qr_manual','transferencia_deposito','efectivo_administrativo') NOT NULL,
  nombre VARCHAR(100) NOT NULL,
  instrucciones VARCHAR(500) NULL,
  configurado TINYINT(1) NOT NULL DEFAULT 0,
  visiblePropietario TINYINT(1) NOT NULL DEFAULT 0,
  activo TINYINT(1) NOT NULL DEFAULT 0,
  requiereComprobante TINYINT(1) NOT NULL,
  soloAdministracion TINYINT(1) NOT NULL,
  orden SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  configuradoPor INT NULL,
  creadoEn DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizadoEn DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (idMetodoPagoSuscripcion),
  UNIQUE KEY uq_metodoPago_codigo (codigo),
  KEY idx_metodoPago_publico
    (activo,visiblePropietario,soloAdministracion,orden),
  CONSTRAINT chk_metodoPago_flags CHECK (
    configurado IN (0,1)
    AND visiblePropietario IN (0,1)
    AND activo IN (0,1)
    AND requiereComprobante IN (0,1)
    AND soloAdministracion IN (0,1)
    AND (visiblePropietario=0 OR (activo=1 AND configurado=1 AND soloAdministracion=0))
    AND (configurado=1 OR instrucciones IS NULL)
    AND NOT (tipo='efectivo_administrativo' AND soloAdministracion=0)
  ),
  CONSTRAINT chk_metodoPago_codigo CHECK (
    codigo REGEXP '^[a-z][a-z0-9_]{2,49}$'
  ),
  CONSTRAINT fk_metodoPago_actor FOREIGN KEY (configuradoPor)
    REFERENCES administrador(idAdministrador) ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO metodoPagoSuscripcion
  (codigo,tipo,nombre,instrucciones,configurado,visiblePropietario,activo,
   requiereComprobante,soloAdministracion,orden,configuradoPor)
SELECT 'qr_manual','qr_manual','QR manual',NULL,0,0,0,1,0,10,NULL
WHERE NOT EXISTS (SELECT 1 FROM metodoPagoSuscripcion WHERE codigo='qr_manual');

INSERT INTO metodoPagoSuscripcion
  (codigo,tipo,nombre,instrucciones,configurado,visiblePropietario,activo,
   requiereComprobante,soloAdministracion,orden,configuradoPor)
SELECT 'transferencia_deposito','transferencia_deposito',
       'Transferencia o deposito bancario',NULL,0,0,0,1,0,20,NULL
WHERE NOT EXISTS (
  SELECT 1 FROM metodoPagoSuscripcion WHERE codigo='transferencia_deposito'
);

INSERT INTO metodoPagoSuscripcion
  (codigo,tipo,nombre,instrucciones,configurado,visiblePropietario,activo,
   requiereComprobante,soloAdministracion,orden,configuradoPor)
SELECT 'efectivo_administrativo','efectivo_administrativo',
       'Efectivo administrativo',NULL,1,0,1,0,1,30,NULL
WHERE NOT EXISTS (
  SELECT 1 FROM metodoPagoSuscripcion WHERE codigo='efectivo_administrativo'
);

CREATE TABLE IF NOT EXISTS solicitudPagoSuscripcion (
  idSolicitudPago BIGINT NOT NULL AUTO_INCREMENT,
  referenciaPublica VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  idTienda INT NOT NULL,
  idSuscripcion INT NOT NULL,
  idPlanActual INT NULL,
  idPlanObjetivo INT NOT NULL,
  idPrecioPlanPeriodo BIGINT NOT NULL,
  idTipoCambioSuscripcion BIGINT NOT NULL,
  idMetodoPagoSuscripcion INT NOT NULL,
  operacion ENUM('renovacion','reactivacion','nueva_activacion','upgrade') NOT NULL,
  periodo ENUM('mensual','trimestral','anual') NOT NULL,
  cantidadMeses TINYINT UNSIGNED NOT NULL,
  planCodigoSnapshot VARCHAR(50) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  planNombreSnapshot VARCHAR(100) NOT NULL,
  versionPrecioSnapshot INT UNSIGNED NOT NULL,
  precioBaseUSD DECIMAL(12,2) NOT NULL,
  tipoCambioUsdBob DECIMAL(18,8) NOT NULL,
  fuenteTipoCambioSnapshot VARCHAR(120) NOT NULL,
  fechaEfectivaTipoCambioSnapshot DATETIME NOT NULL,
  montoCalculadoBOB DECIMAL(14,2) NOT NULL,
  montoFinalBOB DECIMAL(14,2) NOT NULL,
  monedaBase CHAR(3) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  monedaCobro CHAR(3) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  limitePropietariosSnapshot INT NULL,
  limiteProductosSnapshot INT NULL,
  limiteClientesSnapshot INT NULL,
  limiteProveedoresSnapshot INT NULL,
  metodoCodigoSnapshot VARCHAR(50) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  metodoNombreSnapshot VARCHAR(100) NOT NULL,
  instruccionesMetodoSnapshot VARCHAR(500) NULL,
  estado ENUM(
    'pendiente_comprobante','pendiente_revision','observada','rechazada',
    'aplicada','cancelada','vencida'
  ) NOT NULL,
  creadaPor INT NOT NULL,
  creadaEn DATETIME NOT NULL,
  venceEn DATETIME NOT NULL,
  enviadaEn DATETIME NULL,
  aplicadaEn DATETIME NULL,
  canceladaEn DATETIME NULL,
  ultimaTransicionEn DATETIME NOT NULL,
  actualizadoEn DATETIME NOT NULL,
  idTiendaAbierta INT GENERATED ALWAYS AS (
    CASE WHEN estado IN ('pendiente_comprobante','pendiente_revision','observada')
      THEN idTienda ELSE NULL END
  ) STORED,
  PRIMARY KEY (idSolicitudPago),
  UNIQUE KEY uq_solicitudPago_referencia (referenciaPublica),
  UNIQUE KEY uq_solicitudPago_tienda_id (idTienda,idSolicitudPago),
  UNIQUE KEY uq_solicitudPago_abierta (idTiendaAbierta),
  KEY idx_solicitudPago_tienda_estado
    (idTienda,estado,creadaEn,idSolicitudPago),
  KEY idx_solicitudPago_cola
    (estado,ultimaTransicionEn,idSolicitudPago),
  KEY idx_solicitudPago_vencimiento (estado,venceEn,idSolicitudPago),
  KEY idx_solicitudPago_suscripcion (idTienda,idSuscripcion,creadaEn),
  KEY idx_solicitudPago_plan_objetivo (idPlanObjetivo,periodo),
  CONSTRAINT chk_solicitudPago_referencia CHECK (
    referenciaPublica REGEXP '^[A-Za-z0-9_-]{32,64}$'
  ),
  CONSTRAINT chk_solicitudPago_importes CHECK (
    monedaBase='USD'
    AND monedaCobro='BOB'
    AND precioBaseUSD>0
    AND tipoCambioUsdBob>0
    AND montoCalculadoBOB>0
    AND montoFinalBOB>0
    AND versionPrecioSnapshot>0
    AND ((periodo='mensual' AND cantidadMeses=1)
      OR (periodo='trimestral' AND cantidadMeses=3)
      OR (periodo='anual' AND cantidadMeses=12))
  ),
  CONSTRAINT chk_solicitudPago_snapshot CHECK (
    planCodigoSnapshot REGEXP '^[a-z][a-z0-9_-]{1,49}$'
    AND CHAR_LENGTH(TRIM(planNombreSnapshot)) BETWEEN 1 AND 100
    AND CHAR_LENGTH(TRIM(fuenteTipoCambioSnapshot)) BETWEEN 2 AND 120
    AND metodoCodigoSnapshot REGEXP '^[a-z][a-z0-9_]{2,49}$'
    AND CHAR_LENGTH(TRIM(metodoNombreSnapshot)) BETWEEN 1 AND 100
    AND (limitePropietariosSnapshot IS NULL OR limitePropietariosSnapshot>=0)
    AND (limiteProductosSnapshot IS NULL OR limiteProductosSnapshot>=0)
    AND (limiteClientesSnapshot IS NULL OR limiteClientesSnapshot>=0)
    AND (limiteProveedoresSnapshot IS NULL OR limiteProveedoresSnapshot>=0)
  ),
  CONSTRAINT chk_solicitudPago_fechas CHECK (
    venceEn>creadaEn
    AND ultimaTransicionEn>=creadaEn
    AND actualizadoEn>=creadaEn
    AND (enviadaEn IS NULL OR enviadaEn>=creadaEn)
    AND (aplicadaEn IS NULL OR aplicadaEn>=creadaEn)
    AND (canceladaEn IS NULL OR canceladaEn>=creadaEn)
    AND (estado='aplicada')=(aplicadaEn IS NOT NULL)
    AND (estado='cancelada')=(canceladaEn IS NOT NULL)
  ),
  CONSTRAINT fk_solicitudPago_suscripcion FOREIGN KEY (idTienda,idSuscripcion)
    REFERENCES suscripcionTienda(idTienda,idSuscripcion)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_solicitudPago_plan_actual FOREIGN KEY (idPlanActual)
    REFERENCES plan(idPlan) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_solicitudPago_precio
    FOREIGN KEY (idPrecioPlanPeriodo,idPlanObjetivo,periodo)
    REFERENCES precioPlanPeriodo(idPrecioPlanPeriodo,idPlan,periodo)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_solicitudPago_tipoCambio FOREIGN KEY (idTipoCambioSuscripcion)
    REFERENCES tipoCambioSuscripcion(idTipoCambioSuscripcion)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_solicitudPago_metodo FOREIGN KEY (idMetodoPagoSuscripcion)
    REFERENCES metodoPagoSuscripcion(idMetodoPagoSuscripcion)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_solicitudPago_actor FOREIGN KEY (creadaPor)
    REFERENCES administrador(idAdministrador) ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS solicitudPagoFuncionalidadSnapshot (
  idTienda INT NOT NULL,
  idSolicitudPago BIGINT NOT NULL,
  codigoFuncionalidad VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  nombreFuncionalidad VARCHAR(120) NOT NULL,
  creadoEn DATETIME NOT NULL,
  PRIMARY KEY (idTienda,idSolicitudPago,codigoFuncionalidad),
  KEY idx_solicitudPagoFuncion_codigo (codigoFuncionalidad),
  CONSTRAINT chk_solicitudPagoFuncion_codigo CHECK (
    codigoFuncionalidad REGEXP '^[a-z][a-z0-9_]{1,79}$'
  ),
  CONSTRAINT fk_solicitudPagoFuncion_solicitud
    FOREIGN KEY (idTienda,idSolicitudPago)
    REFERENCES solicitudPagoSuscripcion(idTienda,idSolicitudPago)
    ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS comprobantePagoSuscripcion (
  idComprobantePago BIGINT NOT NULL AUTO_INCREMENT,
  referenciaPublica VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  idTienda INT NOT NULL,
  idSolicitudPago BIGINT NOT NULL,
  versionComprobante INT UNSIGNED NOT NULL,
  estado ENUM('cargado','reemplazado','invalido','aceptado') NOT NULL,
  nombreGenerado VARCHAR(160) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  nombreOriginalSanitizado VARCHAR(180) NOT NULL,
  extensionDetectada ENUM('pdf','jpg','jpeg','png') NOT NULL,
  mimeDetectado ENUM('application/pdf','image/jpeg','image/png') NOT NULL,
  tamanoBytes INT UNSIGNED NOT NULL,
  hashSha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  claveAlmacenamiento VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  cargadoPor INT NOT NULL,
  cargadoEn DATETIME NOT NULL,
  reemplazadoEn DATETIME NULL,
  creadoEn DATETIME NOT NULL,
  actualizadoEn DATETIME NOT NULL,
  idSolicitudActiva BIGINT GENERATED ALWAYS AS (
    CASE WHEN estado IN ('cargado','aceptado') THEN idSolicitudPago ELSE NULL END
  ) STORED,
  PRIMARY KEY (idComprobantePago),
  UNIQUE KEY uq_comprobantePago_referencia (referenciaPublica),
  UNIQUE KEY uq_comprobantePago_version
    (idTienda,idSolicitudPago,versionComprobante),
  UNIQUE KEY uq_comprobantePago_tienda_id
    (idTienda,idSolicitudPago,idComprobantePago),
  UNIQUE KEY uq_comprobantePago_activo (idSolicitudActiva),
  KEY idx_comprobantePago_hash (idTienda,hashSha256),
  KEY idx_comprobantePago_solicitud_estado
    (idTienda,idSolicitudPago,estado,versionComprobante),
  CONSTRAINT chk_comprobantePago_referencia CHECK (
    referenciaPublica REGEXP '^[A-Za-z0-9_-]{32,64}$'
  ),
  CONSTRAINT chk_comprobantePago_archivo CHECK (
    versionComprobante>0
    AND tamanoBytes BETWEEN 1 AND 5242880
    AND hashSha256 REGEXP '^[0-9a-f]{64}$'
    AND nombreGenerado REGEXP '^[A-Za-z0-9._-]{16,160}$'
    AND claveAlmacenamiento REGEXP '^[A-Za-z0-9/_-]{16,255}$'
    AND ((extensionDetectada='pdf' AND mimeDetectado='application/pdf')
      OR (extensionDetectada IN ('jpg','jpeg') AND mimeDetectado='image/jpeg')
      OR (extensionDetectada='png' AND mimeDetectado='image/png'))
  ),
  CONSTRAINT chk_comprobantePago_fechas CHECK (
    creadoEn=cargadoEn
    AND actualizadoEn>=creadoEn
    AND ((estado='reemplazado' AND reemplazadoEn IS NOT NULL)
      OR (estado<>'reemplazado' AND reemplazadoEn IS NULL))
  ),
  CONSTRAINT fk_comprobantePago_solicitud
    FOREIGN KEY (idTienda,idSolicitudPago)
    REFERENCES solicitudPagoSuscripcion(idTienda,idSolicitudPago)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_comprobantePago_actor FOREIGN KEY (cargadoPor)
    REFERENCES administrador(idAdministrador) ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS revisionPagoSuscripcion (
  idRevisionPago BIGINT NOT NULL AUTO_INCREMENT,
  idTienda INT NOT NULL,
  idSolicitudPago BIGINT NOT NULL,
  idComprobantePago BIGINT NULL,
  decision ENUM('observar','rechazar','aplicar','cancelar_administrativamente') NOT NULL,
  estadoAnterior ENUM(
    'pendiente_comprobante','pendiente_revision','observada','rechazada',
    'aplicada','cancelada','vencida'
  ) NOT NULL,
  estadoNuevo ENUM(
    'pendiente_comprobante','pendiente_revision','observada','rechazada',
    'aplicada','cancelada','vencida'
  ) NOT NULL,
  motivo ENUM(
    'comprobante_ilegible','datos_incompletos','monto_incorrecto',
    'metodo_no_valido','aprobacion_manual','cancelacion_administrativa',
    'otro_controlado'
  ) NOT NULL,
  observacion VARCHAR(500) NULL,
  revisadoPor INT NOT NULL,
  metadatos JSON NULL,
  creadoEn DATETIME NOT NULL,
  PRIMARY KEY (idRevisionPago),
  KEY idx_revisionPago_solicitud
    (idTienda,idSolicitudPago,creadoEn,idRevisionPago),
  KEY idx_revisionPago_actor (revisadoPor,creadoEn,idRevisionPago),
  CONSTRAINT chk_revisionPago_transicion CHECK (estadoAnterior<>estadoNuevo),
  CONSTRAINT fk_revisionPago_solicitud
    FOREIGN KEY (idTienda,idSolicitudPago)
    REFERENCES solicitudPagoSuscripcion(idTienda,idSolicitudPago)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_revisionPago_comprobante
    FOREIGN KEY (idTienda,idSolicitudPago,idComprobantePago)
    REFERENCES comprobantePagoSuscripcion(idTienda,idSolicitudPago,idComprobantePago)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_revisionPago_actor FOREIGN KEY (revisadoPor)
    REFERENCES administrador(idAdministrador) ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS historialSolicitudPagoSuscripcion (
  idHistorialSolicitudPago BIGINT NOT NULL AUTO_INCREMENT,
  idTienda INT NOT NULL,
  idSolicitudPago BIGINT NOT NULL,
  evento ENUM(
    'creada','comprobante_cargado','comprobante_reemplazado','enviada_revision',
    'observada','corregida','rechazada','aplicada','cancelada','vencida'
  ) NOT NULL,
  estadoAnterior ENUM(
    'pendiente_comprobante','pendiente_revision','observada','rechazada',
    'aplicada','cancelada','vencida'
  ) NULL,
  estadoNuevo ENUM(
    'pendiente_comprobante','pendiente_revision','observada','rechazada',
    'aplicada','cancelada','vencida'
  ) NOT NULL,
  actorTipo ENUM('propietario','superadmin','sistema') NOT NULL,
  idAdministradorActor INT NULL,
  metadatos JSON NULL,
  creadoEn DATETIME NOT NULL,
  PRIMARY KEY (idHistorialSolicitudPago),
  KEY idx_historialSolicitudPago_solicitud
    (idTienda,idSolicitudPago,creadoEn,idHistorialSolicitudPago),
  KEY idx_historialSolicitudPago_actor
    (idAdministradorActor,creadoEn,idHistorialSolicitudPago),
  CONSTRAINT chk_historialSolicitudPago_actor CHECK (
    (actorTipo IN ('propietario','superadmin') AND idAdministradorActor IS NOT NULL)
    OR (actorTipo='sistema' AND idAdministradorActor IS NULL)
  ),
  CONSTRAINT fk_historialSolicitudPago_solicitud
    FOREIGN KEY (idTienda,idSolicitudPago)
    REFERENCES solicitudPagoSuscripcion(idTienda,idSolicitudPago)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_historialSolicitudPago_actor FOREIGN KEY (idAdministradorActor)
    REFERENCES administrador(idAdministrador) ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS aplicacionPagoSuscripcion (
  idAplicacionPago BIGINT NOT NULL AUTO_INCREMENT,
  idTienda INT NOT NULL,
  idSolicitudPago BIGINT NOT NULL,
  idSuscripcion INT NOT NULL,
  operacionAplicada ENUM('renovar','reactivar','cambiar_plan','nueva_activacion') NOT NULL,
  idOperacionSuscripcion BIGINT NULL,
  idHistorialSuscripcion BIGINT NULL,
  idPlanAnterior INT NULL,
  idPlanNuevo INT NOT NULL,
  periodo ENUM('mensual','trimestral','anual') NOT NULL,
  fechaInicio DATETIME NOT NULL,
  fechaFin DATETIME NOT NULL,
  codigoResultado VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  aplicadaPor INT NOT NULL,
  aplicadaEn DATETIME NOT NULL,
  creadoEn DATETIME NOT NULL,
  PRIMARY KEY (idAplicacionPago),
  UNIQUE KEY uq_aplicacionPago_solicitud (idTienda,idSolicitudPago),
  KEY idx_aplicacionPago_suscripcion
    (idTienda,idSuscripcion,aplicadaEn,idAplicacionPago),
  KEY idx_aplicacionPago_operacion (idTienda,idOperacionSuscripcion),
  KEY idx_aplicacionPago_historial (idTienda,idHistorialSuscripcion),
  CONSTRAINT chk_aplicacionPago_resultado CHECK (
    fechaFin>fechaInicio
    AND creadoEn=aplicadaEn
    AND codigoResultado REGEXP '^[A-Z][A-Z0-9_]{1,79}$'
  ),
  CONSTRAINT fk_aplicacionPago_solicitud
    FOREIGN KEY (idTienda,idSolicitudPago)
    REFERENCES solicitudPagoSuscripcion(idTienda,idSolicitudPago)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_aplicacionPago_suscripcion
    FOREIGN KEY (idTienda,idSuscripcion)
    REFERENCES suscripcionTienda(idTienda,idSuscripcion)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_aplicacionPago_operacion
    FOREIGN KEY (idTienda,idOperacionSuscripcion)
    REFERENCES operacionSuscripcionTienda(idTienda,idOperacionSuscripcion)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_aplicacionPago_historial
    FOREIGN KEY (idTienda,idHistorialSuscripcion)
    REFERENCES historialSuscripcionTienda(idTienda,idHistorialSuscripcion)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_aplicacionPago_plan_anterior FOREIGN KEY (idPlanAnterior)
    REFERENCES plan(idPlan) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_aplicacionPago_plan_nuevo FOREIGN KEY (idPlanNuevo)
    REFERENCES plan(idPlan) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_aplicacionPago_actor FOREIGN KEY (aplicadaPor)
    REFERENCES administrador(idAdministrador) ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS operacionPagoSuscripcion (
  idOperacionPago BIGINT NOT NULL AUTO_INCREMENT,
  idTienda INT NOT NULL,
  idSolicitudPago BIGINT NULL,
  actorTipo ENUM('propietario','superadmin','sistema') NOT NULL,
  idAdministradorActor INT NULL,
  alcance ENUM(
    'crear_solicitud','cargar_comprobante','enviar_revision',
    'revisar','aplicar','cancelar'
  ) NOT NULL,
  claveHash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  huellaPayload CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  estado ENUM('en_proceso','completada','fallida') NOT NULL,
  resultadoReferencia VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  codigoResultado VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NULL,
  creadaEn DATETIME NOT NULL,
  completadaEn DATETIME NULL,
  fallidaEn DATETIME NULL,
  expiraEn DATETIME NOT NULL,
  actualizadaEn DATETIME NOT NULL,
  idActorClave INT GENERATED ALWAYS AS
    (COALESCE(idAdministradorActor,0)) STORED,
  PRIMARY KEY (idOperacionPago),
  UNIQUE KEY uq_operacionPago_clave
    (idTienda,actorTipo,idActorClave,alcance,claveHash),
  KEY idx_operacionPago_solicitud
    (idTienda,idSolicitudPago,creadaEn,idOperacionPago),
  KEY idx_operacionPago_estado_expira
    (estado,expiraEn,idOperacionPago),
  CONSTRAINT chk_operacionPago_hashes CHECK (
    claveHash REGEXP '^[0-9a-f]{64}$'
    AND huellaPayload REGEXP '^[0-9a-f]{64}$'
  ),
  CONSTRAINT chk_operacionPago_actor CHECK (
    (actorTipo IN ('propietario','superadmin') AND idAdministradorActor IS NOT NULL)
    OR (actorTipo='sistema' AND idAdministradorActor IS NULL)
  ),
  CONSTRAINT chk_operacionPago_fechas CHECK (
    expiraEn>creadaEn
    AND actualizadaEn>=creadaEn
    AND ((estado='en_proceso' AND completadaEn IS NULL AND fallidaEn IS NULL)
      OR (estado='completada' AND completadaEn IS NOT NULL AND fallidaEn IS NULL)
      OR (estado='fallida' AND completadaEn IS NULL AND fallidaEn IS NOT NULL))
    AND (resultadoReferencia IS NULL
      OR resultadoReferencia REGEXP '^[A-Za-z0-9_-]{32,64}$')
    AND (codigoResultado IS NULL
      OR codigoResultado REGEXP '^[A-Z][A-Z0-9_]{1,79}$')
  ),
  CONSTRAINT fk_operacionPago_tienda FOREIGN KEY (idTienda)
    REFERENCES tienda(idTienda) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_operacionPago_solicitud
    FOREIGN KEY (idTienda,idSolicitudPago)
    REFERENCES solicitudPagoSuscripcion(idTienda,idSolicitudPago)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_operacionPago_actor FOREIGN KEY (idAdministradorActor)
    REFERENCES administrador(idAdministrador) ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
