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
| P7A - Base de diseno del producto | Guia Operate, tokens, vocabulario, auditoria base y skill de revision | Redisenos profundos, branding definitivo y cambios de comportamiento |
| P7B-P7E - Responsive, accesibilidad y branding | Aplicacion y validacion transversal de la guia aprobada | Marca completa y nuevas reglas comerciales |
| P8 - Regresion de producto | Browser, accesibilidad, tenant, seguridad y limpieza | Funcionalidades nuevas |

Cada bloque declarara archivos, contratos, pruebas, fixtures, procesos y limpieza. Ninguno inicia WELCOME, HELP, COMMERCE o SECURITY-FINAL sin autorizacion separada.

### Estado de P1

P1 implementa la navegacion agrupada del propietario con las familias Inicio,
Ventas, Inventario, Clientes, Reportes, Administracion y configuracion, y Mi
plan. Conserva los destinos, guards de funcionalidades y rutas existentes; la
etiqueta visible de `compensaciones` pasa a `Devoluciones y anulaciones`. El
superadmin conserva `admin.html` y su navegacion global separada. P1 esta
cerrado.

### Estado de P2

P2 implementa patrones compartidos para mensajes seguros, skeletons, estados
vacios, mutaciones y filtros compactos, con foco visible, touch y
`prefers-reduced-motion`. Se demuestra en cargas y formularios existentes sin
cambiar consultas ni reglas de negocio. P3 cerro la experiencia de Inventario;
los rediseños profundos de Ventas, Clientes, Configuracion, Suscripcion y
Superadmin quedan fuera de P2.

### Estado de P3

P3 implementa la familia visual de Inventario sin cambiar reglas de stock,
compras, lotes, trazabilidad, permisos ni contratos. Productos es el punto de
entrada con la accion primaria **Agregar producto**; las acciones secundarias
se agrupan con nombres concretos. Movimientos aclara que es un historial,
Compras ordena el flujo proveedor-productos-confirmacion y Proveedores se
presenta como parte del abastecimiento. Inteligencia, lotes y conciliacion
reutilizan filtros compactos, skeletons, estados vacios y mensajes seguros.
P4 no estaba iniciado al cerrar P3.

### Estado de P4

P4 implementa una experiencia comercial mas clara sin alterar calculos, precios,
pagos, compensaciones ni contratos del backend. Punto de venta conserva la venta
como accion principal y reemplaza la carga completa de clientes por una busqueda
con debounce, paginada y accesible; el tenant se sigue derivando exclusivamente
de la sesion. Historial de ventas, Cobranza y Devoluciones y anulaciones
permanecen en el mismo ciclo visual, con acciones secundarias agrupadas.
Clientes reutiliza los filtros compactos, skeletons, estados vacios y mensajes
seguros de P2.

La busqueda POS no envia `idTienda`, no carga el catalogo completo de clientes y
mantiene la seleccion opcional de cliente para ventas al contado. La paginacion,
el limite maximo y la consulta por tenant se validan en backend. P4 esta
cerrado. P5 no incluye roles, secretos, pagos, planes, infraestructura ni una
segunda auditoria; P5 esta cerrado.

## Decisiones aun pendientes

- Detalle visual de familias, iconografia, colores y marca.
- Alcance exacto del centro de Configuracion y su orden de migracion visual.
- Diseno exacto de futuras sugerencias avanzadas para la busqueda POS.
- Capacidades bloqueadas que aportan valor al mostrarse contextualmente.
- Secuencia entre PRODUCTO-1, WELCOME, HELP, COMMERCE y SECURITY-FINAL.
- STAGING-2B, proveedor, topologia y gasto externo siguen diferidos.

## Secuencia aprobada de fases futuras

PRODUCTO-1 P1-P8 -> WELCOME -> HELP -> COMMERCE -> SECURITY-FINAL -> pruebas
completas finales -> revision final del propietario -> STAGING-2B -> pruebas
reales -> decision de beta/lanzamiento.

Esta secuencia es una guia de dependencias y no inicia ninguna fase posterior.

### Estado de P5

P5 incorpora un centro de **Configuracion** dentro de Administracion y
configuracion para el propietario. Reutiliza el contrato de onboarding y solo
permite editar nombre mostrado, moneda BOB, zona horaria America/La_Paz,
telefono, direccion y dato fiscal basico. El tenant se deriva de la sesion,
las mutaciones son transaccionales y la vista respeta el modo solo lectura.
No incluye roles, secretos, pagos, planes, infraestructura ni una segunda
auditoria. P5 esta cerrado.

### Estado de P6

P6 ordena visualmente **Mi plan** y la administracion SaaS sin cambiar el motor
de suscripciones ni pagos. El propietario ve plan actual, estado en lenguaje
claro, fecha relevante, limites, capacidades resumidas y el flujo manual
existente para renovar, reactivar o cambiar a un plan superior. El catalogo de
planes de propietario se limita a Basico, Standard y Pro: el plan legado
avanzado no se publica como opcion.

La superficie de superadmin continua separada en `admin.html`. Agrupa tiendas,
suscripciones, pagos manuales y control administrativo; las acciones poco
frecuentes se concentran en **Mas opciones** y las acciones sensibles conservan
su confirmacion y trazabilidad. P6 no altera tenant, permisos, limites,
snapshots, precios, tasa, comprobantes ni la aplicacion atomica de pagos. Queda
implementado y cerrado. P7A crea la base formal de diseno sin modificar sus
pantallas; P7B-P7E y P8 no estan iniciados.

### Estado de P7A

P7A incorpora `DESIGN.md` como guia estable del producto y la skill
`$product-design-review` para revisar una superficie segun tarea, jerarquia,
copy, estados, responsive, accesibilidad y casos limite. La guia formaliza el
modo Operate, reutiliza los tokens actuales, define vocabulario de componentes,
acciones y antipatrones, y deja una auditoria base de acceso, onboarding,
Inicio, POS, Inventario, Clientes, Configuracion, Mi plan y superadmin.

No cambia HTML, CSS, JavaScript, rutas, permisos, tenant, planes, pagos o
logica comercial. P7B-P7E y P8 siguen pendientes.

### Estado de P7B

P7B aplica la primera critique transversal con `DESIGN.md` sobre Inicio, POS,
Inventario, Clientes, Configuracion, Mi plan y superadmin. No hubo hallazgos
P0. Corrige la jerarquia de Inicio y Mi plan, normaliza copy operativo de
cierre y guardado, y agrupa en **Mas opciones** las acciones administrativas
poco frecuentes o destructivas. Mantiene handlers, rutas, permisos, tenant,
planes, pagos y logica comercial.

El duplicado visual de las dos lecturas del periodo diario en Inicio queda como
UX-005 para P7E: requiere una decision de jerarquia analitica, no un cambio de
datos. P7C-P7E y P8 siguen pendientes.

### Estado de P7C

P7C revisa login, onboarding, Inicio, POS, Inventario, Clientes,
Configuracion, Mi plan y superadmin en los tres viewports acordados. No
encuentra P0. Corrige la semantica, foco inicial y retorno de foco de los
dialogos de configuracion, ajuste, motivo y gasto, restaura foco tras guardar
un producto,
normaliza foco visible para enlaces y resumenes, y aplica reduced motion a las
transiciones no esenciales. No cambia rutas, APIs, permisos, tenant, planes ni
logica comercial. P7D, P7E y P8 siguen pendientes.

### Estado de P7D

P7D endurece la presentacion ante contenido extenso, tablas amplias, filtros
sin resultados, estados vacios, errores seguros, red lenta simulada y clics
repetidos. Las mutaciones anuncian `aria-busy` mientras permanecen bloqueadas;
las superficies compartidas pueden partir cadenas largas sin ensanchar la
pagina. Los arneses locales cubren POS, Inventario, Clientes, Configuracion,
Mi plan y Superadmin con datos sinteticos, sin modificar contratos, tenant,
permisos ni logica comercial. UX-005 se mantiene para P7E; TECH-026 permanece
para P8. P7E y P8 no estan iniciados.

### Estado de P7E

P7E completa el polish visual de PRODUCTO-1 sin alterar logica comercial ni
contratos. En Inicio, **Ventas de los ultimos 5 dias** queda como resumen
principal y la participacion por dia permanece disponible en **Ver detalle del
periodo**. Ambas lecturas conservan sus datos y calculos; solo cambia su peso
visual. Se normalizan cifras de metricas y encabezados de tabla para mejorar la
lectura operativa. UX-005 queda resuelto en P7E tras validacion browser local.

### Estado de P8

P8 incorpora `test:e2e-critical-business`, un recorrido hibrido de propietario
que usa browser para login, Productos, POS, Clientes, historial y Mi plan, y
HTTP/DB de prueba para preparar datos y comprobar invariantes. Sobre una base
temporal 001-024 valida producto, proveedor, compra, venta, stock, cliente,
credito, cobranza, devolucion, reportes, suscripcion y aislamiento entre dos
tenants. El recorrido paso tres ejecuciones consecutivas y limpia base,
servidor y navegador propios.

El flujo completo de comprobante, revision y aplicacion de pagos conserva su
cobertura especializada C2-C6; el robot critico valida Mi plan, catalogo
publico y disponibilidad de cotizacion, sin afirmar que esa administracion se
realiza enteramente por clicks. El workflow incorpora el robot como gate
browser portable y este paso en remoto: run `31806746685`, job `94787399829`,
**Run critical browser business gate** PASS. TECH-026 queda resuelto y
PRODUCTO-1 P1-P8 cerrado. WELCOME y HELP pueden comenzar; COMMERCE y
SECURITY-FINAL no se inician.

### Estado de WELCOME

WELCOME agrega una guia opcional y retomable dentro de **Inicio**, separada del
onboarding de configuracion. Conduce a la primera secuencia operativa:
**producto -> stock -> primera venta**. El progreso se infiere de productos,
existencias y ventas ya disponibles; `Ahora no` solo guarda una preferencia
visual namespaced por usuario y tienda, sin datos sensibles ni IDs internos.

Los CTA reutilizan Productos, Compras y Punto de venta. Una cuenta en modo solo
lectura puede consultar el progreso, pero no recibe acciones activas. Las
pruebas Welcome cubren progreso, salto, retomar, tienda existente, teclado,
responsive y consola sin duplicar el E2E critico. WELCOME queda publicado con
CI remoto PASS: run `31808668518`, job `94793671745` y paso **Run critical
browser business gate** PASS.

### Estado de HELP

HELP queda implementado como un **Centro de ayuda** integrado y buscable, con
temas breves sobre las funciones existentes. La entrada global no compite con
los modulos operativos; los enlaces contextuales desde Ventas, Inventario,
Clientes, Configuracion y Mi plan enfocan el tema correspondiente. La guia
WELCOME se reutiliza desde el centro sin duplicar su checklist. HELP no agrega
rutas, backend, datos comerciales ni permisos. COMMERCE y SECURITY-FINAL siguen
pendientes.
