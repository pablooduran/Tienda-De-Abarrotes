-- Configuracion base para inteligencia de inventario.
-- MySQL 8.0.46: migrate-db.js recupera individualmente columnas, indices y restricciones.

CREATE TABLE IF NOT EXISTS configuracionInventarioTienda (
  idTienda INT NOT NULL PRIMARY KEY
) ENGINE=InnoDB;

ALTER TABLE configuracionInventarioTienda
  ADD COLUMN periodoAnalisisDias INT NOT NULL DEFAULT 30 AFTER idTienda;
ALTER TABLE configuracionInventarioTienda
  ADD COLUMN diasHistorialMinimo INT NOT NULL DEFAULT 14 AFTER periodoAnalisisDias;
ALTER TABLE configuracionInventarioTienda
  ADD COLUMN diasReposicionDefault INT NOT NULL DEFAULT 3 AFTER diasHistorialMinimo;
ALTER TABLE configuracionInventarioTienda
  ADD COLUMN diasCoberturaDefault INT NOT NULL DEFAULT 14 AFTER diasReposicionDefault;
ALTER TABLE configuracionInventarioTienda
  ADD COLUMN diasProductoNuevo INT NOT NULL DEFAULT 30 AFTER diasCoberturaDefault;
ALTER TABLE configuracionInventarioTienda
  ADD COLUMN creadoEn DATETIME NULL AFTER diasProductoNuevo;
ALTER TABLE configuracionInventarioTienda
  ADD COLUMN actualizadoEn DATETIME NULL AFTER creadoEn;
ALTER TABLE configuracionInventarioTienda
  ADD COLUMN idAdministradorActualiza INT NULL AFTER actualizadoEn;

ALTER TABLE producto ADD COLUMN diasReposicion INT NULL AFTER stockMinimo;
ALTER TABLE producto ADD COLUMN diasCoberturaObjetivo INT NULL AFTER diasReposicion;
ALTER TABLE producto
  ADD COLUMN presentacionCompraSugerida ENUM('unidad','paquete') NULL AFTER diasCoberturaObjetivo;
ALTER TABLE producto
  ADD COLUMN fechaInicioSeguimiento DATETIME NULL AFTER presentacionCompraSugerida;

ALTER TABLE configuracionInventarioTienda
  ADD INDEX idx_configInventario_tienda_admin (idTienda, idAdministradorActualiza);
ALTER TABLE producto
  ADD INDEX idx_producto_tienda_inventario (idTienda, activo, stockUnidadesTotal, stockMinimo);
ALTER TABLE producto
  ADD INDEX idx_producto_tienda_categoria_activo (idTienda, categoria, activo);
ALTER TABLE producto
  ADD INDEX idx_producto_tienda_proveedor_activo (idTienda, idProveedor, activo);
ALTER TABLE producto
  ADD INDEX idx_producto_tienda_seguimiento (idTienda, fechaInicioSeguimiento);
ALTER TABLE detalleVenta
  ADD INDEX idx_detalleVenta_tienda_producto_venta (idTienda, idProducto, idVenta);
ALTER TABLE detalleCompra
  ADD INDEX idx_detalleCompra_tienda_producto_compra (idTienda, idProducto, idCompra);

ALTER TABLE configuracionInventarioTienda
  ADD CONSTRAINT chk_configInventario_periodos CHECK (
    periodoAnalisisDias BETWEEN 7 AND 365
    AND diasHistorialMinimo BETWEEN 1 AND periodoAnalisisDias
  );
ALTER TABLE configuracionInventarioTienda
  ADD CONSTRAINT chk_configInventario_reposicion CHECK (diasReposicionDefault BETWEEN 0 AND 365);
ALTER TABLE configuracionInventarioTienda
  ADD CONSTRAINT chk_configInventario_cobertura CHECK (diasCoberturaDefault BETWEEN 1 AND 365);
ALTER TABLE configuracionInventarioTienda
  ADD CONSTRAINT chk_configInventario_producto_nuevo CHECK (diasProductoNuevo BETWEEN 1 AND 365);
ALTER TABLE producto
  ADD CONSTRAINT chk_producto_dias_reposicion CHECK (diasReposicion IS NULL OR diasReposicion BETWEEN 0 AND 365);
ALTER TABLE producto
  ADD CONSTRAINT chk_producto_dias_cobertura CHECK (diasCoberturaObjetivo IS NULL OR diasCoberturaObjetivo BETWEEN 1 AND 365);

ALTER TABLE configuracionInventarioTienda
  ADD CONSTRAINT fk_configInventario_tienda FOREIGN KEY (idTienda)
    REFERENCES tienda(idTienda) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE configuracionInventarioTienda
  ADD CONSTRAINT fk_configInventario_administrador FOREIGN KEY (idTienda, idAdministradorActualiza)
    REFERENCES administrador(idTienda, idAdministrador) ON UPDATE RESTRICT ON DELETE RESTRICT;

SET @fecha_local_010 = __MIGRATION_LOCAL_DATETIME__;

UPDATE configuracionInventarioTienda
SET creadoEn=COALESCE(creadoEn, @fecha_local_010),
    actualizadoEn=COALESCE(actualizadoEn, @fecha_local_010)
WHERE creadoEn IS NULL OR actualizadoEn IS NULL;

UPDATE producto p
LEFT JOIN (
  SELECT idTienda, idProducto, MIN(creadoEn) AS primerMovimiento
  FROM movimientoStock
  GROUP BY idTienda, idProducto
) ms ON ms.idTienda=p.idTienda AND ms.idProducto=p.idProducto
SET p.fechaInicioSeguimiento=COALESCE(ms.primerMovimiento, @fecha_local_010)
WHERE p.fechaInicioSeguimiento IS NULL;

ALTER TABLE producto MODIFY COLUMN fechaInicioSeguimiento DATETIME NOT NULL;
ALTER TABLE configuracionInventarioTienda MODIFY COLUMN creadoEn DATETIME NOT NULL;
ALTER TABLE configuracionInventarioTienda MODIFY COLUMN actualizadoEn DATETIME NOT NULL;

INSERT INTO configuracionInventarioTienda
  (idTienda, periodoAnalisisDias, diasHistorialMinimo, diasReposicionDefault,
   diasCoberturaDefault, diasProductoNuevo, creadoEn, actualizadoEn)
SELECT t.idTienda, 30, 14, 3, 14, 30, @fecha_local_010, @fecha_local_010
FROM tienda t
WHERE NOT EXISTS (
  SELECT 1 FROM configuracionInventarioTienda c WHERE c.idTienda=t.idTienda
);

INSERT INTO funcionalidad (codigo, nombre, descripcion, activo) VALUES
  ('inventario_resumen', 'Resumen de inventario', 'Estado general y alertas esenciales del inventario.', 1),
  ('alertas_stock', 'Alertas de stock', 'Productos agotados, en minimo y con stock bajo.', 1),
  ('ranking_productos', 'Ranking de productos', 'Productos con mayor y menor movimiento comercial.', 1),
  ('valor_inventario_basico', 'Valor basico del inventario', 'Valor estimado del inventario a costo y venta.', 1),
  ('rotacion_inventario', 'Rotacion de inventario', 'Analisis de rotacion por producto y periodo.', 1),
  ('dias_cobertura', 'Dias de cobertura', 'Estimacion de dias restantes de inventario.', 1),
  ('inventario_sin_movimiento', 'Inventario sin movimiento', 'Deteccion de productos nuevos o sin ventas recientes.', 1),
  ('exportacion_inventario', 'Exportacion de inventario', 'Exportacion de analisis detallado del inventario.', 1)
ON DUPLICATE KEY UPDATE activo=1;

INSERT INTO funcionalidad (codigo, nombre, descripcion, activo)
VALUES ('compras_sugeridas', 'Compras sugeridas', 'Sugerencias de abastecimiento segun rotacion.', 1)
ON DUPLICATE KEY UPDATE activo=1;

INSERT INTO planFuncionalidad (idPlan, idFuncionalidad, habilitada)
SELECT p.idPlan, f.idFuncionalidad, 1
FROM plan p
JOIN funcionalidad f ON f.codigo IN (
  'inventario_resumen','alertas_stock','ranking_productos','valor_inventario_basico'
)
WHERE p.codigo IN ('basico','avanzado')
ON DUPLICATE KEY UPDATE habilitada=1;

INSERT INTO planFuncionalidad (idPlan, idFuncionalidad, habilitada)
SELECT p.idPlan, f.idFuncionalidad, 1
FROM plan p
JOIN funcionalidad f ON f.codigo IN (
  'rotacion_inventario','dias_cobertura','inventario_sin_movimiento','exportacion_inventario'
)
WHERE p.codigo='avanzado'
ON DUPLICATE KEY UPDATE habilitada=1;

INSERT INTO planFuncionalidad (idPlan, idFuncionalidad, habilitada)
SELECT p.idPlan, f.idFuncionalidad, 1
FROM plan p
JOIN funcionalidad f ON f.codigo='compras_sugeridas'
WHERE p.codigo='avanzado'
  AND NOT EXISTS (
    SELECT 1 FROM planFuncionalidad pf
    WHERE pf.idPlan=p.idPlan AND pf.idFuncionalidad=f.idFuncionalidad
  );
