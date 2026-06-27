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
  unidadMedida ENUM('unidad','paquete','kilo','gramo','litro','mililitro','caja','docena','bolsa') NOT NULL DEFAULT 'unidad',
  precioVenta DECIMAL(10,2) NOT NULL,
  stock DECIMAL(10,2) NOT NULL DEFAULT 0,
  stockMinimo DECIMAL(10,2) NOT NULL DEFAULT 5
);

CREATE TABLE IF NOT EXISTS venta (
  idVenta INT AUTO_INCREMENT PRIMARY KEY,
  fecha DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  total DECIMAL(10,2) NOT NULL,
  idCliente INT NULL,
  FOREIGN KEY (idCliente) REFERENCES cliente(idCliente)
);

CREATE TABLE IF NOT EXISTS detalleVenta (
  idDetalleVenta INT AUTO_INCREMENT PRIMARY KEY,
  idVenta INT NOT NULL,
  idProducto INT NOT NULL,
  cantidad DECIMAL(10,2) NOT NULL,
  precioVenta DECIMAL(10,2) NOT NULL,
  subtotal DECIMAL(10,2) NOT NULL,
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
  FOREIGN KEY (idCompra) REFERENCES compra(idCompra),
  FOREIGN KEY (idProducto) REFERENCES producto(idProducto)
);

CREATE TABLE IF NOT EXISTS fiado (
  idFiado INT AUTO_INCREMENT PRIMARY KEY,
  idCliente INT NOT NULL,
  fechaInicio DATE NOT NULL,
  totalFiado DECIMAL(10,2) NOT NULL DEFAULT 0,
  totalPagado DECIMAL(10,2) NOT NULL DEFAULT 0,
  saldoPendiente DECIMAL(10,2) NOT NULL DEFAULT 0,
  estado ENUM('pendiente','parcial','pagado') NOT NULL DEFAULT 'pendiente',
  FOREIGN KEY (idCliente) REFERENCES cliente(idCliente)
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

INSERT INTO producto (nombre, unidadMedida, precioVenta, stock, stockMinimo) VALUES
('Arroz', 'kilo', 8.50, 25.00, 5.00),
('Aceite', 'litro', 14.00, 12.00, 3.00),
('Shampoo', 'unidad', 18.00, 8.00, 2.00),
('Bebida gaseosa', 'unidad', 10.00, 24.00, 6.00),
('Papel higienico', 'paquete', 22.00, 10.00, 3.00),
('Snacks', 'bolsa', 5.00, 30.00, 8.00)
ON DUPLICATE KEY UPDATE nombre = nombre;
