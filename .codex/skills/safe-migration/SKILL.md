---
name: safe-migration
description: Planifica, ensaya y aplica migraciones de Tienda de Abarrotes con huella, backup y verificacion controlados. Usar ante cambios de esquema o al revisar una migracion pendiente; nunca infiere autorizacion para tocar la base principal.
---

# Safe Migration

## Proposito

Planificar, ensayar, aplicar y verificar migraciones sin exponer secretos ni
alterar una base fuera de una autorizacion explicita.

## Cuando usarla

- Al proponer una tabla, columna, indice, FK, constraint o backfill.
- Al ensayar una migracion temporal o aplicar una migracion autorizada.

## Cuando no usarla

- Para cambios sin esquema, reparaciones manuales de datos o restauraciones.
- No modificar migraciones aplicadas.

## Modos

### Planificacion sin ejecucion

Revisar esquema y migraciones, proponer numeracion, identificar riesgos y
definir huella. No ejecutar SQL, consultar la base ni crear archivos. Indicar
la autorizacion necesaria.

### Ensayo temporal

Solo con `APP_ENV=local` y `localhost`. Crear una base temporal atribuible,
aplicar esquema y migracion, ejecutar comprobadores relacionados y eliminarla
en `finally`. No tocar la base principal.

### Aplicacion controlada

Requiere autorizacion explicita. Confirmar rama, HEAD, working tree, destino
local autorizado, migracion no registrada y ausencia de estructuras parciales.
Crear backup verificado y huella previa, aplicar solo la migracion aprobada,
comparar huella posterior, ejecutar regresion relacionada y confirmar readiness.
Commit y push requieren autorizacion separada.

## Entradas esperadas

- Alcance de esquema y migracion concreta, si existe.
- Modo solicitado, destino y autorizacion cuando corresponda.
- Comprobadores requeridos.

## Fuentes minimas

- [AGENTS.md](../../../AGENTS.md), [REGLAS_CODEX.md](../../../docs/REGLAS_CODEX.md),
  [MODELO_DATOS_RESUMIDO.md](../../../docs/MODELO_DATOS_RESUMIDO.md) y
  [MAPA_PRUEBAS.md](../../../docs/MAPA_PRUEBAS.md).
- [migraciones](../../../database/migrations/),
  [esquema inicial](../../../database/tienda_abarrotes.sql), migrador real y
  scripts publicados de backup y health en [package.json](../../../package.json).

## Fuentes prohibidas

No leer `.env*`, credenciales, datos personales, dumps no autorizados ni
produccion, Aiven u otro host remoto.

## Procedimiento

1. Seleccionar modo; sin autorizacion, permanecer en planificacion.
2. Confirmar numeracion unica y que ninguna migracion aplicada se modificara.
3. Definir huella de estructura, migraciones, conteos y sumas pertinentes.
4. En ensayo o aplicacion, limitar el entorno a local y limpiar solo recursos
   propios en `finally`.
5. Detenerse ante cualquier diferencia comercial no autorizada.

## Comandos permitidos

- Git no destructivo y `npm.cmd run codex:status` o `codex:cleanup-check`.
- `db:backup` y `db:verify-backup` solo con autorizacion.
- Migrador local solo en el modo autorizado; `db:check-*` y pruebas del dominio.
- Consultas SQL autorizadas de estructura, conteos y sumas.

## Detencion

Detenerse ante APP_ENV no local, host remoto, base no autorizada, working tree
sucio no explicado, migracion parcial, numero duplicado, backup invalido,
diferencia comercial inesperada, estructura previa no prevista, necesidad de
modificar una migracion aplicada o autorizacion insuficiente.

## Salida

```text
Modo:
Migracion:
Destino:
Huella:
Backup:
Ensayo:
Aplicacion:
Pruebas:
Base principal:
Bloqueos:
Autorizacion pendiente:
```

## Ejemplos

```text
$safe-migration
Planifica una posible migracion 020 para una tabla de proveedores. No la crees
ni consultes la base.
```
