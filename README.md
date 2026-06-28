# Sistema web para tienda de abarrotes familiar

Sistema con Node.js, Express, MySQL y frontend en HTML, CSS y JavaScript puro. Permite administrar productos, clientes, proveedores, compras, ventas pagadas, ventas fiadas, pagos parciales, historiales y reportes.

## Estructura

- `server.js`: inicio del servidor Express, sesiones y rutas principales.
- `config/db.js`: conexion a MySQL usando variables de entorno.
- `middleware/auth.js`: valida que el administrador haya iniciado sesion.
- `routes/auth.js`: login, estado de sesion y cierre de sesion.
- `routes/api.js`: API de productos, clientes, proveedores, ventas, compras, fiados, pagos y reportes.
- `public/`: interfaz web.
- `database/tienda_abarrotes.sql`: instalacion completa de la base de datos.
- `database/migrations/001_mejoras_tienda.sql`: migracion segura para bases existentes.
- `database/migrations/002_mejoras_stock_reportes.sql`: stock avanzado, ganancias, filtros y graficos.
- `.env.example`: ejemplo de configuracion.

## Requisitos

- Node.js 18 o superior.
- MySQL 5.7/8.0 o MariaDB compatible.

## Instalacion

1. Instalar dependencias:

```bash
npm install
```

2. Crear `.env` desde `.env.example` y configurar MySQL:

```env
DB_HOST=localhost
DB_USER=usuario_mysql
DB_PASSWORD=clave_mysql
DB_NAME=tienda_abarrotes
DB_PORT=3306
SESSION_SECRET=una_clave_larga_y_segura
PORT=3000
```

## Base de datos nueva

Importar el archivo completo:

```bash
mysql -u usuario_mysql -p < database/tienda_abarrotes.sql
```

## Actualizar una base existente

Antes de modificar la base, haga un respaldo:

```bash
mysqldump -u usuario_mysql -p tienda_abarrotes > backup_tienda_abarrotes_antes_mejoras.sql
```

Si usa phpMyAdmin, entre a la base, use **Exportar**, seleccione formato SQL y guarde el archivo.

Luego ejecute las migraciones en orden:

```bash
mysql -u usuario_mysql -p tienda_abarrotes < database/migrations/001_mejoras_tienda.sql
mysql -u usuario_mysql -p tienda_abarrotes < database/migrations/002_mejoras_stock_reportes.sql
```

La migracion conserva `detalleFiado` para consultar fiados antiguos. Los nuevos fiados se crean desde una venta fiada y se relacionan con `venta`.

## Inicializar base en Render/Aiven

Si la base esta vacia o faltan tablas como `administrador`, configure las variables `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` y `DB_PORT`, y ejecute:

```bash
npm run db:init
```

El script crea tablas con `CREATE TABLE IF NOT EXISTS`, aplica migraciones disponibles, crea el administrador inicial si no existe y no borra datos existentes. Para Aiven, el script intenta usar SSL automaticamente cuando el host termina en `aivencloud.com`. Tambien puede forzarlo con:

```env
DB_SSL=true
```

Usuario inicial por defecto:

- Usuario: `admin`
- Contrasena: `admin123`

Puede cambiar esos valores antes de ejecutar el inicializador usando:

```env
ADMIN_USER=admin
ADMIN_PASSWORD=una_clave_temporal_segura
```

## Administrador inicial

- Usuario: `admin`
- Contrasena: `admin123`

El servidor verifica este usuario al iniciar y lo crea o corrige si hace falta.

## Ejecutar

Desarrollo:

```bash
npm run dev
```

Produccion o prueba simple:

```bash
npm start
```

Abrir:

```text
http://localhost:3000
```

## Cambios principales

- Productos con proveedor, categoria y unidades por paquete.
- Productos con paquetes por caja, unidades por paquete y venta configurable por paquete o unidad.
- Stock y stock minimo como enteros.
- Para kilo y litro se usa unidad minima:
  - kilo se controla como gramos.
  - litro se controla como mililitros.
  - unidad, paquete, caja y bolsa se controlan como unidades.
- Compra por caja: el stock aumenta por `cantidad * paquetesPorCaja * unidadesPorPaquete`.
- Compra por paquete: el stock aumenta por `cantidad * unidadesPorPaquete`.
- Compra por unidad: el stock aumenta por `cantidad`.
- Venta por paquete: descuenta `cantidad * unidadesPorPaquete`.
- Venta por unidad: descuenta `cantidad`.
- La caja nunca aparece como opcion de venta.
- Venta pagada o fiada desde el mismo modulo de ventas.
- Venta fiada exige cliente registrado y crea la deuda asociada.
- Modulo **Fiados / Pagos** para pendientes, parciales, pagados, pagos parciales e historial.
- Historial completo de ventas con detalle de productos.
- Reportes de ventas, compras, bajo stock, mas vendidos, fiados y pagos.
- Reporte de ganancias con total vendido, costo y ganancia neta.
- Dashboard con graficos simples sin depender de internet.
- Buscador dinamico de productos en ventas y compras.
- Productos con modal de alta/edicion, filtros y orden por precio.
- Validacion de telefonos numericos en clientes y proveedores.
- Textos de registros guardados en mayusculas.
- Modales propios para confirmaciones, errores y mensajes de exito.

## Reglas de uso

- Una compra aumenta stock.
- Una venta disminuye stock.
- No se puede vender mas que el stock disponible.
- El stock real para calculos es `stockUnidadesTotal`; `stock` se mantiene sincronizado por compatibilidad.
- Una venta pagada puede registrarse sin cliente.
- Una venta fiada siempre requiere cliente.
- Un pago parcial no puede superar el saldo pendiente.
- Los fiados pagados no desaparecen; quedan en historial con estado `pagado`.
- Producto bajo stock significa `stockUnidadesTotal < stockMinimo`.
- La ganancia historica se guarda en `detalleVenta` usando el costo unitario del momento de la venta.
