---
name: product-design-review
description: Revisa una superficie de Tienda de Abarrotes con DESIGN.md para encontrar problemas de operacion, claridad, responsive y accesibilidad sin redisenar fuera del alcance.
---

# Product Design Review

## Proposito

Revisar una pantalla o flujo desde la tarea real de un propietario o superadmin. La salida identifica mejoras concretas y acotadas; no autoriza cambios de negocio, tenant, permisos, planes, pagos o rutas.

## Fuentes obligatorias

1. Leer `AGENTS.md` y `DESIGN.md`.
2. Leer `docs/PRODUCTO_0_DECISIONES.md` y el modulo objetivo.
3. Consultar `docs/MAPA_PRUEBAS.md` y el arnes browser aplicable antes de probar.

No leer secretos, sesiones reales ni archivos de entorno. Para browser, usar mocks, fixtures sinteticos y servidor efimero en `127.0.0.1`.

## Procedimiento

1. Delimitar rol, tarea, estado de suscripcion y permiso requerido.
2. Inspeccionar datos, vacio, carga, error, solo lectura y accion sensible.
3. Revisar jerarquia: una accion primaria, secundarias frecuentes y `Mas opciones` para las poco frecuentes.
4. Revisar tokens, componentes, vocabulario, feedback y navegacion.
5. Revisar carga cognitiva: pasos, campos, decisiones, densidad y reconocimiento.
6. Revisar copy: espanol claro, verbos concretos, errores recuperables y ausencia de detalles internos.
7. Revisar responsive en 360x800, 768x1024 y 1366x768; incluir nombres largos, numeros grandes, listas grandes, cero datos y filtros sin resultados.
8. Revisar accesibilidad: semantica, labels, teclado, foco, Escape, retorno de foco, touch, contraste, zoom 200 %, `aria-live` y reduced motion.
9. Revisar edge cases: red lenta, 400/401/403/404/429/500, doble clic, concurrencia visible y modo solo lectura.
10. Confirmar que el frontend no decide tenant ni muestra IDs, rutas, hashes, secretos o errores internos.

## Heuristicas de evaluacion

Aplicar como criterios: visibilidad del estado; correspondencia con el mundo real; control y libertad; consistencia; prevencion de errores; reconocimiento sobre memoria; eficiencia; minimalismo; recuperacion de errores; ayuda y documentacion. Cada hallazgo indica heuristica y evidencia.

## Severidad y salida

- `P0 bloqueante`: impide tarea, vulnera seguridad o accesibilidad esencial.
- `P1 importante`: provoca errores frecuentes, confusion fuerte o perdida de eficiencia.
- `P2 menor`: mejora claridad, consistencia o responsive sin bloquear la tarea.
- `P3 polish`: refinamiento visual de bajo riesgo.

Para cada hallazgo informar superficie, rol, estado, evidencia, heuristica, severidad, recomendacion concreta, prueba necesaria y si requiere decision del propietario. Distinguir defectos reproducibles de preferencias de diseno.

## Limites

No redisenar otras pantallas, inventar funciones, alterar contratos ni ejecutar pruebas incompatibles en paralelo. Si aparece una falla de tenant, autorizacion, seguridad o datos, detenerse y remitirla al flujo de seguridad correspondiente.
