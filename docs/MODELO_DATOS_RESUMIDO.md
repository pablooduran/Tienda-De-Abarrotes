# Modelo de datos resumido

Mapa operativo del esquema versionado. Las fuentes de verdad son
[migraciones](../database/migrations/), el
[esquema inicial](../database/tienda_abarrotes.sql),
[AGENTS.md](../AGENTS.md), [REGLAS_CODEX.md](REGLAS_CODEX.md),
[ARQUITECTURA_RESUMIDA.md](ARQUITECTURA_RESUMIDA.md),
[SEGURIDAD_Y_MULTITIENDA.md](SEGURIDAD_Y_MULTITIENDA.md) y
[MAPA_PRUEBAS.md](MAPA_PRUEBAS.md). No sustituye el SQL cuando se necesita una
columna, FK o constraint exacto.

## Convenciones generales

- `idTienda` es el ownership principal de las entidades comerciales. Las
  relaciones y consultas de dominio deben conservarlo, incluso en joins y
  agregados.
- Predominan claves primarias numericas por tabla; las relaciones de tenant,
  producto, venta, lote y administrador se respaldan con FKs e indices del
  esquema. Algunas tablas usan restricciones unicas compuestas para evitar
  duplicados operativos.
- Las fechas comerciales se interpretan en `America/La_Paz`. Las columnas de
  creacion y actualizacion son historicas, no sustituyen la fecha comercial de
  una operacion.
- Estados como activo, oculto, vigente, aplicado o compensado preservan
  historial. No usar DELETE fisico ni mutar un registro historico para ocultar
  una correccion.
- Ventas, pagos, cobros, movimientos de stock/lote, compensaciones, ajustes y
  eventos de auditoria son tablas transaccionales o append-only segun dominio.

## Dominios principales

| Dominio | Tablas principales y PK | Ownership | Relaciones e historicos | Restricciones y notas | Migraciones |
| --- | --- | --- | --- | --- | --- |
| Tiendas y administracion | `tienda(idTienda)`, `configuracionTienda(idConfiguracionTienda)`, `administrador(idAdministrador)` | `tienda` es raiz; configuracion es uno a uno por `idTienda`; superadmin puede no tener tienda | administrador propietario referencia tienda; configuracion conserva nombre mostrado, moneda y zona; version de sesion invalida sesiones | usuario y rol controlados; configuracion base no contiene plan, permisos ni datos comerciales | 004, 013, 020, 021 |
| Planes y suscripciones | `plan(idPlan)`, `funcionalidad(idFuncionalidad)`, `planFuncionalidad`, `suscripcionTienda(idSuscripcion)`, `suscripcionFuncionalidadSnapshot`, `historialSuscripcionTienda(idHistorialSuscripcion)`, `operacionSuscripcionTienda(idOperacionSuscripcion)` | suscripcion, snapshot, historial y operacion pertenecen a tienda; superadmin resuelve contexto global mediante referencia validada | el catalogo alimenta altas; cada periodo congela plan, limites y funciones; upgrade reemplaza el snapshot vigente y downgrade usa `idPlanSiguiente` hasta abrir el periodo siguiente; historial es append-only | bloqueo operativo en orden tienda-suscripcion-plan; claves y payloads idempotentes solo mediante hash; limites desde snapshot; suspension, reactivacion, renovacion tecnica y cancelacion conservan datos | 005, 022 |
| Pagos de suscripcion | `precioPlanPeriodo`, `tipoCambioSuscripcion`, `metodoPagoSuscripcion`, `solicitudPagoSuscripcion`, `solicitudPagoFuncionalidadSnapshot`, `comprobantePagoSuscripcion`, `revisionPagoSuscripcion`, `historialSolicitudPagoSuscripcion`, `aplicacionPagoSuscripcion`, `operacionPagoSuscripcion` | toda solicitud y sus historicos incluyen `idTienda`; tasa y metodos son globales y solo superadmin los administra | C2 congela precio USD, tasa USD/BOB, monto BOB, planes, limites, funciones y metodo; C3 guarda metadata/version y archivo bajo clave opaca privada; C4 revisa; C5 aplica atomica y una sola vez a B2/B4 | una solicitud abierta y una aplicacion por solicitud; idempotencia hash-only global/tenant; una version activa de comprobante; descarga autenticada/no-store; pagos manuales sin tarjeta, QR dinamico, webhook ni conciliacion | 023, 024 |
| Sesiones y autenticacion | `administrador`; tabla `sessions` gestionada por el store MySQL | actor puede ser global o de tienda | sesion valida administrador y su version | no documentar ni consultar contenido de sesion fuera del servicio | 013 |
| Catalogo y productos | `categoriaMaestra`, `marcaMaestra`, `productoMaestro`, `auditoriaCatalogo`, `producto(idProducto)`, `proveedor(idProveedor)` | producto y proveedor pertenecen a tienda; catalogo maestro es global | producto puede referenciar catalogo; auditoria de catalogo conserva cambios | precio, stock y activo se validan por servicio; no usar maestro como tenant comercial | 001, 004, 006 |
| Clientes y credito | `cliente(idCliente)`, `configuracionCreditoTienda(idTienda)` | cliente y configuracion son de tienda | venta y fiado referencian cliente; ocultacion conserva historial | documento unico por tenant; activo/oculto no borra deuda ni historial | 003, 012 |
| Ventas y detalle | `venta(idVenta)`, `detalleVenta(idDetalleVenta)` | venta y detalle pertenecen a tienda | detalle enlaza venta-producto; pago, fiado, stock y lote derivan de venta | originales no se reescriben; `estadoOperacion` distingue vigente/anulada/devuelta parcial | 001, 008, 014-017 |
| Pagos, fiados y cobranza | `fiado(idFiado)`, `detalleFiado`, `cobroFiado(idCobroFiado)`, `pagoFiado`, `pagoVenta` | todas las operaciones son de tienda | pagos distribuyen cobros y ventas; seguimiento y plantillas se asocian al cliente/tienda | importes historicos positivos, saldo nunca negativo; `fiado.activo` no es estado de anulacion | 008, 012, 016 |
| Seguimiento y plantillas | `seguimientoCobranza`, `plantillaCobranzaTienda` | tienda | seguimiento referencia cliente y actor; plantilla es por tipo y tienda | texto tratado como texto, variables allowlist; no envio automatico | 012 |
| Finanzas y caja | `categoriaGasto`, `gasto(idGasto)`, `cierreCaja(idCierreCaja)` | tienda | gastos y cobros alimentan reportes; cierre congela su periodo | ajustes posteriores no recalculan cierres previos | 009, 017 |
| Compensacion base | `operacionCompensatoria(idOperacionCompensatoria)` | tienda obligatoria | relaciona solicitante/aprobador, entidad original e idempotencia | clave unica por tienda; append-only; no reemplaza el estado de pago | 014 |
| Compensacion de venta e inventario | `compensacionVenta`, `detalleCompensacionVenta`, `detalleCompensacionLote`, `liquidacionCompensacionVenta` | tienda | enlaza venta, detalles, movimientos de stock y lotes | acumulado devuelto no supera vendido; liquidacion pendiente separa efecto comercial/financiero | 015 |
| Compensacion financiera | `resolucionLiquidacionVenta`, `obligacionReembolsoVenta`, `detalleObligacionReembolsoPago`, `compensacionCobroFiado`, `detalleCompensacionCobro`, `compensacionPagoVenta` | tienda | vinculos con venta, pagos, fiado y cobro originales | no crear fiado negativo ni reembolso automatico; correccion conserva neto | 016 |
| Liquidaciones materiales | `movimientoLiquidacionCompensacion` | tienda | registra salida material vinculada a obligacion o compensacion | reembolso material se registra en fecha real y separado del neto comercial | 017 |
| Stock y lotes | `movimientoStock(idMovimientoStock)`, `loteProducto(idLoteProducto)`, `movimientoLote(idMovimientoLote)` | producto, lote y movimientos son de tienda | producto agrega fisico; lote y movimientoLote conservan origen, costo y vencimiento | FEFO/FIFO, cantidades no negativas y lotes tecnicos no vendibles | 002, 007, 011, 015, 019 |
| Ajustes y conciliacion | `ajusteInventario(idAjusteInventario)`; configuracion en `configuracionInventarioTienda` | tienda | ajuste referencia producto, lote cuando aplica, actor y movimientos creados | transaccional, idempotente, con motivo; conciliacion es solo lectura | 010, 019 |
| Inteligencia de inventario | `configuracionInventarioTienda` y datos derivados de ventas, stock y lotes | configuracion por tienda | no requiere tabla de rotacion persistente | rotacion, alertas y sugerencias se calculan; ventas netas excluyen compensaciones segun contrato | 010, 019 |
| Auditoria administrativa y comercial | `eventoAuditoriaAdministrativa(idEventoAuditoriaAdministrativa)`; `auditoriaCatalogo` | tenant nullable para evento global; comercial por tienda | actor puede ser administrador, sistema o anonimo; referencia entidad segura | append-only, allowlists y acceso protegido; sin payloads ni secretos | 006, 018 |
| Exportaciones y operacion | no hay tabla comercial exclusiva de exportacion; health usa servicios y manifiestos externos | siempre conserva tenant y permisos del dominio | exportaciones leen tablas del dominio; health revisa migraciones y backup sin escribir | no persistir secretos ni backups en Git; backup no es parte del esquema comercial | 013-019 segun dominio |

## Relaciones operativas criticas

- `tienda` delimita producto, cliente, venta, fiado, stock, lote, gasto,
  suscripcion, auditoria y compensacion. La aplicacion deriva el tenant desde
  backend; el frontend no lo define.
- `venta` -> `detalleVenta` -> `producto`; una venta puede generar pagos,
  fiado y movimientos de inventario. La compensacion referencia la operacion
  original sin destruirla.
- `producto` -> `movimientoStock`; los productos con lote agregan
  `loteProducto` y `movimientoLote`. La suma fisica debe conciliar con los
  movimientos y lotes aplicables.
- `fiado` recibe `pagoFiado` distribuido desde `cobroFiado`; las compensaciones
  financieras conservan los pagos y cobros originales como referencia.
- La auditoria registra metadatos de resultado, actor y referencia; nunca es
  una fuente para reconstruir saldos ni reemplaza las tablas transaccionales.

## Invariantes

- Toda entidad comercial pertenece a una tienda y consultas, exportaciones y
  agregados filtran por tenant.
- No modificar migraciones aplicadas ni borrar historicos criticos.
- No alterar cantidades de lote fuera de una operacion autorizada y trazable.
- Stock fisico, vendible y no vendible deben conciliar: vencido, bloqueado,
  aislado o tecnico nunca integra stock vendible.
- Ajustes de inventario son transaccionales e idempotentes; una falla revierte
  movimientos y acumuladores asociados.
- Ventas anuladas se excluyen y devoluciones se descuentan segun el contrato
  de cada reporte; no reinterpretar originales.
- Auditoria y compensaciones son append-only. La correccion crea una nueva
  operacion vinculada, no una edicion silenciosa.

## Migraciones 001-023

| Numero | Proposito | Dominio | Cambio principal | Backfill / criticidad |
| --- | --- | --- | --- | --- |
| 001 | Mejoras iniciales de tienda | productos, ventas, fiados | columnas e indices operativos | sensible para historicos iniciales |
| 002 | Stock y reportes | producto e inventario | stock y soporte de reportes | base para conciliacion |
| 003 | Borrado logico | clientes | estados de ocultacion/eliminacion | preserva historial |
| 004 | Base multitienda | tienda y entidades comerciales | tabla raiz, ownership y FKs | critica: aislamiento tenant |
| 005 | Planes y suscripciones | plan y suscripcion | tablas, funcionalidades e indices | critica: acceso por plan |
| 006 | Catalogo maestro | catalogo y auditoria | tablas maestras y vinculos de producto | auditoria de catalogo |
| 007 | Movimientos de stock | inventario | movimientos trazables e indices | critica: conciliacion |
| 008 | POS y pagos | ventas y pagos | pagos, detalle y soporte POS | critica: importes y transacciones |
| 009 | Finanzas y caja | gastos, reportes, cierres | tablas financieras y cierre | historicos de periodos |
| 010 | Inteligencia de inventario | configuracion | configuracion por tienda | no persiste rotacion calculada |
| 011 | Lotes y vencimientos | lotes | lotes, movimientos y constraints | critica: FEFO/FIFO y vencimiento |
| 012 | Clientes y cobranza | cliente, fiado, seguimiento | credito, cobros, plantillas y historicos | datos comerciales sensibles |
| 013 | Seguridad de sesiones | administrador y sesiones | versionado y controles de sesion | critica: revocacion |
| 014 | Operaciones compensatorias | compensacion | operacion base, estado de venta, indices | critica: idempotencia y tenant |
| 015 | Compensacion venta-inventario | ventas, stock, lotes | tablas de devolucion y liquidacion pendiente | critica: cantidades y trazabilidad |
| 016 | Compensacion financiera | pagos, fiados, cobros | obligaciones, resoluciones y compensaciones | critica: saldo y neto |
| 017 | Integracion compensatoria | caja y liquidaciones | movimiento material y campos de cierre | backfill seguro, cierres congelados |
| 018 | Auditoria administrativa | auditoria | evento append-only, FKs e indices | critica: trazabilidad y sanitizacion |
| 019 | Stock vendible y ajustes | lotes y ajustes | clasificacion operativa y ajuste inventario | backfill de clasificacion, critica para vendible |
| 020 | Registro publico y acceso | tienda, administrador y tokens | correo normalizado, estados de acceso/onboarding, tokens e idempotencia | compatible con cuentas existentes |
| 021 | Configuracion base de tienda | tienda y onboarding | tabla uno a uno con nombre mostrado, moneda, zona y datos opcionales | backfill desde `tienda.nombre`; no altera datos comerciales |
| 022 | Ciclo de vida de suscripciones | planes y suscripciones | gracia, fechas, snapshot, historial e idempotencia | backfill de snapshots; no crea gracia ni historial retroactivos |
| 023 | Estructura de pagos de suscripcion | catalogo, precios y pagos manuales | Basic/Standard/Pro, avanzado legado, precios USD versionados, tasa USD/BOB, solicitudes, comprobantes, revision, aplicacion e idempotencia | conserva suscripciones/snapshots; no siembra tasa ni solicitudes, archivos, revisiones o pagos |
| 024 | Correccion de idempotencia y snapshot de pagos | pagos de suscripcion | ambito global/tenant, alcances de tasa/metodo, resultados tipados y snapshot textual del plan actual | no crea solicitudes, tasas, configuraciones ni efectos comerciales |

Para una definicion exacta de PK, FK, indice, CHECK o columna, leer la
migracion correspondiente y el esquema actual. No aplicar ni editar una
migracion sin seguir las reglas de [REGLAS_CODEX.md](REGLAS_CODEX.md).
