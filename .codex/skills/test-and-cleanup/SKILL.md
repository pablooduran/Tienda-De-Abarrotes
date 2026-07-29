---
name: test-and-cleanup
description: Selecciona y ejecuta la regresión mínima de Tienda de Abarrotes, clasifica fallos y limpia solo recursos atribuibles a la ejecución actual. Usar después de cambios acotados o al investigar un arnés.
---

# Test and Cleanup

## Propósito

Elegir pruebas proporcionales, ejecutarlas de forma aislada y revisar recursos
creados por la ejecución actual sin borrar datos o procesos ajenos.

## Cuándo usarla

- Después de editar rutas, servicios, frontend, scripts o migraciones de prueba.
- Para distinguir una regresión funcional de un fallo del arnés.

## Cuándo no usarla

- Para ejecutar una regresión integral sin alcance justificado.
- Para limpiar fixtures ajenos, datos comerciales o procesos no atribuibles.

## Modo planificación sin ejecución

Tiene prioridad sobre el flujo normal cuando el usuario pida planificar
pruebas sin ejecutarlas. En este modo:

- no ejecutar ningún comando ni iniciar procesos;
- usar únicamente `package.json` y `docs/MAPA_PRUEBAS.md`;
- proponer Nivel 1, Nivel 2 y, si corresponde, Nivel 3;
- indicar qué pruebas crean servidor, navegador, fixtures o bases temporales;
- indicar limpieza requerida;
- no tocar la base ni hacer cleanup real;
- devolver solo el plan.

## Entradas esperadas

- Archivos cambiados, módulo y alcance.
- Nivel solicitado o condición de cierre, si existe.

## Fuentes mínimas

- [AGENTS.md](../../../AGENTS.md), [REGLAS_CODEX.md](../../../docs/REGLAS_CODEX.md),
  [MAPA_PRUEBAS.md](../../../docs/MAPA_PRUEBAS.md) y
  [package.json](../../../package.json).

## Fuentes que debe evitar

No leer `.env*`, backups, dumps, logs o datos reales. No usar producción ni
conexiones remotas.

## Procedimiento

Si está activo el modo planificación sin ejecución, aplicar sus límites y
detenerse después de devolver el plan.

1. Relacionar archivos modificados con la matriz de pruebas y confirmar cada
   nombre en `package.json`.
2. Proponer Nivel 1, luego Nivel 2 solo si el alcance lo justifica; reservar
   Nivel 3 para cierres, UX o contratos transversales.
3. Ejecutar cada comando con timeout razonable y registrar su resultado.
4. Si un arnés crea servidor, puerto, navegador, fixture o base temporal,
   identificarlo y cerrarlo en `finally` únicamente si pertenece a esta corrida.
5. Ejecutar `npm.cmd run codex:cleanup-check` al finalizar.
6. Informar residuos que exijan autorización; no borrarlos por cuenta propia.

## Comandos permitidos

- `node --check`, `git diff --check`.
- `npm.cmd run test:*`, `npm.cmd run db:check-*`, `npm.cmd run check:*` y
  `npm.cmd run codex:cleanup-check`.
- Consultas locales de solo lectura sobre procesos y puertos.

## Detención

Detenerse ante proceso no atribuible, conexión remota, cambio comercial
inesperado, fixture que no puede limpiarse con seguridad, escritura en la base
principal fuera del alcance o necesidad de relajar una validación real.

## Salida

```text
Pruebas aprobadas:
Pruebas fallidas:
Fallo funcional o de arnés:
Procesos propios cerrados:
Temporales:
Fixtures:
Base principal:
Pendientes:
```

## Ejemplos

```text
$test-and-cleanup
Valida los cambios de autenticación usando la regresión mínima relacionada y
confirma que no queden procesos o fixtures.
```
