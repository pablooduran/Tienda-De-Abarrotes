# Correcciones de la revisión manual

Fuente: lista de 12 fases y prioridades P0–P3 proporcionada por el propietario.
Este registro evita repetir diagnósticos cerrados. Un test local aprobado no
equivale a una validación del entorno hospedado.

## Estado al 22 de septiembre de 2026

| Fase | Estado comprobado | Trabajo que sigue |
| --- | --- | --- |
| 1. Integridad funcional P0 | Implementada localmente: lectura de configuración en solo lectura, planes públicos Basic/Standard/Pro con límites 1/500/25/15 y 3/1200/70/50, Avanzado legado oculto, pago mixto ocasional saldado, vencimiento original y promesa separados, suspensión consultable. Lotes tienen distribución inicial y FEFO/FIFO. Evidencia: `docs/CONTINUIDAD_PROYECTO.md`, servicios y pruebas de cada dominio. | Confirmar Configuración y reglas P0 con cuenta sintética en staging; decidir integración de lotes dentro de Compras. No crear migración 025. |
| 2. Navegación y arquitectura | Acordeón exclusivo y vistas independientes de superadmin. Inicio/Clientes/Mi plan son accesos directos. Detalles de Tiendas, Suscripciones y Pagos administrativos, y solicitudes de pago del propietario, abren en ventana con retorno de foco. Las subnavegaciones repetidas de Ventas e Inventario se ocultan en escritorio y permanecen en móvil. Las pestañas internas de POS, ficha de Cliente y Devoluciones se conservan: son subflujos diferentes, no duplicados del menú. Historial de ventas y ficha de Cliente ya usan ventanas. | Revisar detalles restantes al avanzar por módulos; no quitar pestañas internas sin caso concreto. |
| 3. Modales, filtros y acciones | Suscripciones SaaS, Pagos, Tiendas, Catálogo maestro, Auditoría, Cobranza y el historial de Compensaciones usan Filtros → Aplicar → cerrar; cerrar sin aplicar no modifica resultados. La búsqueda principal de Cobranza permanece visible. Clientes conserva búsqueda visible y filtros secundarios agrupados. Las búsquedas principales de Tiendas, Catálogo y Ventas permanecen visibles. En Pagos, Catálogo y Auditoría se conserva la lista anterior si falla la carga. Auditoría comparte la ventana entre superadmin y propietario. | Llevar la convención a los demás módulos del propietario; conservar búsquedas principales de POS y Compras. |
| 4. Acciones y lenguaje | Varias etiquetas fueron simplificadas en PRODUCTO-1; sigue habiendo lenguaje heredado y acciones repetidas. El acceso a verificación pendiente ya no aparece en Iniciar sesión: se ofrece en Crear cuenta para quien recibió un código y necesita retomar el trámite. En Historial de ventas, Comprobante queda visible junto a Ver detalle, sin un menú Más opciones de una sola acción. En Clientes y Cobranza, los avisos de funciones no incluidas ya no anuncian el plan Avanzado legado. Cobranza distingue pagar esta deuda de pagar varias deudas y explica el reparto sin mostrar la clave de reintento. El formulario aclara referencia y observación; la ficha explica límite y crédito disponible. En el bloque local pendiente, Devoluciones explica el ajuste y la estimación sin hablar de backend o movimientos internos; WhatsApp aclara preparación, plantilla y vista previa; Inteligencia define stock objetivo, cobertura y rotación. | Continuar auditoría de texto y duplicaciones con casos concretos al validar cada módulo. |
| 5. POS, cobranza, compras y devoluciones | POS tiene cliente ocasional y búsqueda paginada; pago mixto saldado y promesas están implementados. En el bloque local pendiente de publicación, Devoluciones permite seleccionar entre las últimas 300 ventas por comprobante, cliente o fecha y conserva consulta por número para ventas anteriores; Compras aclara el precio de unidad/paquete, costo unitario base y proveedor registrado. | Validar recorrido hospedado sintético y simplificar acciones restantes de devolución y ficha cliente. |
| 6. Catálogo maestro y carga inicial | Existe catálogo maestro, formulario e incorporación a tienda. La lista inicial y la selección entre páginas ya existían. En el bloque local pendiente de publicación, la selección usa casillas, muestra el límite de 50 y distingue marca de proveedor; se ignoran respuestas de búsqueda obsoletas. | Decidir si se agrega empresa a datos persistentes antes de cambiar estructura. No importar los 1194 productos sin decisión específica. |
| 7. Inventario avanzado | Existen inteligencia, conciliación y lotes. El ajuste físico explica que se registra la diferencia y distingue entradas y salidas. En el bloque local pendiente de publicación, inteligencia separa una vista simple de decisiones de la lectura avanzada, muestra alertas en lenguaje cotidiano y presenta correctamente el último día del período. La vista simple ya no depende de la valoración y la avanzada solo la solicita cuando está habilitada. | Decidir integración de lotes con Compras y validar ambas vistas con datos sintéticos hospedados. |
| 8. Reportes y gráficos | Hay paneles, reportes y una jerarquía inicial de gráficos. En el bloque local pendiente de publicación, las series diarias usan líneas, las comparaciones conservan barras acotadas, los gráficos admiten interacción táctil y lectura textual, y Reportes oculta el gráfico cuando la consulta no devuelve datos. | Validar tamaños e interacción móvil con datos sintéticos hospedados; validar cifras reales solo después de autorización de piloto. |
| 9. Rediseño visual Figma | La referencia Figma ya se aplicó a la paleta, tipografía, modo claro/oscuro, acceso, Inicio, navegación, tarjetas, relieve e interacciones principales. | Completar el pulido visual módulo por módulo después de publicar y revisar este bloque estructural en staging. |
| 10. Onboarding y ayuda | WELCOME y HELP están implementados. El bloque local reorganiza categorías, elimina repeticiones y agrega recorridos contextuales seguros para producto, stock, compras y venta. | Validar los recorridos hospedados y ampliar solo los temas que necesite la usuaria piloto. |
| 11. Suscripciones y monetización | Motor, límites, trial, gracia, suspensión y pagos manuales implementados. El bloque local rediseña Mi plan, alinea tarjetas, oculta uso/funciones por defecto y abre periodo/método/precio en una ventana después de elegir plan. La conversión manual queda como contingencia administrativa plegada. | Validación sintética hospedada de renovación, cambio de plan, comprobantes y lectura de cuenta suspendida. Tarjeta, QR automático y conversión de proveedor quedan para antes del lanzamiento comercial. |
| 12. Regresión y piloto | E2E local y CI de negocio constan en `docs/MAPA_PRUEBAS.md`; staging ya está disponible. El login local ahora comprueba `/auth/status` antes de navegar y avisa si la sesión no se conserva; el arnés de navegador cubre ese fallo sin credenciales reales. | Confirmar con cuenta sintética por qué staging devuelve al formulario tras aceptar la contraseña; esta protección visual no demuestra que la sesión hospedada funcione. Completar pruebas hospedadas sintéticas y backup/restore. `PILOT_READY`, datos reales y piloto siguen sin autorización. |

## Validación hospedada sintética del 23 de septiembre de 2026

En `Tienda Prueba Staging`, con confirmación del propietario de que el producto y
proveedor existentes eran sintéticos, se comprobó el siguiente recorrido sin
datos reales: compra de una unidad (stock 10 → 11), venta ocasional con Bs 10
en efectivo y Bs 10 por QR, venta fiada de Bs 20 a un cliente ficticio sin datos
de contacto y cobro posterior de Bs 20. El stock final quedó en 9 unidades,
la deuda en Bs 0 y el panel mostró Bs 40 vendidos y cobrados. Historial,
comprobantes, reportes de ventas, pagos y compras, y auditoría reflejaron los
movimientos. Configuración cargó y Mi plan mostró Basic 1/500/25/15, prueba
de 30 días y gracia de 7 días. La devolución parcial se inspeccionó sin
confirmarla; no se probó una cuenta suspendida ni un pago de suscripción.

Los encabezados técnicos de Reportes, el aviso de fiado que pedía elegir un
cliente ya seleccionado y el número interno del administrador en Auditoría
se publicaron en staging con el commit `ee5c99f`; CI pasó y se consultó el
reporte de fiados hospedado. Esta validación no
declara `PILOT_READY`, no autoriza datos reales y no inicia el piloto.

## Filtros de Gastos y Movimientos publicados

Los filtros secundarios de Gastos y Movimientos de stock ahora se abren en una
ventana. La búsqueda de producto en Movimientos permanece visible. Cerrar
descarta cambios; Aplicar actualiza los resultados y devuelve el foco al botón.
Si falla una consulta filtrada, la ventana permanece abierta y se conserva la
lista anterior. Las pruebas de navegador usan respuestas sintéticas locales.
El bloque se publicó en la rama `mejora-multitienda` con el commit `903d54f`;
la interacción hospedada aún requiere comprobación específica.

## Bloque local actual: filtros de Lotes, Inteligencia, Conciliación y Segmentación

La vista de Lotes conserva la lista visible y agrupa los filtros secundarios en
una ventana. Cerrar descarta el borrador; Aplicar consulta con los filtros
confirmados y solo cierra si la carga resulta correcta. Ante un error se
mantienen los resultados anteriores. Los accesos rápidos de Alertas siguen
aplicando rangos de vencimiento y Exportar queda fuera de la ventana, usando
los filtros confirmados. Inteligencia adopta el mismo patrón: las fechas se
validan dentro de la ventana, cerrar descarta cambios, un fallo conserva el
resultado previo y la exportación usa los filtros confirmados. Las pruebas
locales de navegador cubren móvil, tableta y escritorio con datos sintéticos.
En Stock vendible y conciliación, Buscar producto permanece visible mientras
el estado pasa a Filtros. Cerrar descarta el estado sin consultar; aplicar lo
confirma solo si la carga termina bien. Una consulta fallida conserva la tabla,
y una respuesta tardía no reemplaza el filtro más reciente.
La Segmentación de clientes conserva Buscar visible y reúne los criterios en
una ventana. Cambiar el segmento prepara sus campos sin consultar; Cerrar
restaura lo aplicado. Un error conserva el análisis anterior y la ventana
abierta. La prueba sintética de navegador cubre los tres tamaños de pantalla;
el arnés más amplio quedó adaptado, pero no se ejecutó porque usa una base
local y crea datos temporales.
La publicación y la validación en staging quedan pendientes al cierre de este registro.

## Tema visual claro/oscuro (publicado en staging)

La referencia de Figma Make proporcionada por el propietario guía la paleta
blanco/verde oscuro y negro verdoso/verde oscuro. La preferencia visual local
se aplica a acceso, registro/onboarding, aplicación, Mi plan y administración.
Los módulos operativos comparten tokens de color; se ajustaron los estados de
Lotes, Cobranza y Devoluciones, los menús de acciones, los filtros y Ayuda.
Los comprobantes de venta, cobranza, estado de cuenta y compensación conservan
fondo blanco y texto oscuro al imprimir incluso si la interfaz está en modo
oscuro. Las pruebas locales de navegador de Inventario, Ventas/Clientes,
Devoluciones, Ayuda, Auditoría, Ajustes e Inteligencia pasaron con datos
sintéticos. Las suites de Cobranza y reportes financieros que requieren MySQL
no se ejecutaron porque faltan las variables locales de conexión. El bloque
visual se publicó en `2d20c54`; la corrección de contraste y tablas extensas
se publicó en `7895d63`. Ambos commits pasaron CI y se confirmaron activos
en staging. Se revisaron acceso, Inicio, Configuración, Productos, Clientes,
Reportes, Finanzas, Gastos y Mi plan en las variantes pertinentes; a 1000 px
la tabla de Productos desplaza dentro de su recuadro sin desbordar la página.

## Guía local de vencimientos (pendiente de publicación)

La pantalla Lotes y vencimientos explica dónde se asigna la fecha: al activar
lotes para un producto con stock existente se distribuyen sus unidades y se
registran las fechas; para stock nuevo, la fecha se captura al agregar el
producto controlado en Compras / stock. Los accesos llevan a Productos y a
Registrar compra solo si la cuenta puede configurar lotes y no está en modo de
solo lectura. Los formularios de activación explican cuándo se exige una fecha;
la prueba de navegador recorre ambos accesos y el campo requerido en tres
tamaños de pantalla, sin escribir en la base de datos. No cambia la fecha de
lotes ya registrados ni añade una operación comercial nueva.

## Siguiente secuencia de bloques

1. Completar la misma convención en otros filtros secundarios pendientes, según uso y riesgo.
2. Revisar detalles concretos de módulos operativos sin eliminar subflujos útiles.
3. Decidir la integración de lotes con Compras y el alcance de empresa en Catálogo antes de modificar datos persistentes.
4. Rediseño visual y regresión hospedada sintética.

Cada bloque: diagnóstico acotado → implementación → prueba relacionada → revisión
de diferencias → publicación autorizada → CI → siguiente bloque. La verificación
de correo con código numérico de seis dígitos requiere expiración, límite de
intentos y rate limit antes de cambiar el contrato actual de token opaco.

## Nuevas correcciones solicitadas para acceso y presentación

1. **AUTH-UX-001 — Continuar con Google:** agregar en registro e inicio de
   sesión una opción funcional para acceder con una cuenta de Google. No debe
   ser un botón decorativo. El bloque debe configurar OAuth en backend,
   validar `state` y redirecciones, aceptar solamente correos verificados,
   impedir cuentas o tiendas duplicadas, permitir vincular de forma segura una
   cuenta existente y conservar los contratos de tenant, rol y sesiones. Estado:
   implementado localmente de forma configurable mediante Authorization Code,
   PKCE, `state`, `nonce`, correo verificado e identidad estable de Google. El
   botón permanece oculto sin las tres variables requeridas; no se guardan
   tokens ni credenciales en el repositorio. Falta aplicar la migración 025 en
   un entorno autorizado, configurar Google Cloud y validar el recorrido real.

2. **BILLING-UX-002 — Eliminar la tasa manual de la operación cotidiana:** los
   planes y precios comerciales se expresan en USD. Un futuro cobro con tarjeta
   debe procesarse en USD y dejar la conversión al emisor o proveedor de pago.
   Si se ofrece QR denominado en BOB, el servidor debe obtener una cotización
   automática desde una fuente aprobada, mostrar el monto final antes de
   confirmar y guardar en la solicitud la tasa, fuente y vigencia aplicadas.
   El superadministrador no debe actualizar el cambio cada día ni ver este
   formulario dentro del flujo normal. Una tasa manual, si se conserva como
   contingencia, debe quedar fuera de la operación habitual, restringida,
   auditada y con vencimiento. Estado: la tasa manual queda plegada como
   contingencia fuera del flujo cotidiano. El proveedor de
   pagos y la fuente automática se decidirán antes del lanzamiento. No bloquea
   el piloto gratuito de una tienda, donde no se cobrarán suscripciones.

3. **ACCESS-UX-003 — Recuperación y presentación del acceso:** mejorar la
   pantalla de recuperación con los siguientes criterios:
   - ofrecer **Reenviar código** con espera visible, expiración, límite de
     intentos y rate limit, sin generar envíos repetidos por doble clic;
   - conservar una respuesta neutral al solicitar recuperación, incluso cuando
     el correo no exista, para impedir enumeración de cuentas. No se mostrará
     “ese correo no tiene cuenta”; el error específico solo puede aparecer
     después de presentar un código inválido o vencido y tampoco debe revelar
     la existencia del correo;
   - retirar el botón aislado “Modo oscuro” y mover Apariencia a un menú de
     configuración representado por una rueda en una esquina, accesible por
     teclado y con opción claro/oscuro;
   - sustituir el fondo blanco exterior por una composición visual ligera
     relacionada con tiendas y abarrotes, coherente con la paleta verde, sin
     reducir contraste, legibilidad, rendimiento ni adaptación móvil.
   Estado: implementado localmente. Recuperación y verificación permiten
   reenviar con espera visible; la respuesta sigue siendo neutral por seguridad.
   Apariencia está en una rueda y el acceso usa un fondo visual ligero.

4. **DASHBOARD-UX-004 — Inicio interactivo, navegación rápida y privacidad:**
   tomar la referencia de interacción del dashboard SaaS compartido, adaptando
   contenido y jerarquía a una tienda de abarrotes:
   - agregar profundidad visual, elevación y respuestas `hover`, `focus` y
     pulsación a tarjetas y opciones realmente interactivas, con transiciones
     breves y respeto a `prefers-reduced-motion`;
   - destacar **Ventas de hoy** como indicador principal mediante una tarjeta
     verde de alta jerarquía;
   - separar el resumen en bloques comprensibles: ventas/dinero,
     fiados/cobranza e inventario/stock, evitando una sola fila de métricas sin
     agrupación;
   - permitir contraer la barra lateral en escritorio, conservar la preferencia
     y usar un panel deslizable en móvil, con iconos, textos o tooltips
     accesibles;
   - crear una barra superior con accesos directos a tareas frecuentes como
     Vender, Registrar compra y Cobranza/fiado, sin duplicar acciones ni
     saturarla;
   - mover la fecha de vencimiento del plan fuera de la barra lateral. Debe
     mostrarse en Mi plan y, si se crea un menú de cuenta, dentro de su resumen;
   - usar una rueda de configuración en la barra superior para Apariencia,
     Ayuda, Cuenta, Mi plan y Cerrar sesión. Cerrar sesión debe estar claramente
     enmarcado y seguir siendo accesible, pero no ocupar permanentemente el pie
     de la barra lateral;
   - no activar cookies o telemetría de analítica durante el piloto mientras el
     adaptador siga en modo `noop`. Antes de habilitar medición remota, crear un
     centro de preferencias con Aceptar y Rechazar al mismo nivel, categorías
     separadas, revocación posterior y bloqueo previo de toda analítica no
     esencial;
   - preparar Política de privacidad y Política de cookies con responsable,
     datos tratados, finalidad, destinatarios/proveedores, transferencias,
     conservación, derechos y mecanismo de revocación. Requiere revisión legal
     antes del lanzamiento; no se simulará consentimiento sin analítica real.
   Estado: implementado localmente en navegación, Inicio y cuenta: barra
   contraíble, panel móvil, accesos rápidos, rueda, plan fuera del lateral,
   tarjetas agrupadas e interacciones. Analítica continúa en `noop`, por lo que
   no se muestran consentimientos ficticios; centro de preferencias y textos
   legales se cierran antes de habilitar medición o abrir el producto al público.

5. **PLAN-UX-005 — Rediseñar Mi plan y convertir el cambio en un checkout:**
   - mover Mi plan al menú de cuenta/configuración de la barra superior, sin
     impedir un acceso directo claro cuando la suscripción requiera atención;
   - presentar el plan actual como bloque principal con nombre, estado, próxima
     fecha relevante y acción comprensible, usando más ancho y jerarquía visual;
   - separar en subsecciones o tarjetas: Resumen, Uso del plan, Qué incluye,
     Facturación e Historial. Los límites y consumo deben permanecer cerrados
     por defecto bajo **Ver uso**, con barras de progreso cuando el límite sea
     finito y una lectura sencilla para capacidad ilimitada;
   - mostrar funcionalidades bajo **Ver lo que incluye tu plan**, sin una lista
     extensa siempre abierta;
   - mantener las tres tarjetas de planes con igual alto, encabezados, contenido
     y botones alineados. Deben tener relieve, hover/focus y comparación visual
     de ventajas. El plan contratado se destaca en verde y su botón dice
     **Plan actual**, nunca “No disponible”;
   - usar **Mejorar plan** cuando el destino sea superior y **Cambiar plan**
     cuando sea inferior. Un cambio inferior conserva la regla segura de
     aplicarse en el siguiente periodo, aunque el botón no use lenguaje de
     castigo como “disminuir”;
   - al seleccionar una tarjeta, abrir una ventana o flujo por pasos con detalle
     incremental (“incluye todo lo anterior y además…”), selección Mensual /
     Trimestral / Anual, precio completo y método de pago;
   - eliminar de la vista principal el formulario lineal “Renovar o cambiar mi
     plan”. La selección de periodo y pago aparece solamente después de elegir
     un plan. El historial de solicitudes puede permanecer dentro de
     Facturación, no mezclado con la comparación;
   - tarjeta: usar campos alojados/tokenización del futuro proveedor y no guardar
     números completos ni código de seguridad. QR: generar el monto cotizado y
     confirmar el pago desde el proveedor antes de aplicar el plan;
   - no activar un plan por el clic ni por mostrar un QR. Solo una confirmación
     de pago válida aplica la mejora o programa el cambio correspondiente.
   Estado: implementado localmente para el flujo manual: plan actual destacado,
   uso y funciones desplegables, tarjetas alineadas con precio y checkout en
   ventana después de elegir plan. El historial queda plegado. La tokenización
   de tarjeta, QR automático y confirmación del proveedor no se simulan y quedan
   pendientes hasta elegir la integración comercial.

6. **HELP-UX-006 — Centro de ayuda ordenado y tutorial interactivo:**
   - ocultar el botón global Ayuda mientras la vista de Ayuda está activa;
   - eliminar títulos repetidos y usar un único encabezado **Centro de ayuda**;
     mantener una sola etiqueta de búsqueda con un ejemplo útil en el campo;
   - colocar **Volver** dentro del encabezado superior y hacer el retorno
     inmediato mediante navegación interna, conservando contexto y posición;
   - presentar categorías en una columna lateral ordenada en escritorio y como
     acordeón o selector compacto en móvil. Mostrar inicialmente solo los temas
     de la categoría elegida, no los 31 artículos mezclados;
   - conservar en cada artículo Qué hace / Cómo hacerlo / Qué pasa después, y
     añadir **Guíame en la aplicación** cuando exista un recorrido contextual;
   - el recorrido debe navegar al módulo correcto, oscurecer el resto de la
     pantalla, resaltar un control por vez, explicar su propósito y avanzar solo
     cuando el paso sea comprensible. Debe tener Atrás, Siguiente, Saltar y
     Cerrar, funcionar con teclado, no atrapar al usuario y respetar movimiento
     reducido;
   - no confirmar ventas, compras, cobros ni cambios de datos automáticamente.
     El tutorial puede preparar o señalar una acción, pero cualquier operación
     real requiere la confirmación normal del usuario;
   - ofrecer al crear la cuenta una introducción opcional y reanudable. Orden
     operativo recomendado: completar datos de tienda → agregar producto →
     registrar compra o stock inicial → agregar cliente si se usará fiado →
     realizar venta → registrar cobranza → revisar reportes. El cliente no debe
     bloquear una venta ocasional y no se puede enseñar una venta antes de tener
     producto y stock;
   - guardar progreso por usuario/tienda y permitir reiniciar cualquier guía
     desde el Centro de ayuda.
   Estado: implementado localmente para las tareas principales. Ayuda muestra una
   categoría a la vez y los artículos compatibles ofrecen un recorrido que
   navega, oscurece y resalta controles sin ejecutar operaciones. WELCOME sigue
   siendo la introducción reanudable; queda validar hospedado y ampliar recorridos
   solamente donde la prueba real revele necesidad.

7. **PERF-UX-007 — Respuesta inmediata al cambiar de módulo:** la navegación
   entre Inicio, Proveedores y el resto de opciones presenta una espera percibida
   cercana a dos segundos. Debe tratarse como un problema transversal y medirse
   antes de atribuirlo solamente al hosting o a la conexión:
   - dar respuesta visual inmediata al clic, conservar el panel actual mientras
     llega la información y mostrar un indicador discreto dentro del contenido,
     sin dejar la pantalla en blanco ni bloquear toda la aplicación;
   - separar en las mediciones el tiempo hasta la respuesta visual, el tiempo de
     red/API y el tiempo de renderizado, comparando entorno local y staging;
   - evitar recargar datos globales, permisos, configuración y catálogos que ya
     estén vigentes en cada cambio de módulo. Aplicar caché con invalidación tras
     escrituras, deduplicación de solicitudes y cancelación de respuestas viejas;
   - cargar primero los datos imprescindibles para la vista y diferir reportes,
     gráficos, detalles o listas secundarias; paginar o virtualizar tablas grandes
     cuando la medición lo justifique;
   - revisar consultas lentas, índices y respuestas excesivas del servidor, sin
     ocultar una demora real únicamente con animaciones;
   - precargar de forma limitada los módulos operativos más usados cuando la
     conexión esté libre, sin descargar toda la aplicación de una vez;
   - fijar como objetivo inicial que el cambio visual comience en menos de 100 ms
     y que una vista habitual con datos sintéticos quede utilizable en menos de
     un segundo en staging, registrando excepciones justificadas.
   Estado: diagnosticado y corregido localmente. El cambio de módulo responde de
   inmediato, conserva el contenido durante la carga y muestra progreso discreto.
   Catálogos compartidos usan caché de 45 segundos, deduplicación y se invalidan
   después de escrituras; respuestas antiguas no reemplazan la vista actual.
   Falta medir local y staging después de publicar para comprobar el objetivo.
