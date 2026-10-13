ALTER TABLE administrador
  ADD COLUMN correoPendiente VARCHAR(160) NULL AFTER correoNormalizado,
  ADD COLUMN telefono VARCHAR(30) NULL AFTER correoVerificadoEn,
  ADD INDEX idx_administrador_correo_pendiente (correoPendiente),
  ADD CONSTRAINT chk_administrador_correo_pendiente CHECK (
    correoPendiente IS NULL OR CHAR_LENGTH(TRIM(correoPendiente)) BETWEEN 5 AND 160
  ),
  ADD CONSTRAINT chk_administrador_telefono CHECK (
    telefono IS NULL OR CHAR_LENGTH(TRIM(telefono)) BETWEEN 7 AND 30
  );
