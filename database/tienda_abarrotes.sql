CREATE DATABASE IF NOT EXISTS tienda_abarrotes
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE tienda_abarrotes;

CREATE TABLE IF NOT EXISTS tienda (
  idTienda INT AUTO_INCREMENT PRIMARY KEY,
  nombre VARCHAR(120) NOT NULL,
  slug VARCHAR(120) NOT NULL,
  activo TINYINT(1) NOT NULL DEFAULT 1,
  estado ENUM('activa','suspendida','inactiva') NOT NULL DEFAULT 'activa',
  creadoEn DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizadoEn DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT uq_tienda_slug UNIQUE (slug)
);

INSERT INTO tienda (nombre, slug, activo, estado)
SELECT 'Tienda Deisy', 'tienda-deisy', 1, 'activa'
WHERE NOT EXISTS (SELECT 1 FROM tienda WHERE slug = 'tienda-deisy');

CREATE TABLE IF NOT EXISTS administrador (
  idAdministrador INT AUTO_INCREMENT PRIMARY KEY,
  idTienda INT NULL,
  usuario VARCHAR(50) NOT NULL UNIQUE,
  password VARCHAR(255) NOT NULL,
  rol ENUM('superadmin','dueno_tienda') NOT NULL DEFAULT 'dueno_tienda',
  activo TINYINT(1) NOT NULL DEFAULT 1,
  KEY idx_administrador_tienda_activo (idTienda, activo),
  CONSTRAINT fk_administrador_tienda FOREIGN KEY (idTienda) REFERENCES tienda(idTienda),
  CONSTRAINT chk_administrador_rol_tienda CHECK (
    (rol = 'superadmin' AND idTienda IS NULL)
    OR (rol = 'dueno_tienda' AND idTienda IS NOT NULL)
  )
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
INSERT INTO funcionalidad (codigo, nombre, descripcion)
SELECT 'catalogo_maestro', 'Catalogo maestro', 'Busqueda y alta guiada de productos desde el catalogo de plataforma.'
WHERE NOT EXISTS (SELECT 1 FROM funcionalidad WHERE codigo='catalogo_maestro');

INSERT INTO planFuncionalidad (idPlan, idFuncionalidad, habilitada)
SELECT p.idPlan, f.idFuncionalidad, 1
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
  activo TINYINT(1) NOT NULL DEFAULT 1,
  eliminadoEn DATETIME NULL,
  UNIQUE KEY uq_cliente_tienda_id (idTienda, idCliente),
  KEY idx_cliente_tienda_activo_nombre (idTienda, activo, nombre),
  CONSTRAINT fk_cliente_tienda FOREIGN KEY (idTienda) REFERENCES tienda(idTienda)
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
  categoria VARCHAR(50) NOT NULL DEFAULT 'otros',
  unidadMedida ENUM('unidad','paquete','kilo','gramo','litro','mililitro','caja','docena','bolsa') NOT NULL DEFAULT 'unidad',
  unidadesPorPaquete INT NOT NULL DEFAULT 1,
  paquetesPorCaja INT NOT NULL DEFAULT 1,
  precioVenta DECIMAL(10,2) NOT NULL,
  stock INT NOT NULL DEFAULT 0,
  stockMinimo INT NOT NULL DEFAULT 5,
  stockUnidadesTotal INT NOT NULL DEFAULT 0,
  ultimoPrecioCompra DECIMAL(10,2) NOT NULL DEFAULT 0,
  permiteVentaPorPaquete BOOLEAN NOT NULL DEFAULT TRUE,
  permiteVentaPorUnidad BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE KEY uq_producto_tienda_id (idTienda, idProducto),
  KEY idx_producto_tienda_proveedor (idTienda, idProveedor),
  KEY idx_producto_tienda_categoria_nombre (idTienda, categoria, nombre),
  KEY idx_producto_productoMaestro (idProductoMaestro),
  UNIQUE KEY uq_producto_tienda_maestro (idTienda, idProductoMaestro),
  CONSTRAINT fk_producto_tienda FOREIGN KEY (idTienda) REFERENCES tienda(idTienda),
  CONSTRAINT fk_producto_proveedor FOREIGN KEY (idProveedor) REFERENCES proveedor(idProveedor),
  CONSTRAINT fk_producto_tienda_proveedor FOREIGN KEY (idTienda, idProveedor) REFERENCES proveedor(idTienda, idProveedor),
  CONSTRAINT fk_producto_productoMaestro FOREIGN KEY (idProductoMaestro)
    REFERENCES productoMaestro(idProductoMaestro) ON UPDATE CASCADE ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS venta (
  idVenta INT AUTO_INCREMENT PRIMARY KEY,
  idTienda INT NULL,
  fecha DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  total DECIMAL(10,2) NOT NULL,
  tipo ENUM('pagada','fiada') NOT NULL DEFAULT 'pagada',
  idCliente INT NULL,
  UNIQUE KEY uq_venta_tienda_id (idTienda, idVenta),
  KEY idx_venta_tienda_fecha (idTienda, fecha),
  KEY idx_venta_tienda_cliente (idTienda, idCliente),
  CONSTRAINT fk_venta_tienda FOREIGN KEY (idTienda) REFERENCES tienda(idTienda),
  CONSTRAINT fk_venta_cliente FOREIGN KEY (idCliente) REFERENCES cliente(idCliente),
  CONSTRAINT fk_venta_tienda_cliente FOREIGN KEY (idTienda, idCliente) REFERENCES cliente(idTienda, idCliente)
);

CREATE TABLE IF NOT EXISTS detalleVenta (
  idDetalleVenta INT AUTO_INCREMENT PRIMARY KEY,
  idTienda INT NULL,
  idVenta INT NOT NULL,
  idProducto INT NOT NULL,
  cantidad DECIMAL(10,2) NOT NULL,
  precioVenta DECIMAL(10,2) NOT NULL,
  costoUnitario DECIMAL(10,2) NOT NULL DEFAULT 0,
  subtotal DECIMAL(10,2) NOT NULL,
  subtotalCosto DECIMAL(10,2) NOT NULL DEFAULT 0,
  ganancia DECIMAL(10,2) NOT NULL DEFAULT 0,
  presentacionVenta VARCHAR(30) NOT NULL DEFAULT 'unidad',
  cantidadEquivalenteUnidades INT NOT NULL DEFAULT 0,
  KEY idx_detalleVenta_tienda_venta (idTienda, idVenta),
  KEY idx_detalleVenta_tienda_producto (idTienda, idProducto),
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
  UNIQUE KEY uq_compra_tienda_id (idTienda, idCompra),
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
  KEY idx_detalleCompra_tienda_compra (idTienda, idCompra),
  KEY idx_detalleCompra_tienda_producto (idTienda, idProducto),
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
  totalFiado DECIMAL(10,2) NOT NULL DEFAULT 0,
  totalPagado DECIMAL(10,2) NOT NULL DEFAULT 0,
  saldoPendiente DECIMAL(10,2) NOT NULL DEFAULT 0,
  estado ENUM('pendiente','parcial','pagado') NOT NULL DEFAULT 'pendiente',
  activo TINYINT(1) NOT NULL DEFAULT 1,
  eliminadoEn DATETIME NULL,
  UNIQUE KEY uq_fiado_tienda_id (idTienda, idFiado),
  KEY idx_fiado_tienda_estado_fecha (idTienda, activo, estado, fechaInicio),
  KEY idx_fiado_tienda_cliente (idTienda, idCliente),
  KEY idx_fiado_tienda_venta (idTienda, idVenta),
  CONSTRAINT fk_fiado_tienda FOREIGN KEY (idTienda) REFERENCES tienda(idTienda),
  CONSTRAINT fk_fiado_cliente FOREIGN KEY (idCliente) REFERENCES cliente(idCliente),
  CONSTRAINT fk_fiado_venta FOREIGN KEY (idVenta) REFERENCES venta(idVenta),
  CONSTRAINT fk_fiado_tienda_cliente FOREIGN KEY (idTienda, idCliente) REFERENCES cliente(idTienda, idCliente),
  CONSTRAINT fk_fiado_tienda_venta FOREIGN KEY (idTienda, idVenta) REFERENCES venta(idTienda, idVenta)
);

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
  fechaPago DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  monto DECIMAL(10,2) NOT NULL,
  observacion VARCHAR(150) NULL,
  KEY idx_pagoFiado_tienda_fiado (idTienda, idFiado),
  CONSTRAINT fk_pagoFiado_tienda FOREIGN KEY (idTienda) REFERENCES tienda(idTienda),
  CONSTRAINT fk_pagoFiado_fiado FOREIGN KEY (idFiado) REFERENCES fiado(idFiado),
  CONSTRAINT fk_pagoFiado_tienda_fiado FOREIGN KEY (idTienda, idFiado) REFERENCES fiado(idTienda, idFiado)
);

-- Esta instalacion crea Tienda Deisy como contexto inicial.
-- No crea administradores, contrasenas ni datos comerciales de demostracion.
