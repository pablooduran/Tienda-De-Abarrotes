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

## SECURITY-2 futuro

Antes de cambiar experiencia de seguridad o abrir nuevas superficies, SECURITY-2 auditara autenticacion, sesiones, regeneracion/rotacion, logout e invalidacion, cookies, rate limits, politica y hashing de contrasenas, recuperacion, verificacion de correo, superadmin, operaciones sensibles y logging de autenticacion.

Luego evaluara estado de seguridad de cuenta, sesiones activas/revocacion, reautenticacion, MFA, TOTP/passkeys, codigos de recuperacion, blocklist de contrasenas con privacidad, fortalecimiento de rate limits, politica moderna, evolucion segura de hashing, resistencia a enumeracion y auditoria de eventos. No se asume email OTP como MFA principal, no se agregan JWT sin necesidad demostrada y no se guardan tokens en `localStorage`.

COMMERCE sigue separado. SECURITY-2 revisara toda superficie de autenticacion que COMMERCE agregue antes de pruebas finales.

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

Cada bloque declarara archivos, contratos, pruebas, fixtures, procesos y limpieza. Ninguno inicia WELCOME, HELP, COMMERCE o SECURITY-2 sin autorizacion separada.

## Decisiones aun pendientes

- Detalle visual de familias, iconografia, colores y marca.
- Alcance exacto del centro de Configuracion y su orden de migracion visual.
- Momento de implementar la busqueda escalable de clientes en POS.
- Capacidades bloqueadas que aportan valor al mostrarse contextualmente.
- Secuencia entre PRODUCTO-1, WELCOME, HELP y SECURITY-2.
- STAGING-2B, proveedor, topologia y gasto externo siguen diferidos.

## Secuencia aprobada de fases futuras

PRODUCTO-1 P1-P8 -> WELCOME -> HELP -> COMMERCE -> SECURITY-2 -> pruebas
completas finales -> revision final del propietario -> STAGING-2B -> pruebas
reales -> decision de beta/lanzamiento.

Esta secuencia es una guia de dependencias y no inicia ninguna fase posterior.
