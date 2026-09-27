-- Vinculacion estable de cuentas Google. No guarda tokens de acceso ni refresh tokens.

CREATE TABLE IF NOT EXISTS identidadOauthAdministrador (
  idIdentidadOauth BIGINT NOT NULL AUTO_INCREMENT,
  idAdministrador INT NOT NULL,
  proveedor ENUM('google') NOT NULL,
  subjectProveedor VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  correoNormalizado VARCHAR(160) NOT NULL,
  creadoEn DATETIME NOT NULL,
  ultimoAccesoEn DATETIME NOT NULL,
  actualizadoEn DATETIME NOT NULL,
  PRIMARY KEY (idIdentidadOauth),
  UNIQUE KEY uq_identidadOauth_proveedor_subject (proveedor, subjectProveedor),
  UNIQUE KEY uq_identidadOauth_administrador_proveedor (idAdministrador, proveedor),
  KEY idx_identidadOauth_correo (correoNormalizado),
  CONSTRAINT fk_identidadOauth_administrador
    FOREIGN KEY (idAdministrador) REFERENCES administrador(idAdministrador)
    ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB;
