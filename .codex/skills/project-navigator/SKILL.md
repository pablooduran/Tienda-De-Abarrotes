---
name: project-navigator
description: Orienta tareas en Tienda de Abarrotes con el contexto mínimo. Usar al iniciar investigación, corrección o cambio acotado cuando se necesite ubicar dominio, archivos y validaciones sin editar ni consultar la base.
---

# Project Navigator

## Propósito

Ubicar una tarea en este repositorio con el mínimo contexto verificable antes
de cualquier edición.

## Cuándo usarla

- Al recibir una tarea nueva, investigación, revisión o corrección acotada.
- Cuando se necesite identificar rutas, servicios, esquema y pruebas mínimas.

## Cuándo no usarla

- Para editar, ejecutar migraciones, iniciar servidores, consultar la base o
  cerrar un bloque. Delegar esas acciones a la tarea autorizada correspondiente.

## Entradas esperadas

- Descripción concreta de la tarea y alcance.
- Restricciones del usuario, si las hay.

## Fuentes mínimas

1. Leer siempre [AGENTS.md](../../../AGENTS.md).
2. Leer [REGLAS_CODEX.md](../../../docs/REGLAS_CODEX.md) si hay edición, base,
   Git, seguridad o cierre.
3. Clasificar el dominio y leer como máximo tres apoyos:
   - módulos: [ARQUITECTURA_RESUMIDA.md](../../../docs/ARQUITECTURA_RESUMIDA.md);
   - esquema: [MODELO_DATOS_RESUMIDO.md](../../../docs/MODELO_DATOS_RESUMIDO.md);
   - seguridad: [SEGURIDAD_Y_MULTITIENDA.md](../../../docs/SEGURIDAD_Y_MULTITIENDA.md);
   - validaciones: [MAPA_PRUEBAS.md](../../../docs/MAPA_PRUEBAS.md).
4. Consultar [package.json](../../../package.json) solo para confirmar nombres
   de comandos.

## Fuentes que debe evitar

No recorrer `node_modules`, ni leer `.env*`, backups, dumps, logs, artefactos,
ni documentación ajena al dominio. No consultar la base.

## Procedimiento

1. Confirmar rama, `HEAD` y estado Git.
2. Identificar dominio y riesgo: rutas, servicio, frontend, migración o prueba.
3. Buscar nombres concretos con `rg` o `rg --files`; no recorrer el repositorio
   completo.
4. Devolver contexto mínimo, archivos candidatos y validaciones seguras.
5. Esperar autorización antes de editar o ejecutar acciones con datos.

## Comandos permitidos

- `git status --short`, `git branch --show-current`, `git rev-parse --short HEAD`
  y `git log` limitado.
- `rg`, `rg --files` y lectura de archivos.
- `npm.cmd run` solo para inspeccionar scripts o ejecutar comprobaciones no
  destructivas explícitamente autorizadas.

## Detención

Detenerse ante rama incorrecta, working tree sucio no explicado, referencia a
producción, necesidad de secretos, tarea no documentada o alcance ambiguo que
afecte varios dominios.

## Salida

```text
Contexto:
Fuentes a leer:
Módulos:
Archivos candidatos:
Validaciones seguras:
Riesgos:
Siguiente acción:
```

## Ejemplos

```text
$project-navigator
Ubica el módulo de recuperación de contraseña y devuelve solo los archivos,
documentos y pruebas mínimas. No edites.
```
