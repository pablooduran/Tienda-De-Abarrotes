-- Migracion segura: stock por caja/paquete/unidad, ganancias, filtros y reportes.
--
-- Antes de ejecutar:
--   mysqldump -u usuario_mysql -p tienda_abarrotes > backup_tienda_abarrotes_antes_002.sql
--
-- Si usa phpMyAdmin, exporte la base completa en formato SQL antes de continuar.

USE tienda_abarrotes;

ALTER TABLE producto
  ADD COLUMN IF NOT EXISTS paquetesPorCaja INT NOT NULL DEFAULT 1 AFTER unidadesPorPaquete,
  ADD COLUMN IF NOT EXISTS stockUnidadesTotal INT NOT NULL DEFAULT 0 AFTER stockMinimo,
  ADD COLUMN IF NOT EXISTS ultimoPrecioCompra DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER stockUnidadesTotal,
  ADD COLUMN IF NOT EXISTS permiteVentaPorPaquete BOOLEAN NOT NULL DEFAULT TRUE AFTER ultimoPrecioCompra,
  ADD COLUMN IF NOT EXISTS permiteVentaPorUnidad BOOLEAN NOT NULL DEFAULT TRUE AFTER permiteVentaPorPaquete;

UPDATE producto
SET
  nombre = UPPER(nombre),
  categoria = UPPER(COALESCE(NULLIF(categoria, ''), 'OTROS')),
  paquetesPorCaja = CASE WHEN paquetesPorCaja < 1 THEN 1 ELSE paquetesPorCaja END,
  unidadesPorPaquete = CASE WHEN unidadesPorPaquete < 1 THEN 1 ELSE unidadesPorPaquete END,
  stock = CASE WHEN stock < 0 THEN 0 ELSE stock END,
  stockMinimo = CASE WHEN stockMinimo < 1 THEN 1 ELSE stockMinimo END,
  stockUnidadesTotal = CASE WHEN stockUnidadesTotal > 0 THEN stockUnidadesTotal ELSE stock END,
  permiteVentaPorPaquete = CASE WHEN unidadesPorPaquete > 1 THEN permiteVentaPorPaquete ELSE FALSE END,
  permiteVentaPorUnidad = TRUE;

ALTER TABLE detalleVenta
  ADD COLUMN IF NOT EXISTS costoUnitario DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER precioVenta,
  ADD COLUMN IF NOT EXISTS subtotalCosto DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER subtotal,
  ADD COLUMN IF NOT EXISTS ganancia DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER subtotalCosto,
  ADD COLUMN IF NOT EXISTS presentacionVenta VARCHAR(30) NOT NULL DEFAULT 'unidad' AFTER ganancia,
  ADD COLUMN IF NOT EXISTS cantidadEquivalenteUnidades INT NOT NULL DEFAULT 0 AFTER presentacionVenta;

UPDATE detalleVenta dv
JOIN producto p ON p.idProducto = dv.idProducto
SET
  dv.costoUnitario = COALESCE(NULLIF(dv.costoUnitario, 0), p.ultimoPrecioCompra, 0),
  dv.cantidadEquivalenteUnidades = CASE WHEN dv.cantidadEquivalenteUnidades > 0 THEN dv.cantidadEquivalenteUnidades ELSE ROUND(dv.cantidad) END,
  dv.subtotalCosto = COALESCE(NULLIF(dv.subtotalCosto, 0), COALESCE(p.ultimoPrecioCompra, 0) * ROUND(dv.cantidad)),
  dv.ganancia = dv.subtotal - COALESCE(NULLIF(dv.subtotalCosto, 0), COALESCE(p.ultimoPrecioCompra, 0) * ROUND(dv.cantidad));

ALTER TABLE detalleCompra
  ADD COLUMN IF NOT EXISTS presentacionCompra VARCHAR(30) NOT NULL DEFAULT 'unidad' AFTER subtotal,
  ADD COLUMN IF NOT EXISTS cantidadEquivalenteUnidades INT NOT NULL DEFAULT 0 AFTER presentacionCompra;

UPDATE detalleCompra
SET cantidadEquivalenteUnidades = CASE WHEN cantidadEquivalenteUnidades > 0 THEN cantidadEquivalenteUnidades ELSE ROUND(cantidad) END;
