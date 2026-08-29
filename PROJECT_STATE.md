# Project State

- Proyecto: `pablooduran/Tienda-De-Abarrotes`
- Rama: `mejora-multitienda`
- HEAD de referencia documental: `ac62c1b` (`docs: alinear roadmap de pilot readiness`)
- Remoto: `0/0` con `origin/mejora-multitienda`
- Working tree: limpio antes de crear este handoff; volver a verificar
- APP_ENV: `local`
- Base: `localhost / tienda_abarrotes_pruebas`
- Puerto normal: `3000` (`npm.cmd run start:local`)
- Migraciones: `001-024` (24); no existe `025`
- Backup: `BACKUP_OK`; restore temporal probado y limpio
- Ultimo bloque: BLOQUE 1 - INTEGRIDAD FUNCIONAL PRE-UX, publicado
- CI: run `32509213826` PASS; job `96856170249` PASS; gate browser critico PASS
- PRODUCT-GROWTH-0: cerrado dentro de su alcance local y desacoplado
- Macroestado vigente: `PILOT-READINESS`; `PILOT-READINESS-1` local PASS
- Infraestructura hospedada: Render y Aiven existentes, auditados parcialmente
  el 2026-08-24; no validados aun como staging sintetico.
- Contrato tecnico y protocolo de piloto gratuito: documentados y pendientes de
  ejecucion. Redis solo cubre rate limit distribuido y las sesiones usan MySQL.
  Las herramientas remotas de esquema fallan cerradas salvo staging TLS en la
  base exacta `tienda_abarrotes_staging`, `--remote-staging` y confirmacion no
  secreta; validan vacio o estructura inicial sin datos antes de mutar.
  En staging gratuito, `PAYMENT_RECEIPT_MODE=disabled` bloquea comprobantes
  manuales sin inicializar storage; para habilitarlos se requiere filesystem
  privado persistente con backup y restore.
- Proxy Render Free: solo `APP_ENV=staging` puede usar
  `TRUST_PROXY_MODE=render-cloudflare` sin `TRUST_PROXY_CIDRS`; la IP para
  rate limiting viene exclusivamente de `CF-Connecting-IP`. El resto de
  entornos/proveedores exige CIDR directos verificados.
- `PILOT_READY`: no declarado; primero ejecutar pruebas hospedadas solo con
  datos sinteticos. Despues, con backup/restore remoto PASS y autorizacion
  explicita, puede iniciar un piloto de una tienda por 7-14 dias.

Restricciones: no crear 025, no tocar produccion/remotos, no ejecutar
migraciones sobre la base principal sin autorizacion, no romper tenant
isolation, no confiar en `idTienda` del frontend, no imprimir secretos y no
descartar cambios ajenos.
