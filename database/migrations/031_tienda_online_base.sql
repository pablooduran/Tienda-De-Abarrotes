-- Base de tienda online por enlace publico. No crea pedidos ni modifica stock.

CREATE TABLE IF NOT EXISTS configuracionTiendaOnline (
  idTienda INT NOT NULL,
  activa TINYINT(1) NOT NULL DEFAULT 0,
  mensajeBienvenida VARCHAR(300) NULL,
  permiteRecojo TINYINT(1) NOT NULL DEFAULT 1,
  permiteEntrega TINYINT(1) NOT NULL DEFAULT 0,
  permiteEfectivo TINYINT(1) NOT NULL DEFAULT 1,
  permiteQr TINYINT(1) NOT NULL DEFAULT 0,
  pedidoMinimo DECIMAL(12,2) NOT NULL DEFAULT 0,
  costoEntrega DECIMAL(12,2) NOT NULL DEFAULT 0,
  tiempoPreparacionMinutos SMALLINT UNSIGNED NOT NULL DEFAULT 30,
  creadoEn DATETIME NOT NULL,
  actualizadoEn DATETIME NOT NULL,
  idAdministradorActualiza INT NULL,
  PRIMARY KEY (idTienda),
  KEY idx_configTiendaOnline_admin (idTienda,idAdministradorActualiza),
  CONSTRAINT chk_configTiendaOnline_booleanos CHECK (
    activa IN (0,1) AND permiteRecojo IN (0,1) AND permiteEntrega IN (0,1)
    AND permiteEfectivo IN (0,1) AND permiteQr IN (0,1)
  ),
  CONSTRAINT chk_configTiendaOnline_importes CHECK (pedidoMinimo>=0 AND costoEntrega>=0),
  CONSTRAINT chk_configTiendaOnline_preparacion CHECK (tiempoPreparacionMinutos BETWEEN 5 AND 1440),
  CONSTRAINT fk_configTiendaOnline_tienda FOREIGN KEY (idTienda)
    REFERENCES tienda(idTienda) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_configTiendaOnline_admin FOREIGN KEY (idTienda,idAdministradorActualiza)
    REFERENCES administrador(idTienda,idAdministrador) ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS productoCatalogoOnline (
  idTienda INT NOT NULL,
  idProducto INT NOT NULL,
  publicado TINYINT(1) NOT NULL DEFAULT 0,
  destacado TINYINT(1) NOT NULL DEFAULT 0,
  descripcionPublica VARCHAR(300) NULL,
  cantidadMaximaPedido INT NULL,
  permiteSustitucion TINYINT(1) NOT NULL DEFAULT 0,
  creadoEn DATETIME NOT NULL,
  actualizadoEn DATETIME NOT NULL,
  idAdministradorActualiza INT NULL,
  PRIMARY KEY (idTienda,idProducto),
  KEY idx_productoCatalogoOnline_publicado (idTienda,publicado,destacado,idProducto),
  KEY idx_productoCatalogoOnline_admin (idTienda,idAdministradorActualiza),
  CONSTRAINT chk_productoCatalogoOnline_booleanos CHECK (
    publicado IN (0,1) AND destacado IN (0,1) AND permiteSustitucion IN (0,1)
  ),
  CONSTRAINT chk_productoCatalogoOnline_cantidad CHECK (
    cantidadMaximaPedido IS NULL OR cantidadMaximaPedido BETWEEN 1 AND 10000
  ),
  CONSTRAINT fk_productoCatalogoOnline_producto FOREIGN KEY (idTienda,idProducto)
    REFERENCES producto(idTienda,idProducto) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_productoCatalogoOnline_admin FOREIGN KEY (idTienda,idAdministradorActualiza)
    REFERENCES administrador(idTienda,idAdministrador) ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB;

INSERT INTO configuracionTiendaOnline
  (idTienda,activa,mensajeBienvenida,permiteRecojo,permiteEntrega,
   permiteEfectivo,permiteQr,pedidoMinimo,costoEntrega,tiempoPreparacionMinutos,
   creadoEn,actualizadoEn,idAdministradorActualiza)
SELECT t.idTienda,0,NULL,1,0,1,0,0,0,30,NOW(),NOW(),NULL
FROM tienda t
WHERE NOT EXISTS (
  SELECT 1 FROM configuracionTiendaOnline c WHERE c.idTienda=t.idTienda
);

INSERT INTO funcionalidad (codigo,nombre,descripcion,activo)
VALUES ('portal_clientes','Tienda online','Catálogo público y pedidos mediante el enlace de la tienda.',1)
ON DUPLICATE KEY UPDATE
  nombre=VALUES(nombre),descripcion=VALUES(descripcion),activo=VALUES(activo);

INSERT INTO planFuncionalidad (idPlan,idFuncionalidad,habilitada)
SELECT p.idPlan,f.idFuncionalidad,CASE WHEN p.codigo IN ('standard','pro') THEN 1 ELSE 0 END
FROM plan p
JOIN funcionalidad f ON f.codigo='portal_clientes'
WHERE p.codigo IN ('basico','standard','pro')
ON DUPLICATE KEY UPDATE habilitada=VALUES(habilitada);

DELETE sf
FROM suscripcionFuncionalidadSnapshot sf
JOIN suscripcionTienda s
  ON s.idTienda=sf.idTienda AND s.idSuscripcion=sf.idSuscripcion
JOIN plan p ON p.idPlan=s.idPlan
WHERE sf.codigoFuncionalidad='portal_clientes'
  AND p.codigo IN ('basico','standard','pro')
  AND s.estado IN ('activa','gracia');

INSERT INTO suscripcionFuncionalidadSnapshot
  (idTienda,idSuscripcion,codigoFuncionalidad,nombreFuncionalidad,creadoEn)
SELECT s.idTienda,s.idSuscripcion,f.codigo,f.nombre,NOW()
FROM suscripcionTienda s
JOIN plan p ON p.idPlan=s.idPlan AND p.codigo IN ('standard','pro')
JOIN planFuncionalidad pf ON pf.idPlan=p.idPlan AND pf.habilitada=1
JOIN funcionalidad f ON f.idFuncionalidad=pf.idFuncionalidad
  AND f.codigo='portal_clientes' AND f.activo=1
WHERE s.estado IN ('activa','gracia');
