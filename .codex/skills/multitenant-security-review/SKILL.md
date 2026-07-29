---
name: multitenant-security-review
description: Revisa rutas, servicios, SQL, frontend y exportaciones de Tienda de Abarrotes para detectar fugas entre tiendas y fallos de autorizacion. Usar antes de cerrar cambios que acceden a datos, escriben o exponen descargas.
---

# Multitenant Security Review

## Proposito

Revisar cambios para prevenir cruces entre tiendas, autorizaciones incompletas,
filtraciones de datos internos y escrituras inseguras.

## Cuando usarla

- Al cambiar rutas, middleware, servicios, SQL, frontend o exportaciones.
- Antes de cerrar un cambio con datos comerciales, permisos o descargas.

## Cuando no usarla

- Para implementar funcionalidad, inspeccionar secretos o revisar modulos sin
  relacion directa con el alcance.

## Modos

### Revision estatica

Leer solo archivos modificados y dependencias directas. No ejecutar pruebas ni
editar. Devolver hallazgos y validaciones recomendadas.

### Revision con validacion

Ejecutar solo pruebas de tenant, seguridad y modulo justificadas. No modificar
codigo salvo autorizacion expresa.

## Entradas esperadas

- Lista de archivos o diff, dominio y modo.
- Contrato de ruta, exportacion o escritura afectada.

## Fuentes minimas

- [AGENTS.md](../../../AGENTS.md),
  [SEGURIDAD_Y_MULTITIENDA.md](../../../docs/SEGURIDAD_Y_MULTITIENDA.md),
  [ARQUITECTURA_RESUMIDA.md](../../../docs/ARQUITECTURA_RESUMIDA.md) y
  [MAPA_PRUEBAS.md](../../../docs/MAPA_PRUEBAS.md).
- Rutas, middleware, servicios y pruebas directas del modulo.

## Fuentes prohibidas

No leer `.env*`, backups, datos reales, produccion, conexiones remotas ni
modulos no relacionados.

## Procedimiento

1. Revisar sesion, tenant derivado por backend, suscripcion, funcionalidad,
   permisos, CSRF, rate limiting, `Cache-Control: no-store`, consultas
   parametrizadas, errores seguros y auditoria.
2. Confirmar que frontend no envia ni decide `idTienda`; SELECT, JOIN,
   escrituras, agregados, paginacion, filtros y exportaciones preservan tenant.
3. Exigir contexto tenant explicito al superadmin para acciones comerciales.
4. Para escrituras criticas, revisar transaccion, rollback, bloqueos en orden
   determinista, idempotencia, auditoria y ausencia de DELETE fisico comercial.
5. Para exportaciones, revisar filtros equivalentes, formulas neutralizadas,
   no-store y exclusion de datos tecnicos o sensibles.

## Comandos permitidos

- `rg`, lectura de archivos y `node --check`.
- `npm.cmd run check:web-security`, `db:check-multitenant`,
  `test:tenant-isolation` y pruebas justificadas del modulo, confirmadas en
  `package.json`.
- `codex:precommit` solo durante un cierre autorizado.

## Detencion

Detenerse ante idTienda desde frontend, SQL sin tenant, ruta sensible sin
sesion o permisos, escritura sin CSRF, operacion critica sin transaccion,
secreto en respuesta, cruce entre tiendas, conexion remota o necesidad de
relajar una validacion real.

## Salida

```text
Modo:
Archivos revisados:
Cadena de autorizacion:
Tenant:
Escrituras:
Frontend:
Exportaciones:
Hallazgos:
Pruebas requeridas:
Veredicto:
Bloqueos:
```

## Ejemplos

```text
$multitenant-security-review
Revisa estaticamente una nueva ruta GET de inventario: confirma tenant,
permisos y no-store. No ejecutes pruebas.
```
