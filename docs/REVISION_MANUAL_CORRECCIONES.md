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

## Bloque local posterior: filtros de Gastos y Movimientos

Los filtros secundarios de Gastos y Movimientos de stock ahora se abren en una
ventana. La búsqueda de producto en Movimientos permanece visible. Cerrar
descarta cambios; Aplicar actualiza los resultados y devuelve el foco al botón.
Si falla una consulta filtrada, la ventana permanece abierta y se conserva la
lista anterior. Las pruebas de navegador usan respuestas sintéticas locales;
este bloque aún no se ha publicado ni validado en staging.

## Siguiente secuencia de bloques

1. Unificar filtros y modales en las vistas de mayor uso, empezando por Pagos, Tiendas y Catálogo.
2. Revisar detalles concretos de módulos operativos sin eliminar subflujos útiles.
3. Pulir POS, cobranza, compras y devoluciones; luego catálogo e inventario avanzado.
4. Rediseño visual y regresión hospedada sintética.

Cada bloque: diagnóstico acotado → implementación → prueba relacionada → revisión
de diferencias → publicación autorizada → CI → siguiente bloque. La verificación
de correo con código numérico de seis dígitos requiere expiración, límite de
intentos y rate limit antes de cambiar el contrato actual de token opaco.
