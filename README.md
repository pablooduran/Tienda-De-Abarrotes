# Sistema web para tienda de abarrotes familiar

Sistema funcional con Node.js, Express, MySQL y frontend en HTML, CSS y JavaScript puro. Permite administrar productos, clientes, proveedores, ventas, compras, fiado, pagos parciales y reportes basicos.

## Estructura

- `server.js`: inicio del servidor Express, sesiones y proteccion basica.
- `config/db.js`: conexion a MySQL usando variables de entorno.
- `middleware/auth.js`: valida que el administrador haya iniciado sesion.
- `routes/auth.js`: login, estado de sesion y cierre de sesion.
- `routes/api.js`: API de productos, clientes, proveedores, operaciones y reportes.
- `public/`: archivos estaticos del frontend.
- `database/tienda_abarrotes.sql`: script completo de base de datos.
- `.env.example`: ejemplo de configuracion para servidor o hosting.

## Requisitos

- Node.js 18 o superior.
- MySQL 5.7/8.0 o MariaDB compatible.
- Un hosting, VPS o cPanel compatible con aplicaciones Node.js.

## Instalacion

1. Instalar dependencias:

```bash
npm install
```

2. Crear el archivo `.env` copiando `.env.example`:

```bash
cp .env.example .env
```

3. Configurar los datos reales de MySQL:

```env
DB_HOST=localhost
DB_USER=usuario_mysql
DB_PASSWORD=clave_mysql
DB_NAME=tienda_abarrotes
DB_PORT=3306
SESSION_SECRET=una_clave_larga_y_segura
PORT=3000
```

No escriba credenciales directamente dentro del codigo.

## Base de datos

Importar el archivo:

```bash
mysql -u usuario_mysql -p < database/tienda_abarrotes.sql
```

Tambien puede importarlo desde phpMyAdmin creando primero la base `tienda_abarrotes` o ejecutando el archivo completo.

Administrador inicial:

- Usuario: `admin`
- Contraseña: `admin123`

La contraseña se guarda con bcrypt. Al iniciar, el servidor tambien verifica que exista el administrador inicial y lo crea o corrige si hace falta.

## Ejecutar en desarrollo

```bash
npm run dev
```

Abrir:

```text
http://localhost:3000
```

## Ejecutar en produccion

```bash
npm start
```

En produccion configure `NODE_ENV=production`, use un `SESSION_SECRET` fuerte y active HTTPS desde el dominio o proxy del hosting.

## Despliegue en dominio, VPS o cPanel

1. Subir todos los archivos del proyecto al servidor.
2. Crear la base MySQL e importar `database/tienda_abarrotes.sql`.
3. Crear `.env` con los datos de la base del hosting.
4. Instalar dependencias con `npm install`.
5. Configurar la aplicacion Node.js para ejecutar `npm start` o `node server.js`.
6. Apuntar el dominio al puerto configurado por el hosting o usar el proxy que provea cPanel/Apache/Nginx.
7. Verificar que el dominio use HTTPS para proteger la sesion.

## Funciones incluidas

- Login de administrador con sesiones.
- CRUD de productos con unidad de medida, stock decimal y stock minimo por producto.
- Alertas visuales para productos con `stock < stockMinimo`.
- CRUD de clientes y proveedores.
- Registro de compras con aumento de stock.
- Registro de ventas con descuento de stock y validacion de existencia suficiente.
- Registro de fiados asociados obligatoriamente a clientes.
- Pagos parciales de fiado sin permitir pagar mas que el saldo.
- Reportes de ventas, compras, bajo stock, productos mas vendidos, fiados y pagos.

## Notas de uso

Las cantidades aceptan decimales para productos por kilo, litro o gramo. Una venta puede registrarse sin cliente; un fiado siempre exige cliente. Las eliminaciones de clientes, proveedores o productos se bloquean automaticamente si existen registros asociados.
