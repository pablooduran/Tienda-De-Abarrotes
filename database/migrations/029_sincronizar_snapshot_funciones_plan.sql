-- Aplica la nueva escalera comercial a las suscripciones vigentes.
-- Las funciones se leen desde un snapshot por suscripcion para conservar
-- el historial; 028 actualizo el catalogo, pero las suscripciones activas
-- existentes necesitan recibir esa nueva foto de funcionalidades.

DELETE sf
FROM suscripcionFuncionalidadSnapshot sf
JOIN suscripcionTienda s
  ON s.idTienda=sf.idTienda AND s.idSuscripcion=sf.idSuscripcion
JOIN plan p ON p.idPlan=s.idPlan
WHERE p.codigo IN ('basico','standard','pro')
  AND s.estado IN ('activa','gracia');

INSERT INTO suscripcionFuncionalidadSnapshot
  (idTienda,idSuscripcion,codigoFuncionalidad,nombreFuncionalidad,creadoEn)
SELECT s.idTienda,s.idSuscripcion,f.codigo,f.nombre,NOW()
FROM suscripcionTienda s
JOIN plan p ON p.idPlan=s.idPlan
JOIN planFuncionalidad pf ON pf.idPlan=p.idPlan AND pf.habilitada=1
JOIN funcionalidad f ON f.idFuncionalidad=pf.idFuncionalidad AND f.activo=1
WHERE p.codigo IN ('basico','standard','pro')
  AND s.estado IN ('activa','gracia');
