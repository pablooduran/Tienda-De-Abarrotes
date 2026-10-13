ALTER TABLE pedidoTiendaOnline
  ADD COLUMN leidoEn DATETIME NULL AFTER actualizadoEn,
  ADD INDEX idx_pedidoOnline_tienda_leido_estado_fecha (idTienda,leidoEn,estado,creadoEn),
  ADD CONSTRAINT chk_pedidoOnline_leido_fecha CHECK (leidoEn IS NULL OR leidoEn>=creadoEn);
