---
name: browser-harness
description: Disena y ejecuta arneses browser aislados de Tienda de Abarrotes con Playwright-Core y Edge local. Usar al validar una vista, flujo, responsive o accesibilidad sin usar sesiones ni credenciales reales.
---

# Browser Harness

## Proposito

Disenar y ejecutar pruebas browser reproducibles, aisladas y seguras para el
frontend sin ocultar fallos funcionales ni dejar procesos o fixtures residuales.

## Cuando usarla

- Al crear o corregir una prueba browser, flujo visual, responsive o accesible.
- Al diagnosticar un fallo de arnes frente a un defecto real del frontend.

## Cuando no usarla

- Para pruebas estaticas, navegacion manual con sesiones reales o cambios que
  no requieren navegador.

## Modos

### Planificacion sin ejecucion

Revisar frontend y arneses existentes, definir flujos, mocks, viewports y
limpieza. No iniciar servidor ni navegador.

### Ejecucion aislada

Usar Playwright-Core y Edge local segun el patron del repositorio, servidor HTTP
efimero en `127.0.0.1`, fixtures sinteticos y cierre de browser y servidor en
`finally`.

## Entradas esperadas

- Vista o flujo, archivos de frontend y arnes afectado.
- Modo y contratos API simulados o autorizados.

## Fuentes minimas

- [AGENTS.md](../../../AGENTS.md), [MAPA_PRUEBAS.md](../../../docs/MAPA_PRUEBAS.md),
  [ARQUITECTURA_RESUMIDA.md](../../../docs/ARQUITECTURA_RESUMIDA.md), frontend,
  CSS, arneses browser del modulo y [package.json](../../../package.json).

## Fuentes prohibidas

No leer `.env*`, sesiones o credenciales del usuario, produccion, modulos ajenos
ni la base principal salvo autorizacion expresa de una prueba aislada.

## Procedimiento

1. En planificacion, devolver flujos, mocks, viewports y limpieza sin ejecutar.
2. En ejecucion, usar puerto efimero o identificable y conservar referencias de
   procesos propios; no cerrar Edge o Node ajenos.
3. Cubrir cuando aplique carga, consola limpia, red, vacio, error seguro,
   filtros, paginacion, teclado, foco visible, exportaciones, respuestas
   obsoletas y ausencia de `idTienda` en frontend.
4. Usar los viewports `360x800`, `768x1024` y `1366x768`.
5. Esperar condiciones reales del DOM, capturar pageerror y consola, escapar
   HTML y cierres de script, y usar variables explicitas como `window.*` para
   contexto inline. No usar esperas arbitrarias ni debilitar aserciones.
6. Distinguir fallo funcional de fallo del arnes y cerrar recursos propios en
   `finally`.

## Comandos permitidos

- `node --check`, prueba browser especifica, consultas locales de puertos y
  procesos, `npm.cmd run codex:cleanup-check` y `git diff --check`.

## Detencion

Detenerse si requiere credenciales reales, produccion, una vista no aislable,
un proceso no atribuible, un browser o servidor propio que no puede cerrarse,
una modificacion funcional sin evidencia o si quedan fixtures o procesos.

## Salida

```text
Modo:
Flujos:
Mocks:
Viewports:
Accesibilidad:
Consola:
Fallo funcional o arnes:
Procesos propios:
Limpieza:
Resultado:
Pendientes:
```

## Ejemplos

```text
$browser-harness
Planifica una prueba responsive para la pantalla de inventario. Define los tres
viewports y la limpieza, sin iniciar navegador.
```
