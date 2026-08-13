# PRODUCTO-0B - Decisiones del propietario

## Proposito y limite

Este documento fija la direccion de PRODUCTO-1 sin implementar pantallas, rutas, servicios, migraciones ni reglas comerciales.

Se preservan tenant, permisos, suscripcion, funcionalidades, CSRF, rate limiting, auditoria, idempotencia y transacciones. El frontend no decide el tenant ni sustituye al backend.

## Decisiones aprobadas

1. Reagrupar la navegacion del propietario y retirar el menu plano de 18 destinos, sin eliminar capacidades.
2. Usar la etiqueta visible `Devoluciones y anulaciones` para compensaciones, sin renombrar servicios o contratos internos si añade riesgo.
3. Evitar `Eliminar` generico: usar `Anular`, `Desactivar`, `Ocultar`, `Cancelar` o `Eliminar` solo ante borrado real autorizado.
4. Crear un centro comun de Configuracion que reagrupe ajustes existentes, sin crear ajustes ni permisos nuevos.
5. Unificar Ventas: Nueva venta/POS, Historial, Credito y cobranza, y Devoluciones y anulaciones.
6. Mostrar capacidades bloqueadas por plan solo de forma contextual y discreta; no llenar navegacion ni exponer rutas no autorizadas.
7. Disenar busqueda de clientes escalable en POS con busqueda, autocompletado y paginacion; no cargar innecesariamente todos los clientes.

## Mapa objetivo del propietario

| Familia | Contenido actual | Regla |
| --- | --- | --- |
| Inicio | Resumen, alertas y proximas acciones | Orienta sin sustituir reportes. |
| Ventas | POS, historial, credito/cobranza, devoluciones/anulaciones | Mantiene contratos financieros y de compensacion. |
| Inventario | Productos, movimientos, compras, inteligencia, conciliacion y lotes | Distingue catalogo, abastecimiento y control. |
| Clientes | Perfiles, estados de cuenta, seguimiento y mensajes manuales | No es un portal de compradores. |
| Reportes | Finanzas, gastos, caja, reportes y exportaciones permitidas | Separa control diario, analisis y trazabilidad. |
| Administracion / Configuracion | Ajustes existentes y auditoria de tienda | No crea configuraciones nuevas. |
| Mi plan | Suscripcion, limites, vigencia, cotizacion y pagos manuales | Conserva politicas B3 y SAAS-C. |

El superadmin conserva una navegacion distinta: tiendas, suscripciones SaaS, pagos manuales, catalogo maestro y auditoria global. No se mezclan acciones globales con la operacion de una tienda.

## Principios UX globales

### Acciones

- Una accion principal visible por contexto. Las secundarias pueden vivir en `Mas opciones`, menu contextual, drawer, modal o seccion desplegable.
- Evitar filas de botones equivalentes. La jerarquia separa accion frecuente y excepcional.
- `Guardar` persiste; `Continuar` avanza; `Confirmar` ejecuta una accion sensible explicada; `Cancelar` abandona sin cambios; `Volver` retorna al contexto previo.
- Las acciones destructivas se diferencian y piden confirmacion cuando aplica.

### Filtros

- Los listados complejos concentran busqueda, estado, fechas, categorias, orden y filtros propios en panel, modal o drawer.
- Los filtros activos se ven con claridad y existe `Limpiar filtros`.
- La interfaz no modifica allowlists, limites de pagina ni validacion del backend.

### Carga, errores y estados vacios

- Usar skeleton loading para dashboards, tablas, tarjetas, listados y primera carga de contenido.
- Una mutacion conserva su accion: se deshabilita, indica `Guardando...` o `Procesando...`, evita doble envio y termina con resultado contextual.
- Los errores son comprensibles y accionables; nunca muestran SQL, stack, rutas internas, excepciones crudas, secretos o identificadores sensibles.
- Un estado vacio explica que falta, por que importa y la siguiente accion disponible; muestra CTA solo si se puede ejecutar.

### Responsive, accesibilidad y branding

- Los viewports obligatorios son `360x800`, `768x1024` y `1366x768`.
- Controles utilizables sin hover, foco visible, teclado, nombre accesible y dialogs con retorno de foco. Las tablas complejas conservan alternativa movil.
- Sustituir el favicon generico por uno propio y preparar coherencia futura de favicon, logo y nombre mostrado. No se define marca completa en este bloque.

## WELCOME y HELP diferidos

WELCOME debe ofrecer onboarding contextual corto, pasos ordenados, siguiente accion evidente y posibilidad de omitir o retomar. HELP debe aportar ayuda contextual y centro de soporte sin saturar el primer uso. Ambos dependen de la navegacion aprobada y no se inician aqui.

## SECURITY-FINAL - auditoria y endurecimiento integral previo a lanzamiento

SECURITY-FINAL sustituye el pendiente conceptual SECURITY-2. Se ejecutara
despues de PRODUCTO-1, WELCOME, HELP y COMMERCE, antes de las pruebas finales y
de cualquier beta. Esta fase sigue pendiente y no se inicia con PRODUCTO-0B.

La auditoria cubrira autenticacion y login (fuerza bruta, credential stuffing,
password spraying, rate limits, throttling progresivo, bloqueos temporales,
proteccion de cuenta y origen, recuperacion, enumeracion, verificacion de
correo, politica de contrasenas, contrasenas comprometidas y superadmin). Los
umbrales exactos se decidiran y probaran en SECURITY-FINAL; no se asumira un
bloqueo permanente despues de tres intentos. Tambien evaluara MFA/TOTP,
passkeys y codigos de recuperacion como opciones futuras, sin introducirlos
ahora.

Revisara sesiones y cookies: regeneracion al autenticar o cambiar privilegios,
expiracion, revocacion, logout, fijacion o secuestro, sesiones concurrentes y
reautenticacion para operaciones sensibles. No se agregaran JWT sin necesidad
demostrada.

La cobertura incluira autorizacion y tenant (IDOR, bypass entre tiendas,
escalamiento horizontal o vertical, manipulacion de IDs y limites de plan),
seguridad web (SQLi, XSS, CSRF, traversal, uploads, SSRF cuando aplique,
redirects, headers, CSP, CORS, origen y errores seguros), datos (stores,
clientes, usuarios, comprobantes, sesiones, backups, logs, secretos,
transporte, restauracion y aislamiento), y logica de negocio (ventas,
inventario, devoluciones, pagos, suscripciones, concurrencia, replay,
idempotencia y doble submit).

Tambien se revisaran dependencias directas y transitivas, `npm audit`,
ExcelJS/uuid, scripts, configuracion, secretos embebidos, archivos sensibles,
permisos del repositorio, ramas, protecciones, GitHub Actions, artefactos,
caches, variables y ejecuciones no confiables. Las pruebas ofensivas seran
controladas y solo usaran local, bases temporales, datos sinteticos y storage
de prueba; nunca terceros ni datos reales.

Cada hallazgo registrara evidencia, reproduccion, impacto, correccion, prueba
de regresion y estado final, con severidad critica, alta, media o baja. La
salida exigira cero criticos abiertos, altas corregidas o bloqueo explicito del
lanzamiento, validacion de autenticacion, tenant, datos, codigo, repositorio y
CI, y una regresion final de seguridad.

COMMERCE sigue separado, pero toda superficie de autenticacion que agregue
debera quedar incluida en esta auditoria antes de las pruebas finales.

## Bloques propuestos para PRODUCTO-1

| Bloque | Alcance verificable | Excluye |
| --- | --- | --- |
| P1 - Navegacion y estructura | Familias de navegacion y guards preservados | Dominio o permisos |
| P2 - Patrones UX | Acciones, filtros, carga, errores, vacios y confirmaciones | Reglas financieras o de suscripcion |
| P3 - Inventario | Productos, compras, stock, inteligencia, conciliacion y lotes | Calculos o trazabilidad de stock |
| P4 - Ventas y clientes | POS, historial, credito/cobranza, devoluciones y busqueda escalable | Precios, pagos o compensaciones sin contrato |
| P5 - Configuracion | Centro que enlace ajustes existentes | Ajustes o roles nuevos |
| P6 - Suscripcion y superadmin | Mi plan, capacidades contextuales y administracion ordenada | Pagos automaticos o cambios de plan |
| P7 - Responsive, accesibilidad y branding | Validacion transversal, favicon e identidad minima | Marca completa |
| P8 - Regresion de producto | Browser, accesibilidad, tenant, seguridad y limpieza | Funcionalidades nuevas |

Cada bloque declarara archivos, contratos, pruebas, fixtures, procesos y limpieza. Ninguno inicia WELCOME, HELP, COMMERCE o SECURITY-FINAL sin autorizacion separada.

### Estado de P1

P1 implementa la navegacion agrupada del propietario con las familias Inicio,
Ventas, Inventario, Clientes, Reportes, Administracion y configuracion, y Mi
plan. Conserva los destinos, guards de funcionalidades y rutas existentes; la
etiqueta visible de `compensaciones` pasa a `Devoluciones y anulaciones`. El
superadmin conserva `admin.html` y su navegacion global separada. P1 esta
implementado y pendiente de validacion/cierre; P2 no esta iniciado.

### Estado de P2

P2 implementa patrones compartidos para mensajes seguros, skeletons, estados
vacios, mutaciones y filtros compactos, con foco visible, touch y
`prefers-reduced-motion`. Se demuestra en cargas y formularios existentes sin
cambiar consultas ni reglas de negocio. P3 no esta iniciado; los rediseños
profundos de Inventario, Ventas, Clientes, Configuracion, Suscripcion y
Superadmin quedan fuera de P2.

## Decisiones aun pendientes

- Detalle visual de familias, iconografia, colores y marca.
- Alcance exacto del centro de Configuracion y su orden de migracion visual.
- Momento de implementar la busqueda escalable de clientes en POS.
- Capacidades bloqueadas que aportan valor al mostrarse contextualmente.
- Secuencia entre PRODUCTO-1, WELCOME, HELP, COMMERCE y SECURITY-FINAL.
- STAGING-2B, proveedor, topologia y gasto externo siguen diferidos.

## Secuencia aprobada de fases futuras

PRODUCTO-1 P1-P8 -> WELCOME -> HELP -> COMMERCE -> SECURITY-FINAL -> pruebas
completas finales -> revision final del propietario -> STAGING-2B -> pruebas
reales -> decision de beta/lanzamiento.

Esta secuencia es una guia de dependencias y no inicia ninguna fase posterior.
