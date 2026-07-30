# Mapa de pruebas

Este mapa orienta la seleccion proporcional de validaciones. Los nombres de
comandos son los expuestos actualmente por `package.json`; confirmar el script
antes de usarlo. No sustituye la revision del contrato, ruta y servicio
afectados.

## Niveles y limpieza

- **Nivel 1 (rapido):** `node --check` de JavaScript tocado, `git diff --check`
  y comprobadores o pruebas directas del modulo.
- **Nivel 2 (relacionado):** regresion del modulo, `db:check-multitenant` si
  cambia acceso a datos y `check:web-security` o `test:web-security` si cambia
  ruta, middleware o frontend.
- **Nivel 3 (cierre):** solo al cerrar una macrofase o cuando el cambio toca
  contratos transversales: browser, responsive, accesibilidad, health y, si
  corresponde, backup/restore autorizado.

Los arneses con fixtures, bases temporales, servidores o navegador deben usar
timeout y limpieza en `finally`. No finalizar procesos Node, Edge ni otros
procesos que no sean atribuibles al arnes de la ejecucion actual. No ejecutar
migraciones, backups o restauraciones como parte de una prueba ordinaria sin
autorizacion expresa.

| Modulo o cambio | Archivos relacionados | Nivel 1 | Nivel 2 | Nivel 3 o cierre | Fixtures / temporal / servidor | Limpieza y detencion |
| --- | --- | --- | --- | --- | --- | --- |
| Autenticacion, sesiones, registro publico, verificacion y recuperacion | `routes/auth.js`, `middleware/`, contratos y servicios de sesion, registro, verificacion y recuperacion | `node --check`; `npm.cmd run test:public-registration`; `npm.cmd run test:email-verification`; `npm.cmd run test:password-recovery` | `npm.cmd run test:session-revocation`; `npm.cmd run db:check-session-security`; `npm.cmd run test:timezone-tls`; tenant y suscripciones si cambia alta | `npm.cmd run test:saas-a-e2e`; `npm.cmd run test:web-security`; `npm.cmd run test:operational-health` | SAAS-A1/A2/A3 usan bases temporales propias; el cierre E2E usa base temporal, Express y Edge locales | Cerrar solo temporales, servidor y browser propios; detener ante secreto, sesion cruzada, token persistido en claro, reset que reactive cuentas o alta parcial |
| Configuracion base de tienda | `database/migrations/021_configuracion_base_tienda.sql`, `services/store-bootstrap-service.js`, esquema inicial | `node --check`; `npm.cmd run test:store-configuration`; `npm.cmd run db:check-store-configuration` | `npm.cmd run test:public-registration`; `npm.cmd run test:tenant-isolation`; `npm.cmd run db:check-multitenant` | Regresion de registro, verificacion, recuperacion, suscripciones y sesiones al aplicar 021 | `test:store-configuration` crea una base temporal; no inicia navegador | Eliminar solo la base temporal propia; detener ante tienda sin configuracion, duplicado, cambio comercial o cruce tenant |
| Onboarding inicial | `routes/onboarding.js`, `services/onboarding-service.js`, contrato, pantalla y estilos de onboarding | `node --check`; `npm.cmd run test:onboarding` | `npm.cmd run test:onboarding-browser`; tenant, suscripciones, sesiones y auditoria | `npm.cmd run check:web-security`; `npm.cmd run test:web-security` y regresion de acceso publico | `test:onboarding` crea una base temporal; el browser usa HTTP y Edge locales efimeros | Cerrar solo temporal, servidor y browser propios; detener ante tenant cruzado, dato comercial creado o proceso residual |
| Multitienda y suscripciones | rutas y servicios con `idTienda`; `middleware/`; `config/` | comprobador directo del modulo | `npm.cmd run test:tenant-isolation`; `npm.cmd run db:check-multitenant`; `npm.cmd run test:subscriptions`; `npm.cmd run db:check-subscriptions` | Regresion de modulos afectados | Fixtures y, en varias suites, bases temporales | Confirmar cero tenants temporales y detener ante mezcla de datos |
| Ciclo de vida de suscripciones | `database/migrations/022_ciclo_vida_suscripciones.sql`, `config/subscription-lifecycle-contract.js`, `services/subscription-service.js` | `node --check`; `npm.cmd run test:subscription-lifecycle-schema`; `npm.cmd run db:check-subscription-lifecycle` | `npm.cmd run test:subscriptions`; `npm.cmd run db:check-subscriptions`; registro publico, tenant y sesiones | Regresion SAAS-A y seguridad web al aplicar 022 | La prueba de esquema crea una base temporal post-021 y no inicia navegador | Eliminar la base temporal en `finally`; detener ante snapshot faltante, historial inventado, solapamiento operativo o cambio en la huella principal |
| Productos y catalogo | rutas/servicios de producto, `public/`, migraciones relacionadas | `node --check`; `npm.cmd run db:check-master-catalog` | `npm.cmd run test:master-catalog`; multitienda si cambia consulta | Browser solo si se altera su pantalla | Fixtures segun prueba; no base temporal declarada por el comprobador | Eliminar fixtures propios; detener ante stock o tenant inconsistente |
| Ventas y POS | rutas/servicios de ventas, pagos, `public/` | `node --check`; `npm.cmd run db:check-pos-payments` | `npm.cmd run test:pos-payments`; `npm.cmd run db:check-multitenant` | Browser del flujo afectado y regresion de compensaciones si aplica | Fixtures; algunos flujos requieren servidor | No tocar ventas preexistentes; cerrar servidor propio |
| Compensaciones | `routes/*compensations*`, `services/*compensation*`, `config/compensation-contract.js` | `npm.cmd run test:compensation-foundation`; comprobador especifico | `npm.cmd run test:sales-compensations`; `npm.cmd run test:financial-compensations`; `npm.cmd run test:compensation-integration`; `npm.cmd run db:check-compensations`; `npm.cmd run db:check-sales-compensations`; `npm.cmd run db:check-financial-compensations`; `npm.cmd run db:check-compensation-integration` | `npm.cmd run test:compensation-interface`; `npm.cmd run test:compensation-frontend`; `npm.cmd run test:compensation-browser` | Bases temporales y browser en las suites correspondientes | Verificar rollback, cero DELETE y temporales; detener ante saldo negativo |
| Stock y movimientos | servicios/rutas de stock; `movimientoStock`; pruebas de stock | `npm.cmd run db:check-stock-movements` | `npm.cmd run test:stock-movements`; `npm.cmd run db:check-multitenant` | Regresion de lotes y ajustes si cambia conciliacion | Fixtures y servidor propio segun arnes | No cerrar Node ajeno; limpiar fixtures `tienda-stock-*` solo si el arnes los creo |
| Lotes y vencimientos | `services/lot-service.js`, rutas y migraciones de lotes | `npm.cmd run db:check-lots-expiration` | `npm.cmd run test:lots-expiration`; stock y multitenant relacionados | Ajustes e inteligencia si cambia stock vendible | Fixtures y posible servidor | Detener ante cantidades negativas o lotes cruzados |
| Ajustes de inventario | `routes/inventory-adjustments.js`, `services/inventory-*`, UI de ajustes | `npm.cmd run test:inventory-adjustments`; `npm.cmd run db:check-inventory-adjustments` | `npm.cmd run test:inventory-adjustments-frontend`; stock, lotes y multitenant | `npm.cmd run test:inventory-adjustments-browser` | La prueba de ajustes usa temporal y browser solo en su arnes | Verificar limpieza de base temporal y procesos atribuidos |
| Inteligencia de inventario | `routes/inventory-intelligence.js`, servicios y UI de inteligencia | `npm.cmd run test:inventory-intelligence`; `npm.cmd run db:check-inventory-intelligence` | `npm.cmd run test:inventory-intelligence-frontend`; stock, lotes, multitenant y auditoria | `npm.cmd run test:inventory-intelligence-browser` | Browser/servidor del arnes; no modificar datos comerciales | Cerrar solo servidor del arnes; detener ante consulta que escriba |
| Auditoria administrativa | `routes/audit.js`, `services/*audit*`, contrato de auditoria | `npm.cmd run test:administrative-audit`; `npm.cmd run db:check-administrative-audit` | `npm.cmd run test:administrative-audit-commercial`; multitenant y web security | `npm.cmd run test:administrative-audit-frontend`; `npm.cmd run test:administrative-audit-browser` | Fixtures y temporales en arneses | Verificar auditoria append-only y sanitizacion; detener ante secreto registrado |
| Exportaciones | servicios de exportacion, rutas y UI que descarga | `node --check`; prueba directa del modulo exportador | Regresion funcional del modulo y `npm.cmd run check:web-security` | Browser afectado para descarga, filtros y una hoja XLSX cuando aplique | Puede crear archivos temporales, nunca datos reales | Borrar archivos temporales en `finally`; detener ante formula no neutralizada |
| Seguridad web y rate limits | `config/web-security.js`, middleware, rutas publicas | `node --check`; `npm.cmd run check:web-security` | `npm.cmd run test:web-security`; session/multitenant si aplica | `npm.cmd run test:operational-health` si toca health | No requiere navegador por defecto | Detener ante ruta sin proteccion, secreto o respuesta con stack |
| Backups, restore y health operacional | `routes/health.js`, servicios operativos, `scripts/*backup*` | `npm.cmd run test:operational-health`; `npm.cmd run check:operational-health` | `npm.cmd run test:operational-backup-health`; `npm.cmd run test:operational-monitoring` | `npm.cmd run test:backup-restore` solo con entorno y permisos autorizados | Restore crea `tmp_tienda_restore_*`; backup usa procesos locales | Nunca restaurar la base principal; borrar temporales y esperar procesos hijos |
| Frontend estatico | `public/js/`, `public/css/`, `public/app.html` | `node --check` de JS tocado | Prueba frontend especifica del modulo; `npm.cmd run check:web-security` | Browser del modulo afectado | No requiere servidor salvo que el arnes lo inicie | Revisar foco, errores y no enviar `idTienda` |
| Pruebas browser | `scripts/test-*-browser.js`, UI y rutas usadas | `node --check` del arnes | Browser especifico del modulo | Solo cuando cambia UX, contrato visual o se cierra bloque | Edge/servidor temporal segun arnes | Timeout explicito, `finally`, consola limpia; no cerrar Edge del usuario |
| Migraciones y esquema | `database/migrations/`, `database/tienda_abarrotes.sql`, `scripts/migrate-db.js` | `node --check`; revision SQL; `git diff --check` | Comprobador del dominio y huella de solo lectura | Regresion afectada; readiness despues de aplicacion autorizada | Probar primero en base temporal | Detener ante migracion parcial o cambio comercial inesperado; no aplicar principal sin autorizacion |

## Scripts auxiliares no expuestos como comandos npm

`scripts/backup-utils.js`, `scripts/db-utils.js`, `scripts/http-test-security.js`
y `scripts/migration-state/legacy-migrations.js` son helpers internos. No se
ejecutan directamente: usar los comandos publicados por `package.json` que los
invocan. Los runners `scripts/verify-db-backup.js` y
`scripts/test-db-restore.js` estan expuestos respectivamente mediante
`db:verify-backup` y `db:test-restore`.

## Seleccion practica

Para un cambio pequeno, empezar por Nivel 1 y agregar Nivel 2 solo cuando el
alcance afecte datos, rutas o contratos. Reservar Nivel 3 para cierres,
frontend visual o cambios transversales. Un fallo de integridad, tenant,
seguridad, migracion o limpieza obliga a detenerse antes de continuar.
