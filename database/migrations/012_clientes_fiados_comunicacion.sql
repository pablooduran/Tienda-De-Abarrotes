-- Fase 10: estructura para clientes, credito y comunicacion.
-- MySQL 8.0.46: migrate-db.js recupera cada elemento de forma individual.

SET @fecha_local_012 = __MIGRATION_LOCAL_DATETIME__;

ALTER TABLE cliente ADD COLUMN direccion VARCHAR(255) NULL AFTER telefono;
ALTER TABLE cliente ADD COLUMN telefonoAlternativo VARCHAR(30) NULL AFTER direccion;
ALTER TABLE cliente ADD COLUMN telefonoNormalizado VARCHAR(30) NULL AFTER telefonoAlternativo;
ALTER TABLE cliente ADD COLUMN documentoIdentidad VARCHAR(50) NULL AFTER telefonoNormalizado;
ALTER TABLE cliente ADD COLUMN documentoNormalizado VARCHAR(50) NULL AFTER documentoIdentidad;
ALTER TABLE cliente ADD COLUMN correo VARCHAR(160) NULL AFTER documentoNormalizado;
ALTER TABLE cliente ADD COLUMN notas VARCHAR(1000) NULL AFTER correo;
ALTER TABLE cliente ADD COLUMN limiteCredito DECIMAL(12,2) NULL AFTER notas;
ALTER TABLE cliente ADD COLUMN permiteFiado TINYINT(1) NOT NULL DEFAULT 1 AFTER limiteCredito;
ALTER TABLE cliente ADD COLUMN diasCreditoDefault INT NULL AFTER permiteFiado;
ALTER TABLE cliente
  ADD COLUMN canalPreferido ENUM('ninguno','whatsapp','telefono','correo','presencial')
  NOT NULL DEFAULT 'ninguno' AFTER diasCreditoDefault;
ALTER TABLE cliente ADD COLUMN aceptaRecordatorios TINYINT(1) NOT NULL DEFAULT 1 AFTER canalPreferido;
ALTER TABLE cliente ADD COLUMN horarioPreferido VARCHAR(120) NULL AFTER aceptaRecordatorios;
ALTER TABLE cliente ADD COLUMN creadoEn DATETIME NULL AFTER eliminadoEn;
ALTER TABLE cliente ADD COLUMN actualizadoEn DATETIME NULL AFTER creadoEn;
ALTER TABLE cliente ADD COLUMN idAdministradorCrea INT NULL AFTER actualizadoEn;
ALTER TABLE cliente ADD COLUMN idAdministradorActualiza INT NULL AFTER idAdministradorCrea;

UPDATE cliente c
LEFT JOIN (
  SELECT idTienda, idCliente, MIN(fecha) AS primeraVenta
  FROM venta
  WHERE idCliente IS NOT NULL
  GROUP BY idTienda, idCliente
) ventas ON ventas.idTienda=c.idTienda AND ventas.idCliente=c.idCliente
LEFT JOIN (
  SELECT f.idTienda, f.idCliente,
         MIN(COALESCE(v.fecha, CAST(CONCAT(f.fechaInicio, ' 00:00:00') AS DATETIME))) AS primerFiado
  FROM fiado f
  LEFT JOIN venta v ON v.idTienda=f.idTienda AND v.idVenta=f.idVenta
  GROUP BY f.idTienda, f.idCliente
) fiados ON fiados.idTienda=c.idTienda AND fiados.idCliente=c.idCliente
LEFT JOIN (
  SELECT f.idTienda, f.idCliente, MIN(pf.fechaPago) AS primerPago
  FROM pagoFiado pf
  JOIN fiado f ON f.idTienda=pf.idTienda AND f.idFiado=pf.idFiado
  GROUP BY f.idTienda, f.idCliente
) pagos ON pagos.idTienda=c.idTienda AND pagos.idCliente=c.idCliente
SET c.creadoEn=COALESCE(c.creadoEn, ventas.primeraVenta, fiados.primerFiado, pagos.primerPago, @fecha_local_012),
    c.actualizadoEn=COALESCE(c.actualizadoEn, ventas.primeraVenta, fiados.primerFiado, pagos.primerPago, @fecha_local_012)
WHERE c.creadoEn IS NULL OR c.actualizadoEn IS NULL;

UPDATE cliente
SET telefonoNormalizado=NULLIF(REGEXP_REPLACE(TRIM(telefono), '[^0-9]', ''), '')
WHERE telefonoNormalizado IS NULL AND telefono IS NOT NULL;

ALTER TABLE cliente MODIFY COLUMN creadoEn DATETIME NOT NULL;
ALTER TABLE cliente MODIFY COLUMN actualizadoEn DATETIME NOT NULL;

ALTER TABLE cliente
  ADD UNIQUE INDEX uq_cliente_tienda_documento_normalizado (idTienda, documentoNormalizado);
ALTER TABLE cliente
  ADD INDEX idx_cliente_tienda_telefono_normalizado (idTienda, telefonoNormalizado);
ALTER TABLE cliente
  ADD INDEX idx_cliente_tienda_permite_fiado_activo (idTienda, permiteFiado, activo);
ALTER TABLE cliente
  ADD INDEX idx_cliente_tienda_admin_crea (idTienda, idAdministradorCrea);
ALTER TABLE cliente
  ADD INDEX idx_cliente_tienda_admin_actualiza (idTienda, idAdministradorActualiza);

ALTER TABLE cliente
  ADD CONSTRAINT chk_cliente_limite_credito
    CHECK (limiteCredito IS NULL OR limiteCredito>=0);
ALTER TABLE cliente
  ADD CONSTRAINT chk_cliente_permite_fiado
    CHECK (permiteFiado IN (0,1));
ALTER TABLE cliente
  ADD CONSTRAINT chk_cliente_acepta_recordatorios
    CHECK (aceptaRecordatorios IN (0,1));
ALTER TABLE cliente
  ADD CONSTRAINT chk_cliente_dias_credito
    CHECK (diasCreditoDefault IS NULL OR diasCreditoDefault BETWEEN 1 AND 365);
ALTER TABLE cliente
  ADD CONSTRAINT chk_cliente_contacto_normalizado
    CHECK (
      (correo IS NULL OR CHAR_LENGTH(TRIM(correo))>0)
      AND (documentoNormalizado IS NULL OR CHAR_LENGTH(TRIM(documentoNormalizado))>0)
      AND (telefonoNormalizado IS NULL OR CHAR_LENGTH(TRIM(telefonoNormalizado))>0)
    );

ALTER TABLE cliente
  ADD CONSTRAINT fk_cliente_admin_crea FOREIGN KEY (idTienda, idAdministradorCrea)
    REFERENCES administrador(idTienda, idAdministrador) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE cliente
  ADD CONSTRAINT fk_cliente_admin_actualiza FOREIGN KEY (idTienda, idAdministradorActualiza)
    REFERENCES administrador(idTienda, idAdministrador) ON UPDATE RESTRICT ON DELETE RESTRICT;

ALTER TABLE fiado ADD COLUMN fechaVencimiento DATE NULL AFTER fechaInicio;
ALTER TABLE fiado ADD COLUMN fechaPrometidaPago DATE NULL AFTER fechaVencimiento;
ALTER TABLE fiado ADD COLUMN observacionCredito VARCHAR(1000) NULL AFTER fechaPrometidaPago;
ALTER TABLE fiado ADD COLUMN cerradoEn DATETIME NULL AFTER eliminadoEn;
ALTER TABLE fiado ADD COLUMN idAdministradorCrea INT NULL AFTER cerradoEn;

UPDATE fiado f
LEFT JOIN (
  SELECT idTienda, idFiado, MAX(fechaPago) AS ultimoPago
  FROM pagoFiado
  GROUP BY idTienda, idFiado
) pagos ON pagos.idTienda=f.idTienda AND pagos.idFiado=f.idFiado
LEFT JOIN venta v ON v.idTienda=f.idTienda AND v.idVenta=f.idVenta
SET f.cerradoEn=COALESCE(pagos.ultimoPago, v.fecha, @fecha_local_012)
WHERE f.saldoPendiente=0 AND f.cerradoEn IS NULL;

ALTER TABLE fiado
  ADD UNIQUE INDEX uq_fiado_tienda_cliente_id (idTienda, idCliente, idFiado);
ALTER TABLE fiado
  ADD INDEX idx_fiado_tienda_cliente_saldo (idTienda, idCliente, saldoPendiente);
ALTER TABLE fiado
  ADD INDEX idx_fiado_tienda_vencimiento_saldo (idTienda, fechaVencimiento, saldoPendiente);
ALTER TABLE fiado
  ADD INDEX idx_fiado_tienda_promesa_saldo (idTienda, fechaPrometidaPago, saldoPendiente);
ALTER TABLE fiado
  ADD INDEX idx_fiado_tienda_estado_activo (idTienda, estado, activo);
ALTER TABLE fiado
  ADD INDEX idx_fiado_tienda_admin_crea (idTienda, idAdministradorCrea);

ALTER TABLE fiado
  ADD CONSTRAINT chk_fiado_cierre_credito
    CHECK (
      (saldoPendiente>0 AND cerradoEn IS NULL)
      OR (saldoPendiente=0 AND cerradoEn IS NOT NULL)
    );
ALTER TABLE fiado
  ADD CONSTRAINT fk_fiado_admin_crea FOREIGN KEY (idTienda, idAdministradorCrea)
    REFERENCES administrador(idTienda, idAdministrador) ON UPDATE RESTRICT ON DELETE RESTRICT;

CREATE TABLE IF NOT EXISTS configuracionCreditoTienda (
  idTienda INT NOT NULL,
  limiteCreditoDefault DECIMAL(12,2) NULL,
  diasCreditoDefault INT NOT NULL DEFAULT 30,
  diasAvisoVencimiento INT NOT NULL DEFAULT 3,
  politicaFiadoVencido ENUM('permitir','advertir','bloquear') NOT NULL DEFAULT 'advertir',
  requiereTelefonoParaFiado TINYINT(1) NOT NULL DEFAULT 0,
  permiteFiadoSinFecha TINYINT(1) NOT NULL DEFAULT 1,
  codigoPaisWhatsApp VARCHAR(8) NULL,
  creadoEn DATETIME NOT NULL,
  actualizadoEn DATETIME NOT NULL,
  idAdministradorActualiza INT NULL,
  PRIMARY KEY (idTienda)
) ENGINE=InnoDB;

ALTER TABLE configuracionCreditoTienda
  ADD INDEX idx_configCredito_tienda_admin (idTienda, idAdministradorActualiza);
ALTER TABLE configuracionCreditoTienda
  ADD CONSTRAINT chk_configCredito_limite
    CHECK (limiteCreditoDefault IS NULL OR limiteCreditoDefault>=0);
ALTER TABLE configuracionCreditoTienda
  ADD CONSTRAINT chk_configCredito_dias
    CHECK (diasCreditoDefault BETWEEN 1 AND 365 AND diasAvisoVencimiento BETWEEN 0 AND 90);
ALTER TABLE configuracionCreditoTienda
  ADD CONSTRAINT chk_configCredito_booleanos
    CHECK (requiereTelefonoParaFiado IN (0,1) AND permiteFiadoSinFecha IN (0,1));
ALTER TABLE configuracionCreditoTienda
  ADD CONSTRAINT chk_configCredito_codigo_pais
    CHECK (codigoPaisWhatsApp IS NULL OR codigoPaisWhatsApp REGEXP '^[0-9]{1,8}$');
ALTER TABLE configuracionCreditoTienda
  ADD CONSTRAINT fk_configCredito_tienda FOREIGN KEY (idTienda)
    REFERENCES tienda(idTienda) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE configuracionCreditoTienda
  ADD CONSTRAINT fk_configCredito_administrador FOREIGN KEY (idTienda, idAdministradorActualiza)
    REFERENCES administrador(idTienda, idAdministrador) ON UPDATE RESTRICT ON DELETE RESTRICT;

INSERT INTO configuracionCreditoTienda
  (idTienda, limiteCreditoDefault, diasCreditoDefault, diasAvisoVencimiento,
   politicaFiadoVencido, requiereTelefonoParaFiado, permiteFiadoSinFecha,
   codigoPaisWhatsApp, creadoEn, actualizadoEn, idAdministradorActualiza)
SELECT t.idTienda, NULL, 30, 3, 'advertir', 0, 1, NULL,
       @fecha_local_012, @fecha_local_012, NULL
FROM tienda t
WHERE NOT EXISTS (
  SELECT 1 FROM configuracionCreditoTienda c WHERE c.idTienda=t.idTienda
);

CREATE TABLE IF NOT EXISTS cobroFiado (
  idCobroFiado BIGINT NOT NULL AUTO_INCREMENT,
  idTienda INT NOT NULL,
  idCliente INT NOT NULL,
  fechaCobro DATETIME NOT NULL,
  montoTotal DECIMAL(12,2) NOT NULL,
  metodoPago ENUM('efectivo','qr','transferencia','tarjeta','otro','no_especificado') NOT NULL,
  montoRecibido DECIMAL(12,2) NULL,
  cambio DECIMAL(12,2) NOT NULL DEFAULT 0,
  referencia VARCHAR(160) NULL,
  observacion VARCHAR(1000) NULL,
  claveOperacion VARCHAR(160) NOT NULL,
  creadoEn DATETIME NOT NULL,
  idAdministrador INT NULL,
  esLegado TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (idCobroFiado)
) ENGINE=InnoDB;

ALTER TABLE cobroFiado
  ADD UNIQUE INDEX uq_cobroFiado_tienda_id (idTienda, idCobroFiado);
ALTER TABLE cobroFiado
  ADD UNIQUE INDEX uq_cobroFiado_tienda_clave (idTienda, claveOperacion);
ALTER TABLE cobroFiado
  ADD INDEX idx_cobroFiado_tienda_cliente_fecha (idTienda, idCliente, fechaCobro);
ALTER TABLE cobroFiado
  ADD INDEX idx_cobroFiado_tienda_fecha_metodo (idTienda, fechaCobro, metodoPago);
ALTER TABLE cobroFiado
  ADD INDEX idx_cobroFiado_tienda_admin_fecha (idTienda, idAdministrador, fechaCobro);

ALTER TABLE cobroFiado
  ADD CONSTRAINT chk_cobroFiado_monto CHECK (montoTotal>0);
ALTER TABLE cobroFiado
  ADD CONSTRAINT chk_cobroFiado_cambio CHECK (
    cambio>=0
    AND (
      (montoRecibido IS NULL AND cambio=0)
      OR (montoRecibido IS NOT NULL AND montoRecibido>=montoTotal
          AND ABS((montoRecibido-montoTotal)-cambio)<0.01)
    )
  );
ALTER TABLE cobroFiado
  ADD CONSTRAINT chk_cobroFiado_legado CHECK (esLegado IN (0,1));

ALTER TABLE cobroFiado
  ADD CONSTRAINT fk_cobroFiado_tienda FOREIGN KEY (idTienda)
    REFERENCES tienda(idTienda) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE cobroFiado
  ADD CONSTRAINT fk_cobroFiado_cliente FOREIGN KEY (idTienda, idCliente)
    REFERENCES cliente(idTienda, idCliente) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE cobroFiado
  ADD CONSTRAINT fk_cobroFiado_administrador FOREIGN KEY (idTienda, idAdministrador)
    REFERENCES administrador(idTienda, idAdministrador) ON UPDATE RESTRICT ON DELETE RESTRICT;

ALTER TABLE pagoFiado ADD COLUMN idCobroFiado BIGINT NULL AFTER idFiado;
ALTER TABLE pagoFiado ADD COLUMN claveDistribucion VARCHAR(160) NULL AFTER observacion;

INSERT INTO cobroFiado
  (idTienda, idCliente, fechaCobro, montoTotal, metodoPago, montoRecibido,
   cambio, referencia, observacion, claveOperacion, creadoEn,
   idAdministrador, esLegado)
SELECT pf.idTienda, f.idCliente, pf.fechaPago, pf.monto,
       COALESCE(pv.metodoPago, 'no_especificado'), NULL, 0,
       pv.referencia, pf.observacion,
       CONCAT('legado:pago-fiado:', pf.idPagoFiado), pf.fechaPago,
       pv.idAdministrador, 1
FROM pagoFiado pf
JOIN fiado f ON f.idTienda=pf.idTienda AND f.idFiado=pf.idFiado
LEFT JOIN pagoVenta pv ON pv.idTienda=pf.idTienda AND pv.idPagoFiado=pf.idPagoFiado
WHERE NOT EXISTS (
  SELECT 1 FROM cobroFiado cf
  WHERE cf.idTienda=pf.idTienda
    AND cf.claveOperacion=CONCAT('legado:pago-fiado:', pf.idPagoFiado)
);

UPDATE pagoFiado pf
JOIN cobroFiado cf
  ON cf.idTienda=pf.idTienda
 AND cf.claveOperacion=CONCAT('legado:pago-fiado:', pf.idPagoFiado)
SET pf.idCobroFiado=COALESCE(pf.idCobroFiado, cf.idCobroFiado),
    pf.claveDistribucion=COALESCE(
      pf.claveDistribucion,
      CONCAT('legado:distribucion:', pf.idPagoFiado)
    )
WHERE pf.idCobroFiado IS NULL OR pf.claveDistribucion IS NULL;

ALTER TABLE pagoFiado MODIFY COLUMN idCobroFiado BIGINT NOT NULL;
ALTER TABLE pagoFiado MODIFY COLUMN claveDistribucion VARCHAR(160) NOT NULL;

ALTER TABLE pagoFiado
  ADD UNIQUE INDEX uq_pagoFiado_tienda_clave_distribucion (idTienda, claveDistribucion);
ALTER TABLE pagoFiado
  ADD INDEX idx_pagoFiado_tienda_cobro_fiado (idTienda, idCobroFiado, idFiado);
ALTER TABLE pagoFiado
  ADD CONSTRAINT fk_pagoFiado_cobro FOREIGN KEY (idTienda, idCobroFiado)
    REFERENCES cobroFiado(idTienda, idCobroFiado) ON UPDATE RESTRICT ON DELETE RESTRICT;

CREATE TABLE IF NOT EXISTS seguimientoCobranza (
  idSeguimientoCobranza BIGINT NOT NULL AUTO_INCREMENT,
  idTienda INT NOT NULL,
  idCliente INT NOT NULL,
  idFiado INT NULL,
  tipo ENUM('nota','recordatorio_preparado','llamada','mensaje_enviado_manual','compromiso_pago','visita') NOT NULL,
  canal ENUM('ninguno','whatsapp','telefono','presencial','correo') NOT NULL DEFAULT 'ninguno',
  detalle VARCHAR(2000) NOT NULL,
  fechaCompromiso DATE NULL,
  creadoEn DATETIME NOT NULL,
  idAdministrador INT NOT NULL,
  PRIMARY KEY (idSeguimientoCobranza)
) ENGINE=InnoDB;

ALTER TABLE seguimientoCobranza
  ADD INDEX idx_seguimientoCobranza_tienda_cliente_fecha (idTienda, idCliente, creadoEn);
ALTER TABLE seguimientoCobranza
  ADD INDEX idx_seguimientoCobranza_tienda_fiado_fecha (idTienda, idFiado, creadoEn);
ALTER TABLE seguimientoCobranza
  ADD INDEX idx_seguimientoCobranza_tienda_tipo_fecha (idTienda, tipo, creadoEn);
ALTER TABLE seguimientoCobranza
  ADD INDEX idx_seguimientoCobranza_tienda_compromiso (idTienda, fechaCompromiso);
ALTER TABLE seguimientoCobranza
  ADD INDEX idx_seguimientoCobranza_tienda_admin (idTienda, idAdministrador);

ALTER TABLE seguimientoCobranza
  ADD CONSTRAINT chk_seguimientoCobranza_detalle
    CHECK (CHAR_LENGTH(TRIM(detalle))>0);
ALTER TABLE seguimientoCobranza
  ADD CONSTRAINT chk_seguimientoCobranza_compromiso
    CHECK (tipo<>'compromiso_pago' OR fechaCompromiso IS NOT NULL);

ALTER TABLE seguimientoCobranza
  ADD CONSTRAINT fk_seguimientoCobranza_tienda FOREIGN KEY (idTienda)
    REFERENCES tienda(idTienda) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE seguimientoCobranza
  ADD CONSTRAINT fk_seguimientoCobranza_cliente FOREIGN KEY (idTienda, idCliente)
    REFERENCES cliente(idTienda, idCliente) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE seguimientoCobranza
  ADD CONSTRAINT fk_seguimientoCobranza_fiado FOREIGN KEY (idTienda, idCliente, idFiado)
    REFERENCES fiado(idTienda, idCliente, idFiado) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE seguimientoCobranza
  ADD CONSTRAINT fk_seguimientoCobranza_administrador FOREIGN KEY (idTienda, idAdministrador)
    REFERENCES administrador(idTienda, idAdministrador) ON UPDATE RESTRICT ON DELETE RESTRICT;

CREATE TABLE IF NOT EXISTS plantillaCobranzaTienda (
  idPlantillaCobranza BIGINT NOT NULL AUTO_INCREMENT,
  idTienda INT NOT NULL,
  tipo ENUM('recordatorio_previo','deuda_vencida','confirmacion_pago','estado_cuenta') NOT NULL,
  nombre VARCHAR(100) NOT NULL,
  contenido VARCHAR(2000) NOT NULL,
  activo TINYINT(1) NOT NULL DEFAULT 1,
  creadoEn DATETIME NOT NULL,
  actualizadoEn DATETIME NOT NULL,
  idAdministradorActualiza INT NULL,
  PRIMARY KEY (idPlantillaCobranza)
) ENGINE=InnoDB;

ALTER TABLE plantillaCobranzaTienda
  ADD UNIQUE INDEX uq_plantillaCobranza_tienda_tipo_nombre (idTienda, tipo, nombre);
ALTER TABLE plantillaCobranzaTienda
  ADD INDEX idx_plantillaCobranza_tienda_activo_tipo (idTienda, activo, tipo);
ALTER TABLE plantillaCobranzaTienda
  ADD INDEX idx_plantillaCobranza_tienda_admin (idTienda, idAdministradorActualiza);

ALTER TABLE plantillaCobranzaTienda
  ADD CONSTRAINT chk_plantillaCobranza_texto
    CHECK (CHAR_LENGTH(TRIM(nombre))>0 AND CHAR_LENGTH(TRIM(contenido))>0);
ALTER TABLE plantillaCobranzaTienda
  ADD CONSTRAINT chk_plantillaCobranza_activo CHECK (activo IN (0,1));

ALTER TABLE plantillaCobranzaTienda
  ADD CONSTRAINT fk_plantillaCobranza_tienda FOREIGN KEY (idTienda)
    REFERENCES tienda(idTienda) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE plantillaCobranzaTienda
  ADD CONSTRAINT fk_plantillaCobranza_administrador FOREIGN KEY (idTienda, idAdministradorActualiza)
    REFERENCES administrador(idTienda, idAdministrador) ON UPDATE RESTRICT ON DELETE RESTRICT;

INSERT INTO plantillaCobranzaTienda
  (idTienda, tipo, nombre, contenido, activo, creadoEn, actualizadoEn, idAdministradorActualiza)
SELECT t.idTienda, plantillas.tipo, plantillas.nombre, plantillas.contenido,
       1, @fecha_local_012, @fecha_local_012, NULL
FROM tienda t
CROSS JOIN (
  SELECT 'recordatorio_previo' AS tipo, 'Recordatorio previo' AS nombre,
         'Hola {cliente}, {tienda} le recuerda que su saldo de {saldo} vence el {vencimiento}.' AS contenido
  UNION ALL
  SELECT 'deuda_vencida', 'Deuda vencida',
         'Hola {cliente}, su saldo pendiente con {tienda} es {saldo} y tiene {dias_atraso} dias de atraso.'
  UNION ALL
  SELECT 'confirmacion_pago', 'Confirmacion de pago',
         'Hola {cliente}, {tienda} confirma la recepcion de su pago. Saldo pendiente: {saldo}.'
  UNION ALL
  SELECT 'estado_cuenta', 'Estado de cuenta',
         'Hola {cliente}, su estado de cuenta en {tienda} muestra un saldo pendiente de {saldo}. Comprobante: {comprobante}.'
) plantillas
WHERE NOT EXISTS (
  SELECT 1 FROM plantillaCobranzaTienda existente
  WHERE existente.idTienda=t.idTienda
    AND existente.tipo=plantillas.tipo
    AND existente.nombre=plantillas.nombre
);

INSERT INTO funcionalidad (codigo, nombre, descripcion, activo, creadoEn, actualizadoEn)
VALUES ('clientes_basico', 'Clientes', 'Registro y consulta operativa de clientes.', 1, @fecha_local_012, @fecha_local_012)
ON DUPLICATE KEY UPDATE activo=1, actualizadoEn=@fecha_local_012;
INSERT INTO funcionalidad (codigo, nombre, descripcion, activo, creadoEn, actualizadoEn)
VALUES ('fiados_basico', 'Fiados', 'Consulta y gestion operativa de deudas originadas por ventas.', 1, @fecha_local_012, @fecha_local_012)
ON DUPLICATE KEY UPDATE activo=1, actualizadoEn=@fecha_local_012;
INSERT INTO funcionalidad (codigo, nombre, descripcion, activo, creadoEn, actualizadoEn)
VALUES ('pagos_fiado', 'Pagos de fiado', 'Registro y distribucion de cobros de cuentas pendientes.', 1, @fecha_local_012, @fecha_local_012)
ON DUPLICATE KEY UPDATE activo=1, actualizadoEn=@fecha_local_012;
INSERT INTO funcionalidad (codigo, nombre, descripcion, activo, creadoEn, actualizadoEn)
VALUES ('estado_cuenta_basico', 'Estado de cuenta', 'Consulta basica de compras, fiados y pagos por cliente.', 1, @fecha_local_012, @fecha_local_012)
ON DUPLICATE KEY UPDATE activo=1, actualizadoEn=@fecha_local_012;
INSERT INTO funcionalidad (codigo, nombre, descripcion, activo, creadoEn, actualizadoEn)
VALUES ('limites_credito', 'Limites de credito', 'Limites y politicas de credito configurables.', 1, @fecha_local_012, @fecha_local_012)
ON DUPLICATE KEY UPDATE activo=1, actualizadoEn=@fecha_local_012;
INSERT INTO funcionalidad (codigo, nombre, descripcion, activo, creadoEn, actualizadoEn)
VALUES ('seguimiento_cobranza', 'Seguimiento de cobranza', 'Historial de compromisos y acciones de cobranza.', 1, @fecha_local_012, @fecha_local_012)
ON DUPLICATE KEY UPDATE activo=1, actualizadoEn=@fecha_local_012;
INSERT INTO funcionalidad (codigo, nombre, descripcion, activo, creadoEn, actualizadoEn)
VALUES ('segmentacion_clientes', 'Segmentacion de clientes', 'Clasificaciones transparentes segun compras y pagos.', 1, @fecha_local_012, @fecha_local_012)
ON DUPLICATE KEY UPDATE activo=1, actualizadoEn=@fecha_local_012;
INSERT INTO funcionalidad (codigo, nombre, descripcion, activo, creadoEn, actualizadoEn)
VALUES ('exportacion_clientes_fiados', 'Exportacion de clientes y fiados', 'Exportacion administrativa de clientes, deudas y cobros.', 1, @fecha_local_012, @fecha_local_012)
ON DUPLICATE KEY UPDATE activo=1, actualizadoEn=@fecha_local_012;
INSERT INTO funcionalidad (codigo, nombre, descripcion, activo, creadoEn, actualizadoEn)
VALUES ('recordatorios_fiado', 'Recordatorios de fiado', 'Recordatorios preparados para cuentas pendientes.', 1, @fecha_local_012, @fecha_local_012)
ON DUPLICATE KEY UPDATE activo=1, actualizadoEn=@fecha_local_012;

INSERT INTO planFuncionalidad (idPlan, idFuncionalidad, habilitada, creadoEn)
SELECT p.idPlan, f.idFuncionalidad, 1, @fecha_local_012
FROM plan p
JOIN funcionalidad f ON f.codigo IN (
  'clientes_basico','fiados_basico','pagos_fiado','estado_cuenta_basico'
)
WHERE p.codigo IN ('basico','avanzado')
ON DUPLICATE KEY UPDATE habilitada=1;

INSERT INTO planFuncionalidad (idPlan, idFuncionalidad, habilitada, creadoEn)
SELECT p.idPlan, f.idFuncionalidad, 1, @fecha_local_012
FROM plan p
JOIN funcionalidad f ON f.codigo IN (
  'limites_credito','seguimiento_cobranza','segmentacion_clientes',
  'exportacion_clientes_fiados','recordatorios_fiado'
)
WHERE p.codigo='avanzado'
ON DUPLICATE KEY UPDATE habilitada=1;

INSERT INTO planFuncionalidad (idPlan, idFuncionalidad, habilitada, creadoEn)
SELECT p.idPlan, f.idFuncionalidad, 0, @fecha_local_012
FROM plan p
JOIN funcionalidad f ON f.codigo IN (
  'limites_credito','seguimiento_cobranza','segmentacion_clientes',
  'exportacion_clientes_fiados','recordatorios_fiado'
)
WHERE p.codigo='basico'
ON DUPLICATE KEY UPDATE habilitada=0;
