# Handoff Codex - Tienda de Abarrotes

Fecha de referencia: 2026-08-24. Guia para otra cuenta de Codex que abrira la
misma carpeta y computadora. Todas las afirmaciones de estado deben volver a
comprobarse antes de ejecutar cambios.

## 1. Identidad

**Tienda de Abarrotes** es un SaaS web multitienda para tiendas de abarrotes:
POS, inventario, compras, proveedores, clientes, credito, cobranza, reportes,
suscripciones y administracion. El producto esta orientado a propietarios de
tiendas y a un superadmin separado.

Estado general verificado: producto local funcional, esquema 024, pagos de
suscripcion manuales y CI con MySQL efimero. La infraestructura hospedada
existente fue auditada parcialmente el 2026-08-24: hay una aplicacion publica
en Render y un servicio MySQL en Aiven, pero no constituyen todavia un entorno
sintetico validado. BLOQUE 1 - INTEGRIDAD FUNCIONAL PRE-UX y PRODUCT-GROWTH-0
estan cerrados dentro de sus alcances publicados. El macroestado vigente es
PILOT-READINESS: la auditoria PILOT-READINESS-1 local esta en PASS, pero
PILOT_READY no esta declarado.

## 2. Stack y arquitectura

- Node.js 20 o superior, CommonJS, Express 4 y MySQL 8 mediante `mysql2`.
- Frontend propio en HTML, CSS y JavaScript sin framework SPA.
- Sesiones con `express-session` y store MySQL.
- `bcryptjs` para contrasenas, `exceljs` para XLSX y `playwright-core` para
  browser local/CI.
- `server.js` configura Express, seguridad, sesiones, rutas y estaticos.
- `config/`, `middleware/`, `routes/`, `services/`, `public/`,
  `database/migrations/`, `scripts/` y `utils/` contienen las capas principales.

Inicio local autorizado:

```powershell
$env:APP_ENV='local'
npm.cmd run start:local
```

Puerto normal: `3000`. Base autorizada: `localhost:3306 /
tienda_abarrotes_pruebas`. `start:local` carga la configuracion local y
rechaza DB remota. No leer ni imprimir secretos de `.env.local`.

Variables por categoria: `APP_ENV`, `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`,
`DB_PASSWORD`, `SESSION_SECRET`, `APP_BASE_URL`, `TRUSTED_ORIGINS`,
`DB_ENVIRONMENT`, `DB_SSL_ENABLED`, `RATE_LIMIT_ENABLED`, `RATE_LIMIT_STORE`,
`RATE_LIMIT_REDIS_URL` y `BACKUP_DIR`. Local/CI usan DB local/efimera y
rate-limit en memoria; staging/production requieren Redis TLS y secretos
robustos.

## 3. Git

- Repositorio: `pablooduran/Tienda-De-Abarrotes`.
- Rama: `mejora-multitienda`.
- HEAD verificado: `46c8c2d9bf3c65165e5d24be53bb4bcd51aa9987`.
- Ultimo commit: `46c8c2d fix: corregir integridad funcional previa a UX`.
- `origin/mejora-multitienda` coincide; divergencia `0 0`.
- Working tree estaba limpio antes de crear estos documentos; volver a revisar.
- No usar `git reset --hard`, `git clean`, checkout destructivo ni descartar
  cambios ajenos. Stagear solo archivos del alcance.

## 4. Base de datos

- Host `localhost`, base `tienda_abarrotes_pruebas`.
- Existen 24 migraciones, 001 a 024; no existe 025.
- No ejecutar migraciones, seeds, init, backup o restore sobre la base
  principal sin autorizacion del bloque.
- Restore aprobado solo en `tmp_tienda_restore_*`; nunca sobre la base principal.
- Todas las operaciones comerciales deben filtrar tenant por sesion y
  `idTienda`, usar SQL parametrizado, transacciones, rollback, bloqueos e
  idempotencia.
- Fechas comerciales: `America/La_Paz`.

## 5. Funcionalidades implementadas

Verificadas en codigo y pruebas: registro, verificacion, recuperacion,
sesiones, onboarding, tiendas, propietarios, superadmin, aislamiento
multitienda, catalogo maestro, categorias, productos, proveedores, compras,
stock, movimientos, ajustes, inteligencia de inventario, lotes, vencimientos,
distribucion inicial, FEFO/FIFO, POS, ventas, pagos efectivo/QR y mixtos,
clientes, fiados, credito, cobranza, promesas, comprobantes, devoluciones,
anulaciones, compensaciones, gastos, caja, cierres, reportes y exportaciones.

Tambien existen suscripciones, planes, limites, trial, activa, gracia,
suspension, cancelacion, cambios de plan, pagos manuales, comprobantes
privados, revision/aplicacion, auditoria, CSP/CSRF/origen, rate limits,
errores seguros, CI, backup, manifiesto, SHA-256, verificacion y restore.

No estan habilitados: correo externo, pagos automaticos, tarjetas, QR
dinamico, webhooks, conciliacion externa, facturacion fiscal, WhatsApp
automatico y chatbot.

## 6. Planes y suscripciones

| Plan | Propietarios | Productos | Clientes | Proveedores |
| --- | ---: | ---: | ---: | ---: |
| Basic (`basico`) | 1 | 500 | 25 | 15 |
| Standard (`standard`) | 3 | 1200 | 70 | 50 |
| Pro (`pro`) | ilimitado (`NULL`) | ilimitado (`NULL`) | ilimitado (`NULL`) | ilimitado (`NULL`) |

`avanzado` existe como legado/cortesia y no se publica. No corregir cuentas
historicas a ciegas.

Estados implementados: trial/prueba, activa, gracia, suspendida, cancelada y
vencimiento. Suspendida conserva datos, permite lecturas incluidas por la
allowlist y Mi plan/renovacion, y bloquea mutaciones comerciales. La politica
real esta en `config/subscription-access-policy.js`; exportaciones y salidas
sensibles pueden seguir bloqueadas aunque sean GET. No existe plan Free.

## 7. BLOQUE 1 recientemente completado

Commit `46c8c2d`:

- Configuracion: suspension ya no bloquea toda lectura; superficies permitidas
  quedan en solo lectura y las escrituras siguen protegidas.
- Planes: Basic/Standard/Pro ya eran correctos en 023; `avanzado` queda legado
  no publico; no se cambiaron datos historicos.
- Pago mixto: regresion para ocasional efectivo + QR totalmente pagado; saldo
  pendiente sin cliente registrado se rechaza.
- Promesas: se conserva `fechaVencimiento` original y la UI muestra contexto
  de promesa vigente sin nuevo estado persistido.
- Suspendida: lectura habilitada segun allowlist y mutaciones bloqueadas.
- Lotes: flujo existente probado; integracion dentro de Compras diferida.
- Migracion 024 confirmada; migracion 025 no creada.
- Backup local `BACKUP_OK`; restore temporal limpio.
- CI verificado: run `32509213826`, workflow `CI`, job `96856170249` (`Node 20 /
  MySQL 8`) y `Run critical browser business gate`: **PASS**.

## 8. Pruebas y validaciones

Ultimo resultado local conocido:

- configuracion, tenant y browser: **PASS**;
- clientes/credito/cobranza: **PASS**;
- POS/pagos mixtos: **PASS**;
- suscripciones/acceso suspendido: **PASS**;
- stock, lotes y checks de esquema: **PASS**;
- `check:web-security` y `test:web-security`: **PASS**, 66 checks;
- backup/restore: **PASS**, 64 tablas, 24 migraciones, 174 FKs;
- `codex:precommit`: **PASS**; `codex:cleanup-check`: **CLEAN**;
- `codex:status`: DB local, migracion 024, `BACKUP_OK`;
- CI run `32509213826`: **PASS**; job `96856170249` y gate browser critico
  completaron con `success`.

Scripts principales: `test:product-configuration`, `test:tenant-isolation`,
`test:subscription-access`, `test:subscription-access-browser`,
`test:customers-credit`, `test:pos-payments`, `test:subscriptions`,
`test:stock-movements`, `test:lots-expiration`, `check:web-security`,
`test:web-security`, `db:check-*`, `db:backup`, `db:verify-backup`,
`db:test-restore`, `codex:cleanup-check` y `codex:status`. Serializar suites
que compartan fixtures y limpiar solo recursos propios.

## 9. Reglas y restricciones

1. No crear migracion 025 sin autorizacion explicita.
2. No tocar produccion, Aiven ni bases remotas.
3. No romper tenant isolation ni confiar en `idTienda` del frontend.
4. No modificar datos innecesariamente ni cambiar contratos sin pruebas.
5. No eliminar capacidades/historial; usar compensaciones cuando corresponda.
6. No hacer refactors grandes sin dividirlos en bloques aprobados.
7. Ejecutar pruebas antes de cerrar, mantener cleanup y working tree limpio.
8. No declarar bloque terminado con validacion critica pendiente.
9. Priorizar seguridad, integridad financiera y funcionamiento antes que estetica.
10. No usar datos reales sin autorizacion expresa; no imprimir secretos, tokens,
    hashes, SQL, stacks ni rutas privadas.

## 10. UX/UI pendiente

Pendientes registrados: Finanzas necesita graficos compactos/interactivos,
KPIs, filtros por hoy/ayer/mes/rango y mejor lectura de ventas, cobros,
ganancias, gastos, cuentas por cobrar y flujo de efectivo. Gastos requiere
separar compras de mercaderia y gastos operativos, categorias, agregar gasto y
posibles filtros en modal. Cierre de caja necesita accion clara, cierre de hoy,
fechas, efectivo, observaciones e historial. Auditoria necesita filtros,
categorias, tablas y navegacion mejor organizadas. Mi plan necesita mejor
presentacion de plan, vigencia, limites, uso, funcionalidades, pagos manuales
y renovacion. Navegacion requiere mejorar visualmente Cerrar sesion.

La configuracion que antes fallaba fue corregida funcionalmente en el Bloque 1;
cualquier problema visual restante es **NO VERIFICADO** hasta reproducirse.
UX-001 a UX-005 y el resto del polish visual permanecen en el roadmap.

## 11. Decisiones importantes

- Backend es autoridad financiera, de suscripcion y permisos.
- Tenant deriva de sesion; superadmin y propietario son superficies separadas.
- Pagos de suscripcion actuales son manuales; no existe cobro recurrente.
- El futuro churn del propietario es “No planeo renovar”, no cancelacion inmediata.
- Analytics local usa `noop`; no hay proveedor remoto activo.
- `product_created` y `customer_created` siguen diferidos si no hay replay seguro.
- TECH-026 E2E critico existe; validar CI vigente.
- Render y Aiven ya existen y su inventario fue auditado parcialmente; no se
  deben tratar como una provision desde cero ni como staging validado. Quedan
  pendientes ejecutar el contrato tecnico y el protocolo de piloto gratuito:
  Redis/Valkey, red restringida, storage privado persistente, health check y
  backup/restore remoto sintetico.

## 12. Problemas conocidos y roadmap

| Problema | Modulo | Prioridad/impacto | Estado |
| --- | --- | --- | --- |
| Integracion de lotes dentro de Compras | Lotes/Compras | alta antes de beta | Diferida; no nueva arquitectura ni 025 |
| Entorno hospedado sintetico | Staging | critico antes de datos reales | Infraestructura existente auditada parcialmente; falta contrato tecnico y validacion con datos sinteticos |
| Evidencia final del CI del ultimo commit | CI | critico de cierre | Run 32509213826; PASS, job 96856170249 |
| Correo externo | Acceso publico | alta antes de beta | No habilitado |
| Analytics remoto/PostHog | Product Growth | media | No blocker del primer piloto |
| Churn persistente | Suscripciones | media/alta antes de beta externa | Requiere estructura futura; no 025 |
| UX visual | Producto | media | Pendiente en roadmap |

Terminados: SAAS-A/B/C, seguridad publica, CI, STAGING-1, PREPROD-1,
REGRESION GENERAL, DOCS-OPS, PRODUCTO-0, PRODUCTO-1 P1-P8, WELCOME, HELP,
PRODUCT-GROWTH-0, CHURN-001, PILOT-GATE-ALIGNMENT, PILOT-READINESS-1 local y
BLOQUE 1 funcional.

El siguiente macroestado es **PILOT-READINESS**. PILOT-READINESS-1 local esta
en PASS; el contrato tecnico y el protocolo de piloto gratuito controlado ya
estan documentados en `docs/CONFIGURACION_STAGING.md`. Antes de una ejecucion
remota autorizada, `db:init` y `db:migrate` exigen staging TLS, destino exacto
`tienda_abarrotes_staging`, `--remote-staging` y una confirmacion no secreta;
tambien verifican vacio o estructura inicial sin datos. El siguiente paso es
ejecutar las pruebas hospedadas exclusivamente con datos sinteticos. Redis solo
sirve al rate limit distribuido y las sesiones siguen en MySQL. Para el piloto
gratuito de staging, `PAYMENT_RECEIPT_MODE=disabled` bloquea carga, revision y
descarga de comprobantes sin inicializar storage ni usar filesystem efimero;
production mantiene filesystem privado obligatorio. Solo tras PASS sintetico,
backup/restore remoto y
autorizacion explicita puede comenzar un piloto de una tienda por siete dias,
ampliable hasta catorce. No existe PILOT_READY hasta completar esos gates. No
iniciar COMMERCE, SECURITY-FINAL, piloto real ni otra fase por inferencia.

Para Render Free, solo en staging, `TRUST_PROXY_MODE=render-cloudflare` opera
sin `TRUST_PROXY_CIDRS`: conserva Express sin confianza generica de proxy y usa
solo `CF-Connecting-IP` antes de rate limiting. Una cabecera ausente o invalida
se rechaza; `X-Forwarded-For` y `X-Real-IP` no influyen. Local, CI, production
y otros proveedores mantienen CIDR directos verificados.

## INSTRUCCIONES PARA CONTINUAR

1. Leer `HANDOFF_CODEX.md`, `PROJECT_STATE.md`, `AGENTS.md`,
   `docs/REGLAS_CODEX.md`, `docs/CONTINUIDAD_PROYECTO.md` y
   `docs/MAPA_PRUEBAS.md`.
2. Ejecutar `git status --short`, rama, HEAD y divergencia con origin.
3. Confirmar `APP_ENV=local`, `localhost`, base `tienda_abarrotes_pruebas`,
   migracion 024 y ausencia de 025.
4. No modificar nada antes de validar el estado real y el alcance aprobado.
5. Usar solo scripts existentes en `package.json`.
6. Confirmar el alcance autorizado dentro de PILOT-READINESS; no inferir el
   inicio del entorno hospedado ni de otra fase.
7. No crear 025, no tocar produccion/remotos y no descartar cambios ajenos.
8. Mantener tenant isolation, seguridad, contratos financieros e idempotencia.
9. Antes de cerrar: pruebas proporcionales, cleanup, diff, precommit y Git.

## Prompt de arranque

```text
Este es un proyecto existente: pablooduran/Tienda-De-Abarrotes. No comiences
desde cero. Trabaja en la carpeta existente y en la rama mejora-multitienda.
Lee HANDOFF_CODEX.md, PROJECT_STATE.md, AGENTS.md, docs/REGLAS_CODEX.md,
docs/CONTINUIDAD_PROYECTO.md y docs/MAPA_PRUEBAS.md. Revisa primero git status,
HEAD, rama, divergencia con origin, APP_ENV=local, localhost /
tienda_abarrotes_pruebas, migracion 024 y ausencia de migracion 025. No hagas
cambios hasta verificar el estado real. No crees migracion 025, no toques
produccion ni bases remotas, no descartes cambios y no inicies fases nuevas sin
autorizacion explicita. PILOT-READINESS-1 local ya esta PASS; PILOT_READY sigue
pendiente del entorno hospedado sintetico y de la autorizacion explicita antes
de datos reales. Reporta bloqueos y pruebas necesarias antes de implementar.
```
