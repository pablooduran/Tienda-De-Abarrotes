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

El entorno local se activa desde la terminal antes de ejecutar un comando:

```powershell
$env:APP_ENV='local'
```

Con `APP_ENV=local`, la aplicacion carga solamente `.env.local`; en cualquier otro caso conserva el uso de `.env`. Los comandos locales muestran el host, puerto y base seleccionados, sin mostrar usuario, contrasena ni secretos.

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

`database/tienda_abarrotes.sql` representa una instalacion nueva con el estado final post-013.
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

```bash
npm start
```

Abra `http://localhost:3000`. Para desarrollo con recarga automatica puede usar `npm run dev`.

## Respaldo antes de migrar

Use una base local o una copia de prueba. Ejemplo general:

```bash
mysqldump -u usuario -p nombre_base > backup_antes_de_migrar.sql
```

No ejecute `db:init`, `db:migrate`, `db:create-admin` ni `db:seed-demo` contra produccion sin revisar la configuracion, tener un respaldo y probar previamente sobre una copia.

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
- Los ajustes manuales usan el nuevo stock contado, calculan la diferencia en el backend y exigen la contrasena actual del propietario autenticado.
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

La prueba cubre perfiles ampliados, documentos normalizados, limites individuales y de tienda, politicas de deuda vencida, fechas prometidas, cobros especificos y acumulados, deuda oculta, idempotencia, concurrencia, estado de cuenta, alertas, seguimientos y mensajes preparados para WhatsApp. Tambien confirma aislamiento entre tiendas, permisos por plan, continuidad de cobros tras un downgrade y que ningun pago modifica stock, lotes o movimientos de inventario. Usa solamente tiendas y credenciales temporales en una base local cuyo nombre contenga `prueba` o `test`, y elimina todos los datos que crea.

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

### Validacion del frontend de clientes y cobranza

La interfaz conserva **Clientes** y presenta las deudas bajo **Cobranza**. La prueba estatica no inicia el servidor ni usa la base de datos:

```powershell
npm.cmd run test:customers-credit-frontend
```

Con un plan basico, confirme que se pueden consultar clientes, deuda y estado de cuenta, y registrar pagos de deuda existente. Los limites personalizados, alertas, seguimientos y recordatorios deben aparecer bloqueados o ausentes segun sus funciones.

Con un plan avanzado, confirme el alta y edicion ampliada, configuracion de credito, alertas, promesas, seguimientos y preparacion de WhatsApp. Abrir WhatsApp no debe registrar un envio; **Marcar como enviado manualmente** es una accion separada.

En el POS, seleccione un cliente y verifique deuda, limite, credito disponible y fecha de vencimiento. El cliente ocasional solo puede pagar al contado. Una politica de advertencia debe exigir confirmacion y motivo; una politica de bloqueo debe permitir cambiar la venta a contado.

Para pagos especificos y acumulados, pruebe efectivo, cambio, otros metodos y un reintento de red. La clave de operacion debe mantenerse durante el mismo intento y renovarse al abrir otro pago. En modo de solo lectura por downgrade, la consulta permanece disponible y el cobro de deuda existente sigue el permiso operativo del backend.

Revise la interfaz a 360, 768 y 1366 px. En movil, clientes y cuentas se muestran como tarjetas sin desplazamiento horizontal obligatorio. El estado de cuenta se imprime desde el navegador con estilos A4; no se genera PDF ni XLSX.

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

- el resumen separa stock trazado, vendible, vencido y bloqueado;
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
