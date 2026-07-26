# Reglas permanentes para Codex

Estas reglas son obligatorias para los siguientes bloques del proyecto. Se
basan en `README.md`, `docs/CONTINUIDAD_PROYECTO.md`, los scripts reales de
`package.json` y las guardas aplicadas en migraciones, pruebas, seguridad y
backups.

Una instruccion posterior puede agregar restricciones. Solo una autorizacion
explicita del usuario puede exceptuar una regla, y la excepcion se limita al
alcance indicado. Ante duda o conflicto, detenerse e informar.

## 1. Entorno

- Trabajar exclusivamente en la rama `mejora-multitienda`.
- Confirmar rama, `HEAD` y estado del working tree antes de editar.
- Usar `APP_ENV=local` para operaciones locales, limitado al proceso cuando
  corresponda.
- La base local autorizada es `tienda_abarrotes_pruebas` en `localhost`.
- Nunca usar Aiven, produccion ni otra conexion remota sin autorizacion
  explicita.
- Usar los scripts reales de `package.json`; no inventar comandos.
- No ejecutar inicializacion, migraciones ni carga de datos sin autorizacion
  explicita.

## 2. Seguridad y multitienda

- Aplicar aislamiento estricto por `idTienda` en consultas, uniones, conteos,
  agregados y escrituras.
- Toda ruta comercial debe conservar sesion, tenant, suscripcion,
  funcionalidad, permisos, CSRF y rate limiting segun su contrato.
- El superadministrador no puede ejecutar operaciones comerciales sin un
  contexto tenant valido.
- El backend es la autoridad; no confiar exclusivamente en controles del
  frontend.
- No exponer SQL, `sqlMessage`, stacks, secretos, tokens, cookies, hashes,
  claves idempotentes ni detalles internos de infraestructura.

## 3. Datos

- Cero `DELETE` fisicos salvo autorizacion expresa.
- No borrar ni sobrescribir registros historicos cuando corresponda registrar
  una anulacion, compensacion o movimiento correctivo.
- Las operaciones criticas deben usar transacciones, rollback completo,
  bloqueos deterministas, control de concurrencia e idempotencia.
- Una repeticion con la misma clave y huella debe ser idempotente; una huella
  distinta debe producir un conflicto controlado.
- Usar `America/La_Paz` para fechas comerciales y comparaciones de negocio.
- No modificar saldos, pagos, stock o historiales directamente para ocultar
  inconsistencias.

## 4. Migraciones

- No modificar migraciones ya aplicadas.
- Toda estructura nueva debe usar la siguiente numeracion disponible obtenida
  del repositorio.
- Probar primero en bases temporales protegidas por las guardas del script
  correspondiente.
- No aplicar una migracion sobre `tienda_abarrotes_pruebas` sin autorizacion
  explicita.
- Mantener `database/tienda_abarrotes.sql` equivalente al resultado de todas
  las migraciones vigentes.
- Antes y despues de migrar, comparar una huella de estructura, migraciones,
  conteos y valores comerciales relevantes.
- Una migracion no se considera correcta solo por estar registrada: validar
  tambien su estructura y datos.

## 5. Archivos prohibidos

- No agregar `.env`, `.env.local`, backups, manifiestos reales, logs,
  temporales, reportes generados ni artefactos de pruebas.
- No guardar ni imprimir contrasenas, tokens, `SESSION_SECRET`, cadenas de
  conexion, certificados u otros valores sensibles.
- Revisar el diff y el staging antes de cada commit para confirmar que no
  contienen secretos ni datos comerciales.

## 6. Niveles de validacion

### Nivel 1: durante la implementacion

- Ejecutar las pruebas nuevas o modificadas.
- Ejecutar `node --check` en cada JavaScript creado o modificado.
- Ejecutar `git diff --check`.
- Ejecutar los comprobadores directamente relacionados con el cambio.

### Nivel 2: antes del commit

- Ejecutar la regresion del modulo afectado.
- Ejecutar seguridad web cuando haya cambios en rutas o frontend.
- Ejecutar aislamiento multitienda cuando exista acceso a datos.
- Revisar el diff completo y agregar unicamente los archivos reportados.

### Nivel 3: cierre de macrofase

- Ejecutar la regresion integral segura definida por el proyecto.
- Confirmar readiness.
- Validar backup y restauracion cuando el alcance lo requiera y exista
  autorizacion.
- Ejecutar pruebas de navegador, responsive y accesibilidad cuando haya
  frontend.
- Confirmar limpieza de bases temporales, procesos y artefactos.

## 7. Git

- No hacer commit ni push salvo autorizacion explicita del prompt vigente.
- No usar `git reset --hard`, `git clean` ni descartar cambios existentes.
- Agregar unicamente los archivos revisados y reportados para el bloque.
- Antes y despues de un commit o push, confirmar rama, hash, sincronizacion y
  working tree.
- Un bloque aprobado debe producir un commit acotado con el mensaje acordado.

## 8. Reporte compacto

Usar siempre este formato:

```text
Resultado:
Archivos:
Migracion:
Pruebas:
Base principal:
Git:
Pendientes:
```

Incluir como maximo tres pendientes reales y no repetir el alcance completo
del prompt.

## 9. Detencion obligatoria

Detenerse inmediatamente ante:

- una conexion remota inesperada;
- una migracion registrada pero incompleta;
- una alteracion no autorizada de la base principal;
- un cambio comercial inesperado;
- secretos detectados en archivos, salida o staging;
- un fallo de integridad, aislamiento multitienda o seguridad.

No corregir manualmente, restaurar, revertir una migracion ni relajar una
prueba para continuar. Conservar la evidencia, informar el punto exacto y
esperar autorizacion.
