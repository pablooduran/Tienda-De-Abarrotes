CREATE DATABASE IF NOT EXISTS tienda_abarrotes
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE tienda_abarrotes;

-- Marca explicita de instalacion en hora local de Bolivia (UTC-04:00).
SET time_zone = '-04:00';
SET @fecha_local_instalacion = CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '-04:00');

CREATE TABLE IF NOT EXISTS tienda (
  idTienda INT AUTO_INCREMENT PRIMARY KEY,
  nombre VARCHAR(120) NOT NULL,
  slug VARCHAR(120) NOT NULL,
  activo TINYINT(1) NOT NULL DEFAULT 1,
  estado ENUM('activa','suspendida','inactiva') NOT NULL DEFAULT 'activa',
  estadoOnboarding ENUM('pendiente','en_progreso','completado') NOT NULL DEFAULT 'completado',
  onboardingCompletadoEn DATETIME NULL,
  creadoEn DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizadoEn DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT uq_tienda_slug UNIQUE (slug),
  KEY idx_tienda_onboarding (estadoOnboarding, activo)
);

INSERT INTO tienda (nombre, slug, activo, estado)
SELECT 'Tienda Deisy', 'tienda-deisy', 1, 'activa'
WHERE NOT EXISTS (SELECT 1 FROM tienda WHERE slug = 'tienda-deisy');

CREATE TABLE IF NOT EXISTS configuracionTienda (
  idConfiguracionTienda BIGINT NOT NULL AUTO_INCREMENT,
  idTienda INT NOT NULL,
  nombreMostrado VARCHAR(120) NOT NULL,
  moneda CHAR(3) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'BOB',
  zonaHoraria VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin
    NOT NULL DEFAULT 'America/La_Paz',
  telefono VARCHAR(30) NULL,
  direccion VARCHAR(255) NULL,
  datoFiscalBasico VARCHAR(120) NULL,
  creadoEn DATETIME NOT NULL,
  actualizadoEn DATETIME NOT NULL,
  PRIMARY KEY (idConfiguracionTienda),
  UNIQUE KEY uq_configuracionTienda_tienda (idTienda),
  CONSTRAINT chk_configuracionTienda_nombre
    CHECK (CHAR_LENGTH(TRIM(nombreMostrado)) BETWEEN 1 AND 120),
  CONSTRAINT chk_configuracionTienda_moneda
    CHECK (moneda IN ('BOB')),
  CONSTRAINT chk_configuracionTienda_zona
    CHECK (zonaHoraria IN ('America/La_Paz')),
  CONSTRAINT chk_configuracionTienda_opcionales
    CHECK (
      (telefono IS NULL OR CHAR_LENGTH(TRIM(telefono)) BETWEEN 1 AND 30)
      AND (direccion IS NULL OR CHAR_LENGTH(TRIM(direccion)) BETWEEN 1 AND 255)
      AND (
        datoFiscalBasico IS NULL
        OR CHAR_LENGTH(TRIM(datoFiscalBasico)) BETWEEN 1 AND 120
      )
    ),
  CONSTRAINT fk_configuracionTienda_tienda
    FOREIGN KEY (idTienda) REFERENCES tienda(idTienda)
    ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB;

INSERT INTO configuracionTienda
  (idTienda, nombreMostrado, moneda, zonaHoraria, telefono, direccion,
   datoFiscalBasico, creadoEn, actualizadoEn)
SELECT t.idTienda, t.nombre, 'BOB', 'America/La_Paz', NULL, NULL, NULL,
       @fecha_local_instalacion, @fecha_local_instalacion
FROM tienda t
WHERE NOT EXISTS (
  SELECT 1 FROM configuracionTienda c WHERE c.idTienda=t.idTienda
);

CREATE TABLE IF NOT EXISTS administrador (
  idAdministrador INT AUTO_INCREMENT PRIMARY KEY,
  idTienda INT NULL,
  usuario VARCHAR(50) NOT NULL UNIQUE,
  correoNormalizado VARCHAR(160) NULL,
  correoVerificadoEn DATETIME NULL,
  password VARCHAR(255) NOT NULL,
  rol ENUM('superadmin','dueno_tienda') NOT NULL DEFAULT 'dueno_tienda',
  activo TINYINT(1) NOT NULL DEFAULT 1,
  estadoAcceso ENUM('activo','pendiente_verificacion') NOT NULL DEFAULT 'activo',
  versionSesion INT UNSIGNED NOT NULL DEFAULT 1,
  UNIQUE KEY uq_administrador_tienda_id (idTienda, idAdministrador),
  UNIQUE KEY uq_administrador_correo_normalizado (correoNormalizado),
  KEY idx_administrador_tienda_activo (idTienda, activo),
  KEY idx_administrador_estado_acceso (estadoAcceso, activo),
  CONSTRAINT fk_administrador_tienda FOREIGN KEY (idTienda) REFERENCES tienda(idTienda),
  CONSTRAINT chk_administrador_rol_tienda CHECK (
    (rol = 'superadmin' AND idTienda IS NULL)
    OR (rol = 'dueno_tienda' AND idTienda IS NOT NULL)
  ),
  CONSTRAINT chk_administrador_version_sesion CHECK (versionSesion >= 1)
);

CREATE TABLE IF NOT EXISTS plan (
  idPlan INT AUTO_INCREMENT PRIMARY KEY,
  codigo VARCHAR(50) NOT NULL,
  nombre VARCHAR(100) NOT NULL,
  descripcion VARCHAR(255) NULL,
  activo TINYINT(1) NOT NULL DEFAULT 1,
  precioMensual DECIMAL(10,2) NOT NULL DEFAULT 0,
  duracionDias INT NOT NULL DEFAULT 30,
  limitePropietarios INT NULL,
  limiteProductos INT NULL,
  limiteClientes INT NULL,
  limiteProveedores INT NULL,
  creadoEn DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizadoEn DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT uq_plan_codigo UNIQUE (codigo)
);

CREATE TABLE IF NOT EXISTS funcionalidad (
  idFuncionalidad INT AUTO_INCREMENT PRIMARY KEY,
  codigo VARCHAR(80) NOT NULL,
  nombre VARCHAR(120) NOT NULL,
  descripcion VARCHAR(255) NULL,
  activo TINYINT(1) NOT NULL DEFAULT 1,
  creadoEn DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizadoEn DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT uq_funcionalidad_codigo UNIQUE (codigo)
);

CREATE TABLE IF NOT EXISTS planFuncionalidad (
  idPlan INT NOT NULL,
  idFuncionalidad INT NOT NULL,
  habilitada TINYINT(1) NOT NULL DEFAULT 1,
  creadoEn DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (idPlan, idFuncionalidad),
  KEY idx_planFuncionalidad_funcionalidad (idFuncionalidad),
  CONSTRAINT fk_planFuncionalidad_plan FOREIGN KEY (idPlan) REFERENCES plan(idPlan),
  CONSTRAINT fk_planFuncionalidad_funcionalidad FOREIGN KEY (idFuncionalidad) REFERENCES funcionalidad(idFuncionalidad)
);

CREATE TABLE IF NOT EXISTS suscripcionTienda (
  idSuscripcion INT AUTO_INCREMENT PRIMARY KEY,
  idTienda INT NOT NULL,
  idPlan INT NOT NULL,
  tipo ENUM('prueba','pagada','cortesia') NOT NULL,
  estado ENUM('pendiente','activa','vencida','suspendida','cancelada') NOT NULL DEFAULT 'pendiente',
  fechaInicio DATETIME NOT NULL,
  fechaFin DATETIME NOT NULL,
  renovacionAutomatica TINYINT(1) NOT NULL DEFAULT 0,
  observacion VARCHAR(500) NULL,
  creadoPor INT NULL,
  creadoEn DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizadoEn DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_suscripcion_tienda_estado_fechas (idTienda, estado, fechaInicio, fechaFin),
  KEY idx_suscripcion_plan (idPlan),
  KEY idx_suscripcion_creadoPor (creadoPor),
  CONSTRAINT fk_suscripcion_tienda FOREIGN KEY (idTienda) REFERENCES tienda(idTienda),
  CONSTRAINT fk_suscripcion_plan FOREIGN KEY (idPlan) REFERENCES plan(idPlan),
  CONSTRAINT fk_suscripcion_creadoPor FOREIGN KEY (creadoPor) REFERENCES administrador(idAdministrador)
);

CREATE TABLE IF NOT EXISTS tokenAccesoAdministrador (
  idTokenAcceso BIGINT NOT NULL AUTO_INCREMENT,
  idAdministrador INT NOT NULL,
  tipo ENUM('verificacion_correo','recuperacion_password') NOT NULL,
  tokenHash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  expiraEn DATETIME NOT NULL,
  usadoEn DATETIME NULL,
  invalidadoEn DATETIME NULL,
  creadoEn DATETIME NOT NULL,
  PRIMARY KEY (idTokenAcceso),
  UNIQUE KEY uq_tokenAcceso_hash (tokenHash),
  KEY idx_tokenAcceso_administrador_tipo_estado (idAdministrador, tipo, usadoEn, invalidadoEn, expiraEn),
  CONSTRAINT chk_tokenAcceso_hash CHECK (tokenHash REGEXP '^[0-9a-f]{64}$'),
  CONSTRAINT chk_tokenAcceso_fechas CHECK (
    expiraEn>creadoEn
    AND (usadoEn IS NULL OR usadoEn>=creadoEn)
    AND (invalidadoEn IS NULL OR invalidadoEn>=creadoEn)
  ),
  CONSTRAINT fk_tokenAcceso_administrador FOREIGN KEY (idAdministrador)
    REFERENCES administrador(idAdministrador) ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS solicitudRegistroPublico (
  idSolicitudRegistro BIGINT NOT NULL AUTO_INCREMENT,
  claveHash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  huellaSolicitud CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  estado ENUM('en_proceso','completada','fallida') NOT NULL DEFAULT 'en_proceso',
  idTienda INT NULL,
  idAdministrador INT NULL,
  completadaEn DATETIME NULL,
  creadoEn DATETIME NOT NULL,
  actualizadoEn DATETIME NOT NULL,
  PRIMARY KEY (idSolicitudRegistro),
  UNIQUE KEY uq_solicitudRegistro_clave_hash (claveHash),
  KEY idx_solicitudRegistro_estado_fecha (estado, actualizadoEn),
  KEY idx_solicitudRegistro_tienda (idTienda),
  KEY idx_solicitudRegistro_administrador (idAdministrador),
  CONSTRAINT chk_solicitudRegistro_hashes CHECK (
    claveHash REGEXP '^[0-9a-f]{64}$'
    AND huellaSolicitud REGEXP '^[0-9a-f]{64}$'
  ),
  CONSTRAINT chk_solicitudRegistro_resultado CHECK (
    (estado='completada' AND idTienda IS NOT NULL AND idAdministrador IS NOT NULL AND completadaEn IS NOT NULL)
    OR (estado IN ('en_proceso','fallida') AND idTienda IS NULL AND idAdministrador IS NULL)
  ),
  CONSTRAINT fk_solicitudRegistro_tienda FOREIGN KEY (idTienda)
    REFERENCES tienda(idTienda) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_solicitudRegistro_administrador FOREIGN KEY (idAdministrador)
    REFERENCES administrador(idAdministrador) ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB;

INSERT INTO plan
  (codigo, nombre, descripcion, activo, precioMensual, duracionDias, limitePropietarios, limiteProductos, limiteClientes, limiteProveedores)
SELECT 'basico', 'Basico', 'Funciones comerciales para una tienda pequena.', 1, 0, 30, 1, 500, 500, 100
WHERE NOT EXISTS (SELECT 1 FROM plan WHERE codigo='basico');

INSERT INTO plan
  (codigo, nombre, descripcion, activo, precioMensual, duracionDias, limitePropietarios, limiteProductos, limiteClientes, limiteProveedores)
SELECT 'avanzado', 'Avanzado', 'Mayor capacidad y acceso a funciones avanzadas futuras.', 1, 0, 30, 5, NULL, NULL, NULL
WHERE NOT EXISTS (SELECT 1 FROM plan WHERE codigo='avanzado');

INSERT INTO funcionalidad (codigo, nombre, descripcion)
SELECT 'reportes_avanzados', 'Reportes avanzados', 'Analisis y reportes ampliados.'
WHERE NOT EXISTS (SELECT 1 FROM funcionalidad WHERE codigo='reportes_avanzados');
INSERT INTO funcionalidad (codigo, nombre, descripcion)
SELECT 'compras_sugeridas', 'Compras sugeridas', 'Sugerencias de abastecimiento segun rotacion.'
WHERE NOT EXISTS (SELECT 1 FROM funcionalidad WHERE codigo='compras_sugeridas');
INSERT INTO funcionalidad (codigo, nombre, descripcion)
SELECT 'historial_stock', 'Historial de stock', 'Movimientos y ajustes detallados de inventario.'
WHERE NOT EXISTS (SELECT 1 FROM funcionalidad WHERE codigo='historial_stock');

INSERT INTO funcionalidad (codigo, nombre, descripcion)
SELECT 'ajuste_stock', 'Ajuste de stock', 'Conteo fisico y ajuste manual protegido del inventario.'
WHERE NOT EXISTS (SELECT 1 FROM funcionalidad WHERE codigo='ajuste_stock');
INSERT INTO funcionalidad (codigo, nombre, descripcion)
SELECT 'recibos_whatsapp', 'Recibos por WhatsApp', 'Envio de recibos por WhatsApp.'
WHERE NOT EXISTS (SELECT 1 FROM funcionalidad WHERE codigo='recibos_whatsapp');
INSERT INTO funcionalidad (codigo, nombre, descripcion)
SELECT 'recordatorios_fiado', 'Recordatorios de fiado', 'Recordatorios para cuentas pendientes.'
WHERE NOT EXISTS (SELECT 1 FROM funcionalidad WHERE codigo='recordatorios_fiado');
INSERT INTO funcionalidad (codigo, nombre, descripcion)
SELECT 'gastos', 'Gastos de tienda', 'Registro y analisis de gastos operativos.'
WHERE NOT EXISTS (SELECT 1 FROM funcionalidad WHERE codigo='gastos');
INSERT INTO funcionalidad (codigo, nombre, descripcion)
SELECT 'cierre_caja', 'Cierre de caja', 'Control avanzado de caja y cierres.'
WHERE NOT EXISTS (SELECT 1 FROM funcionalidad WHERE codigo='cierre_caja');
INSERT INTO funcionalidad (codigo, nombre, descripcion)
SELECT 'vencimientos_lote', 'Vencimientos por lote', 'Control opcional de lotes y vencimientos.'
WHERE NOT EXISTS (SELECT 1 FROM funcionalidad WHERE codigo='vencimientos_lote');
INSERT INTO funcionalidad (codigo, nombre, descripcion)
SELECT 'control_lotes', 'Control de lotes', 'Trazabilidad operativa de existencias por ingreso fisico.'
WHERE NOT EXISTS (SELECT 1 FROM funcionalidad WHERE codigo='control_lotes');
INSERT INTO funcionalidad (codigo, nombre, descripcion)
SELECT 'alertas_vencimiento', 'Alertas de vencimiento', 'Avisos de lotes proximos a vencer o vencidos.'
WHERE NOT EXISTS (SELECT 1 FROM funcionalidad WHERE codigo='alertas_vencimiento');
INSERT INTO funcionalidad (codigo, nombre, descripcion)
SELECT 'trazabilidad_lotes', 'Trazabilidad de lotes', 'Seguimiento desde la compra hasta la salida comercial.'
WHERE NOT EXISTS (SELECT 1 FROM funcionalidad WHERE codigo='trazabilidad_lotes');
INSERT INTO funcionalidad (codigo, nombre, descripcion)
SELECT 'exportacion_lotes', 'Exportacion de lotes', 'Exportacion administrativa de lotes y vencimientos.'
WHERE NOT EXISTS (SELECT 1 FROM funcionalidad WHERE codigo='exportacion_lotes');
INSERT INTO funcionalidad (codigo, nombre, descripcion)
SELECT 'portal_clientes', 'Portal de clientes', 'Acceso futuro para compradores y pedidos.'
WHERE NOT EXISTS (SELECT 1 FROM funcionalidad WHERE codigo='portal_clientes');
INSERT INTO funcionalidad (codigo, nombre, descripcion)
SELECT 'catalogo_maestro', 'Catalogo maestro', 'Busqueda y alta guiada de productos desde el catalogo de plataforma.'
WHERE NOT EXISTS (SELECT 1 FROM funcionalidad WHERE codigo='catalogo_maestro');
INSERT INTO funcionalidad (codigo, nombre, descripcion)
SELECT 'punto_venta', 'Punto de venta', 'Venta rapida con carrito, cobro y comprobante.'
WHERE NOT EXISTS (SELECT 1 FROM funcionalidad WHERE codigo='punto_venta');
INSERT INTO funcionalidad (codigo, nombre, descripcion)
SELECT 'pagos_multiples', 'Pagos multiples', 'Cobros mediante efectivo, QR o combinacion de ambos.'
WHERE NOT EXISTS (SELECT 1 FROM funcionalidad WHERE codigo='pagos_multiples');
INSERT INTO funcionalidad (codigo, nombre, descripcion)
SELECT 'reportes_financieros', 'Reportes financieros', 'Resumen de ventas, cobros, costos, gastos y ganancias.'
WHERE NOT EXISTS (SELECT 1 FROM funcionalidad WHERE codigo='reportes_financieros');
INSERT INTO funcionalidad (codigo, nombre, descripcion)
SELECT 'rentabilidad_producto', 'Rentabilidad por producto', 'Analisis detallado de costo, margen y ganancia por producto.'
WHERE NOT EXISTS (SELECT 1 FROM funcionalidad WHERE codigo='rentabilidad_producto');
INSERT INTO funcionalidad (codigo, nombre, descripcion)
SELECT 'exportacion_reportes', 'Exportacion de reportes', 'Exportacion segura de reportes financieros en Excel.'
WHERE NOT EXISTS (SELECT 1 FROM funcionalidad WHERE codigo='exportacion_reportes');
INSERT INTO funcionalidad (codigo, nombre, descripcion)
SELECT 'dashboard_financiero', 'Dashboard financiero', 'Indicadores de ventas, cobros, costos y gastos.'
WHERE NOT EXISTS (SELECT 1 FROM funcionalidad WHERE codigo='dashboard_financiero');
INSERT INTO funcionalidad (codigo, nombre, descripcion)
SELECT 'inventario_resumen', 'Resumen de inventario', 'Estado general y alertas esenciales del inventario.'
WHERE NOT EXISTS (SELECT 1 FROM funcionalidad WHERE codigo='inventario_resumen');
INSERT INTO funcionalidad (codigo, nombre, descripcion)
SELECT 'alertas_stock', 'Alertas de stock', 'Productos agotados, en minimo y con stock bajo.'
WHERE NOT EXISTS (SELECT 1 FROM funcionalidad WHERE codigo='alertas_stock');
INSERT INTO funcionalidad (codigo, nombre, descripcion)
SELECT 'ranking_productos', 'Ranking de productos', 'Productos con mayor y menor movimiento comercial.'
WHERE NOT EXISTS (SELECT 1 FROM funcionalidad WHERE codigo='ranking_productos');
INSERT INTO funcionalidad (codigo, nombre, descripcion)
SELECT 'valor_inventario_basico', 'Valor basico del inventario', 'Valor estimado del inventario a costo y venta.'
WHERE NOT EXISTS (SELECT 1 FROM funcionalidad WHERE codigo='valor_inventario_basico');
INSERT INTO funcionalidad (codigo, nombre, descripcion)
SELECT 'rotacion_inventario', 'Rotacion de inventario', 'Analisis de rotacion por producto y periodo.'
WHERE NOT EXISTS (SELECT 1 FROM funcionalidad WHERE codigo='rotacion_inventario');
INSERT INTO funcionalidad (codigo, nombre, descripcion)
SELECT 'dias_cobertura', 'Dias de cobertura', 'Estimacion de dias restantes de inventario.'
WHERE NOT EXISTS (SELECT 1 FROM funcionalidad WHERE codigo='dias_cobertura');
INSERT INTO funcionalidad (codigo, nombre, descripcion)
SELECT 'inventario_sin_movimiento', 'Inventario sin movimiento', 'Deteccion de productos nuevos o sin ventas recientes.'
WHERE NOT EXISTS (SELECT 1 FROM funcionalidad WHERE codigo='inventario_sin_movimiento');
INSERT INTO funcionalidad (codigo, nombre, descripcion)
SELECT 'exportacion_inventario', 'Exportacion de inventario', 'Exportacion de analisis detallado del inventario.'
WHERE NOT EXISTS (SELECT 1 FROM funcionalidad WHERE codigo='exportacion_inventario');
INSERT INTO funcionalidad (codigo, nombre, descripcion, activo, creadoEn, actualizadoEn)
SELECT 'clientes_basico', 'Clientes', 'Registro y consulta operativa de clientes.', 1,
       @fecha_local_instalacion, @fecha_local_instalacion
WHERE NOT EXISTS (SELECT 1 FROM funcionalidad WHERE codigo='clientes_basico');
INSERT INTO funcionalidad (codigo, nombre, descripcion, activo, creadoEn, actualizadoEn)
SELECT 'fiados_basico', 'Fiados', 'Consulta y gestion operativa de deudas originadas por ventas.', 1,
       @fecha_local_instalacion, @fecha_local_instalacion
WHERE NOT EXISTS (SELECT 1 FROM funcionalidad WHERE codigo='fiados_basico');
INSERT INTO funcionalidad (codigo, nombre, descripcion, activo, creadoEn, actualizadoEn)
SELECT 'pagos_fiado', 'Pagos de fiado', 'Registro y distribucion de cobros de cuentas pendientes.', 1,
       @fecha_local_instalacion, @fecha_local_instalacion
WHERE NOT EXISTS (SELECT 1 FROM funcionalidad WHERE codigo='pagos_fiado');
INSERT INTO funcionalidad (codigo, nombre, descripcion, activo, creadoEn, actualizadoEn)
SELECT 'estado_cuenta_basico', 'Estado de cuenta', 'Consulta basica de compras, fiados y pagos por cliente.', 1,
       @fecha_local_instalacion, @fecha_local_instalacion
WHERE NOT EXISTS (SELECT 1 FROM funcionalidad WHERE codigo='estado_cuenta_basico');
INSERT INTO funcionalidad (codigo, nombre, descripcion, activo, creadoEn, actualizadoEn)
SELECT 'limites_credito', 'Limites de credito', 'Limites y politicas de credito configurables.', 1,
       @fecha_local_instalacion, @fecha_local_instalacion
WHERE NOT EXISTS (SELECT 1 FROM funcionalidad WHERE codigo='limites_credito');
INSERT INTO funcionalidad (codigo, nombre, descripcion, activo, creadoEn, actualizadoEn)
SELECT 'seguimiento_cobranza', 'Seguimiento de cobranza', 'Historial de compromisos y acciones de cobranza.', 1,
       @fecha_local_instalacion, @fecha_local_instalacion
WHERE NOT EXISTS (SELECT 1 FROM funcionalidad WHERE codigo='seguimiento_cobranza');
INSERT INTO funcionalidad (codigo, nombre, descripcion, activo, creadoEn, actualizadoEn)
SELECT 'segmentacion_clientes', 'Segmentacion de clientes', 'Clasificaciones transparentes segun compras y pagos.', 1,
       @fecha_local_instalacion, @fecha_local_instalacion
WHERE NOT EXISTS (SELECT 1 FROM funcionalidad WHERE codigo='segmentacion_clientes');
INSERT INTO funcionalidad (codigo, nombre, descripcion, activo, creadoEn, actualizadoEn)
SELECT 'exportacion_clientes_fiados', 'Exportacion de clientes y fiados',
       'Exportacion administrativa de clientes, deudas y cobros.', 1,
       @fecha_local_instalacion, @fecha_local_instalacion
WHERE NOT EXISTS (SELECT 1 FROM funcionalidad WHERE codigo='exportacion_clientes_fiados');
-- COMPENSATION_FOUNDATION_FEATURE_START
INSERT INTO funcionalidad (codigo, nombre, descripcion, activo, creadoEn, actualizadoEn)
SELECT 'anulaciones_operativas', 'Anulaciones operativas',
       'Base protegida para operaciones compensatorias con trazabilidad.', 1,
       @fecha_local_instalacion, @fecha_local_instalacion
WHERE NOT EXISTS (SELECT 1 FROM funcionalidad WHERE codigo='anulaciones_operativas');
-- COMPENSATION_FOUNDATION_FEATURE_END

INSERT INTO planFuncionalidad (idPlan, idFuncionalidad, habilitada, creadoEn)
SELECT p.idPlan, f.idFuncionalidad, 1, @fecha_local_instalacion
FROM plan p
JOIN funcionalidad f ON f.activo=1
WHERE p.codigo='avanzado'
  AND NOT EXISTS (
    SELECT 1 FROM planFuncionalidad pf
    WHERE pf.idPlan=p.idPlan AND pf.idFuncionalidad=f.idFuncionalidad
  );

INSERT INTO planFuncionalidad (idPlan, idFuncionalidad, habilitada)
SELECT p.idPlan, f.idFuncionalidad, 1
FROM plan p
JOIN funcionalidad f ON f.codigo='catalogo_maestro'
WHERE p.codigo='basico'
  AND NOT EXISTS (
    SELECT 1 FROM planFuncionalidad pf
    WHERE pf.idPlan=p.idPlan AND pf.idFuncionalidad=f.idFuncionalidad
  );

INSERT INTO planFuncionalidad (idPlan, idFuncionalidad, habilitada)
SELECT p.idPlan, f.idFuncionalidad, 1
FROM plan p
JOIN funcionalidad f ON f.codigo IN ('historial_stock','ajuste_stock')
WHERE p.codigo IN ('basico','avanzado')
  AND NOT EXISTS (
    SELECT 1 FROM planFuncionalidad pf
    WHERE pf.idPlan=p.idPlan AND pf.idFuncionalidad=f.idFuncionalidad
  );

INSERT INTO planFuncionalidad (idPlan, idFuncionalidad, habilitada)
SELECT p.idPlan, f.idFuncionalidad, 1
FROM plan p
JOIN funcionalidad f ON f.codigo IN ('punto_venta','pagos_multiples','recibos_whatsapp')
WHERE p.codigo IN ('basico','avanzado')
  AND NOT EXISTS (
    SELECT 1 FROM planFuncionalidad pf
    WHERE pf.idPlan=p.idPlan AND pf.idFuncionalidad=f.idFuncionalidad
  );

INSERT INTO planFuncionalidad (idPlan, idFuncionalidad, habilitada)
SELECT p.idPlan, f.idFuncionalidad, 1
FROM plan p
JOIN funcionalidad f ON f.codigo IN ('gastos','reportes_financieros','exportacion_reportes','dashboard_financiero')
WHERE p.codigo IN ('basico','avanzado')
  AND NOT EXISTS (
    SELECT 1 FROM planFuncionalidad pf
    WHERE pf.idPlan=p.idPlan AND pf.idFuncionalidad=f.idFuncionalidad
  );

INSERT INTO planFuncionalidad (idPlan, idFuncionalidad, habilitada)
SELECT p.idPlan, f.idFuncionalidad, 1
FROM plan p
JOIN funcionalidad f ON f.codigo IN ('rentabilidad_producto','cierre_caja')
WHERE p.codigo='avanzado'
  AND NOT EXISTS (
    SELECT 1 FROM planFuncionalidad pf
    WHERE pf.idPlan=p.idPlan AND pf.idFuncionalidad=f.idFuncionalidad
  );

INSERT INTO planFuncionalidad (idPlan, idFuncionalidad, habilitada)
SELECT p.idPlan, f.idFuncionalidad, 1
FROM plan p
JOIN funcionalidad f ON f.codigo IN ('inventario_resumen','alertas_stock','ranking_productos','valor_inventario_basico')
WHERE p.codigo='basico'
  AND NOT EXISTS (
    SELECT 1 FROM planFuncionalidad pf
    WHERE pf.idPlan=p.idPlan AND pf.idFuncionalidad=f.idFuncionalidad
  );

INSERT INTO planFuncionalidad (idPlan, idFuncionalidad, habilitada, creadoEn)
SELECT p.idPlan, f.idFuncionalidad, 1, @fecha_local_instalacion
FROM plan p
JOIN funcionalidad f ON f.codigo IN ('clientes_basico','fiados_basico','pagos_fiado','estado_cuenta_basico')
WHERE p.codigo IN ('basico','avanzado')
  AND NOT EXISTS (
    SELECT 1 FROM planFuncionalidad pf
    WHERE pf.idPlan=p.idPlan AND pf.idFuncionalidad=f.idFuncionalidad
  );

-- COMPENSATION_FOUNDATION_PLAN_START
INSERT INTO planFuncionalidad (idPlan, idFuncionalidad, habilitada, creadoEn)
SELECT p.idPlan, f.idFuncionalidad, 1, @fecha_local_instalacion
FROM plan p
JOIN funcionalidad f ON f.codigo='anulaciones_operativas'
WHERE p.codigo IN ('basico','avanzado')
  AND NOT EXISTS (
    SELECT 1 FROM planFuncionalidad pf
    WHERE pf.idPlan=p.idPlan AND pf.idFuncionalidad=f.idFuncionalidad
  );
-- COMPENSATION_FOUNDATION_PLAN_END

INSERT INTO planFuncionalidad (idPlan, idFuncionalidad, habilitada, creadoEn)
SELECT p.idPlan, f.idFuncionalidad, 0, @fecha_local_instalacion
FROM plan p
JOIN funcionalidad f ON f.codigo IN (
  'limites_credito','seguimiento_cobranza','segmentacion_clientes',
  'exportacion_clientes_fiados','recordatorios_fiado'
)
WHERE p.codigo='basico'
  AND NOT EXISTS (
    SELECT 1 FROM planFuncionalidad pf
    WHERE pf.idPlan=p.idPlan AND pf.idFuncionalidad=f.idFuncionalidad
  );

INSERT INTO suscripcionTienda
  (idTienda, idPlan, tipo, estado, fechaInicio, fechaFin, renovacionAutomatica, observacion, creadoPor)
SELECT t.idTienda, p.idPlan, 'cortesia', 'activa', @fecha_local_instalacion,
       DATE_ADD(@fecha_local_instalacion, INTERVAL 3650 DAY), 0,
       'Suscripcion inicial de cortesia para conservar el acceso durante la migracion.', NULL
FROM tienda t
JOIN plan p ON p.codigo='avanzado'
WHERE NOT EXISTS (
  SELECT 1 FROM suscripcionTienda s WHERE s.idTienda=t.idTienda
);

CREATE TABLE IF NOT EXISTS categoriaMaestra (
  idCategoriaMaestra INT AUTO_INCREMENT PRIMARY KEY,
  nombre VARCHAR(100) NOT NULL,
  nombreNormalizado VARCHAR(120) NOT NULL,
  activo TINYINT(1) NOT NULL DEFAULT 1,
  creadoEn DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizadoEn DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT uq_categoriaMaestra_normalizada UNIQUE (nombreNormalizado),
  KEY idx_categoriaMaestra_activo_nombre (activo, nombre)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS marcaMaestra (
  idMarcaMaestra INT AUTO_INCREMENT PRIMARY KEY,
  nombre VARCHAR(100) NOT NULL,
  nombreNormalizado VARCHAR(120) NOT NULL,
  activo TINYINT(1) NOT NULL DEFAULT 1,
  creadoEn DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizadoEn DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT uq_marcaMaestra_normalizada UNIQUE (nombreNormalizado),
  KEY idx_marcaMaestra_activo_nombre (activo, nombre)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS productoMaestro (
  idProductoMaestro INT AUTO_INCREMENT PRIMARY KEY,
  nombre VARCHAR(160) NOT NULL,
  nombreNormalizado VARCHAR(180) NOT NULL,
  descripcion VARCHAR(500) NULL,
  idCategoriaMaestra INT NULL,
  idMarcaMaestra INT NULL,
  codigoBarras VARCHAR(64) NULL,
  presentacion VARCHAR(60) NULL,
  contenidoCantidad DECIMAL(10,3) NULL,
  contenidoUnidad VARCHAR(30) NULL,
  unidadesPorPaquete INT NOT NULL DEFAULT 1,
  permiteVentaPorUnidad TINYINT(1) NOT NULL DEFAULT 1,
  permiteVentaPorPaquete TINYINT(1) NOT NULL DEFAULT 0,
  huellaDuplicado CHAR(64) NOT NULL,
  activo TINYINT(1) NOT NULL DEFAULT 1,
  creadoEn DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizadoEn DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT uq_productoMaestro_codigoBarras UNIQUE (codigoBarras),
  KEY idx_productoMaestro_busqueda (activo, nombreNormalizado),
  KEY idx_productoMaestro_categoria (idCategoriaMaestra, activo),
  KEY idx_productoMaestro_marca (idMarcaMaestra, activo),
  KEY idx_productoMaestro_huella (huellaDuplicado),
  CONSTRAINT fk_productoMaestro_categoria FOREIGN KEY (idCategoriaMaestra)
    REFERENCES categoriaMaestra(idCategoriaMaestra) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_productoMaestro_marca FOREIGN KEY (idMarcaMaestra)
    REFERENCES marcaMaestra(idMarcaMaestra) ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS auditoriaCatalogo (
  idAuditoriaCatalogo BIGINT AUTO_INCREMENT PRIMARY KEY,
  idAdministrador INT NOT NULL,
  accion VARCHAR(40) NOT NULL,
  entidad VARCHAR(40) NOT NULL,
  idEntidad INT NULL,
  detalle JSON NULL,
  creadoEn DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_auditoriaCatalogo_admin_fecha (idAdministrador, creadoEn),
  KEY idx_auditoriaCatalogo_entidad (entidad, idEntidad, creadoEn),
  CONSTRAINT fk_auditoriaCatalogo_admin FOREIGN KEY (idAdministrador)
    REFERENCES administrador(idAdministrador) ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS cliente (
  idCliente INT AUTO_INCREMENT PRIMARY KEY,
  idTienda INT NULL,
  nombre VARCHAR(100) NOT NULL,
  telefono VARCHAR(30) NULL,
  direccion VARCHAR(255) NULL,
  telefonoAlternativo VARCHAR(30) NULL,
  telefonoNormalizado VARCHAR(30) NULL,
  documentoIdentidad VARCHAR(50) NULL,
  documentoNormalizado VARCHAR(50) NULL,
  correo VARCHAR(160) NULL,
  notas VARCHAR(1000) NULL,
  limiteCredito DECIMAL(12,2) NULL,
  permiteFiado TINYINT(1) NOT NULL DEFAULT 1,
  diasCreditoDefault INT NULL,
  canalPreferido ENUM('ninguno','whatsapp','telefono','correo','presencial') NOT NULL DEFAULT 'ninguno',
  aceptaRecordatorios TINYINT(1) NOT NULL DEFAULT 1,
  horarioPreferido VARCHAR(120) NULL,
  activo TINYINT(1) NOT NULL DEFAULT 1,
  eliminadoEn DATETIME NULL,
  creadoEn DATETIME NOT NULL,
  actualizadoEn DATETIME NOT NULL,
  idAdministradorCrea INT NULL,
  idAdministradorActualiza INT NULL,
  UNIQUE KEY uq_cliente_tienda_id (idTienda, idCliente),
  UNIQUE KEY uq_cliente_tienda_documento_normalizado (idTienda, documentoNormalizado),
  KEY idx_cliente_tienda_activo_nombre (idTienda, activo, nombre),
  KEY idx_cliente_tienda_telefono_normalizado (idTienda, telefonoNormalizado),
  KEY idx_cliente_tienda_permite_fiado_activo (idTienda, permiteFiado, activo),
  KEY idx_cliente_tienda_admin_crea (idTienda, idAdministradorCrea),
  KEY idx_cliente_tienda_admin_actualiza (idTienda, idAdministradorActualiza),
  CONSTRAINT chk_cliente_limite_credito CHECK (limiteCredito IS NULL OR limiteCredito>=0),
  CONSTRAINT chk_cliente_permite_fiado CHECK (permiteFiado IN (0,1)),
  CONSTRAINT chk_cliente_acepta_recordatorios CHECK (aceptaRecordatorios IN (0,1)),
  CONSTRAINT chk_cliente_dias_credito CHECK (
    diasCreditoDefault IS NULL OR diasCreditoDefault BETWEEN 1 AND 365
  ),
  CONSTRAINT chk_cliente_contacto_normalizado CHECK (
    (correo IS NULL OR CHAR_LENGTH(TRIM(correo))>0)
    AND (documentoNormalizado IS NULL OR CHAR_LENGTH(TRIM(documentoNormalizado))>0)
    AND (telefonoNormalizado IS NULL OR CHAR_LENGTH(TRIM(telefonoNormalizado))>0)
  ),
  CONSTRAINT fk_cliente_tienda FOREIGN KEY (idTienda) REFERENCES tienda(idTienda),
  CONSTRAINT fk_cliente_admin_crea FOREIGN KEY (idTienda, idAdministradorCrea)
    REFERENCES administrador(idTienda, idAdministrador) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_cliente_admin_actualiza FOREIGN KEY (idTienda, idAdministradorActualiza)
    REFERENCES administrador(idTienda, idAdministrador) ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB;

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
  PRIMARY KEY (idTienda),
  KEY idx_configCredito_tienda_admin (idTienda, idAdministradorActualiza),
  CONSTRAINT chk_configCredito_limite CHECK (
    limiteCreditoDefault IS NULL OR limiteCreditoDefault>=0
  ),
  CONSTRAINT chk_configCredito_dias CHECK (
    diasCreditoDefault BETWEEN 1 AND 365 AND diasAvisoVencimiento BETWEEN 0 AND 90
  ),
  CONSTRAINT chk_configCredito_booleanos CHECK (
    requiereTelefonoParaFiado IN (0,1) AND permiteFiadoSinFecha IN (0,1)
  ),
  CONSTRAINT chk_configCredito_codigo_pais CHECK (
    codigoPaisWhatsApp IS NULL OR codigoPaisWhatsApp REGEXP '^[0-9]{1,8}$'
  ),
  CONSTRAINT fk_configCredito_tienda FOREIGN KEY (idTienda)
    REFERENCES tienda(idTienda) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_configCredito_administrador FOREIGN KEY (idTienda, idAdministradorActualiza)
    REFERENCES administrador(idTienda, idAdministrador) ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB;

INSERT INTO configuracionCreditoTienda
  (idTienda, limiteCreditoDefault, diasCreditoDefault, diasAvisoVencimiento,
   politicaFiadoVencido, requiereTelefonoParaFiado, permiteFiadoSinFecha,
   codigoPaisWhatsApp, creadoEn, actualizadoEn, idAdministradorActualiza)
SELECT t.idTienda, NULL, 30, 3, 'advertir', 0, 1, NULL,
       @fecha_local_instalacion, @fecha_local_instalacion, NULL
FROM tienda t
WHERE NOT EXISTS (
  SELECT 1 FROM configuracionCreditoTienda c WHERE c.idTienda=t.idTienda
);

CREATE TABLE IF NOT EXISTS proveedor (
  idProveedor INT AUTO_INCREMENT PRIMARY KEY,
  idTienda INT NULL,
  nombre VARCHAR(100) NOT NULL,
  telefono VARCHAR(30) NULL,
  direccion VARCHAR(150) NULL,
  UNIQUE KEY uq_proveedor_tienda_id (idTienda, idProveedor),
  KEY idx_proveedor_tienda_nombre (idTienda, nombre),
  CONSTRAINT fk_proveedor_tienda FOREIGN KEY (idTienda) REFERENCES tienda(idTienda)
);

CREATE TABLE IF NOT EXISTS producto (
  idProducto INT AUTO_INCREMENT PRIMARY KEY,
  idTienda INT NULL,
  nombre VARCHAR(100) NOT NULL,
  idProveedor INT NULL,
  idProductoMaestro INT NULL,
  codigoBarras VARCHAR(64) NULL,
  categoria VARCHAR(50) NOT NULL DEFAULT 'otros',
  unidadMedida ENUM('unidad','paquete','kilo','gramo','litro','mililitro','caja','docena','bolsa') NOT NULL DEFAULT 'unidad',
  unidadesPorPaquete INT NOT NULL DEFAULT 1,
  paquetesPorCaja INT NOT NULL DEFAULT 1,
  precioVenta DECIMAL(10,2) NOT NULL,
  precioVentaPaquete DECIMAL(10,2) NULL,
  stock INT NOT NULL DEFAULT 0,
  stockMinimo INT NOT NULL DEFAULT 5,
  controlaLotes TINYINT(1) NOT NULL DEFAULT 0,
  controlaVencimiento TINYINT(1) NOT NULL DEFAULT 0,
  diasAlertaVencimiento INT NULL,
  lotesActivadosEn DATETIME NULL,
  diasReposicion INT NULL,
  diasCoberturaObjetivo INT NULL,
  presentacionCompraSugerida ENUM('unidad','paquete') NULL,
  fechaInicioSeguimiento DATETIME NOT NULL,
  stockUnidadesTotal INT NOT NULL DEFAULT 0,
  ultimoPrecioCompra DECIMAL(14,6) NOT NULL DEFAULT 0,
  permiteVentaPorPaquete BOOLEAN NOT NULL DEFAULT TRUE,
  permiteVentaPorUnidad BOOLEAN NOT NULL DEFAULT TRUE,
  favoritoPos TINYINT(1) NOT NULL DEFAULT 0,
  activo TINYINT(1) NOT NULL DEFAULT 1,
  eliminadoEn DATETIME NULL,
  UNIQUE KEY uq_producto_tienda_id (idTienda, idProducto),
  KEY idx_producto_tienda_proveedor (idTienda, idProveedor),
  KEY idx_producto_tienda_categoria_nombre (idTienda, categoria, nombre),
  KEY idx_producto_tienda_activo_nombre (idTienda, activo, nombre),
  KEY idx_producto_tienda_inventario (idTienda, activo, stockUnidadesTotal, stockMinimo),
  KEY idx_producto_tienda_categoria_activo (idTienda, categoria, activo),
  KEY idx_producto_tienda_proveedor_activo (idTienda, idProveedor, activo),
  KEY idx_producto_tienda_seguimiento (idTienda, fechaInicioSeguimiento),
  UNIQUE KEY uq_producto_tienda_codigoBarras (idTienda, codigoBarras),
  KEY idx_producto_tienda_favorito_nombre (idTienda, favoritoPos, activo, nombre),
  KEY idx_producto_productoMaestro (idProductoMaestro),
  UNIQUE KEY uq_producto_tienda_maestro (idTienda, idProductoMaestro),
  CONSTRAINT fk_producto_tienda FOREIGN KEY (idTienda) REFERENCES tienda(idTienda),
  CONSTRAINT fk_producto_proveedor FOREIGN KEY (idProveedor) REFERENCES proveedor(idProveedor),
  CONSTRAINT fk_producto_tienda_proveedor FOREIGN KEY (idTienda, idProveedor) REFERENCES proveedor(idTienda, idProveedor),
  CONSTRAINT chk_producto_dias_reposicion CHECK (diasReposicion IS NULL OR diasReposicion BETWEEN 0 AND 365),
  CONSTRAINT chk_producto_dias_cobertura CHECK (diasCoberturaObjetivo IS NULL OR diasCoberturaObjetivo BETWEEN 1 AND 365),
  CONSTRAINT chk_producto_controla_lotes CHECK (controlaLotes IN (0,1)),
  CONSTRAINT chk_producto_controla_vencimiento CHECK (controlaVencimiento IN (0,1)),
  CONSTRAINT chk_producto_vencimiento_requiere_lotes CHECK (controlaVencimiento=0 OR controlaLotes=1),
  CONSTRAINT chk_producto_dias_alerta_vencimiento CHECK (
    diasAlertaVencimiento IS NULL OR diasAlertaVencimiento BETWEEN 1 AND 365
  ),
  CONSTRAINT chk_producto_lotes_activacion CHECK (
    (controlaLotes=0 AND lotesActivadosEn IS NULL)
    OR (controlaLotes=1 AND lotesActivadosEn IS NOT NULL)
  ),
  CONSTRAINT fk_producto_productoMaestro FOREIGN KEY (idProductoMaestro)
    REFERENCES productoMaestro(idProductoMaestro) ON UPDATE CASCADE ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS configuracionInventarioTienda (
  idTienda INT NOT NULL PRIMARY KEY,
  periodoAnalisisDias INT NOT NULL DEFAULT 30,
  diasHistorialMinimo INT NOT NULL DEFAULT 14,
  diasReposicionDefault INT NOT NULL DEFAULT 3,
  diasCoberturaDefault INT NOT NULL DEFAULT 14,
  diasProductoNuevo INT NOT NULL DEFAULT 30,
  diasAlertaVencimientoDefault INT NOT NULL DEFAULT 30,
  creadoEn DATETIME NOT NULL,
  actualizadoEn DATETIME NOT NULL,
  idAdministradorActualiza INT NULL,
  KEY idx_configInventario_tienda_admin (idTienda, idAdministradorActualiza),
  CONSTRAINT chk_configInventario_periodos CHECK (
    periodoAnalisisDias BETWEEN 7 AND 365
    AND diasHistorialMinimo BETWEEN 1 AND periodoAnalisisDias
  ),
  CONSTRAINT chk_configInventario_reposicion CHECK (diasReposicionDefault BETWEEN 0 AND 365),
  CONSTRAINT chk_configInventario_cobertura CHECK (diasCoberturaDefault BETWEEN 1 AND 365),
  CONSTRAINT chk_configInventario_producto_nuevo CHECK (diasProductoNuevo BETWEEN 1 AND 365),
  CONSTRAINT chk_configInventario_alerta_vencimiento CHECK (
    diasAlertaVencimientoDefault BETWEEN 1 AND 365
  ),
  CONSTRAINT fk_configInventario_tienda FOREIGN KEY (idTienda)
    REFERENCES tienda(idTienda) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_configInventario_administrador FOREIGN KEY (idTienda, idAdministradorActualiza)
    REFERENCES administrador(idTienda, idAdministrador) ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS venta (
  idVenta INT AUTO_INCREMENT PRIMARY KEY,
  idTienda INT NULL,
  fecha DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  subtotal DECIMAL(10,2) NOT NULL DEFAULT 0,
  descuento DECIMAL(10,2) NOT NULL DEFAULT 0,
  total DECIMAL(10,2) NOT NULL,
  montoPagado DECIMAL(10,2) NOT NULL DEFAULT 0,
  saldoPendiente DECIMAL(10,2) NOT NULL DEFAULT 0,
  estadoPago ENUM('pagada','parcial','pendiente','legado') NOT NULL DEFAULT 'legado',
  -- COMPENSATION_FOUNDATION_SALE_COLUMN_START
  estadoOperacion ENUM('vigente','devuelta_parcial','anulada') NOT NULL DEFAULT 'vigente',
  -- COMPENSATION_FOUNDATION_SALE_COLUMN_END
  tipo ENUM('pagada','fiada') NOT NULL DEFAULT 'pagada',
  idCliente INT NULL,
  claveOperacion VARCHAR(64) NULL,
  codigoComprobante VARCHAR(40) NULL,
  UNIQUE KEY uq_venta_tienda_id (idTienda, idVenta),
  UNIQUE KEY uq_venta_tienda_claveOperacion (idTienda, claveOperacion),
  UNIQUE KEY uq_venta_tienda_comprobante (idTienda, codigoComprobante),
  KEY idx_venta_tienda_fecha (idTienda, fecha),
  KEY idx_venta_tienda_cliente (idTienda, idCliente),
  KEY idx_venta_tienda_estado_fecha (idTienda, estadoPago, fecha),
  -- COMPENSATION_FOUNDATION_SALE_INDEX_START
  KEY idx_venta_tienda_estado_operacion_fecha
    (idTienda, estadoOperacion, fecha, idVenta),
  -- COMPENSATION_FOUNDATION_SALE_INDEX_END
  CONSTRAINT chk_venta_totales_pos CHECK (
    subtotal >= 0 AND descuento >= 0 AND total >= 0 AND descuento <= subtotal
    AND ABS((subtotal - descuento) - total) < 0.01
  ),
  CONSTRAINT chk_venta_saldo_pos CHECK (
    montoPagado >= 0 AND saldoPendiente >= 0
    AND (estadoPago = 'legado' OR ABS((montoPagado + saldoPendiente) - total) < 0.01)
  ),
  CONSTRAINT chk_venta_estado_pos CHECK (
    estadoPago = 'legado'
    OR (estadoPago = 'pagada' AND saldoPendiente = 0 AND montoPagado = total)
    OR (estadoPago = 'parcial' AND montoPagado > 0 AND saldoPendiente > 0)
    OR (estadoPago = 'pendiente' AND montoPagado = 0 AND saldoPendiente = total AND total > 0)
  ),
  -- COMPENSATION_FOUNDATION_SALE_CHECK_START
  CONSTRAINT chk_venta_estado_operacion CHECK (
    estadoOperacion IN ('vigente','devuelta_parcial','anulada')
  ),
  -- COMPENSATION_FOUNDATION_SALE_CHECK_END
  CONSTRAINT fk_venta_tienda FOREIGN KEY (idTienda) REFERENCES tienda(idTienda),
  CONSTRAINT fk_venta_cliente FOREIGN KEY (idCliente) REFERENCES cliente(idCliente),
  CONSTRAINT fk_venta_tienda_cliente FOREIGN KEY (idTienda, idCliente) REFERENCES cliente(idTienda, idCliente)
);

-- COMPENSATION_FOUNDATION_TABLE_START
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
  PRIMARY KEY (idOperacionCompensatoria),
  UNIQUE KEY uq_operacionCompensatoria_tienda_id
    (idTienda, idOperacionCompensatoria),
  UNIQUE KEY uq_operacionCompensatoria_tienda_clave
    (idTienda, claveOperacion),
  KEY idx_operacionCompensatoria_tienda_tipo_estado
    (idTienda, tipoOperacion, estado),
  KEY idx_operacionCompensatoria_tienda_fecha
    (idTienda, fechaSolicitud, idOperacionCompensatoria),
  KEY idx_operacionCompensatoria_tienda_solicitante
    (idTienda, idAdministradorSolicitante, fechaSolicitud),
  KEY idx_operacionCompensatoria_tienda_aprobador
    (idTienda, idAdministradorAprobador, fechaAprobacion),
  CONSTRAINT chk_operacionCompensatoria_aprobacion
    CHECK (requiereAprobacion IN (0,1)),
  CONSTRAINT chk_operacionCompensatoria_clave
    CHECK (
      CHAR_LENGTH(claveOperacion) BETWEEN 1 AND 160
      AND CONVERT(claveOperacion USING utf8mb4)
        REGEXP '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
    ),
  CONSTRAINT chk_operacionCompensatoria_huella
    CHECK (
      CONVERT(huellaSolicitud USING utf8mb4) REGEXP '^[0-9A-Fa-f]{64}$'
      AND huellaSolicitud=LOWER(huellaSolicitud)
    ),
  CONSTRAINT chk_operacionCompensatoria_motivo
    CHECK (
      motivoCodigo<>'otro_controlado'
      OR (observacion IS NOT NULL AND CHAR_LENGTH(TRIM(observacion))>=8)
    ),
  CONSTRAINT chk_operacionCompensatoria_fechas
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
    ),
  CONSTRAINT fk_operacionCompensatoria_tienda FOREIGN KEY (idTienda)
    REFERENCES tienda(idTienda) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_operacionCompensatoria_solicitante
    FOREIGN KEY (idTienda, idAdministradorSolicitante)
    REFERENCES administrador(idTienda, idAdministrador)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_operacionCompensatoria_aprobador
    FOREIGN KEY (idTienda, idAdministradorAprobador)
    REFERENCES administrador(idTienda, idAdministrador)
    ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB;
-- COMPENSATION_FOUNDATION_TABLE_END

CREATE TABLE IF NOT EXISTS detalleVenta (
  idDetalleVenta INT AUTO_INCREMENT PRIMARY KEY,
  idTienda INT NULL,
  idVenta INT NOT NULL,
  idProducto INT NOT NULL,
  cantidad DECIMAL(10,2) NOT NULL,
  precioVenta DECIMAL(10,2) NOT NULL,
  costoUnitario DECIMAL(14,6) NOT NULL DEFAULT 0,
  subtotal DECIMAL(10,2) NOT NULL,
  subtotalCosto DECIMAL(10,2) NOT NULL DEFAULT 0,
  ganancia DECIMAL(10,2) NOT NULL DEFAULT 0,
  origenCosto ENUM('real','estimado','desconocido') NOT NULL DEFAULT 'desconocido',
  presentacionVenta VARCHAR(30) NOT NULL DEFAULT 'unidad',
  cantidadEquivalenteUnidades INT NOT NULL DEFAULT 0,
  UNIQUE KEY uq_detalleVenta_tienda_id (idTienda, idDetalleVenta),
  KEY idx_detalleVenta_tienda_venta (idTienda, idVenta),
  KEY idx_detalleVenta_tienda_producto (idTienda, idProducto),
  KEY idx_detalleVenta_tienda_producto_venta (idTienda, idProducto, idVenta),
  CONSTRAINT fk_detalleVenta_tienda FOREIGN KEY (idTienda) REFERENCES tienda(idTienda),
  CONSTRAINT fk_detalleVenta_venta FOREIGN KEY (idVenta) REFERENCES venta(idVenta),
  CONSTRAINT fk_detalleVenta_producto FOREIGN KEY (idProducto) REFERENCES producto(idProducto),
  CONSTRAINT fk_detalleVenta_tienda_venta FOREIGN KEY (idTienda, idVenta) REFERENCES venta(idTienda, idVenta),
  CONSTRAINT fk_detalleVenta_tienda_producto FOREIGN KEY (idTienda, idProducto) REFERENCES producto(idTienda, idProducto)
);

CREATE TABLE IF NOT EXISTS compra (
  idCompra INT AUTO_INCREMENT PRIMARY KEY,
  idTienda INT NULL,
  fecha DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  total DECIMAL(10,2) NOT NULL,
  idProveedor INT NULL,
  claveOperacion VARCHAR(64) NULL,
  UNIQUE KEY uq_compra_tienda_id (idTienda, idCompra),
  UNIQUE KEY uq_compra_tienda_claveOperacion (idTienda, claveOperacion),
  KEY idx_compra_tienda_fecha (idTienda, fecha),
  KEY idx_compra_tienda_proveedor (idTienda, idProveedor),
  CONSTRAINT fk_compra_tienda FOREIGN KEY (idTienda) REFERENCES tienda(idTienda),
  CONSTRAINT fk_compra_proveedor FOREIGN KEY (idProveedor) REFERENCES proveedor(idProveedor),
  CONSTRAINT fk_compra_tienda_proveedor FOREIGN KEY (idTienda, idProveedor) REFERENCES proveedor(idTienda, idProveedor)
);

CREATE TABLE IF NOT EXISTS detalleCompra (
  idDetalleCompra INT AUTO_INCREMENT PRIMARY KEY,
  idTienda INT NULL,
  idCompra INT NOT NULL,
  idProducto INT NOT NULL,
  cantidad DECIMAL(10,2) NOT NULL,
  precioCompra DECIMAL(10,2) NOT NULL,
  subtotal DECIMAL(10,2) NOT NULL,
  presentacionCompra VARCHAR(30) NOT NULL DEFAULT 'unidad',
  cantidadEquivalenteUnidades INT NOT NULL DEFAULT 0,
  UNIQUE KEY uq_detalleCompra_tienda_id (idTienda, idDetalleCompra),
  UNIQUE KEY uq_detalleCompra_tienda_producto_id (idTienda, idProducto, idDetalleCompra),
  KEY idx_detalleCompra_tienda_compra (idTienda, idCompra),
  KEY idx_detalleCompra_tienda_producto (idTienda, idProducto),
  KEY idx_detalleCompra_tienda_producto_compra (idTienda, idProducto, idCompra),
  CONSTRAINT fk_detalleCompra_tienda FOREIGN KEY (idTienda) REFERENCES tienda(idTienda),
  CONSTRAINT fk_detalleCompra_compra FOREIGN KEY (idCompra) REFERENCES compra(idCompra),
  CONSTRAINT fk_detalleCompra_producto FOREIGN KEY (idProducto) REFERENCES producto(idProducto),
  CONSTRAINT fk_detalleCompra_tienda_compra FOREIGN KEY (idTienda, idCompra) REFERENCES compra(idTienda, idCompra),
  CONSTRAINT fk_detalleCompra_tienda_producto FOREIGN KEY (idTienda, idProducto) REFERENCES producto(idTienda, idProducto)
);

CREATE TABLE IF NOT EXISTS fiado (
  idFiado INT AUTO_INCREMENT PRIMARY KEY,
  idTienda INT NULL,
  idCliente INT NOT NULL,
  idVenta INT NULL,
  fechaInicio DATE NOT NULL,
  fechaVencimiento DATE NULL,
  fechaPrometidaPago DATE NULL,
  observacionCredito VARCHAR(1000) NULL,
  totalFiado DECIMAL(10,2) NOT NULL DEFAULT 0,
  totalPagado DECIMAL(10,2) NOT NULL DEFAULT 0,
  saldoPendiente DECIMAL(10,2) NOT NULL DEFAULT 0,
  estado ENUM('pendiente','parcial','pagado') NOT NULL DEFAULT 'pendiente',
  activo TINYINT(1) NOT NULL DEFAULT 1,
  eliminadoEn DATETIME NULL,
  cerradoEn DATETIME NULL,
  idAdministradorCrea INT NULL,
  UNIQUE KEY uq_fiado_tienda_id (idTienda, idFiado),
  UNIQUE KEY uq_fiado_tienda_cliente_id (idTienda, idCliente, idFiado),
  UNIQUE KEY uq_fiado_tienda_venta_unica (idTienda, idVenta),
  KEY idx_fiado_tienda_estado_fecha (idTienda, activo, estado, fechaInicio),
  KEY idx_fiado_tienda_cliente (idTienda, idCliente),
  KEY idx_fiado_tienda_venta (idTienda, idVenta),
  KEY idx_fiado_tienda_cliente_saldo (idTienda, idCliente, saldoPendiente),
  KEY idx_fiado_tienda_vencimiento_saldo (idTienda, fechaVencimiento, saldoPendiente),
  KEY idx_fiado_tienda_promesa_saldo (idTienda, fechaPrometidaPago, saldoPendiente),
  KEY idx_fiado_tienda_estado_activo (idTienda, estado, activo),
  KEY idx_fiado_tienda_admin_crea (idTienda, idAdministradorCrea),
  CONSTRAINT chk_fiado_cierre_credito CHECK (
    (saldoPendiente>0 AND cerradoEn IS NULL)
    OR (saldoPendiente=0 AND cerradoEn IS NOT NULL)
  ),
  CONSTRAINT fk_fiado_tienda FOREIGN KEY (idTienda) REFERENCES tienda(idTienda),
  CONSTRAINT fk_fiado_cliente FOREIGN KEY (idCliente) REFERENCES cliente(idCliente),
  CONSTRAINT fk_fiado_venta FOREIGN KEY (idVenta) REFERENCES venta(idVenta),
  CONSTRAINT fk_fiado_tienda_cliente FOREIGN KEY (idTienda, idCliente) REFERENCES cliente(idTienda, idCliente),
  CONSTRAINT fk_fiado_tienda_venta FOREIGN KEY (idTienda, idVenta) REFERENCES venta(idTienda, idVenta),
  CONSTRAINT fk_fiado_admin_crea FOREIGN KEY (idTienda, idAdministradorCrea)
    REFERENCES administrador(idTienda, idAdministrador) ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB;

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
  PRIMARY KEY (idCobroFiado),
  UNIQUE KEY uq_cobroFiado_tienda_id (idTienda, idCobroFiado),
  UNIQUE KEY uq_cobroFiado_tienda_clave (idTienda, claveOperacion),
  KEY idx_cobroFiado_tienda_cliente_fecha (idTienda, idCliente, fechaCobro),
  KEY idx_cobroFiado_tienda_fecha_metodo (idTienda, fechaCobro, metodoPago),
  KEY idx_cobroFiado_tienda_admin_fecha (idTienda, idAdministrador, fechaCobro),
  CONSTRAINT chk_cobroFiado_monto CHECK (montoTotal>0),
  CONSTRAINT chk_cobroFiado_cambio CHECK (
    cambio>=0
    AND (
      (montoRecibido IS NULL AND cambio=0)
      OR (montoRecibido IS NOT NULL AND montoRecibido>=montoTotal
          AND ABS((montoRecibido-montoTotal)-cambio)<0.01)
    )
  ),
  CONSTRAINT chk_cobroFiado_legado CHECK (esLegado IN (0,1)),
  CONSTRAINT fk_cobroFiado_tienda FOREIGN KEY (idTienda)
    REFERENCES tienda(idTienda) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_cobroFiado_cliente FOREIGN KEY (idTienda, idCliente)
    REFERENCES cliente(idTienda, idCliente) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_cobroFiado_administrador FOREIGN KEY (idTienda, idAdministrador)
    REFERENCES administrador(idTienda, idAdministrador) ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS detalleFiado (
  idDetalleFiado INT AUTO_INCREMENT PRIMARY KEY,
  idTienda INT NULL,
  idFiado INT NOT NULL,
  idProducto INT NOT NULL,
  cantidad DECIMAL(10,2) NOT NULL,
  precio DECIMAL(10,2) NOT NULL,
  subtotal DECIMAL(10,2) NOT NULL,
  KEY idx_detalleFiado_tienda_fiado (idTienda, idFiado),
  KEY idx_detalleFiado_tienda_producto (idTienda, idProducto),
  CONSTRAINT fk_detalleFiado_tienda FOREIGN KEY (idTienda) REFERENCES tienda(idTienda),
  CONSTRAINT fk_detalleFiado_fiado FOREIGN KEY (idFiado) REFERENCES fiado(idFiado),
  CONSTRAINT fk_detalleFiado_producto FOREIGN KEY (idProducto) REFERENCES producto(idProducto),
  CONSTRAINT fk_detalleFiado_tienda_fiado FOREIGN KEY (idTienda, idFiado) REFERENCES fiado(idTienda, idFiado),
  CONSTRAINT fk_detalleFiado_tienda_producto FOREIGN KEY (idTienda, idProducto) REFERENCES producto(idTienda, idProducto)
);

CREATE TABLE IF NOT EXISTS pagoFiado (
  idPagoFiado INT AUTO_INCREMENT PRIMARY KEY,
  idTienda INT NULL,
  idFiado INT NOT NULL,
  idCobroFiado BIGINT NOT NULL,
  fechaPago DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  monto DECIMAL(10,2) NOT NULL,
  observacion VARCHAR(150) NULL,
  claveDistribucion VARCHAR(160) NOT NULL,
  UNIQUE KEY uq_pagoFiado_tienda_id (idTienda, idPagoFiado),
  UNIQUE KEY uq_pagoFiado_tienda_clave_distribucion (idTienda, claveDistribucion),
  KEY idx_pagoFiado_tienda_fiado (idTienda, idFiado),
  KEY idx_pagoFiado_tienda_cobro_fiado (idTienda, idCobroFiado, idFiado),
  CONSTRAINT fk_pagoFiado_tienda FOREIGN KEY (idTienda) REFERENCES tienda(idTienda),
  CONSTRAINT fk_pagoFiado_fiado FOREIGN KEY (idFiado) REFERENCES fiado(idFiado),
  CONSTRAINT fk_pagoFiado_tienda_fiado FOREIGN KEY (idTienda, idFiado) REFERENCES fiado(idTienda, idFiado),
  CONSTRAINT fk_pagoFiado_cobro FOREIGN KEY (idTienda, idCobroFiado)
    REFERENCES cobroFiado(idTienda, idCobroFiado) ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS pagoVenta (
  idPagoVenta BIGINT AUTO_INCREMENT PRIMARY KEY,
  idTienda INT NOT NULL,
  idVenta INT NOT NULL,
  idPagoFiado INT NULL,
  metodoPago ENUM('efectivo','qr','no_especificado') NOT NULL,
  monto DECIMAL(10,2) NOT NULL,
  montoRecibido DECIMAL(10,2) NULL,
  cambio DECIMAL(10,2) NOT NULL DEFAULT 0,
  referencia VARCHAR(120) NULL,
  claveOperacion VARCHAR(160) NOT NULL,
  idAdministrador INT NULL,
  creadoEn DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_pagoVenta_tienda_clave (idTienda, claveOperacion),
  UNIQUE KEY uq_pagoVenta_tienda_pagoFiado (idTienda, idPagoFiado),
  KEY idx_pagoVenta_tienda_venta (idTienda, idVenta, creadoEn),
  KEY idx_pagoVenta_tienda_metodo_fecha (idTienda, metodoPago, creadoEn),
  KEY idx_pagoVenta_tienda_admin_fecha (idTienda, idAdministrador, creadoEn),
  CONSTRAINT chk_pagoVenta_monto CHECK (monto > 0),
  CONSTRAINT chk_pagoVenta_metodo CHECK (metodoPago IN ('efectivo','qr','no_especificado')),
  CONSTRAINT chk_pagoVenta_efectivo CHECK (
    (metodoPago='efectivo' AND montoRecibido IS NOT NULL AND montoRecibido>=monto AND ABS((montoRecibido-monto)-cambio)<0.01)
    OR (metodoPago<>'efectivo' AND montoRecibido IS NULL AND cambio=0)
  ),
  CONSTRAINT fk_pagoVenta_tienda FOREIGN KEY (idTienda)
    REFERENCES tienda(idTienda) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_pagoVenta_venta FOREIGN KEY (idTienda, idVenta)
    REFERENCES venta(idTienda, idVenta) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_pagoVenta_pagoFiado FOREIGN KEY (idTienda, idPagoFiado)
    REFERENCES pagoFiado(idTienda, idPagoFiado) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_pagoVenta_administrador FOREIGN KEY (idTienda, idAdministrador)
    REFERENCES administrador(idTienda, idAdministrador) ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB;

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
  PRIMARY KEY (idSeguimientoCobranza),
  KEY idx_seguimientoCobranza_tienda_cliente_fecha (idTienda, idCliente, creadoEn),
  KEY idx_seguimientoCobranza_tienda_fiado_fecha (idTienda, idFiado, creadoEn),
  KEY idx_seguimientoCobranza_tienda_tipo_fecha (idTienda, tipo, creadoEn),
  KEY idx_seguimientoCobranza_tienda_compromiso (idTienda, fechaCompromiso),
  KEY idx_seguimientoCobranza_tienda_admin (idTienda, idAdministrador),
  CONSTRAINT chk_seguimientoCobranza_detalle CHECK (CHAR_LENGTH(TRIM(detalle))>0),
  CONSTRAINT chk_seguimientoCobranza_compromiso CHECK (
    tipo<>'compromiso_pago' OR fechaCompromiso IS NOT NULL
  ),
  CONSTRAINT fk_seguimientoCobranza_tienda FOREIGN KEY (idTienda)
    REFERENCES tienda(idTienda) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_seguimientoCobranza_cliente FOREIGN KEY (idTienda, idCliente)
    REFERENCES cliente(idTienda, idCliente) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_seguimientoCobranza_fiado FOREIGN KEY (idTienda, idCliente, idFiado)
    REFERENCES fiado(idTienda, idCliente, idFiado) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_seguimientoCobranza_administrador FOREIGN KEY (idTienda, idAdministrador)
    REFERENCES administrador(idTienda, idAdministrador) ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB;

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
  PRIMARY KEY (idPlantillaCobranza),
  UNIQUE KEY uq_plantillaCobranza_tienda_tipo_nombre (idTienda, tipo, nombre),
  KEY idx_plantillaCobranza_tienda_activo_tipo (idTienda, activo, tipo),
  KEY idx_plantillaCobranza_tienda_admin (idTienda, idAdministradorActualiza),
  CONSTRAINT chk_plantillaCobranza_texto CHECK (
    CHAR_LENGTH(TRIM(nombre))>0 AND CHAR_LENGTH(TRIM(contenido))>0
  ),
  CONSTRAINT chk_plantillaCobranza_activo CHECK (activo IN (0,1)),
  CONSTRAINT fk_plantillaCobranza_tienda FOREIGN KEY (idTienda)
    REFERENCES tienda(idTienda) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_plantillaCobranza_administrador FOREIGN KEY (idTienda, idAdministradorActualiza)
    REFERENCES administrador(idTienda, idAdministrador) ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB;

INSERT INTO plantillaCobranzaTienda
  (idTienda, tipo, nombre, contenido, activo, creadoEn, actualizadoEn, idAdministradorActualiza)
SELECT t.idTienda, plantillas.tipo, plantillas.nombre, plantillas.contenido,
       1, @fecha_local_instalacion, @fecha_local_instalacion, NULL
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

CREATE TABLE IF NOT EXISTS categoriaGasto (
  idCategoriaGasto INT AUTO_INCREMENT PRIMARY KEY,
  idTienda INT NOT NULL,
  nombre VARCHAR(100) NOT NULL,
  nombreNormalizado VARCHAR(120) NOT NULL,
  descripcion VARCHAR(255) NULL,
  activo TINYINT(1) NOT NULL DEFAULT 1,
  creadoEn DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizadoEn DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_categoriaGasto_tienda_id (idTienda, idCategoriaGasto),
  UNIQUE KEY uq_categoriaGasto_tienda_normalizada (idTienda, nombreNormalizado),
  KEY idx_categoriaGasto_tienda_activo_nombre (idTienda, activo, nombre),
  CONSTRAINT fk_categoriaGasto_tienda FOREIGN KEY (idTienda)
    REFERENCES tienda(idTienda) ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS gasto (
  idGasto BIGINT AUTO_INCREMENT PRIMARY KEY,
  idTienda INT NOT NULL,
  idCategoriaGasto INT NOT NULL,
  idAdministrador INT NOT NULL,
  idAdministradorModifica INT NULL,
  idAdministradorAnula INT NULL,
  fechaGasto DATETIME NOT NULL,
  concepto VARCHAR(160) NOT NULL,
  monto DECIMAL(12,2) NOT NULL,
  metodoPago ENUM('efectivo','qr','transferencia','otro') NOT NULL,
  referencia VARCHAR(120) NULL,
  observacion VARCHAR(500) NULL,
  recurrente TINYINT(1) NOT NULL DEFAULT 0,
  estado ENUM('registrado','anulado') NOT NULL DEFAULT 'registrado',
  motivoAnulacion VARCHAR(300) NULL,
  creadoEn DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizadoEn DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  anuladoEn DATETIME NULL,
  UNIQUE KEY uq_gasto_tienda_id (idTienda, idGasto),
  KEY idx_gasto_tienda_fecha_estado (idTienda, fechaGasto, estado),
  KEY idx_gasto_tienda_categoria_fecha (idTienda, idCategoriaGasto, fechaGasto),
  KEY idx_gasto_tienda_metodo_fecha (idTienda, metodoPago, fechaGasto),
  CONSTRAINT chk_gasto_monto CHECK (monto > 0),
  CONSTRAINT chk_gasto_estado CHECK (
    (estado='registrado' AND anuladoEn IS NULL AND idAdministradorAnula IS NULL AND motivoAnulacion IS NULL)
    OR (estado='anulado' AND anuladoEn IS NOT NULL AND idAdministradorAnula IS NOT NULL AND motivoAnulacion IS NOT NULL)
  ),
  CONSTRAINT fk_gasto_tienda FOREIGN KEY (idTienda)
    REFERENCES tienda(idTienda) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_gasto_categoria FOREIGN KEY (idTienda, idCategoriaGasto)
    REFERENCES categoriaGasto(idTienda, idCategoriaGasto) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_gasto_creador FOREIGN KEY (idTienda, idAdministrador)
    REFERENCES administrador(idTienda, idAdministrador) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_gasto_modificador FOREIGN KEY (idTienda, idAdministradorModifica)
    REFERENCES administrador(idTienda, idAdministrador) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_gasto_anulador FOREIGN KEY (idTienda, idAdministradorAnula)
    REFERENCES administrador(idTienda, idAdministrador) ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS cierreCaja (
  idCierreCaja BIGINT AUTO_INCREMENT PRIMARY KEY,
  idTienda INT NOT NULL,
  idAdministrador INT NOT NULL,
  idAdministradorAnula INT NULL,
  fechaInicio DATETIME NOT NULL,
  fechaFin DATETIME NOT NULL,
  efectivoInicial DECIMAL(12,2) NOT NULL DEFAULT 0,
  efectivoVentasEsperado DECIMAL(12,2) NOT NULL DEFAULT 0,
  efectivoFiadosCobrado DECIMAL(12,2) NOT NULL DEFAULT 0,
  gastosEfectivo DECIMAL(12,2) NOT NULL DEFAULT 0,
  efectivoEsperado DECIMAL(12,2) NOT NULL DEFAULT 0,
  efectivoContado DECIMAL(12,2) NOT NULL DEFAULT 0,
  diferencia DECIMAL(12,2) NOT NULL DEFAULT 0,
  totalQR DECIMAL(12,2) NOT NULL DEFAULT 0,
  totalNoEspecificado DECIMAL(12,2) NOT NULL DEFAULT 0,
  totalCobrado DECIMAL(12,2) NOT NULL DEFAULT 0,
  totalVentas DECIMAL(12,2) NOT NULL DEFAULT 0,
  totalFiadoGenerado DECIMAL(12,2) NOT NULL DEFAULT 0,
  totalGastos DECIMAL(12,2) NOT NULL DEFAULT 0,
  totalCompras DECIMAL(12,2) NOT NULL DEFAULT 0,
  observacion VARCHAR(500) NULL,
  estado ENUM('cerrado','anulado') NOT NULL DEFAULT 'cerrado',
  motivoAnulacion VARCHAR(300) NULL,
  claveOperacion VARCHAR(64) NOT NULL,
  creadoEn DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  anuladoEn DATETIME NULL,
  UNIQUE KEY uq_cierreCaja_tienda_id (idTienda, idCierreCaja),
  UNIQUE KEY uq_cierreCaja_tienda_clave (idTienda, claveOperacion),
  KEY idx_cierreCaja_tienda_estado_periodo (idTienda, estado, fechaInicio, fechaFin),
  KEY idx_cierreCaja_tienda_admin_fecha (idTienda, idAdministrador, creadoEn),
  CONSTRAINT chk_cierreCaja_periodo CHECK (fechaFin > fechaInicio),
  CONSTRAINT chk_cierreCaja_montos CHECK (
    efectivoInicial>=0 AND efectivoVentasEsperado>=0 AND efectivoFiadosCobrado>=0
    AND gastosEfectivo>=0 AND efectivoEsperado>=0 AND efectivoContado>=0
    AND totalQR>=0 AND totalNoEspecificado>=0 AND totalCobrado>=0 AND totalVentas>=0
    AND totalFiadoGenerado>=0 AND totalGastos>=0 AND totalCompras>=0
  ),
  CONSTRAINT chk_cierreCaja_balance CHECK (
    ABS(efectivoEsperado-(efectivoInicial+efectivoVentasEsperado+efectivoFiadosCobrado-gastosEfectivo))<0.01
    AND ABS(diferencia-(efectivoContado-efectivoEsperado))<0.01
  ),
  CONSTRAINT chk_cierreCaja_estado CHECK (
    (estado='cerrado' AND anuladoEn IS NULL AND idAdministradorAnula IS NULL AND motivoAnulacion IS NULL)
    OR (estado='anulado' AND anuladoEn IS NOT NULL AND idAdministradorAnula IS NOT NULL AND motivoAnulacion IS NOT NULL)
  ),
  CONSTRAINT fk_cierreCaja_tienda FOREIGN KEY (idTienda)
    REFERENCES tienda(idTienda) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_cierreCaja_creador FOREIGN KEY (idTienda, idAdministrador)
    REFERENCES administrador(idTienda, idAdministrador) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_cierreCaja_anulador FOREIGN KEY (idTienda, idAdministradorAnula)
    REFERENCES administrador(idTienda, idAdministrador) ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB;

INSERT INTO categoriaGasto (idTienda, nombre, nombreNormalizado, descripcion)
SELECT t.idTienda, c.nombre, c.nombreNormalizado, 'Categoria inicial editable de la tienda.'
FROM tienda t
CROSS JOIN (
  SELECT 'Servicios básicos' nombre, 'servicios basicos' nombreNormalizado
  UNION ALL SELECT 'Alquiler', 'alquiler'
  UNION ALL SELECT 'Transporte y delivery', 'transporte y delivery'
  UNION ALL SELECT 'Empaques y bolsas', 'empaques y bolsas'
  UNION ALL SELECT 'Mantenimiento', 'mantenimiento'
  UNION ALL SELECT 'Personal', 'personal'
  UNION ALL SELECT 'Impuestos', 'impuestos'
  UNION ALL SELECT 'Otros', 'otros'
) c
WHERE NOT EXISTS (
  SELECT 1 FROM categoriaGasto cg
  WHERE cg.idTienda=t.idTienda AND cg.nombreNormalizado=c.nombreNormalizado
);

CREATE TABLE IF NOT EXISTS movimientoStock (
  idMovimientoStock BIGINT AUTO_INCREMENT PRIMARY KEY,
  idTienda INT NOT NULL,
  idProducto INT NOT NULL,
  tipoMovimiento ENUM('entrada','salida','ajuste_positivo','ajuste_negativo','inventario_inicial') NOT NULL,
  origen ENUM('compra','venta','ajuste_manual','alta_producto','migracion_inicial','correccion_sistema','otro') NOT NULL,
  cantidad INT NOT NULL,
  stockAnterior INT NOT NULL,
  stockPosterior INT NOT NULL,
  cantidadOperacion DECIMAL(10,2) NULL,
  unidadOperacion VARCHAR(30) NULL,
  motivo VARCHAR(160) NOT NULL,
  observacion VARCHAR(500) NULL,
  idDetalleVenta INT NULL,
  idDetalleCompra INT NULL,
  referenciaTipo VARCHAR(40) NULL,
  referenciaId BIGINT NULL,
  claveOperacion VARCHAR(160) NOT NULL,
  idAdministrador INT NULL,
  creadoEn DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_movimiento_tienda_clave (idTienda, claveOperacion),
  UNIQUE KEY uq_movimiento_tienda_detalleVenta (idTienda, idDetalleVenta),
  UNIQUE KEY uq_movimiento_tienda_detalleCompra (idTienda, idDetalleCompra),
  UNIQUE KEY uq_movimiento_tienda_producto_id (idTienda, idProducto, idMovimientoStock),
  KEY idx_movimiento_tienda_fecha (idTienda, creadoEn, idMovimientoStock),
  KEY idx_movimiento_tienda_producto_fecha (idTienda, idProducto, creadoEn, idMovimientoStock),
  KEY idx_movimiento_tienda_tipo_origen (idTienda, tipoMovimiento, origen),
  KEY idx_movimiento_tienda_responsable (idTienda, idAdministrador, creadoEn),
  CONSTRAINT chk_movimiento_cantidad CHECK (cantidad <> 0),
  CONSTRAINT chk_movimiento_stock_no_negativo CHECK (stockAnterior >= 0 AND stockPosterior >= 0),
  CONSTRAINT chk_movimiento_balance CHECK (stockPosterior = stockAnterior + cantidad),
  CONSTRAINT chk_movimiento_tipo CHECK (
    tipoMovimiento IN ('entrada','salida','ajuste_positivo','ajuste_negativo','inventario_inicial')
  ),
  CONSTRAINT chk_movimiento_origen CHECK (
    origen IN ('compra','venta','ajuste_manual','alta_producto','migracion_inicial','correccion_sistema','otro')
  ),
  CONSTRAINT chk_movimiento_signo CHECK (
    (tipoMovimiento IN ('entrada','ajuste_positivo','inventario_inicial') AND cantidad > 0)
    OR (tipoMovimiento IN ('salida','ajuste_negativo') AND cantidad < 0)
  ),
  CONSTRAINT chk_movimiento_cantidad_operacion CHECK (cantidadOperacion IS NULL OR cantidadOperacion > 0),
  CONSTRAINT fk_movimiento_tienda FOREIGN KEY (idTienda)
    REFERENCES tienda(idTienda) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_movimiento_producto FOREIGN KEY (idTienda, idProducto)
    REFERENCES producto(idTienda, idProducto) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_movimiento_administrador FOREIGN KEY (idTienda, idAdministrador)
    REFERENCES administrador(idTienda, idAdministrador) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_movimiento_detalleVenta FOREIGN KEY (idTienda, idDetalleVenta)
    REFERENCES detalleVenta(idTienda, idDetalleVenta) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_movimiento_detalleCompra FOREIGN KEY (idTienda, idDetalleCompra)
    REFERENCES detalleCompra(idTienda, idDetalleCompra) ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS loteProducto (
  idLoteProducto BIGINT NOT NULL AUTO_INCREMENT,
  idTienda INT NOT NULL,
  idProducto INT NOT NULL,
  idProveedor INT NULL,
  idDetalleCompra INT NULL,
  codigoLote VARCHAR(80) NULL,
  origen ENUM('compra','distribucion_inicial','ajuste_positivo','reversion') NOT NULL,
  fechaIngreso DATETIME NOT NULL,
  fechaVencimiento DATE NULL,
  cantidadInicial INT NOT NULL,
  cantidadRestante INT NOT NULL,
  costoUnitarioBase DECIMAL(14,6) NULL,
  estadoOperativo ENUM('disponible','bloqueado','anulado') NOT NULL DEFAULT 'disponible',
  -- INVENTORY_SELLABLE_LOT_CLASSIFICATION_START
  clasificacionInventario ENUM('vendible','bloqueado','aislado','tecnico')
    NOT NULL DEFAULT 'vendible',
  -- INVENTORY_SELLABLE_LOT_CLASSIFICATION_END
  claveOperacion VARCHAR(160) NOT NULL,
  creadoEn DATETIME NOT NULL,
  actualizadoEn DATETIME NOT NULL,
  idAdministradorCrea INT NOT NULL,
  idAdministradorActualiza INT NULL,
  PRIMARY KEY (idLoteProducto),
  UNIQUE KEY uq_lote_tienda_producto_id (idTienda, idProducto, idLoteProducto),
  UNIQUE KEY uq_lote_tienda_clave (idTienda, claveOperacion),
  KEY idx_lote_tienda_producto_estado_vencimiento
    (idTienda, idProducto, estadoOperativo, fechaVencimiento),
  KEY idx_lote_tienda_producto_ingreso
    (idTienda, idProducto, fechaIngreso, idLoteProducto),
  KEY idx_lote_tienda_proveedor_ingreso (idTienda, idProveedor, fechaIngreso),
  KEY idx_lote_tienda_detalleCompra (idTienda, idDetalleCompra),
  KEY idx_lote_tienda_codigo (idTienda, codigoLote),
  KEY idx_lote_tienda_estado_vencimiento (idTienda, estadoOperativo, fechaVencimiento),
  -- INVENTORY_SELLABLE_LOT_INDEX_START
  KEY idx_lote_tienda_clasificacion_vencimiento
    (idTienda, clasificacionInventario, fechaVencimiento),
  -- INVENTORY_SELLABLE_LOT_INDEX_END
  CONSTRAINT chk_lote_cantidades CHECK (
    cantidadInicial>0 AND cantidadRestante>=0 AND cantidadRestante<=cantidadInicial
  ),
  CONSTRAINT chk_lote_costo CHECK (costoUnitarioBase IS NULL OR costoUnitarioBase>=0),
  CONSTRAINT chk_lote_fecha_vencimiento CHECK (
    fechaVencimiento IS NULL OR fechaVencimiento>=DATE(fechaIngreso)
  ),
  CONSTRAINT chk_lote_codigo CHECK (codigoLote IS NULL OR CHAR_LENGTH(TRIM(codigoLote))>0),
  CONSTRAINT chk_lote_origen_detalle CHECK (
    (origen='compra' AND idDetalleCompra IS NOT NULL)
    OR (origen<>'compra' AND idDetalleCompra IS NULL)
  ),
  CONSTRAINT chk_lote_anulado_sin_saldo CHECK (
    estadoOperativo<>'anulado' OR cantidadRestante=0
  ),
  -- INVENTORY_SELLABLE_LOT_CHECKS_START
  CONSTRAINT chk_lote_clasificacion_operativa CHECK (
    estadoOperativo='anulado'
    OR (clasificacionInventario='vendible' AND estadoOperativo='disponible')
    OR (
      clasificacionInventario IN ('bloqueado','aislado','tecnico')
      AND estadoOperativo='bloqueado'
    )
  ),
  CONSTRAINT chk_lote_tecnico_reversion CHECK (
    clasificacionInventario<>'tecnico' OR origen='reversion'
  ),
  -- INVENTORY_SELLABLE_LOT_CHECKS_END
  CONSTRAINT fk_lote_tienda FOREIGN KEY (idTienda)
    REFERENCES tienda(idTienda) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_lote_producto FOREIGN KEY (idTienda, idProducto)
    REFERENCES producto(idTienda, idProducto) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_lote_proveedor FOREIGN KEY (idTienda, idProveedor)
    REFERENCES proveedor(idTienda, idProveedor) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_lote_detalleCompra FOREIGN KEY (idTienda, idProducto, idDetalleCompra)
    REFERENCES detalleCompra(idTienda, idProducto, idDetalleCompra)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_lote_admin_crea FOREIGN KEY (idTienda, idAdministradorCrea)
    REFERENCES administrador(idTienda, idAdministrador) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_lote_admin_actualiza FOREIGN KEY (idTienda, idAdministradorActualiza)
    REFERENCES administrador(idTienda, idAdministrador) ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS movimientoLote (
  idMovimientoLote BIGINT NOT NULL AUTO_INCREMENT,
  idTienda INT NOT NULL,
  idProducto INT NOT NULL,
  idLoteProducto BIGINT NOT NULL,
  idMovimientoStock BIGINT NULL,
  tipoRegistro ENUM('movimiento_stock','distribucion_inicial') NOT NULL,
  cantidad INT NOT NULL,
  cantidadAnterior INT NOT NULL,
  cantidadPosterior INT NOT NULL,
  claveOperacion VARCHAR(160) NOT NULL,
  creadoEn DATETIME NOT NULL,
  idAdministrador INT NOT NULL,
  PRIMARY KEY (idMovimientoLote),
  UNIQUE KEY uq_movimientoLote_tienda_clave (idTienda, claveOperacion),
  KEY idx_movimientoLote_tienda_lote_fecha (idTienda, idLoteProducto, creadoEn),
  KEY idx_movimientoLote_tienda_movimiento (idTienda, idMovimientoStock),
  KEY idx_movimientoLote_tienda_producto_fecha (idTienda, idProducto, creadoEn),
  KEY idx_movimientoLote_tienda_tipo_fecha (idTienda, tipoRegistro, creadoEn),
  CONSTRAINT chk_movimientoLote_cantidad CHECK (cantidad<>0),
  CONSTRAINT chk_movimientoLote_balance CHECK (
    cantidadAnterior>=0
    AND cantidadPosterior>=0
    AND cantidadPosterior=cantidadAnterior+cantidad
  ),
  CONSTRAINT chk_movimientoLote_referencia CHECK (
    (tipoRegistro='distribucion_inicial' AND idMovimientoStock IS NULL AND cantidad>0)
    OR (tipoRegistro='movimiento_stock' AND idMovimientoStock IS NOT NULL)
  ),
  CONSTRAINT fk_movimientoLote_tienda FOREIGN KEY (idTienda)
    REFERENCES tienda(idTienda) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_movimientoLote_producto FOREIGN KEY (idTienda, idProducto)
    REFERENCES producto(idTienda, idProducto) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_movimientoLote_lote FOREIGN KEY (idTienda, idProducto, idLoteProducto)
    REFERENCES loteProducto(idTienda, idProducto, idLoteProducto)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_movimientoLote_movimientoStock
    FOREIGN KEY (idTienda, idProducto, idMovimientoStock)
    REFERENCES movimientoStock(idTienda, idProducto, idMovimientoStock)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_movimientoLote_administrador FOREIGN KEY (idTienda, idAdministrador)
    REFERENCES administrador(idTienda, idAdministrador) ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB;

-- INVENTORY_ADJUSTMENT_TABLE_START
CREATE TABLE IF NOT EXISTS ajusteInventario (
  idAjusteInventario BIGINT NOT NULL AUTO_INCREMENT,
  idTienda INT NOT NULL,
  idProducto INT NOT NULL,
  idMovimientoStock BIGINT NULL,
  idLoteProducto BIGINT NULL,
  tipoAjuste ENUM('positivo','negativo') NOT NULL,
  cantidad INT NOT NULL,
  motivoCodigo ENUM(
    'conteo_fisico','merma','danio','vencimiento',
    'correccion_registro','otro_controlado'
  ) NOT NULL,
  observacion VARCHAR(500) NULL,
  modoLotes ENUM('no_aplica','fefo_fifo','lote_explicito','lote_nuevo') NOT NULL,
  clasificacionInventario ENUM('vendible','bloqueado','aislado','tecnico') NOT NULL,
  stockFisicoAnterior INT NOT NULL,
  stockFisicoPosterior INT NOT NULL,
  stockVendibleAnterior INT NOT NULL,
  stockVendiblePosterior INT NOT NULL,
  claveOperacion VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  huellaSolicitud CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  idAdministrador INT NOT NULL,
  creadoEn DATETIME NOT NULL,
  PRIMARY KEY (idAjusteInventario),
  UNIQUE KEY uq_ajusteInventario_tienda_id (idTienda, idAjusteInventario),
  UNIQUE KEY uq_ajusteInventario_tienda_clave (idTienda, claveOperacion),
  UNIQUE KEY uq_ajusteInventario_tienda_movimiento
    (idTienda, idProducto, idMovimientoStock),
  KEY idx_ajusteInventario_tienda_fecha
    (idTienda, creadoEn, idAjusteInventario),
  KEY idx_ajusteInventario_tienda_producto_fecha
    (idTienda, idProducto, creadoEn, idAjusteInventario),
  KEY idx_ajusteInventario_tienda_lote
    (idTienda, idProducto, idLoteProducto),
  CONSTRAINT chk_ajusteInventario_cantidad CHECK (cantidad>0),
  CONSTRAINT chk_ajusteInventario_stock CHECK (
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
  ),
  CONSTRAINT chk_ajusteInventario_otro CHECK (
    motivoCodigo<>'otro_controlado' OR CHAR_LENGTH(TRIM(observacion))>=5
  ),
  CONSTRAINT chk_ajusteInventario_lotes CHECK (
    (modoLotes='no_aplica' AND idLoteProducto IS NULL AND clasificacionInventario='vendible')
    OR (modoLotes='fefo_fifo' AND idLoteProducto IS NULL)
    OR (modoLotes IN ('lote_explicito','lote_nuevo') AND idLoteProducto IS NOT NULL)
  ),
  CONSTRAINT chk_ajusteInventario_clave CHECK (
    claveOperacion REGEXP '^[A-Za-z0-9._:-]{8,64}$'
    AND huellaSolicitud REGEXP '^[0-9a-f]{64}$'
  ),
  CONSTRAINT fk_ajusteInventario_tienda FOREIGN KEY (idTienda)
    REFERENCES tienda(idTienda) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_ajusteInventario_producto FOREIGN KEY (idTienda, idProducto)
    REFERENCES producto(idTienda, idProducto) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_ajusteInventario_movimiento
    FOREIGN KEY (idTienda, idProducto, idMovimientoStock)
    REFERENCES movimientoStock(idTienda, idProducto, idMovimientoStock)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_ajusteInventario_lote
    FOREIGN KEY (idTienda, idProducto, idLoteProducto)
    REFERENCES loteProducto(idTienda, idProducto, idLoteProducto)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_ajusteInventario_administrador
    FOREIGN KEY (idTienda, idAdministrador)
    REFERENCES administrador(idTienda, idAdministrador)
    ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB;
-- INVENTORY_ADJUSTMENT_TABLE_END

-- COMPENSATION_SALES_TABLES_START
ALTER TABLE movimientoLote
  ADD UNIQUE INDEX uq_movimientoLote_tienda_producto_id
    (idTienda, idProducto, idMovimientoLote);

CREATE TABLE IF NOT EXISTS compensacionVenta (
  idCompensacionVenta BIGINT NOT NULL AUTO_INCREMENT,
  idTienda INT NOT NULL,
  idOperacionCompensatoria BIGINT NOT NULL,
  idVenta INT NOT NULL,
  tipoCompensacion ENUM('anulacion_total','devolucion_parcial') NOT NULL,
  montoCompensado DECIMAL(12,2) NOT NULL,
  costoCompensado DECIMAL(12,2) NOT NULL,
  creadoEn DATETIME NOT NULL,
  PRIMARY KEY (idCompensacionVenta),
  UNIQUE KEY uq_compensacionVenta_tienda_id
    (idTienda, idCompensacionVenta),
  UNIQUE KEY uq_compensacionVenta_tienda_operacion
    (idTienda, idOperacionCompensatoria),
  KEY idx_compensacionVenta_tienda_venta
    (idTienda, idVenta, idCompensacionVenta),
  CONSTRAINT chk_compensacionVenta_montos
    CHECK (montoCompensado>=0 AND costoCompensado>=0),
  CONSTRAINT fk_compensacionVenta_operacion
    FOREIGN KEY (idTienda, idOperacionCompensatoria)
    REFERENCES operacionCompensatoria(idTienda, idOperacionCompensatoria)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_compensacionVenta_venta
    FOREIGN KEY (idTienda, idVenta)
    REFERENCES venta(idTienda, idVenta)
    ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB;

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
  PRIMARY KEY (idLiquidacionCompensacionVenta),
  UNIQUE KEY uq_liquidacionCompensacion_tienda_id
    (idTienda, idLiquidacionCompensacionVenta),
  UNIQUE KEY uq_liquidacionCompensacion_tienda_compensacion
    (idTienda, idCompensacionVenta),
  KEY idx_liquidacionCompensacion_tienda_estado
    (idTienda, estado, creadoEn),
  CONSTRAINT chk_liquidacionCompensacion_montos
    CHECK (
      montoCompensado>=0
      AND montoReduccionDeudaPendiente>=0
      AND montoReembolsoPendiente>=0
      AND ABS(
        montoCompensado
        - montoReduccionDeudaPendiente
        - montoReembolsoPendiente
      )<0.01
    ),
  CONSTRAINT chk_liquidacionCompensacion_estado
    CHECK (
      (estado='sin_efecto' AND montoCompensado=0 AND resueltoEn IS NULL)
      OR (estado='pendiente_c3' AND montoCompensado>0 AND resueltoEn IS NULL)
      OR (estado='resuelta' AND resueltoEn IS NOT NULL)
    ),
  CONSTRAINT fk_liquidacionCompensacion_compensacion
    FOREIGN KEY (idTienda, idCompensacionVenta)
    REFERENCES compensacionVenta(idTienda, idCompensacionVenta)
    ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB;

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
  PRIMARY KEY (idDetalleCompensacionVenta),
  UNIQUE KEY uq_detalleCompensacionVenta_tienda_id
    (idTienda, idProducto, idDetalleCompensacionVenta),
  UNIQUE KEY uq_detalleCompensacionVenta_tienda_detalle
    (idTienda, idCompensacionVenta, idDetalleVenta),
  KEY idx_detalleCompensacionVenta_tienda_venta
    (idTienda, idDetalleVenta, idDetalleCompensacionVenta),
  KEY idx_detalleCompensacionVenta_tienda_movimiento
    (idTienda, idProducto, idMovimientoStock),
  CONSTRAINT chk_detalleCompensacionVenta_valores
    CHECK (
      unidadesDevueltas>0
      AND montoCompensado>=0
      AND costoCompensado>=0
    ),
  CONSTRAINT chk_detalleCompensacionVenta_movimiento
    CHECK (
      (
        resultadoInventario IN ('no_reintegrado','aislado_no_vendible')
        AND idMovimientoStock IS NULL
      )
      OR (
        resultadoInventario NOT IN ('no_reintegrado','aislado_no_vendible')
        AND idMovimientoStock IS NOT NULL
      )
    ),
  CONSTRAINT fk_detalleCompensacionVenta_compensacion
    FOREIGN KEY (idTienda, idCompensacionVenta)
    REFERENCES compensacionVenta(idTienda, idCompensacionVenta)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_detalleCompensacionVenta_detalle
    FOREIGN KEY (idTienda, idDetalleVenta)
    REFERENCES detalleVenta(idTienda, idDetalleVenta)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_detalleCompensacionVenta_producto
    FOREIGN KEY (idTienda, idProducto)
    REFERENCES producto(idTienda, idProducto)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_detalleCompensacionVenta_movimiento
    FOREIGN KEY (idTienda, idProducto, idMovimientoStock)
    REFERENCES movimientoStock(idTienda, idProducto, idMovimientoStock)
    ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB;

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
  PRIMARY KEY (idDetalleCompensacionLote),
  UNIQUE KEY uq_detalleCompensacionLote_tienda_id
    (idTienda, idProducto, idDetalleCompensacionLote),
  UNIQUE KEY uq_detalleCompensacionLote_tienda_fuente
    (idTienda, idDetalleCompensacionVenta, idMovimientoLoteSalida),
  KEY idx_detalleCompensacionLote_tienda_origen
    (idTienda, idProducto, idLoteProductoOrigen),
  KEY idx_detalleCompensacionLote_tienda_destino
    (idTienda, idProducto, idLoteProductoDestino),
  KEY idx_detalleCompensacionLote_tienda_movimiento
    (idTienda, idProducto, idMovimientoLoteCompensatorio),
  CONSTRAINT chk_detalleCompensacionLote_unidades
    CHECK (unidadesDevueltas>0),
  CONSTRAINT chk_detalleCompensacionLote_destino
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
    ),
  CONSTRAINT fk_detalleCompensacionLote_detalle
    FOREIGN KEY (idTienda, idProducto, idDetalleCompensacionVenta)
    REFERENCES detalleCompensacionVenta(idTienda, idProducto, idDetalleCompensacionVenta)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_detalleCompensacionLote_salida
    FOREIGN KEY (idTienda, idProducto, idMovimientoLoteSalida)
    REFERENCES movimientoLote(idTienda, idProducto, idMovimientoLote)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_detalleCompensacionLote_lote_origen
    FOREIGN KEY (idTienda, idProducto, idLoteProductoOrigen)
    REFERENCES loteProducto(idTienda, idProducto, idLoteProducto)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_detalleCompensacionLote_lote_destino
    FOREIGN KEY (idTienda, idProducto, idLoteProductoDestino)
    REFERENCES loteProducto(idTienda, idProducto, idLoteProducto)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_detalleCompensacionLote_movimiento
    FOREIGN KEY (idTienda, idProducto, idMovimientoLoteCompensatorio)
    REFERENCES movimientoLote(idTienda, idProducto, idMovimientoLote)
    ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB;
-- COMPENSATION_SALES_TABLES_END

-- COMPENSATION_FINANCIAL_TABLES_START
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
-- COMPENSATION_FINANCIAL_TABLES_END

-- COMPENSATION_INTEGRATION_TABLES_START
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
  PRIMARY KEY (idMovimientoLiquidacionCompensacion),
  UNIQUE KEY uq_movimientoLiquidacion_tienda_id
    (idTienda, idMovimientoLiquidacionCompensacion),
  UNIQUE KEY uq_movimientoLiquidacion_tienda_operacion
    (idTienda, idOperacionCompensatoria),
  KEY idx_movimientoLiquidacion_tienda_obligacion
    (idTienda, idObligacionReembolsoVenta, fechaMovimiento,
     idMovimientoLiquidacionCompensacion),
  KEY idx_movimientoLiquidacion_tienda_fecha_metodo
    (idTienda, fechaMovimiento, metodoLiquidacion,
     idMovimientoLiquidacionCompensacion),
  CONSTRAINT chk_movimientoLiquidacion_monto CHECK (monto>0),
  CONSTRAINT chk_movimientoLiquidacion_periodo
    CHECK (periodoOriginalCerrado IN (0,1)),
  CONSTRAINT chk_movimientoLiquidacion_referencia
    CHECK (
      metodoLiquidacion='efectivo'
      OR (referencia IS NOT NULL AND CHAR_LENGTH(TRIM(referencia))>0)
    ),
  CONSTRAINT fk_movimientoLiquidacion_operacion
    FOREIGN KEY (idTienda, idOperacionCompensatoria)
    REFERENCES operacionCompensatoria(idTienda, idOperacionCompensatoria)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_movimientoLiquidacion_obligacion
    FOREIGN KEY (idTienda, idObligacionReembolsoVenta)
    REFERENCES obligacionReembolsoVenta(idTienda, idObligacionReembolsoVenta)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_movimientoLiquidacion_administrador
    FOREIGN KEY (idTienda, idAdministrador)
    REFERENCES administrador(idTienda, idAdministrador)
    ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB;

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
-- COMPENSATION_INTEGRATION_TABLES_END

-- ADMINISTRATIVE_AUDIT_FOUNDATION_START
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
  PRIMARY KEY (idEventoAuditoria),
  UNIQUE KEY uq_eventoAuditoria_request_accion_resultado
    (requestId, accion, resultado),
  KEY idx_eventoAuditoria_tienda_fecha
    (idTienda, creadoEn, idEventoAuditoria),
  KEY idx_eventoAuditoria_actor_fecha
    (idAdministradorActor, creadoEn, idEventoAuditoria),
  KEY idx_eventoAuditoria_categoria_accion_fecha
    (categoria, accion, creadoEn, idEventoAuditoria),
  KEY idx_eventoAuditoria_resultado_fecha
    (resultado, creadoEn, idEventoAuditoria),
  CONSTRAINT chk_eventoAuditoria_actor
    CHECK (
      (actorTipo='administrador' AND idAdministradorActor IS NOT NULL)
      OR (actorTipo IN ('sistema','anonimo') AND idAdministradorActor IS NULL)
    ),
  CONSTRAINT chk_eventoAuditoria_categoria_accion
    CHECK (
      categoria REGEXP '^[a-z][a-z0-9_]{1,39}$'
      AND accion REGEXP '^[a-z][a-z0-9_]{1,63}$'
      AND entidadTipo REGEXP '^[a-z][a-z0-9_]{1,39}$'
    ),
  CONSTRAINT chk_eventoAuditoria_codigo
    CHECK (codigoResultado REGEXP '^[A-Z][A-Z0-9_]{1,79}$'),
  CONSTRAINT chk_eventoAuditoria_referencia
    CHECK (
      referenciaSegura IS NULL
      OR referenciaSegura REGEXP '^[a-z][a-z0-9_]{1,39}:[0-9]{1,20}$'
    ),
  CONSTRAINT chk_eventoAuditoria_request
    CHECK (
      requestId IS NULL
      OR requestId REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    ),
  CONSTRAINT fk_eventoAuditoria_tienda
    FOREIGN KEY (idTienda)
    REFERENCES tienda(idTienda) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_eventoAuditoria_actor
    FOREIGN KEY (idAdministradorActor)
    REFERENCES administrador(idAdministrador) ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB;

-- ADMINISTRATIVE_AUDIT_FOUNDATION_END

-- Esta instalacion crea Tienda Deisy como contexto inicial.
-- No crea administradores, contrasenas ni datos comerciales de demostracion.
