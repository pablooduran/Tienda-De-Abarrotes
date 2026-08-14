# Guia de diseno del producto

## Proposito

Esta guia orienta las superficies de Tienda de Abarrotes. No agrega reglas de negocio, permisos, rutas ni funciones. Toda interfaz debe ayudar a completar una tarea con rapidez, claridad y seguridad.

## Modo Operate y audiencia

La aplicacion es una superficie **Operate** para propietarios que venden, abastecen, controlan existencias, cobran y configuran su tienda; el superadmin administra la plataforma. La interfaz desaparece detras de la tarea: familiaridad y consistencia prevalecen sobre sorpresa, decoracion o experimentacion.

Prioridad: rapidez, claridad, consistencia, familiaridad, accesibilidad, reduccion de carga cognitiva y una apariencia profesional propia.

## Auditoria base P7A

| Superficie | Base actual observada | Mantener | Siguiente revision |
| --- | --- | --- | --- |
| Acceso y registro | Formularios de una columna y mensajes locales | Labels, campos nativos y una accion clara | Jerarquia de ayuda, recuperacion y errores |
| Onboarding | Superficie guiada con anuncio de estado | Progreso y acciones por paso | Copy de apoyo y abandono |
| Inicio | Resumen, alertas y metricas | Informacion operativa y paneles simples | Densidad, alertas y cero datos |
| POS | Venta, busqueda y resumen de cobro | Venta primaria y seleccion accesible | Alta carga y recuperacion |
| Inventario | Productos, filtros compactos y subnavegacion | Accion primaria, tabla interna y `Mas opciones` | Herramientas y listas extensas |
| Clientes | Busqueda, filtros y credito | Acciones agrupadas y mensajes seguros | Vacio de seguimiento y movil |
| Configuracion | Formulario alineado con onboarding | Labels, fiscal opcional y guardado protegido | Alcance visual definitivo |
| Mi plan | Estado, limites y pagos manuales | Contexto y acciones seguras | Separar informacion y accion |
| Superadmin | Navegacion global, tablas y detalle | Separacion del tenant comercial | Densidad, filtros y cola |

Los arneses aislados de navegacion, onboarding, inventario, ventas/clientes, configuracion y suscripciones/superadmin se validaron en 360x800, 768x1024 y 1366x768. No reportaron overflow de pagina ni errores de consola. P7A no cambia esas superficies; P7B-P7E y P8 revisan los puntos pendientes.

## Principios

1. Disenar para tarea, audiencia y momento real; jerarquia antes que decoracion.
2. Conservar HTML semantico, labels, encabezados y acciones claras.
3. Usar el mismo vocabulario para el mismo concepto en todo el flujo.
4. Preferir reconocimiento sobre memoria: contexto, estado y siguiente accion visibles.
5. Prevenir errores y explicar recuperacion sin culpar a la persona.
6. Usar color, motion y elevacion para estado y prioridad, no como ornamento.
7. Conservar densidad cuando agilice operacion; no anidar tarjetas por decoracion.

## Tokens vigentes

Reutilizar primero los tokens de `public/css/styles.css`; no duplicarlos por pantalla ni cambiar la paleta completa sin una fase aprobada.

| Rol | Token o base actual | Uso |
| --- | --- | --- |
| Fondo | `--bg` | Fondo de aplicacion |
| Superficie | `--panel` | Panel, tarjeta o formulario aislado |
| Texto | `--ink` | Texto principal |
| Texto secundario | `--muted` | Ayuda y metadatos |
| Borde | `--line` | Separacion de controles y superficies |
| Accion primaria | `--brand`, `--brand-dark` | Una accion dominante por contexto |
| Exito | `--ok` | Resultado positivo |
| Advertencia | `--warn`, `--yellow` | Atencion no bloqueante |
| Error | `--danger` | Error, riesgo y accion destructiva |
| Foco | Outline verde semitransparente; amarillo en navegacion lateral | Foco visible sin hover |

La escala actual usa espaciados de 6, 8, 10, 12, 14, 16, 18, 20 y 24 px, radius de 6 u 8 px, sombra baja y `Segoe UI, Arial, Helvetica, sans-serif`. Los controles mantienen altura tactil suficiente y no deben cambiar de tamano durante loading.

## Vocabulario de componentes

| Componente | Usar cuando | Regla |
| --- | --- | --- |
| Boton primario | Una accion principal | Verbo concreto; uno dominante por contexto |
| Boton secundario | Apoyo frecuente | No competir con el primario |
| Accion peligrosa | Anular, rechazar, cancelar u ocultar con riesgo | Consecuencia clara y confirmacion cuando corresponda |
| Input, select, textarea | Captura de datos | Label persistente, ayuda y error junto al campo |
| Filtros | Varios criterios existentes | Panel compacto, contador, Aplicar y Limpiar filtros |
| Tabla/paginacion | Comparar colecciones | Encabezados claros y `table-wrap` interno en movil |
| Dropdown `Mas opciones` | Acciones poco frecuentes | No esconder la accion habitual |
| Dialog | Confirmacion sensible o tarea breve | No como primera solucion; foco, Escape y retorno |
| Toast/feedback | Resultado de mutacion | Breve, seguro y accionable |
| Skeleton | Carga de panel, tabla o lista | Sustituye espacio final; reduced motion |
| Empty/error state | Sin datos, sin resultados o fallo | Explica situacion y recuperacion permitida |
| Status badge | Estado de negocio | Texto ademas de color |
| Card/panel | Unidad realmente delimitada | No cards dentro de cards |
| Navegacion/subnavegacion | Cambio de contexto estable | Convencional, por rol y sin duplicar rutas |

## Jerarquia y copy

Una accion primaria domina cada contexto. Las secundarias van inline solo si son frecuentes; las poco frecuentes se agrupan en `Mas opciones`. Las acciones destructivas describen su consecuencia. Evitar `OK`, `Submit` y `Aceptar`; preferir `Guardar cambios`, `Registrar venta`, `Agregar producto`, `Enviar comprobante` y `Anular venta`.

Escribir en espanol claro, frases cortas y terminos del negocio. Mantener `Venta`, `Compra`, `Cobranza`, `Devoluciones y anulaciones`, `Configuracion` y `Mi plan` como vocabulario estable. Errores: problema + recuperacion; exitos: breves. Nunca mostrar IDs, SQL, rutas, secretos, hashes o terminos internos.

## Estados y motion

Cada componente contempla default, hover, focus, active, disabled, loading, error y empty. Las mutaciones deshabilitan el control, anuncian `aria-busy`, conservan ancho y usan texto contextual hasta restaurar exactamente su estado anterior. El motion comunica cambio de estado, es breve y respeta `prefers-reduced-motion`; no es decorativo.

## Responsive y accesibilidad

Mobile prioriza una columna, accion principal visible, controles tactiles y tablas con estrategia propia sin overflow de pagina. Tablet aprovecha ancho sin comprimir controles. Desktop aumenta densidad solo cuando acelera la operacion. No usar tipografia fluida como sustituto de estructura responsive.

El minimo es contraste WCAG AA, foco visible, teclado, orden logico de foco, labels persistentes, semantica HTML, estados no dependientes solo de color, `aria-live` para resultados asincronos relevantes, touch targets adecuados, zoom a 200 % y reduced motion.

## Antipatrones

- Cards dentro de cards, filas de botones equivalentes o modales como primera solucion.
- Controles extravagantes o patrones distintos para la misma accion.
- Color como unico indicador, placeholder como unico label, spinner como unica carga.
- Acciones ambiguas, CTA sin permiso o navegacion que expone rutas bloqueadas.
- Copy tecnico, datos internos o contenido no confiable insertado sin escape.

## Checklist de revision

Antes de cerrar una superficie: tarea y rol; jerarquia; vocabulario; acciones y consecuencias; estados completos; vacio, error y carga; responsive a 360x800, 768x1024 y 1366x768; teclado, foco, touch y zoom 200 %; consola limpia; modo solo lectura; nombres largos, numeros grandes, listas grandes, caracteres especiales, filtros sin resultado, red lenta, doble clic y errores 400/401/403/404/429/500. P7D y P8 convierten esta lista en cobertura sistematica.
