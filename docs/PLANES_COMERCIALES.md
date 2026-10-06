# Planes comerciales

## Principio

Los planes se diferencian por capacidad y herramientas de gestion. La
seguridad, el aislamiento por tienda, la auditoria interna, la idempotencia,
los ajustes protegidos, las anulaciones y la preservacion de historicos no se
venden como extras.

La prueba gratuita dura 30 dias y usa las condiciones de Basic. Basic no es un
plan gratuito: su precio comercial es USD 3 al mes.

## Matriz vigente propuesta

| Plan | Precio mensual | Propietarios | Productos | Clientes | Proveedores |
| --- | ---: | ---: | ---: | ---: | ---: |
| Basic | USD 3 | 1 | 300 | 15 | 15 |
| Standard | USD 6 | 3 | 1.000 | 30 | 30 |
| Pro | USD 10 | Ilimitado | Ilimitado | Ilimitado | Ilimitado |

### Basic — operar

- Punto de venta, efectivo, QR y pagos combinados.
- Catalogo guiado, compras, stock e historial de movimientos.
- Clientes, fiados, cobros y estados de cuenta.
- Resumen operativo del inicio.

### Standard — controlar y decidir

Incluye Basic y agrega:

- Gastos, comprobantes de venta y mensajes de cobranza por WhatsApp.
- Devoluciones, anulaciones y conciliacion protegida de inventario.
- Reportes de ganancias, historial de pagos, productos mas vendidos y bajo stock.
- Resumen, alertas, ranking y valoracion del inventario.
- Limites de credito, segmentacion y seguimiento de cobranza.

### Pro — escalar y auditar

Incluye Standard y agrega:

- Capacidad ilimitada.
- Cierre de caja y rentabilidad detallada por producto.
- Compras sugeridas, rotacion, cobertura y productos sin movimiento.
- Exportaciones de reportes, inventario, clientes y fiados.
- Control, trazabilidad, alertas y exportacion de lotes y vencimientos.

## Fuera de la oferta

`portal_clientes` y `reportes_avanzados` no se ofrecen porque no representan
una capacidad publica completa e independiente. Toda funcionalidad nueva queda
bloqueada por defecto hasta asignarla explicitamente a uno o mas planes.

## Aplicacion de cambios

Las migraciones 027 y 028 actualizan el catalogo para nuevas altas y nuevos periodos. No
reescribe snapshots de suscripciones vigentes ni elimina datos cuando una
tienda supera un limite; conserva lectura y bloquea nuevas altas segun el
contrato de suscripcion.
