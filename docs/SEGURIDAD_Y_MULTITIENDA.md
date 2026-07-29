# Seguridad y multitienda

Este documento resume los controles vigentes para rutas y servicios. Las reglas
obligatorias completas estan en [AGENTS.md](../AGENTS.md) y
[REGLAS_CODEX.md](REGLAS_CODEX.md); las pruebas se seleccionan desde
[MAPA_PRUEBAS.md](MAPA_PRUEBAS.md).

## Cadena de autorizacion

La ruta comercial normal pasa por los siguientes controles, de acuerdo con su
contrato:

1. **Sesion:** [middleware/auth.js](../middleware/auth.js) valida la sesion y
   el administrador activo.
2. **Tenant:** [middleware/tenant.js](../middleware/tenant.js) deriva
   `req.tenant.idTienda` desde la sesion del dueno.
3. **Suscripcion:** [middleware/subscription.js](../middleware/subscription.js)
   resuelve plan y estado; bloquea escrituras en modo solo lectura.
4. **Funcionalidad y permiso:** la ruta exige la caracteristica de plan y el
   permiso de dominio aplicable.
5. **CSRF/origen:** [middleware/request-security.js](../middleware/request-security.js)
   protege mutaciones con origen confiable y `X-Requested-With`.
6. **Rate limiting:** [middleware/rate-limiters.js](../middleware/rate-limiters.js)
   aplica limites separados para API, auth, administracion, exportacion, health
   y preparacion de WhatsApp.

Las rutas de superadmin usan `requireAuth` y `requireRole('superadmin')` antes
de su router. El superadmin no recibe un tenant comercial automaticamente.

## Reglas de tenant

- `idTienda` es una decision del backend, derivada de sesion y contexto valido;
  el frontend no lo envia ni lo elige.
- Todo `SELECT`, `JOIN`, `UPDATE` o DELETE logico, conteo, agregado, historial
  y exportacion de dominio debe incluir el tenant correspondiente.
- Los joins deben preservar el tenant en ambos lados cuando la entidad lo tenga.
- IDs manipulados de otra tienda responden como acceso denegado o inexistente
  seguro; nunca revelan datos ajenos.
- Un filtro de superadmin por tienda solo es valido en rutas administrativas
  protegidas y validado por backend.
- No se permite combinar saldos, stock, lotes, clientes, auditoria o reportes
  de tiendas diferentes.

## Escrituras criticas e historicos

- Las operaciones financieras, stock, lotes, compensaciones y ajustes usan
  transacciones, rollback y bloqueos en orden determinista cuando corresponde.
- Las claves idempotentes se manejan solo en backend: repeticion compatible
  devuelve el resultado previo; conflicto de huella se rechaza.
- No sobrescribir silenciosamente una venta, pago, fiado, cobro, saldo o
  movimiento historico. Usar anulacion o movimiento compensatorio trazable.
- La auditoria administrativa y comercial usa contratos y allowlists; las
  mutaciones criticas registran actor, resultado y referencia segura.
- Fechas comerciales y cortes usan `America/La_Paz`.

## Seguridad web y respuestas

- Sesiones en cookie HTTP-only con politica `sameSite`; la configuracion vive
  fuera de archivos rastreados. Ver [server.js](../server.js).
- Cabeceras de seguridad, politica de permisos y no-cache se montan antes de
  rutas. APIs, auth, health y vistas sensibles usan `Cache-Control: no-store`.
- La entrada se valida por contrato y las consultas usan parametros; no crear
  SQL con valores de usuario.
- Frontend trata contenido dinamico como texto. Exportaciones neutralizan
  formulas en CSV/XLSX y no incluyen campos internos innecesarios.
- Los manejadores de errores devuelven codigos estables y requestId; no devuelven
  SQL, `sqlMessage`, stack ni detalles de infraestructura.

## Datos prohibidos

Nunca colocar en respuesta, log, auditoria, exportacion, fixture persistente o
documentacion: contrasenas, hashes de contrasena, tokens, cookies, CSRF,
secretos, credenciales, cadenas de conexion, certificados, claves idempotentes
completas, huellas, SQL interno, stacks, rutas internas o datos de otra tienda.

## Auditoria y acceso

La auditoria es append-only y separa consulta de escritura comercial. Los
eventos administrativos y comerciales registran solo metadatos permitidos:
actor, tenant cuando aplica, accion, resultado, referencia segura, requestId y
origen. Un dueno consulta exclusivamente su tienda; el superadmin usa la ruta
administrativa global o un filtro de tienda validado. No existen rutas de
edicion o borrado de auditoria. Ver [routes/audit.js](../routes/audit.js),
[services/administrative-audit-service.js](../services/administrative-audit-service.js)
y [services/administrative-audit-query-service.js](../services/administrative-audit-query-service.js).

## Checklist para rutas nuevas

### GET y consultas

- Definir auth, tenant o rol superadmin, permiso y funcionalidad necesarios.
- Aplicar tenant a filtros, joins, agregados, paginacion y exportacion.
- Limitar page size, ordenar mediante allowlist y usar `no-store` si la
  respuesta es sensible.
- Probar aislamiento, autorizacion, filtros y ausencia de datos internos.

### POST, PUT y PATCH

- Mantener todos los controles de GET mas CSRF, suscripcion activa y rate limit.
- Validar payload y no aceptar `idTienda` como autoridad.
- Usar transaccion, rollback, bloqueos e idempotencia si cambia dinero, stock,
  credito o historicos.
- Registrar auditoria permitida y conservar el error funcional si hay rechazo.

### Exportaciones y superadmin

- Reutilizar filtros backend, tenant, permisos y limites; proteger descarga con
  el limitador de exportaciones y neutralizar formulas.
- Las rutas superadmin no deben habilitar operaciones comerciales sin contexto
  tenant, ni revelar infraestructura, secretos o datos globales innecesarios.

### Frontend y pruebas

- No enviar `idTienda`, secretos ni datos tecnicos; escapar contenido dinamico.
- Bloquear doble envio, anunciar errores y conservar foco accesible.
- Ejecutar Nivel 1 y Nivel 2 de [MAPA_PRUEBAS.md](MAPA_PRUEBAS.md); incluir
  multitenant y seguridad web cuando haya datos o rutas.

## Condiciones de bloqueo

Detener el trabajo ante tenant recibido desde frontend, consulta o agregado sin
tenant, ruta sensible sin permiso, escritura critica sin transaccion cuando
corresponde, secreto en respuesta o log, acceso remoto no autorizado, o fallo
de aislamiento, integridad o seguridad. Conservar evidencia y esperar
autorizacion; no relajar controles para continuar.
