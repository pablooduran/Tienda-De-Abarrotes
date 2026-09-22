# Correcciones de la revisión manual

Fuente: lista de 12 fases y prioridades P0–P3 proporcionada por el propietario.
Este registro evita repetir diagnósticos cerrados. Un test local aprobado no
equivale a una validación del entorno hospedado.

## Estado al 22 de septiembre de 2026

| Fase | Estado comprobado | Trabajo que sigue |
| --- | --- | --- |
| 1. Integridad funcional P0 | Implementada localmente: lectura de configuración en solo lectura, planes públicos Basic/Standard/Pro con límites 1/500/25/15 y 3/1200/70/50, Avanzado legado oculto, pago mixto ocasional saldado, vencimiento original y promesa separados, suspensión consultable. Lotes tienen distribución inicial y FEFO/FIFO. Evidencia: `docs/CONTINUIDAD_PROYECTO.md`, servicios y pruebas de cada dominio. | Confirmar Configuración y reglas P0 con cuenta sintética en staging; decidir integración de lotes dentro de Compras. No crear migración 025. |
| 2. Navegación y arquitectura | Acordeón exclusivo y vistas independientes de superadmin. Inicio/Clientes/Mi plan son accesos directos. Detalles de Tiendas y Suscripciones abren en ventana con retorno de foco; las subnavegaciones repetidas de Ventas e Inventario se ocultan en escritorio y permanecen en móvil. | Revisar otras pestañas internas duplicadas y el detalle de Pagos que aún desplaza la página. |
| 3. Modales, filtros y acciones | Hay patrones compartidos y varios filtros compactos; no existe todavía una convención aplicada a todos los módulos enumerados. | Unificar Filtros → Aplicar → cerrar y detalles contextuales por módulo; conservar búsquedas principales de POS y Compras. |
| 4. Acciones y lenguaje | Varias etiquetas fueron simplificadas en PRODUCTO-1; sigue habiendo lenguaje heredado y acciones repetidas. | Auditoría de texto y duplicaciones con lista concreta. Ocultar “Ya tengo un código de verificación” hasta solicitar o recibir un código. |
| 5. POS, cobranza, compras y devoluciones | POS tiene cliente ocasional y búsqueda paginada; pago mixto saldado y promesas están implementados. | Validar recorrido hospedado sintético y simplificar acciones de compras, devolución y ficha cliente. |
| 6. Catálogo maestro y carga inicial | Existe catálogo maestro, formulario e incorporación a tienda. | Revisar visibilidad inicial, multiselección y distinción empresa/marca/proveedor. No importar los 1194 productos ni cambiar estructura sin decisión específica. |
| 7. Inventario avanzado | Existen inteligencia, conciliación y lotes. | Diseñar nivel simple, aclarar ajuste físico y decidir la integración de lotes con Compras. |
| 8. Reportes y gráficos | Hay paneles, reportes y una jerarquía inicial de gráficos. | Revisar tamaños, interacción y móvil con datos sintéticos; validar cifras reales solo después de autorización de piloto. |
| 9. Rediseño visual Figma | Hay guía de diseño y pulido PRODUCTO-1, además de la nueva pantalla de acceso. | Aplicar una referencia Figma concreta cuando esté disponible; ventana flotante de acceso pendiente. |
| 10. Onboarding y ayuda | WELCOME y HELP están implementados y probados localmente. | Ajustar tutorial a la interfaz definitiva y validar hospedado. |
| 11. Suscripciones y monetización | Motor, límites, trial, gracia, suspensión y pagos manuales implementados localmente. | Validación sintética hospedada de renovación, cambio de plan, comprobantes y lectura de cuenta suspendida. |
| 12. Regresión y piloto | E2E local y CI de negocio constan en `docs/MAPA_PRUEBAS.md`; staging ya está disponible. | Completar pruebas hospedadas sintéticas y backup/restore. `PILOT_READY`, datos reales y piloto siguen sin autorización. |

## Siguiente secuencia de bloques

1. Cerrar pendientes de navegación: otras pestañas duplicadas y detalle de Pagos que hace perder contexto.
2. Unificar filtros y modales en las vistas de mayor uso.
3. Pulir POS, cobranza, compras y devoluciones; luego catálogo e inventario avanzado.
4. Rediseño visual y regresión hospedada sintética.

Cada bloque: diagnóstico acotado → implementación → prueba relacionada → revisión
de diferencias → publicación autorizada → CI → siguiente bloque. La verificación
de correo con código numérico de seis dígitos requiere expiración, límite de
intentos y rate limit antes de cambiar el contrato actual de token opaco.
