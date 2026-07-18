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
SELECT 'portal_clientes', 'Portal de clientes', 'Acceso futuro para compradores y pedidos.'
WHERE NOT EXISTS (SELECT 1 FROM funcionalidad WHERE codigo='portal_clientes');

INSERT INTO planFuncionalidad (idPlan, idFuncionalidad, habilitada)
SELECT p.idPlan, f.idFuncionalidad, 1
FROM plan p
JOIN funcionalidad f ON f.activo=1
WHERE p.codigo='avanzado'
  AND NOT EXISTS (
    SELECT 1 FROM planFuncionalidad pf
    WHERE pf.idPlan=p.idPlan AND pf.idFuncionalidad=f.idFuncionalidad
  );

INSERT INTO suscripcionTienda
  (idTienda, idPlan, tipo, estado, fechaInicio, fechaFin, renovacionAutomatica, observacion, creadoPor)
SELECT t.idTienda, p.idPlan, 'cortesia', 'activa', CURRENT_TIMESTAMP,
       DATE_ADD(CURRENT_TIMESTAMP, INTERVAL 3650 DAY), 0,
       'Suscripcion inicial de cortesia para conservar el acceso durante la migracion.', NULL
FROM tienda t
JOIN plan p ON p.codigo='avanzado'
WHERE NOT EXISTS (
  SELECT 1 FROM suscripcionTienda s WHERE s.idTienda=t.idTienda
);
