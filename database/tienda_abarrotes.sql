CREATE DATABASE IF NOT EXISTS tienda_abarrotes
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE tienda_abarrotes;

CREATE TABLE IF NOT EXISTS administrador (
  idAdministrador INT AUTO_INCREMENT PRIMARY KEY,
  usuario VARCHAR(50) NOT NULL UNIQUE,
  password VARCHAR(255) NOT NULL
);

CREATE TABLE IF NOT EXISTS cliente (
  idCliente INT AUTO_INCREMENT PRIMARY KEY,
  nombre VARCHAR(100) NOT NULL,
  telefono VARCHAR(30) NULL
);

CREATE TABLE IF NOT EXISTS proveedor (
  idProveedor INT AUTO_INCREMENT PRIMARY KEY,
  nombre VARCHAR(100) NOT NULL,
  telefono VARCHAR(30) NULL,
  direccion VARCHAR(150) NULL
);

CREATE TABLE IF NOT EXISTS producto (
  idProducto INT AUTO_INCREMENT PRIMARY KEY,
  nombre VARCHAR(100) NOT NULL,
  idProveedor INT NULL,
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
  FOREIGN KEY (idProveedor) REFERENCES proveedor(idProveedor)
);

CREATE TABLE IF NOT EXISTS venta (
  idVenta INT AUTO_INCREMENT PRIMARY KEY,
  fecha DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  total DECIMAL(10,2) NOT NULL,
  tipo ENUM('pagada','fiada') NOT NULL DEFAULT 'pagada',
  idCliente INT NULL,
  FOREIGN KEY (idCliente) REFERENCES cliente(idCliente)
);

CREATE TABLE IF NOT EXISTS detalleVenta (
  idDetalleVenta INT AUTO_INCREMENT PRIMARY KEY,
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
  FOREIGN KEY (idVenta) REFERENCES venta(idVenta),
  FOREIGN KEY (idProducto) REFERENCES producto(idProducto)
);

CREATE TABLE IF NOT EXISTS compra (
  idCompra INT AUTO_INCREMENT PRIMARY KEY,
  fecha DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  total DECIMAL(10,2) NOT NULL,
  idProveedor INT NULL,
  FOREIGN KEY (idProveedor) REFERENCES proveedor(idProveedor)
);

CREATE TABLE IF NOT EXISTS detalleCompra (
  idDetalleCompra INT AUTO_INCREMENT PRIMARY KEY,
  idCompra INT NOT NULL,
  idProducto INT NOT NULL,
  cantidad DECIMAL(10,2) NOT NULL,
  precioCompra DECIMAL(10,2) NOT NULL,
  subtotal DECIMAL(10,2) NOT NULL,
  presentacionCompra VARCHAR(30) NOT NULL DEFAULT 'unidad',
  cantidadEquivalenteUnidades INT NOT NULL DEFAULT 0,
  FOREIGN KEY (idCompra) REFERENCES compra(idCompra),
  FOREIGN KEY (idProducto) REFERENCES producto(idProducto)
);

CREATE TABLE IF NOT EXISTS fiado (
  idFiado INT AUTO_INCREMENT PRIMARY KEY,
  idCliente INT NOT NULL,
  idVenta INT NULL,
  fechaInicio DATE NOT NULL,
  totalFiado DECIMAL(10,2) NOT NULL DEFAULT 0,
  totalPagado DECIMAL(10,2) NOT NULL DEFAULT 0,
  saldoPendiente DECIMAL(10,2) NOT NULL DEFAULT 0,
  estado ENUM('pendiente','parcial','pagado') NOT NULL DEFAULT 'pendiente',
  FOREIGN KEY (idCliente) REFERENCES cliente(idCliente),
  FOREIGN KEY (idVenta) REFERENCES venta(idVenta)
);

CREATE TABLE IF NOT EXISTS detalleFiado (
  idDetalleFiado INT AUTO_INCREMENT PRIMARY KEY,
  idFiado INT NOT NULL,
  idProducto INT NOT NULL,
  cantidad DECIMAL(10,2) NOT NULL,
  precio DECIMAL(10,2) NOT NULL,
  subtotal DECIMAL(10,2) NOT NULL,
  FOREIGN KEY (idFiado) REFERENCES fiado(idFiado),
  FOREIGN KEY (idProducto) REFERENCES producto(idProducto)
);

CREATE TABLE IF NOT EXISTS pagoFiado (
  idPagoFiado INT AUTO_INCREMENT PRIMARY KEY,
  idFiado INT NOT NULL,
  fechaPago DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  monto DECIMAL(10,2) NOT NULL,
  observacion VARCHAR(150) NULL,
  FOREIGN KEY (idFiado) REFERENCES fiado(idFiado)
);

INSERT INTO administrador (usuario, password)
VALUES ('admin', '$2a$10$7EqJtq98hPqEX7fNZaFWoOeQ332zUhl4WumDsN9JYXl4q4E9vE9h2')
ON DUPLICATE KEY UPDATE usuario = usuario;

INSERT INTO proveedor (nombre, telefono, direccion) VALUES
('Proveedor general', NULL, NULL)
ON DUPLICATE KEY UPDATE nombre = nombre;

INSERT INTO producto (nombre, idProveedor, categoria, unidadMedida, unidadesPorPaquete, paquetesPorCaja, precioVenta, stock, stockMinimo, stockUnidadesTotal, ultimoPrecioCompra, permiteVentaPorPaquete, permiteVentaPorUnidad) VALUES
('ARROZ', 1, 'ABARROTES', 'gramo', 1, 1, 0.01, 25000, 5000, 25000, 0.008, FALSE, TRUE),
('ACEITE', 1, 'ABARROTES', 'mililitro', 1, 1, 0.02, 12000, 3000, 12000, 0.015, FALSE, TRUE),
('SHAMPOO', 1, 'ASEO PERSONAL', 'unidad', 1, 1, 18.00, 8, 2, 8, 12.00, FALSE, TRUE),
('BEBIDA GASEOSA', 1, 'BEBIDAS', 'unidad', 1, 1, 10.00, 24, 6, 24, 7.00, FALSE, TRUE),
('PAPEL HIGIENICO', 1, 'ASEO PERSONAL', 'unidad', 12, 4, 2.00, 120, 24, 120, 1.20, TRUE, TRUE),
('SNACKS', 1, 'SNACKS', 'bolsa', 1, 1, 5.00, 30, 8, 30, 3.00, FALSE, TRUE)
ON DUPLICATE KEY UPDATE nombre = nombre;
