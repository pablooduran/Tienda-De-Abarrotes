# Preparacion de configuracion para staging

## Alcance

STAGING-1 prepara el contrato de ejecucion para `local`, `ci`, `staging` y
`production`. No crea infraestructura, no despliega, no provisiona MySQL o
Redis y no contiene secretos. La auditoria segura del 2026-08-24 confirma que
existen recursos Render y Aiven, pero no un staging sintetico validado: falta
cerrar su contrato tecnico, red y procedimiento operativo.

Todos los entornos usan Node.js 20 o superior, igual que el workflow de CI.

Los archivos de entorno se separan por nombre: `.env.local`, `.env.ci`,
`.env.staging` y `.env.production`. No deben versionarse ni copiarse entre
entornos. Un `APP_ENV` ausente conserva la advertencia y el comportamiento
legado de `.env`, pero no es valido para un despliegue controlado.

## Contrato por entorno

| Regla | Local | CI | Staging | Production |
| --- | --- | --- | --- | --- |
| Base permitida | `DB_HOST=localhost` | MySQL efimero en `localhost` | Host dedicado y `DB_ENVIRONMENT=staging` | Host dedicado y `DB_ENVIRONMENT=production` |
| TLS MySQL | Opcional | Desactivado en el servicio efimero | Obligatorio con CA inline | Obligatorio con CA inline |
| Cookie de sesion | Sin `Secure` para HTTP local | Sin `Secure` | `Secure`, HTTPS | `Secure`, HTTPS |
| `trust proxy` | `false` | `false` | CIDR explicitos | CIDR explicitos |
| Rate limit | Memoria | Memoria | Redis con TLS | Redis con TLS |
| Storage privado | Filesystem local fuera del repo | Temporal fuera del repo | Filesystem privado absoluto | Filesystem privado absoluto |
| Correo | Adaptador local de pruebas | Adaptador local de pruebas | Deshabilitado hasta elegir adaptador | Deshabilitado hasta elegir adaptador |

Local y CI fallan antes de conectar si `DB_HOST` no es exactamente
`localhost`. Staging y production exigen un marcador `DB_ENVIRONMENT` igual a
`APP_ENV` y un `DB_NAME` que identifique el entorno; no admiten la base local,
passwords placeholder ni MySQL sin TLS.

## Variables requeridas

Todos los entornos requieren `APP_ENV`, `DB_HOST`, `DB_PORT`, `DB_NAME`,
`DB_USER`, `DB_PASSWORD` y `SESSION_SECRET`.

Staging y production requieren ademas:

- `NODE_ENV=production`;
- `DB_ENVIRONMENT` igual a `APP_ENV`;
- `DB_SSL_ENABLED=true` y `DB_SSL_CA` con la CA PEM inline;
- `APP_BASE_URL` como origen HTTPS exacto;
- `TRUSTED_ORIGINS`, incluyendo `APP_BASE_URL` y sin comodines;
- `TRUST_PROXY_CIDRS` con las redes directas y verificadas del proxy;
- `RATE_LIMIT_ENABLED=true`;
- `RATE_LIMIT_STORE=redis`;
- `RATE_LIMIT_REDIS_URL` con esquema `rediss://` y credencial robusta;
- `RATE_LIMIT_REDIS_PREFIX` que identifique el entorno;
- `PAYMENT_RECEIPT_STORAGE_DRIVER=filesystem`;
- `PAYMENT_RECEIPT_STORAGE_DIR` absoluto y fuera del repositorio;
- `EMAIL_DELIVERY_MODE=disabled` mientras no exista adaptador externo.

`SESSION_SECRET` hospedado debe tener al menos 48 caracteres, diversidad
suficiente y no ser un placeholder. Las URL, contrasenas, CA y secretos nunca
se imprimen en logs ni deben aparecer en Git.

## Inventario seguro de infraestructura existente (auditoria 2026-08-24)

- Render: existe un unico Web Service publico con HTTPS y variables de MySQL,
  entorno, puerto y sesion presentes por nombre. Esta desplegado desde `main`,
  tiene auto-deploy habilitado, no tiene health check configurado y el plan Free
  no ofrece disco persistente y puede suspenderse por inactividad; no es el
  entorno sintetico validado.
- Aiven: existe un unico MySQL 8.4 en ejecucion, de un nodo y plan gratuito de
  1 GB, con TLS obligatorio y backups administrados. Su acceso es publico y la
  allowlist de IP esta abierta. No hay Redis/Valkey visible. Render esta en
  Oregon y Aiven en San Francisco; se evaluara latencia antes de depender de la
  topologia.
- Correo permanece deshabilitado. No se inspeccionaron ni registraron nombres
  de host, usuarios, URIs, certificados ni valores secretos.

## Contrato tecnico de staging — pendiente de ejecucion

Este contrato se deriva del codigo actual y no autoriza crear, cambiar ni pagar
recursos externos. El objetivo es validar un unico entorno hospedado con datos
sinteticos. No declara `PILOT_READY` ni habilita datos reales.

### Dependencias y almacenamiento comprobados

- Redis/Valkey es obligatorio solo para `APP_ENV=staging|production`. No guarda
  sesiones, cache de negocio ni colas: el store de sesiones es MySQL. Su unica
  funcion actual es el rate limiting distribuido de API, autenticacion,
  administracion, pagos, exportaciones, uploads y health. El proceso falla al
  arrancar si no conecta y hace `PING`; readiness tambien lo exige.
- El unico binario persistente identificado es el comprobante privado de pagos
  manuales de suscripcion. El driver soportado es filesystem privado, absoluto
  y fuera del repositorio; readiness comprueba que este disponible. No se
  identifico almacenamiento persistente para imagenes, adjuntos generales o
  exportaciones; los backups son un mecanismo separado.
- Por lo tanto, el servicio hospedado necesita storage privado persistente si
  se probaran comprobantes. El plan actual de Render no lo aporta; no se debe
  declarar ese flujo validado hasta resolverlo o excluirlo explicitamente del
  smoke sintetico autorizado.

### Variables por nombre

Todas se cargan exclusivamente desde el gestor de secretos autorizado; este
documento no contiene valores, URIs, certificados ni ejemplos sensibles.

| Grupo | Variables requeridas para staging | Notas de contrato |
| --- | --- | --- |
| Aplicacion y HTTP | `APP_ENV`, `NODE_ENV`, `PORT`, `APP_BASE_URL`, `DB_ENVIRONMENT`, `TRUSTED_ORIGINS`, `TRUST_PROXY_CIDRS`, `EMAIL_DELIVERY_MODE` | `APP_ENV` y `DB_ENVIRONMENT` deben ser `staging`; origen HTTPS exacto, sin comodines; correo sigue deshabilitado. |
| MySQL | `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_SSL_ENABLED`, `DB_SSL_CA` | TLS obligatorio; la base debe identificarse como staging y no puede ser local. |
| Redis/Valkey y rate limit | `RATE_LIMIT_ENABLED`, `RATE_LIMIT_STORE`, `RATE_LIMIT_REDIS_URL`, `RATE_LIMIT_REDIS_PREFIX` | Store `redis`, URL TLS y prefijo aislado de staging. Los limites individuales son configurables y no sustituyen el store distribuido. |
| Sesiones | `SESSION_SECRET` | Se usa con `express-session` y store MySQL; debe cumplir la validacion reforzada de hosted. |
| Storage privado | `PAYMENT_RECEIPT_STORAGE_DRIVER`, `PAYMENT_RECEIPT_STORAGE_DIR` | Solo se admite filesystem fuera del repositorio. |
| Backup y restore local | `BACKUP_DIR`, `MYSQLDUMP_PATH`, `MYSQL_CLIENT_PATH`, `BACKUP_RESTORE_USER`, `BACKUP_RESTORE_PASSWORD`, `BACKUP_RETENTION_DAYS`, `BACKUP_RETENTION_COUNT` | Los scripts existentes son exclusivamente locales; no constituyen un procedimiento remoto. |
| Observabilidad | `SECURITY_LOG_LEVEL`, `HEALTH_READINESS_SOFT_MS`, `HEALTH_READINESS_TIMEOUT_MS`, `HEALTH_READINESS_CACHE_MS`, `SHUTDOWN_TIMEOUT_MS`, `BACKUP_WARNING_HOURS`, `BACKUP_CRITICAL_HOURS`, `BACKUP_STATUS_CACHE_MS`, `MONITOR_WARNING_REMINDER_MS`, `MONITOR_ERROR_REMINDER_MS`, `MONITOR_CRITICAL_REMINDER_MS` | Ajustes no secretos; los valores y el receptor externo de alertas requieren decision operativa. |

### Health y criterio de arranque

- `GET` o `HEAD` en `/health/live` debe devolver `200` y comprobar solo que el
  proceso responde. La respuesta no se cachea.
- `GET` o `HEAD` en `/health/ready` debe devolver `200` si esta disponible y
  `503` si no lo esta. Comprueba MySQL, el conjunto completo de migraciones
  esperadas, Redis/Valkey y storage privado en hosted. Los detalles se reducen
  a estados y codigos sanitizados.
- Antes de escuchar, el proceso valida configuracion, abre el store distribuido
  y comprueba storage privado. Cualquier variable obligatoria ausente, TLS no
  valido, proxy sin CIDR, Redis no disponible o storage inaccesible es criterio
  objetivo de no despliegue.

### Red, datos y regiones

1. La aplicacion debe salir desde una rama autorizada de staging, nunca desde
   `main` por defecto, y publicar solo un origen HTTPS incluido en
   `TRUSTED_ORIGINS`.
2. MySQL debe usar TLS con CA validada y una allowlist restringida al egreso
   verificable de la aplicacion. La allowlist abierta observada en Aiven impide
   validar el entorno sintetico.
3. Redis/Valkey debe usar TLS y ser alcanzable solo conforme a la topologia
   aprobada. Sus CIDR y los CIDR directos del proxy deben ser conocidos antes de
   configurar `TRUST_PROXY_CIDRS`.
4. Render esta en Oregon y Aiven en San Francisco. La diferencia de region no
   bloquea por si sola, pero obliga a medir latencia y revisar costos/egreso
   durante el smoke; alinear regiones sigue siendo una decision externa.
5. Solo se permiten bases, usuarios, comprobantes y datos sinteticos. Ningun
   dato de una tienda real puede entrar al entorno durante esta validacion.

### Secuencia externa ordenada

1. Aprobar rama de staging, dominio HTTPS, topologia, CIDR, capacidad, limite
   de gasto y propietario operativo del entorno existente.
2. Crear o aislar una base de staging vacia y sintetica; restringir la red de
   MySQL; decidir y disponer Redis/Valkey TLS y storage privado persistente.
3. Cargar secretos sinteticos por nombre en el gestor autorizado, sin archivos
   versionados ni reutilizacion de secretos locales.
4. Construir con Node 20 y dependencias bloqueadas; aplicar solamente las
   migraciones existentes 001–024 sobre la base vacia autorizada.
5. Arrancar con fail-fast, configurar health check sobre `/health/ready` y
   validar tambien `/health/live`.
6. Ejecutar smoke tests sinteticos: sesion, tenant, venta, inventario,
   suscripcion/pago si el storage ya esta resuelto, y comprobacion de logs sin
   secretos.
7. Crear evidencia del backup administrado elegido, checksum/manifiesto si el
   proveedor lo permite, y restaurar solo sobre una base temporal sintetica.
8. Ante fallo, no promover: detener el despliegue, preservar evidencia segura,
   volver al artefacto conocido o retirar el entorno sintetico segun el
   procedimiento externo aprobado. No restaurar sobre una base real.

### Backups y evidencia exigida

El repositorio solo implementa backup/restore local: dump, manifiesto, hash,
verificacion y restore temporal protegido. No hay planificador ni restore
remoto soportado por codigo. Para staging se debe decidir externamente la
frecuencia, retencion y ubicacion del respaldo; como evidencia minima se exige
un backup administrado verificable, su politica visible, una restauracion en
base sintetica aislada, migraciones 001–024 y FKs comprobadas, y limpieza de la
base temporal. Tambien debe definirse el respaldo del storage privado.

### Criterio objetivo de entorno hospedado sintetico listo

Solo puede declararse listo cuando todos estos puntos tengan evidencia: rama
autorizada distinta del despliegue actual por defecto; HTTPS y proxy con CIDR
exactos; MySQL TLS con red restringida; Redis/Valkey TLS en `PING`; storage
privado disponible si el flujo de comprobantes se incluye; `/health/live` y
`/health/ready` sanos; migraciones 001–024 en base vacia sintetica; smoke tests
PASS; backup y restore remoto sintetico PASS; limites/costo/disponibilidad del
plan aceptados; y limpieza completa. La autorizacion para datos reales sigue
siendo un gate separado posterior.

## Piloto gratuito controlado - pendiente de ejecucion

Este protocolo prepara una validacion controlada de una sola tienda sobre los
planes gratuitos existentes. No es un lanzamiento publico, no autoriza cambios
en proveedores ni incorpora datos reales. Primero debe completarse el entorno
hospedado sintetico; solo despues y con autorizacion expresa del propietario se
podra iniciar un piloto real de siete dias, ampliable hasta catorce si la
evidencia requiere observar mas ciclos operativos. Antes de abrir a mas tiendas
debe decidirse una etapa hospedada con capacidad, persistencia y soporte
pagados o formalmente aprobados.

### Alcance permitido despues del PASS sintetico

- Una cuenta y una tienda aisladas; autenticacion de una cuenta ya preparada,
  sesion, navegacion y consultas protegidas por tenant.
- Catalogo, proveedores, compras, stock, ajustes con motivo, consultas de lotes
  ya disponibles sin inventar una carga nueva, POS, ventas totalmente pagadas,
  clientes, fiado, cobranza, devoluciones/anulaciones conforme a sus contratos,
  caja, cierres, reportes y auditoria.
- El uso diario debe respetar guards de suscripcion, permisos, CSRF, rate limits
  distribuidos e idempotencia; no se admite enviar ni elegir `idTienda` desde el
  cliente.

### Funcionalidades restringidas o bloqueadas

- El registro publico, verificacion y recuperacion por correo no se prueban en
  hosted mientras `EMAIL_DELIVERY_MODE=disabled`; no se finge una entrega.
- Subir, revisar o descargar comprobantes de pagos manuales de suscripcion solo
  se permite si el filesystem privado persistente, su backup y su restauracion
  ya fueron validados. Sin esa evidencia el flujo queda fuera del smoke y del
  piloto gratuito.
- Los scripts de backup y restore del repositorio son locales. El respaldo y la
  restauracion remotos necesitan un procedimiento externo probado con datos
  sinteticos antes de admitir datos reales.
- Quedan bloqueados el lanzamiento publico, multiples tiendas, correo externo,
  pagos automaticos y cualquier dato real antes del PASS sintetico y la
  autorizacion explicita.

### Redis/Valkey y salud operativa

El codigo no permite el fallback en memoria en `staging`: requiere un servicio
Redis o Valkey compatible con TLS, URL `rediss://`, secreto robusto, aislamiento
por prefijo y conexion `PING` antes de escuchar. El servicio actual no es cache,
cola ni store de sesiones; solo respalda rate limits distribuidos. No hay
evidencia de un servicio gratuito compatible ya disponible, por lo que su
eleccion y validacion siguen siendo una decision externa, sin relajar TLS ni la
red.

Antes de cada sesion deben responder `200` ambos endpoints:

- `GET` o `HEAD /health/live`: proceso vivo.
- `GET` o `HEAD /health/ready`: MySQL, migraciones esperadas, Redis/Valkey y
  storage privado cuando ese flujo este incluido.

Un `503`, una dependencia no lista o una respuesta sin el contrato esperado
detiene la sesion; no se cargan ni se operan datos reales.

### Checklist diario

**Sesion sintetica.** Antes de operar, verificar rama/artefacto autorizado,
HTTPS, ambos health checks, aislamiento de la base sintetica y backup disponible.
Ejecutar y reconciliar una compra o entrada, una venta de contado o QR, una
venta a credito y una cobranza, un ajuste permitido, una devolucion o anulacion
solo sobre un registro de prueba y un cierre/reporte. Comparar stock, saldos,
totales, movimientos y auditoria; comprobar que una reactivacion de la accion no
duplique la mutacion. Registrar resultado sin secretos, crear la evidencia de
backup definida y limpiar los datos sinteticos conforme al procedimiento externo.

**Piloto real, solo despues de PASS sintetico.** Repetir al inicio live/ready y
confirmar backup verificable. Operar las transacciones reales del dia con una
sola tienda: acceso, venta, pago, stock, compra, fiado/cobranza, cierre y
reporte. Al cierre, reconciliar ventas, dinero, stock, credito/cobranzas,
duplicados y datos faltantes; conservar evidencia de backup sin exponer datos.
No se ensayan anulaciones, reintentos ni cargas artificiales sobre operaciones
reales solo para probar el sistema.

### Gate de sinteticos a datos reales y detencion inmediata

El paso a datos reales requiere: entorno hospedado sintetico listo segun el
criterio anterior; al menos tres sesiones sinteticas completas consecutivas sin
criticos, duplicados ni diferencias de ventas, stock o credito; backup y restore
remotos sinteticos PASS; evidencia CI vigente; y autorizacion explicita del
propietario para esa unica tienda. Esto no declara `PILOT_READY` hasta que todos
los gates oficiales queden documentados.

Detener de inmediato el piloto ante perdida o inconsistencia de dinero, stock o
credito; mutacion duplicada; acceso entre tenants o bypass de autorizacion;
exposicion de secretos o datos sensibles; fallo de TLS, Redis, MySQL, storage,
backup o restore; suspension/limite del plan Free que afecte la disponibilidad;
o entrada accidental de datos reales al entorno sintetico. Preservar evidencia
segura y no continuar ni restaurar sobre una base real.

## Trust proxy

Express recibe una lista de CIDR mediante `TRUST_PROXY_CIDRS`. No se acepta
`true`, un numero de saltos, un comodin, `/0` ni una lista vacia. Cada CIDR debe
representar la red desde la que el proxy autorizado conecta directamente a
Express, no una red de clientes de Internet.

La topologia y los CIDR exactos deben obtenerse del proveedor antes de crear
staging. Si no se conocen, el proceso falla al arrancar. En local y CI,
`X-Forwarded-For` no cambia `req.ip`; esto evita que un cliente manipule la IP
usada por los rate limits.

## Rate limits distribuidos

`middleware/rate-limiters.js` recibe stores por una interfaz desacoplada. Local
y CI usan el store en memoria de `express-rate-limit` y nunca crean un cliente
externo. Staging y production requieren Redis con TLS mediante
`rate-limit-redis`; cada limitador usa un prefijo separado dentro del entorno.

El servidor espera conexion y `PING` de Redis antes de escuchar. Readiness
comprueba MySQL, migraciones, Redis y storage privado. Un fallo responde como
no disponible con un codigo de componente sanitizado. El cierre ordenado
libera el cliente Redis creado por el proceso.

No hay Redis/Valkey visible en la infraestructura auditada. Antes de iniciar
staging sintetico debe existir un servicio TLS compatible; su URL y credenciales
deben cargarse como secretos de infraestructura, nunca en archivos versionados.

## Correo y almacenamiento

El adaptador de correo actual es solo local y en memoria. En staging o
production rechaza su uso; `EMAIL_DELIVERY_MODE=disabled` hace visible esta
limitacion y evita fingir una entrega externa. Elegir e integrar un proveedor
de correo es requisito previo para habilitar registro, verificacion y
recuperacion en un entorno hospedado.

Los comprobantes permanecen en almacenamiento privado fuera del repositorio y
de rutas publicas. El filesystem es suficiente para una instancia de staging;
antes de ejecutar varias instancias debe definirse un storage privado
compartido, retencion, backup y restauracion.

## Checklist previo a STAGING-2

El procedimiento operativo, rollback y recuperacion local se concentra en
[RUNBOOK_PREPROD.md](RUNBOOK_PREPROD.md). Esta lista no autoriza provisionar ni
desplegar recursos externos.

1. Cerrar la rama autorizada de despliegue, dominio HTTPS, CIDR directos y
   topologia de los recursos Render/Aiven existentes.
2. Restringir la red de MySQL y disponer de Redis/Valkey TLS compatible.
3. Definir storage privado persistente para comprobantes o confirmar que no se
   usara durante la prueba, con backup y restauracion.
4. Configurar secretos sinteticos en el gestor autorizado sin versionarlos.
5. Configurar y verificar health check; revisar limites, suspension y
   facturacion del plan Free antes de depender del servicio.
6. Mantener correo deshabilitado.
7. Ejecutar migraciones 001-024 solo sobre una base vacia sintetica autorizada.
8. Validar `/health/live` y `/health/ready` sin exponer diagnosticos internos.
9. Ejecutar smoke tests, backup/restore remoto y limpieza con datos sinteticos.
10. Documentar rollback antes de cualquier produccion de prueba.

No incorporar tiendas reales, no reutilizar secretos de local o production y
no iniciar STAGING-2 sin autorizacion separada.

La auditoria de dependencias de STAGING-1 no deja vulnerabilidades altas. Se
mantiene un aviso moderado transitivo de `uuid` a traves de ExcelJS; la
correccion automatica propuesta requiere un cambio mayor incompatible y no se
aplica con `--force`. Debe reevaluarse antes de STAGING-2 junto con las pruebas
de exportacion XLSX.
