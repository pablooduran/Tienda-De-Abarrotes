-- Migracion segura: mejoras de productos, ventas fiadas y reportes.
--
-- Antes de ejecutar esta migracion, haga un respaldo de la base actual.
-- Ejemplo en terminal:
--   mysqldump -u usuario_mysql -p tienda_abarrotes > backup_tienda_abarrotes_antes_mejoras.sql
--
-- Si usa phpMyAdmin:
--   1. Abra la base tienda_abarrotes.
--   2. Entre a Exportar.
--   3. Elija formato SQL.
--   4. Guarde el archivo antes de ejecutar esta migracion.
--
-- Esta migracion conserva detalleFiado para compatibilidad con fiados antiguos.

USE tienda_abarrotes;

ALTER TABLE producto
  ADD COLUMN idProveedor INT NULL AFTER nombre,
  ADD COLUMN categoria VARCHAR(50) NOT NULL DEFAULT 'otros' AFTER idProveedor,
  ADD COLUMN unidadesPorPaquete INT NOT NULL DEFAULT 1 AFTER unidadMedida;

UPDATE producto
SET
  categoria = COALESCE(NULLIF(categoria, ''), 'otros'),
  unidadesPorPaquete = CASE WHEN unidadesPorPaquete IS NULL OR unidadesPorPaquete < 1 THEN 1 ELSE unidadesPorPaquete END,
  stock = CASE WHEN stock < 0 THEN 0 ELSE ROUND(stock) END,
  stockMinimo = CASE WHEN stockMinimo < 1 THEN 1 ELSE ROUND(stockMinimo) END;

ALTER TABLE producto
  MODIFY COLUMN stock INT NOT NULL DEFAULT 0,
  MODIFY COLUMN stockMinimo INT NOT NULL DEFAULT 5;

ALTER TABLE producto
  ADD CONSTRAINT fk_producto_proveedor
  FOREIGN KEY (idProveedor) REFERENCES proveedor(idProveedor);

ALTER TABLE venta
  ADD COLUMN tipo ENUM('pagada','fiada') NOT NULL DEFAULT 'pagada' AFTER total;

ALTER TABLE fiado
  ADD COLUMN idVenta INT NULL AFTER idCliente;

ALTER TABLE fiado
  ADD CONSTRAINT fk_fiado_venta
  FOREIGN KEY (idVenta) REFERENCES venta(idVenta);

-- Opcional: asocie productos existentes a proveedores reales desde el sistema.
-- Los productos sin proveedor quedan permitidos como NULL.
