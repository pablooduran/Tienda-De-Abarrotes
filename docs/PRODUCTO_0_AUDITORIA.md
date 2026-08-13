# PRODUCTO-0A - Auditoria funcional y UX

## 1. Resumen ejecutivo

Esta auditoria describe el producto existente antes de cambiar su diseno o
sumar funcionalidades. No autoriza modificaciones. El nucleo operativo esta
maduro: los recorridos automatizados de alta publica, onboarding, clientes,
cobranza, inventario, compensaciones, suscripciones, pagos manuales y
superadministracion pasan con datos sinteticos.

No se encontro un defecto tecnico bloqueante durante la auditoria. La mayor
oportunidad no es agregar modulos: es reducir la carga de orientacion de una
persona que administra una tienda por primera vez. El menu del propietario
tiene 18 destinos planos y varias configuraciones viven dentro de modulos
especializados. PRODUCTO-0B debe decidir una arquitectura de navegacion y un
lenguaje de acciones antes de redisenar pantallas individuales.

Alcance de evidencia:

- revision de `public/app.html`, `public/admin.html`, pantallas de acceso,
  onboarding y suscripcion, sus JavaScript y contratos de rutas;
- arneses de navegador locales, aislados y sin credenciales reales;
- viewports `360x800`, `768x1024` y `1366x768` donde el arnes lo cubre;
- lectura de los contratos y pruebas existentes. No se usaron datos de una
  tienda real ni conexiones externas.

## 2. Mapa actual del producto

| Persona | Entrada principal | Objetivo cotidiano | Areas disponibles |
| --- | --- | --- | --- |
| Propietario | `login.html` -> `app.html` | Comprar, vender, cobrar y revisar la salud de la tienda | Inicio, productos, stock, inteligencia, lotes, clientes, proveedores, POS, compras, ventas, cobranza, gastos, finanzas, compensaciones, auditoria, caja y reportes |
| Propietario nuevo | Registro publico -> verificacion local -> `onboarding.html` | Crear tienda y dejar la configuracion minima lista | Verificacion, configuracion inicial y acceso al panel |
| Propietario con suscripcion | `subscription.html` | Consultar plan, limites, vigencia y solicitudes de pago manual | Suscripcion, planes, cotizacion, solicitudes, comprobantes e historial |
| Superadmin | `admin.html` | Gestionar tiendas, catalogo, suscripciones y pagos | Directorio de tiendas, suscripciones SaaS, pagos manuales, catalogo maestro y auditoria global |

El tenant se deriva de la sesion. El superadmin usa contexto explicito para
operar sobre una tienda. Estos limites son parte del producto y deben seguir
presentes en cualquier redisenio.

## 3. Flujo del propietario: de registro a operacion diaria

1. Registro publico y verificacion de correo mediante el adaptador local.
2. Inicio de sesion y onboarding: datos base de la tienda antes de operar.
3. Panel `Inicio`: lectura de indicadores y acceso al menu lateral.
4. Preparacion: proveedores, productos, stock, compras y, cuando aplica,
   lotes/vencimientos.
5. Operacion diaria: POS, ventas, clientes, fiado, cobranza y movimientos.
6. Control: inventario, gastos, finanzas, cierre de caja, reportes y auditoria.
7. Excepciones: compensaciones para anulacion/devolucion y estado de
   suscripcion para limites, gracia o restriccion.

El orden funcional es correcto, pero no se comunica como un recorrido: una
persona nueva debe inferir que "Compras / stock", "Movimientos de stock",
"Conciliacion", "Lotes" e "Inteligencia" son partes relacionadas del mismo
dominio.

## 4. Flujo del superadmin

1. Inicia sesion en el panel administrativo.
2. Busca y abre una tienda o consulta su estado de suscripcion.
3. Gestiona propietarios y catalogo maestro cuando corresponde.
4. Configura tasa/metodos manuales, revisa comprobantes y aplica una solicitud
   de pago ya validada.
5. Consulta la auditoria global.

El flujo tiene controles de confirmacion, idempotencia y auditoria. La pantalla
combina cinco responsabilidades de alto impacto; debe conservar la separacion
tecnica actual aunque posteriormente se reorganice visualmente.

## 5. Inventario de pantallas y acciones principales

| Pantalla o seccion | Acciones principales | Estado de auditoria |
| --- | --- | --- |
| Acceso publico | Registro, inicio, recuperacion, cierre de sesion | Mantener; flujo E2E validado |
| Onboarding | Guardar configuracion y completar configuracion | Mantener; responsive y errores seguros validados |
| Inicio | Consultar resumen y navegar | Mejorar descubrimiento de proxima accion |
| Productos | Alta, edicion, ocultacion, catalogo, stock | Simplificar lenguaje de ocultacion y relacion con inventario |
| Inventario | Movimientos, inteligencia, conciliacion, lotes | Reubicar bajo una familia de inventario |
| Proveedores y compras | Registrar proveedor y abastecimiento | Mantener; presentar como preparacion de compra |
| Clientes y cobranza | Alta, perfil, credito, cobros, seguimientos, mensajes manuales | Mantener; aclarar el recorrido cliente -> deuda -> cobro |
| Punto de venta e historial | Venta, pagos mixtos, comprobante y consulta | Mantener; unir mentalmente venta, historial y devolucion |
| Compensaciones | Anular, devolver, liquidar y exportar | Renombrar/explicar para usuarios no contables |
| Finanzas, gastos, caja y reportes | Consultar y exportar control financiero | Reubicar bajo una familia de control financiero |
| Auditoria | Consultar trazabilidad | Mantener; diferenciarla de reportes operativos |
| Suscripcion y pagos | Consultar limites, cotizar, solicitar, subir comprobante | Mantener; explicar estados con lenguaje de negocio |
| Administracion global | Tiendas, catalogo, suscripciones, pagos y auditoria | Simplificar navegacion sin mezclar permisos |

## 6. Hallazgos funcionales y de UX

Las prioridades expresan impacto sobre comprension y error humano, no una
incidencia tecnica. "Decision" indica que el propietario debe escoger la
direccion antes de implementar.

| ID | Modulo/pantalla | Situacion actual | Problema u oportunidad | Categoria | Prioridad | Recomendacion | Impacto | Decision |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| P0A-01 | Menu del propietario | 18 secciones planas aparecen segun plan | La navegacion no expresa grupos de trabajo ni orden diario | REUBICAR | alta | Agrupar en Operacion, Inventario, Clientes y Finanzas; conservar guards actuales | Reduce tiempo de orientacion | si |
| P0A-02 | Inventario | Stock, inteligencia, conciliacion y lotes son destinos separados | El usuario debe entender cuatro conceptos tecnicos antes de saber donde actuar | SIMPLIFICAR | alta | Crear una entrada Inventario con subnavegacion contextual | Menos errores de ubicacion | si |
| P0A-03 | Productos/stock | "Productos" incluye catalogo y stock; compras tiene el nombre "Compras / stock" | Dos nombres describen parcialmente el mismo terreno | RENOMBRAR | media | Reservar Productos para catalogo y Compras para abastecimiento; mostrar stock dentro de Inventario | Taxonomia mas predecible | si |
| P0A-04 | Configuracion | Configuracion base se hace en onboarding; credito e inventario se configuran dentro de sus modulos | No existe una entrada de configuracion de tienda para descubrir ajustes disponibles | AGREGAR | alta | Disenar un centro de configuracion que enlace ajustes ya existentes, sin crear nuevas reglas | Menos dependencia de memoria | si |
| P0A-05 | Ventas y compensaciones | Venta, historial y devolucion/anulacion viven en tres secciones | El ciclo de una venta no se percibe como una sola historia | REUBICAR | alta | Presentar Historial y Compensaciones como acciones relacionadas de Ventas | Menos riesgo al corregir una venta | si |
| P0A-06 | Compensaciones | El termino cubre anulaciones, devoluciones y liquidaciones | "Compensacion" es correcto tecnicamente pero poco inmediato para una tienda familiar | RENOMBRAR | alta | Usar etiqueta visible "Devoluciones y anulaciones" y conservar el termino tecnico en ayuda | Mejor comprension y menos acciones equivocadas | no |
| P0A-07 | Ocultacion de registros | La accion segura conserva historial, pero varios flujos la presentan como eliminar | "Eliminar" puede hacer creer que se borraran datos o desalentar su uso correcto | RENOMBRAR | alta | Preferir "Ocultar" o "Archivar" y explicar la conservacion del historial | Reduce temor y errores de interpretacion | no |
| P0A-08 | Inicio | Resumen general sin recorrido de primeras tareas | El propietario nuevo no recibe una proxima accion segun faltantes de la tienda | MEJORAR | media | Definir una lista contextual de preparacion y alertas accionables | Acelera activacion | si |
| P0A-09 | Funcionalidades por plan | El menu oculta modulos no habilitados | La ocultacion protege la operacion, pero dificulta descubrir que existe una capacidad | MEJORAR | media | Decidir si mostrar entradas bloqueadas explicativas sin exponer la ruta | Expectativas de plan mas claras | si |
| P0A-10 | Credito y cobranza | Perfil, deuda, seguimiento, plantilla y WhatsApp manual son capacidades ricas | La secuencia requiere comprender varios conceptos a la vez | SIMPLIFICAR | media | Modelar el flujo visible como cliente -> deuda -> cobro -> seguimiento | Menos curva de aprendizaje | no |
| P0A-11 | POS | El selector actual carga hasta 500 clientes; la busqueda remota queda diferida | Una tienda grande puede no encontrar rapidamente al cliente para una venta fiada | AGREGAR | media | Evaluar busqueda remota paginada antes de ampliar el limite actual | Escalabilidad sin degradar POS | si |
| P0A-12 | Finanzas/caja/reportes | Gastos, finanzas, cierre y reportes son destinos separados | La diferencia entre control diario, resultado y exportacion no es evidente | REUBICAR | media | Agrupar bajo "Control financiero" con tareas diarias y analisis | Menos duplicacion percibida | si |
| P0A-13 | Auditoria | Se muestra junto a operacion del propietario y administracion global | Puede confundirse con historial de ventas o reporte | MANTENER | baja | Conservarla separada y agregar texto de proposito al abrirla | Protege trazabilidad | no |
| P0A-14 | Suscripcion y pagos | Estados tecnicos de solicitud y suscripcion se muestran durante el flujo | Son seguros y correctos, pero requieren lenguaje mas orientado a proxima accion | MEJORAR | media | Normalizar etiqueta, mensaje y accion siguiente por estado | Reduce abandonos durante pago manual | no |
| P0A-15 | Superadmin | Tiendas, pagos, suscripciones, catalogo y auditoria comparten una barra lateral | Es una superficie densa para tareas de alto impacto | SIMPLIFICAR | media | Mantener permisos y separar visualmente Operacion SaaS, Catalogo y Auditoria | Reduce error administrativo | si |
| P0A-16 | Estados vacios y errores | Arneses validan textos seguros, reintento y controles | La cobertura existe, pero no hay guia editorial transversal | MANTENER | baja | Crear reglas de copy y patrones de vacio/error en PRODUCTO-0B | Consistencia futura | no |
| P0A-17 | Accesibilidad | Arneses validan foco, teclado, dialogs, nombres y overflow en modulos auditados | Falta una revision manual unificada de contraste, orden visual y lenguaje | MEJORAR | media | Hacer inventario de componentes antes del redisenio | Evita regresiones de accesibilidad | si |
| P0A-18 | Ayuda y aprendizaje | No hay centro de ayuda ni guia posterior al onboarding | Las funciones complejas dependen de que el propietario descubra el menu | AGREGAR | media | Definir WELCOME y HELP despues de estabilizar arquitectura de navegacion | Reduce soporte futuro | si |

## 7. Hallazgos responsive y de accesibilidad

Los arneses cubiertos comprobaron ausencia de overflow global, foco visible,
teclado, nombres accesibles, dialogs y consola limpia en 360x800, 768x1024 y
1366x768. Clientes, credito, cobranza, inventario, ajustes, compensaciones,
auditoria, onboarding, suscripciones, planes y pagos tienen cobertura directa.

No se detecto una ruptura responsive. El riesgo para el redisenio no es una
pantalla rota sino la densidad: tablas y controles extensos deben conservar su
modo movil accesible; no basta con reducir tipografia o esconder acciones.

## 8. Inconsistencias de nombres y textos

- "Compras / stock" mezcla una accion con un estado; separar ambos conceptos.
- "Compensaciones" requiere traduccion operacional visible.
- "Eliminar" en registros historicos debe indicar que la accion es una
  ocultacion/archivo conservando trazabilidad.
- "Auditoria", "Historial de ventas" e "historial" de pagos son propositos
  diferentes; cada pantalla debe decir que historia responde.
- "Configuracion" aparece como pestana local de inventario y dialogo de
  credito, pero no como destino de tienda.

## 9. Funciones poco visibles, redundantes o faltantes

Poco visibles: configuracion de credito, configuracion de analisis de
inventario, lotes/vencimientos cuando aplican y capacidades no habilitadas por
plan. No son funciones ausentes; su localizacion es la oportunidad.

Posible redundancia percibida: los cuatro destinos de inventario y los cuatro
destinos financieros. La auditoria no recomienda borrar ninguna capacidad:
recomienda agruparlas para que el usuario llegue con menos decisiones.

Faltan como experiencia, no como backend: centro de configuracion de tienda,
recorrido de primeras tareas, ayuda contextual, nomenclatura comun para el
ciclo de venta y una busqueda de cliente que escale por encima del limite
actual del POS.

## 10. Puntos de friccion y riesgos de error

- Elegir una accion de inventario incorrecta por no distinguir consulta,
  conciliacion, ajuste o lote.
- Interpretar una ocultacion como borrado definitivo.
- Usar una compensacion sin comprender que corrige una venta previa.
- Perder una configuracion porque no existe una puerta de entrada comun.
- Confundir un comprobante interno con una factura fiscal. El sistema ya evita
  esa afirmacion; el redisenio debe conservarla.
- Confundir el envio manual de WhatsApp con automatizacion. El sistema ya
  muestra la limitacion; el redisenio debe mantenerla.

## 11. Priorizacion para PRODUCTO-0B

Critica: no hay hallazgos criticos de funcionalidad.

Alta: arquitectura del menu, familia Inventario, ciclo Venta/Devolucion,
lenguaje de compensaciones y lenguaje de ocultacion.

Media: centro de configuracion, inicio orientado a proxima accion, descubrimiento
por plan, flujo de cobranza, familia financiera, copy de pagos y accesibilidad
transversal.

Baja: aclarar proposito de auditoria y consolidar patrones de estado vacio/error.

## 12. Decisiones requeridas del propietario

1. Confirmar los grupos principales de navegacion del propietario.
2. Elegir si el menu debe revelar capacidades bloqueadas de forma explicativa.
3. Decidir si "Compensaciones" se renombra a "Devoluciones y anulaciones".
4. Aprobar "Ocultar/Archivar" como termino uniforme en vez de "Eliminar".
5. Definir el alcance de un centro de configuracion de tienda.
6. Decidir si Ventas debe reunir historial y correcciones en una misma familia.
7. Priorizar busqueda remota de clientes para POS frente a otras mejoras UX.
8. Elegir la secuencia entre PRODUCTO-0B, WELCOME y HELP.

## 13. Evidencia de validacion

| Flujo o modulo | Evidencia |
| --- | --- |
| Registro, verificacion, login, recuperacion y onboarding | `test:saas-a-e2e`, `test:onboarding-browser` |
| Clientes, credito, cobranza, POS e historial | `test:customers-credit-browser` |
| Inventario, ajustes y alertas | `test:inventory-intelligence-browser`, `test:inventory-adjustments-browser` |
| Devoluciones, anulaciones y liquidaciones | `test:compensation-browser` |
| Auditoria | `test:administrative-audit-browser` |
| Suscripcion y planes | `test:subscription-access-browser`, `test:subscription-plan-browser` |
| Superadmin SaaS | `test:saas-subscription-admin-browser` |
| Pagos manuales | `test:saas-c-payment-browser` |

Todos los arneses ejecutados usaron procesos locales atribuibles y fixtures
sinteticos o mocks locales. PRODUCTO-0A no modifica producto, esquema, datos
comerciales ni decisiones de plan.
