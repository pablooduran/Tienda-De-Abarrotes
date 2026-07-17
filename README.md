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

Antes y despues de aplicar la migracion multi-tienda sobre una base local, puede obtener una comprobacion de solo lectura:

```powershell
$env:APP_ENV='local'
npm.cmd run db:check-multitenant
```

La salida informa conteos, registros sin `idTienda`, ventas, compras, fiados, stock y pagos. Tambien declara `pre-migracion`, `post-migracion` o `estructura-incompleta-o-migracion-parcial` sin asumir que `tienda` o `idTienda` ya existen. Compare las sumas antes y despues: deben mantenerse iguales y, despues de `004`, los registros existentes deben mostrar cero filas sin tienda.

La migracion `004` es reintentable. Antes de cada `ADD COLUMN`, `ADD INDEX` o `ADD CONSTRAINT`, `db:migrate` consulta `INFORMATION_SCHEMA` y omite solamente el elemento que ya existe. Si una ejecucion se interrumpe, no se registra como aplicada hasta completar y verificar toda la estructura.

### Crear el primer administrador

Defina temporalmente `ADMIN_USER` y `ADMIN_PASSWORD` en su entorno local. La contrasena debe tener al menos 12 caracteres. Luego ejecute:

```bash
npm run db:create-admin
```

El script solo crea el administrador si el usuario no existe. Nunca reemplaza una contrasena existente y no imprime contrasenas ni hashes. El servidor no crea ni restablece administradores al arrancar.

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
- Los productos y proveedores todavia no tienen columnas de borrado logico. Su eliminacion fisica debe reemplazarse en una migracion futura antes de la conversion multi-tienda.

## Preparacion multi-tienda

La migracion `004` prepara la estructura y asocia los datos existentes a "Tienda Deisy". Las columnas `idTienda` permanecen temporalmente anulables para no romper el backend actual. Hasta adaptar el backend en la fase siguiente, evite crear ventas, compras, productos, clientes, proveedores, fiados o pagos nuevos despues de aplicar `004`, porque esas escrituras aun no envian la tienda. El aislamiento en autenticacion, consultas, transacciones y reportes corresponde a la fase siguiente; planes y catalogo maestro aun no estan implementados.
