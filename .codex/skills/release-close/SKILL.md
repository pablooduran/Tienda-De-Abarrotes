---
name: release-close
description: Cierra un bloque validado de Tienda de Abarrotes revisando alcance, limpieza y precommit; prepara stage, commit y push solo cuando el usuario los autoriza explícitamente.
---

# Release Close

## Propósito

Cerrar un bloque ya validado con alcance explícito, sin introducir cambios ni
inferir autorización de Git, migraciones o limpieza.

## Cuándo usarla

- Cuando el usuario entregue archivos autorizados, pruebas realizadas y mensaje
  de commit o autorización explícita para cierre.

## Cuándo no usarla

- Durante implementación, con pruebas pendientes, sin lista de archivos o sin
  autorización expresa de commit/push.

## Entradas esperadas

- Lista explícita de archivos permitidos.
- Pruebas requeridas y sus resultados.
- Mensaje de commit autorizado y, por separado, autorización de push si aplica.

## Fuentes mínimas

- [AGENTS.md](../../../AGENTS.md), [REGLAS_CODEX.md](../../../docs/REGLAS_CODEX.md),
  [MAPA_PRUEBAS.md](../../../docs/MAPA_PRUEBAS.md) y
  [package.json](../../../package.json).

## Fuentes que debe evitar

No leer `.env*`, backups, dumps o logs. No revisar datos comerciales salvo que
el cierre lo autorice y requiera una comprobación segura.

## Procedimiento

1. Confirmar rama, `HEAD`, alcance y resultados de las pruebas acordadas.
2. Ejecutar `codex:status`, `codex:cleanup-check` y
   `codex:precommit -- --allow` con la lista explícita.
3. Revisar `git diff` completo; antes del commit, revisar también el diff staged.
4. Bloquear secretos, `.env`, backups, logs, temporales, migraciones no
   autorizadas y archivos fuera del alcance.
5. Hacer stage únicamente de rutas declaradas.
6. Crear commit solo con autorización explícita; hacer push solo con
   autorización explícita separada o inequívoca.
7. Confirmar sincronización local/remota y working tree limpio.

## Comandos permitidos

- `git status`, `git diff`, `git diff --cached`.
- `git add` con rutas explícitas, `git commit` con mensaje autorizado y
  `git push origin <rama>` autorizado.
- `npm.cmd run codex:status`, `npm.cmd run codex:cleanup-check` y
  `npm.cmd run codex:precommit -- --allow ...`.

## Detención

Detenerse ante pruebas fallidas, archivos fuera del alcance, secretos,
migraciones no autorizadas, backup inválido o readiness no saludable cuando
sean requisitos, working tree con cambios ajenos o falta de autorización de
commit/push.

## Salida

```text
Resultado:
Archivos:
Pruebas:
Precommit:
Commit:
Push:
Rama:
Working tree:
Pendientes:
```

## Ejemplos

```text
$release-close
Cierra SAAS-A1 con estos archivos autorizados y este mensaje de commit.
No hagas push sin autorización explícita.
```
