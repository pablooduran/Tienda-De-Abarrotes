ALTER TABLE producto
  ADD COLUMN codigoBarras VARCHAR(64) NULL AFTER idProductoMaestro;

ALTER TABLE producto
  ADD COLUMN precioVentaPaquete DECIMAL(10,2) NULL AFTER precioVenta;

ALTER TABLE producto
  ADD COLUMN favoritoPos TINYINT(1) NOT NULL DEFAULT 0 AFTER permiteVentaPorUnidad;

UPDATE producto p
JOIN productoMaestro pm ON pm.idProductoMaestro=p.idProductoMaestro
SET p.codigoBarras=pm.codigoBarras
WHERE p.codigoBarras IS NULL AND pm.codigoBarras IS NOT NULL;

ALTER TABLE venta
  ADD COLUMN subtotal DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER fecha;

ALTER TABLE venta
  ADD COLUMN descuento DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER subtotal;

ALTER TABLE venta
  ADD COLUMN montoPagado DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER total;

ALTER TABLE venta
  ADD COLUMN saldoPendiente DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER montoPagado;

ALTER TABLE venta
  ADD COLUMN estadoPago ENUM('pagada','parcial','pendiente','legado') NOT NULL DEFAULT 'legado' AFTER saldoPendiente;

ALTER TABLE venta
  ADD COLUMN codigoComprobante VARCHAR(40) NULL AFTER claveOperacion;

ALTER TABLE pagoFiado
  ADD UNIQUE INDEX uq_pagoFiado_tienda_id (idTienda, idPagoFiado);

ALTER TABLE fiado
  ADD UNIQUE INDEX uq_fiado_tienda_venta_unica (idTienda, idVenta);

ALTER TABLE producto
  ADD UNIQUE INDEX uq_producto_tienda_codigoBarras (idTienda, codigoBarras);

ALTER TABLE producto
  ADD INDEX idx_producto_tienda_favorito_nombre (idTienda, favoritoPos, activo, nombre);

ALTER TABLE venta
  ADD UNIQUE INDEX uq_venta_tienda_comprobante (idTienda, codigoComprobante);

ALTER TABLE venta
  ADD INDEX idx_venta_tienda_estado_fecha (idTienda, estadoPago, fecha);

CREATE TABLE IF NOT EXISTS pagoVenta (
  idPagoVenta BIGINT AUTO_INCREMENT PRIMARY KEY,
  idTienda INT NOT NULL,
  idVenta INT NOT NULL,
  idPagoFiado INT NULL,
  metodoPago ENUM('efectivo','qr','no_especificado') NOT NULL,
  monto DECIMAL(10,2) NOT NULL,
  montoRecibido DECIMAL(10,2) NULL,
  cambio DECIMAL(10,2) NOT NULL DEFAULT 0,
  referencia VARCHAR(120) NULL,
  claveOperacion VARCHAR(160) NOT NULL,
  idAdministrador INT NULL,
  creadoEn DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_pagoVenta_tienda_clave (idTienda, claveOperacion),
  UNIQUE KEY uq_pagoVenta_tienda_pagoFiado (idTienda, idPagoFiado),
  KEY idx_pagoVenta_tienda_venta (idTienda, idVenta, creadoEn),
  KEY idx_pagoVenta_tienda_metodo_fecha (idTienda, metodoPago, creadoEn),
  KEY idx_pagoVenta_tienda_admin_fecha (idTienda, idAdministrador, creadoEn),
  CONSTRAINT chk_pagoVenta_monto CHECK (monto > 0),
  CONSTRAINT chk_pagoVenta_metodo CHECK (metodoPago IN ('efectivo','qr','no_especificado')),
  CONSTRAINT chk_pagoVenta_efectivo CHECK (
    (metodoPago='efectivo' AND montoRecibido IS NOT NULL AND montoRecibido>=monto AND ABS((montoRecibido-monto)-cambio)<0.01)
    OR (metodoPago<>'efectivo' AND montoRecibido IS NULL AND cambio=0)
  ),
  CONSTRAINT fk_pagoVenta_tienda FOREIGN KEY (idTienda)
    REFERENCES tienda(idTienda) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_pagoVenta_venta FOREIGN KEY (idTienda, idVenta)
    REFERENCES venta(idTienda, idVenta) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_pagoVenta_pagoFiado FOREIGN KEY (idTienda, idPagoFiado)
    REFERENCES pagoFiado(idTienda, idPagoFiado) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_pagoVenta_administrador FOREIGN KEY (idTienda, idAdministrador)
    REFERENCES administrador(idTienda, idAdministrador) ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB;

UPDATE venta v
LEFT JOIN fiado f ON f.idTienda=v.idTienda AND f.idVenta=v.idVenta
SET v.subtotal=v.total,
    v.descuento=0,
    v.montoPagado=CASE
      WHEN f.idFiado IS NULL THEN v.total
      ELSE LEAST(v.total, GREATEST(f.totalPagado, 0))
    END,
    v.saldoPendiente=CASE
      WHEN f.idFiado IS NULL THEN 0
      ELSE LEAST(v.total, GREATEST(f.saldoPendiente, 0))
    END,
    v.estadoPago=CASE
      WHEN f.idFiado IS NULL THEN 'legado'
      WHEN f.saldoPendiente <= 0 THEN 'pagada'
      WHEN f.totalPagado > 0 THEN 'parcial'
      ELSE 'pendiente'
    END,
    v.codigoComprobante=COALESCE(
      NULLIF(v.codigoComprobante, ''),
      CONCAT('V-', v.idTienda, '-', LPAD(v.idVenta, 8, '0'))
    )
WHERE v.estadoPago='legado';

ALTER TABLE venta
  ADD CONSTRAINT chk_venta_totales_pos CHECK (
    subtotal >= 0 AND descuento >= 0 AND total >= 0 AND descuento <= subtotal
    AND ABS((subtotal - descuento) - total) < 0.01
  );

ALTER TABLE venta
  ADD CONSTRAINT chk_venta_saldo_pos CHECK (
    montoPagado >= 0 AND saldoPendiente >= 0
    AND (estadoPago = 'legado' OR ABS((montoPagado + saldoPendiente) - total) < 0.01)
  );

ALTER TABLE venta
  ADD CONSTRAINT chk_venta_estado_pos CHECK (
    estadoPago = 'legado'
    OR (estadoPago = 'pagada' AND saldoPendiente = 0 AND montoPagado = total)
    OR (estadoPago = 'parcial' AND montoPagado > 0 AND saldoPendiente > 0)
    OR (estadoPago = 'pendiente' AND montoPagado = 0 AND saldoPendiente = total AND total > 0)
  );

INSERT INTO pagoVenta
  (idTienda, idVenta, idPagoFiado, metodoPago, monto, montoRecibido, cambio, referencia, claveOperacion, idAdministrador, creadoEn)
SELECT pf.idTienda, f.idVenta, pf.idPagoFiado, 'no_especificado', pf.monto,
       NULL, 0, NULLIF(pf.observacion, ''), CONCAT('migracion008:pago-fiado:', pf.idPagoFiado), NULL, pf.fechaPago
FROM pagoFiado pf
JOIN fiado f ON f.idTienda=pf.idTienda AND f.idFiado=pf.idFiado
WHERE f.idVenta IS NOT NULL AND pf.monto > 0
ON DUPLICATE KEY UPDATE idPagoVenta=idPagoVenta;

INSERT INTO funcionalidad (codigo, nombre, descripcion, activo)
VALUES ('punto_venta', 'Punto de venta', 'Venta rapida con carrito, cobro y comprobante.', 1)
ON DUPLICATE KEY UPDATE activo=1;

INSERT INTO funcionalidad (codigo, nombre, descripcion, activo)
VALUES ('pagos_multiples', 'Pagos multiples', 'Cobros mediante efectivo, QR o combinacion de ambos.', 1)
ON DUPLICATE KEY UPDATE activo=1;

INSERT INTO planFuncionalidad (idPlan, idFuncionalidad, habilitada)
SELECT p.idPlan, f.idFuncionalidad, 1
FROM plan p
JOIN funcionalidad f ON f.codigo IN ('punto_venta','pagos_multiples','recibos_whatsapp')
WHERE p.codigo IN ('basico','avanzado')
ON DUPLICATE KEY UPDATE habilitada=1;
