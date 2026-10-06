-- Reordena las funcionalidades comerciales segun la escalera operar / controlar / dirigir.
-- No elimina registros de negocio ni modifica limites de capacidad.

INSERT INTO planFuncionalidad (idPlan,idFuncionalidad,habilitada)
SELECT p.idPlan,f.idFuncionalidad,
       CASE WHEN f.codigo IN (
         'catalogo_maestro','clientes_basico','dashboard_financiero',
         'estado_cuenta_basico','fiados_basico','historial_stock',
         'pagos_fiado','pagos_multiples','punto_venta'
       ) THEN 1 ELSE 0 END
FROM plan p
JOIN funcionalidad f ON f.activo=1
WHERE p.codigo='basico'
ON DUPLICATE KEY UPDATE habilitada=VALUES(habilitada);

INSERT INTO planFuncionalidad (idPlan,idFuncionalidad,habilitada)
SELECT p.idPlan,f.idFuncionalidad,
       CASE WHEN f.codigo IN (
         'catalogo_maestro','clientes_basico','dashboard_financiero',
         'estado_cuenta_basico','fiados_basico','historial_stock',
         'pagos_fiado','pagos_multiples','punto_venta',
         'ajuste_stock','alertas_stock','anulaciones_operativas','gastos',
         'inventario_resumen','limites_credito','ranking_productos',
         'recibos_whatsapp','recordatorios_fiado','reportes_financieros',
         'segmentacion_clientes','seguimiento_cobranza','valor_inventario_basico'
       ) THEN 1 ELSE 0 END
FROM plan p
JOIN funcionalidad f ON f.activo=1
WHERE p.codigo='standard'
ON DUPLICATE KEY UPDATE habilitada=VALUES(habilitada);

INSERT INTO planFuncionalidad (idPlan,idFuncionalidad,habilitada)
SELECT p.idPlan,f.idFuncionalidad,
       CASE WHEN f.codigo IN (
         'catalogo_maestro','clientes_basico','dashboard_financiero',
         'estado_cuenta_basico','fiados_basico','historial_stock',
         'pagos_fiado','pagos_multiples','punto_venta',
         'ajuste_stock','alertas_stock','anulaciones_operativas','gastos',
         'inventario_resumen','limites_credito','ranking_productos',
         'recibos_whatsapp','recordatorios_fiado','reportes_financieros',
         'segmentacion_clientes','seguimiento_cobranza','valor_inventario_basico',
         'alertas_vencimiento','cierre_caja','compras_sugeridas','control_lotes',
         'dias_cobertura','exportacion_clientes_fiados','exportacion_inventario',
         'exportacion_lotes','exportacion_reportes','inventario_sin_movimiento',
         'rentabilidad_producto','rotacion_inventario','trazabilidad_lotes',
         'vencimientos_lote'
       ) THEN 1 ELSE 0 END
FROM plan p
JOIN funcionalidad f ON f.activo=1
WHERE p.codigo='pro'
ON DUPLICATE KEY UPDATE habilitada=VALUES(habilitada);
