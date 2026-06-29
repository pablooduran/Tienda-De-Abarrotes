-- Migracion segura: borrado logico de clientes y fiados.
--
-- Antes de ejecutar en produccion:
--   mysqldump -u usuario_mysql -p nombre_base > backup_antes_003_borrado_logico.sql
--
-- Esta migracion no borra datos. Solo agrega columnas para ocultar registros
-- de las listas principales conservando ventas, fiados, pagos e historial.

ALTER TABLE cliente
  ADD COLUMN IF NOT EXISTS activo TINYINT(1) NOT NULL DEFAULT 1 AFTER telefono,
  ADD COLUMN IF NOT EXISTS eliminadoEn DATETIME NULL AFTER activo;

ALTER TABLE fiado
  ADD COLUMN IF NOT EXISTS activo TINYINT(1) NOT NULL DEFAULT 1 AFTER estado,
  ADD COLUMN IF NOT EXISTS eliminadoEn DATETIME NULL AFTER activo;
