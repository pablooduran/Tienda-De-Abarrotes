-- Configuracion base uno a uno para onboarding y perfil operativo de tienda.

CREATE TABLE IF NOT EXISTS configuracionTienda (
  idConfiguracionTienda BIGINT NOT NULL AUTO_INCREMENT,
  idTienda INT NOT NULL,
  nombreMostrado VARCHAR(120) NOT NULL,
  moneda CHAR(3) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'BOB',
  zonaHoraria VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin
    NOT NULL DEFAULT 'America/La_Paz',
  telefono VARCHAR(30) NULL,
  direccion VARCHAR(255) NULL,
  datoFiscalBasico VARCHAR(120) NULL,
  creadoEn DATETIME NOT NULL,
  actualizadoEn DATETIME NOT NULL,
  PRIMARY KEY (idConfiguracionTienda),
  UNIQUE KEY uq_configuracionTienda_tienda (idTienda),
  CONSTRAINT chk_configuracionTienda_nombre
    CHECK (CHAR_LENGTH(TRIM(nombreMostrado)) BETWEEN 1 AND 120),
  CONSTRAINT chk_configuracionTienda_moneda
    CHECK (moneda IN ('BOB')),
  CONSTRAINT chk_configuracionTienda_zona
    CHECK (zonaHoraria IN ('America/La_Paz')),
  CONSTRAINT chk_configuracionTienda_opcionales
    CHECK (
      (telefono IS NULL OR CHAR_LENGTH(TRIM(telefono)) BETWEEN 1 AND 30)
      AND (direccion IS NULL OR CHAR_LENGTH(TRIM(direccion)) BETWEEN 1 AND 255)
      AND (
        datoFiscalBasico IS NULL
        OR CHAR_LENGTH(TRIM(datoFiscalBasico)) BETWEEN 1 AND 120
      )
    ),
  CONSTRAINT fk_configuracionTienda_tienda
    FOREIGN KEY (idTienda) REFERENCES tienda(idTienda)
    ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB;

SET @fecha_local_021 = __MIGRATION_LOCAL_DATETIME__;

INSERT INTO configuracionTienda
  (idTienda, nombreMostrado, moneda, zonaHoraria, telefono, direccion,
   datoFiscalBasico, creadoEn, actualizadoEn)
SELECT t.idTienda, t.nombre, 'BOB', 'America/La_Paz', NULL, NULL, NULL,
       @fecha_local_021, @fecha_local_021
FROM tienda t
WHERE NOT EXISTS (
  SELECT 1 FROM configuracionTienda c WHERE c.idTienda=t.idTienda
);
