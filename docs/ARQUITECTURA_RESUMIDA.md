# Arquitectura resumida

Mapa operativo del sistema actual. Para reglas de trabajo consultar
[AGENTS.md](../AGENTS.md), [REGLAS_CODEX.md](REGLAS_CODEX.md) y el alcance de
pruebas en [MAPA_PRUEBAS.md](MAPA_PRUEBAS.md).

## Base tecnica y entrada

- **Runtime:** Node.js 18+ con CommonJS, Express 4 y MySQL mediante `mysql2`.
- **Sesion:** `express-session` respaldado por MySQL; autenticacion de
  administradores en [routes/auth.js](../routes/auth.js).
- **Frontend:** HTML, CSS y JavaScript del navegador en
  [public/](../public/); no hay framework de interfaz.
- **Exportaciones:** ExcelJS y servicios especificos de dominio.
- **Pruebas browser:** `playwright-core` con el arnes local del proyecto.
- **Entrada:** [server.js](../server.js). La lista exacta de scripts vive en
  [package.json](../package.json).

## Orden general de middleware

1. Carga y validacion fatal de configuracion al arrancar.
2. `requestContext`, cabeceras de seguridad, politica de permisos y no-cache.
3. `GET|HEAD /health/*` con su limitador propio, antes de parser, sesion y CSRF.
4. Parsers de formulario y JSON; sesion MySQL; auditoria comercial de `/api`.
5. Proteccion de mutaciones por origen y `X-Requested-With`.
6. Rate limits por auth, exportacion, WhatsApp, administracion y API.
7. Rutas publicas de autenticacion y rutas administrativas de superadmin.
8. Rutas de dueno de tienda: auth, tenant, suscripcion resuelta y escritura
   bloqueada si la suscripcion esta en solo lectura.
9. Archivos publicos, `notFoundHandler` y manejador seguro de errores.

El flujo normal es: requestId -> cabeceras -> sesion -> autorizacion de ruta ->
servicio -> consulta o transaccion parametrizada -> respuesta sanitizada. Las
escrituras criticas agregan CSRF, permisos, bloqueos, idempotencia y auditoria
segun el contrato del dominio.

## Capas y responsabilidades

- **Rutas:** validan la forma HTTP, montan guards y delegan el dominio.
- **Servicios:** reglas comerciales, transacciones, consultas, exportaciones y
  contratos de respuesta. No trasladar reglas financieras al frontend.
- **Middleware:** autenticacion, tenant, rol, suscripcion, cabeceras, CSRF,
  rate limiting, contexto y auditoria transversal.
- **Datos:** [config/db.js](../config/db.js), migraciones en
  [database/migrations/](../database/migrations/) y esquema inicial en
  [database/tienda_abarrotes.sql](../database/tienda_abarrotes.sql).
- **Scripts:** comprobadores, arneses y operaciones locales en
  [scripts/](../scripts/). Elegirlos desde [MAPA_PRUEBAS.md](MAPA_PRUEBAS.md).

## Mapa por dominio

| Modulo | Entradas | Servicio principal | Rutas | Pruebas relacionadas | Dependencias criticas |
| --- | --- | --- | --- | --- | --- |
| Autenticacion | [server.js](../server.js), [middleware/auth.js](../middleware/auth.js) | [services/session-validation-service.js](../services/session-validation-service.js) | [routes/auth.js](../routes/auth.js) | `test:session-revocation`, `test:local-startup`, `db:check-session-security` | sesion MySQL, bcrypt, request context |
| Administracion | [public/admin.html](../public/admin.html) | [services/administrative-audit-service.js](../services/administrative-audit-service.js) | [routes/admin.js](../routes/admin.js), [routes/admin-catalog.js](../routes/admin-catalog.js) | `test:admin-management`, auditoria | rol `superadmin`, rate limiter admin |
| Tiendas | [routes/admin.js](../routes/admin.js) | [services/subscription-service.js](../services/subscription-service.js) | rutas administrativas de tiendas | `test:admin-management`, `db:check-multitenant` | administrador, tienda y auditoria |
| Suscripciones | [middleware/subscription.js](../middleware/subscription.js) | [services/subscription-service.js](../services/subscription-service.js) | [routes/admin.js](../routes/admin.js) y rutas comerciales | `test:subscriptions`, `db:check-subscriptions` | tenant, plan y funcionalidad |
| Productos | [public/js/app.js](../public/js/app.js) | [services/master-catalog-service.js](../services/master-catalog-service.js) | [routes/api.js](../routes/api.js), [routes/master-catalog.js](../routes/master-catalog.js) | `test:master-catalog`, stock | catalogo, stock y permisos |
| Ventas | [public/js/app.js](../public/js/app.js) | [services/pos-sale-service.js](../services/pos-sale-service.js) | [routes/pos.js](../routes/pos.js) | `test:pos-payments`, `db:check-pos-payments` | producto, lote, pago y transaccion |
| Compensaciones | contratos y UI de compensaciones | [services/sale-compensation-service.js](../services/sale-compensation-service.js), [services/financial-compensation-service.js](../services/financial-compensation-service.js) | [routes/sales-compensations.js](../routes/sales-compensations.js), [routes/financial-compensations.js](../routes/financial-compensations.js) | `test:compensation-*`, `test:sales-compensations`, `test:financial-compensations` | migraciones 014-017, idempotencia, inventario |
| Stock | UI de productos y movimientos | [services/stock-movement-service.js](../services/stock-movement-service.js) | [routes/stock.js](../routes/stock.js) | `test:stock-movements`, `db:check-stock-movements` | producto, movimiento y tenant |
| Lotes | UI de lotes | [services/lot-service.js](../services/lot-service.js) | [routes/lots.js](../routes/lots.js) | `test:lots-expiration`, `db:check-lots-expiration` | FEFO/FIFO, vencimiento y stock |
| Ajustes | [public/js/inventory-adjustment-ui.js](../public/js/inventory-adjustment-ui.js) | [services/inventory-adjustment-service.js](../services/inventory-adjustment-service.js), [services/inventory-reconciliation-service.js](../services/inventory-reconciliation-service.js) | [routes/inventory-adjustments.js](../routes/inventory-adjustments.js) | `test:inventory-adjustments*`, `db:check-inventory-adjustments` | auditoria, bloqueos y lotes |
| Inteligencia | [public/js/app.js](../public/js/app.js) | [services/inventory-intelligence-service.js](../services/inventory-intelligence-service.js) | [routes/inventory-intelligence.js](../routes/inventory-intelligence.js) | `test:inventory-intelligence*`, `db:check-inventory-intelligence` | ventas netas, stock vendible, exportacion |
| Auditoria | [public/js/administrative-audit-ui.js](../public/js/administrative-audit-ui.js) | [services/administrative-audit-service.js](../services/administrative-audit-service.js), [services/administrative-audit-query-service.js](../services/administrative-audit-query-service.js) | [routes/audit.js](../routes/audit.js) | `test:administrative-audit*`, `db:check-administrative-audit` | append-only, allowlists y roles |
| Exportaciones | UI de cada dominio | servicios `*-export-service.js` | rutas del dominio y limitador export | pruebas del dominio, browser si descarga | ExcelJS, filtros, limite y neutralizacion |
| Operacion y health | [server.js](../server.js) | [services/operational-health-service.js](../services/operational-health-service.js), [services/backup-status-service.js](../services/backup-status-service.js) | [routes/health.js](../routes/health.js), [routes/admin-health.js](../routes/admin-health.js) | `test:operational-*`, `check:operational-health` | pool MySQL, migraciones, backup read-only |

## Frontend y pruebas

`app.html` sirve al dueno de tienda y `admin.html` al superadmin. Los modulos
de `public/js/` consumen API autenticada con cookies y no transportan el tenant
como parametro de autoridad. Para cambios visuales, usar primero las pruebas
estaticas del dominio y despues su arnes browser solo cuando el alcance lo
requiera. La matriz exacta, fixtures y limpieza estan en
[MAPA_PRUEBAS.md](MAPA_PRUEBAS.md).
