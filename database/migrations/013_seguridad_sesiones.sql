ALTER TABLE administrador
  ADD COLUMN versionSesion INT UNSIGNED NOT NULL DEFAULT 1 AFTER activo;

ALTER TABLE administrador
  ADD CONSTRAINT chk_administrador_version_sesion
  CHECK (versionSesion >= 1);
