-- Fase 9B: estructura base para lotes y vencimientos.
-- MySQL 8.0.46: migrate-db.js recupera cada elemento ALTER de forma individual.

SET @fecha_local_011 = __MIGRATION_LOCAL_DATETIME__;

ALTER TABLE configuracionInventarioTienda
  ADD COLUMN diasAlertaVencimientoDefault INT NOT NULL DEFAULT 30 AFTER diasProductoNuevo;

ALTER TABLE producto
  ADD COLUMN controlaLotes TINYINT(1) NOT NULL DEFAULT 0 AFTER stockMinimo;

ALTER TABLE producto
  ADD COLUMN controlaVencimiento TINYINT(1) NOT NULL DEFAULT 0 AFTER controlaLotes;

ALTER TABLE producto
  ADD COLUMN diasAlertaVencimiento INT NULL AFTER controlaVencimiento;

ALTER TABLE producto
  ADD COLUMN lotesActivadosEn DATETIME NULL AFTER diasAlertaVencimiento;

ALTER TABLE producto
  MODIFY COLUMN ultimoPrecioCompra DECIMAL(14,6) NOT NULL DEFAULT 0;

ALTER TABLE detalleVenta
  MODIFY COLUMN costoUnitario DECIMAL(14,6) NOT NULL DEFAULT 0;

ALTER TABLE detalleCompra
  ADD UNIQUE INDEX uq_detalleCompra_tienda_producto_id (idTienda, idProducto, idDetalleCompra);

ALTER TABLE movimientoStock
  ADD UNIQUE INDEX uq_movimiento_tienda_producto_id (idTienda, idProducto, idMovimientoStock);

ALTER TABLE configuracionInventarioTienda
  ADD CONSTRAINT chk_configInventario_alerta_vencimiento
    CHECK (diasAlertaVencimientoDefault BETWEEN 1 AND 365);

ALTER TABLE producto
  ADD CONSTRAINT chk_producto_controla_lotes
    CHECK (controlaLotes IN (0,1));

ALTER TABLE producto
  ADD CONSTRAINT chk_producto_controla_vencimiento
    CHECK (controlaVencimiento IN (0,1));

ALTER TABLE producto
  ADD CONSTRAINT chk_producto_vencimiento_requiere_lotes
    CHECK (controlaVencimiento=0 OR controlaLotes=1);

ALTER TABLE producto
  ADD CONSTRAINT chk_producto_dias_alerta_vencimiento
    CHECK (diasAlertaVencimiento IS NULL OR diasAlertaVencimiento BETWEEN 1 AND 365);

ALTER TABLE producto
  ADD CONSTRAINT chk_producto_lotes_activacion
    CHECK (
      (controlaLotes=0 AND lotesActivadosEn IS NULL)
      OR (controlaLotes=1 AND lotesActivadosEn IS NOT NULL)
    );

CREATE TABLE IF NOT EXISTS loteProducto (
  idLoteProducto BIGINT NOT NULL AUTO_INCREMENT,
  idTienda INT NOT NULL,
  idProducto INT NOT NULL,
  idProveedor INT NULL,
  idDetalleCompra INT NULL,
  codigoLote VARCHAR(80) NULL,
  origen ENUM('compra','distribucion_inicial','ajuste_positivo','reversion') NOT NULL,
  fechaIngreso DATETIME NOT NULL,
  fechaVencimiento DATE NULL,
  cantidadInicial INT NOT NULL,
  cantidadRestante INT NOT NULL,
  costoUnitarioBase DECIMAL(14,6) NULL,
  estadoOperativo ENUM('disponible','bloqueado','anulado') NOT NULL DEFAULT 'disponible',
  claveOperacion VARCHAR(160) NOT NULL,
  creadoEn DATETIME NOT NULL,
  actualizadoEn DATETIME NOT NULL,
  idAdministradorCrea INT NOT NULL,
  idAdministradorActualiza INT NULL,
  PRIMARY KEY (idLoteProducto)
) ENGINE=InnoDB;

ALTER TABLE loteProducto
  ADD UNIQUE INDEX uq_lote_tienda_producto_id (idTienda, idProducto, idLoteProducto);

ALTER TABLE loteProducto
  ADD UNIQUE INDEX uq_lote_tienda_clave (idTienda, claveOperacion);

ALTER TABLE loteProducto
  ADD INDEX idx_lote_tienda_producto_estado_vencimiento
    (idTienda, idProducto, estadoOperativo, fechaVencimiento);

ALTER TABLE loteProducto
  ADD INDEX idx_lote_tienda_producto_ingreso
    (idTienda, idProducto, fechaIngreso, idLoteProducto);

ALTER TABLE loteProducto
  ADD INDEX idx_lote_tienda_proveedor_ingreso
    (idTienda, idProveedor, fechaIngreso);

ALTER TABLE loteProducto
  ADD INDEX idx_lote_tienda_detalleCompra (idTienda, idDetalleCompra);

ALTER TABLE loteProducto
  ADD INDEX idx_lote_tienda_codigo (idTienda, codigoLote);

ALTER TABLE loteProducto
  ADD INDEX idx_lote_tienda_estado_vencimiento
    (idTienda, estadoOperativo, fechaVencimiento);

ALTER TABLE loteProducto
  ADD CONSTRAINT chk_lote_cantidades
    CHECK (cantidadInicial>0 AND cantidadRestante>=0 AND cantidadRestante<=cantidadInicial);

ALTER TABLE loteProducto
  ADD CONSTRAINT chk_lote_costo
    CHECK (costoUnitarioBase IS NULL OR costoUnitarioBase>=0);

ALTER TABLE loteProducto
  ADD CONSTRAINT chk_lote_fecha_vencimiento
    CHECK (fechaVencimiento IS NULL OR fechaVencimiento>=DATE(fechaIngreso));

ALTER TABLE loteProducto
  ADD CONSTRAINT chk_lote_codigo
    CHECK (codigoLote IS NULL OR CHAR_LENGTH(TRIM(codigoLote))>0);

ALTER TABLE loteProducto
  ADD CONSTRAINT chk_lote_origen_detalle
    CHECK (
      (origen='compra' AND idDetalleCompra IS NOT NULL)
      OR (origen<>'compra' AND idDetalleCompra IS NULL)
    );

ALTER TABLE loteProducto
  ADD CONSTRAINT chk_lote_anulado_sin_saldo
    CHECK (estadoOperativo<>'anulado' OR cantidadRestante=0);

ALTER TABLE loteProducto
  ADD CONSTRAINT fk_lote_tienda FOREIGN KEY (idTienda)
    REFERENCES tienda(idTienda) ON UPDATE RESTRICT ON DELETE RESTRICT;

ALTER TABLE loteProducto
  ADD CONSTRAINT fk_lote_producto FOREIGN KEY (idTienda, idProducto)
    REFERENCES producto(idTienda, idProducto) ON UPDATE RESTRICT ON DELETE RESTRICT;

ALTER TABLE loteProducto
  ADD CONSTRAINT fk_lote_proveedor FOREIGN KEY (idTienda, idProveedor)
    REFERENCES proveedor(idTienda, idProveedor) ON UPDATE RESTRICT ON DELETE RESTRICT;

ALTER TABLE loteProducto
  ADD CONSTRAINT fk_lote_detalleCompra FOREIGN KEY (idTienda, idProducto, idDetalleCompra)
    REFERENCES detalleCompra(idTienda, idProducto, idDetalleCompra)
    ON UPDATE RESTRICT ON DELETE RESTRICT;

ALTER TABLE loteProducto
  ADD CONSTRAINT fk_lote_admin_crea FOREIGN KEY (idTienda, idAdministradorCrea)
    REFERENCES administrador(idTienda, idAdministrador) ON UPDATE RESTRICT ON DELETE RESTRICT;

ALTER TABLE loteProducto
  ADD CONSTRAINT fk_lote_admin_actualiza FOREIGN KEY (idTienda, idAdministradorActualiza)
    REFERENCES administrador(idTienda, idAdministrador) ON UPDATE RESTRICT ON DELETE RESTRICT;

CREATE TABLE IF NOT EXISTS movimientoLote (
  idMovimientoLote BIGINT NOT NULL AUTO_INCREMENT,
  idTienda INT NOT NULL,
  idProducto INT NOT NULL,
  idLoteProducto BIGINT NOT NULL,
  idMovimientoStock BIGINT NULL,
  tipoRegistro ENUM('movimiento_stock','distribucion_inicial') NOT NULL,
  cantidad INT NOT NULL,
  cantidadAnterior INT NOT NULL,
  cantidadPosterior INT NOT NULL,
  claveOperacion VARCHAR(160) NOT NULL,
  creadoEn DATETIME NOT NULL,
  idAdministrador INT NOT NULL,
  PRIMARY KEY (idMovimientoLote)
) ENGINE=InnoDB;

ALTER TABLE movimientoLote
  ADD UNIQUE INDEX uq_movimientoLote_tienda_clave (idTienda, claveOperacion);

ALTER TABLE movimientoLote
  ADD INDEX idx_movimientoLote_tienda_lote_fecha
    (idTienda, idLoteProducto, creadoEn);

ALTER TABLE movimientoLote
  ADD INDEX idx_movimientoLote_tienda_movimiento
    (idTienda, idMovimientoStock);

ALTER TABLE movimientoLote
  ADD INDEX idx_movimientoLote_tienda_producto_fecha
    (idTienda, idProducto, creadoEn);

ALTER TABLE movimientoLote
  ADD INDEX idx_movimientoLote_tienda_tipo_fecha
    (idTienda, tipoRegistro, creadoEn);

ALTER TABLE movimientoLote
  ADD CONSTRAINT chk_movimientoLote_cantidad
    CHECK (cantidad<>0);

ALTER TABLE movimientoLote
  ADD CONSTRAINT chk_movimientoLote_balance
    CHECK (
      cantidadAnterior>=0
      AND cantidadPosterior>=0
      AND cantidadPosterior=cantidadAnterior+cantidad
    );

ALTER TABLE movimientoLote
  ADD CONSTRAINT chk_movimientoLote_referencia
    CHECK (
      (tipoRegistro='distribucion_inicial' AND idMovimientoStock IS NULL AND cantidad>0)
      OR (tipoRegistro='movimiento_stock' AND idMovimientoStock IS NOT NULL)
    );

ALTER TABLE movimientoLote
  ADD CONSTRAINT fk_movimientoLote_tienda FOREIGN KEY (idTienda)
    REFERENCES tienda(idTienda) ON UPDATE RESTRICT ON DELETE RESTRICT;

ALTER TABLE movimientoLote
  ADD CONSTRAINT fk_movimientoLote_producto FOREIGN KEY (idTienda, idProducto)
    REFERENCES producto(idTienda, idProducto) ON UPDATE RESTRICT ON DELETE RESTRICT;

ALTER TABLE movimientoLote
  ADD CONSTRAINT fk_movimientoLote_lote FOREIGN KEY (idTienda, idProducto, idLoteProducto)
    REFERENCES loteProducto(idTienda, idProducto, idLoteProducto)
    ON UPDATE RESTRICT ON DELETE RESTRICT;

ALTER TABLE movimientoLote
  ADD CONSTRAINT fk_movimientoLote_movimientoStock
    FOREIGN KEY (idTienda, idProducto, idMovimientoStock)
    REFERENCES movimientoStock(idTienda, idProducto, idMovimientoStock)
    ON UPDATE RESTRICT ON DELETE RESTRICT;

ALTER TABLE movimientoLote
  ADD CONSTRAINT fk_movimientoLote_administrador FOREIGN KEY (idTienda, idAdministrador)
    REFERENCES administrador(idTienda, idAdministrador) ON UPDATE RESTRICT ON DELETE RESTRICT;

INSERT INTO funcionalidad (codigo, nombre, descripcion, activo, creadoEn, actualizadoEn)
VALUES ('vencimientos_lote', 'Vencimientos por lote', 'Control opcional de lotes y vencimientos.', 1, @fecha_local_011, @fecha_local_011)
ON DUPLICATE KEY UPDATE activo=1, actualizadoEn=@fecha_local_011;

INSERT INTO funcionalidad (codigo, nombre, descripcion, activo, creadoEn, actualizadoEn)
VALUES ('control_lotes', 'Control de lotes', 'Trazabilidad operativa de existencias por ingreso fisico.', 1, @fecha_local_011, @fecha_local_011)
ON DUPLICATE KEY UPDATE activo=1, actualizadoEn=@fecha_local_011;

INSERT INTO funcionalidad (codigo, nombre, descripcion, activo, creadoEn, actualizadoEn)
VALUES ('alertas_vencimiento', 'Alertas de vencimiento', 'Avisos de lotes proximos a vencer o vencidos.', 1, @fecha_local_011, @fecha_local_011)
ON DUPLICATE KEY UPDATE activo=1, actualizadoEn=@fecha_local_011;

INSERT INTO funcionalidad (codigo, nombre, descripcion, activo, creadoEn, actualizadoEn)
VALUES ('trazabilidad_lotes', 'Trazabilidad de lotes', 'Seguimiento desde la compra hasta la salida comercial.', 1, @fecha_local_011, @fecha_local_011)
ON DUPLICATE KEY UPDATE activo=1, actualizadoEn=@fecha_local_011;

INSERT INTO funcionalidad (codigo, nombre, descripcion, activo, creadoEn, actualizadoEn)
VALUES ('exportacion_lotes', 'Exportacion de lotes', 'Exportacion administrativa de lotes y vencimientos.', 1, @fecha_local_011, @fecha_local_011)
ON DUPLICATE KEY UPDATE activo=1, actualizadoEn=@fecha_local_011;

INSERT INTO planFuncionalidad (idPlan, idFuncionalidad, habilitada, creadoEn)
SELECT p.idPlan, f.idFuncionalidad, 1, @fecha_local_011
FROM plan p
JOIN funcionalidad f ON f.codigo IN (
  'vencimientos_lote','control_lotes','alertas_vencimiento','trazabilidad_lotes','exportacion_lotes'
)
WHERE p.codigo='avanzado'
ON DUPLICATE KEY UPDATE habilitada=1;
