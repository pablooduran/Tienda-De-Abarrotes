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
  KEY idx_productoMaestro_huella (huellaDuplicado)
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
  KEY idx_auditoriaCatalogo_entidad (entidad, idEntidad, creadoEn)
) ENGINE=InnoDB;

ALTER TABLE productoMaestro
  ADD CONSTRAINT fk_productoMaestro_categoria
  FOREIGN KEY (idCategoriaMaestra) REFERENCES categoriaMaestra(idCategoriaMaestra)
  ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE productoMaestro
  ADD CONSTRAINT fk_productoMaestro_marca
  FOREIGN KEY (idMarcaMaestra) REFERENCES marcaMaestra(idMarcaMaestra)
  ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE auditoriaCatalogo
  ADD CONSTRAINT fk_auditoriaCatalogo_admin
  FOREIGN KEY (idAdministrador) REFERENCES administrador(idAdministrador)
  ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE producto
  ADD COLUMN idProductoMaestro INT NULL AFTER idProveedor;

ALTER TABLE producto
  ADD INDEX idx_producto_productoMaestro (idProductoMaestro);

ALTER TABLE producto
  ADD UNIQUE INDEX uq_producto_tienda_maestro (idTienda, idProductoMaestro);

ALTER TABLE producto
  ADD CONSTRAINT fk_producto_productoMaestro
  FOREIGN KEY (idProductoMaestro) REFERENCES productoMaestro(idProductoMaestro)
  ON UPDATE CASCADE ON DELETE RESTRICT;

INSERT INTO funcionalidad (codigo, nombre, descripcion, activo)
VALUES ('catalogo_maestro', 'Catalogo maestro', 'Busqueda y alta guiada de productos desde el catalogo de plataforma.', 1)
ON DUPLICATE KEY UPDATE activo=1;

INSERT INTO planFuncionalidad (idPlan, idFuncionalidad, habilitada)
SELECT p.idPlan, f.idFuncionalidad, 1
FROM plan p
JOIN funcionalidad f ON f.codigo='catalogo_maestro'
WHERE p.codigo IN ('basico','avanzado')
ON DUPLICATE KEY UPDATE habilitada=1;
