# Continuidad del proyecto Tienda de Abarrotes

Documento de relevo tecnico para continuar el proyecto sin depender del historial de conversaciones. Toda afirmacion de estado debe volver a verificarse en el repositorio y en el entorno local antes de modificar o ejecutar algo.

## 1. Repositorio, rama y punto de partida

- Repositorio obligatorio: `pablooduran/Tienda-De-Abarrotes`
- Rama de trabajo obligatoria: `mejora-multitienda`
- Ultimo punto estable publicado: `eb53214 test: cerrar regresion general`.
- No trabajar directamente en `main`.
- El HEAD indicado es una referencia local conocida. Confirmar si tambien existe en el remoto antes de depender de el para una recuperacion.
- La base principal local esta en 024; no existe migracion 025. INV-A e INV-B
  permanecen cerrados.
- La optimizacion operativa de Codex, PREPROD-1 y REGRESION GENERAL estan
  cerrados. Confirmar el hash real con Git y el CI remoto antes de continuar.

Comprobacion inicial obligatoria:

```powershell
git status --short
git branch --show-current
git log -10 --oneline
git remote -v
```

Si la rama, el HEAD o el estado difieren, detenerse y entender los cambios existentes. No usar `git reset --hard`, `git clean` ni descartar trabajo ajeno.

## 2. Arquitectura

### Tecnologias

- Backend: Node.js 20 o superior, Express 4 y JavaScript CommonJS.
- Base de datos: MySQL 8 mediante `mysql2`.
- Frontend: HTML, CSS y JavaScript sin framework SPA.
- Sesiones: `express-session` con `express-mysql-session`.
- Seguridad web: `helmet`, validacion de origen, cabecera de peticion, limitacion de solicitudes, request ID y manejo centralizado de errores.
- Contraseñas: `bcryptjs`.
- Exportaciones: `exceljs`.
- Pruebas de navegador: `playwright-core` usando un navegador instalado localmente, actualmente Edge.
- Archivos: `multer` donde aplica.

### Estructura principal

| Ruta | Responsabilidad |
| --- | --- |
| `server.js` | Construccion de Express, orden de middleware, sesiones, rutas y archivos estaticos. |
| `config/` | Entorno, conexion MySQL, TLS, zona horaria y seguridad web. |
| `middleware/` | Autenticacion, tenant, roles, suscripcion, funcionalidades, limites, cabeceras y errores. |
| `routes/` | Contratos HTTP de autenticacion, administracion y modulos comerciales. |
| `services/` | Reglas de negocio, transacciones, reportes, POS, stock, clientes y cobranza. |
| `public/` | Aplicacion web, administracion, login, estilos y JavaScript del navegador. |
| `database/migrations/` | Migraciones historicas y modernas, numeradas de 001 a 024; la base principal local validada esta en 024 y no existe 025. |
| `database/tienda_abarrotes.sql` | Esquema inicial equivalente al estado final esperado. |
| `scripts/` | Migrador, comprobadores, pruebas, administracion local y backups. |
| `utils/` | Utilidades compartidas, incluidas fechas locales y errores. |

### Servidor y orden de seguridad

`server.js` configura las cabeceras y protecciones web, sesiones MySQL, autenticacion y los routers. En las rutas comerciales bajo `/api`, el orden conceptual es:

1. Sesion autenticada y revalidada contra la base.
2. Tenant valido y tienda activa.
3. Estado de suscripcion.
4. Funcionalidad incluida en el plan.
5. Permiso de escritura o modo de solo lectura.
6. Handler y servicio transaccional.

El contexto de tienda proviene de la sesion validada. El navegador no debe enviar ni elegir `idTienda`.

### Frontend

- Aplicacion comercial: `public/app.html` y `public/js/app.js`.
- Clientes, credito y cobranza: `public/js/customer-credit-ui.js`.
- Seguridad comun de solicitudes: `public/js/http-security.js`.
- Login: `public/login.html` y `public/js/login.js`.
- Superadministracion: `public/admin.html` y `public/js/admin.js`.
- Estilos generales, responsive e impresion: `public/css/styles.css`.

### MySQL y fechas

- La configuracion se centraliza en `config/database-options.js` y archivos relacionados de `config/`.
- Produccion exige TLS con verificacion de CA. No existe degradacion automatica a TLS inseguro.
- La hora de negocio es `America/La_Paz`.
- `DATE` representa fecha civil local y `DATETIME` representa hora local de negocio.
- MySQL devuelve `DATE` y `DATETIME` como texto para evitar reinterpretacion UTC accidental.
- No usar `toISOString()`, `NOW()` ni `CURRENT_TIMESTAMP` para nuevas fechas de negocio.
- Reutilizar las utilidades de fecha local existentes.

### Autenticacion y multitienda

- Roles actuales principales: `superadmin` y `dueno_tienda`.
- El superadmin opera las rutas administrativas y no entra a rutas comerciales sin contexto valido.
- Las sesiones guardan identificadores minimos y una version de sesion; cada peticion autenticada revalida administrador, tienda, asociacion, rol y vigencia.
- Cambios criticos, contrasena, desactivacion o cambio de acceso invalidan sesiones anteriores mediante `administrador.versionSesion`.
- Las consultas comerciales deben filtrar por `idTienda`; las relaciones sensibles usan claves y joins compuestos por tienda.

## 3. Estado de fases y bloques

| Fase o bloque | Estado | Evidencia y observaciones |
| --- | --- | --- |
| Fase 0 - entorno y seguridad inicial | Terminado | Entornos separados, migrador, sesiones MySQL, TLS seguro, hora local, seguridad web y errores centralizados. |
| Fase 1 - estructura multitienda | Terminado | Migracion 004 y claves/indices por tienda. Historicos conservados mediante backfills. |
| Fase 2 - aislamiento tenant | Terminado | `req.tenant`, middleware, consultas parametrizadas y pruebas cruzadas. |
| Fase 3 - superadmin y tiendas | Terminado | Tiendas, propietarios, activacion, desactivacion y cambio de contexto. |
| Fase 4 - planes y suscripciones | Terminado | Planes, funcionalidades, suscripciones, solo lectura y downgrade. Pagos de deuda existente conservan su contrato. |
| Fase 5 - catalogo maestro | Terminado | Catalogo, categorias, marcas, productos, proveedores y vinculacion por tienda. |
| Fase 6 - movimientos de stock | Terminado | Movimientos inmutables, entradas, salidas, ajustes, conciliacion e idempotencia. |
| Fase 7 - POS y pagos | Terminado | Venta transaccional, pagos multiples, fiado, comprobantes, caja, stock e idempotencia. |
| Fase 8 - finanzas | Terminado | Gastos, caja, reportes, ganancia bruta/neta, cierres y exportaciones. |
| Fase 9 - inteligencia de inventario | Terminado | Alertas, rotacion neta, stock vendible, sugerencias informativas, ventanas 7/30/90, exportacion XLSX y trazabilidad acotada. No crea compras ni proveedores. |
| Fase 9B - lotes y vencimientos | Terminado | Lotes, vencimientos, FEFO/FIFO, stock vendible, compras, POS y alertas. |
| Fase 10 - clientes y cobranza | Terminado | Backend, frontend, exportaciones, plantillas, comprobantes, segmentacion y pruebas reales de navegador. Cierre registrado en `d9fb327`. |
| Endurecimiento de sesiones | Terminado | Migracion 013, revalidacion por peticion y revocacion administrativa. |
| Endurecimiento TLS y horario | Terminado | TLS verificado y estrategia unica `America/La_Paz`. |
| Endurecimiento web | Terminado | Rate limiting, login uniforme, origen/CSRF, CSP, cabeceras, logs y errores seguros. |
| Migraciones historicas 001-003 | Terminado | Inspectores semanticos, recuperacion por pasos y prueba en bases temporales. |
| Backups y restauracion | Terminado | Backup, manifiesto, hash, verificacion y restauracion probada en base temporal. |
| Healthcheck, monitoreo y alertas | B1-B3 terminados; proveedores externos pendientes | Liveness, readiness, arranque/cierre, diagnostico superadmin, backups read-only, transiciones, anti-spam y comprobador operativo implementados. No hay envio externo. |
| Anulaciones y compensaciones | C1-C4B implementados | API transaccional, inventario y lotes, liquidaciones, reportes netos, comprobantes, interfaz, CSV/XLSX y pruebas de navegador. La base local esta en 017. |
| Auditoria administrativa global | AUD-A y AUD-B implementados | Bitacora append-only, allowlists, eventos administrativos y comerciales, consulta tenant/global, pantalla responsive y politica documental de retencion. No hay borrado automatico. |
| INV-A - stock vendible y conciliacion | Terminado | Clasificacion explicita, conciliacion read-only, ajustes idempotentes, auditoria, interfaz y pruebas; 019 aplicada en localhost. |
| INV-B - reposicion | Terminado | Rotacion neta, cobertura, alertas priorizadas, sugerencias informativas, exportacion XLSX y accesibilidad basica sin ordenes de compra. |
| Optimizacion de Codex, etapas 1-10 | Terminado | Indice, mapas compactos, comprobadores, seis skills versionables y validacion segura. Ver `AGENTS.md` y `docs/GUIA_CODEX_SKILLS.md`. |
| Fase 11 - acceso publico | SAAS-A1-SAAS-A5 terminados | Registro publico transaccional, verificacion y reenvio local, recuperacion de contrasena, configuracion base, onboarding inicial y regresion integral E2E. |
| Suscripciones SaaS | SAAS-B terminado | Ciclo de vida, acceso, planes, limites y administracion global sobre 022. |
| Pagos manuales de suscripcion | SAAS-C terminado | C0-C8 cubren diseno, estructura, backend, almacenamiento privado, revision, aplicacion atomica, frontend, seguridad y regresion integral. El flujo actual es manual; no hay pagos automaticos. |
| Seguridad publica final | Cerrada y publicada | Alias fisico de suscripcion protegido, password acotado a 72 bytes UTF-8, secreto de sesion de produccion endurecido y rate limits dedicados para pagos y comprobantes. Regresion local, tenant, auditoria y browser aprobados. |
| CI / GitHub Actions | Cerrada y publicada | Node 20, MySQL 8 efimero, migraciones 001-024 y regresion server-side sin despliegue ni secretos reales. |
| Preparacion de staging y preproduccion | STAGING-1 y PREPROD-1 cerrados y publicados | Contrato local/CI/staging/production, proxy por CIDR, Redis obligatorio en hosted, fail-fast, readiness, backup, rollback y recuperacion documentados. La infraestructura existente fue auditada parcialmente el 2026-08-24, sin validar un despliegue sintetico. |
| Staging y produccion | PILOT-READINESS pendiente externo | Render y Aiven existen, pero falta cerrar el contrato tecnico y validar el entorno hospedado con datos sinteticos antes de cualquier dato real. |

## 4. Funcionalidades implementadas

### Bloque 1 - integridad funcional pre-UX

La auditoria funcional previa al rediseño corrigio solo contratos existentes:

- Configuracion de tienda: las lecturas de configuracion quedan disponibles en modo solo lectura para una suscripcion suspendida; las mutaciones siguen bloqueadas por suscripcion, permiso y tenant.
- Planes: Basic, Standard y Pro son los planes publicos vigentes con limites 1/500/25/15, 3/1200/70/50 e ilimitado mediante `NULL`, respectivamente. `avanzado` se conserva como cuenta de cortesia/legado y no se publica.
- POS: un cliente ocasional puede pagar efectivo, QR o una combinacion totalmente saldada; si queda saldo pendiente se exige cliente registrado.
- Cobranza: una promesa conserva `fechaVencimiento`, `fechaPrometidaPago` y el seguimiento historico; la interfaz muestra el contexto de vencimiento sin crear un estado persistido nuevo.
- Lotes: existe distribucion inicial, trazabilidad y FEFO/FIFO; la integracion completa de lotes con Compras queda como diagnostico diferido y no se amplia en este bloque.

No se creo la migracion 025 ni se modificaron reglas comerciales, precios, planes historicos o la arquitectura de lotes.

### Multitienda, administracion y planes

- Creacion y administracion de tiendas y propietarios por superadmin.
- Seleccion de contexto y aislamiento obligatorio de tenant.
- Planes basico y avanzado con funcionalidades declaradas en base.
- Suscripciones, renovaciones, vencimiento, downgrade y modo de solo lectura.
- Administradores activos/inactivos y revocacion de sesiones.
- Pruebas de aislamiento, administracion y suscripciones.

### Catalogo, stock, POS y finanzas

- Catalogo maestro y productos locales por tienda.
- Categorias, marcas, proveedores, presentaciones, precios y costos.
- Movimientos de stock trazables e idempotentes.
- Compras, POS, pagos multiples y ventas fiadas.
- Lotes, vencimientos, FEFO/FIFO y stock vendible.
- Gastos, caja, cierres, reportes financieros y exportaciones.
- Inteligencia de inventario, alertas, rotacion y sugerencias.

### Clientes, credito y fiados

- Crear, consultar y editar clientes con normalizacion de telefono, documento y correo.
- Ocultar y restaurar clientes sin borrar historial ni modificar deuda.
- Listado por activos, ocultos o todos, con busqueda, filtros y paginacion.
- Configuracion de credito por tienda e individual por cliente.
- Limite efectivo, credito disponible, dias de credito y fecha de vencimiento.
- Politicas `permitir`, `advertir` y `bloquear` ante deuda vencida.
- El cliente ocasional o inactivo no puede recibir un fiado nuevo.
- El POS valida credito dentro de la transaccion y no confia en el frontend.
- El fiado nace de una venta y conserva saldo reconciliable con pagos.

### Cobranza, pagos y estado de cuenta

- Cobro especifico y cobro acumulado por cliente.
- Pagos parciales y totales, distribuidos por antiguedad.
- Calculos monetarios controlados en centavos.
- Idempotencia por `claveOperacion` y distribuciones deterministicas.
- Relacion consistente entre `cobroFiado`, `pagoFiado`, `fiado` y `pagoVenta`.
- Pago de deuda sin volver a afectar stock, movimientos o lotes.
- Fecha prometida, alertas y estados de cobranza calculados con fecha local.
- Estado de cuenta cronologico, paginado, imprimible y exportable.
- Deudas de clientes ocultos permanecen visibles y cobrables.

### Seguimiento, WhatsApp y plantillas

- Notas, llamadas, visitas, compromisos y mensajes enviados manualmente.
- Historial de seguimiento inmutable y filtrable.
- Plantillas por tienda: listado, creacion, edicion, activacion y desactivacion logica.
- Variables permitidas por tipo y rechazo de variables desconocidas.
- Seleccion explicita de plantilla y fallback determinista entre plantillas activas.
- Preparacion de texto y enlace exclusivo `https://wa.me/`.
- No existe envio automatico ni se marca un mensaje como enviado al abrir el enlace.
- El contenido dinamico y las plantillas se tratan como texto, no como HTML ejecutable.

### Comprobantes, exportaciones y segmentacion

- Comprobante consultable e imprimible para cobros actuales y legados.
- El comprobante se identifica como pago registrado, no como factura fiscal.
- XLSX de clientes, fiados/cobranza y estado de cuenta.
- Exportaciones globales segun filtros, no limitadas a la pagina visible.
- Neutralizacion de formulas de hoja de calculo y nombres de archivo seguros.
- Limites explicitos: no hay truncamiento silencioso.
- Ocho segmentos dinamicos: frecuentes, inactivos, con deuda, vencidos, promesa incumplida, buenos pagadores, mayor compra y mayor saldo.
- Segmentos calculados por backend, con criterios explicables, filtros previos a paginacion y agregados por tenant.

### Permisos de Fase 10

Funciones operativas disponibles en el plan basico:

- `clientes_basico`
- `fiados_basico`
- `pagos_fiado`
- `estado_cuenta_basico`

Funciones avanzadas:

- `limites_credito`
- `seguimiento_cobranza`
- `recordatorios_fiado`
- `segmentacion_clientes`
- `exportacion_clientes_fiados`

Un downgrade no borra ni oculta deuda existente. Se mantiene la consulta historica, el estado de cuenta y el cobro permitido por contrato; se bloquean configuracion y herramientas avanzadas.

## 5. Migraciones

No renumerar, editar ni reemplazar migraciones aplicadas. La base local principal
conocida `tienda_abarrotes_pruebas` esta validada en 024; no existe 025.

| Migracion | Objetivo principal |
| --- | --- |
| `001_mejoras_tienda.sql` | Proveedores por producto, categorias, stock entero y relacion fiado-venta. |
| `002_mejoras_stock_reportes.sql` | Presentaciones, stock ampliado, costos y ganancias historicas. |
| `003_borrado_logico.sql` | Borrado logico de clientes y fiados. |
| `004_multitienda_base.sql` | Tiendas, asociaciones y aislamiento multitienda. |
| `005_planes_suscripciones.sql` | Planes, funcionalidades, suscripciones y solo lectura. |
| `006_catalogo_maestro.sql` | Catalogo maestro, marcas, auditoria y vinculacion local. |
| `007_movimientos_stock.sql` | Movimientos inmutables, conciliacion e idempotencia de stock. |
| `008_punto_venta_pagos.sql` | POS, metodos de pago, comprobantes y compatibilidad de fiados. |
| `009_finanzas_reportes_caja.sql` | Gastos, costos historicos, reportes, caja y exportaciones. |
| `010_inteligencia_inventario.sql` | Configuracion, alertas e indices de inteligencia de inventario. |
| `011_lotes_vencimientos.sql` | Lotes, vencimientos, FEFO/FIFO y trazabilidad. |
| `012_clientes_fiados_comunicacion.sql` | Clientes ampliados, credito, cobros, seguimiento y plantillas. |
| `013_seguridad_sesiones.sql` | Version de sesion y revocacion segura. |
| `014_operaciones_compensatorias.sql` | Contrato base, estado operativo de venta, idempotencia y trazabilidad de futuras compensaciones. |
| `015_compensaciones_venta_inventario.sql` | Anulaciones/devoluciones de venta, liquidacion pendiente y trazabilidad compensatoria de stock y lotes. |
| `016_compensaciones_financieras.sql` | Resolucion de liquidaciones, deuda compensada, reembolsos pendientes, compensacion de cobros y correccion de metodos. |
| `017_integracion_compensaciones.sql` | Liquidaciones materiales inmutables, reportes netos y trazabilidad explicativa de cierres futuros. |
| `018_auditoria_administrativa_critica.sql` | Bitacora append-only y eventos criticos de autenticacion, sesiones, credenciales, tiendas, propietarios, planes y suscripciones. |
| `019_stock_vendible_ajustes.sql` | Stock fisico, vendible/no vendible, conciliacion y ajustes manuales. |
| `020_registro_publico_onboarding.sql` | Registro publico idempotente, correo normalizado, estado de acceso/onboarding y tokens futuros. |
| `021_configuracion_base_tienda.sql` | Configuracion base uno a uno de nombre mostrado, moneda, zona horaria y datos opcionales. |
| `022_ciclo_vida_suscripciones.sql` | Contrato de gracia, snapshot por periodo, historial append-only e idempotencia futura de suscripciones. |
| `023_estructura_pagos_suscripcion.sql` | Catalogo Basic/Standard/Pro, precios USD versionados, tasa manual USD/BOB y estructura de pagos manuales. |
| `024_corregir_idempotencia_y_snapshot_pagos.sql` | Idempotencia global/tenant, resultados tipados y snapshot textual del plan actual. |

Reglas:

- `scripts/migrate-db.js` es la unica entrada de migracion prevista.
- Las migraciones 001-003 tienen inspectores semanticos y recuperacion por pasos.
- Las modernas usan inspeccion pre/parcial/post y registro tardio.
- Una migracion registrada pero fisicamente incompleta debe bloquear el proceso.
- Una estructura completa no registrada solo puede adoptarse despues de validarla.
- `database/tienda_abarrotes.sql` debe conservar equivalencia con el estado post-024 para instalaciones nuevas.
- Antes de cualquier futura migracion: backup verificado, ensayo sobre copia, revision del SQL y comprobacion posterior.

## 6. Scripts npm y nivel de seguridad

No existe una orden generica `npm test` que represente toda la bateria. Revisar `package.json` antes de ejecutar cualquier script.

### Servidor

| Script | Uso | Condiciones |
| --- | --- | --- |
| `start:local` | Inicia el servidor con `APP_ENV=local` y `.env.local`. | Recomendado para desarrollo; exige `DB_HOST=localhost`. |
| `start` | Inicia el servidor sin forzar entorno. | Hosted debe declarar `APP_ENV=staging|production`; con `APP_ENV` ausente usa `.env` y advierte. |
| `dev` | Inicia con recarga para desarrollo. | Solo local. |

`npm.cmd run start:local -- --check` valida la seleccion local sin abrir el servidor ni consultar
la base. La prueba `test:local-startup` comprueba `.env.local`, `.env.ci`,
`.env.staging`, `.env.production`, el fallback advertido para entorno indefinido
y que los mensajes no expongan secretos. `test:staging-configuration` valida
proxy, store distribuido, DB, secretos y readiness sin conexiones externas.

### Escritura administrativa o estructural

Estos comandos nunca deben ejecutarse automaticamente:

| Script | Efecto |
| --- | --- |
| `db:init` | Inicializa estructura; puede ser incompatible con una base existente. |
| `db:migrate` | Aplica migraciones pendientes. Exige backup y revision previa. |
| `db:create-admin` | Crea un administrador. |
| `db:create-superadmin` | Crea un superadmin. |
| `db:seed-demo` | Inserta datos demostrativos; requiere autorizacion explicita y nunca produccion. |

### Comprobadores de solo lectura

Todos requieren credenciales MySQL y deben apuntar a la base local correcta. No modifican datos por contrato:

- `db:check-multitenant`: estructura y aislamiento multitienda.
- `db:check-subscriptions`: planes, funcionalidades y suscripciones.
- `db:check-subscription-lifecycle`: snapshot, historial, idempotencia y
  coherencia temporal de 022 compatible con el esquema final 024.
- `db:check-master-catalog`: catalogo maestro y enlaces locales.
- `db:check-stock-movements`: movimientos y conciliacion de stock.
- `db:check-pos-payments`: estructura de POS y pagos.
- `db:check-financial-reports`: finanzas, caja y reportes.
- `db:check-inventory-intelligence`: inteligencia de inventario.
- `db:check-lots-expiration`: lotes y vencimientos.
- `db:check-customers-credit`: clientes, credito, cobros y permisos.
- `db:check-session-security`: version y vigencia de sesiones.
- `db:check-timezone-tls`: configuracion TLS y estrategia horaria.
- `db:check-legacy-migrations`: estado semantico de las migraciones 001-003.
- `db:check-compensations`: estructura, invariantes, idempotencia, tenant y permisos de la base C1; exige localhost y 014 aplicada en el destino comprobado.
- `db:check-sales-compensations`: estructura y datos de C2; exige localhost y una base con 015 aplicada.
- `db:check-financial-compensations`: estructura e invariantes financieras de C3; exige localhost y una base con 016 aplicada.
- `check:web-security`: revision estatica de protecciones web.

### Pruebas funcionales

Estas pruebas pueden crear y limpiar datos temporales en la base local de pruebas. La mayoria requiere un servidor local activo y credenciales de prueba:

- `test:tenant-isolation`: cruces entre tiendas y rutas comerciales.
- `test:admin-management`: superadmin, tiendas y administradores.
- `test:subscriptions`: planes, suscripciones, downgrade y solo lectura.
- `test:subscription-lifecycle-schema`: ensayo temporal de 022, backfill,
  snapshot, concurrencia, rollback y huella principal.
- `test:subscription-lifecycle-engine`: estado efectivo, gracia, suspension,
  reactivacion, renovacion, reloj inyectado, idempotencia y limpieza de B2.
- `test:saas-subscription-admin`: listado global, detalle, ciclo de vida,
  cambio de plan, permisos, idempotencia y limpieza del panel B5.
- `test:saas-subscription-admin-browser`: responsive, teclado, foco,
  confirmaciones y doble envio del panel B5 con HTTP local aislado.
- `test:master-catalog`: catalogo maestro.
- `test:stock-movements`: movimientos, ajustes y conciliacion.
- `test:pos-payments`: ventas, stock, pagos e idempotencia.
- `test:financial-reports`: caja, gastos, reportes y agregados.
- `test:inventory-intelligence`: alertas y metricas de inventario.
- `test:inventory-intelligence-frontend`: contrato de rotacion, sugerencias, alertas, exportacion, seguridad y responsive de la vista final.
- `test:inventory-adjustments`: conciliacion y ajustes sobre bases temporales post-019.
- `test:inventory-adjustments-frontend`: contrato estatico y seguridad de la interfaz.
- `test:inventory-adjustments-browser`: flujo, foco, doble envio y vistas responsive.
- `test:lots-expiration`: lotes, vencimientos y FEFO/FIFO.
- `test:customers-credit`: clientes, credito, cobranza y multitienda.
- `test:customers-credit-frontend`: contratos y seguridad estatica del frontend.
- `test:customers-credit-browser`: flujos reales de navegador; inicia y cierra sus propios procesos locales.
- `test:session-revocation`: revalidacion e invalidacion de sesiones.
- `test:timezone-tls`: configuracion TLS y fechas locales.
- `test:web-security`: password compatible con bcrypt, secreto de sesion de
  produccion, rate limits generales y dedicados, origen, CSP, cabeceras,
  alias de vistas protegidas y errores seguros.
- `test:legacy-migrations`: usa el usuario auxiliar local y crea y elimina exclusivamente bases `tmp_tienda_restore_*`.
- `test:compensation-foundation`: prueba 001→014, 013→014, esquema inicial e invariantes exclusivamente en bases `tmp_tienda_restore_*`.
- `test:sales-compensations`: aplica 015 solo en una base `tmp_tienda_restore_*`, prueba anulaciones, devoluciones, stock, lotes, finanzas pendientes, concurrencia, rollback, tenant, plan y CSRF, y limpia en `finally`.
- `test:financial-compensations`: aplica 016 con el migrador real solo en `tmp_tienda_restore_*`, prueba liquidaciones, reembolsos pendientes, deuda, cobros, metodos, concurrencia, rollback, tenant, plan y CSRF, compara la huella principal y limpia en `finally`.

No ejecutar pruebas funcionales sobre una base comercial ni remota. Confirmar sus guardas antes de cada uso.

### Backup y restauracion

| Script | Efecto | Requisitos |
| --- | --- | --- |
| `db:backup` | Genera dump, manifiesto y SHA-256. Lee la base origen y escribe archivos. | Local/test, localhost, `mysqldump`, credenciales de lectura. |
| `db:verify-backup -- <sql>` | Valida archivo, manifiesto, tamano, hash y contenido esperado. | No restaura ni modifica la base. |
| `db:test-restore -- <sql>` | Crea una base `tmp_tienda_restore_*`, restaura, comprueba y la elimina en `finally`. | Usuario local auxiliar y clientes MySQL. Nunca produccion. |
| `db:cleanup-backups` | Evalua retencion. Es dry-run por defecto; borrar exige confirmacion explicita. | Solo dentro de la carpeta configurada, sin seguir enlaces. |
| `test:backup-restore` | Prueba guardas, backup, alteraciones, restauracion y limpieza. | Localhost, herramientas MySQL y usuario auxiliar. |
| `test:operational-health` | Prueba liveness, readiness, cache, timeout, rate limit y cierre ordenado. | Usa dobles; no conecta a MySQL ni modifica datos. |
| `test:operational-backup-health` | Prueba autorizacion, diagnostico, estados de backup, cache y solo lectura. | Usa archivos temporales aislados; no usa MySQL ni el directorio real de backups. |
| `test:operational-monitoring` | Prueba transiciones, cooldowns, sanitizacion, cierre y codigos del comprobador. | Usa reloj y servicios inyectados; no conecta a MySQL ni ejecuta procesos. |
| `check:operational-health` | Ejecuta una comprobacion unica de readiness y backup. Sale 0/1/2/3. | Exige `APP_ENV=local` y `DB_HOST=localhost`; solo lectura. |

Nunca ejecutar automaticamente `db:migrate`, `db:init`, scripts de creacion de usuarios, seed, restauraciones, pruebas destructivas o limpieza efectiva de backups.

## 7. Variables de entorno

Solo se documentan nombres. Consultar `.env.example` y `.env.local.example`; no copiar valores entre entornos.

### Aplicacion y base

- `APP_ENV`
- `PORT`
- `DB_HOST`
- `DB_PORT`
- `DB_USER`
- `DB_PASSWORD`
- `DB_NAME`
- `DB_SSL_ENABLED`
- `DB_SSL_CA`
- `DB_SSL_CA_PATH`
- `SESSION_SECRET`

### Bootstrap administrativo y datos demo

- `ADMIN_USER`
- `ADMIN_PASSWORD`
- `ALLOW_DEMO_SEED`

### Seguridad web

- `TRUSTED_ORIGINS`
- `RATE_LIMIT_ENABLED`
- `RATE_LIMIT_WINDOW_MS`
- `RATE_LIMIT_MAX`
- `LOGIN_RATE_LIMIT_MAX`
- `LOGIN_IDENTITY_RATE_LIMIT_MAX`
- `AUTH_RATE_LIMIT_MAX`
- `ADMIN_RATE_LIMIT_MAX`
- `EXPORT_RATE_LIMIT_MAX`
- `WHATSAPP_RATE_LIMIT_MAX`
- `HEALTH_RATE_LIMIT_MAX`
- `HEALTH_READINESS_SOFT_MS`
- `HEALTH_READINESS_TIMEOUT_MS`
- `HEALTH_READINESS_CACHE_MS`
- `SHUTDOWN_TIMEOUT_MS`
- `BACKUP_WARNING_HOURS`
- `BACKUP_CRITICAL_HOURS`
- `BACKUP_STATUS_CACHE_MS`
- `MONITOR_WARNING_REMINDER_MS`
- `MONITOR_ERROR_REMINDER_MS`
- `MONITOR_CRITICAL_REMINDER_MS`
- `SECURITY_LOG_LEVEL`

### Limites de exportacion

- `CUSTOMER_CREDIT_EXPORT_CLIENTS_MAX_ROWS`
- `CUSTOMER_CREDIT_EXPORT_DEBTS_MAX_ROWS`
- `CUSTOMER_CREDIT_EXPORT_STATEMENT_MAX_ROWS`

### Backup y restauracion

- `BACKUP_DIR`
- `MYSQLDUMP_PATH`
- `MYSQL_CLIENT_PATH`
- `BACKUP_RESTORE_USER`
- `BACKUP_RESTORE_PASSWORD`
- `BACKUP_RETENTION_DAYS`
- `BACKUP_RETENTION_COUNT`

No mostrar estas variables en logs ni respuestas. Nunca versionar `.env`, `.env.local`, certificados, dumps o manifiestos con datos operativos. Las credenciales administrativas no deben quedar almacenadas en la configuracion local; solo pueden proporcionarse de forma efimera a una prueba aislada que garantice su limpieza.

## 8. Bases locales y usuarios auxiliares

- Base local esperada para pruebas integrales: `tienda_abarrotes_pruebas`.
- Una instalacion local puede usar otro `DB_NAME`, pero los scripts destructivos deben rechazar nombres no autorizados.
- Bases de restauracion: unicamente `tmp_tienda_restore_*`.
- Las pruebas de migraciones historicas reutilizan exclusivamente bases `tmp_tienda_restore_*` y el usuario auxiliar local.
- Usuario normal: el definido por `DB_USER`, con permisos limitados a la base de aplicacion; no debe tener permisos globales de creacion o eliminacion de bases.
- Usuario auxiliar local: `tienda_backup_test` en `localhost`, limitado exclusivamente a `tmp_tienda_restore_%.*`.
- No ejecutar `GRANT` automaticamente. La preparacion del usuario auxiliar es manual y local.
- Ninguna prueba debe usar Aiven, un host remoto o `APP_ENV=production`.

## 9. Archivos principales por modulo

| Modulo | Archivos principales |
| --- | --- |
| Arranque y seguridad | `server.js`, `config/env.js`, `config/database-options.js`, `config/web-security.js` |
| Autenticacion y sesiones | `routes/auth.js`, `middleware/auth.js`, `services/session-validation-service.js`, `database/migrations/013_seguridad_sesiones.sql` |
| Tenant, roles y suscripcion | `middleware/tenant.js`, `middleware/roles.js`, `middleware/subscription.js`, `services/subscription-service.js` |
| Superadmin y tiendas | `routes/admin.js`, `public/admin.html`, `public/js/admin.js` |
| API comercial historica | `routes/api.js` |
| POS | `routes/pos.js`, `services/pos-sale-service.js`, `public/js/app.js` |
| Clientes y credito | `routes/customers-credit.js`, `services/customer-credit-service.js`, `public/js/customer-credit-ui.js` |
| Cobranza | `services/debt-collection-service.js`, `routes/customers-credit.js` |
| Plantillas | `services/customer-credit-template-service.js`, `routes/customers-credit.js` |
| Comprobantes | `services/customer-credit-receipt-service.js`, `routes/customers-credit.js` |
| Exportaciones Fase 10 | `services/customer-credit-export-service.js`, `routes/customers-credit.js` |
| Segmentacion | `services/customer-segmentation-service.js`, `routes/customers-credit.js` |
| Finanzas | `routes/finance.js`, `services/financial-service.js`, `services/financial-export-service.js` |
| Stock | `routes/stock.js`, `services/stock-movement-service.js` |
| Lotes | `routes/lots.js`, `services/lot-service.js`, `services/lot-export-service.js` |
| Inteligencia de inventario | `routes/inventory-intelligence.js`, `services/inventory-intelligence-service.js`, `services/inventory-intelligence-export-service.js`, pruebas `inventory-intelligence*` |
| Stock vendible y ajustes INV-A | `config/inventory-adjustment-contract.js`, `routes/inventory-adjustments.js`, `services/inventory-reconciliation-service.js`, `services/inventory-adjustment-service.js`, `public/js/inventory-adjustment-ui.js`, migracion `019` y pruebas `inventory-adjustments*` |
| Catalogo maestro | `routes/master-catalog.js`, `services/master-catalog-service.js` |
| Frontend comun | `public/app.html`, `public/js/app.js`, `public/js/http-security.js`, `public/css/styles.css` |
| Health operativo | `routes/health.js`, `routes/admin-health.js`, `services/operational-health-service.js`, `services/backup-status-service.js`, `services/operational-state-tracker.js`, `services/operational-event-dispatcher.js`, `services/server-lifecycle-service.js`, `scripts/check-operational-health.js` |
| Compensaciones C1-C4A | `config/compensation-contract.js`, migraciones `014` a `017`, `routes/sales-compensations.js`, `routes/financial-compensations.js`, servicios `*compensation*`, comprobadores y pruebas `*compensation*` |
| Interfaz C4B | `public/js/compensation-ui.js`, `public/css/styles.css`, `services/compensation-query-service.js`, `services/compensation-export-service.js`, pruebas `test:compensation-*` |
| Auditoria administrativa AUD-A/B | `config/administrative-audit-contract.js`, `services/administrative-audit-service.js`, `services/administrative-audit-query-service.js`, `middleware/administrative-audit-middleware.js`, `routes/audit.js`, `public/js/administrative-audit-ui.js`, migracion `018` y pruebas `administrative-audit*` |
| Migrador | `scripts/migrate-db.js`, `scripts/migration-state/legacy-migrations.js` |
| Backups | `scripts/backup-db.js`, `scripts/backup-utils.js`, `scripts/verify-db-backup.js`, `scripts/test-db-restore.js`, `scripts/cleanup-db-backups.js` |

## 10. Limitaciones conocidas

- C2 permite anular o devolver ventas por API; C3 resuelve deuda y crea obligaciones; C4A materializa reembolsos o compensaciones por otro medio sin editar historicos.
- El credito a favor operativo sigue pendiente: no existe todavia un libro seguro de emision y consumo y nunca debe simularse con un fiado negativo.
- C4A aporta reportes netos y comprobantes; C4B los integra en una interfaz
  responsive y accesible, con exportaciones CSV/XLSX protegidas. El credito a
  favor permanece fuera de alcance.
- INV-A no corrige automaticamente hallazgos historicos. En productos sin lotes, todo el saldo fisico se considera vendible; la existencia no vendible requiere trazabilidad por lotes.
- AUD-A/B aporta una bitacora global inmutable, eventos administrativos y comerciales,
  consulta protegida para propietario y superadmin, filtros, detalle y pantalla
  responsive. La retencion inicial conserva al menos 365 dias en linea y se revisa
  trimestralmente; no existe borrado automatico ni API de escritura.
- La reposicion es informativa: no hay proveedores seleccionados, ordenes de compra ni compras automaticas. Las ventanas son 7/30/90 o un rango manual de hasta 365 dias; ventas anuladas y devoluciones aplicadas no inflan la demanda.
- Los backups locales estan verificados. Aiven informa backups administrados para
  el MySQL existente, pero el backup/restore remoto con datos sinteticos aun no
  fue validado; tampoco esta definido el respaldo del storage privado.
- Los backups contienen datos sensibles y deben residir en disco cifrado o almacenamiento seguro. No enviarlos por correo o WhatsApp.
- Local y CI conservan rate limiting en memoria. Staging y production exigen
  Redis con TLS y rechazan el arranque si no esta configurado.
- STAGING-1 reemplaza la confianza por numero de saltos con CIDR explicitos. La
  topologia real y las redes del proxy siguen pendientes; sin ellas hosted
  falla cerrado.
- B1-B3 aportan liveness/readiness, cierre ordenado, diagnostico superadmin, backup read-only,
  transiciones, anti-spam y comprobador local. No existen metricas persistentes ni proveedor de
  alertas; el estado, la cache y los limites siguen siendo por instancia.
- Un proceso caido no puede emitir su propia recuperacion o alerta. Hace falta un monitor externo
  autorizado para invocar el comprobador o los endpoints y un almacenamiento fuera del host.
- CI GitHub Actions usa Node 20, MySQL 8 efimero, migraciones 001-024 y una
  regresion server-side serializada. No usa secretos, backups ni datos reales y
  no despliega. Los arneses browser siguen en la validacion local controlada.
- Existe contrato de configuracion para staging e infraestructura Render/Aiven
  parcialmente auditada, pero no un entorno hospedado sintetico validado.
- SAAS-A incorpora registro publico pendiente, verificacion, recuperacion de contrasena y onboarding mediante adaptador local en memoria. Aun no hay proveedor real de correo, invitaciones ni login social.
- SAAS-C2 agrega rutas backend para planes y metodos publicos, cotizacion sin
  persistencia, creacion/listado/detalle/cancelacion tenant de solicitudes y
  configuracion minima de tasa/metodos por superadmin. Usa 72 horas, una sola
  solicitud abierta e idempotencia hash-only; no carga archivos, revisa,
  aplica pagos, modifica suscripciones ni agrega frontend.
- SAAS-C3 agrega carga multipart de un comprobante PDF/JPEG/PNG de hasta 5 MiB,
  metadata versionada, reemplazo desde `observada`, descarga propia autenticada
  y transicion a `pendiente_revision`. El adaptador local usa claves opacas en
  un directorio privado configurable fuera del repositorio; no hay revision,
  aprobacion, rechazo, aplicacion del pago ni interfaz.
- SAAS-C4 agrega listado, detalle, descarga privada, observacion y rechazo para
  superadmin. SAAS-C5 agrega la transicion atomica
  `pendiente_revision -> aplicada`: bloquea tienda, suscripcion y solicitud,
  consume el snapshot financiero congelado, enlaza una sola aplicacion con B2 o
  B4 y revierte solicitud, suscripcion, historiales y auditoria ante cualquier
  fallo. No crea un estado aprobado intermedio ni movimiento contable.
- SAAS-C6 agrega la interfaz de propietario en `subscription.html` y el bloque de
  superadmin en `admin.html`. Solo consume APIs C2-C5: no calcula montos, no
  recibe IDs internos ni crea flujos financieros nuevos.
- SAAS-C7 valida integralmente C2-C6 y endurece la matriz de revision: una
  solicitud `observada` solo puede pasar a `rechazada`; repetir la observacion
  con una clave nueva se rechaza sin duplicar revision, historial ni auditoria.
- SAAS-B esta completo sobre la migracion 022: ciclo de vida, gracia,
  suspension, reactivacion, renovacion tecnica, acceso por estado, cambio de
  plan, limites y administracion global para superadmin. SAAS-C agrega pagos
  manuales sobre 023-024; no hay cobro automatico ni jobs.
- WhatsApp solo prepara texto/enlace; no envia mensajes automaticamente.
- No hay PDF general, portal del cliente ni facturacion fiscal.
- Los comprobantes de cobro no son facturas y algunos cobros legados tienen datos parciales.
- No todos los nombres del comprobante son snapshots historicos; cambios posteriores en cliente o tienda pueden afectar textos reconstruidos.
- El selector de clientes del POS conserva un limite operativo documentado de 500 registros.
- Algunos resumenes de ficha limitan historiales recientes; el estado de cuenta y exportaciones cubren el historial paginado/completo segun contrato.
- `exceljs@4.4.0` arrastra `uuid@8.3.2` y mantiene dos avisos moderados transitivos conocidos. No usar `npm audit fix --force`.
- No existe modelo de multiples sucursales dentro de una misma empresa, ni impuestos o moneda configurables de forma general.

## 11. Orden exacto para continuar

No alterar este orden sin una decision explicita:

1. Cerrar DOCS-OPS con la documentacion operativa actual y su validacion.
2. Iniciar PRODUCTO-0 solo despues del cierre de DOCS-OPS; no iniciar staging
   ni infraestructura durante esa fase.
3. Realizar la revision integral del propietario tras PRODUCTO-0 y decidir si
   autoriza gasto externo, proveedor y topologia.
4. Autorizar y provisionar STAGING-2B con datos sinteticos cuando esas
   decisiones existan.
5. Validar restauracion, monitoreo y rollback del entorno aislado antes de
   decidir una beta.

Cada bloque debe cerrar con pruebas, comprobadores, documentacion y un commit local independiente. No mezclar cambios de bloques distintos.

## 12. Reglas de seguridad para continuar

- Trabajar siempre en `mejora-multitienda` o en una rama derivada acordada; nunca directamente en `main`.
- Usar exclusivamente `localhost` para desarrollo, migraciones ensayadas, pruebas y restauraciones.
- No tocar Aiven, Render ni produccion sin autorizacion expresa y un procedimiento aprobado.
- No crear ni ejecutar migraciones sin auditoria del esquema real, backup verificado y ensayo sobre copia.
- No editar migraciones ya aplicadas.
- No ejecutar `db:migrate` automaticamente.
- No hacer push ni despliegue automatico.
- Mantener un commit por bloque y no incluir cambios ajenos.
- Revisar `git status`, `git diff` y `git diff --check` antes de cerrar cada bloque.
- No usar `git reset --hard`, `git clean` ni descartar cambios que no se hayan creado en la tarea actual.
- No modificar `saldoPendiente`, stock, ventas, pagos o lotes directamente para corregir datos. Usar servicios transaccionales u operaciones compensatorias aprobadas.
- No aceptar `idTienda` desde el navegador.
- Usar SQL parametrizado y joins/condiciones por tenant.
- No exponer contrasenas, hashes, cookies, tokens, CA, cadenas de conexion, datos personales ni dumps.
- No copiar `.env.local`; recrear variables de manera segura en cada entorno.
- No usar `npm audit fix --force`.
- Toda prueba que cree recursos debe limpiarlos en `finally` y verificar que no queden procesos, archivos o bases temporales.

## 13. Procedimiento inicial para otra IA o desarrollador

1. Abrir el repositorio sin modificar archivos.
2. Ejecutar:

```powershell
git status --short
git branch --show-current
git log -10 --oneline
```

3. Confirmar rama `mejora-multitienda`, HEAD esperado o explicar cualquier diferencia, y working tree limpio.
4. Leer `README.md` y `docs/CONTINUIDAD_PROYECTO.md` completos.
5. Revisar `package.json`, `server.js`, el modulo que se vaya a tocar y sus pruebas.
6. Para iniciar el servidor de desarrollo, usar `npm.cmd run start:local`; para otros comandos confirmar que `APP_ENV` es local/test, `DB_HOST` es localhost y `DB_NAME` es la base de pruebas antes de cualquier conexion.
7. Ejecutar primero validaciones estaticas seguras: `node --check` de los archivos relevantes, `npm.cmd run check:web-security` cuando corresponda y `git diff --check`.
8. Ejecutar comprobadores de solo lectura solo despues de verificar el entorno.
9. Ejecutar pruebas funcionales unicamente si se entiende su limpieza y si apuntan a la base local de pruebas.
10. Volver a confirmar el working tree antes de editar.
11. Proponer y ejecutar un solo bloque acotado, sin mezclar trabajo futuro.

Nunca asumir que el ultimo resultado conocido sigue vigente: los resultados descritos abajo son una referencia, no sustituyen una nueva validacion.

## 14. Recuperacion desde GitHub

1. Clonar en un directorio nuevo:

```powershell
git clone https://github.com/pablooduran/Tienda-De-Abarrotes.git
Set-Location 'Tienda-De-Abarrotes'
git fetch --all --prune
git switch mejora-multitienda
git status --short
git log -10 --oneline
```

2. Confirmar que el commit local esperado exista en el remoto. Si `91b4bb9` no aparece, no inventar ni rehacer trabajo: localizar el repositorio local o bundle que lo contenga.
3. Instalar dependencias reproducibles con `npm.cmd ci`.
4. Crear la configuracion local a partir de los archivos de ejemplo, sin reutilizar secretos de otra persona o entorno.
5. Preparar MySQL local y restaurar un backup previamente verificado en una base nueva. No restaurar encima de una base existente.
6. Ejecutar los comprobadores de solo lectura y luego la bateria correspondiente.
7. No ejecutar migraciones hasta conocer el estado fisico y `schema_migrations` de la base restaurada.

## 15. Recuperacion desde un bundle o archivo del proyecto

### Git bundle

```powershell
git clone 'ruta\al\proyecto.bundle' 'Tienda-De-Abarrotes'
Set-Location 'Tienda-De-Abarrotes'
git branch --all
git switch mejora-multitienda
git fsck --full
git status --short
git log -10 --oneline
```

### Archivo de directorio

1. Verificar checksum y procedencia del archivo.
2. Extraerlo en un directorio nuevo, nunca encima de otra copia.
3. Confirmar que `.git` este presente.
4. Ejecutar `git fsck --full`, `git status`, rama y log.
5. Ejecutar `npm.cmd ci`; no conservar `node_modules` transportado.
6. Recrear la configuracion local sin copiar secretos.
7. Si existe un backup de base, verificar primero su manifiesto y hash con `db:verify-backup`.
8. Restaurarlo solo en una base nueva `tmp_tienda_restore_*`, comprobarlo y luego planificar el cambio de conexion. Nunca sobrescribir la base danada.

En ambos casos, conservar el repositorio o base anterior hasta completar smoke tests y tener una via de rollback.

## 16. Estado final conocido

### Git

- Rama local: `mejora-multitienda`.
- HEAD estable publicado: `eb53214` (`test: cerrar regresion general`).
- CI remoto de `eb53214`: PASS, workflow `CI`, run `31724513930`.
- INV-A e INV-B estan cerrados sobre la rama `mejora-multitienda`.
- La optimizacion de Codex esta cerrada: `AGENTS.md`, `docs/MAPA_PRUEBAS.md`,
  `docs/ARQUITECTURA_RESUMIDA.md`, `docs/SEGURIDAD_Y_MULTITIENDA.md`,
  `docs/MODELO_DATOS_RESUMIDO.md`, `docs/GUIA_CODEX_SKILLS.md`,
  `codex:status`, `codex:cleanup-check`, `codex:precommit` y seis skills.
- Working tree esperado despues del cierre: limpio. Verificar siempre el HEAD
  real con `git log -1 --oneline`.
- No consta despliegue de este estado. Verificar el remoto antes de asumir que todos los commits locales fueron publicados.

### Base local

- Base de pruebas esperada: `tienda_abarrotes_pruebas`.
- Migraciones registradas en la base principal conocida: 001 a 024; no existe
  migracion 025.
- El estado operativo local es `APP_ENV=local`, `localhost /
  tienda_abarrotes_pruebas` y `BACKUP_OK`.
- No deberian existir bases `tmp_tienda_restore_*` ni
  fixtures de ciclo de vida despues de las pruebas.

### Ultimo estado conocido de pruebas

Han sido validadas en bloques anteriores:

- Clientes y cobranza: `test:customers-credit`, `test:customers-credit-frontend`, `test:customers-credit-browser` y `db:check-customers-credit`.
- Regresiones: POS, finanzas, tenant, suscripciones, administradores, catalogo, stock, inteligencia y lotes.
- Seguridad: sesiones, TLS/zona horaria, seguridad web y migraciones historicas.
- Operacion: `test:operational-health`, `test:operational-backup-health` y
  `test:operational-monitoring` sin conexiones remotas ni escrituras comerciales.
- Compensaciones C1: `test:compensation-foundation` valido instalacion 001→014,
  actualizacion 013→014, equivalencia del esquema inicial, FKs compuestas,
  idempotencia, allowlists y limpieza total sin modificar la base principal.
- Compensaciones C2: `test:sales-compensations` valido 015 en base temporal,
  anulacion total, devolucion parcial/acumulada, idempotencia, concurrencia,
  rollback, stock simple, lotes vigentes/vencidos, liquidaciones pendientes,
  tenant, plan y CSRF; el escenario temporal evoluciona de forma compatible
  hasta 017 sin modificar la base principal.
- Compensaciones C3: `test:financial-compensations` valida 016 con el migrador
  real solo en base temporal, deuda, reembolsos pendientes, cobros, metodos,
  concurrencia, rollback, tenant, plan y CSRF.
- Compensaciones C4A: `test:compensation-integration` valida liquidaciones
  materiales, reportes netos, cierres y comprobantes sobre 017.
- Compensaciones C4B: `test:compensation-interface`,
  `test:compensation-frontend` y `test:compensation-browser` validan filtros,
  CSV/XLSX, formula injection, interfaz, teclado, foco, impresion, responsive y
  doble envio sin tocar la base principal.
- Auditoria AUD-B: `test:administrative-audit-commercial`,
  `test:administrative-audit-frontend` y `test:administrative-audit-browser`
  validan tenant, filtros, paginacion, sanitizacion, ausencia de rutas de
  escritura, teclado, foco y responsive sin modificar MySQL.
- Backup: `test:backup-restore` con 26 comprobaciones, backup real local, verificacion de hash/manifiesto y restauracion temporal.
- SAAS-B6: regresion integral de estructura 022, ciclo de vida, acceso, planes,
  limites, administracion SaaS, tenant, seguridad y browser; `test:saas-a-e2e`
  confirma compatibilidad SAAS-A sobre base temporal y huella principal intacta.
- Durante la restauracion se ejecutaron `db:check-legacy-migrations`, `db:check-session-security`, `db:check-timezone-tls` y `db:check-customers-credit` contra la base temporal.
- La validacion final de backup elimino los archivos generados y la base temporal; no dejo procesos auxiliares activos.
- REGRESION GENERAL: autenticacion, tenant, catalogo, inventario, compras,
  ventas, reportes, compensaciones, suscripciones, pagos manuales, seguridad,
  CI y browser de propietario/superadmin validados. La correccion publicada
  conserva `clasificacionInventario` al devolver unidades vendibles al lote
  original.
- PRODUCTO-1 P8: la regresion distribuida vuelve a validar autenticacion,
  tenant, inventario, ventas, clientes, compensaciones, suscripciones, pagos,
  seguridad y P1-P7. El nuevo `test:e2e-critical-business` completa tres
  ejecuciones locales consecutivas sobre base temporal 001-024 y comprueba el
  recorrido critico, sus invariantes y la limpieza sin modificar la base
  principal.

Estos resultados corresponden al ultimo estado conocido. Antes de iniciar el siguiente bloque, repetir las comprobaciones relevantes en localhost y registrar resultados exactos.

## 17. Siguiente macrofase

**SAAS-B esta cerrado**. B1-B5 implementan el modelo, motor, acceso por estado,
cambios de plan, limites y administracion SaaS global; B6 valida integralmente
seguridad, concurrencia, multitienda, browser y compatibilidad con SAAS-A.

**SAAS-C esta cerrado**. C0 define el diseno; C1 y C1.1 incorporan las
migraciones 023 y 024; C2-C6 implementan cotizacion, solicitud, comprobantes,
revision, aplicacion atomica y frontend; C7 endurece seguridad y transiciones;
C8 valida el flujo completo, browser, tenant, idempotencia, concurrencia y
limpieza. Los pagos actuales son manuales. Siguen pendientes QR dinamico,
tarjetas, conciliacion, webhooks, cobro recurrente y automatizaciones; tampoco
existe facturacion fiscal ni se inicia una beta.

Las macrofases de **seguridad publica final**, **CI / GitHub Actions**,
**STAGING-1**, **PREPROD-1** y **REGRESION GENERAL** estan cerradas y
publicadas. DOCS-OPS y PRODUCTO-0A/0B estan cerrados. PRODUCTO-1 P1-P7 estan
cerrados. P6 ordena Mi plan y la administracion SaaS sin alterar el motor de
suscripciones, pagos manuales, limites, snapshots, tenant o permisos. Para el
propietario, el catalogo publico queda limitado a Basico, Standard y Pro; el
plan avanzado legado no se ofrece como opcion. P6 esta cerrado. P7A crea la
base formal de diseno con `DESIGN.md` y `$product-design-review`, sin alterar
HTML, CSS, JavaScript, rutas, permisos, tenant, planes, pagos ni logica
comercial. STAGING-2B queda diferido
hasta la revision final del propietario, una decision de proveedor/topologia y
autorizacion expresa de gasto; cualquier despliegue sigue requiriendo
autorizacion separada.

P7B realiza la primera critique transversal con `DESIGN.md`: no encuentra P0,
normaliza jerarquia, copy y acciones secundarias en Inicio, Mi plan y
superadmin sin cambiar backend, contratos, permisos, tenant ni reglas
comerciales. La revision de jerarquia analitica del Inicio queda registrada
como UX-005 para P7E. P7C-P7E y P8 no estan iniciados.

P7C completa la pasada transversal de responsive y accesibilidad: los arneses
locales confirman reflow en 360x800, 768x1024 y 1366x768 sin overflow de pagina
en las superficies revisadas. Se endurecen foco, reduced motion y los dialogos
operativos revisados sin tocar backend ni contratos. P7D, P7E y P8 no estan
iniciados.

P7D agrega hardening visual local para contenido extenso y estados incomodos:
listas paginadas, vacio, error seguro, red lenta y doble activacion. Las
mutaciones de interfaz anuncian actividad y las superficies comunes conservan
reflow sin overflow de pagina. No modifica backend, rutas, base, permisos,
tenant ni reglas comerciales. P7E y P8 no estan iniciados.

P7E completa el refinamiento visual final de PRODUCTO-1. En Inicio conserva
las dos lecturas diarias sin cambiar datos, calculos ni consultas: el resumen
principal es **Ventas de los ultimos 5 dias** y la participacion diaria queda
como detalle expandible. Tambien normaliza la lectura de metricas y tablas con
los tokens existentes. UX-005 queda resuelto tras arnes browser local; no se
modifican backend, rutas, base, tenant, permisos ni reglas comerciales.

P8 cierra la regresion final de PRODUCTO-1 y el usuario robot TECH-026. El
recorrido local pasa 3/3 sobre datos sinteticos aislados y comprueba producto,
compra, venta, stock, cliente, credito, cobranza, devolucion, reportes, Mi plan
y tenant. El gate browser remoto tambien paso: run `31806746685`, job
`94787399829`, paso **Run critical browser business gate**. PRODUCTO-1 P1-P8
y TECH-026 quedan cerrados. WELCOME queda publicado con CI remoto PASS: run
`31808668518`, job `94793671745` y paso **Run critical browser business gate**
PASS.

WELCOME queda implementado en Inicio como una guia breve, opcional y retomable
para producto, stock y primera venta. No reemplaza el onboarding de
configuracion, no agrega rutas ni persistencia de negocio y no omite permisos,
limites ni modo solo lectura. El progreso se deriva de datos existentes y su
preferencia visual no contiene datos sensibles.

HELP queda implementado como Centro de ayuda interno, con busqueda local,
categorias de funciones existentes y articulos breves orientados a tareas. Los
enlaces contextuales de Ventas, Inventario, Clientes, Configuracion y Mi plan
abren el tema relacionado; el centro puede volver a mostrar WELCOME. No agrega
API, rutas backend, persistencia comercial, permisos ni dependencias. COMMERCE
y SECURITY-FINAL permanecen sin iniciar.

## 18. Roadmap posterior a HELP

HELP esta cerrado y publicado. La siguiente fase aprobada es `PRODUCT-GROWTH-0`,
seguida de `PILOT-READINESS`, revision del propietario #1, un entorno hospedado
minimo con datos sinteticos, validacion cloud y, solo con autorizacion expresa,
un piloto real de siete dias. La tienda de los padres es el primer negocio
propuesto para validacion, pero no se desplegara, contratara infraestructura ni
introduciran datos reales en esta fase documental.

PRODUCT-GROWTH medira eventos, funnels, activacion y retencion mediante un
adaptador desacoplado. PostHog es candidato inicial, no una decision de
proveedor; en local debe existir un proveedor desactivable o no-op, sin secretos
en frontend ni Session Replay inicial. La secuencia producto -> stock -> primera
venta es una hipotesis que se medira con activation rate, time to first sale,
D1, D7, D30 y su relacion con WELCOME.

PRODUCT-GROWTH-0A incorpora solo el fundamento desacoplado: plan central de
eventos, allowlist de propiedades de baja sensibilidad y adaptadores noop/memoria.
WELCOME y HELP emiten eventos UX locales sin red. Los eventos de negocio siguen
reservados para emisiones posteriores al commit exitoso; analytics no persiste,
no usa cookies y nunca puede interrumpir una operacion comercial.

PRODUCT-GROWTH-0B confirma que hoy la cancelacion de suscripcion es una accion
administrativa; el propietario solo puede cancelar solicitudes de pago. CHURN-001
queda resuelto documentalmente: el futuro flujo del propietario se expresara como
"No planeo renovar" o "No continuar con el servicio". Registrara una intencion,
motivo y comentario opcional, pero no cortara acceso, no modificara `fechaFin`,
gracia, suspension, plan, pagos ni datos. El acceso continua hasta `fechaFin` y
despues sigue el comportamiento actual `fechaFin -> gracia -> suspension` si no
hay renovacion.

La cancelacion administrativa sigue siendo independiente e inmediata segun su
contrato actual. `motivoTransicion` no se reutiliza para churn. La persistencia
futura sera tenant-safe, auditable, estructurada y separada, con estado de
intencion retirada si el propietario renueva; probablemente requerira una
estructura y migracion futuras. No se crea la migracion 025 y esta decision no
bloquea PRODUCT-GROWTH-0C ni PILOT-READINESS. `subscription_cancelled` permanece
sin emision hasta que exista un flujo semantico aprobado.

PRODUCT-GROWTH-0C1 instrumenta hechos confirmados despues del commit para
`account_registered`, `email_verified`, `store_configured`, `stock_registered`
mediante ajuste positivo idempotente y `sale_completed`. Replays y rollbacks no
emiten, el fallo del adaptador no altera el resultado comercial y las propiedades
no incluyen PII, tenant, IDs, montos ni cantidades. El proveedor sigue siendo
`noop`, sin red, cookies ni persistencia analytics. `product_created` permanece
pendiente porque la creacion actual no distingue de forma segura una operacion
nueva de un retry; no se cambia su contrato solo para analytics. PRODUCT-029
sigue siendo una hipotesis no validada y no existe un evento `aha_moment`.

PRODUCT-GROWTH-0C2 agrega `credit_sale_completed`, `collection_completed` y
`payment_request_created` unicamente despues del commit y usando las senales
canonicas de operacion nueva/replay. Una venta a credito confirma tanto
`sale_completed` como el hecho especifico de credito. La UI local registra
`plan_viewed` una vez por codigo publico mostrado y `quote_started` al iniciar
la accion, siempre sobre el provider `noop`. `customer_created` se difiere junto
con `product_created`: sus altas no distinguen retries de forma fiable y no se
modifica el contrato comercial para analytics. No se incluyen PII, tenant, IDs,
montos, saldos, referencias ni comprobantes; PostHog sigue siendo solo candidato,
TECH-028 permanece parcial: el alcance local esta cerrado, pero la medicion
remota, el proveedor y el control operativo siguen pendientes para beta/escala
y no bloquean el primer piloto.

PRODUCT-GROWTH-0 queda cerrado dentro de su alcance local y desacoplado. El
contrato central, la allowlist, los adaptadores `noop` y memoria de pruebas, el
aislamiento de fallos y los eventos UX y de negocio confirmados quedan
disponibles sin PII, tenant, IDs, montos, red, cookies ni proveedor analytics
activo. CHURN-001 queda resuelto documentalmente con la semantica de no
renovacion; su persistencia propia se difiere y no se crea la migracion 025.
Este cierre no afirma medicion remota, Session Replay, activation rate, Aha ni
retencion D1/D7/D30, y no contiene resultados de usuarios reales.

Tambien quedan registrados el futuro flujo de churn sin dark patterns y
`SEO-001` para metadata y descubrimiento publico. Render y Aiven ya existen y
fueron auditados parcialmente; R2, Resend y PostHog siguen sin decision ni
integracion. La validacion del entorno sintetico no autoriza gasto adicional ni
un lanzamiento, y STAGING-2B sigue siendo una etapa posterior y mas estricta.

Secuencia aprobada: HELP cerrado -> PRODUCT-GROWTH-0 (cerrado en alcance local) -> PILOT-READINESS ->
revision del propietario #1 -> entorno hospedado con datos sinteticos -> pruebas
cloud -> piloto real 7 dias -> reconciliacion y retrospectiva -> correcciones o
segundo piloto -> COMMERCE -> Landing / SEO / metadata -> SECURITY-FINAL ->
escala y resiliencia -> operacion/legal/soporte -> revision del propietario #2 ->
beta 3-10 tiendas -> analisis beta -> `v1.0.0` / lanzamiento. Esta secuencia no
inicia ninguna fase por si sola.

Para `PILOT_READY` bloquean: cero criticos conocidos; E2E critico; evidencia de
CI y gates requeridos; security review especifica del piloto; backup; restore
probado; integridad de ventas y dinero; integridad de stock; integridad de
credito y cobranzas; y entorno hospedado sintetico validado antes de introducir
datos reales. Tambien se requiere autorizacion explicita del propietario.
PostHog, el proveedor analytics remoto, la medicion de PRODUCT-029,
`product_created`, `customer_created`, Session Replay y la persistencia
self-service de churn no son blockers de `PILOT_READY`; siguen pendientes para
beta/escala.

### PILOT-READINESS-1 — auditoria local

La auditoria local de PILOT-READINESS-1 queda en PASS para los gates que pueden
probarse sin infraestructura externa: cero criticos conocidos; E2E critico;
security review especifica del piloto; backup; restore; ventas/dinero; stock; y
credito/cobranzas. La evidencia conservada es E2E PASS, security piloto con
CRITICAL 0 / HIGH 0, `BACKUP_OK`, restore sobre base temporal con 64 tablas, 24
migraciones y 174 FKs, y suites locales de integridad PASS.

| Gate | Estado |
| --- | --- |
| Criticos conocidos | PASS |
| E2E critico | PASS |
| CI/gates remotos | PASS |
| Security review del piloto | PASS |
| Backup | PASS (`BACKUP_OK`) |
| Restore | PASS (64 tablas, 24 migraciones, 174 FKs) |
| Ventas/dinero | PASS local |
| Stock | PASS local |
| Credito/cobranzas | PASS local |
| Entorno hospedado sintetico | `PENDING_EXTERNAL_STAGE` |
| Autorizacion de datos reales | `PENDING_OWNER_AUTHORIZATION` |

El gate CI remoto queda confirmado por el run `32402037197` del workflow `CI`,
evento `push`, sobre el commit `92ad8d8c546e1f6057faee4d9b361613bc336a9a`.
El job `Node 20 / MySQL 8` (`96532261093`) termino en success, incluido
`Run critical browser business gate`, schema 001-024, integration suite,
static security checks, workflow/isolation/config contracts y cleanup.

Este resultado no declara `PILOT_READY` ni equipara pruebas locales con
validacion cloud. PostHog, analytics remoto, PRODUCT-029, `product_created`,
`customer_created`, Session Replay y churn persistente no bloquean el primer
piloto.

### PILOT-READINESS-2 — auditoria segura de infraestructura existente

El 2026-08-24 se realizo una auditoria de solo lectura, sin inspeccionar ni
registrar valores secretos. Render tiene un unico Web Service publico con HTTPS,
desplegado desde `main`, auto-deploy habilitado, sin health check y en plan Free
sin disco persistente ni garantia de actividad continua; por ello no es apto
todavia para el piloto real. Aiven tiene un unico MySQL 8.4 en ejecucion, de un
nodo y plan gratuito de 1 GB, con TLS obligatorio, backups administrados y
acceso publico con allowlist abierta. No se observo Redis/Valkey. Render esta en
Oregon y Aiven en San Francisco, una observacion de latencia y arquitectura, no
un fallo automatico.

El entorno hospedado sintetico sigue en `PENDING_EXTERNAL_STAGE`. Antes de
validarlo se debe cerrar el contrato tecnico: desplegar desde la rama autorizada
de staging, restringir red de MySQL, disponer de Redis/Valkey TLS, definir
storage privado persistente o confirmar que no se usa, configurar health check,
probar backup/restore remoto con datos sinteticos, resolver limites/suspension y
facturacion del plan Free, decidir la alineacion regional y mantener solo datos
sinteticos. Luego siguen las pruebas cloud; el piloto real de siete dias y la
autorizacion de datos reales permanecen posteriores.

El contrato tecnico ejecutable queda documentado en
`docs/CONFIGURACION_STAGING.md`. Deriva del codigo que Redis/Valkey se usa solo
como rate limit distribuido y que las sesiones permanecen en MySQL; tambien
delimita el storage privado de comprobantes, health, red, backup/restore y los
criterios objetivos de `entorno hospedado sintetico listo`. Su documentacion no
provisiona ni valida recursos externos.
