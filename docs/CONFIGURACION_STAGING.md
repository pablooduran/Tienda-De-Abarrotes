# Preparacion de configuracion para staging

## Alcance

STAGING-1 prepara el contrato de ejecucion para `local`, `ci`, `staging` y
`production`. No crea infraestructura, no despliega, no provisiona MySQL o
Redis y no contiene secretos. Staging sigue sin existir hasta que se aprueben
proveedor, red, dominio y procedimiento operativo.

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

No se ha elegido ni contratado proveedor Redis. La URL real y sus credenciales
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

1. Elegir proveedor y topologia de red sin crear recursos desde este bloque.
2. Confirmar dominio HTTPS y CIDR directos del reverse proxy.
3. Provisionar MySQL y Redis exclusivos de staging, sin datos reales.
4. Registrar secretos sinteticos de staging en el gestor del proveedor.
5. Definir storage privado persistente, backup y restauracion.
6. Mantener correo deshabilitado o implementar y probar un adaptador externo.
7. Ejecutar migraciones 001-024 sobre una base vacia de staging autorizada.
8. Validar `/health/live` y `/health/ready` sin exponer diagnosticos internos.
9. Ejecutar smoke tests con datos sinteticos y confirmar limpieza.
10. Documentar rollback antes de cualquier produccion de prueba.

No incorporar tiendas reales, no reutilizar secretos de local o production y
no iniciar STAGING-2 sin autorizacion separada.

La auditoria de dependencias de STAGING-1 no deja vulnerabilidades altas. Se
mantiene un aviso moderado transitivo de `uuid` a traves de ExcelJS; la
correccion automatica propuesta requiere un cambio mayor incompatible y no se
aplica con `--force`. Debe reevaluarse antes de STAGING-2 junto con las pruebas
de exportacion XLSX.
