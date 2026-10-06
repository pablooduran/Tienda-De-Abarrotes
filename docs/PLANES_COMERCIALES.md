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
- Catalogo guiado, compras, stock, historial y ajustes protegidos.
- Resumen y alertas de inventario.
- Clientes, fiados, cobros y estados de cuenta.
- Gastos y resumen financiero del inicio.
- Comprobantes para compartir por WhatsApp.
- Anulaciones y devoluciones protegidas.

### Standard — controlar y decidir

Incluye Basic y agrega:

- Reportes financieros y cierre de caja.
- Ranking, valoracion, rotacion y cobertura del inventario.
- Productos sin movimiento y compras sugeridas.
- Limites de credito, segmentacion y seguimiento de cobranza.
- Plantillas y mensajes preparados para cobrar fiados.

### Pro — escalar y auditar

Incluye Standard y agrega:

- Capacidad ilimitada.
- Rentabilidad detallada por producto.
- Exportaciones de reportes, inventario, clientes y fiados.
- Control, trazabilidad, alertas y exportacion de lotes y vencimientos.

## Fuera de la oferta

`portal_clientes` y `reportes_avanzados` no se ofrecen porque no representan
una capacidad publica completa e independiente. Toda funcionalidad nueva queda
bloqueada por defecto hasta asignarla explicitamente a uno o mas planes.

## Aplicacion de cambios

La migracion 027 actualiza el catalogo para nuevas altas y nuevos periodos. No
reescribe snapshots de suscripciones vigentes ni elimina datos cuando una
tienda supera un limite; conserva lectura y bloquea nuevas altas segun el
contrato de suscripcion.
