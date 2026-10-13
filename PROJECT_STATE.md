# Project State

- Proyecto: `pablooduran/Tienda-De-Abarrotes`
- Rama: `mejora-multitienda`
- HEAD desplegado antes de este bloque: `7f8801f` (`chore: usar recarga nativa de Node`)
- Remoto: `0/0` con `origin/mejora-multitienda`
- Working tree: contiene cambios ajenos en `scripts/test-product-inventory-browser.js`
  y `outputs/`; no incluirlos ni descartarlos.
- APP_ENV: `local`
- Base: `localhost / tienda_abarrotes_pruebas`
- Puerto normal: `3000` (`npm.cmd run start:local`)
- Migraciones de staging: `001-036` aplicadas.
- Backup: `BACKUP_OK`; restore temporal probado y limpio
- Ultimos bloques publicados: tienda online completa, sincronizacion de stock,
  pedidos/ventas/fiados, responsive, datos de cuenta, novedades de pedidos y
  actualizacion de dependencias.
- Auditoria npm del 2026-10-13: 0 vulnerabilidades de produccion y desarrollo.
- PRODUCT-GROWTH-0: cerrado dentro de su alcance local y desacoplado
- Macroestado vigente: `PILOT-READINESS`; `PILOT-READINESS-1` local PASS
- Infraestructura hospedada: staging activo en Render sobre la rama
  `mejora-multitienda`, MySQL/Redis disponibles y readiness `healthy`. Resend
  entrega correo real desde el subdominio verificado. El plan sigue siendo Free.
- Contrato tecnico y protocolo de piloto gratuito: ejecutados parcialmente con
  datos sinteticos. Redis solo cubre rate limit distribuido y las sesiones usan MySQL.
  Las herramientas remotas de esquema fallan cerradas salvo staging TLS en la
  base exacta `tienda_abarrotes_staging`, `--remote-staging` y confirmacion no
  secreta; validan vacio o estructura inicial sin datos antes de mutar. Para
  Render Free, la futura ejecucion autorizada se realiza una sola vez desde un
  PC Windows mediante `scripts/initialize-staging-remote.ps1`, sin Shell ni
  One-Off Jobs y sin persistir secretos en el proceso o repositorio.
  Su modo `-Diagnose` es solo lectura y debe ejecutarse antes de una nueva
  autorizacion de mutacion; solo `EMPTY` permite solicitarla. Baseline, estado
  parcial/inesperado o fallo de conexion/configuracion se detienen para
  revision sin reintentos.
  En staging gratuito, `PAYMENT_RECEIPT_MODE=disabled` bloquea comprobantes
  manuales sin inicializar storage; para habilitarlos se requiere filesystem
  privado persistente con backup y restore.
- Proxy Render Free: solo `APP_ENV=staging` puede usar
  `TRUST_PROXY_MODE=render-cloudflare` sin `TRUST_PROXY_CIDRS`; la IP para
  rate limiting viene exclusivamente de `CF-Connecting-IP`. El resto de
  entornos/proveedores exige CIDR directos verificados.
- Monitoreo: health interno activo. El heartbeat `Monitoreo staging Administrau`
  comprueba staging cada 30 minutos y solo avisa ante fallo o recuperacion. El
  workflow de GitHub cada 15 minutos queda versionado, pero las tareas programadas
  se activaran cuando el archivo llegue a la rama principal.
- `PILOT_READY`: no declarado. Falta la revision manual integral y un ensayo
  documentado de backup/restore remoto antes de incorporar datos reales.

Restricciones: no reescribir migraciones aplicadas, no tocar produccion/remotos, no ejecutar
migraciones sobre la base principal sin autorizacion, no romper tenant
isolation, no confiar en `idTienda` del frontend, no imprimir secretos y no
descartar cambios ajenos.
