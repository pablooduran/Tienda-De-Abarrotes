# Sistema web para tienda de abarrotes

Sistema con Node.js, Express, MySQL y frontend en HTML, CSS y JavaScript. Administra productos, clientes, proveedores, compras, ventas pagadas o fiadas, pagos parciales, stock, historiales, dashboard y reportes.

## Estructura principal

- `server.js`: servidor Express, sesiones y rutas principales.
- `config/`: validacion de entorno, TLS y conexion MySQL centralizada.
- `middleware/`: proteccion de rutas autenticadas.
- `routes/`: autenticacion y API del negocio.
- `public/`: interfaz web.
- `scripts/`: inicializacion, migraciones y cargas opcionales.
- `database/tienda_abarrotes.sql`: estructura completa para una base nueva.
- `database/migrations/`: cambios incrementales para bases existentes.

## Requisitos

- Node.js 18 o superior.
- MySQL 8.0.16 o superior. Las migraciones 007, 008, 009 y 010 fueron disenadas para MySQL 8.0.46.
- Una base local o de prueba para validar cambios antes de produccion.

## Configuracion local

1. Instale dependencias:

```bash
npm install
```

2. Cree `.env.local` tomando `.env.local.example` como referencia. Use valores propios y no publique ese archivo.

Variables obligatorias para iniciar la aplicacion:

- `DB_HOST`
- `DB_USER`
- `DB_PASSWORD`
- `DB_NAME`
- `DB_PORT`
- `SESSION_SECRET`

`SESSION_SECRET` debe tener al menos 32 caracteres. En local, `DB_SSL_ENABLED=false` mantiene la conexion sin TLS y no intenta leer certificados. La aplicacion se detiene con un mensaje claro si falta una variable obligatoria y nunca imprime contrasenas, hashes ni certificados.

## TLS de MySQL

La configuracion MySQL se construye en `config/database-options.js` y es compartida por el servidor, el almacen de sesiones, el migrador, los comprobadores y las pruebas. No existe deteccion automatica por dominio ni degradacion silenciosa.

En produccion son obligatorios:

```text
APP_ENV=production
DB_SSL_ENABLED=true
DB_SSL_CA="-----BEGIN CERTIFICATE-----\n...contenido PEM de la CA...\n-----END CERTIFICATE-----"
```

`DB_SSL_CA` admite saltos de linea reales o `\n` escapados, como los que puede conservar Render en una variable multilinea. La aplicacion valida el PEM al iniciar y configura `rejectUnauthorized=true`. Si TLS esta desactivado, falta la CA o el certificado no puede cargarse, el proceso se detiene; nunca vuelve a una conexion insegura. `DB_SSL_CA_PATH` queda limitado a desarrollo o entornos controlados y no se admite en produccion.

No agregue certificados al repositorio ni muestre la CA en logs. Obtenga la CA vigente desde el panel seguro del proveedor y carguela como secreto en el entorno de ejecucion.

## Zona horaria de negocio

- La zona de negocio unica es `America/La_Paz` (`-04:00`, sin horario de verano).
- `DATETIME` representa texto civil local `AAAA-MM-DD HH:mm:ss`; `DATE` representa `AAAA-MM-DD`.
- mysql2 devuelve `DATE` y `DATETIME` como texto mediante `dateStrings`, evitando conversiones implicitas a UTC.
- Cada conexion fija `time_zone='-04:00'`; Node genera y valida las marcas con `utils/local-datetime.js` usando la zona IANA explicita.
- Las escrituras activas no usan `NOW()`, `CURRENT_TIMESTAMP` ni `toISOString()` para datos de negocio.
- Los defaults SQL antiguos se conservan por compatibilidad estructural, pero no son la fuente de tiempo de las rutas activas.

Los rangos `DATETIME` usan el contrato semiabierto `[fechaInicio, fechaFin)`: el inicio se incluye y el fin se excluye. Los filtros con dos valores `DATE` incluyen ambos dias y se convierten en Node a medianoche inicial y medianoche posterior al ultimo dia. No se fabrican fechas finales futuras para incluir registros.

## Entorno local aislado

Para probar sin usar la configuracion habitual, cree `.env.local` tomando como referencia `.env.local.example`. No publique ese archivo.

El comando recomendado para iniciar la aplicacion en desarrollo es:

```powershell
npm.cmd run start:local
```

`start:local` establece `APP_ENV=local` de forma portable, carga `.env.local` y se detiene si
`DB_HOST` no es `localhost`. Antes de abrir el servidor muestra solamente entorno, archivo de
configuracion, host, puerto y base; nunca imprime usuario, contrasena, certificado ni secretos.
Puede comprobar la seleccion sin iniciar el servidor con
`npm.cmd run start:local -- --check`.

`npm start` conserva su comportamiento general: usa el valor de `APP_ENV` proporcionado por el
entorno. `APP_ENV=local` selecciona `.env.local`; cualquier otro valor selecciona `.env`. Si
`APP_ENV` no esta definido se muestra una advertencia y se mantiene el uso historico de `.env`.
Produccion debe declarar `APP_ENV=production` de forma explicita.

No comparta `.env` ni `.env.local`. Las credenciales administrativas no deben almacenarse de
forma persistente en esos archivos; use credenciales efimeras solo dentro de mecanismos de prueba
aislados y con limpieza comprobada.

## Comandos de base de datos

Cada accion esta separada para evitar cambios inesperados.

### Crear estructura inicial

```bash
npm run db:init
```

Este comando usa `CREATE TABLE IF NOT EXISTS`, verifica la estructura actual y no ejecuta migraciones, no crea administradores, no carga demostraciones y no modifica registros comerciales. Debe usarse sobre una base local o nueva. Si una base antigua necesita columnas, el comando se detiene e indica que deben aplicarse migraciones.

### Aplicar migraciones

```bash
npm run db:migrate
```

Este comando es independiente y explicito. Registra migraciones aplicadas en `schema_migrations` para no repetirlas. Antes de usarlo sobre una base con datos, haga un respaldo y pruebe primero sobre una copia local.

Migraciones actuales, en orden:

1. `001_mejoras_tienda.sql`: proveedor por producto, categorias, stock entero y ventas fiadas.
2. `002_mejoras_stock_reportes.sql`: presentaciones, stock avanzado, costos y ganancias.
3. `003_borrado_logico.sql`: borrado logico de clientes y fiados.
4. `004_multitienda_base.sql`: tienda inicial, asociacion de datos e indices de aislamiento.
5. `005_planes_suscripciones.sql`: planes, funcionalidades, historial de suscripciones y acceso de solo lectura.
6. `006_catalogo_maestro.sql`: categorias y marcas globales, productos maestros, auditoria y vinculo opcional con el inventario local.
7. `007_movimientos_stock.sql`: historial inmutable de inventario, stock inicial, ajustes protegidos e idempotencia de ventas y compras.
8. `008_punto_venta_pagos.sql`: punto de venta, pagos por metodo, comprobantes, codigo de barras local y compatibilidad con fiados.
9. `009_finanzas_reportes_caja.sql`: gastos, origen del costo historico, reportes financieros, exportaciones y cierres de caja opcionales.
10. `010_inteligencia_inventario.sql`: configuracion de analisis, seguimiento de productos, indices y permisos de inteligencia de inventario.
11. `011_lotes_vencimientos.sql`: control opcional por lotes, vencimientos, FEFO/FIFO y trazabilidad por movimiento.
12. `012_clientes_fiados_comunicacion.sql`: clientes ampliados, configuracion de credito, cobros y seguimiento de cobranza.
13. `013_seguridad_sesiones.sql`: version de sesion por administrador para revocar accesos despues de cambios criticos.
14. `014_operaciones_compensatorias.sql`: contrato base, idempotencia, estados operativos y trazabilidad para futuras compensaciones.
15. `015_compensaciones_venta_inventario.sql`: anulaciones y devoluciones de venta, liquidacion explicita y movimientos compensatorios de stock y lotes.
16. `016_compensaciones_financieras.sql`: reduccion de deuda, obligaciones de reembolso, compensacion de cobros y correccion de metodos.
17. `017_integracion_compensaciones.sql`: liquidaciones materiales inmutables, reportes netos y explicacion compensatoria de cierres futuros.
18. `018_auditoria_administrativa_critica.sql`: bitacora append-only para autenticacion, sesiones, credenciales y superadministracion critica.
19. `019_stock_vendible_ajustes.sql`: clasificacion explicita de lotes, stock vendible y ajustes manuales idempotentes y auditados.

### Auditoria administrativa

AUD-A crea `eventoAuditoriaAdministrativa` y un contrato cerrado de
categorias, acciones, resultados y datos permitidos. Los eventos exitosos que
acompanan una mutacion se insertan en la misma transaccion. Si la transaccion
revierte, el evento exitoso tambien revierte. Los rechazos y fallos
controlados se intentan registrar despues del rollback sin reemplazar el error
funcional original.

La bitacora no guarda cuerpos completos, contrasenas, hashes, cookies,
sesiones, tokens, CSRF, SQL, stacks, claves idempotentes ni huellas. Solo usa
referencias tecnicas acotadas, `requestId` y cambios filtrados por allowlist.
El servicio de registro es exclusivamente de insercion y no existe API de
escritura para la bitacora. AUD-B agrega eventos comerciales para clientes,
productos, inventario, ventas, cobranza, finanzas, compensaciones y
exportaciones. Las ventas, los cobros, los ajustes de stock y las
compensaciones registran su evento correcto dentro de la transaccion cuando
existe `requestId`; los rechazos y fallos se registran despues del rollback
sin sustituir el error funcional. Un reintento idempotente ya resuelto no
duplica el evento. El registrador comercial se monta despues de la sesion y
antes de CSRF y los limitadores, de modo que sus rechazos tempranos tambien
quedan auditados sin copiar cuerpos, cabeceras ni credenciales.

Consultas protegidas:

```text
GET /api/auditoria
GET /api/auditoria/:id
GET /api/admin/auditoria
GET /api/admin/auditoria/:id
```

El propietario solo consulta su `idTienda`. El superadministrador consulta el
alcance global o filtra por una tienda validada. Las cuatro rutas son de solo
lectura, usan el limitador administrativo, `Cache-Control: no-store`,
paginacion determinista y filtros por fecha, categoria, accion, resultado,
actor y entidad. No existen rutas `POST`, `PUT`, `PATCH` o `DELETE` para
auditoria.

La aplicacion comercial y la superadministracion incluyen una pantalla
responsive de consulta y detalle. Los valores anteriores, posteriores y
metadatos vuelven a validarse contra las allowlists antes de salir de la API;
no se exponen `requestId`, cuerpos completos, credenciales ni datos personales.

Politica inicial de retencion: conservar como minimo 365 dias en linea y
revisar trimestralmente volumen, requisitos legales y capacidad. No hay
borrado automatico. Un archivo o purga futura debera ser un mantenimiento
separado, autorizado, verificable y con respaldo; nunca una accion disponible
desde las rutas web.

Validacion segura:

```powershell
$env:APP_ENV = "local"
npm.cmd run test:administrative-audit
npm.cmd run test:administrative-audit-commercial
npm.cmd run test:administrative-audit-frontend
npm.cmd run test:administrative-audit-browser
```

La prueba aplica 018 con el migrador real exclusivamente sobre una base
`tmp_tienda_restore_*`, compara la huella de la base principal y limpia la
base temporal en `finally`. `db:check-administrative-audit` es de solo lectura
y debe ejecutarse sobre una base donde 018 ya haya sido autorizada. Las
pruebas comercial y frontend no modifican MySQL; la prueba de navegador usa
un servidor HTTP local aislado y Edge o Chrome instalado.

### Operaciones compensatorias de venta

La migracion `014` crea `operacionCompensatoria` y separa en `venta.estadoOperacion`
la vigencia comercial (`vigente`, `devuelta_parcial`, `anulada`) del estado de pago.
El backfill solo asigna `vigente`: no cambia importes, saldos, pagos, fiados, cobros,
stock ni lotes.

La cabecera comun reserva estos tipos:

- `anulacion_venta`
- `devolucion_venta`
- `correccion_pago_venta`
- `anulacion_fiado`
- `anulacion_cobro_fiado`
- `correccion_saldo`

Sus estados son `solicitada`, `pendiente_aprobacion`, `aprobada`, `aplicada`,
`rechazada`, `fallida` y `cancelada`. Los estados `aplicada`, `rechazada` y
`cancelada` son terminales por contrato. `requiereAprobacion`, el aprobador y la
fecha correspondiente preparan una aprobacion opcional, pero todavia no existe un
flujo general que solicite o apruebe operaciones. C2 aplica directamente
anulaciones y devoluciones de venta autorizadas dentro de una transaccion; la
aprobacion doble para casos sensibles queda diferida.

Los motivos son una allowlist respaldada por el esquema:
`error_cantidad`, `error_producto`, `error_cliente`, `error_metodo_pago`,
`operacion_duplicada`, `devolucion_cliente`, `mercaderia_danada` y
`otro_controlado`. Este ultimo exige una observacion suficiente.

La idempotencia queda definida por `(idTienda, claveOperacion)` y una
`huellaSolicitud` SHA-256 hexadecimal del payload canonico. En los bloques
de venta, la misma clave y huella devuelve la operacion existente; la misma
clave con una huella distinta responde `409
OPERATION_KEY_CONFLICT`.

La funcionalidad `anulaciones_operativas` queda habilitada en los planes basico y
avanzado; no es una ventaja premium. El historial futuro no debera desaparecer
por downgrade, pero las escrituras continuaran sujetas a tenant, suscripcion y
permisos. Un superadmin sin contexto de tienda no obtiene acceso comercial.

Comprobacion y prueba aislada:

```powershell
$env:APP_ENV='local'
npm.cmd run test:compensation-foundation
npm.cmd run db:check-compensations
npm.cmd run test:sales-compensations
npm.cmd run db:check-sales-compensations
npm.cmd run test:financial-compensations
npm.cmd run db:check-financial-compensations
npm.cmd run test:compensation-integration
npm.cmd run db:check-compensation-integration
```

`test:compensation-foundation` crea exclusivamente bases
`tmp_tienda_restore_*`, usa el usuario auxiliar local de restauracion, prueba
001→014, 013→014 y el esquema inicial, y elimina las bases en `finally`.
`db:check-compensations` valida C1 sobre una base con 014. La prueba
`test:sales-compensations` crea una base `tmp_tienda_restore_*`, aplica 015 solo
alli, valida anulacion total, devolucion parcial y acumulada, concurrencia,
rollback, permisos, CSRF, stock y lotes, y elimina la base en `finally`.
`db:check-sales-compensations` es de solo lectura y requiere 015 en el destino.
`test:financial-compensations` aplica 016 mediante el migrador real solo en una
base temporal, prueba liquidaciones, deuda, reembolsos pendientes, cobros,
metodos de pago, concurrencia, rollback, tenant, plan y CSRF, y compara la huella
de la base principal antes y despues. `db:check-financial-compensations` es de
solo lectura y requiere 016 en el destino.

C4A registra el cumplimiento material de una obligacion mediante:

```text
POST /api/obligaciones-reembolso/:idObligacion/liquidaciones
GET  /api/compensaciones/ventas/:id/comprobante
GET  /api/compensaciones/liquidaciones/:id/comprobante
GET  /api/compensaciones/cobros/:id/comprobante
GET  /api/compensaciones/pagos/:id/comprobante
```

La escritura exige confirmacion, motivo controlado, importe positivo, metodo,
clave idempotente, sesion, tenant, suscripcion activa, CSRF/origen,
rate limiting y `anulaciones_operativas`. Admite reembolsos parciales o totales
y compensacion por otro medio; nunca supera el saldo de la obligacion. El
credito a favor permanece deshabilitado hasta disponer de un libro seguro de
emision y consumo: no se representa como fiado negativo.

`movimientoLiquidacionCompensacion` conserva cada cumplimiento con su fecha
real, responsable, metodo y referencia. No modifica `venta`, `pagoVenta`,
`pagoFiado` ni `cobroFiado`. Los comprobantes de compensacion son entidades
separadas y no exponen claves idempotentes, huellas ni detalles internos.

Los reportes financieros distinguen venta bruta, compensacion de venta y venta
neta. La compensacion de venta afecta ingreso, costo y rentabilidad en la fecha
en que se aplica; el reembolso material afecta caja en su propia fecha y no
vuelve a descontar el ingreso. Los cierres ya guardados quedan congelados. Los
nuevos cierres conservan campos explicativos de compensaciones y reembolsos.
### Interfaz y exportaciones de compensaciones

La seccion **Compensaciones** esta disponible cuando el plan incluye
`anulaciones_operativas`. Permite consultar el historial con filtros de fecha,
tipo, estado, responsable, cliente y venta; revisar una venta antes de anularla
o devolver productos; elegir el tratamiento de inventario; resolver efectos
financieros; registrar reembolsos materiales; compensar cobros; corregir
metodos de pago; y consultar comprobantes imprimibles.

Las acciones mantienen una clave idempotente durante los reintentos del mismo
formulario. El boton se bloquea durante la solicitud, pero la proteccion
definitiva permanece en el backend. Toda accion exige motivo, confirmacion
explicita y, para `otro_controlado`, una observacion suficiente. El registro
original nunca se borra ni se presenta como editable.

Consultas de C4B:

```text
GET /api/compensaciones
GET /api/compensaciones/opciones
GET /api/compensaciones/pendientes
GET /api/compensaciones/ventas/:idVenta/contexto
GET /api/compensaciones/:id
```

Exportaciones protegidas:

```text
GET /api/compensaciones/exportaciones/:tipo.csv
GET /api/compensaciones/exportaciones/:tipo.xlsx
```

Los tipos admitidos son `historial`, `devoluciones`, `liquidaciones`,
`finanzas-netas`, `cuentas-por-cobrar` y `metodos-pago`. Todas requieren
`anulaciones_operativas`; las exportaciones requieren ademas
`exportacion_reportes`, usan un limite explicito de 10000 filas y devuelven
413 sin truncamiento silencioso. CSV y XLSX neutralizan formulas iniciadas por
`=`, `+`, `-` o `@`, incluso si estan ocultas tras espacios o controles. Los
XLSX conservan numeros y fechas como tipos reales.

Los reportes mantienen estas identidades:

- neto comercial = bruto - compensacion comercial;
- el reembolso material se informa por separado y afecta caja en su fecha real;
- la reduccion de deuda afecta cuentas por cobrar;
- una correccion de metodo no cambia el total neto;
- los cierres historicos no se recalculan.

Los comprobantes de anulacion, devolucion, liquidacion, compensacion de cobro y
correccion de pago se imprimen desde el navegador. No incluyen claves
idempotentes, huellas ni datos tecnicos, y declaran que no son facturas
fiscales. El credito a favor sigue deliberadamente no disponible.

Pruebas de C4B:

```powershell
npm.cmd run test:compensation-interface
npm.cmd run test:compensation-frontend
npm.cmd run test:compensation-browser
```

La prueba de navegador usa Edge o Chrome instalado, un servidor HTTP temporal y
respuestas aisladas sin tocar MySQL. Comprueba interfaz, doble envio,
idempotencia, XSS, teclado, foco, impresion, descargas, permisos y vistas
360x800, 768x1024 y 1366x768; cierra servidor y navegador al terminar.

La ruta canonica de C2 es:

```text
POST /api/ventas/:idVenta/compensaciones
```

Requiere sesion vigente, tenant, suscripcion activa y
`anulaciones_operativas`. El cuerpo exige `confirmar=true`, `claveOperacion`,
`motivoCodigo` y `tipoCompensacion`; una anulacion total indica un tratamiento
global y una devolucion parcial indica unidades base por detalle. Los
tratamientos admitidos son `reintegrar_vendible`, `no_reintegrar` y
`aislar_no_vendible`.

La venta, detalles, pagos, fiados y movimientos originales no se borran ni se
reescriben. Las reposiciones crean movimientos positivos nuevos. Una devolucion
con lote vuelve al lote original solo si sigue disponible, no vencido y con
capacidad; en otro caso crea un lote tecnico `reversion` bloqueado, conservando
costo y vencimiento. `no_reintegrar` no aumenta stock.

C2 no devuelve dinero ni modifica deuda automaticamente. Cada compensacion
registra una `liquidacionCompensacionVenta` con reduccion de deuda y/o reembolso
pendientes.

C3 resuelve esas liquidaciones mediante rutas protegidas:

```text
POST /api/liquidaciones-compensacion/:idLiquidacion/resolver
POST /api/cobros-fiado/:idCobro/compensaciones
POST /api/pagos-venta/:idPagoVenta/compensaciones/metodo
```

La resolucion reduce deuda solo hasta el saldo vigente y registra
`montoCompensado` sin volver negativo el fiado. Si ya existian pagos, crea una
obligacion de reembolso `pendiente`, distribuida por pago y metodo efectivo; no
entrega dinero automaticamente. La anulacion de un cobro conserva
`cobroFiado`, `pagoFiado` y `pagoVenta`, crea detalles compensatorios y revierte
sus efectos resumidos. Una correccion de metodo conserva el importe y el registro
original, y guarda el metodo efectivo nuevo en un movimiento compensatorio.
Las operaciones de periodos cerrados se registran en la fecha actual con una
marca de trazabilidad. Nuevos cobros y correcciones financieras se bloquean
mientras exista una liquidacion `pendiente_c3`.

Todas las rutas de C3 exigen sesion, tenant, suscripcion activa, proteccion de
origen/CSRF, rate limiting e `anulaciones_operativas`. La misma clave y huella
devuelve el resultado aplicado; otra huella responde `409
OPERATION_KEY_CONFLICT`. Reportes netos, comprobantes y frontend quedaron
fuera de C3 y se implementaron posteriormente en C4A y C4B.

### Migraciones historicas 001-003

Los archivos `001_mejoras_tienda.sql`, `002_mejoras_stock_reportes.sql` y
`003_borrado_logico.sql` conservan su contenido e identificador historicos. Los dos primeros
incluyen `USE tienda_abarrotes` y 002/003 usan construcciones antiguas de `ALTER TABLE`; por
esa razon `db:migrate` no ejecuta su SQL bruto. Un adaptador aplica operaciones equivalentes,
una por una, exclusivamente sobre `DB_NAME`, comprobando la precondicion y la postcondicion
de cada paso. Cada `ALTER TABLE` es una unidad recuperable independiente; no se confia en una
transaccion global para revertir toda la secuencia DDL.

El detector distingue estos estados:

- `pre`: esquema base valido sin elementos de la migracion.
- `parcial-recuperable`: hay pasos correctos y los restantes son aditivos e inequivocos.
- `parcial-bloqueante`: hay datos que impedirian una FK o un `NOT NULL` y requieren revision.
- `completa-no-registrada`: estructura y datos completos; `db:migrate` puede adoptar y registrar.
- `post`: registro y estado fisico completos.
- `inconsistente`: registro sin estructura completa o definiciones incompatibles; el migrador se detiene.

La validacion es semantica y depende de la etapa real. En una base historica aislada se exige
la relacion simple propia de 001. Si `004_multitienda_base.sql` esta registrada, se exige en su
lugar la FK e indice compuestos por tienda; conservar solo la forma simple ya no basta. Del mismo
modo, 002 acepta ampliaciones `DECIMAL` que no pierdan escala ni digitos enteros, y cuando 011 esta
registrada comprueba la precision final `DECIMAL(14,6)` de los costos que esa migracion amplio. El
diagnostico informa el constraint, indice o definicion real que satisface cada requisito. El
adaptador nunca reemplaza una estructura moderna valida por su forma historica menos estricta.

En este contexto `pre` significa que existen las tablas base de la aplicacion anterior a 001.
Una base totalmente vacia debe inicializarse con `db:init`; las migraciones historicas no inventan
ese esquema base ni cargan datos de demostracion.

La comprobacion es de solo lectura:

```powershell
$env:APP_ENV='local'
npm.cmd run db:check-legacy-migrations
```

Una migracion no se registra hasta que estructura, indices, claves foraneas y datos hayan sido
reinspeccionados. Si ya figura registrada pero esta incompleta, no se intenta una reparacion
silenciosa: haga un respaldo, revise los elementos exactos informados y ensaye la recuperacion
sobre una copia. No edite `schema_migrations` en la base real para forzar el avance.

`database/tienda_abarrotes.sql` representa una instalacion nueva con el estado final post-014.
Aunque ese archivo conserva `CREATE DATABASE` y `USE` para uso manual explicito, el migrador
no lo carga. Las migraciones y los comprobadores siempre usan la base validada en `DB_NAME`,
por lo que tambien funcionan con nombres de base distintos a `tienda_abarrotes`.

La prueba automatizada crea y elimina solamente bases aleatorias con el prefijo
`tmp_tienda_legacy_`, exige MySQL local y rechaza expresamente las bases habituales:

```powershell
$env:APP_ENV='local'
npm.cmd run test:legacy-migrations
```

#### Ensayo posterior sobre una copia local

El siguiente procedimiento se ejecuta solo cuando exista un respaldo verificado. `-p` solicita
la contrasena de forma interactiva; no la escriba en el comando ni en el historial. El nombre
temporal debe conservar el prefijo indicado.

```powershell
$origen = $env:DB_NAME
$copia = 'tmp_tienda_legacy_rehearsal_' + (Get-Date -Format 'yyyyMMddHHmmss')
$dump = Join-Path $env:TEMP ($copia + '.sql')
if ($copia -notmatch '^tmp_tienda_legacy_rehearsal_[0-9]{14}$') { throw 'Nombre temporal inseguro' }

mysqldump --host=$env:DB_HOST --port=$env:DB_PORT --user=$env:DB_USER -p --no-tablespaces --single-transaction --routines --triggers $origen > $dump
mysql --host=$env:DB_HOST --port=$env:DB_PORT --user=$env:DB_USER -p -e "CREATE DATABASE ``$copia`` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
mysql --host=$env:DB_HOST --port=$env:DB_PORT --user=$env:DB_USER -p $copia < $dump

$env:DB_NAME = $copia
npm.cmd run db:check-legacy-migrations

# Solo en la copia, elimine registros para simular adopcion o recuperacion.
mysql --host=$env:DB_HOST --port=$env:DB_PORT --user=$env:DB_USER -p $copia -e "DELETE FROM schema_migrations WHERE nombre IN ('001_mejoras_tienda.sql','002_mejoras_stock_reportes.sql','003_borrado_logico.sql')"
npm.cmd run db:check-legacy-migrations
npm.cmd run db:migrate
npm.cmd run db:check-legacy-migrations

# Compare conteos comerciales con el origen antes de limpiar la copia.
mysql --host=$env:DB_HOST --port=$env:DB_PORT --user=$env:DB_USER -p $origen -e "SELECT 'producto' tabla,COUNT(*) total FROM producto UNION ALL SELECT 'venta',COUNT(*) FROM venta UNION ALL SELECT 'fiado',COUNT(*) FROM fiado"
mysql --host=$env:DB_HOST --port=$env:DB_PORT --user=$env:DB_USER -p $copia -e "SELECT 'producto' tabla,COUNT(*) total FROM producto UNION ALL SELECT 'venta',COUNT(*) FROM venta UNION ALL SELECT 'fiado',COUNT(*) FROM fiado"

if ($copia -notmatch '^tmp_tienda_legacy_rehearsal_[0-9]{14}$') { throw 'Nombre temporal inseguro' }
mysql --host=$env:DB_HOST --port=$env:DB_PORT --user=$env:DB_USER -p -e "DROP DATABASE ``$copia``"
Remove-Item -LiteralPath $dump
$env:DB_NAME = $origen
```

Restaure `DB_NAME` al valor habitual despues del ensayo. Una estructura registrada pero
incompleta debe analizarse con el comprobador; no elimine su registro fuera de una copia
temporal controlada.

Antes y despues de aplicar la migracion multi-tienda sobre una base local, puede obtener una comprobacion de solo lectura:

```powershell
$env:APP_ENV='local'
npm.cmd run db:check-multitenant
```

La salida informa conteos, registros sin `idTienda`, ventas, compras, fiados, stock y pagos. Tambien declara `pre-migracion`, `post-migracion` o `estructura-incompleta-o-migracion-parcial` sin asumir que `tienda` o `idTienda` ya existen. Compare las sumas antes y despues: deben mantenerse iguales y, despues de `004`, los registros comerciales y los propietarios deben mostrar cero filas sin tienda. Un `superadmin` valido conserva `idTienda=NULL`; el informe lo valida por separado y no lo cuenta como registro sin tienda.

La migracion `004` es reintentable. Antes de cada `ADD COLUMN`, `ADD INDEX` o `ADD CONSTRAINT`, `db:migrate` consulta `INFORMATION_SCHEMA` y omite solamente el elemento que ya existe. Si una ejecucion se interrumpe, no se registra como aplicada hasta completar y verificar toda la estructura.

Despues de aplicar `005`, compruebe planes, tiendas sin suscripcion, fechas y posibles periodos superpuestos:

```powershell
$env:APP_ENV='local'
npm.cmd run db:check-subscriptions
```

La migracion crea los planes `basico` y `avanzado`. Las tiendas existentes reciben una suscripcion avanzada de cortesia por 3650 dias para conservar el acceso durante la transicion; el superadmin puede reemplazarla desde el panel sin borrar su historial.

Antes y despues de aplicar `006`, compruebe la estructura del catalogo, vinculos, codigos de barras y acceso de ambos planes:

```powershell
$env:APP_ENV='local'
npm.cmd run db:check-master-catalog
```

El comprobador es de solo lectura y distingue los estados `pre-migracion`, `estructura-parcial` y `post-migracion`. La migracion inicia el catalogo vacio: no vincula productos locales por similitud ni carga productos arbitrarios. Agrega la funcionalidad `catalogo_maestro` a los planes basico y avanzado.

Antes y despues de aplicar `007`, compruebe la estructura, referencias, stock negativo y reconciliacion del inventario:

```powershell
$env:APP_ENV='local'
npm.cmd run db:check-stock-movements
```

El comprobador es de solo lectura y funciona antes de la migracion, con una estructura parcial y despues de completarla. La migracion no cambia el stock comercial existente: crea una entrada inicial por cada producto cuyo stock actual sea mayor que cero. Las claves de operacion y las referencias de detalle evitan duplicar movimientos al reintentar ventas o compras. `db:migrate` no registra `007` hasta verificar toda la estructura, las funciones de ambos planes y la reconciliacion completa.

Antes y despues de aplicar `008`, compruebe pagos, saldos, estados, fiados, claves de operacion y movimientos de venta:

```powershell
$env:APP_ENV='local'
npm.cmd run db:check-pos-payments
```

La migracion conserva ventas antiguas sin inventar su medio de pago. Las ventas pagadas cuyo metodo historico no puede demostrarse quedan identificadas como `legado`; los pagos de fiado existentes se vinculan usando `no_especificado`. No se vuelve a descontar stock ni se crean fiados o movimientos para ventas antiguas. El punto de venta, pagos multiples y recibos por WhatsApp quedan disponibles en los planes basico y avanzado.

Antes y despues de aplicar `009`, compruebe gastos, costos historicos, cierres, permisos por plan y reconciliaciones financieras:

```powershell
$env:APP_ENV='local'
npm.cmd run db:check-financial-reports
```

La migracion crea categorias de gasto editables para cada tienda, sin crear gastos ni cierres. Los costos ya guardados no se recalculan: se marcan como reales cuando existe evidencia del movimiento de venta, estimados cuando provienen de datos anteriores y desconocidos cuando no hay costo disponible. Las ventas nuevas congelan el ultimo costo de compra vigente en `detalleVenta`.

Antes y despues de aplicar `010`, compruebe configuraciones, fechas de seguimiento, indices y permisos por plan:

```powershell
$env:APP_ENV='local'
npm.cmd run db:check-inventory-intelligence
```

La inteligencia de inventario usa `stockUnidadesTotal` como saldo real y calcula recomendaciones sin registrar compras ni cambiar stock. El plan basico recibe resumen, alertas, ranking y valoracion esencial. El avanzado agrega compras sugeridas, rotacion, dias de cobertura, productos sin movimiento y exportacion Excel. Las fechas de seguimiento y configuracion se escriben explicitamente en hora local.

### Crear el primer administrador

Defina temporalmente `ADMIN_USER` y `ADMIN_PASSWORD` en su entorno local. La contrasena debe tener al menos 12 caracteres. Luego ejecute:

```bash
npm run db:create-admin
```

El script solo crea el administrador si el usuario no existe. Nunca reemplaza una contrasena existente y no imprime contrasenas ni hashes. El servidor no crea ni restablece administradores al arrancar.

### Crear un superadmin local de pruebas

La creacion de un superadmin es una accion separada y explicita. Solo esta permitida con `APP_ENV=local`, `DB_HOST=localhost` y una base cuyo nombre contenga `prueba` o `test`.

Defina temporalmente `SUPERADMIN_USER` y `SUPERADMIN_PASSWORD` en la terminal. No existen valores predeterminados y la contrasena debe tener al menos 12 caracteres. Luego ejecute:

```powershell
$env:APP_ENV='local'
$env:SUPERADMIN_USER='<USUARIO_SUPERADMIN_LOCAL>'
$env:SUPERADMIN_PASSWORD='<CONTRASENA_LOCAL_DE_12_O_MAS_CARACTERES>'
npm.cmd run db:create-superadmin
```

El script crea unicamente una cuenta con rol `superadmin`, `idTienda=NULL` y estado activo. No crea tiendas, no modifica usuarios existentes y no imprime la contrasena ni su hash.

### Cargar datos de demostracion

La carga demo es opcional y solo funciona en una base sin datos comerciales. Requiere habilitar expresamente `ALLOW_DEMO_SEED=true` y ejecutar:

```bash
npm run db:seed-demo
```

No use este comando en una base real. Si detecta clientes, proveedores, productos, ventas, compras o fiados, se cancela sin cargar datos.

## Ejecutar localmente

```powershell
npm.cmd run start:local
```

Abra `http://localhost:3000`. `npm start` no fuerza el entorno local y queda disponible para el
entorno configurado por el operador, incluida produccion con `APP_ENV=production`. Antes de usar
`npm run dev`, establezca `APP_ENV=local` en esa terminal.

## Healthchecks operativos

Los healthchecks publicos son pequenos, no requieren sesion y se montan antes de body parsers,
sesiones, CSRF y rutas comerciales:

- `GET|HEAD /health/live`: confirma que Node y Express responden. Nunca consulta MySQL.
- `GET|HEAD /health/ready`: ejecuta `SELECT 1` y comprueba que `schema_migrations` contenga todas
  las migraciones SQL presentes en `database/migrations/`.

Ambos devuelven `X-Request-Id` y `Cache-Control: no-store`; `HEAD` conserva codigo y cabeceras sin
cuerpo. Liveness responde `200` mientras Express funcione. Readiness responde `200 healthy`,
`200 degraded` cuando la latencia supera el umbral blando, o `503 unhealthy` cuando MySQL,
`schema_migrations` o alguna migracion esperada no estan disponibles. Un `500` queda reservado
para defectos inesperados y conserva la respuesta publica generica.

Los valores predeterminados son 300 ms de umbral blando, 1500 ms de timeout duro y 4000 ms de
cache. Se configuran mediante `HEALTH_READINESS_SOFT_MS`, `HEALTH_READINESS_TIMEOUT_MS` y
`HEALTH_READINESS_CACHE_MS`; el umbral blando debe ser menor al timeout. El limitador independiente
usa `HEALTH_RATE_LIMIT_MAX` dentro de la ventana HTTP existente. Ninguna respuesta muestra host,
puerto, base, usuario, consultas, migraciones faltantes ni errores nativos de MySQL.

Una configuracion invalida sigue siendo fatal. Una indisponibilidad temporal de MySQL ya no impide
que Express escuche: liveness permanece en 200 y readiness pasa a 503 hasta que una comprobacion
fuera de la cache confirme la recuperacion. `SIGTERM` y `SIGINT` dejan de aceptar conexiones,
cierran el servidor y despues el pool; `SHUTDOWN_TIMEOUT_MS` limita el cierre a 10000 ms por
defecto.

La prueba aislada no usa MySQL real ni modifica datos:

```powershell
npm.cmd run test:operational-health
```

El diagnostico interno de superadmin y el estado de backups se describen a continuacion.

### Diagnostico interno y backups

`GET /api/admin/health` requiere una sesion vigente con rol `superadmin`. Se monta antes de las
rutas que exigen tenant o suscripcion y reutiliza readiness para informar proceso, base y
migraciones. Tambien inspecciona en modo de solo lectura el backup elegible mas reciente dentro de
`BACKUP_DIR`: no crea directorios, no escribe manifiestos, no ejecuta clientes MySQL y nunca
restaura.

El contrato global es:

- `200 healthy`: base, migraciones y backup correctos.
- `200 degraded`: la aplicacion puede operar, pero el backup falta, esta vencido o no supera su
  verificacion.
- `503 unhealthy`: MySQL no esta disponible o las migraciones esperadas no estan completas.
- `500`: defecto inesperado del diagnostico.

Un backup valido menor de 24 horas usa `BACKUP_OK`; entre 24 y 48 horas usa `BACKUP_STALE`; con
mas de 48 horas usa `BACKUP_TOO_OLD`. Los demas codigos publicos son
`BACKUP_MISSING`, `BACKUP_MANIFEST_MISSING`, `BACKUP_MANIFEST_INVALID`,
`BACKUP_SIZE_MISMATCH`, `BACKUP_CHECKSUM_MISMATCH`, `BACKUP_SQL_INCOMPLETE` y
`BACKUP_CHECK_FAILED`. La respuesta puede incluir antiguedad redondeada y conteos de migraciones,
pero nunca nombres, rutas, hashes, infraestructura, SQL ni errores nativos.

`BACKUP_WARNING_HOURS`, `BACKUP_CRITICAL_HOURS` y `BACKUP_STATUS_CACHE_MS` configuran los umbrales
y la cache; sus valores predeterminados son 24 horas, 48 horas y cinco minutos. La cache se invalida
si cambia el candidato, tamano o fecha de modificacion. Un fallo de backup no modifica
`/health/ready` ni retira el POS del trafico.

```powershell
npm.cmd run test:operational-backup-health
```

Este diagnostico no sustituye una restauracion real periodica. Los backups locales tampoco
protegen frente a la perdida completa del host.

### Eventos y comprobador operativo

El monitor interno mantiene en memoria el ultimo estado observado de `application`, `readiness`,
`database`, `migrations`, `backup` y `gracefulShutdown`. La primera observacion produce
`operational_state_initialized`; las transiciones generan eventos de degradacion, fallo,
escalamiento, cambio de causa o recuperacion. Un sondeo con el mismo estado y codigo no vuelve a
registrarse hasta que venza su cooldown.

Los recordatorios predeterminados son 12 horas para `warn`, 30 minutos para `error` y 15 minutos
para `critical`. Se configuran con `MONITOR_WARNING_REMINDER_MS`, `MONITOR_ERROR_REMINDER_MS` y
`MONITOR_CRITICAL_REMINDER_MS`. El siguiente evento emitido incluye `suppressedCount` y
`occurrenceCount`; los valores nativos de MySQL, rutas, archivos, hashes e infraestructura nunca
forman parte del evento.

El comprobador de una sola ejecucion reutiliza readiness y el estado read-only de backups:

```powershell
$env:APP_ENV='local'
npm.cmd run check:operational-health
```

Solo admite `APP_ENV=local` y `DB_HOST=localhost`. No restaura, no escribe datos y no ejecuta
`mysql`, `mysqldump` ni otros procesos. Sus codigos de salida son `0 healthy`, `1 degraded`,
`2 unhealthy` y `3 configuracion o ejecucion invalida`.

No existe un `setInterval` obligatorio ni un proveedor externo. Un proceso caido no puede
alertarse a si mismo, por lo que la invocacion periodica mediante un monitor autorizado y los
adaptadores reales de correo, webhook u otro canal quedan para una fase posterior. El tracker, la
cache y el rate limiting son por instancia.

```powershell
npm.cmd run test:operational-monitoring
```

## Backups y recuperacion comprobada

Los comandos operativos de backup funcionan solamente con `APP_ENV=local` o `test`,
`DB_HOST=localhost` y TLS local desactivado. Produccion, hosts remotos y nombres de restauracion
que no comiencen exactamente con `tmp_tienda_restore_` se rechazan. No ejecute `db:init`,
`db:migrate`, `db:create-admin` ni `db:seed-demo` contra produccion sin un respaldo verificado y
una restauracion ensayada.

Configure sin secretos versionados:

```dotenv
BACKUP_DIR=./backups
MYSQLDUMP_PATH=
MYSQL_CLIENT_PATH=
BACKUP_RESTORE_USER=
BACKUP_RESTORE_PASSWORD=
BACKUP_RETENTION_DAYS=30
BACKUP_RETENTION_COUNT=10
BACKUP_WARNING_HOURS=24
BACKUP_CRITICAL_HOURS=48
BACKUP_STATUS_CACHE_MS=300000
MONITOR_WARNING_REMINDER_MS=43200000
MONITOR_ERROR_REMINDER_MS=1800000
MONITOR_CRITICAL_REMINDER_MS=900000
```

En Windows se detectan `mysqldump.exe` y `mysql.exe` desde `PATH` y desde la instalacion
habitual de MySQL Server 8.0. Las variables de ruta permiten indicar otra instalacion, incluso
si contiene espacios. Las contrasenas se entregan solamente al entorno del proceso hijo mediante
`MYSQL_PWD`; no aparecen en argumentos, manifiestos ni logs.

### Crear y verificar

```powershell
$env:APP_ENV='local'
$env:DB_HOST='localhost'
npm.cmd run db:backup
npm.cmd run db:verify-backup -- .\backups\BASE_AAAA-MM-DD_HHMMSS.sql
npm.cmd run db:test-restore -- .\backups\BASE_AAAA-MM-DD_HHMMSS.sql
```

El backup usa `--single-transaction`, `--quick`, `--skip-lock-tables`, UTF-8, triggers,
`--no-tablespaces` y `--set-gtid-purged=OFF`. Rutinas y eventos se incluyen solo cuando existen.
El manifiesto contiene SHA-256, tamanio, versiones, commit, migraciones, motores y conteos de
tablas criticas. Si alguna tabla no es InnoDB, el comando advierte que no puede garantizar una
instantanea transaccional completa.

La restauracion crea un nombre aleatorio `tmp_tienda_restore_*`, compara tablas, motores,
`schema_migrations` y conteos, busca referencias huerfanas y ejecuta los comprobadores de
migraciones historicas, sesiones, zona horaria y clientes/credito. La base temporal se elimina en
`finally`, incluso cuando la importacion o un comprobador falla. Nunca ejecuta `db:migrate`.

### Usuario local de restauracion

No conceda `CREATE` o `DROP` globales al usuario de la aplicacion. Cree manualmente con `root`
local un usuario exclusivo y limite sus permisos al prefijo temporal. Sustituya usuario, host y
clave de forma interactiva; no guarde la clave en este archivo ni en el historial:

```sql
CREATE USER 'tienda_backup_test'@'localhost' IDENTIFIED BY 'CLAVE_LOCAL_SEGURA';
GRANT ALL PRIVILEGES ON `tmp\_tienda\_restore\_%`.* TO 'tienda_backup_test'@'localhost';
```

Configure ese usuario mediante `BACKUP_RESTORE_USER` y `BACKUP_RESTORE_PASSWORD`. Ambas variables
son obligatorias para restaurar; el comando nunca reutiliza las credenciales de la aplicacion para
obtener privilegios `CREATE` o `DROP`.

### Retencion local

La limpieza es simulada por defecto, solo considera pares SQL/manifiesto validos dentro de
`BACKUP_DIR`, no sigue enlaces y nunca elimina el backup mas reciente:

```powershell
npm.cmd run db:cleanup-backups
npm.cmd run db:cleanup-backups -- --days=30 --count=10
npm.cmd run db:cleanup-backups -- --days=30 --count=10 --apply --confirm=DELETE_VERIFIED_BACKUPS
```

Los backups contienen datos personales y comerciales. Mantengalos en disco cifrado o en un
contenedor seguro; no los envie por correo ni WhatsApp. El almacenamiento remoto y su cifrado
administrado se definiran durante la preparacion de produccion. No implemente cifrado casero.

### Recuperacion de emergencia

1. Detenga escrituras y registre el incidente sin alterar la base afectada.
2. Conserve una copia adicional de la base daniada antes de cualquier intento.
3. Identifique el backup y ejecute `db:verify-backup` para validar manifiesto, tamanio y SHA-256.
4. Restaure primero en una base nueva, nunca encima de la base daniada.
5. Ejecute `db:test-restore` y los comprobadores de solo lectura indicados en el manifiesto.
6. Compare conteos, migraciones, clientes, ventas, fiados, pagos, stock y relaciones esenciales.
7. Realice un smoke test local con escrituras todavia detenidas.
8. Rote `SESSION_SECRET` para no reactivar sesiones copiadas desde el respaldo.
9. Cambie la conexion a la base restaurada mediante configuracion controlada y reinicie el servicio.
10. Conserve la base anterior para rollback; si falla el smoke test, revierta la conexion.
11. Documente tiempos, responsables, backup utilizado, hash y resultado final.

La prueba integral local es `npm.cmd run test:backup-restore`. Usa una carpeta temporal, restaura
solo en `tmp_tienda_restore_*`, comprueba limpieza tras exito y fallo y no conserva dumps. Finaliza
con codigo distinto de cero si el usuario limitado no esta configurado o no puede restaurar.

## Reglas actuales del negocio

- Una compra aumenta stock y una venta lo disminuye.
- `stockUnidadesTotal` es el stock usado para los calculos; `stock` se mantiene sincronizado por compatibilidad.
- La caja se usa solo para compras. Las ventas permiten paquete o unidad segun el producto.
- Una venta fiada requiere cliente y crea el fiado asociado.
- Los pagos no pueden superar el saldo pendiente.
- Clientes y fiados usan borrado logico y pueden restaurarse.
- Los productos usan borrado logico: ocultarlos o restaurarlos conserva stock y movimientos. Los proveedores todavia requieren una futura revision integral de borrado logico.
- El stock solo cambia mediante alta inicial, compra, venta o ajuste manual. La edicion general del producto muestra el stock como solo lectura.
- Los movimientos se guardan en unidades base enteras. Una operacion por paquete conserva tambien la cantidad y presentacion original para facilitar su lectura.
- Los ajustes manuales operativos usan una cantidad positiva y una direccion separada, motivo controlado, confirmacion e idempotencia. El backend conserva stock anterior/posterior y crea movimientos, lotes y auditoria dentro de la misma transaccion.
- Una venta fiada descuenta stock una sola vez al registrar la venta. Los pagos posteriores no cambian inventario.
- El POS calcula precios, descuentos, pagos, cambio y saldo en el backend. El efectivo recibido se conserva para el comprobante, pero solo el monto aplicado se registra como ingreso.
- El descuento disponible en esta fase es un monto fijo general; no se implementaron promociones ni porcentajes combinables.
- Efectivo, QR y pagos mixtos pueden dejar un saldo parcial. Todo saldo pendiente exige un cliente y genera un unico fiado asociado a la venta.
- El codigo de barras local es opcional, se conserva como texto y debe ser unico dentro de cada tienda. Los lectores que actuan como teclado pueden buscar y agregar con Enter.
- Las compras de mercaderia no son gastos operativos. La ganancia usa solamente el costo de las unidades vendidas; el total comprado se informa por separado.
- El costo vigente sigue siendo el ultimo costo de compra por unidad base y se congela al vender. Promedio ponderado, FIFO y LIFO quedan fuera de esta fase para no reinterpretar inventario historico.
- Ganancia bruta es ventas netas menos costo vendido. Ganancia neta es ganancia bruta menos gastos operativos vigentes.
- Dinero cobrado se obtiene de `pagoVenta` por la fecha real del cobro. Un pago posterior de fiado aumenta cobros, pero no ventas ni stock.
- El flujo de efectivo conocido resta gastos de los cobros registrados. Las compras no se descuentan de caja mientras no tengan un metodo de pago confiable.
- El cierre de caja es opcional, no altera operaciones y solo esta disponible en el plan avanzado. QR no forma parte del efectivo fisico esperado.
- La marca de gasto recurrente es informativa. Esta fase no genera gastos futuros ni realiza cobros automaticos.
- Los rangos usan la zona explicita `America/La_Paz`, independiente de la zona del servidor. `DATETIME` y `DATE` se conservan como texto local y los rangos de fecha/hora son semiabiertos.
- Las recomendaciones de inventario son orientativas. Usan ventas reales de `detalleVenta`, respetan el historial observado y nunca crean compras ni movimientos de stock.
- Cuando el historial es insuficiente, la sugerencia solo intenta alcanzar el stock minimo y se identifica con confianza insuficiente. Los paquetes siempre se redondean hacia arriba.
- La valoracion separa productos con costo conocido de productos sin costo; un costo desconocido no se interpreta como cero real.

## Preparacion multi-tienda

La migracion `004` prepara la estructura y asocia los datos existentes a "Tienda Deisy". El backend obtiene `idTienda` exclusivamente desde la sesion y lo aplica a productos, clientes, proveedores, ventas, compras, fiados, pagos, dashboard y reportes. El navegador no envia ni recibe `idTienda`.

Las APIs operativas aceptan solamente sesiones con rol `dueno_tienda` y una tienda valida. El rol `superadmin` permanece bloqueado en las APIs comerciales y utiliza exclusivamente el panel `/admin.html` y las rutas `/api/admin` para administrar tiendas, propietarios, suscripciones y catalogo maestro.

El superadmin puede crear una tienda junto con su primer propietario en una sola transaccion, agregar propietarios adicionales, actualizar los datos de la tienda, suspender o reactivar accesos y restablecer contrasenas. Estas acciones no borran ni modifican los datos comerciales de una tienda.

Cada tienda tiene un plan y un historial de suscripciones. El plan basico permite un propietario activo, 500 productos, 500 clientes activos y 100 proveedores. El avanzado permite cinco propietarios activos y no limita esas tres entidades. Una suscripcion vencida, suspendida o cancelada mantiene login, consultas, dashboard y reportes, pero bloquea cambios y operaciones comerciales hasta su renovacion.

El catalogo maestro pertenece a la plataforma. El superadmin administra categorias, marcas y productos, y puede importar archivos `.xlsx` de hasta 2 MB y 2000 filas mediante previsualizacion y confirmacion. El codigo de barras es opcional, se conserva como texto y es unico incluso si el producto maestro esta inactivo. Los posibles duplicados sin codigo se advierten por nombre, marca, presentacion y contenido; nunca se fusionan automaticamente.

Una tienda puede buscar el catalogo y copiar uno o varios productos desde el modulo Productos. La copia guarda sus propios precios, stock, proveedor, categoria y configuracion. Cambiar o desactivar el maestro no modifica productos ya copiados. Una suscripcion de solo lectura permite consultar el catalogo, pero no agregar productos.

### Prueba local de aislamiento

Con el servidor local iniciado en otra terminal, ejecute:

```powershell
$env:APP_ENV='local'
npm.cmd run test:tenant-isolation
```

La prueba exige una base local cuyo nombre contenga `prueba` o `test`. Crea temporalmente una segunda tienda, verifica sesiones independientes, IDs cruzados, ventas, compras, fiados, pagos, dashboard y reportes, y elimina solamente los datos de prueba que genero.

### Prueba local del panel administrativo

Con el servidor local iniciado en otra terminal, ejecute:

```powershell
$env:APP_ENV='local'
npm.cmd run test:admin-management
```

La prueba tiene las mismas protecciones de host y nombre de base. Crea credenciales y una tienda con identificadores aleatorios, comprueba permisos, duplicados, aislamiento, activacion, desactivacion y restablecimiento de contrasena, y finalmente elimina solo los registros temporales que genero.

### Prueba local de planes y suscripciones

Con `005` aplicada y el servidor local iniciado, ejecute:

```powershell
$env:APP_ENV='local'
npm.cmd run test:subscriptions
```

La prueba valida altas basicas, avanzadas y de prueba, limites, modo de solo lectura, renovaciones, historial y permisos. Solo funciona en localhost y en una base cuyo nombre contenga `prueba` o `test`; elimina los datos temporales que crea.

### Prueba local del catalogo maestro

Con `006` aplicada y el servidor local iniciado, ejecute:

```powershell
$env:APP_ENV='local'
npm.cmd run test:master-catalog
```

La prueba verifica permisos administrativos, duplicados, busqueda para ambos planes, aislamiento entre tiendas, alta manual y desde catalogo, limites, solo lectura, importacion Excel y limpieza. Solo se habilita para `localhost` y una base cuyo nombre contenga `prueba` o `test`; usa credenciales temporales aleatorias y elimina los registros que crea.

### Prueba local de movimientos de stock

Con `007` aplicada y el servidor local iniciado, ejecute:

```powershell
$env:APP_ENV='local'
npm.cmd run test:stock-movements
```

La prueba comprueba altas iniciales, compras, ventas pagadas y fiadas, pagos sin impacto en stock, ajustes protegidos, ocultar/restaurar, idempotencia, aislamiento, solo lectura, rollback, concurrencia y reconciliacion. Solo funciona en localhost y en una base cuyo nombre contenga `prueba` o `test`; crea dos tiendas con credenciales aleatorias y elimina sus datos temporales al finalizar.

### Prueba local del punto de venta

Con `008` aplicada y el servidor local iniciado, ejecute:

```powershell
$env:APP_ENV='local'
npm.cmd run test:pos-payments
```

La prueba cubre busqueda por nombre y codigo, favoritos, unidad y paquete, efectivo, QR, pago mixto, cambio, saldos parciales, fiado completo, idempotencia, rollback, concurrencia, comprobantes, aislamiento y modo de solo lectura. Solo funciona en localhost y en una base cuyo nombre contenga `prueba` o `test`; limpia las tiendas, usuarios y operaciones temporales que crea.

### Prueba local de finanzas y caja

Con `009` aplicada y el servidor local iniciado, ejecute:

```powershell
$env:APP_ENV='local'
npm.cmd run test:financial-reports
```

La prueba valida categorias y gastos, anulacion logica, aislamiento, costos congelados por unidad y paquete, fiado y cobro posterior, descuentos, ganancia bruta y neta, compras separadas, reportes, permisos de planes, cierre de caja, exportacion Excel y neutralizacion de formulas. Solo funciona en localhost y en una base cuyo nombre contenga `prueba` o `test`; elimina los datos temporales que crea.

### Prueba local de inteligencia de inventario

Con `010` aplicada y el servidor local iniciado, ejecute:

```powershell
$env:APP_ENV='local'
npm.cmd run test:inventory-intelligence
```

La prueba valida estados de stock, historial suficiente, demanda, sugerencias por unidad y paquete, dias restantes, rotacion, productos sin movimiento, valoracion, aislamiento, permisos por plan, solo lectura y exportacion Excel segura. Crea dos tiendas temporales en localhost y elimina todos los datos que genera.

### Prueba local de lotes y vencimientos

Con `011` aplicada y el servidor local iniciado, ejecute:

```powershell
$env:APP_ENV='local'
$env:DB_HOST='localhost'
npm.cmd run test:lots-expiration
```

La prueba verifica activacion y distribucion inicial, compras por unidad y paquete, FEFO, FIFO, vencimientos, lotes bloqueados, costos ponderados, ajustes, idempotencia, concurrencia, trazabilidad, aislamiento y continuidad operativa tras un cambio de plan. Solo funciona en localhost y en una base cuyo nombre contenga `prueba` o `test`; elimina primero los movimientos y lotes temporales para respetar el historial protegido por claves foraneas.

### Prueba local de clientes y credito

Con `012` aplicada y el servidor local iniciado, ejecute:

```powershell
$env:APP_ENV='local'
$env:DB_HOST='localhost'
npm.cmd run test:customers-credit
```

La prueba cubre perfiles ampliados, documentos normalizados, limites individuales y de tienda, politicas de deuda vencida, fechas prometidas, cobros especificos y acumulados, deuda oculta, idempotencia, concurrencia, estado de cuenta, alertas, seguimientos, mensajes preparados para WhatsApp y los ocho segmentos dinamicos. Tambien confirma aislamiento entre tiendas, permisos por plan, continuidad de cobros tras un downgrade, filtros previos a paginacion y que ningun pago modifica stock, lotes o movimientos de inventario. Usa solamente tiendas y credenciales temporales en una base local cuyo nombre contenga `prueba` o `test`, y elimina todos los datos que crea.

#### Exportaciones de clientes y cobranza

El plan que incluye `exportacion_clientes_fiados` puede generar XLSX desde **Clientes**, **Cobranza** y el estado de cuenta. Los endpoints canonicos son `GET /api/clientes/exportacion.xlsx`, `GET /api/fiados/exportacion.xlsx` y `GET /api/clientes/:id/estado-cuenta/exportacion.xlsx`. Requieren una suscripcion activa y, respectivamente, `clientes_basico`, `fiados_basico` o `estado_cuenta_basico`; todos usan exclusivamente la tienda autenticada.

Los listados exportan el conjunto global que cumple los filtros, no solo la pagina visible. El estado de cuenta usa fechas `DATE` locales inclusivas y construye internamente un final semiabierto; muestra ventas como referencia y aplica al saldo solamente la deuda creada y sus pagos. Toda celda textual procedente de usuarios se neutraliza frente a formulas de hoja de calculo.

Los limites son explicitos, configurables y nunca truncan en silencio:

```text
CUSTOMER_CREDIT_EXPORT_CLIENTS_MAX_ROWS=5000
CUSTOMER_CREDIT_EXPORT_DEBTS_MAX_ROWS=10000
CUSTOMER_CREDIT_EXPORT_STATEMENT_MAX_ROWS=20000
```

Al superarlos se responde HTTP `413` con `EXPORT_ROW_LIMIT_EXCEEDED`; el usuario debe reducir fechas o filtros. Los nombres de archivo y la fecha de generacion usan `America/La_Paz`.

#### Segmentacion dinamica de clientes

El plan que incluye `segmentacion_clientes` habilita `GET /api/clientes/segmentacion` y la vista **Segmentacion** dentro de Clientes. El endpoint tambien exige `clientes_basico`, obtiene siempre la tienda autenticada y calcula resultados en el momento; no guarda etiquetas ni crea una tabla de segmentos. Una suscripcion suspendida conserva la lectura historica conforme al contrato general de consultas, pero un plan sin la funcion avanzada recibe `403`.

Los segmentos disponibles y sus reglas son:

- `frecuentes`: al menos 5 compras en los ultimos 90 dias, valores configurables con `comprasMinimas` y `dias`.
- `inactivos`: cliente activo sin compras durante 90 dias o sin compras registradas; `diasSinCompra` es configurable y los ocultos solo entran con `estadoCliente=ocultos|todos`.
- `con_deuda`: suma reconciliada de `fiado.saldoPendiente` mayor que cero.
- `vencidos`: deuda abierta, activa y no cerrada cuya `fechaVencimiento` original es anterior al dia local actual.
- `promesa_incumplida`: deuda abierta, activa y no cerrada cuya `fechaPrometidaPago` es anterior al dia local actual.
- `buenos_pagadores`: al menos 3 fiados cerrados y evaluables durante 365 dias, puntualidad minima de 80%, sin deuda vencida ni promesas incumplidas actuales. La puntualidad compara `DATE(cerradoEn)` con `fechaVencimiento`; fiados sin vencimiento no se inventan ni entran al denominador.
- `mayor_compra`: ranking por total de ventas dentro del periodo, con cantidad y ticket promedio.
- `mayor_saldo`: ranking por saldo pendiente, saldo vencido y cantidad de deudas.

Los valores predeterminados pueden ajustarse mediante parametros validados; `pageSize` y `limiteResultados` admiten de 1 a 100 filas por pagina. `fechaDesde` y `fechaHasta` son fechas civiles inclusivas de `America/La_Paz`; internamente se usa un rango `DATETIME` semiabierto. La busqueda cubre nombre, telefono y documento normalizado. `estadoCliente` admite unicamente `activos`, `ocultos` o `todos`, y los campos de orden usan una lista permitida.

La respuesta incluye `descripcion`, `criterios`, `parametrosAplicados`, resumen global, resultados explicados y paginacion. Los filtros y agregados se aplican antes de `LIMIT/OFFSET`; las metricas no se reconstruyen con la pagina visible. La segmentacion conserva sus metricas historicas de clientes y no sustituye los reportes financieros netos de compensaciones. Para volumenes grandes conviene medir los planes de ejecucion; los indices actuales por tienda, cliente y fecha soportan la primera version, pero una migracion futura puede incorporar indices especializados segun datos reales.

### Seguridad y revocacion de sesiones

La migracion `013` agrega `administrador.versionSesion`. Cada peticion autenticada contrasta el administrador, su rol, asociacion, tienda y version contra la base. Desactivar una cuenta o tienda, cambiar el usuario o restablecer una contrasena invalida las sesiones anteriores.

```powershell
$env:APP_ENV='local'
$env:DB_HOST='localhost'
npm.cmd run db:check-session-security
npm.cmd run test:session-revocation
```

El comprobador es de solo lectura y reconoce estados pre, parcial y post migracion. La prueba requiere el servidor local y una base cuyo nombre contenga `prueba` o `test`; usa cuentas y tiendas temporales sin imprimir contrasenas ni identificadores de sesion.

### Validacion de TLS y zona horaria

Con la configuracion local activa, el comprobador de solo lectura informa la politica TLS sin mostrar la CA, verifica `dateStrings`, la zona de sesion MySQL, la coincidencia del dia local entre Node y MySQL y enumera defaults SQL heredados:

```powershell
$env:APP_ENV='local'
$env:DB_HOST='localhost'
npm.cmd run db:check-timezone-tls
npm.cmd run test:timezone-tls
```

La prueba no inicia el servidor ni modifica datos. Valida configuraciones TLS sinteticas, parseo y formato local, medianoche, rangos semiabiertos, independencia de `TZ` del sistema operativo, round-trip de `DATE/DATETIME` y compatibilidad con `ONLY_FULL_GROUP_BY`.

### Seguridad HTTP

El sistema es same-origin y no habilita CORS global. Toda solicitud `POST`, `PUT`, `PATCH` o `DELETE` debe proceder de un origen incluido en `TRUSTED_ORIGINS` y enviar `X-Requested-With: XMLHttpRequest`. El frontend incorpora este encabezado mediante un unico cliente HTTP. En produccion, `TRUSTED_ORIGINS` es obligatorio, solo admite origenes HTTPS exactos y nunca acepta comodines.

Helmet aplica una CSP sin `unsafe-inline` ni `unsafe-eval` para scripts. Los recursos se limitan al propio origen; se bloquean objetos y marcos, y HSTS se activa solamente en produccion HTTPS. Las respuestas autenticadas y de API usan `Cache-Control: no-store`.

Los limites HTTP se configuran con:

```text
RATE_LIMIT_ENABLED=true
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX=3000
LOGIN_RATE_LIMIT_MAX=10
LOGIN_IDENTITY_RATE_LIMIT_MAX=6
AUTH_RATE_LIMIT_MAX=120
ADMIN_RATE_LIMIT_MAX=600
EXPORT_RATE_LIMIT_MAX=30
WHATSAPP_RATE_LIMIT_MAX=60
HEALTH_RATE_LIMIT_MAX=900
HEALTH_READINESS_SOFT_MS=300
HEALTH_READINESS_TIMEOUT_MS=1500
HEALTH_READINESS_CACHE_MS=4000
SHUTDOWN_TIMEOUT_MS=10000
BACKUP_WARNING_HOURS=24
BACKUP_CRITICAL_HOURS=48
BACKUP_STATUS_CACHE_MS=300000
MONITOR_WARNING_REMINDER_MS=43200000
MONITOR_ERROR_REMINDER_MS=1800000
MONITOR_CRITICAL_REMINDER_MS=900000
SECURITY_LOG_LEVEL=info
```

El login mantiene contadores separados por IP y por el hash de la combinacion IP + usuario normalizado. Las credenciales inexistentes, incorrectas o no disponibles devuelven la misma respuesta. Un exceso produce HTTP `429`, codigo `TOO_MANY_LOGIN_ATTEMPTS` y `Retry-After`. `APP_ENV=test` puede desactivar los limites con `RATE_LIMIT_ENABLED=false`; produccion no.

La primera version usa el almacen en memoria de `express-rate-limit`. El limite se aplica por proceso y se reinicia al reiniciar la instancia; antes de escalar horizontalmente debe sustituirse por un almacen compartido, como Redis. No se presenta este contador como bloqueo distribuido o permanente.

Cada respuesta incluye `X-Request-Id`. Los errores publicos incluyen una referencia sin stack, SQL, rutas internas ni secretos. El registro de seguridad usa la hora local de negocio, no guarda bodies completos y redacta contrasenas, hashes, cookies, tokens, autorizacion, secretos, certificados y contenido de WhatsApp.

En Render, configure `TRUSTED_ORIGINS` con el dominio HTTPS publico exacto y conserve `trust proxy=1`, ya que existe un unico proxy frontal administrado. En local, el proxy no se confia y se admiten de forma explicita `http://localhost:3000` y `http://127.0.0.1:3000`. No agregue certificados, secretos ni archivos `.env` a Git.

La prueba de seguridad usa servidores efimeros aislados: no requiere MySQL, no modifica datos y no necesita credenciales. El comprobador es estatico.

```powershell
npm.cmd run check:web-security
npm.cmd run test:web-security
```

Despues de iniciar el servidor local, las pruebas funcionales existentes ya envian el origen y encabezado requeridos mediante `scripts/http-test-security.js`.

Los cobros posteriores se registran con una cabecera `cobroFiado` y una distribucion `pagoFiado` por deuda. Cada distribucion vinculada a una venta produce un unico `pagoVenta`; los reintentos con la misma `claveOperacion` devuelven el cobro existente sin duplicar dinero ni saldos. WhatsApp se limita a preparar texto y un enlace `wa.me`: nunca envia ni marca mensajes como enviados automaticamente.

Las plantillas de cobranza se administran con `GET|POST /api/plantillas-cobranza`, `PATCH /api/plantillas-cobranza/:id` y las acciones `activar` o `desactivar`. Requieren `recordatorios_fiado`; las escrituras tambien requieren una suscripcion activa. El tipo de una plantilla existente es inmutable, pueden coexistir varias activas y la preparacion elige la activa actualizada mas recientemente, usando `idPlantillaCobranza` para una seleccion explicita. Si un tipo no tiene plantillas activas, se usa un texto interno seguro sin crear datos ni activar una plantilla automaticamente. Se admiten las variables historicas `{variable}` y las nuevas `{{variable}}`; las variables validas dependen del tipo y el contenido siempre se presenta como texto.

Los comprobantes historicos se consultan mediante `GET /api/cobros-fiado/:id/comprobante` con `pagos_fiado`. Incluyen cabecera, distribuciones, saldos anterior y posterior de las deudas afectadas, y pueden imprimirse desde el navegador. Son comprobantes de pago internos, no facturas fiscales. No exponen `claveOperacion`. En cobros legados pueden faltar referencia, monto recibido o responsable; la interfaz muestra el dato como no disponible. Los importes, fechas y distribuciones provienen del cobro guardado, pero los nombres de tienda, cliente y responsable reflejan sus registros actuales porque el esquema no conserva snapshots textuales.

### Validacion del frontend de clientes y cobranza

La interfaz conserva **Clientes** y presenta las deudas bajo **Cobranza**. La prueba estatica no inicia el servidor ni usa la base de datos:

```powershell
npm.cmd run test:customers-credit-frontend
```

La prueba de navegador inicia y cierra su propio servidor local, crea tiendas y usuarios temporales en la base de pruebas y controla Edge o Chrome instalado mediante `playwright-core`:

```powershell
$env:APP_ENV='local'
$env:DB_HOST='localhost'
npm.cmd run test:customers-credit-browser
```

La base configurada debe contener `prueba` o `test` en su nombre. No depende de un servidor previo ni descarga un navegador. Si Edge o Chrome no estan en sus rutas habituales, defina `BROWSER_EXECUTABLE_PATH`. Los XLSX y demas artefactos se guardan en una carpeta temporal y se eliminan en `finally`; al terminar tambien se cierran navegador y servidor y se limpian las tiendas temporales. La bateria recorre login, clientes, POS fiado, cobranza, comprobantes, plantillas, WhatsApp preparado, segmentacion, exportaciones, permisos, aislamiento, modo de solo lectura, teclado, impresion y vistas de 360, 768 y 1366 px.

El listado canonico `GET /api/clientes` acepta `estado=activos|ocultos|todos`; si se omite, devuelve solo activos. `DELETE /api/clientes/:id` oculta y `PATCH /api/clientes/:id/restaurar` restaura, siempre dentro de la tienda autenticada, con `clientes_basico` y confirmacion de la contrasena administrativa. La ruta de compatibilidad `GET /api/clientes/ocultos` delega al mismo listado. Ocultar nunca borra ni modifica ventas, fiados, pagos o seguimientos: una deuda existente sigue visible y cobrable desde **Cobranza**, mientras el cliente queda fuera del POS y no puede recibir ventas nuevas hasta ser restaurado.

Con un plan basico y una suscripcion activa, confirme que se pueden consultar clientes, deuda y estado de cuenta, y registrar pagos de deuda existente. El detalle basico nunca incluye seguimientos de cobranza; la respuesta informa la capacidad `permisos.seguimientoCobranza`. Los limites personalizados, seguimientos y recordatorios deben aparecer bloqueados o ausentes segun sus funciones.

Con un plan avanzado, confirme el alta y edicion ampliada, configuracion de credito, alertas, promesas, seguimientos y preparacion de WhatsApp. Abrir WhatsApp no debe registrar un envio; **Marcar como enviado manualmente** es una accion separada.

En **Cobranza**, abra **Plantillas de cobranza** y valide listado, filtros, alta, edicion, vista previa textual y activacion logica. Desactive todas las plantillas de un tipo para comprobar el fallback interno, y seleccione una plantilla activa al preparar WhatsApp. Desde la ficha del cliente, abra la pestaña **Pagos**, consulte un comprobante e imprimalo; tambien debe abrirse tras registrar un cobro nuevo. La impresion no incluye controles y muestra expresamente que no es una factura fiscal.

En el POS, seleccione un cliente y verifique deuda, limite, credito disponible y fecha de vencimiento. El cliente ocasional solo puede pagar al contado. Una politica de advertencia debe exigir confirmacion y motivo; una politica de bloqueo debe permitir cambiar la venta a contado.

Para pagos especificos y acumulados, pruebe efectivo, cambio, otros metodos y un reintento de red. La clave de operacion debe mantenerse durante el mismo intento y renovarse al abrir otro pago. En modo de solo lectura, la consulta historica permanece disponible, pero los cobros y demas escrituras quedan bloqueados hasta reactivar la suscripcion.

Los listados de cobranza aplican busqueda, estado y fechas en el backend antes de paginar. Sus tarjetas resumen representan el total filtrado de la tienda; la interfaz informa por separado cuantas filas de ese total aparecen en la pagina actual. El estado de cuenta pagina una sola cronologia combinada de ventas, fiados y pagos, con orden determinista y metadatos `page`, `pageSize`, `total`, `totalPages`, `hasNextPage` y `hasPreviousPage`.

El selector del POS conserva por ahora el limite operativo de 500 clientes cargados. La busqueda remota paginada para tiendas con catalogos mayores queda pendiente; no se debe aumentar el limite ni cargar todos los clientes sin paginacion.

Revise la interfaz a 360, 768 y 1366 px. En movil, clientes y cuentas se muestran como tarjetas sin desplazamiento horizontal obligatorio. El estado de cuenta se imprime desde el navegador con estilos A4 y puede exportarse como XLSX; no se genera PDF.

### Fase 10 — estado final

La Fase 10 queda implementada de extremo a extremo para clientes, credito y cobranza. Incluye perfiles ampliados, ocultacion y restauracion logica, configuracion y validacion de credito, ventas fiadas desde POS, cobros parciales, totales y acumulados idempotentes, estado de cuenta paginado, seguimientos, promesas, WhatsApp preparado, plantillas por tienda, comprobantes imprimibles, exportaciones XLSX y ocho segmentos dinamicos. Los cobros no modifican inventario y cada distribucion se reconcilia con `pagoFiado`, `cobroFiado`, `fiado`, `pagoVenta` y la venta relacionada.

Los endpoints principales usan autenticacion, tenant y contexto de suscripcion globales. Los permisos especificos son:

- `clientes_basico`: clientes, perfil y resumen.
- `fiados_basico`: consulta de deuda y cobranza basica.
- `pagos_fiado`: cobros y comprobantes historicos.
- `estado_cuenta_basico`: estado de cuenta.
- `limites_credito`: configuracion y campos avanzados de credito.
- `seguimiento_cobranza`: promesas e historial de gestiones.
- `recordatorios_fiado`: alertas, plantillas y WhatsApp preparado.
- `exportacion_clientes_fiados`: los tres XLSX.
- `segmentacion_clientes`: segmentacion dinamica y sus metricas globales.

Las escrituras requieren una suscripcion activa. El modo de solo lectura conserva las consultas historicas, pero no permite cobros, cambios, exportaciones ni preparaciones que registren actividad. Un downgrade conserva clientes, deuda, pagos, comprobantes y estado de cuenta; deja de exponer seguimientos y herramientas avanzadas. Ningun endpoint de este modulo acepta `idTienda` del navegador.

Validacion final recomendada:

```powershell
$env:APP_ENV='local'
$env:DB_HOST='localhost'
npm.cmd run test:customers-credit
npm.cmd run test:customers-credit-frontend
npm.cmd run test:customers-credit-browser
npm.cmd run test:pos-payments
npm.cmd run test:tenant-isolation
npm.cmd run test:subscriptions
npm.cmd run db:check-customers-credit
```

Limitaciones conocidas y trabajo futuro:

- El selector inicial del POS carga como maximo 500 clientes; una tienda mayor necesitara busqueda remota paginada.
- Los historiales resumidos de la ficha muestran los 20 registros mas recientes y remiten al estado de cuenta para la cronologia completa.
- Los comprobantes no son facturas fiscales y los nombres de tienda, cliente y responsable no tienen snapshots historicos.
- WhatsApp solo prepara texto y enlaces `https://wa.me/`; no envia mensajes automaticamente.
- No se generan PDF. Los comprobantes compensatorios se imprimen como HTML y no son facturas fiscales. Tampoco se implementa portal publico del cliente.
- Los segmentos se calculan con el modelo historico de clientes; los importes contables netos se consultan en los reportes financieros compensatorios. No se implementa un segmento predictivo de abandono.
- Los limites XLSX son 5000 clientes, 10000 fiados y 20000 movimientos de estado de cuenta, salvo configuracion explicita.

`npm audit` informa dos entradas moderadas relacionadas: `exceljs@4.4.0` queda marcado por su dependencia transitiva `uuid@8.3.2`, afectada por `GHSA-w5hq-g745-h8pq`. No hay hallazgos altos o criticos en este informe. La correccion automatica propuesta implica un cambio mayor o una degradacion de ExcelJS, por lo que no debe ejecutarse `npm audit fix --force`; la actualizacion se evaluara de forma controlada cuando ExcelJS publique o adopte una version compatible de UUID.

### Validacion manual de la interfaz de inteligencia de inventario

Inicie el servidor local y abra la seccion **Inteligencia de inventario** desde el menu de la tienda. Pruebe filtros de fecha, categoria, proveedor, producto y estado; el rango maximo admitido es de 365 dias.

Con una tienda de plan basico, confirme:

- se muestran resumen, alertas, ranking y valoracion;
- los productos agotados, bajos y en minimo tienen texto de estado visible;
- los productos sin costo se informan por separado y no aparecen como costo cero conocido;
- no aparecen controles utilizables de compras sugeridas, rotacion, productos sin movimiento ni exportacion avanzada.

Con una tienda de plan avanzado, confirme:

- se muestran compras sugeridas, rotacion, dias restantes y productos sin movimiento;
- una sugerencia explica su confianza y no modifica stock ni registra una compra;
- la configuracion general valida sus rangos y guarda los cambios;
- la configuracion de un producto permite volver a los valores automaticos dejando campos vacios;
- **Exportar inventario** descarga un archivo XLSX limitado a la tienda y filtros actuales.

Con una suscripcion en modo de solo lectura, confirme:

- los reportes y analisis continúan disponibles;
- los botones para guardar configuracion general o por producto quedan deshabilitados u ocultos;
- el backend rechaza cualquier intento de escritura aunque se manipule la interfaz.

Revise tambien la vista en computadora, tableta y telefono: las pestañas deben desplazarse horizontalmente cuando no caben, las tablas deben conservar scroll propio y los formularios deben apilarse sin superponer textos o botones.

### Validacion manual de lotes y vencimientos

Con `011` aplicada, inicie el servidor local y abra **Lotes y vencimientos**. La pantalla obtiene siempre la tienda desde la sesion; ningun filtro o formulario envia `idTienda`.

Compruebe con un plan avanzado:

- el resumen separa stock fisico, vendible, no vendible, vencido, bloqueado, aislado y tecnico;
- los filtros por producto, proveedor, codigo, estado y vencimiento pueden aplicarse y limpiarse;
- **Exportar XLSX** genera las hojas Lotes y Resumen, y agrega Alertas cuando existen resultados relevantes;
- el detalle muestra compra, responsable, movimientos y ventas relacionadas sin claves internas;
- un producto con stock cero puede activar lotes directamente;
- un producto con stock existente exige distribuir exactamente todo su saldo antes de activar lotes;
- una compra normal no muestra controles de lotes, mientras una compra controlada exige distribuir sus unidades base;
- los ajustes positivos crean nuevos lotes y los negativos explican la salida automatica FEFO/FIFO;
- el POS muestra stock vendible y no pide seleccionar lotes manualmente;
- el historial de venta muestra los lotes utilizados cuando existe trazabilidad.

Compruebe tambien:

- una suscripcion en solo lectura permite consultas, pero no activacion, distribucion ni ajustes;
- una tienda degradada conserva acceso de lectura a productos que ya controlaban lotes, aunque no pueda activar otros nuevos;
- en movil los lotes aparecen como tarjetas apiladas y los formularios no requieren desplazamiento horizontal;
- los costos desconocidos se muestran como desconocidos, no como cero;
- las fechas de vencimiento conservan el dia local y no se desplazan por UTC.

### Stock vendible, conciliacion y ajustes manuales

La migracion `019_stock_vendible_ajustes.sql` clasifica cada lote como
`vendible`, `bloqueado`, `aislado` o `tecnico`. Solo un lote disponible,
clasificado como vendible y no vencido aporta stock vendible. El stock fisico
incluye ademas mercaderia vencida o no disponible para venta.

`GET /api/inventario/conciliacion` compara, sin escribir, el saldo del producto,
el historial de movimientos y los lotes. `GET /api/inventario/ajustes` lista el
historial y `POST /api/inventario/ajustes` registra el ajuste transaccional. Las
tres rutas toman la tienda de la sesion; la escritura exige suscripcion activa,
funcionalidad `ajuste_stock`, CSRF, confirmacion y clave idempotente.

```powershell
$env:APP_ENV = "local"
npm.cmd run db:check-inventory-adjustments
npm.cmd run test:inventory-adjustments
npm.cmd run test:inventory-adjustments-frontend
npm.cmd run test:inventory-adjustments-browser
```

El comprobador nunca corrige diferencias. Para productos sin control de lotes,
todo el saldo fisico se considera vendible: registrar existencia no vendible
requiere activar el modelo trazable por lotes. La migracion `019` debe ensayarse
en una base temporal y no aplicarse a la base principal sin autorizacion
explicita.
