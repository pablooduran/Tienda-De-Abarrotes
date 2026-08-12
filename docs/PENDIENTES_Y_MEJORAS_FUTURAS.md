# Pendientes y mejoras futuras

## 1. Proposito

Este documento es la fuente central de los elementos que fueron dejados
deliberadamente para despues. Registra funciones futuras, mejoras, decisiones,
integraciones, pruebas y condiciones de lanzamiento.

Un elemento listado aqui no esta implementado por el solo hecho de aparecer en
el documento. Tampoco representa una promesa de lanzamiento. Cada pendiente
debe actualizarse al cerrar una fase y revisarse antes de una beta y antes del
lanzamiento oficial.

Estado de referencia actualizado al cierre de SAAS-C:

- Rama: `mejora-multitienda`.
- Base del cierre: HEAD `daf4677`.
- SAAS-A, SAAS-B y SAAS-C0-C7 cerrados y publicados.
- SAAS-C8 corresponde a este cierre integral de pagos manuales, sin nueva
  migracion.
- Base local validada en migracion 024; la siguiente macrofase es seguridad
  publica final.
- Este documento no implementa funcionalidad ni modifica la base.

## 2. Estados y prioridades

Estados permitidos:

- `pendiente`: identificado y aun no iniciado.
- `en analisis`: requiere definicion tecnica o comercial.
- `aprobado para fase futura`: alcance aceptado, sin implementacion iniciada.
- `requiere decision del propietario`: bloqueado por una decision de negocio.
- `descartado`: no se continuara con el elemento en su forma actual.
- `reemplazado`: sustituido por otro contrato o enfoque.
- `implementado`: cerrado con evidencia y referencia de commit.

Prioridades:

- critica antes de pruebas finales;
- alta antes de beta;
- media antes del lanzamiento oficial;
- baja;
- futura o experimental.

## 3. Registro maestro

Cada fila conserva el ID para que una decision posterior no borre la historia.
Las migraciones son posibilidades; ninguna se crea por estar mencionada aqui.

| ID | Nombre | Origen / motivo del aplazamiento | Prioridad | Dependencias e impacto | Migracion posible | Decision / estado | Fase sugerida |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TECH-001 | SAAS-C2 cotizacion y solicitud | C1 dejo estructura persistente y C1.1 corrigio idempotencia/snapshot | alta | precio, tasa valida, metodo configurado; introduce flujo financiero | 024 resolvio la brecha previa | Implementado y cerrado | SAAS-C2 |
| TECH-002 | SAAS-C3 comprobantes y storage privado | C1 conserva solo metadata, sin binario ni rutas publicas | alta | almacenamiento privado, MIME, hash, retencion y restauracion | No determinada | Implementado; retencion operativa requiere decision | SAAS-C3 |
| TECH-003 | SAAS-C4 revision administrativa | C1 creo tablas, pero no cola ni decisiones operativas | alta | superadmin, auditoria, permisos y concurrencia | No determinada | Implementado y cerrado | SAAS-C4 |
| TECH-004 | SAAS-C5 aplicacion a suscripcion | C1 prepara el enlace unico, sin efecto B2/B4 | critica antes de pruebas finales | transaccion unica, idempotencia, historial y rollback | No determinada | Implementado y cerrado | SAAS-C5 |
| TECH-005 | SAAS-C6-C8 frontend, regresion y cierre | C1 solo valido esquema y compatibilidad | alta | C2-C5, tenant, seguridad, browser y backup | No determinada | Implementado y cerrado | SAAS-C6-C8 |
| TECH-006 | Seguridad publica final | Las fases A validaron el flujo local; correo real y despliegue quedan fuera | alta antes de beta | proveedor de correo, rate limits, monitoreo y secretos | No determinada | En analisis | Pre-beta |
| TECH-007 | CI y GitHub Actions | No hay pipeline remoto configurado | alta antes de beta | secretos de CI, MySQL temporal, checks y artefactos | No | Pendiente | Pre-beta |
| TECH-008 | Staging y produccion de prueba | El proyecto no tiene despliegue de este estado | alta antes de beta | dominio, HTTPS, TLS, backup y datos sinteticos | No | Pendiente; no usar tiendas reales todavia | Pre-beta |
| TECH-009 | Backups externos y restauracion operativa | Los backups actuales son locales y manuales | alta antes de beta | cifrado/almacenamiento seguro, retencion, rollback y prueba periodica | No determinada | En analisis | Pre-beta |
| TECH-010 | Monitoreo, alertas y logging seguro | Health local existe; no hay proveedor externo ni metricas persistentes | alta antes de beta | privacidad, alertas, on-call y costos | No | Pendiente | Pre-beta |
| TECH-011 | Roles internos | Solo existen `superadmin` y `dueno_tienda` | alta antes de beta | permisos, invitaciones, sesiones, limites y auditoria | Probable nueva estructura de roles | Requiere decision del propietario; pendiente | SAAS futuro |
| TECH-012 | Editor seguro de planes | Los planes, precios y funcionalidades requieren gobierno versionado | media | superadmin, snapshots, auditoria y no retroactividad | Posible versionado adicional | Pendiente | SAAS futuro |
| TECH-013 | Cambio definitivo de precios y limites | Los valores C1 son provisionales | alta antes de lanzamiento | moneda, periodos, snapshot y comunicacion comercial | C1 ya deja estructura; revisar si hace falta otra | Requiere decision del propietario | SAAS futuro |
| TECH-014 | Fuente operativa USD/BOB | C1 permite carga manual, sin tasa sembrada ni API | alta antes de solicitudes cobrables | vigencia, precision, redondeo, fallback y auditoria | C1 ya contiene versionado | Requiere decision del propietario | SAAS-C2 |
| TECH-015 | Pagos automaticos | C1 excluye tarjetas, webhooks y cobro recurrente | futura | proveedor, cumplimiento, conciliacion y sesiones | Por determinar | Diferido | SAAS-C posterior |
| TECH-016 | Producto visual PRODUCTO-0 | El rediseño general no se incluyo en SAAS-A/B/C1 | media antes de beta | inventario de pantallas, lenguaje visual y pruebas de usabilidad | No | Propuesta de trabajo; en analisis | PRODUCTO-0 |
| TECH-017 | UX y accesibilidad transversal | Las fases validaron pantallas afectadas, no una auditoria visual global | media antes de beta | navegacion, foco, contraste, movil y textos | No | Pendiente | PRODUCTO-0 |
| TECH-018 | WELCOME y tutorial guiado | El onboarding inicial no cubre tutorial completo ni ayuda contextual | media antes de beta | copy, estados y soporte | No | Pendiente | WELCOME |
| TECH-019 | HELP y centro de soporte | No existe centro de ayuda integral ni flujo de soporte | media antes del lanzamiento | contenido, privacidad, operador y costos | No | Pendiente | HELP |
| TECH-020 | Cuentas de clientes compradores | El cliente actual es entidad comercial de tienda, no cuenta de comprador | media antes del lanzamiento | identidad, privacidad, tiendas y pedidos | Probable modelo nuevo | Requiere decision del propietario | COMMERCE |
| TECH-021 | Comercio entre compradores y tiendas | No existe catalogo publico, carrito ni pedido interno | futura | stock, precios, aceptacion, sustituciones, delivery y fraude | Probable varias tablas | Pendiente | COMMERCE-MVP |
| TECH-022 | WhatsApp automatico y chatbot | Hoy solo se prepara texto/enlace manual; no hay API, webhook ni chatbot | futura | consentimiento, costos, opt-out y proveedor | No determinada | Diferido | COMMERCE / SAAS futuro |
| TECH-023 | Facturacion fiscal | Existen comprobantes internos e imprimibles, no factura fiscal | alta antes del lanzamiento si aplica | normativa, impuestos, numeracion e integracion tributaria | Probable modelo fiscal | Requiere decision del propietario | Fiscal |
| TECH-024 | Pruebas de volumen y rendimiento | Las pruebas actuales son funcionales y aisladas | alta antes de beta | grandes catalogos, concurrencia, limites y observabilidad | No | Pendiente | Pre-beta |
| TECH-025 | Beta privada y lanzamiento | No se deben incorporar tiendas reales en este estado | critica antes de lanzamiento | staging, soporte, terminos, privacidad y checklist | No | Requiere decision del propietario | Lanzamiento |

## 4. Desarrollo tecnico pendiente

Quedan registrados como trabajo de plataforma, con evidencia en continuidad,
mapa de pruebas y estado de despliegue:

- SAAS-C esta cerrado; conservar su regresion al tocar pagos o suscripciones;
- endurecimiento y revision publica final antes de beta;
- CI y GitHub Actions con bases temporales protegidas;
- staging y produccion de prueba en localhost controlado primero;
- backups externos, almacenamiento cifrado, restauracion y rollback ensayados;
- monitoreo, alertas, metricas persistentes y logging seguro;
- runbooks de despliegue, migracion, restauracion y respuesta a incidentes;
- documentacion operativa y version `1.0.0`.

No se deben introducir jobs, proveedores externos ni produccion mientras no
exista un procedimiento aprobado y una decision del propietario.

## 5. UX, rediseño y accesibilidad

El rediseño transversal queda agrupado como `PRODUCTO-0`. Incluye:

- auditoria funcional de navegacion, menus, botones, formularios, tablas y
  filtros;
- textos, mensajes, confirmaciones, estados vacios y errores;
- sistema visual de iconos, colores, tipografia, espacios y componentes;
- accesibilidad de teclado, foco, etiquetas, contraste y lectores de pantalla;
- experiencia movil y revision de las pantallas del propietario;
- pantalla de bienvenida, tutorial guiado y ayudas contextuales;
- centro de soporte y pruebas de usabilidad antes de beta.

Estas tareas no implican que la interfaz actual sea inexistente: solo indican
que no se ha completado una auditoria visual y de usabilidad global.

## 6. Modulo de clientes y comercio

La propuesta se divide para no mezclarla con el cliente comercial actual:

- `COMMERCE-0`: modelo de identidad, privacidad, tiendas, ubicacion y
  reglas de catalogo.
- `COMMERCE-MVP`: catalogo publico, precios por tienda, stock visible,
  carrito, pedido interno, aceptacion/rechazo, sustituciones y recojo.
- `COMMERCE-A`: delivery, direccion, costo y estados de entrega.
- `COMMERCE-B`: notificaciones e historial.
- `COMMERCE-C`: favoritos y busqueda de tiendas cercanas.
- `COMMERCE-D`: prevencion de pedidos falsos y controles de privacidad.
- `COMMERCE-E`: WhatsApp opcional y consentimiento.
- `COMMERCE-F`: pagos futuros.
- `COMMERCE-G`: analitica operativa.
- `COMMERCE-H`: pruebas de escala y lanzamiento.

No existen aun cuentas de clientes compradores, ubicacion publica, carrito,
pedido, delivery ni pagos de comercio.

## 7. Usuarios internos y roles

Actualmente los roles principales son:

- `superadmin`: administracion global con contexto explicito para operar una
  tienda;
- `dueno_tienda`: propietario operativo de una tienda.

No existen todavia roles diferenciados `administrador`, `cajero` o
`encargado_inventario`. Quedan pendientes invitaciones, permisos detallados,
revocacion por usuario, auditoria por actor y limites por plan para esas
cuentas. La transicion debe preservar sesiones, aislamiento, `versionSesion` y
el historial existente.

## 8. Planes, precios y funcionalidades

La migracion 023 deja un catalogo estructural provisional:

| Plan | Precio mensual provisional | Limites provisionales |
| --- | --- | --- |
| Basic | USD 3 | 1 propietario, 500 productos, 25 clientes, 15 proveedores |
| Standard | USD 6 | 3 propietarios, 1200 productos, 70 clientes, 50 proveedores |
| Pro | USD 10 | ilimitados mediante la convencion vigente |

Periodos provisionales: mensual, trimestral a 2,75 mensualidades y anual a 10
mensualidades. Los precios versionados de C1 incluyen 1, 3 y 12 meses, pero
siguen siendo condiciones provisionales y no equivalen a una decision final de
lanzamiento.

`avanzado` es legado, no publico para nuevas contrataciones, y conserva sus
condiciones, relaciones, suscripciones y snapshots. No debe convertirse
automaticamente en Pro.

Quedan pendientes:

- editor administrativo seguro de planes, precios, limites y funcionalidades;
- versionado visible, activacion, orden y ocultamiento;
- matriz definitiva Basic/Standard/Pro;
- reglas de comunicacion y no retroactividad;
- revision de snapshots vigentes antes de cada cambio;
- politica para exceso de limites sin borrar datos.

Las funciones de seguridad, autenticacion, sesiones, auditoria, integridad,
recuperacion, aislamiento y respaldo no deben desactivarse como diferencia de
plan.

## 9. Tipo de cambio y pagos futuros

La referencia comercial es USD y el cobro previsto es BOB. C1 permite registrar
manualmente una tasa USD/BOB versionada, pero no contiene una tasa real ni una
API. Antes de C2 deben decidirse:

- fuente oficial o responsable de carga;
- precision, redondeo, vigencia y fecha efectiva;
- fallback y bloqueo cuando no exista una tasa valida;
- auditoria, revision contable y monto congelado por solicitud.

SAAS-C manual inicial queda separado de las mejoras futuras. Las siguientes
capacidades no estan implementadas:

- QR dinamico, confirmacion automatica, API bancaria y webhooks;
- conciliacion bancaria, tarjetas, tokenizacion y pasarela;
- cobro recurrente, avisos previos, reintentos, renovacion automatica,
  cancelacion, reversos y contracargos;
- promociones, cupones, impuestos complejos, multiples monedas y conversion
  automatica.

## 10. WhatsApp, mensajes y chatbot

Estado actual:

- existente: texto y enlace preparados manualmente, plantillas y acciones
  confirmadas por el usuario;
- parcial: recibos o mensajes preparados sin guardia independiente en todos
  los casos;
- futuro: WhatsApp Business, envio automatico, horarios, consentimiento,
  opt-out, costos, recordatorios automaticos, comprobantes automaticos y
  chatbot.

No existe chatbot, API oficial, webhook ni cobranza automatica por WhatsApp.

## 11. Facturacion y comprobantes

Hoy existen comprobantes internos e imprimibles de operaciones; no son factura
fiscal. Quedan pendientes, si el propietario lo requiere:

- personalizacion y envio manual de comprobantes internos;
- factura fiscal, integracion tributaria, impuestos y numeracion;
- requisitos legales, retencion y auditoria de documentos.

No llamar factura fiscal a una nota de venta, recibo o comprobante interno.

## 12. Funcionalidades parciales y futuras

La auditoria de planes identifica como parciales o sin guardia independiente:

- `dias_cobertura`;
- `pagos_multiples`;
- `recibos_whatsapp`;
- `vencimientos_lote`;
- `reportes_avanzados` como etiqueta que no debe tratarse como modulo
  operativo separado.

Como mejoras futuras quedan portal de clientes, mejoras de lotes, inteligencia
de inventario, alertas avanzadas, recomendaciones y automatizacion, siempre
contra contratos reales y pruebas de seguridad.

## 13. Catalogo maestro y proveedores

Quedan como linea de mejora del catalogo:

- flujo `Proveedor -> Empresa -> Marca -> Familia -> Subfamilia -> SKU`;
- deduplicacion, fuentes, importacion y catalogo acumulativo;
- codigos de barras, variantes, actualizacion y busqueda;
- productos compartidos y posible catalogo maestro nacional;
- sincronizacion segura con inventario, sin cruzar tenants.

La funcionalidad actual de catalogo e inventario no implica que exista un
catalogo nacional compartido ni integracion externa.

## 14. Infraestructura y lanzamiento

Antes de incorporar tiendas reales deben completarse, como minimo:

- staging aislado y produccion con dominio, HTTPS y TLS verificado;
- proveedor de correo real y almacenamiento privado cuando corresponda;
- backups externos, restauracion y rollback probados;
- monitoreo, alertas, soporte, terminos y privacidad;
- beta privada, luego beta publica, checklist de regresion y tag `v1.0.0`.

No se incorporaran tiendas reales todavia. No se lanzara una beta hasta terminar
la estructura necesaria, las mejoras acordadas, el rediseño y las pruebas. El
propietario revisara el sistema completo antes de decidir fecha y tipo de
lanzamiento.

## 15. Pruebas futuras

Registrar para las etapas correspondientes:

- carga, estres, rendimiento y grandes volumenes;
- restauracion, recuperacion y migracion desde versiones anteriores;
- multiples tiendas, concurrencia, tenant y seguridad;
- browser, accesibilidad, movil y usabilidad;
- pruebas manuales, regresion integral y checklist previo a beta;
- checklist de lanzamiento, backup, rollback, soporte y monitoreo.

Cada prueba debe declarar sus fixtures, procesos, puertos y limpieza en
`finally`, y nunca debe finalizar procesos ajenos.

## 16. Decisiones futuras del propietario

Estas decisiones no se deben inferir desde el catalogo provisional:

- precios y limites definitivos;
- funcionalidades por plan y plan legado;
- proveedor de pago y proveedor de correo;
- proveedor de WhatsApp;
- politica de retencion de comprobantes y datos;
- factura fiscal e impuestos;
- diseno visual, nombre comercial y dominio;
- modelo de soporte;
- modulo de clientes compradores;
- fecha y tipo de beta o lanzamiento.

## 17. Elementos descartados temporalmente

Se mantienen fuera del alcance actual, sin borrar su contexto:

- tarjetas, QR automatico y conciliacion bancaria en la primera version de
  SAAS-C;
- jobs y cron para pagos o vencimientos;
- chatbot y WhatsApp automatico;
- factura fiscal, promociones, cupones e impuestos complejos;
- lanzamiento anticipado;
- uso de clientes reales antes de terminar estructura, pruebas y revision del
  propietario.

Un elemento descartado temporalmente puede reabrirse solo con una decision
explicita y una nueva evaluacion de seguridad, datos y alcance.

## 18. Roadmap futuro sugerido

1. Ejecutar seguridad publica final.
2. Incorporar CI y GitHub Actions.
3. Preparar staging, restauracion, monitoreo y produccion de prueba.
4. Cerrar documentacion operativa, terminos, privacidad y soporte.
5. Ejecutar `PRODUCTO-0`, UX, `WELCOME` y `HELP`.
6. Resolver roles internos y mejoras funcionales priorizadas.
7. Definir y construir `COMMERCE-0` y `COMMERCE-MVP` si se aprueba.
8. Ejecutar pruebas completas de volumen, usabilidad, seguridad y recuperacion.
9. Realizar revision integral del propietario.
10. Decidir beta privada, beta publica y lanzamiento oficial.

## 19. Registro de cambios

| Fecha | Fase | Cambio | Autor | Referencia |
| --- | --- | --- | --- | --- |
| 2026-08-01 | SAAS-C1 / continuidad | Creacion del documento maestro de pendientes despues de publicar C1 | Codex | HEAD `7c73562` |
| 2026-08-12 | SAAS-C8 | Pagos manuales C0-C8 cerrados; automatizaciones y beta permanecen pendientes | Codex | Base `daf4677` |

## 20. Regla permanente

Cada vez que se decida que algo se deja para despues:

1. registrarlo aqui con ID, prioridad, fase y estado;
2. indicar dependencias, impacto y si requiere migracion;
3. continuar solamente con la fase autorizada;
4. no borrar el pendiente cuando se implemente;
5. marcarlo como `implementado` y agregar la fase o commit que lo cerro.

Este documento no autoriza migraciones, cambios de base, proveedores, despliegue,
commit ni push.
