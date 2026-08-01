# SAAS-C: diseno de pagos manuales de suscripcion

## Alcance de SAAS-C0

Este documento define el contrato tecnico futuro para pagos manuales de
suscripciones. SAAS-C0 no agrega rutas, tablas, archivos binarios ni cambios
funcionales. La estructura propuesta debe validarse de nuevo contra el esquema
real antes de crear la migracion 023.

Politicas ya confirmadas:

- moneda inicial `BOB`;
- revision y aprobacion manual por superadmin;
- mensual y anual como periodos comerciales;
- prueba Basico de 30 dias sin tarjeta;
- upgrade inmediato y sin prorrateo, conservando `fechaFin`;
- downgrade al siguiente periodo;
- renovacion antes del vencimiento o en gracia desde `fechaFin`;
- renovacion tras suspension desde la fecha actual;
- pago pendiente, observado o rechazado no modifica la suscripcion;
- cancelacion conserva los datos y no se revierte por un pago accidental;
- no hay pasarela, cobro automatico, conciliacion bancaria ni job.

## Estado actual auditado

### Estructuras reutilizables

- `plan`, `funcionalidad` y `planFuncionalidad` son el catalogo vigente.
- `suscripcionTienda` contiene el periodo y el snapshot tipado del plan.
- `suscripcionFuncionalidadSnapshot` congela funcionalidades por periodo.
- `historialSuscripcionTienda` registra solo efectos del ciclo de vida.
- `operacionSuscripcionTienda` aporta el patron hash-only para idempotencia.
- `subscription-lifecycle-service` implementa renovacion, reactivacion,
  suspension y cancelacion con bloqueo tienda -> suscripcion.
- `subscription-plan-service` implementa upgrade inmediato y downgrade
  programado usando el snapshot vigente.
- `subscription-access-policy` y `middleware/subscription.js` centralizan
  acceso completo, solo lectura y acceso restringido.
- `routes/subscription.js` deriva el tenant de sesion; el panel global usa
  `routes/admin-subscriptions.js` con superadmin y referencia de tienda
  validada.
- `eventoAuditoriaAdministrativa` y su contrato permiten auditoria sanitizada.
- `multer` existe, pero solo se usa con `memoryStorage` para XLSX de catalogo.
- `configuracionTienda.moneda` confirma `BOB` para la configuracion inicial.

### Estructuras que no deben reutilizarse

- `pagoVenta`, `pagoFiado`, `cobroFiado` y sus comprobantes representan dinero
  comercial de una tienda, no ingresos SaaS de la plataforma.
- Los comprobantes HTML de ventas, cobranza y compensaciones no almacenan
  archivos y no sirven como evidencia de pago de una suscripcion.
- `operacionCompensatoria` pertenece a correcciones comerciales y no debe
  convertirse en solicitud de pago SaaS.
- `solicitudRegistroPublico` tiene un contrato y ciclo de vida distintos.
- `operacionSuscripcionTienda` debe seguir registrando efectos sobre la
  suscripcion; no debe absorber cargas, revisiones ni estados del comprobante.

### Brechas reales

- No existe solicitud de pago, comprobante persistente, revision ni historial
  propio del proceso de pago.
- `plan.precioMensual` no modela precios mensual y anual versionados. Los
  precios actuales son `0`, por lo que no hay un monto comercial cobrable.
- No existe catalogo de metodos ni instrucciones de pago manual.
- No existe almacenamiento privado persistente, descarga autenticada,
  deteccion de MIME por contenido, cuarentena ni limpieza de huerfanos.
- Los servicios B2/B4 abren sus propias transacciones. Para aprobar y aplicar
  en una sola transaccion, C5 necesitara variantes internas que reciban una
  conexion ya bloqueada, conservando los wrappers publicos actuales.
- La allowlist restringida de B3 no incluye pagos. Las rutas futuras deberan
  habilitarse de forma explicita para gracia, suspension y cancelacion sin
  abrir rutas comerciales generales.
- El backup actual cubre MySQL, no archivos privados de comprobantes.

## Modelo conceptual recomendado

Mantener una maquina de estados principal para la solicitud y entidades
append-only separadas para comprobantes, revisiones e historial. Esto evita
usar tres estados mutables que puedan contradecirse.

### Solicitud

`solicitudPagoSuscripcion` representa una intencion comercial congelada:

- `idTienda`, suscripcion base y plan objetivo;
- referencia publica aleatoria y opaca;
- operacion, periodo y metodo de pago allowlisted;
- monto esperado y moneda calculados por backend;
- vencimiento y estados de flujo;
- snapshot tipado de plan, precio, limites y funcionalidades;
- actor creador, ultimo actor y fechas de transicion;
- suscripcion e historial de suscripcion resultantes, solo despues de aplicar.

El frontend nunca envia monto, moneda, fechas, snapshot, tenant, estado ni
identificadores internos. Envia codigo de plan, periodo y operacion permitida.

### Comprobante

`comprobantePagoSuscripcion` contiene una version de archivo:

- solicitud y tenant;
- referencia publica propia;
- version monotona;
- clave opaca del objeto, nunca ruta fisica;
- nombre generado, MIME detectado, tamano y SHA-256;
- actor, fecha y estado `cargado|reemplazado|invalido|aceptado`.

Una nueva version no sobrescribe la anterior. La version vigente se decide
dentro del bloqueo de la solicitud; MySQL no ofrece un indice parcial adecuado
para imponer por si solo una unica fila vigente.

### Revision

`revisionPagoSuscripcion` es append-only y registra una decision
`observada|rechazada|aprobada`, motivo controlado, observacion limitada,
superadmin, estado anterior/nuevo y fecha. No almacena el archivo ni su ruta.

### Aplicacion

La aplicacion no requiere una tabla contable general en la primera version.
La solicitud aplicada conserva enlaces a la suscripcion resultante y al evento
de `historialSuscripcionTienda`. El historial de suscripcion registra solo el
efecto final: renovacion, reactivacion, upgrade o downgrade aplicado.

## Estados y transiciones

Estados persistidos recomendados para la solicitud:

- `pendiente_comprobante`: creada y cotizada; puede recibir o reemplazar archivo;
- `pendiente_revision`: comprobante vigente enviado para revision;
- `observada`: requiere una nueva version o correccion del propietario;
- `rechazada`: terminal, no modifica la suscripcion;
- `aplicada`: terminal, aprobacion y efecto confirmados;
- `cancelada`: terminal por propietario o superadmin;
- `vencida`: terminal al superar el plazo efectivo sin envio valido.

No se necesita `borrador`: la seleccion permanece en el navegador hasta crear
una cotizacion valida. Tampoco conviene un estado persistido `aprobada` en la
primera version. La aprobacion y la aplicacion deben ocurrir en una sola
transaccion; el historial puede registrar ambos pasos. Si una futura pasarela
exige procesamiento asincrono, ese estado se agregara mediante otra migracion.

Transiciones validas:

| Desde | Accion | Hacia |
| --- | --- | --- |
| pendiente_comprobante | enviar comprobante vigente | pendiente_revision |
| pendiente_revision | observar | observada |
| observada | reemplazar y reenviar | pendiente_revision |
| pendiente_revision | rechazar | rechazada |
| pendiente_revision | aprobar y aplicar | aplicada |
| pendiente_comprobante u observada | cancelar | cancelada |
| estado abierto sin envio vigente | vencer efectivamente | vencida |

Los estados terminales no reabren. Una correccion crea version e historial
nuevos. Un fallo al aplicar deja la solicitud en `pendiente_revision` y revierte
la decision de aprobacion completa.

## Operaciones y precios

Operaciones con pago inicial:

- renovacion mensual o anual;
- reactivacion despues de suspension por vencimiento;
- nueva activacion explicita, si se autoriza para una cancelada;
- upgrade inmediato, despues de confirmar su formula de cobro.

Operaciones administrativas sin solicitud de pago:

- suspension y cancelacion;
- extension de cortesia;
- downgrade programado por si solo.

Un pago de renovacion puede aplicar el plan programado por B4 al abrir el
siguiente periodo. La solicitud debe congelar ese plan como objetivo. No se
permite que una aprobacion elimine silenciosamente otro downgrade ni reactive
una cancelada: cualquier nueva activacion usa una operacion distinta.

### Catalogo de precios

Se recomienda `precioPlanPeriodo`, versionado por plan, periodo y moneda:

- el catalogo es fuente para nuevas cotizaciones;
- la solicitud guarda un snapshot tipado e inmutable;
- editar un precio no altera solicitudes existentes ni periodos aplicados;
- el backend rechaza periodos sin precio activo;
- solo se migra un precio mensual existente si es positivo y fue confirmado;
- no debe inventarse un precio anual durante la migracion.

`metodoPagoSuscripcion` debe mantener codigo, nombre, instrucciones publicas,
estado y orden. La solicitud congela codigo, nombre e instrucciones usadas al
crearse. No se versionan cuentas, QR o instrucciones en codigo fuente y ningun
metodo se habilita hasta que el usuario confirme sus datos operativos.

Promociones, descuentos, cupones e impuestos quedan fuera. Cuando existan,
deben ser conceptos tipados del snapshot, no montos arbitrarios del cliente.

## Flujo del propietario

1. Consulta `/api/suscripcion` y los planes permitidos.
2. Solicita una cotizacion indicando operacion, plan y periodo.
3. El backend valida el estado actual, calcula precio y crea una sola solicitud
   abierta para la tienda.
4. La respuesta muestra referencia, monto, moneda, vencimiento e instrucciones
   sanitizadas.
5. Carga una version de comprobante y la envia a revision.
6. Consulta estado, observacion segura e historial propio.
7. Si queda observada, carga otra version y reenvia.
8. Si queda aplicada, vuelve a consultar la suscripcion ya actualizada.

Abandonar una solicitud no modifica la suscripcion. Una solicitud nueva con
otra huella entra en conflicto mientras exista una abierta. Si la suscripcion
cambia por otra via, el envio o aprobacion revalida el snapshot; no recalcula
ni cambia silenciosamente la solicitud.

## Flujo del superadmin

El panel global ofrece resumen, cola, filtros allowlisted, detalle, comprobante,
posibles duplicados y el efecto previsto. Las acciones son observar, rechazar,
aprobar/aplicar y cancelar.

Antes de aprobar debe mostrar y volver a validar:

- tienda y suscripcion actuales;
- plan actual y objetivo;
- operacion y periodo;
- monto y moneda congelados;
- comprobante vigente y hash abreviado solo en UI administrativa;
- cambios de suscripcion posteriores a la cotizacion;
- downgrade programado, exceso de limites y estado cancelado/suspendido;
- efecto exacto sobre `fechaInicio`, `fechaFin` y snapshot.

Las consultas no generan auditoria masiva. Cada mutacion produce un solo evento
de revision y, si aplica, un solo evento administrativo.

## Aprobacion y aplicacion

Recomendacion: aprobar y aplicar en una sola transaccion MySQL.

Orden de bloqueo obligatorio:

1. `tienda`;
2. `suscripcionTienda` vigente o base;
3. `solicitudPagoSuscripcion`;
4. plan y precio objetivo;
5. comprobante vigente;
6. operacion idempotente;
7. inserciones de revision, historiales y auditoria.

El servicio de aplicacion debe usar variantes internas de B2/B4 sobre la misma
conexion. No debe llamar rutas HTTP ni abrir una transaccion anidada. En una
aprobacion correcta se actualizan solicitud, suscripcion, historial de pago,
historial de suscripcion, revision y auditoria antes del commit. Cualquier fallo
revierte todo.

Una clave interna determinista enlaza la solicitud con B2/B4, pero solo se
persiste mediante hash. Repetir la aprobacion devuelve el resultado anterior;
una huella distinta produce conflicto.

## Comprobantes y almacenamiento

Formatos iniciales recomendados: PDF, JPEG y PNG, hasta 5 MiB y un archivo por
version. El limite final requiere confirmacion comercial.

Controles obligatorios:

- `multer` con limite de bytes y una sola parte;
- deteccion por magic bytes, no solo extension o `Content-Type`;
- nombre y clave de objeto generados por CSPRNG;
- almacenamiento fuera de `public`, del repositorio y de backups Git;
- hash SHA-256 calculado durante la escritura;
- rechazo de ejecutables, archivos poliglotas evidentes y contenido vacio;
- descarga autenticada, `no-store`, `nosniff` y sin ruta fisica;
- imagenes pueden previsualizarse como Blob temporal; PDF se descarga en la
  primera version para reducir contenido activo embebido;
- reemplazo versionado y eliminacion logica, sin sobreescritura;
- limpieza de temporales y objetos huerfanos atribuibles.

Crear una interfaz `receipt-storage` con `put`, `open`, `removeTemporary` y
`health`. En local usa un directorio privado configurable fuera del arbol
publico. Staging/produccion deben usar almacenamiento de objetos privado y URLs
temporales o streaming autenticado. MySQL guarda metadata, nunca el binario.

No existe transaccion distribuida con el almacenamiento. El flujo seguro es:

1. escribir bajo una clave temporal opaca;
2. validar bytes, tamano, MIME y hash;
3. promover a clave privada definitiva;
4. insertar metadata dentro de la transaccion de solicitud;
5. si falla MySQL, borrar solo el objeto atribuible en `finally`;
6. un comprobador elimina temporales antiguos no referenciados.

El backup de MySQL no basta. C3 debe definir backup, manifiesto, checksum y
restauracion de objetos privados sin incorporar archivos al repositorio.

## Seguridad y privacidad

- Propietario: `requireAuth`, `requireTenant`; tenant solo desde sesion.
- Superadmin: `requireAuth`, `requireRole('superadmin')`; tienda resuelta desde
  referencia opaca/slug validado en la ruta global.
- Mutaciones: origen, `X-Requested-With`, CSRF vigente, rate limit dedicado,
  body/archivo acotado e idempotencia.
- Consultas y descargas: `no-store`, filtros/paginacion allowlisted y SQL
  parametrizado por tenant.
- La politica B3 debe permitir pagos y descarga propia en gracia/suspension,
  pero denegar por defecto cualquier ruta comercial no allowlisted.
- El router del propietario se monta con `requireAuth`, `requireTenant` y
  `resolveSubscription`, antes del guard comercial general, y agrega un guard
  exclusivo de pagos. Asi una tienda restringida consulta o regulariza su
  solicitud sin abrir productos, ventas ni otras APIs.
- Ninguna respuesta expone `idTienda`, ids internos, hash completo, clave de
  almacenamiento, ruta fisica, SQL, stack o metadata de otra tienda.
- Auditoria no incluye archivo, body, clave idempotente, hash completo, datos
  bancarios ni observacion sin sanitizar.
- Los comprobantes pueden contener nombres, cuentas, telefono, QR, monto y
  fecha. Deben cifrarse en reposo cuando el proveedor lo permita, limitarse al
  propietario y superadmins autorizados y no indexarse publicamente.
- La retencion y destruccion fisica requieren politica legal/comercial
  confirmada. Hasta entonces no hay purga automatica.

## Idempotencia, duplicados y concurrencia

Crear `operacionPagoSuscripcion`; no ampliar el ENUM de la tabla B1 para
operaciones de archivos. Tipos: crear, cargar, reemplazar, enviar, observar,
rechazar, aprobar, cancelar y vencer. Guarda solo hash de clave, hash de payload,
estado, solicitud/resultado minimo y timestamps.

Politica recomendada de duplicados:

- una sola solicitud abierta por tienda, sin importar el tipo;
- misma clave y misma huella devuelve la misma referencia;
- misma clave con otra huella responde conflicto;
- una terminal permite crear otra solicitud;
- hash de archivo no es UNIQUE: comprobantes legitimos pueden coincidir;
- el propietario no recibe senales de duplicados de otras tiendas;
- el superadmin puede ver un indicador global agregado, nunca datos ajenos por
  una ruta de propietario.

El bloqueo de tienda serializa creacion y aplicacion por tenant. Dos cargas se
ordenan por solicitud y version. Aprobar/rechazar/cancelar en paralelo produce
un solo estado terminal. Operaciones sobre tiendas distintas no comparten
estado ni cache.

## Vencimiento

Recomendacion inicial, sujeta a confirmacion:

- cotizacion sin enviar: 72 horas;
- comprobante enviado a tiempo: permanece revisable aunque pase ese plazo;
- observada: 72 horas para reenviar antes de vencer;
- no existe reapertura; una terminal crea una solicitud nueva.

Sin job, el estado efectivo se calcula y materializa al consultar o mutar,
siguiendo el patron B2. Al aprobar siempre se revalida la suscripcion y el plan;
si cambiaron de forma incompatible, no se aplica y se devuelve conflicto seguro.

## Auditoria e historiales

Separacion de fuentes:

- `historialSolicitudPagoSuscripcion`: cada transicion del flujo y cada version;
- `revisionPagoSuscripcion`: decisiones humanas y motivo controlado;
- `eventoAuditoriaAdministrativa`: actor y resultado de mutaciones sensibles;
- `historialSuscripcionTienda`: solo el efecto confirmado sobre la suscripcion.

Eventos futuros: solicitud creada, comprobante cargado/reemplazado, enviada,
observada, corregida, rechazada, aprobada/aplicada, cancelada y vencida.
Metadata permitida: operacion, planCodigo, periodo, monto, moneda, transicion y
codigo de motivo. No incluir archivo, body, ruta, clave, hash completo, cuenta,
QR, SQL ni stack.

## Rutas conceptuales

Propietario:

- `GET /api/pagos-suscripcion/solicitudes`
- `POST /api/pagos-suscripcion/solicitudes`
- `GET /api/pagos-suscripcion/solicitudes/:referencia`
- `POST /api/pagos-suscripcion/solicitudes/:referencia/comprobantes`
- `POST /api/pagos-suscripcion/solicitudes/:referencia/enviar`
- `POST /api/pagos-suscripcion/solicitudes/:referencia/cancelar`
- `GET /api/pagos-suscripcion/solicitudes/:referencia/comprobantes/:archivo`

Superadmin:

- `GET /api/admin/pagos-suscripcion`
- `GET /api/admin/pagos-suscripcion/resumen`
- `GET /api/admin/pagos-suscripcion/:referencia`
- `POST /api/admin/pagos-suscripcion/:referencia/observar`
- `POST /api/admin/pagos-suscripcion/:referencia/rechazar`
- `POST /api/admin/pagos-suscripcion/:referencia/aprobar`
- `POST /api/admin/pagos-suscripcion/:referencia/cancelar`
- `GET /api/admin/pagos-suscripcion/:referencia/comprobantes/:archivo`

No se expone `/aplicar`: en la primera version forma parte atomica de aprobar.

## Interfaz conceptual

Propietario: extender la pantalla de suscripcion con cotizacion, instrucciones,
carga, estado, observacion y linea de tiempo. Deshabilitar doble envio, anunciar
progreso/error y no mostrar ids. Debe seguir disponible en gracia y suspension.

Superadmin: nueva seccion en el panel con resumen, cola, filtros, detalle,
metadata segura del archivo, comparacion actual/objetivo, efecto previsto y
confirmaciones para observar, rechazar, aprobar/aplicar y cancelar.

La vista no reemplaza controles backend. Browser futuro: 360x800, 768x1024 y
1366x768, teclado, foco, dialogos, cargas, error de red, doble clic, consola y
`pageerror` limpios.

## Migracion 023 propuesta

Tablas nuevas:

1. `metodoPagoSuscripcion`: metodos e instrucciones manuales allowlisted.
2. `precioPlanPeriodo`: FK plan, periodo, moneda, monto, vigencia y activo.
3. `solicitudPagoSuscripcion`: tenant, referencias, estados, operacion,
   snapshots, monto, vencimiento y enlaces de aplicacion.
4. `solicitudPagoFuncionalidadSnapshot`: snapshot normalizado de funciones.
5. `comprobantePagoSuscripcion`: versiones y metadata de almacenamiento.
6. `revisionPagoSuscripcion`: decisiones append-only.
7. `historialSolicitudPagoSuscripcion`: transiciones append-only.
8. `operacionPagoSuscripcion`: idempotencia hash-only.

Indices y restricciones minimos:

- referencias publicas unicas y opacas;
- FKs compuestas por `idTienda` para solicitud, comprobante e historial;
- `(idTienda,estado,creadoEn)` para solicitudes abiertas;
- `(idTienda,idSolicitud,version)` UNIQUE para comprobantes;
- indices por hash de archivo, cola de revision y vencimiento;
- CHECKs para hashes hexadecimales, montos positivos, moneda `BOB`, fechas,
  actor/estado y enlaces de aplicacion coherentes;
- `ON DELETE RESTRICT` en historicos y comprobantes;
- no intentar un indice parcial para solicitud abierta o archivo vigente: el
  servicio lo garantiza bloqueando la tienda y solicitud.

Backfill: crear precios mensuales BOB solo para valores positivos confirmados;
los ceros actuales no se vuelven cobrables. No crear metodos activos,
solicitudes, revisiones, comprobantes, operaciones ni eventos retroactivos. Los
precios y metodos deben configurarse expresamente antes de habilitar solicitudes.
Rollback conceptual: solo sobre base temporal sin datos C; en una base usada,
preservar historicos y revertir mediante migracion posterior, no `DROP` manual.

## Mapa de pruebas futuro

| Nivel | Scripts sugeridos | Cobertura y recursos |
| --- | --- | --- |
| Esquema | `test:subscription-payments-schema`, `db:check-subscription-payments` | 023, backfill, FKs, CHECKs, snapshots, temporal |
| Dominio | `test:subscription-payment-requests` | precios backend, estados, vencimiento, duplicados, tenant |
| Archivos | `test:subscription-payment-receipts` | MIME real, tamano, hash, versiones, traversal, huerfanos |
| Revision | `test:subscription-payment-review` | observar, rechazar, aprobar, idempotencia, rollback |
| Aplicacion | `test:subscription-payment-application` | B2/B4, periodos, upgrade, downgrade, cancelada, concurrencia |
| Seguridad | `test:subscription-payment-security` | auth, tenant, superadmin, CSRF, rate limit, no-store, descargas |
| Browser | `test:subscription-payment-browser` | propietario/admin, tres viewports, teclado, doble clic, errores |
| Cierre | `test:saas-c-e2e` | flujo integral, dos tiendas, limpieza y compatibilidad A/B |

Cada nombre debe agregarse a `package.json` y `MAPA_PRUEBAS.md` solo cuando el
arnes exista. Los arneses deben usar fixtures sinteticos, almacenamiento temporal
atribuible y limpieza en `finally` de DB, objetos, browser, procesos y puertos.

## Fases recomendadas

| Fase | Objetivo | Condicion de cierre |
| --- | --- | --- |
| C0 | Auditoria y este diseno | documentacion validada; cero codigo/base |
| C1 | Contratos, precios y migracion 023 | ensayo temporal, snapshot/backfill y principal sin aplicar |
| C2 | Solicitud/cotizacion del propietario | API tenant, precio backend, estados, idempotencia |
| C3 | Comprobantes y storage privado | upload/descarga, versiones, MIME/hash, huerfanos, backup |
| C4 | Cola y revision superadmin | filtros, detalle, observar/rechazar/cancelar, auditoria |
| C5 | Aprobacion y aplicacion atomica | B2/B4 en una transaccion, concurrencia y rollback |
| C6 | Frontend propietario y superadmin | responsive, accesible, sin doble envio ni ids internos |
| C7 | Seguridad y regresion integral | dos tenants, archivos, carreras, browser y compatibilidad A/B |
| C8 | Cierre documental y Git | huella intacta, cero residuos y macrofase cerrada |

## Decisiones pendientes antes de C1

1. Catalogo real de precios BOB, en especial precio anual y formula de cobro
   para upgrade sin prorrateo.
2. Metodos e instrucciones manuales permitidos y si contienen datos que deban
   administrarse fuera del repositorio.
3. Plazos definitivos: vigencia de cotizacion/observacion, maximo de archivo y
   politica legal/comercial de retencion y destruccion.

No son bloqueos de C0. Si no se confirman antes de C1, la migracion puede crear
la estructura, pero no debe habilitar solicitudes cobrables con valores
inventados.
