-- Separa los comprobantes de caja fisica (T) y pedidos online (O).

ALTER TABLE venta
  ADD COLUMN canalVenta ENUM('tienda','online') NOT NULL DEFAULT 'tienda'
  AFTER codigoComprobante;

ALTER TABLE venta
  ADD INDEX idx_venta_tienda_canal_id (idTienda,canalVenta,idVenta);

UPDATE venta
SET canalVenta=CASE
  WHEN claveOperacion LIKE 'pedido-online:%' THEN 'online'
  ELSE 'tienda'
END;

-- Libera los codigos anteriores antes de reconstruir ambas series.
UPDATE venta
SET codigoComprobante=CONCAT('TMP-',idVenta)
WHERE idTienda IS NOT NULL;

DROP TEMPORARY TABLE IF EXISTS tmp_secuencia_comprobante_venta;

CREATE TEMPORARY TABLE tmp_secuencia_comprobante_venta (
  idVenta INT NOT NULL PRIMARY KEY,
  idTienda INT NOT NULL,
  canalVenta ENUM('tienda','online') NOT NULL,
  numeroCanal BIGINT UNSIGNED NOT NULL
);

INSERT INTO tmp_secuencia_comprobante_venta (idVenta,idTienda,canalVenta,numeroCanal)
SELECT idVenta,idTienda,canalVenta,
       ROW_NUMBER() OVER (PARTITION BY idTienda,canalVenta ORDER BY idVenta) numeroCanal
FROM venta
WHERE idTienda IS NOT NULL;

UPDATE venta v
JOIN tmp_secuencia_comprobante_venta secuencia
  ON secuencia.idVenta=v.idVenta AND secuencia.idTienda=v.idTienda
SET v.codigoComprobante=CONCAT(
  CASE WHEN secuencia.canalVenta='online' THEN 'O' ELSE 'T' END,
  '-',
  LPAD(secuencia.numeroCanal,3,'0')
);

DROP TEMPORARY TABLE tmp_secuencia_comprobante_venta;
