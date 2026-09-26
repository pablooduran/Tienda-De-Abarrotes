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
| 9. Rediseño visual Figma | Hay guía de diseño y pulido PRODUCTO-1, además de la nueva pantalla de acceso. | Aplicar una referencia Figma concreta cuando esté disponible; ventana flotante de acceso pendiente. |
| 10. Onboarding y ayuda | WELCOME y HELP están implementados y probados localmente. | Ajustar tutorial a la interfaz definitiva y validar hospedado. |
| 11. Suscripciones y monetización | Motor, límites, trial, gracia, suspensión y pagos manuales implementados localmente. En el bloque local pendiente, la cotización y el detalle muestran el tipo de cambio aplicado y su fuente registrada, el panel administrativo los identifica con unidades, y las fechas ausentes dejan de mostrarse como “No aplica”. | Validación sintética hospedada de renovación, cambio de plan, comprobantes y lectura de cuenta suspendida. |
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
