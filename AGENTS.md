# Indice operativo para agentes

## Proyecto
Tienda de Abarrotes es una aplicacion multitienda de punto de venta, credito,
cobranza, inventario y administracion. Usa Node.js/Express, MySQL y frontend
web JavaScript sin framework. El trabajo activo ocurre en `mejora-multitienda`.

## Entrada obligatoria
1. Ejecutar `git status --short`, `git branch --show-current` y `git log -10 --oneline`.
2. Confirmar rama correcta y working tree limpio antes de editar.
3. Leer este indice, `docs/REGLAS_CODEX.md` y el apartado relevante de
   `docs/CONTINUIDAD_PROYECTO.md`.
4. Consultar `docs/MAPA_PRUEBAS.md` antes de elegir pruebas.

## Fuentes de verdad
| Situacion | Fuente principal |
| --- | --- |
| Reglas no negociables | `docs/REGLAS_CODEX.md` |
| Estado, modulos y siguientes bloques | `docs/CONTINUIDAD_PROYECTO.md` |
| Scripts disponibles y sus nombres exactos | `package.json` |
| Seleccion de pruebas y limpieza | `docs/MAPA_PRUEBAS.md` |
| Estructura vigente | `database/migrations/` y `database/tienda_abarrotes.sql` |
| Contrato de una funcion | Ruta, servicio y prueba del modulo afectado |

No asumir que la documentacion reemplaza al codigo: verificar las afirmaciones
importantes contra rutas, servicios, migraciones y pruebas reales.

## Skills operativas

Usar solo las skills necesarias; no invocar todas por defecto. La guia breve y
ejemplos viven en [GUIA_CODEX_SKILLS.md](docs/GUIA_CODEX_SKILLS.md).

| Skill | Uso principal |
| --- | --- |
| `$project-navigator` | Ubicar contexto y archivos minimos. |
| `$test-and-cleanup` | Planificar o ejecutar regresion proporcional y limpieza propia. |
| `$release-close` | Revisar y cerrar un bloque ya autorizado. |
| `$safe-migration` | Planificar, ensayar o aplicar una migracion autorizada. |
| `$multitenant-security-review` | Revisar tenant, autorizacion y exposicion de datos. |
| `$browser-harness` | Planificar o ejecutar un arnes browser aislado. |

Prioridad de modos: solo contexto, planificacion sin ejecucion, revision
estatica, simulacion y, solo con autorizacion expresa, ejecucion autorizada.

## Entorno local autorizado
- Usar `APP_ENV=local` para trabajo local y la base local autorizada en
  `localhost`.
- El nombre esperado de la base de pruebas es `tienda_abarrotes_pruebas`.
- Iniciar desarrollo con `npm run start:local`; en Windows el comando
  equivalente es `npm.cmd run start:local`.
- No usar Aiven, produccion ni conexiones remotas sin autorizacion explicita.
- Nunca imprimir ni almacenar secretos, credenciales, tokens o contenido de
  archivos de entorno.

## Reglas criticas
- Aplicar aislamiento estricto por `idTienda` en consultas, joins, agregados y
  mutaciones. El frontend nunca envia ni decide el tenant.
- En operaciones protegidas conservar sesion, tenant, suscripcion,
  funcionalidad, permiso, CSRF y rate limiting. Un superadmin no ejecuta una
  operacion comercial sin contexto tenant.
- No exponer SQL, stacks, hashes, claves idempotentes, rutas internas o datos
  sensibles en respuestas, logs o exportaciones.
- No usar DELETE fisico ni reescribir historicos cuando el dominio requiera una
  compensacion. Usar transacciones, rollback, bloqueos e idempotencia.
- Usar `America/La_Paz` para fechas y dias comerciales.

## Migraciones y datos
- Nunca modificar una migracion aplicada. La estructura nueva usa el siguiente
  numero disponible y actualiza el esquema inicial equivalente.
- Probar migraciones primero en bases temporales. No aplicar una migracion a la
  base principal sin autorizacion explicita.
- Antes y despues de una migracion autorizada, comparar huellas de solo lectura
  y detenerse ante cambios comerciales inesperados.
- No ejecutar inicializacion, seed, migracion, backup, restauracion o limpieza
  destructiva fuera del alcance autorizado.

## Pruebas y Git

- Elegir el nivel minimo suficiente desde `docs/MAPA_PRUEBAS.md`; no ejecutar
  una bateria completa para un cambio pequeno sin motivo.
- Usar timeout y limpieza en `finally` para arneses, servidores y bases
  temporales. No cerrar procesos Edge o Node que no pertenezcan al arnes actual.
- Ejecutar `git diff --check` antes de cerrar. Revisar el diff completo y
  agregar solamente los archivos informados.
- No hacer commit ni push sin autorizacion explicita. No usar `git reset --hard`,
  `git clean` ni descartar cambios ajenos.

## Detencion obligatoria

Detenerse e informar de inmediato ante conexion remota inesperada, migracion
parcial, alteracion no autorizada de la base principal, cambio comercial
inesperado, secreto detectado, o fallo de integridad, tenant o seguridad.
No corregir manualmente esos casos ni restaurar sin autorizacion.

## Reporte compacto

Usar siempre esta forma, con un maximo de tres pendientes:

```text
Resultado:
Archivos:
Migracion:
Pruebas:
Base principal:
Git:
Pendientes:
```
