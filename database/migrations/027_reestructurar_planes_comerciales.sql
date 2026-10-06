UPDATE plan
SET nombre='Basic',
    descripcion='Operacion esencial para una tienda pequena.',
    precioMensual=3.00,
    limitePropietarios=1,
    limiteProductos=300,
    limiteClientes=15,
    limiteProveedores=15,
    visiblePublicamente=1,
    esLegado=0,
    ordenComercial=10
WHERE codigo='basico';

UPDATE plan
SET nombre='Standard',
    descripcion='Control y analisis para una tienda en crecimiento.',
    precioMensual=6.00,
    limitePropietarios=3,
    limiteProductos=1000,
    limiteClientes=30,
    limiteProveedores=30,
    visiblePublicamente=1,
    esLegado=0,
    ordenComercial=20
WHERE codigo='standard';

UPDATE plan
SET nombre='Pro',
    descripcion='Gestion avanzada, exportaciones y lotes sin limites.',
    precioMensual=10.00,
    limitePropietarios=NULL,
    limiteProductos=NULL,
    limiteClientes=NULL,
    limiteProveedores=NULL,
    visiblePublicamente=1,
    esLegado=0,
    ordenComercial=30
WHERE codigo='pro';

INSERT INTO planFuncionalidad (idPlan,idFuncionalidad,habilitada)
SELECT p.idPlan,f.idFuncionalidad,
       CASE WHEN f.codigo IN (
         'ajuste_stock','alertas_stock','anulaciones_operativas','catalogo_maestro',
         'clientes_basico','dashboard_financiero','estado_cuenta_basico',
         'fiados_basico','gastos','historial_stock','inventario_resumen',
         'pagos_fiado','pagos_multiples','punto_venta','recibos_whatsapp'
       ) THEN 1 ELSE 0 END
FROM plan p
JOIN funcionalidad f ON f.activo=1
WHERE p.codigo='basico'
ON DUPLICATE KEY UPDATE habilitada=VALUES(habilitada);

INSERT INTO planFuncionalidad (idPlan,idFuncionalidad,habilitada)
SELECT p.idPlan,f.idFuncionalidad,
       CASE WHEN f.codigo IN (
         'ajuste_stock','alertas_stock','anulaciones_operativas','catalogo_maestro',
         'clientes_basico','dashboard_financiero','estado_cuenta_basico',
         'fiados_basico','gastos','historial_stock','inventario_resumen',
         'pagos_fiado','pagos_multiples','punto_venta','recibos_whatsapp',
         'cierre_caja','compras_sugeridas','dias_cobertura',
         'inventario_sin_movimiento','limites_credito','ranking_productos',
         'recordatorios_fiado','reportes_financieros','rotacion_inventario',
         'segmentacion_clientes','seguimiento_cobranza','valor_inventario_basico'
       ) THEN 1 ELSE 0 END
FROM plan p
JOIN funcionalidad f ON f.activo=1
WHERE p.codigo='standard'
ON DUPLICATE KEY UPDATE habilitada=VALUES(habilitada);

INSERT INTO planFuncionalidad (idPlan,idFuncionalidad,habilitada)
SELECT p.idPlan,f.idFuncionalidad,
       CASE WHEN f.codigo IN (
         'ajuste_stock','alertas_stock','anulaciones_operativas','catalogo_maestro',
         'clientes_basico','dashboard_financiero','estado_cuenta_basico',
         'fiados_basico','gastos','historial_stock','inventario_resumen',
         'pagos_fiado','pagos_multiples','punto_venta','recibos_whatsapp',
         'cierre_caja','compras_sugeridas','dias_cobertura',
         'inventario_sin_movimiento','limites_credito','ranking_productos',
         'recordatorios_fiado','reportes_financieros','rotacion_inventario',
         'segmentacion_clientes','seguimiento_cobranza','valor_inventario_basico',
         'alertas_vencimiento','control_lotes','exportacion_clientes_fiados',
         'exportacion_inventario','exportacion_lotes','exportacion_reportes',
         'rentabilidad_producto','trazabilidad_lotes','vencimientos_lote'
       ) THEN 1 ELSE 0 END
FROM plan p
JOIN funcionalidad f ON f.activo=1
WHERE p.codigo='pro'
ON DUPLICATE KEY UPDATE habilitada=VALUES(habilitada);
