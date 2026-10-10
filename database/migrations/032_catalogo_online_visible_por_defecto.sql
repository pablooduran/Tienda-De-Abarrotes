-- Los productos activos aparecen en la tienda online salvo que el propietario los oculte.

ALTER TABLE productoCatalogoOnline
  ALTER COLUMN publicado SET DEFAULT 1;
