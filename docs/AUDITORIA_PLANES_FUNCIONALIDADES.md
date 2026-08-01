# Auditoria de planes, limites y funcionalidades

## Alcance y fuentes

Auditoria de solo lectura realizada para preparar SAAS-C1. No modifica planes,
precios, limites, suscripciones ni esquema. Las fuentes verificadas fueron las
migraciones 005-022, el esquema inicial, servicios y middleware de suscripcion,
rutas y frontend comerciales, pruebas B1-B6 y agregados del catalogo local.

Estado comprobado:

- rama `mejora-multitienda`, HEAD `5bfd6eb`, sincronizacion `0/0`;
- `APP_ENV=local`, `localhost`, base `tienda_abarrotes_pruebas`;
- migracion 022 registrada una vez y ausencia de 023;
- `BACKUP_OK`, cero procesos y puertos propios;
- 2 planes activos, 38 funcionalidades activas y 2 tiendas, sin exponer datos
  personales ni identificadores de tiendas.

Clasificacion usada:

- A: implementada y usable con contrato real;
- B: capacidad implementada, pero la clave no se valida de forma independiente;
- C: solo registrada o etiqueta historica sin uso funcional directo;
- D: futura/no implementada;
- E: tecnica o interna;
- F: no apta para diferenciar planes por seguridad o integridad.

Todas las funcionalidades habilitadas al crear un periodo se congelan en
`suscripcionFuncionalidadSnapshot`. Los limites se congelan en columnas tipadas
de `suscripcionTienda`. Editar el catalogo no altera esos snapshots existentes.

## Planes actuales

| id | Codigo | Nombre | Activo | Precio mensual | Duracion | Limites P/P/C/Pr | Tiendas actuales | Uso real |
| --- | --- | --- | --- | ---: | ---: | --- | ---: | --- |
| 1 | `basico` | Basico | si | 0.00, moneda implicita | 30 dias | 1 / 500 / 500 / 100 | 1 | Registro publico, pruebas y destino de downgrade |
| 2 | `avanzado` | Avanzado | si | 0.00, moneda implicita | 30 dias | 5 / ilimitado / ilimitado / ilimitado | 1 | Cortesias historicas, upgrade y pruebas administrativas |

`P/P/C/Pr` significa propietarios activos, productos activos, clientes activos
y proveedores. No hay `standard` ni `pro`, orden comercial, visibilidad publica
separada de `activo`, moneda del precio o precios por periodo. Ambos planes se
leen en backend y en `/suscripcion.html`; sus codigos estan fijados en pruebas y
`basico` tambien en el registro publico.

Uso por capa:

- servicios: `subscription-service` crea y resuelve snapshots;
  `subscription-plan-service` compara entitlements sin inferir jerarquia por
  nombre; `subscription-lifecycle-service` conserva/aplica el plan por periodo;
- frontend: la pantalla de suscripcion muestra el catalogo activo y permite los
  cambios tecnicos B4; el panel superadmin usa los mismos motores;
- pruebas: `test:subscriptions`, `test:subscription-lifecycle-schema`,
  `test:subscription-plan-changes`, `test:subscription-limits`,
  `test:subscription-plan-browser` y `test:saas-subscription-admin` dependen de
  `basico`/`avanzado` o validan sus snapshots.

## Funcionalidades registradas

Las 38 filas estan activas y pueden asignarse por `planFuncionalidad`. `basico`
tiene 19 habilitadas; `avanzado` tiene las 38. La columna Plan usa `B+A` para
ambos planes y `A` para solo Avanzado.

| Codigo | Nombre y proposito | Origen | Estado real | Control o modulo real | Plan | Recomendacion provisional |
| --- | --- | --- | --- | --- | --- | --- |
| `ajuste_stock` | Ajuste de stock protegido | 007 | A/F | stock, conciliacion y auditoria | B+A | todos; la integridad no se vende aparte |
| `alertas_stock` | Agotados, minimo y stock bajo | 010 | A | inteligencia de inventario | B+A | Basic+
| `alertas_vencimiento` | Lotes proximos a vencer | 011 | A | lotes | A | Pro |
| `anulaciones_operativas` | Compensaciones trazables | 014 | A/F | ventas y finanzas compensatorias | B+A | todos; control de integridad |
| `catalogo_maestro` | Alta guiada desde catalogo global | 006 | A | catalogo maestro | B+A | Basic+ |
| `cierre_caja` | Cierres historicos | 005/009 | A | finanzas | A | Standard+ |
| `clientes_basico` | Clientes operativos | 012 | A | clientes y cobranza | B+A | Basic+ |
| `compras_sugeridas` | Reposicion informativa | 005/010 | A | inteligencia y exportacion | A | Standard+ |
| `control_lotes` | Activacion y operacion por lote | 011 | A | lotes | A | Pro |
| `dashboard_financiero` | Indicadores financieros | 009 | A | finanzas y frontend | B+A | Basic+ |
| `dias_cobertura` | Cobertura estimada | 010 | B | dato calculado dentro de inteligencia; sin guardia propia | A | Standard+, unificar con rotacion |
| `estado_cuenta_basico` | Estado de cuenta de cliente | 012 | A | clientes y cobranza | B+A | Basic+ |
| `exportacion_clientes_fiados` | XLSX de clientes, deuda y estado | 012 | A | cobranza y frontend | A | Standard+ |
| `exportacion_inventario` | XLSX de inteligencia | 010 | A | inteligencia | A | Standard+ |
| `exportacion_lotes` | XLSX de lotes | 011 | A | lotes | A | Pro |
| `exportacion_reportes` | XLSX financiero y compensaciones | 009 | A | finanzas/compensaciones | B+A | Standard+ |
| `fiados_basico` | Gestion de deuda originada en venta | 012 | A | API, clientes y cobranza | B+A | Basic+ |
| `gastos` | Gastos operativos | 005/009 | A | finanzas | B+A | Basic+ |
| `historial_stock` | Movimientos de inventario | 005/007 | A/F | stock y ajustes | B+A | todos; conservar historial |
| `inventario_resumen` | Resumen de inventario | 010 | A | inteligencia | B+A | Basic+ |
| `inventario_sin_movimiento` | Productos sin venta reciente | 010 | A | inteligencia | A | Standard+ |
| `limites_credito` | Politicas de credito por tienda | 012 | A | clientes/cobranza | A, B deshabilitada | Standard+ |
| `pagos_fiado` | Cobros de deuda | 012 | A | API y cobranza | B+A | Basic+ |
| `pagos_multiples` | Efectivo, QR o combinacion en POS | 008 | B | capacidad real del POS; sin guardia propia | B+A | Basic; unir al contrato de POS |
| `portal_clientes` | Portal para compradores | 005 | D | sin ruta, servicio ni interfaz | A | futura; no anunciar |
| `punto_venta` | Venta, cobro y comprobante | 008 | A | POS | B+A | Basic+ |
| `ranking_productos` | Mayor y menor movimiento | 010 | A | inteligencia | B+A | Basic+ |
| `recibos_whatsapp` | Compartir comprobante por WhatsApp | 005/008 | B | boton/enlace manual real; clave sin guardia propia | B+A | Basic; no llamarlo envio automatico |
| `recordatorios_fiado` | Plantillas y mensajes preparados | 005/012 | A | cobranza y frontend | A, B deshabilitada | Standard+ |
| `rentabilidad_producto` | Margen y ganancia por producto | 009 | A | finanzas | A | Standard+ |
| `reportes_avanzados` | Etiqueta general de reportes | 005 | C | sin guardia directa; existen claves especificas | A | retirar de la oferta o definir alcance |
| `reportes_financieros` | Ventas, cobros, costos y gastos | 009 | A | finanzas | B+A | Basic+ |
| `rotacion_inventario` | Rotacion por periodo | 010 | A | inteligencia | A | Standard+ |
| `segmentacion_clientes` | Segmentos por compras/pagos | 012 | A | cobranza y frontend | A, B deshabilitada | Standard+ |
| `seguimiento_cobranza` | Compromisos y acciones | 012 | A | cobranza y auditoria | A, B deshabilitada | Standard+ |
| `trazabilidad_lotes` | Lectura del historial de lotes | 011 | A | guardia de lectura y frontend | A | Pro; conservar lectura historica al bajar |
| `valor_inventario_basico` | Valor estimado a costo/venta | 010 | A | inteligencia | B+A | Basic+ |
| `vencimientos_lote` | Etiqueta paraguas de lotes | 005/011 | B | solo ayuda a navegacion; guardias usan claves especificas | A | no comercializar por separado |

Resumen real: 32 claves A, 4 claves B, 1 clave C y 1 clave D. Las marcas E/F
son recomendaciones de tratamiento, no ausencia de implementacion.

## Limites actuales

| Limite tecnico | Fuente vigente | Conteo tenant | Alta bloqueada | Al alcanzar/exceder | Edicion, lectura y baja logica |
| --- | --- | --- | --- | --- | --- |
| `propietarios` | `limitePropietariosSnapshot` | `administrador` activo con rol `dueno_tienda` | crear o reactivar propietario | 409 `PLAN_LIMIT_REACHED` | lectura y desactivacion se conservan |
| `productos` | `limiteProductosSnapshot` | `producto.activo=1` | crear, restaurar o importar | mismo contrato | editar, consultar y ocultar se conservan |
| `clientes` | `limiteClientesSnapshot` | `cliente.activo=1` | crear o restaurar | mismo contrato | editar, consultar y ocultar se conservan |
| `proveedores` | `limiteProveedoresSnapshot` | todas las filas de proveedor | crear | mismo contrato | lectura/edicion se conservan; no hay baja logica uniforme |

Las altas bloquean primero `tienda` dentro de la transaccion y luego cuentan el
uso del mismo tenant. Esto evita dos altas concurrentes sobre el ultimo cupo.
`NULL` significa ilimitado. El exceso conserva datos y lectura; no hay borrado
automatico. Las pruebas directas son `test:subscription-limits`,
`test:subscription-plan-changes`, `test:subscriptions` y aislamiento tenant.

El nombre `propietarios` no representa propiedad legal ni todos los futuros
usuarios internos. Hoy cuenta exclusivamente cuentas activas `dueno_tienda`.
Usarlo como "usuarios internos" seria inexacto hasta ampliar roles y contrato.

## Usuarios, roles y permisos

- Roles persistidos: `superadmin` sin tienda y `dueno_tienda` con una tienda.
- No existen roles `administrador`, `cajero` ni `encargado_inventario`.
- La autorizacion usa rol, tenant, suscripcion, funcionalidad, acceso, CSRF y
  rate limit; no existe un catalogo general de permisos por usuario.
- Una tienda puede tener varias cuentas `dueno_tienda`, sujetas al limite de
  propietarios; todas tienen el mismo alcance operativo.
- La sesion guarda identidad minima y `versionSesion`; tenant se deriva en
  backend y se revalida en cada peticion.
- La auditoria identifica actor administrativo, pero no ofrece perfiles
  internos diferenciados.

Consecuencia: Basic 1 / Standard 3 / Pro ilimitado puede aplicarse hoy solo a
cuentas `dueno_tienda`. Los perfiles cajero/inventario requieren una fase
posterior propia y no deben bloquear SAAS-C1.

## Matriz real actual

| Plan | Limites | Funciones | Diferenciacion real | Conflictos con matriz provisional |
| --- | --- | ---: | --- | --- |
| Basico | 1/500/500/100 | 19 | nucleo comercial, inventario basico, finanzas y exportacion financiera | clientes y proveedores superan 25/15; precio 0; nombre/codigo no es `Basic` |
| Avanzado | 5/ilimitado/ilimitado/ilimitado | 38 | todo el catalogo, incluido portal futuro y etiquetas heredadas | no distingue Standard/Pro; incluye una funcion inexistente; precio 0 |

No hay equivalencia exacta. `basico` es el candidato de menor riesgo para
Basic, manteniendo el codigo interno por compatibilidad. `avanzado` debe quedar
como plan legado o mapearse explicitamente; no conviene renombrarlo a Pro porque
sus snapshots y pruebas usan ese codigo.

## Matriz provisional recomendada

La matriz usa solo capacidades reales. Las funciones de integridad permanecen
en todos los planes aunque su interfaz se adapte al nivel de acceso.

| Area | Basic | Standard | Pro |
| --- | --- | --- | --- |
| Usuarios/capacidad | 1 cuenta interna actual; 500 productos; 25 clientes; 15 proveedores | 3; 1.200; 70; 50 | ilimitado |
| Venta y operacion | POS, pagos multiples, comprobante interno, catalogo, productos, clientes, fiados, cobros, gastos | todo Basic | todo Standard |
| Inventario | resumen, alertas basicas, ranking, valor, historial y ajuste | rotacion, cobertura, sin movimiento, compras sugeridas, exportacion | todo Standard mas lotes, vencimientos, trazabilidad y exportacion de lotes |
| Finanzas | dashboard y reportes basicos | rentabilidad, cierre de caja y exportaciones | todo Standard |
| Cobranza | estado de cuenta y pagos | limites de credito, seguimiento, segmentacion, plantillas/WhatsApp manual y exportaciones | todo Standard |
| Seguridad/integridad | sesion, tenant, auditoria, compensaciones e historiales siempre | siempre | siempre |

No se ofrece `portal_clientes`, `reportes_avanzados` como etiqueta vacia,
chatbot, envio automatico de WhatsApp, factura fiscal, QR dinamico, tarjetas ni
renovacion automatica. Pro puede diferenciarse inicialmente por capacidad y
lotes; no hace falta inventar funciones exclusivas.

## Funciones esenciales no segmentables

Autenticacion, verificacion, recuperacion, sesiones, aislamiento tenant,
auditoria interna, idempotencia, snapshots, historial tecnico, integridad de
stock, compensaciones, proteccion de datos, backup/health y preservacion de
historicos no deben apagarse por plan. Puede variar la interfaz de consulta,
pero nunca la integridad o trazabilidad subyacente.

## Reportes, exportaciones e historiales

- Reportes reales: resumen de ventas, metodos de pago, gastos, compras,
  cuentas por cobrar, rentabilidad por producto, dashboard e inteligencia de
  inventario. `reportes_avanzados` no controla ninguno por si solo.
- Exportaciones reales: finanzas/compensaciones, inteligencia, lotes y
  clientes/fiados/estado de cuenta. Usan XLSX y, en compensaciones, CSV/XLSX.
- Las exportaciones tienen guardias propias y se bloquean en gracia; son una
  diferencia de plan viable.
- Historial visible: stock, lotes, estado de cuenta, seguimiento, cierres y
  compensaciones. Historial tecnico: auditoria y ciclo de suscripcion.
- Historial tecnico y auditoria no deben convertirse en extras comerciales.

## Alertas, WhatsApp, chatbot y facturacion

- Alertas de stock: reales, calculadas con configuracion por tienda; no existe
  una segunda alerta "completa" distinta. Las analiticas avanzadas son rotacion,
  cobertura y sugerencias.
- El umbral basico usa `producto.stockMinimo`; inteligencia agrega ventanas y
  parametros de `configuracionInventarioTienda`. Se consulta en API/frontend y
  se cubre con `test:inventory-intelligence` y su comprobador.
- Alertas de vencimiento: reales y ligadas a lotes; hoy son de Avanzado.
- El umbral por producto es `diasAlertaVencimiento`, con valor inicial de tienda;
  los canales son pantalla/API y exportacion. No hay correo, SMS ni push.
- Cobranza: alertas, plantillas y preparacion de texto son reales.
- WhatsApp: hay botones/enlaces y texto preparado. El usuario abre WhatsApp y
  confirma manualmente; no hay API oficial, envio automatico ni webhooks.
- Chatbot: no existe.
- Comprobantes: existen notas/comprobantes internos de venta, cobro y
  compensacion, imprimibles. No son facturas fiscales; no existe integracion
  tributaria.

## Configurabilidad actual

| Elemento | Base | Servicio | Superadmin/frontend | Snapshot/versionado |
| --- | --- | --- | --- | --- |
| Codigo, nombre, descripcion | columnas de `plan` | lectura | visibles, sin CRUD de catalogo | codigo/nombre congelados por periodo |
| Activacion | `plan.activo` | filtra nuevos cambios | sin interfaz de edicion | suscripcion vigente no cambia |
| Orden/visibilidad | no existe | orden por precio/codigo | no configurable | no aplica |
| Precio | `precioMensual DECIMAL(10,2)` | usado como referencia | visible; sin editor | valor congelado, moneda ausente |
| Periodo | `duracionDias`; snapshot enum | mensual/anual fijos en codigo | selector mensual/anual | snapshot por periodo |
| Limites | cuatro columnas | evaluacion central | visibles; sin editor | congelados por periodo |
| Funcionalidades | catalogo y relacion N:M | guardias por clave | visibles; sin editor | tabla snapshot normalizada |

No hay versionado de precios, moneda comercial, tipo de cambio, periodo
trimestral, orden comercial, visibilidad publica independiente ni editor seguro
del catalogo. La fuente para un periodo vigente es siempre su snapshot; el
catalogo solo alimenta nuevas altas/cambios.

## Precios y periodos

- Los dos `precioMensual` valen 0 y su moneda es implicita.
- Backend y frontend consumen ese valor como `precioReferencia`; no sirve como
  monto cobrable.
- El motor soporta `mensual` (30 dias) y `anual` (365 dias). El snapshot admite
  `mensual|anual|personalizada`; no admite `trimestral`.
- La referencia provisional, no persistida ni cotizada, resulta en USD:
  Basic 3 / 8.25 / 30; Standard 6 / 16.50 / 60; Pro 10 / 27.50 / 100 para
  mensual / trimestral / anual.
- Cobrar en BOB requiere congelar en cada solicitud precio base USD, tipo de
  cambio aplicado, fuente/fecha del tipo de cambio y monto final BOB. No se
  consulto ninguna cotizacion.

Esto ajusta el supuesto BOB-only de SAAS-C0: C1 debe modelar explicitamente
USD comercial y BOB de cobro sin reescribir snapshots 022 ni inventar valores
para suscripciones existentes.

## Cambios futuros sin afectar clientes

- Mantener snapshots 022 para condiciones vigentes.
- Aplicar precios nuevos solo a solicitudes y renovaciones creadas desde su
  vigencia; nunca recalcular solicitudes abiertas.
- Cambiar limites o funciones del catalogo solo para nuevos periodos.
- Ocultar un plan para nuevas altas sin borrar la fila ni romper suscripciones.
- Mantener `basico` y `avanzado` como codigos legados hasta una migracion
  explicita; agregar Standard/Pro sin renombrados destructivos.
- Auditar cambios de catalogo y precio; no generar eventos historicos ficticios.

## Migracion 023 futura

### A. Imprescindible para SAAS-C1

- soporte estructural de `trimestral` en snapshots futuros;
- presentacion del plan: orden y visibilidad publica separados de `activo`;
- `precioPlanPeriodo` versionado por plan, periodo, moneda base USD, monto,
  vigencia y estado;
- `metodoPagoSuscripcion` para QR manual, transferencia/deposito y efectivo
  administrativo, sin instrucciones reales hasta configuracion autorizada;
- `solicitudPagoSuscripcion` con operacion, plan/periodo, precio USD, tipo de
  cambio y monto BOB congelados;
- snapshot tipado de limites y tabla normalizada de funciones objetivo;
- historial de solicitud append-only e idempotencia hash-only.

### B. Puede esperar a C2

- rutas y servicios de cotizacion/solicitud;
- materializacion de vencimiento al consultar;
- exposicion del catalogo Basic/Standard/Pro al propietario.

### C. Puede esperar a C3/C4

- metadata y versiones de comprobante privado;
- almacenamiento privado, MIME real, checksum y descarga autenticada;
- revision humana append-only, observacion, rechazo y cola superadmin.

### D. Mejora futura

- version formal de paquetes de funcionalidades independiente del plan;
- roles internos distintos de `dueno_tienda`;
- QR dinamico, verificacion automatica, tarjeta y renovacion automatica;
- impuestos, promociones, cupones, prorrateo, conciliacion y jobs.

Una 023 coherente puede crear de una vez las tablas de solicitud, comprobante,
revision e historiales definidas en SAAS-C0, pero C1 debe mantenerlas vacias y
sin metodos cobrables hasta confirmar precios, tipo de cambio e instrucciones.
No se requiere una tabla JSON de limites: las cuatro columnas tipadas y los
snapshots normalizados existentes son suficientes.

## Seguridad multitienda

- Propietario: tenant solo desde sesion; `/api/suscripcion` no acepta
  `idTienda`.
- Superadmin: contexto de tienda explicito y validado; no hereda tenant
  comercial.
- Uso, limites, funciones y snapshots se consultan por `idTienda` e
  `idSuscripcion`; no existe cache global compartida.
- Las altas sujetas a cupo bloquean `tienda` y usan transaccion.
- El frontend no decide limites, funciones, precio ni tenant.
- C1 debe conservar no-store, CSRF/origen, rate limit, SQL parametrizado,
  idempotencia hash-only y respuestas sin ids internos.

No se detectaron cruces tenant ni una brecha critica que obligue a crear 023
durante esta auditoria.

## Pruebas revisadas

- Catalogo y snapshots: `db:check-subscriptions`,
  `db:check-subscription-lifecycle`, `test:subscription-lifecycle-schema`.
- Planes y limites: `test:subscriptions`, `test:subscription-plan-changes`,
  `test:subscription-limits`, `test:subscription-plan-browser`.
- Acceso y tenant: `test:subscription-access`, `test:tenant-isolation`,
  `db:check-multitenant`.
- Administracion global: `test:saas-subscription-admin` y su arnes browser.
- Funciones comerciales: pruebas de POS, finanzas, inteligencia, lotes, stock,
  clientes/cobranza y compensaciones registradas en `MAPA_PRUEBAS.md`.

Para esta auditoria solo se ejecutaron validaciones read-only del estado y
agregados del catalogo. No se crearon fixtures, bases temporales, servidores ni
pruebas nuevas.

## Decisiones pendientes antes de SAAS-C1

1. Confirmar si el codigo interno de Basic sigue siendo `basico` y si
   `avanzado` queda legado/oculto o se conserva como plan comercial.
2. Confirmar fuente, vigencia y precision del tipo de cambio USD->BOB, ademas
   de los precios provisionales y su fecha efectiva.
3. Confirmar si 023 crea toda la estructura C0 de una vez o separa comprobantes
   y revisiones en migraciones posteriores.

No bloquean esta auditoria. Ninguna debe resolverse inventando datos en la base.
