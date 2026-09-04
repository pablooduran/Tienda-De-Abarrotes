# Runbook local previo a despliegues

## Proposito y alcance

Este runbook prepara la operacion para una futura infraestructura aislada. Se
ejecuta localmente con `APP_ENV=local` y no autoriza desplegar, crear recursos,
usar secretos reales ni conectarse a bases remotas. STAGING-2B permanece
diferido hasta la revision final del producto, la eleccion de proveedor y la
autorizacion de gasto.

Las fuentes de configuracion son [CONFIGURACION_STAGING.md](CONFIGURACION_STAGING.md),
`config/deployment.js` y `config/database-options.js`. La base local autorizada
es `localhost / tienda_abarrotes_pruebas`.

## Contrato de produccion y fail-fast

Antes de un despliegue futuro, el operador debe configurar en el gestor de
secretos del entorno, nunca en Git:

- `APP_ENV=production`, `NODE_ENV=production` y `DB_ENVIRONMENT=production`;
- host, puerto, nombre, usuario y password de una base exclusiva de produccion;
- `DB_SSL_ENABLED=true` y la CA TLS mediante `DB_SSL_CA`;
- `SESSION_SECRET` robusto, unico y no reutilizado;
- `APP_BASE_URL`, `TRUSTED_ORIGINS` y los CIDR directos del proxy;
- Redis TLS, prefijo exclusivo y almacenamiento privado absoluto fuera del
  repositorio;
- `EMAIL_DELIVERY_MODE=disabled` hasta disponer de un adaptador externo
  aprobado.

El arranque debe fallar si falta una variable, se usa un placeholder, la base
no identifica el entorno, falta TLS, Redis no usa `rediss://`, el storage no es
privado o los CIDR del proxy son ambiguos. Local y CI solo admiten
`DB_HOST=localhost`; no pueden degradar hacia produccion. Los secretos, CA,
URLs con credenciales y rutas fisicas no se registran en logs.

## Checklist previo al despliegue autorizado

1. Confirmar commit publicado, CI del mismo SHA en PASS y revision aprobada.
2. Verificar proveedor, dominio HTTPS, red privada y CIDR reales del proxy.
3. Crear secretos unicos en el gestor del proveedor; no copiar `.env.local`.
4. Confirmar que MySQL usa TLS, Redis usa TLS y el almacenamiento es privado,
   persistente y respaldado.
5. Crear un backup externo verificable de la base objetivo y una copia
   consistente del almacenamiento privado; ensayar restauracion en un destino
   aislado.
6. Confirmar que la estrategia de correo sigue deshabilitada o que su adaptador
   externo fue aprobado y probado por separado.
7. Preparar el artefacto versionado y conservar disponible el artefacto previo.
8. Registrar responsable, ventana, SHA, version, hash del backup y criterio de
   abortar. No usar datos ni cuentas reales en staging.

## Migraciones 001-024

Las migraciones son solo hacia adelante. En local/CI, `db:init` y `db:migrate`
solo usan `APP_ENV=local` y `DB_HOST=localhost`. Una futura base remota exige
ademas el contrato fail-closed de `CONFIGURACION_STAGING.md`: staging explicito,
TLS MySQL, base exacta `tienda_abarrotes_staging`, flag `--remote-staging` y
confirmacion no secreta de base vacia. `db:init` rechaza tablas existentes y
`db:migrate` rechaza datos, tablas inesperadas o migraciones registradas antes
de mutar. No ejecutar SQL manual alternativo ni reintentar un destino parcial.

La ejecucion remota requiere autorizacion explicita posterior. Para Render Free
se realiza desde un PC Windows autorizado con
`scripts/initialize-staging-remote.ps1`, no desde Shell ni One-Off Jobs de
Render. Antes de toda mutacion, ejecutar su modo `-Diagnose`: solo consulta y
devuelve `EMPTY`, `BASELINE_INITIAL`, `PARTIAL_OR_UNEXPECTED` o
`CONNECTION_OR_CONFIGURATION_FAILURE <CAUSE_CODE>`. Solo `EMPTY` permite solicitar una nueva
autorizacion para inicializar; cualquier otro resultado exige detenerse y
reportar, sin reintento ni remedio improvisado. Los codigos sanitizados posibles
son `PREREQUISITE_LOCAL`, `TLS_CA`, `AUTHENTICATION`,
`NETWORK_TIMEOUT_OR_ALLOWLIST`, `DATABASE_NOT_FOUND_OR_PERMISSION`,
`READ_FAILURE` y `UNKNOWN_SAFE_FAILURE`. Solo `EMPTY` termina con codigo
`0`; los demas resultados terminan con `1`. El lanzador solicita la
contrasena de forma oculta, lee la CA temporal privada proporcionada por Aiven y
restaura las variables sensibles del proceso al finalizar; los comandos
operativos son los documentados en `CONFIGURACION_STAGING.md`. No guardar
secretos, CA ni valores de conexion en PowerShell, Git, chat o archivos del
repositorio. En una base existente se debe leer primero `schema_migrations`,
hacer backup y ensayar la misma secuencia en una copia aislada.

Con resultado `EMPTY` y una autorizacion nueva para avanzar, ejecutar antes de
la mutacion `scripts/initialize-staging-remote.ps1 -Preflight`. El preflight
solo prueba TLS/CA, `SET time_zone = '-04:00'` para su propia sesion y la
capacidad efectiva de `CREATE` mediante grants no mostrados. No crea ni altera
tablas ni datos. Solo `STAGING_REMOTE_PREFLIGHT: PASS` permite que el lanzador
intente `db:init`; sus fallos sanitizados detienen el procedimiento sin
reintentos. El propio lanzador repite este preflight justo antes de `db:init`,
por lo que un resultado anterior no puede usarse para saltar la validacion.
Si `db:init` o `db:migrate` se detiene despues del preflight, el lanzador
informa una unica linea `STAGING_REMOTE_DB_INIT` o `STAGING_REMOTE_DB_MIGRATE`
con fase y causa sanitizadas. Esa evidencia identifica si la detencion fue en
autorizacion, conexion, zona de sesion, estructura inicial o migraciones sin
mostrar SQL, secretos ni detalles de infraestructura.

Cuando un problema de conexion de staging necesite separarse del diagnostico de
estructura, usar solo con autorizacion explicita
`scripts/probe-staging-mysql-tls.ps1`. El lanzador usa `mysql2` directamente,
fuerza TLS con la CA temporal y ejecuta una unica lectura. Su unica salida es
`STAGING_TLS_PROBE: PASS` o `STAGING_TLS_PROBE: FAIL <CAUSE_CODE>`; no muestra
valores de conexion, SQL, errores crudos ni stack. Un resultado distinto de
`PASS` exige detenerse; no autoriza inicializacion ni migracion.

Si `db:init` se detuvo, no volver a ejecutarlo. Con autorizacion explicita, el
operador puede ejecutar `scripts/inspect-staging-schema.ps1` para una sola
conexion TLS de solo lectura. El inspector consulta exclusivamente
`information_schema.TABLES` y devuelve solo `EMPTY`, `BASELINE_INITIAL`,
`PARTIAL_OR_UNEXPECTED` o `FAIL <CAUSE_CODE>`, sin nombres de tabla, conteos,
datos, SQL ni detalles de conexion. `BASELINE_INITIAL` exige exactamente las
11 tablas iniciales y ausencia de `schema_migrations`; cualquier conjunto
incompleto o adicional es `PARTIAL_OR_UNEXPECTED`. Un resultado distinto de
`EMPTY` exige detenerse y reportar.

No existe rollback automatico de esquema. Si falla una migracion, detener el
despliegue, conservar evidencia sanitizada y restaurar o redirigir hacia la
base anterior solo mediante un procedimiento aprobado. Nunca aplicar una
migracion 025 inexistente ni editar una migracion aplicada.

## Health, logging y comprobaciones posteriores

`GET|HEAD /health/live` confirma que Express responde sin tocar MySQL.
`GET|HEAD /health/ready` comprueba MySQL, las migraciones esperadas, Redis y el
storage privado cuando el entorno es hospedado. Las respuestas son `no-store` y
no muestran host, puertos, SQL, secretos ni rutas.

Despues de un despliegue autorizado, validar en este orden:

1. liveness 200 y readiness saludable;
2. migraciones `001-024` y ausencia de `025`;
3. cookie segura, origen permitido y rate limits desde el proxy real;
4. login y una operacion sintetica aislada por tenant;
5. carga y descarga autenticada de un comprobante sintetico;
6. backup nuevo, manifiesto, checksum y restauracion aislada;
7. limpieza de fixtures, archivos privados, procesos y puertos propios.

Los logs deben usar requestId y eventos sanitizados. No deben contener cuerpos
completos, tokens, passwords, sesiones, hashes, SQL, datos bancarios, rutas
fisicas ni datos de otro tenant. El diagnostico detallado corresponde al
superadmin y no a endpoints publicos.

## Rollback de aplicacion y recuperacion de datos

Un rollback de aplicacion consiste en detener el artefacto nuevo de forma
ordenada y activar el artefacto previo compatible, sin reescribir historiales.
Solo se permite si las migraciones aplicadas siguen siendo compatibles con la
version anterior; de lo contrario se detiene y se usa recuperacion de datos.

Ante una falla operativa:

1. detener escrituras y preservar logs sanitizados, version y hora;
2. mantener la base y los comprobantes afectados sin alterarlos;
3. verificar el backup y su SHA-256;
4. restaurar primero sobre una base nueva y aislada;
5. ejecutar comprobadores de migracion, tenant, sesiones y conteos relevantes;
6. hacer smoke test con escrituras aun bloqueadas;
7. cambiar la conexion mediante configuracion controlada, rotar el secreto de
   sesion y conservar la base previa como rollback;
8. reabrir solo despues de la aprobacion del responsable y documentar el
   incidente.

Los scripts locales `db:backup`, `db:verify-backup`, `db:test-restore` y
`test:backup-restore` no se ejecutan contra infraestructura hospedada: son la
referencia de validacion local y de restauracion temporal.

## Versionado, release y decisiones pendientes

Un release futuro debe identificar SHA, version semantica, fecha, responsable,
artefacto y resultado de CI. La promocion no se hace desde una rama con cambios
sin publicar. La etiqueta `v1.0.0` y una beta requieren una revision integral
del propietario.

STAGING-2B no puede comenzar hasta decidir proveedor/topologia, dominio,
CIDR, MySQL/Redis, storage compartido, correo externo, backup remoto y la
aceptacion o correccion del aviso transitivo ExcelJS/`uuid`. Tambien requiere
smoke tests reales detras de proxy y HTTPS.
