-- El código se guarda por cliente para permitir destinatarios de países distintos.
ALTER TABLE cliente
  ADD COLUMN codigoPaisWhatsApp VARCHAR(8) NULL AFTER telefonoNormalizado;

UPDATE cliente
SET codigoPaisWhatsApp='591'
WHERE telefonoNormalizado IS NOT NULL
  AND CHAR_LENGTH(TRIM(telefonoNormalizado))>0
  AND codigoPaisWhatsApp IS NULL;

ALTER TABLE cliente
  ADD CONSTRAINT chk_cliente_codigo_pais_whatsapp
  CHECK (codigoPaisWhatsApp IS NULL OR codigoPaisWhatsApp REGEXP '^[0-9]{1,8}$');
