-- Registro publico pendiente de verificacion. No habilita envio ni consumo de tokens.

ALTER TABLE administrador
  ADD COLUMN correoNormalizado VARCHAR(160) NULL AFTER usuario;

ALTER TABLE administrador
  ADD COLUMN correoVerificadoEn DATETIME NULL AFTER correoNormalizado;

ALTER TABLE administrador
  ADD COLUMN estadoAcceso ENUM('activo','pendiente_verificacion')
    NOT NULL DEFAULT 'activo' AFTER activo;

ALTER TABLE administrador
  ADD UNIQUE INDEX uq_administrador_correo_normalizado (correoNormalizado);

ALTER TABLE administrador
  ADD INDEX idx_administrador_estado_acceso (estadoAcceso, activo);

ALTER TABLE tienda
  ADD COLUMN estadoOnboarding ENUM('pendiente','en_progreso','completado')
    NOT NULL DEFAULT 'completado' AFTER estado;

ALTER TABLE tienda
  ADD COLUMN onboardingCompletadoEn DATETIME NULL AFTER estadoOnboarding;

ALTER TABLE tienda
  ADD INDEX idx_tienda_onboarding (estadoOnboarding, activo);

CREATE TABLE IF NOT EXISTS tokenAccesoAdministrador (
  idTokenAcceso BIGINT NOT NULL AUTO_INCREMENT,
  idAdministrador INT NOT NULL,
  tipo ENUM('verificacion_correo','recuperacion_password') NOT NULL,
  tokenHash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  expiraEn DATETIME NOT NULL,
  usadoEn DATETIME NULL,
  invalidadoEn DATETIME NULL,
  creadoEn DATETIME NOT NULL,
  PRIMARY KEY (idTokenAcceso),
  UNIQUE KEY uq_tokenAcceso_hash (tokenHash),
  KEY idx_tokenAcceso_administrador_tipo_estado (idAdministrador, tipo, usadoEn, invalidadoEn, expiraEn),
  CONSTRAINT chk_tokenAcceso_hash CHECK (tokenHash REGEXP '^[0-9a-f]{64}$'),
  CONSTRAINT chk_tokenAcceso_fechas CHECK (
    expiraEn>creadoEn
    AND (usadoEn IS NULL OR usadoEn>=creadoEn)
    AND (invalidadoEn IS NULL OR invalidadoEn>=creadoEn)
  ),
  CONSTRAINT fk_tokenAcceso_administrador
    FOREIGN KEY (idAdministrador) REFERENCES administrador(idAdministrador)
    ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS solicitudRegistroPublico (
  idSolicitudRegistro BIGINT NOT NULL AUTO_INCREMENT,
  claveHash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  huellaSolicitud CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  estado ENUM('en_proceso','completada','fallida') NOT NULL DEFAULT 'en_proceso',
  idTienda INT NULL,
  idAdministrador INT NULL,
  completadaEn DATETIME NULL,
  creadoEn DATETIME NOT NULL,
  actualizadoEn DATETIME NOT NULL,
  PRIMARY KEY (idSolicitudRegistro),
  UNIQUE KEY uq_solicitudRegistro_clave_hash (claveHash),
  KEY idx_solicitudRegistro_estado_fecha (estado, actualizadoEn),
  KEY idx_solicitudRegistro_tienda (idTienda),
  KEY idx_solicitudRegistro_administrador (idAdministrador),
  CONSTRAINT chk_solicitudRegistro_hashes CHECK (
    claveHash REGEXP '^[0-9a-f]{64}$'
    AND huellaSolicitud REGEXP '^[0-9a-f]{64}$'
  ),
  CONSTRAINT chk_solicitudRegistro_resultado CHECK (
    (estado='completada' AND idTienda IS NOT NULL AND idAdministrador IS NOT NULL AND completadaEn IS NOT NULL)
    OR (estado IN ('en_proceso','fallida') AND idTienda IS NULL AND idAdministrador IS NULL)
  ),
  CONSTRAINT fk_solicitudRegistro_tienda
    FOREIGN KEY (idTienda) REFERENCES tienda(idTienda)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_solicitudRegistro_administrador
    FOREIGN KEY (idAdministrador) REFERENCES administrador(idAdministrador)
    ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB;
