-- Migracion base multi-tienda.
-- Conserva todos los datos comerciales y los asocia a Tienda Deisy.
-- Las columnas idTienda permanecen NULL temporalmente para mantener
-- compatibilidad con el backend de una sola tienda durante la transicion.

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

SET @idTiendaDeisy = (SELECT idTienda FROM tienda WHERE slug = 'tienda-deisy' LIMIT 1);

ALTER TABLE administrador ADD COLUMN idTienda INT NULL AFTER idAdministrador;
ALTER TABLE administrador ADD COLUMN rol ENUM('superadmin','dueno_tienda') NOT NULL DEFAULT 'dueno_tienda' AFTER password;
ALTER TABLE administrador ADD COLUMN activo TINYINT(1) NOT NULL DEFAULT 1 AFTER rol;

ALTER TABLE cliente ADD COLUMN idTienda INT NULL AFTER idCliente;
ALTER TABLE proveedor ADD COLUMN idTienda INT NULL AFTER idProveedor;
ALTER TABLE producto ADD COLUMN idTienda INT NULL AFTER idProducto;
ALTER TABLE venta ADD COLUMN idTienda INT NULL AFTER idVenta;
ALTER TABLE compra ADD COLUMN idTienda INT NULL AFTER idCompra;
ALTER TABLE fiado ADD COLUMN idTienda INT NULL AFTER idFiado;

ALTER TABLE detalleVenta ADD COLUMN idTienda INT NULL AFTER idDetalleVenta;
ALTER TABLE detalleCompra ADD COLUMN idTienda INT NULL AFTER idDetalleCompra;
ALTER TABLE detalleFiado ADD COLUMN idTienda INT NULL AFTER idDetalleFiado;
ALTER TABLE pagoFiado ADD COLUMN idTienda INT NULL AFTER idPagoFiado;

UPDATE administrador
SET idTienda = @idTiendaDeisy, rol = 'dueno_tienda'
WHERE idTienda IS NULL AND COALESCE(rol, 'dueno_tienda') <> 'superadmin';

UPDATE cliente SET idTienda = @idTiendaDeisy WHERE idTienda IS NULL;
UPDATE proveedor SET idTienda = @idTiendaDeisy WHERE idTienda IS NULL;
UPDATE producto SET idTienda = @idTiendaDeisy WHERE idTienda IS NULL;
UPDATE venta SET idTienda = @idTiendaDeisy WHERE idTienda IS NULL;
UPDATE compra SET idTienda = @idTiendaDeisy WHERE idTienda IS NULL;
UPDATE fiado SET idTienda = @idTiendaDeisy WHERE idTienda IS NULL;

UPDATE detalleVenta d
JOIN venta v ON v.idVenta = d.idVenta
SET d.idTienda = v.idTienda
WHERE d.idTienda IS NULL;

UPDATE detalleCompra d
JOIN compra c ON c.idCompra = d.idCompra
SET d.idTienda = c.idTienda
WHERE d.idTienda IS NULL;

UPDATE detalleFiado d
JOIN fiado f ON f.idFiado = d.idFiado
SET d.idTienda = f.idTienda
WHERE d.idTienda IS NULL;

UPDATE pagoFiado p
JOIN fiado f ON f.idFiado = p.idFiado
SET p.idTienda = f.idTienda
WHERE p.idTienda IS NULL;

-- scripts/migrate-db.js valida aqui que no haya tiendas ausentes,
-- relaciones huerfanas ni cruces entre tiendas antes de crear indices o FKs.
ALTER TABLE administrador ADD INDEX idx_administrador_tienda_activo (idTienda, activo);

ALTER TABLE cliente ADD UNIQUE INDEX uq_cliente_tienda_id (idTienda, idCliente);
ALTER TABLE cliente ADD INDEX idx_cliente_tienda_activo_nombre (idTienda, activo, nombre);

ALTER TABLE proveedor ADD UNIQUE INDEX uq_proveedor_tienda_id (idTienda, idProveedor);
ALTER TABLE proveedor ADD INDEX idx_proveedor_tienda_nombre (idTienda, nombre);

ALTER TABLE producto ADD UNIQUE INDEX uq_producto_tienda_id (idTienda, idProducto);
ALTER TABLE producto ADD INDEX idx_producto_tienda_proveedor (idTienda, idProveedor);
ALTER TABLE producto ADD INDEX idx_producto_tienda_categoria_nombre (idTienda, categoria, nombre);

ALTER TABLE venta ADD UNIQUE INDEX uq_venta_tienda_id (idTienda, idVenta);
ALTER TABLE venta ADD INDEX idx_venta_tienda_fecha (idTienda, fecha);
ALTER TABLE venta ADD INDEX idx_venta_tienda_cliente (idTienda, idCliente);

ALTER TABLE compra ADD UNIQUE INDEX uq_compra_tienda_id (idTienda, idCompra);
ALTER TABLE compra ADD INDEX idx_compra_tienda_fecha (idTienda, fecha);
ALTER TABLE compra ADD INDEX idx_compra_tienda_proveedor (idTienda, idProveedor);

ALTER TABLE fiado ADD UNIQUE INDEX uq_fiado_tienda_id (idTienda, idFiado);
ALTER TABLE fiado ADD INDEX idx_fiado_tienda_estado_fecha (idTienda, activo, estado, fechaInicio);
ALTER TABLE fiado ADD INDEX idx_fiado_tienda_cliente (idTienda, idCliente);
ALTER TABLE fiado ADD INDEX idx_fiado_tienda_venta (idTienda, idVenta);

ALTER TABLE detalleVenta ADD INDEX idx_detalleVenta_tienda_venta (idTienda, idVenta);
ALTER TABLE detalleVenta ADD INDEX idx_detalleVenta_tienda_producto (idTienda, idProducto);
ALTER TABLE detalleCompra ADD INDEX idx_detalleCompra_tienda_compra (idTienda, idCompra);
ALTER TABLE detalleCompra ADD INDEX idx_detalleCompra_tienda_producto (idTienda, idProducto);
ALTER TABLE detalleFiado ADD INDEX idx_detalleFiado_tienda_fiado (idTienda, idFiado);
ALTER TABLE detalleFiado ADD INDEX idx_detalleFiado_tienda_producto (idTienda, idProducto);
ALTER TABLE pagoFiado ADD INDEX idx_pagoFiado_tienda_fiado (idTienda, idFiado);

ALTER TABLE administrador
  ADD CONSTRAINT fk_administrador_tienda
  FOREIGN KEY (idTienda) REFERENCES tienda(idTienda);

ALTER TABLE administrador
  ADD CONSTRAINT chk_administrador_rol_tienda
  CHECK ((rol = 'superadmin' AND idTienda IS NULL) OR (rol = 'dueno_tienda' AND idTienda IS NOT NULL));

ALTER TABLE cliente ADD CONSTRAINT fk_cliente_tienda FOREIGN KEY (idTienda) REFERENCES tienda(idTienda);
ALTER TABLE proveedor ADD CONSTRAINT fk_proveedor_tienda FOREIGN KEY (idTienda) REFERENCES tienda(idTienda);
ALTER TABLE producto ADD CONSTRAINT fk_producto_tienda FOREIGN KEY (idTienda) REFERENCES tienda(idTienda);
ALTER TABLE venta ADD CONSTRAINT fk_venta_tienda FOREIGN KEY (idTienda) REFERENCES tienda(idTienda);
ALTER TABLE compra ADD CONSTRAINT fk_compra_tienda FOREIGN KEY (idTienda) REFERENCES tienda(idTienda);
ALTER TABLE fiado ADD CONSTRAINT fk_fiado_tienda FOREIGN KEY (idTienda) REFERENCES tienda(idTienda);
ALTER TABLE detalleVenta ADD CONSTRAINT fk_detalleVenta_tienda FOREIGN KEY (idTienda) REFERENCES tienda(idTienda);
ALTER TABLE detalleCompra ADD CONSTRAINT fk_detalleCompra_tienda FOREIGN KEY (idTienda) REFERENCES tienda(idTienda);
ALTER TABLE detalleFiado ADD CONSTRAINT fk_detalleFiado_tienda FOREIGN KEY (idTienda) REFERENCES tienda(idTienda);
ALTER TABLE pagoFiado ADD CONSTRAINT fk_pagoFiado_tienda FOREIGN KEY (idTienda) REFERENCES tienda(idTienda);

ALTER TABLE producto
  ADD CONSTRAINT fk_producto_tienda_proveedor
  FOREIGN KEY (idTienda, idProveedor) REFERENCES proveedor(idTienda, idProveedor);

ALTER TABLE venta
  ADD CONSTRAINT fk_venta_tienda_cliente
  FOREIGN KEY (idTienda, idCliente) REFERENCES cliente(idTienda, idCliente);

ALTER TABLE compra
  ADD CONSTRAINT fk_compra_tienda_proveedor
  FOREIGN KEY (idTienda, idProveedor) REFERENCES proveedor(idTienda, idProveedor);

ALTER TABLE fiado
  ADD CONSTRAINT fk_fiado_tienda_cliente
  FOREIGN KEY (idTienda, idCliente) REFERENCES cliente(idTienda, idCliente);

ALTER TABLE fiado
  ADD CONSTRAINT fk_fiado_tienda_venta
  FOREIGN KEY (idTienda, idVenta) REFERENCES venta(idTienda, idVenta);

ALTER TABLE detalleVenta
  ADD CONSTRAINT fk_detalleVenta_tienda_venta
  FOREIGN KEY (idTienda, idVenta) REFERENCES venta(idTienda, idVenta);

ALTER TABLE detalleVenta
  ADD CONSTRAINT fk_detalleVenta_tienda_producto
  FOREIGN KEY (idTienda, idProducto) REFERENCES producto(idTienda, idProducto);

ALTER TABLE detalleCompra
  ADD CONSTRAINT fk_detalleCompra_tienda_compra
  FOREIGN KEY (idTienda, idCompra) REFERENCES compra(idTienda, idCompra);

ALTER TABLE detalleCompra
  ADD CONSTRAINT fk_detalleCompra_tienda_producto
  FOREIGN KEY (idTienda, idProducto) REFERENCES producto(idTienda, idProducto);

ALTER TABLE detalleFiado
  ADD CONSTRAINT fk_detalleFiado_tienda_fiado
  FOREIGN KEY (idTienda, idFiado) REFERENCES fiado(idTienda, idFiado);

ALTER TABLE detalleFiado
  ADD CONSTRAINT fk_detalleFiado_tienda_producto
  FOREIGN KEY (idTienda, idProducto) REFERENCES producto(idTienda, idProducto);

ALTER TABLE pagoFiado
  ADD CONSTRAINT fk_pagoFiado_tienda_fiado
  FOREIGN KEY (idTienda, idFiado) REFERENCES fiado(idTienda, idFiado);
