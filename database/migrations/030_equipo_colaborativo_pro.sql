-- Equipo colaborativo: solo los planes Pro pueden crear usuarios operativos.
ALTER TABLE administrador DROP CHECK chk_administrador_rol_tienda;

ALTER TABLE administrador
  MODIFY COLUMN rol ENUM('superadmin','dueno_tienda','encargado','cajero','inventario')
    NOT NULL DEFAULT 'dueno_tienda',
  ADD CONSTRAINT chk_administrador_rol_tienda CHECK (
    (rol='superadmin' AND idTienda IS NULL)
    OR (rol IN ('dueno_tienda','encargado','cajero','inventario') AND idTienda IS NOT NULL)
  );

INSERT INTO funcionalidad (codigo,nombre,descripcion,activo)
SELECT 'equipo_colaborativo','Equipo y permisos','Usuarios operativos con permisos por rol.',1
WHERE NOT EXISTS (SELECT 1 FROM funcionalidad WHERE codigo='equipo_colaborativo');

INSERT INTO planFuncionalidad (idPlan,idFuncionalidad,habilitada)
SELECT p.idPlan,f.idFuncionalidad,CASE WHEN p.codigo='pro' THEN 1 ELSE 0 END
FROM plan p
JOIN funcionalidad f ON f.codigo='equipo_colaborativo'
WHERE p.codigo IN ('basico','standard','pro')
ON DUPLICATE KEY UPDATE habilitada=VALUES(habilitada);

UPDATE plan
SET descripcion='Gestion avanzada, equipo de trabajo, exportaciones y lotes sin limites.'
WHERE codigo='pro';

-- Las suscripciones activas se basan en una foto congelada de funciones.
DELETE sf
FROM suscripcionFuncionalidadSnapshot sf
JOIN suscripcionTienda s ON s.idTienda=sf.idTienda AND s.idSuscripcion=sf.idSuscripcion
JOIN plan p ON p.idPlan=s.idPlan
WHERE p.codigo IN ('basico','standard','pro') AND s.estado IN ('activa','gracia');

INSERT INTO suscripcionFuncionalidadSnapshot
  (idTienda,idSuscripcion,codigoFuncionalidad,nombreFuncionalidad,creadoEn)
SELECT s.idTienda,s.idSuscripcion,f.codigo,f.nombre,NOW()
FROM suscripcionTienda s
JOIN plan p ON p.idPlan=s.idPlan
JOIN planFuncionalidad pf ON pf.idPlan=p.idPlan AND pf.habilitada=1
JOIN funcionalidad f ON f.idFuncionalidad=pf.idFuncionalidad AND f.activo=1
WHERE p.codigo IN ('basico','standard','pro') AND s.estado IN ('activa','gracia');
