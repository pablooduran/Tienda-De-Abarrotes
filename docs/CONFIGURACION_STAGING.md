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
| `trust proxy` | `false` | `false` | CIDR explicitos o modo Render documentado | CIDR explicitos |
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
- `TRUST_PROXY_MODE=cidr` (predeterminado) y `TRUST_PROXY_CIDRS` con las redes directas y verificadas del proxy; o, solo para Render Free en staging, `TRUST_PROXY_MODE=render-cloudflare` sin `TRUST_PROXY_CIDRS`;
- `RATE_LIMIT_ENABLED=true`;
- `RATE_LIMIT_STORE=redis`;
- `RATE_LIMIT_REDIS_URL` con esquema `rediss://` y credencial robusta;
- `RATE_LIMIT_REDIS_PREFIX` que identifique el entorno;
- `PAYMENT_RECEIPT_MODE=enabled` (valor predeterminado) junto con
  `PAYMENT_RECEIPT_STORAGE_DRIVER=filesystem` y
  `PAYMENT_RECEIPT_STORAGE_DIR` absoluto y fuera del repositorio; o,
  exclusivamente para el piloto gratuito en staging,
  `PAYMENT_RECEIPT_MODE=disabled` sin variables de almacenamiento;
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
  se probaran comprobantes. El plan actual de Render no lo aporta; para el
  piloto gratuito se puede declarar explicitamente
  `PAYMENT_RECEIPT_MODE=disabled` en staging. Ese modo no inicializa storage,
  deja `privateStorage` como `disabled` en readiness y bloquea carga, revision
  y descarga de comprobantes. No se debe declarar ese flujo validado hasta
  resolver storage persistente, backup y restore.

### Variables por nombre

Todas se cargan exclusivamente desde el gestor de secretos autorizado; este
documento no contiene valores, URIs, certificados ni ejemplos sensibles.

| Grupo | Variables requeridas para staging | Notas de contrato |
| --- | --- | --- |
| Aplicacion y HTTP | `APP_ENV`, `NODE_ENV`, `PORT`, `APP_BASE_URL`, `DB_ENVIRONMENT`, `TRUSTED_ORIGINS`, `TRUST_PROXY_MODE`, `TRUST_PROXY_CIDRS` solo para modo `cidr`, `EMAIL_DELIVERY_MODE` | `APP_ENV` y `DB_ENVIRONMENT` deben ser `staging`; origen HTTPS exacto, sin comodines; correo sigue deshabilitado. |
| MySQL | `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_SSL_ENABLED`, `DB_SSL_CA` | TLS obligatorio; la base debe identificarse como staging y no puede ser local. |
| Redis/Valkey y rate limit | `RATE_LIMIT_ENABLED`, `RATE_LIMIT_STORE`, `RATE_LIMIT_REDIS_URL`, `RATE_LIMIT_REDIS_PREFIX` | Store `redis`, URL TLS y prefijo aislado de staging. Los limites individuales son configurables y no sustituyen el store distribuido. |
| Sesiones | `SESSION_SECRET` | Se usa con `express-session` y store MySQL; debe cumplir la validacion reforzada de hosted. |
| Storage privado | `PAYMENT_RECEIPT_MODE`, y solo si es `enabled`: `PAYMENT_RECEIPT_STORAGE_DRIVER`, `PAYMENT_RECEIPT_STORAGE_DIR` | `enabled` es el valor predeterminado y exige filesystem fuera del repositorio. `disabled` solo es valido en staging; bloquea el flujo manual de comprobantes y no admite storage efimero. Production no puede deshabilitarlo. |
| Mutacion remota puntual | `STAGING_DB_MUTATION_CONFIRMATION` | No es secreto. Solo se usa con `--remote-staging` y el valor exacto documentado para una base staging vacia; no autoriza por si sola ninguna ejecucion. |
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
  valido, proxy sin CIDR o sin modo Render valido, Redis no disponible o storage inaccesible es criterio
  objetivo de no despliegue.

### Red, datos y regiones

1. La aplicacion debe salir desde una rama autorizada de staging, nunca desde
   `main` por defecto, y publicar solo un origen HTTPS incluido en
   `TRUSTED_ORIGINS`.
2. MySQL debe usar TLS con CA validada y una allowlist restringida al egreso
   verificable de la aplicacion. La allowlist abierta observada en Aiven impide
   validar el entorno sintetico.
3. Redis/Valkey debe usar TLS y ser alcanzable solo conforme a la topologia
   aprobada. Para proveedores distintos de Render Free deben conocerse los CIDR
   directos del proxy; Render Free staging usa exclusivamente su modo de
   encabezado documentado.
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
4. Construir con Node 20 y dependencias bloqueadas. La inicializacion remota
   exige autorizacion separada del responsable y las guardas descritas en
   "Inicializacion remota protegida"; aplicar solamente las migraciones
   existentes 001–024 sobre la base vacia autorizada.
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

### Inicializacion remota protegida

Los comandos `db:init` y `db:migrate` conservan su uso local/CI con
`APP_ENV=local` y `DB_HOST=localhost`. Fuera de localhost fallan cerrados salvo
para una preparacion futura de staging que cumpla todos estos requisitos a la
vez: `APP_ENV=staging`, `NODE_ENV=production`, `DB_ENVIRONMENT=staging`,
`DB_NAME=tienda_abarrotes_staging`, host no local, `DB_SSL_ENABLED=true`,
`DB_SSL_CA` presente, el argumento exacto `--remote-staging` y
`STAGING_DB_MUTATION_CONFIRMATION=CONFIRM_EMPTY_STAGING_001_024`.

La confirmacion no es un secreto ni reemplaza una autorizacion operativa. No
debe versionarse en archivos de entorno del repositorio ni compartirse junto a
credenciales. Antes de crear tablas, `db:init` consulta el catalogo de MySQL y
rechaza cualquier base que ya tenga tablas. Antes de aplicar migraciones,
`db:migrate` exige exclusivamente la estructura inicial conocida, sin
`schema_migrations`, sin tablas adicionales y sin filas. Una ejecucion parcial
queda bloqueada para revision manual; no se intenta adoptar ni reparar el
destino de forma automatica.

Render Free no ofrece Shell ni One-Off Jobs para ejecutar estas mutaciones. Por
ello existe un lanzador local de un solo uso, versionado, que no persiste los
secretos introducidos y ejecuta ambas guardas desde un PC Windows autorizado.
No sustituye la autorizacion explicita para abrir una conexion remota ni crea
una configuracion permanente en Render.

Antes de solicitar una mutacion remota o repetir una operacion detenida, el
operador debe ejecutar solo lectura:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\initialize-staging-remote.ps1 -Diagnose
```

Usa el mismo ingreso efimero de host, puerto, usuario, contrasena y CA, pero no
solicita ni establece la confirmacion de mutacion. El resultado expone solo una
categoria: `EMPTY`, `BASELINE_INITIAL`, `PARTIAL_OR_UNEXPECTED` o
`CONNECTION_OR_CONFIGURATION_FAILURE` con un codigo sanitizado. Los codigos
posibles son `PREREQUISITE_LOCAL`, `TLS_CA`, `AUTHENTICATION`,
`NETWORK_TIMEOUT_OR_ALLOWLIST`, `DATABASE_NOT_FOUND_OR_PERMISSION`,
`READ_FAILURE` y `UNKNOWN_SAFE_FAILURE`. No lista tablas, SQL, host ni salida
del driver. Si es `EMPTY`, solicitar una nueva autorizacion antes de inicializar.
Para las otras tres categorias, detenerse y reportar sin reintentar ni proponer
recuperacion. Solo `EMPTY` devuelve codigo de salida `0`; los demas resultados
devuelven `1` para impedir que una automatizacion los trate como aptos.

Despues de un diagnostico `EMPTY` y antes de autorizar una mutacion, el
operador debe ejecutar el preflight independiente:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\initialize-staging-remote.ps1 -Preflight
```

El preflight vuelve a exigir destino exacto, TLS y CA, abre una sola conexion,
aplica `SET time_zone = '-04:00'` solo a esa sesion y consulta los grants
efectivos sin mostrarlos ni persistirlos. No ejecuta DDL ni DML. Su unica salida
es `STAGING_REMOTE_PREFLIGHT: PASS` o `STAGING_REMOTE_PREFLIGHT: FAIL
<CAUSE_CODE>`, donde el codigo posible es `PREREQUISITE_LOCAL`, `TLS_CA`,
`AUTHENTICATION`, `NETWORK_TIMEOUT_OR_ALLOWLIST`,
`DATABASE_NOT_FOUND_OR_PERMISSION`, `SESSION_TIME_ZONE_FAILED`,
`SCHEMA_CREATE_PRIVILEGE_MISSING` o `UNKNOWN_SAFE_FAILURE`. Solo `PASS`
termina con codigo `0`; cualquier fallo termina con `1` y exige detenerse.
El preflight no autoriza por si mismo `db:init` ni `db:migrate`.

Si se necesita aislar conectividad TLS antes del diagnostico de estructura, el
operador puede ejecutar una unica prueba de conexion, tambien solo con
autorizacion explicita y desde un PC Windows autorizado:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\probe-staging-mysql-tls.ps1
```

Solicita de forma efimera la base exacta, host, puerto, usuario, ruta local de
la CA temporal y contrasena oculta. No usa la configuracion de la aplicacion,
no persiste entradas, fuerza TLS con CA, abre una sola conexion y ejecuta solo
una comprobacion de lectura. Expone exclusivamente `STAGING_TLS_PROBE: PASS` o
`STAGING_TLS_PROBE: FAIL <CAUSE_CODE>`, donde el codigo es uno de
`PREREQUISITE_LOCAL`, `TLS_CA`, `AUTHENTICATION`,
`NETWORK_TIMEOUT_OR_ALLOWLIST`, `DATABASE_NOT_FOUND_OR_PERMISSION` o
`UNKNOWN_SAFE_FAILURE`. Todo fallo devuelve `1`, no reintenta y no autoriza
`db:init` ni `db:migrate`.

Si `db:init` se detuvo y se necesita conocer el estado de estructura sin leer
datos de negocio, el operador puede ejecutar solo con autorizacion explicita:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\inspect-staging-schema.ps1
```

El inspector conecta una vez con TLS/CA y consulta exclusivamente
`information_schema.TABLES`. No lee filas ni metadatos de tablas comerciales,
no crea ni modifica estructura, y siempre cierra la conexion. Solo expone
`STAGING_SCHEMA_INSPECTION: EMPTY`, `BASELINE_INITIAL`,
`PARTIAL_OR_UNEXPECTED` o `FAIL <CAUSE_CODE>`. `BASELINE_INITIAL` significa
exactamente las 11 tablas base de `db:init`, sin tablas adicionales ni
`schema_migrations`; `EMPTY` significa cero tablas; todo otro conjunto es
`PARTIAL_OR_UNEXPECTED`. Solo `EMPTY` devuelve `0`; cualquier otro resultado
detiene el procedimiento y no autoriza reintentos ni migraciones.

Con autorizacion explicita nueva posterior a un diagnostico `EMPTY`, el
procedimiento es:

1. Confirmar que la base aislada creada por el proveedor se llama exactamente
   `tienda_abarrotes_staging` y esta vacia; no usar una base existente ni una
   base con datos reales.
2. Descargar la CA de Aiven en una ubicacion temporal privada, fuera del
   repositorio y sin copiarla a chat, Git ni historial de comandos.
3. Desde la raiz del commit autorizado, ejecutar solamente:

   ```powershell
   powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\initialize-staging-remote.ps1
   ```

   El lanzador solicita de forma interactiva el nombre de base, host, puerto,
   usuario, CA temporal, confirmacion exacta y contrasena oculta. Rechaza otro
   destino, host local, TLS ausente, CA no PEM o confirmacion incorrecta; fija
   `APP_ENV=staging`, `NODE_ENV=production`, `DB_ENVIRONMENT=staging`, TLS y
   `--remote-staging` solo para sus dos procesos hijos. No muestra salida de
   esos procesos, URI, host, usuario, contrasena ni CA, y restaura las variables
   del proceso al finalizar.
4. El lanzador ejecuta el mismo preflight inmediatamente antes de toda
   mutacion. Solo tras `STAGING_REMOTE_PREFLIGHT: PASS` ejecuta `db:init --
   --remote-staging`, que verifica el vacio, y despues `db:migrate --
   --remote-staging`, que valida la estructura inicial sin datos y aplica
   unicamente 001–024. No ejecutar esos comandos por separado ni usar SQL
   manual alternativo. Si una fase posterior falla, el lanzador conserva el
   preflight `PASS` y expone una unica linea `STAGING_REMOTE_DB_INIT` o
   `STAGING_REMOTE_DB_MIGRATE` con fase y causa sanitizadas. Las fases posibles
   son autorizacion/configuracion, conexion, zona de sesion, vacio/estructura
   base, verificacion, baseline, registro o aplicacion de migraciones; nunca se
   muestran SQL, host, usuario, contrasena, CA, stack ni salida cruda del motor.
   El preflight, `db:init` y `db:migrate` derivan sus opciones de la misma
   construccion versionada de TLS MySQL; no mantienen configuraciones de
   conexion paralelas.
5. Borrar la copia temporal privada de la CA cuando finalice la operacion.
6. Si cualquiera de los pasos falla, detenerse sin reintentos automaticos,
   conservar evidencia sanitizada y solicitar autorizacion para la revision.

El lanzador no se ejecuta durante pruebas ni despliegues y este documento no
autoriza una conexion remota por si mismo. No existe ni se ejecuta una
migracion 025.

### Criterio objetivo de entorno hospedado sintetico listo

Solo puede declararse listo cuando todos estos puntos tengan evidencia: rama
autorizada distinta del despliegue actual por defecto; HTTPS y proxy con CIDR
exactos o modo Render valido y verificado; MySQL TLS con red restringida;
Redis/Valkey TLS en `PING`; storage
privado disponible si el flujo de comprobantes se incluye, o
`privateStorage: disabled` si se excluye explicitamente en staging;
`/health/live` y `/health/ready` sanos; migraciones 001–024 en base vacia sintetica; smoke tests
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
  ya fueron validados. En el piloto gratuito se configura
  `PAYMENT_RECEIPT_MODE=disabled`: las rutas de carga, revision y descarga
  responden de forma controlada y el flujo queda fuera del smoke y del piloto.
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

### Excepcion limitada para Render Free en staging

`TRUST_PROXY_MODE=render-cloudflare` existe exclusivamente para un Web Service
publico de Render en `APP_ENV=staging`, donde el borde Cloudflare/Render
sobrescribe `CF-Connecting-IP` pero no publica CIDR entrantes verificables.
Este modo requiere que `TRUST_PROXY_CIDRS` este ausente; Express conserva
`trust proxy=false` y un middleware toma la IP normalizada solo de
`CF-Connecting-IP` antes de los rate limits. Ignora expresamente
`X-Forwarded-For`, `X-Real-IP` y encabezados equivalentes.

Una cabecera ausente, multiple o con una IP invalida produce un rechazo
controlado `400 CLIENT_IP_UNAVAILABLE`; no hay fallback a la IP de socket ni a
otros encabezados. El modo no es valido en local, CI o production. Production
y cualquier otro proveedor conservan `TRUST_PROXY_MODE=cidr` y CIDR directos
verificados. Esta excepcion depende de la garantia documentada de Render sobre
la sobrescritura del encabezado; no autoriza usar el encabezado fuera de esa
topologia.

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

Los comprobantes habilitados permanecen en almacenamiento privado fuera del
repositorio y de rutas publicas. El filesystem es suficiente para una instancia
de staging con disco persistente; antes de ejecutar varias instancias debe
definirse un storage privado compartido, retencion, backup y restauracion. El
piloto gratuito no usa filesystem efimero: mantiene el flujo deshabilitado con
`PAYMENT_RECEIPT_MODE=disabled`.

## Checklist previo a STAGING-2

El procedimiento operativo, rollback y recuperacion local se concentra en
[RUNBOOK_PREPROD.md](RUNBOOK_PREPROD.md). Esta lista no autoriza provisionar ni
desplegar recursos externos.

1. Cerrar la rama autorizada de despliegue, dominio HTTPS, CIDR directos y
   topologia de los recursos Render/Aiven existentes.
2. Restringir la red de MySQL y disponer de Redis/Valkey TLS compatible.
3. Definir storage privado persistente para comprobantes con backup y
   restauracion, o configurar `PAYMENT_RECEIPT_MODE=disabled` exclusivamente
   para el piloto sintetico gratuito.
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
