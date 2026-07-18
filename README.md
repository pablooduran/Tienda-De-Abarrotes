# Sistema web para tienda de abarrotes

Sistema con Node.js, Express, MySQL y frontend en HTML, CSS y JavaScript. Administra productos, clientes, proveedores, compras, ventas pagadas o fiadas, pagos parciales, stock, historiales, dashboard y reportes.

## Estructura principal

- `server.js`: servidor Express, sesiones y rutas principales.
- `config/`: validacion de configuracion y conexion MySQL.
- `middleware/`: proteccion de rutas autenticadas.
- `routes/`: autenticacion y API del negocio.
- `public/`: interfaz web.
- `scripts/`: inicializacion, migraciones y cargas opcionales.
- `database/tienda_abarrotes.sql`: estructura completa para una base nueva.
- `database/migrations/`: cambios incrementales para bases existentes.

## Requisitos

- Node.js 18 o superior.
- MySQL 5.7/8.0 o MariaDB compatible.
- Una base local o de prueba para validar cambios antes de produccion.

## Configuracion local

1. Instale dependencias:

```bash
npm install
```

2. Cree su configuracion local tomando `.env.example` como referencia. Use valores propios y no publique ese archivo.

Variables obligatorias para iniciar la aplicacion:

- `DB_HOST`
- `DB_USER`
- `DB_PASSWORD`
- `DB_NAME`
- `DB_PORT`
- `SESSION_SECRET`

`SESSION_SECRET` debe tener al menos 32 caracteres. `DB_SSL=true` habilita SSL y los hosts de Aiven tambien se detectan automaticamente. La aplicacion se detiene con un mensaje claro si falta una variable obligatoria y nunca imprime contrasenas ni hashes.

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
- Los productos y proveedores todavia requieren una futura revision integral de borrado logico; esta fase no cambia su flujo historico de eliminacion.

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
