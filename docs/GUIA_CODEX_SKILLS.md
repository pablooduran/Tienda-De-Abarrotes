# Guia de skills de Codex

Las skills reducen la repeticion de instrucciones para tareas recurrentes. No
reemplazan la lectura de los archivos relevantes, las pruebas ni la
autorizacion humana.

Invocarlas con `$nombre`, por ejemplo `$project-navigator`. Seleccionar solo
las necesarias: no ejecutar las seis por defecto.

| Skill | Uso principal | Modo seguro por defecto | Autorizacion necesaria | Fuentes |
| --- | --- | --- | --- | --- |
| `$project-navigator` | Ubicar dominio y archivos | Solo contexto | Editar, datos o Git | `AGENTS.md`, mapas de docs |
| `$test-and-cleanup` | Elegir regresion y limpiar recursos propios | Planificacion sin ejecucion | Ejecutar pruebas o limpiar | `MAPA_PRUEBAS.md`, `package.json` |
| `$release-close` | Cerrar un bloque | Simulacion de cierre | Precommit, stage, commit o push | Reglas, mapa y diff |
| `$safe-migration` | Cambios de esquema | Planificacion sin ejecucion | Ensayo, backup o aplicacion | Modelo, migraciones y scripts |
| `$multitenant-security-review` | Revisar acceso a datos | Revision estatica | Ejecutar validaciones | Seguridad, rutas y servicios |
| `$browser-harness` | Prueba browser aislada | Planificacion sin ejecucion | Servidor, browser o fixtures | Frontend, arneses y mapa |

## Ejemplos

```text
$project-navigator
Ubica los archivos y pruebas minimas para recuperar contrasena. No edites.

$test-and-cleanup
Planifica la regresion de una ruta de stock. No ejecutes pruebas.

$release-close
Simula el cierre de un bloque; no hagas stage ni push.

$safe-migration
Planifica una migracion futura; no crees archivo ni consultes la base.

$multitenant-security-review
Revisa estaticamente una ruta GET con paginacion por tienda.

$browser-harness
Planifica una prueba responsive sin iniciar Edge ni servidor.
```

## Combinaciones

- Tarea nueva: `$project-navigator`.
- Implementacion normal: `$project-navigator` + `$test-and-cleanup`.
- Cambio sensible: `$project-navigator` + `$multitenant-security-review`.
- Migracion: `$safe-migration` + `$test-and-cleanup`.
- Frontend browser: `$browser-harness` + `$test-and-cleanup`.
- Cierre: `$release-close`.

Evitar ejecutar las seis juntas, combinar una skill de planificacion con
acciones reales, o usar una skill como sustituto de pruebas o autorizacion.

## Modelo y esfuerzo

Para lectura, busqueda y planificacion, usar un modelo rapido con esfuerzo
bajo. Para cambios de esquema, seguridad, transacciones o cierre, usar el
modelo mas capaz disponible y esfuerzo medio o alto. Ajustar el esfuerzo al
riesgo, no al tamano aparente del diff.

## Problemas frecuentes

- **La skill no aparece o el catalogo no se recargo:** abrir una nueva sesion o
  recargar el catalogo; mientras tanto, leer su `SKILL.md` versionado y seguir
  el modo seguro manualmente.
- **`unsupported custom tool call`:** no inventar una herramienta. Continuar
  con las herramientas locales disponibles o detenerse si falta autorizacion.
- **`APP_ENV_NOT_LOCAL`:** establecer `APP_ENV=local` solo para el proceso y
  confirmar el destino autorizado antes de una comprobacion local.
- **Express detenido:** `codex:status` puede informar `not_running`; iniciar el
  servidor solo si la tarea lo autoriza y una prueba realmente lo requiere.

Las reglas completas siguen en [AGENTS.md](../AGENTS.md),
[REGLAS_CODEX.md](REGLAS_CODEX.md) y [MAPA_PRUEBAS.md](MAPA_PRUEBAS.md).
