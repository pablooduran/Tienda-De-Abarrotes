-- Finanzas, gastos, costo historico y cierre de caja opcional.
-- MySQL 8.0.46: cada elemento ALTER se recupera individualmente desde migrate-db.js.

ALTER TABLE detalleVenta
  ADD COLUMN origenCosto ENUM('real','estimado','desconocido') NOT NULL DEFAULT 'desconocido' AFTER ganancia;

CREATE TABLE IF NOT EXISTS categoriaGasto (
  idCategoriaGasto INT AUTO_INCREMENT PRIMARY KEY
) ENGINE=InnoDB;

ALTER TABLE categoriaGasto ADD COLUMN idTienda INT NOT NULL AFTER idCategoriaGasto;
ALTER TABLE categoriaGasto ADD COLUMN nombre VARCHAR(100) NOT NULL AFTER idTienda;
ALTER TABLE categoriaGasto ADD COLUMN nombreNormalizado VARCHAR(120) NOT NULL AFTER nombre;
ALTER TABLE categoriaGasto ADD COLUMN descripcion VARCHAR(255) NULL AFTER nombreNormalizado;
ALTER TABLE categoriaGasto ADD COLUMN activo TINYINT(1) NOT NULL DEFAULT 1 AFTER descripcion;
ALTER TABLE categoriaGasto ADD COLUMN creadoEn DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER activo;
ALTER TABLE categoriaGasto ADD COLUMN actualizadoEn DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER creadoEn;
ALTER TABLE categoriaGasto ADD UNIQUE INDEX uq_categoriaGasto_tienda_id (idTienda, idCategoriaGasto);
ALTER TABLE categoriaGasto ADD UNIQUE INDEX uq_categoriaGasto_tienda_normalizada (idTienda, nombreNormalizado);
ALTER TABLE categoriaGasto ADD INDEX idx_categoriaGasto_tienda_activo_nombre (idTienda, activo, nombre);
ALTER TABLE categoriaGasto ADD CONSTRAINT fk_categoriaGasto_tienda
  FOREIGN KEY (idTienda) REFERENCES tienda(idTienda) ON UPDATE RESTRICT ON DELETE RESTRICT;

CREATE TABLE IF NOT EXISTS gasto (
  idGasto BIGINT AUTO_INCREMENT PRIMARY KEY
) ENGINE=InnoDB;

ALTER TABLE gasto ADD COLUMN idTienda INT NOT NULL AFTER idGasto;
ALTER TABLE gasto ADD COLUMN idCategoriaGasto INT NOT NULL AFTER idTienda;
ALTER TABLE gasto ADD COLUMN idAdministrador INT NOT NULL AFTER idCategoriaGasto;
ALTER TABLE gasto ADD COLUMN idAdministradorModifica INT NULL AFTER idAdministrador;
ALTER TABLE gasto ADD COLUMN idAdministradorAnula INT NULL AFTER idAdministradorModifica;
ALTER TABLE gasto ADD COLUMN fechaGasto DATETIME NOT NULL AFTER idAdministradorAnula;
ALTER TABLE gasto ADD COLUMN concepto VARCHAR(160) NOT NULL AFTER fechaGasto;
ALTER TABLE gasto ADD COLUMN monto DECIMAL(12,2) NOT NULL AFTER concepto;
ALTER TABLE gasto ADD COLUMN metodoPago ENUM('efectivo','qr','transferencia','otro') NOT NULL AFTER monto;
ALTER TABLE gasto ADD COLUMN referencia VARCHAR(120) NULL AFTER metodoPago;
ALTER TABLE gasto ADD COLUMN observacion VARCHAR(500) NULL AFTER referencia;
ALTER TABLE gasto ADD COLUMN recurrente TINYINT(1) NOT NULL DEFAULT 0 AFTER observacion;
ALTER TABLE gasto ADD COLUMN estado ENUM('registrado','anulado') NOT NULL DEFAULT 'registrado' AFTER recurrente;
ALTER TABLE gasto ADD COLUMN motivoAnulacion VARCHAR(300) NULL AFTER estado;
ALTER TABLE gasto ADD COLUMN creadoEn DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER motivoAnulacion;
ALTER TABLE gasto ADD COLUMN actualizadoEn DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER creadoEn;
ALTER TABLE gasto ADD COLUMN anuladoEn DATETIME NULL AFTER actualizadoEn;
ALTER TABLE gasto ADD UNIQUE INDEX uq_gasto_tienda_id (idTienda, idGasto);
ALTER TABLE gasto ADD INDEX idx_gasto_tienda_fecha_estado (idTienda, fechaGasto, estado);
ALTER TABLE gasto ADD INDEX idx_gasto_tienda_categoria_fecha (idTienda, idCategoriaGasto, fechaGasto);
ALTER TABLE gasto ADD INDEX idx_gasto_tienda_metodo_fecha (idTienda, metodoPago, fechaGasto);
ALTER TABLE gasto ADD CONSTRAINT chk_gasto_monto CHECK (monto > 0);
ALTER TABLE gasto ADD CONSTRAINT chk_gasto_estado CHECK (
  (estado='registrado' AND anuladoEn IS NULL AND idAdministradorAnula IS NULL AND motivoAnulacion IS NULL)
  OR (estado='anulado' AND anuladoEn IS NOT NULL AND idAdministradorAnula IS NOT NULL AND motivoAnulacion IS NOT NULL)
);
ALTER TABLE gasto ADD CONSTRAINT fk_gasto_tienda
  FOREIGN KEY (idTienda) REFERENCES tienda(idTienda) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE gasto ADD CONSTRAINT fk_gasto_categoria
  FOREIGN KEY (idTienda, idCategoriaGasto) REFERENCES categoriaGasto(idTienda, idCategoriaGasto) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE gasto ADD CONSTRAINT fk_gasto_creador
  FOREIGN KEY (idTienda, idAdministrador) REFERENCES administrador(idTienda, idAdministrador) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE gasto ADD CONSTRAINT fk_gasto_modificador
  FOREIGN KEY (idTienda, idAdministradorModifica) REFERENCES administrador(idTienda, idAdministrador) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE gasto ADD CONSTRAINT fk_gasto_anulador
  FOREIGN KEY (idTienda, idAdministradorAnula) REFERENCES administrador(idTienda, idAdministrador) ON UPDATE RESTRICT ON DELETE RESTRICT;

CREATE TABLE IF NOT EXISTS cierreCaja (
  idCierreCaja BIGINT AUTO_INCREMENT PRIMARY KEY
) ENGINE=InnoDB;

ALTER TABLE cierreCaja ADD COLUMN idTienda INT NOT NULL AFTER idCierreCaja;
ALTER TABLE cierreCaja ADD COLUMN idAdministrador INT NOT NULL AFTER idTienda;
ALTER TABLE cierreCaja ADD COLUMN idAdministradorAnula INT NULL AFTER idAdministrador;
ALTER TABLE cierreCaja ADD COLUMN fechaInicio DATETIME NOT NULL AFTER idAdministradorAnula;
ALTER TABLE cierreCaja ADD COLUMN fechaFin DATETIME NOT NULL AFTER fechaInicio;
ALTER TABLE cierreCaja ADD COLUMN efectivoInicial DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER fechaFin;
ALTER TABLE cierreCaja ADD COLUMN efectivoVentasEsperado DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER efectivoInicial;
ALTER TABLE cierreCaja ADD COLUMN efectivoFiadosCobrado DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER efectivoVentasEsperado;
ALTER TABLE cierreCaja ADD COLUMN gastosEfectivo DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER efectivoFiadosCobrado;
ALTER TABLE cierreCaja ADD COLUMN efectivoEsperado DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER gastosEfectivo;
ALTER TABLE cierreCaja ADD COLUMN efectivoContado DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER efectivoEsperado;
ALTER TABLE cierreCaja ADD COLUMN diferencia DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER efectivoContado;
ALTER TABLE cierreCaja ADD COLUMN totalQR DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER diferencia;
ALTER TABLE cierreCaja ADD COLUMN totalNoEspecificado DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER totalQR;
ALTER TABLE cierreCaja ADD COLUMN totalCobrado DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER totalNoEspecificado;
ALTER TABLE cierreCaja ADD COLUMN totalVentas DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER totalCobrado;
ALTER TABLE cierreCaja ADD COLUMN totalFiadoGenerado DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER totalVentas;
ALTER TABLE cierreCaja ADD COLUMN totalGastos DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER totalFiadoGenerado;
ALTER TABLE cierreCaja ADD COLUMN totalCompras DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER totalGastos;
ALTER TABLE cierreCaja ADD COLUMN observacion VARCHAR(500) NULL AFTER totalCompras;
ALTER TABLE cierreCaja ADD COLUMN estado ENUM('cerrado','anulado') NOT NULL DEFAULT 'cerrado' AFTER observacion;
ALTER TABLE cierreCaja ADD COLUMN motivoAnulacion VARCHAR(300) NULL AFTER estado;
ALTER TABLE cierreCaja ADD COLUMN claveOperacion VARCHAR(64) NOT NULL AFTER motivoAnulacion;
ALTER TABLE cierreCaja ADD COLUMN creadoEn DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER claveOperacion;
ALTER TABLE cierreCaja ADD COLUMN anuladoEn DATETIME NULL AFTER creadoEn;
ALTER TABLE cierreCaja ADD UNIQUE INDEX uq_cierreCaja_tienda_id (idTienda, idCierreCaja);
ALTER TABLE cierreCaja ADD UNIQUE INDEX uq_cierreCaja_tienda_clave (idTienda, claveOperacion);
ALTER TABLE cierreCaja ADD INDEX idx_cierreCaja_tienda_estado_periodo (idTienda, estado, fechaInicio, fechaFin);
ALTER TABLE cierreCaja ADD INDEX idx_cierreCaja_tienda_admin_fecha (idTienda, idAdministrador, creadoEn);
ALTER TABLE cierreCaja ADD CONSTRAINT chk_cierreCaja_periodo CHECK (fechaFin > fechaInicio);
ALTER TABLE cierreCaja ADD CONSTRAINT chk_cierreCaja_montos CHECK (
  efectivoInicial>=0 AND efectivoVentasEsperado>=0 AND efectivoFiadosCobrado>=0
  AND gastosEfectivo>=0 AND efectivoEsperado>=0 AND efectivoContado>=0
  AND totalQR>=0 AND totalNoEspecificado>=0 AND totalCobrado>=0 AND totalVentas>=0
  AND totalFiadoGenerado>=0 AND totalGastos>=0 AND totalCompras>=0
);
ALTER TABLE cierreCaja ADD CONSTRAINT chk_cierreCaja_balance CHECK (
  ABS(efectivoEsperado-(efectivoInicial+efectivoVentasEsperado+efectivoFiadosCobrado-gastosEfectivo))<0.01
  AND ABS(diferencia-(efectivoContado-efectivoEsperado))<0.01
);
ALTER TABLE cierreCaja ADD CONSTRAINT chk_cierreCaja_estado CHECK (
  (estado='cerrado' AND anuladoEn IS NULL AND idAdministradorAnula IS NULL AND motivoAnulacion IS NULL)
  OR (estado='anulado' AND anuladoEn IS NOT NULL AND idAdministradorAnula IS NOT NULL AND motivoAnulacion IS NOT NULL)
);
ALTER TABLE cierreCaja ADD CONSTRAINT fk_cierreCaja_tienda
  FOREIGN KEY (idTienda) REFERENCES tienda(idTienda) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE cierreCaja ADD CONSTRAINT fk_cierreCaja_creador
  FOREIGN KEY (idTienda, idAdministrador) REFERENCES administrador(idTienda, idAdministrador) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE cierreCaja ADD CONSTRAINT fk_cierreCaja_anulador
  FOREIGN KEY (idTienda, idAdministradorAnula) REFERENCES administrador(idTienda, idAdministrador) ON UPDATE RESTRICT ON DELETE RESTRICT;

UPDATE detalleVenta d
LEFT JOIN movimientoStock m
  ON m.idTienda=d.idTienda AND m.idDetalleVenta=d.idDetalleVenta AND m.origen='venta'
SET d.origenCosto=CASE
  WHEN d.costoUnitario<=0 OR d.cantidadEquivalenteUnidades<=0 THEN 'desconocido'
  WHEN m.idMovimientoStock IS NOT NULL THEN 'real'
  ELSE 'estimado'
END
WHERE d.origenCosto='desconocido';

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

INSERT INTO funcionalidad (codigo, nombre, descripcion, activo)
VALUES ('reportes_financieros', 'Reportes financieros', 'Resumen de ventas, cobros, costos, gastos y ganancias.', 1)
ON DUPLICATE KEY UPDATE activo=1;

INSERT INTO funcionalidad (codigo, nombre, descripcion, activo)
VALUES ('rentabilidad_producto', 'Rentabilidad por producto', 'Analisis detallado de costo, margen y ganancia por producto.', 1)
ON DUPLICATE KEY UPDATE activo=1;

INSERT INTO funcionalidad (codigo, nombre, descripcion, activo)
VALUES ('exportacion_reportes', 'Exportacion de reportes', 'Exportacion segura de reportes financieros en Excel.', 1)
ON DUPLICATE KEY UPDATE activo=1;

INSERT INTO funcionalidad (codigo, nombre, descripcion, activo)
VALUES ('dashboard_financiero', 'Dashboard financiero', 'Indicadores de ventas, cobros, costos y gastos.', 1)
ON DUPLICATE KEY UPDATE activo=1;

INSERT INTO planFuncionalidad (idPlan, idFuncionalidad, habilitada)
SELECT p.idPlan, f.idFuncionalidad, 1
FROM plan p
JOIN funcionalidad f ON f.codigo IN ('gastos','reportes_financieros','exportacion_reportes','dashboard_financiero')
WHERE p.codigo IN ('basico','avanzado')
ON DUPLICATE KEY UPDATE habilitada=1;

INSERT INTO planFuncionalidad (idPlan, idFuncionalidad, habilitada)
SELECT p.idPlan, f.idFuncionalidad, 1
FROM plan p
JOIN funcionalidad f ON f.codigo IN ('rentabilidad_producto','cierre_caja')
WHERE p.codigo='avanzado'
ON DUPLICATE KEY UPDATE habilitada=1;
