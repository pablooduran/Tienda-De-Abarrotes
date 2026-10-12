const assert = require('assert');
const fs = require('fs');
const path = require('path');
process.env.APP_ENV ||= 'local';
process.env.DB_HOST ||= '127.0.0.1';
process.env.DB_USER ||= 'online_store_test';
process.env.DB_PASSWORD ||= 'online_store_test';
process.env.DB_NAME ||= 'online_store_test';
process.env.DB_PORT ||= '3306';
const { createOnlineStoreService, publicProduct } = require('../services/online-store-service');

const root = path.resolve(__dirname, '..');
const migration = fs.readFileSync(path.join(root, 'database', 'migrations', '031_tienda_online_base.sql'), 'utf8');
const visibilityMigration = fs.readFileSync(path.join(root, 'database', 'migrations', '032_catalogo_online_visible_por_defecto.sql'), 'utf8');
const ordersMigration = fs.readFileSync(path.join(root, 'database', 'migrations', '033_pedidos_tienda_online.sql'), 'utf8');
const receiptChannelsMigration = fs.readFileSync(path.join(root, 'database', 'migrations', '034_separar_comprobantes_por_canal.sql'), 'utf8');
const schema = fs.readFileSync(path.join(root, 'database', 'tienda_abarrotes.sql'), 'utf8');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const migrator = fs.readFileSync(path.join(root, 'scripts', 'migrate-db.js'), 'utf8');
const ownerUi = fs.readFileSync(path.join(root, 'public', 'js', 'online-store-admin-ui.js'), 'utf8');
const publicUi = fs.readFileSync(path.join(root, 'public', 'js', 'storefront.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'public', 'js', 'app.js'), 'utf8');
const ownerStyles = fs.readFileSync(path.join(root, 'public', 'css', 'styles.css'), 'utf8');
const onlineStoreRoutes = fs.readFileSync(path.join(root, 'routes', 'online-store.js'), 'utf8');

for (const sql of [migration, schema]) {
  assert(sql.includes('CREATE TABLE IF NOT EXISTS configuracionTiendaOnline'));
  assert(sql.includes('CREATE TABLE IF NOT EXISTS productoCatalogoOnline'));
  assert(sql.includes('PRIMARY KEY (idTienda,idProducto)'));
  assert(sql.includes('FOREIGN KEY (idTienda,idProducto)'));
  assert(sql.includes("p.codigo IN ('standard','pro')"));
}
assert(server.match(/requirePlanFeature\('portal_clientes'\)[\s\S]{0,120}onlineStoreRoutes/));
assert(server.includes("app.use('/api/public/tiendas', publicStorefrontRoutes)"));
assert(migrator.includes("'031_tienda_online_base.sql':"));
assert(migrator.includes("file === '031_tienda_online_base.sql'"));
assert(migrator.includes("'032_catalogo_online_visible_por_defecto.sql':"));
assert(migrator.includes("columnDefinitionMatches(details.publicado"));
assert(visibilityMigration.includes('ALTER COLUMN publicado SET DEFAULT 1'));
assert(schema.includes('publicado TINYINT(1) NOT NULL DEFAULT 1'));
for (const sql of [ordersMigration, schema]) {
  assert(sql.includes('CREATE TABLE IF NOT EXISTS pedidoTiendaOnline'));
  assert(sql.includes('CREATE TABLE IF NOT EXISTS detallePedidoTiendaOnline'));
  assert(sql.includes('fk_detallePedidoOnline_pedido'));
}
assert(migrator.includes("'033_pedidos_tienda_online.sql':"));
for (const sql of [receiptChannelsMigration, schema]) {
  assert(sql.includes("canalVenta ENUM('tienda','online')"));
  assert(sql.includes('idx_venta_tienda_canal_id'));
}
assert(receiptChannelsMigration.includes("THEN 'online'"));
assert(receiptChannelsMigration.includes("THEN 'O' ELSE 'T'"));
assert(migrator.includes("'034_separar_comprobantes_por_canal.sql':"));
assert(app.includes("channel === 'online' ? 'Online' : 'Tienda física'"));
assert(app.includes("features.includes('portal_clientes')"));
assert(ownerUi.includes('/api/tienda-online/productos/'));
assert(ownerUi.includes('Todos se muestran por defecto'));
assert(!ownerUi.includes('Descripción para el cliente'));
assert(!ownerUi.includes('Máximo por pedido'));
assert(!ownerUi.includes('Permitir sustitución'));
assert(publicUi.includes('/api/public/tiendas/'));
assert(publicUi.includes('data-cart-action'));
assert(publicUi.includes('data-quantity-dialog'));
assert(publicUi.includes('/clientes/buscar'));
assert(publicUi.includes('/pedidos'));
assert(publicUi.includes('CART_STORAGE_PREFIX'));
assert(publicUi.includes('restoreCartDraft()'));
assert(publicUi.includes('dataset.checkedPhone'));
assert(publicUi.includes('checkout-section'));
assert(publicUi.includes('Primero presiona “Buscar cliente”'));
assert(publicUi.includes('¡Cliente encontrado!'));
assert(publicUi.includes('Tus datos ya están completos. Puedes continuar.'));
assert(publicUi.includes("data-customer-name]').hidden = true"));
assert(ownerUi.includes('Pedidos recibidos'));
assert(ownerUi.includes("let activeView = 'orders'"));
assert(ownerUi.includes('data-online-view="config"'));
assert(ownerUi.includes('data-online-view="products"'));
assert(ownerUi.includes('/api/tienda-online/pedidos?estado=todos'));
assert(ownerUi.includes('Alistar pedido'));
assert(ownerUi.includes('Pedido terminado'));
assert(ownerUi.includes('Marcar entregado'));
assert(ownerUi.includes('Ya está pagado'));
assert(ownerUi.includes('Fiado · cobrar después'));
assert(ownerUi.includes('La deuda ya aparece en Cobranza'));
assert(ownerUi.includes('online-order-products'));
assert(!ownerUi.includes('<select name="estado">'));
assert(ownerUi.includes('order.productos.length > 12'));
assert(ownerUi.includes('data-online-status="finalizados"'));
assert(!ownerUi.includes('data-online-status="confirmado"'));
assert(ownerUi.includes('online-order-progress'));
assert(ownerUi.includes('online-order-card-bottom'));
assert(ownerStyles.includes('.online-order-card-bottom{display:grid;gap:12px;margin-top:auto'));
assert(ownerUi.includes('confirmOrderCancellation'));
assert(ownerUi.includes('Sí, cancelar pedido'));
assert(ownerUi.includes('Las unidades reservadas volverán a quedar disponibles en el stock.'));
assert(ownerUi.includes('Los productos ya descontados volverán al stock automáticamente.'));
assert(!ownerUi.includes("global.confirm('¿Quieres cancelar este pedido?')"));
assert(ownerUi.includes('data-announcement-close'));
assert(ownerUi.includes("if (error) {\n        announcementTimer = null;\n        return;"));
assert(ownerUi.includes('Editar productos del pedido'));
assert(ownerUi.includes('/productos`, {'));
assert(onlineStoreRoutes.includes("'/pedidos/:idPedidoOnline/productos'"));
assert(ownerUi.includes('<span>Estado</span>'));
assert(ownerUi.includes("order.estado === 'cancelado' ? '' : `<footer>"));
assert(ownerUi.includes("padStart(3, '0')"));
assert(fs.readFileSync(path.join(root, 'services', 'online-store-service.js'), 'utf8').includes('ONLINE_STORE_ORDER_INVALID_TRANSITION'));
assert(fs.readFileSync(path.join(root, 'services', 'online-store-service.js'), 'utf8').includes("po.estado IN ('pendiente','confirmado','preparando')"));
assert(fs.readFileSync(path.join(root, 'services', 'online-store-service.js'), 'utf8').includes('Salida por pedido de tienda online listo.'));
assert(fs.readFileSync(path.join(root, 'services', 'online-store-service.js'), 'utf8').includes('Reposición por cancelación de pedido de tienda online.'));
assert(fs.readFileSync(path.join(root, 'services', 'online-store-service.js'), 'utf8').includes("`pedido-online:${orderId}`"));
assert(fs.readFileSync(path.join(root, 'services', 'online-store-service.js'), 'utf8').includes('INSERT INTO detalleVenta'));
assert(fs.readFileSync(path.join(root, 'services', 'online-store-service.js'), 'utf8').includes('INSERT INTO pagoVenta'));
assert(fs.readFileSync(path.join(root, 'services', 'online-store-service.js'), 'utf8').includes("SET origen='venta',idDetalleVenta=?"));
assert(ownerUi.includes('El stock se descontó del inventario.'));
assert(ownerUi.includes('El stock se repuso en el inventario.'));
assert(ownerUi.includes('La venta ya aparece en tus reportes.'));
assert(ownerUi.includes('global.setTimeout(() =>'));
assert(ownerUi.includes('}, 2000);'));
assert(ownerUi.includes("currentTarget.innerHTML = '';"));
assert(ownerUi.indexOf('data-online-announcement') < ownerUi.indexOf('data-online-panel="orders"'));
assert(ownerStyles.includes('html:not([data-theme="dark"]) .online-order-filters button.active'));
assert(ownerStyles.lastIndexOf('html:not([data-theme="dark"]) .online-order-filters button.active')
  > ownerStyles.lastIndexOf('html:not([data-theme="dark"]) .online-order-filters button{'));
assert(ownerStyles.includes('input:checked+i{border-color:#176f2d;background:var(--brand)}'));
assert(ownerStyles.includes('.online-store-announcement{position:static'));
assert(publicUi.includes('Ocurrió un problema al cargar el catálogo'));
assert(schema.includes('CREATE TABLE IF NOT EXISTS configuracionCreditoTienda'));
assert(!fs.readFileSync(path.join(root, 'services', 'online-store-service.js'), 'utf8').includes('configuracionCobranza'));
assert(!publicUi.includes('stockUnidadesTotal'));
assert(/\.online-store-admin\{\r?\n\s+--primary:var\(--brand\);/.test(ownerStyles));
assert(ownerStyles.includes('html:not([data-theme="dark"]) .online-store-hero'));
assert(ownerStyles.includes('html:not([data-theme="dark"]) :is(.online-store-settings-card,.online-store-preview-card,.online-catalog-manager)'));
assert(ownerStyles.includes('.online-store-workspace-nav'));
assert(ownerStyles.includes('border:2px solid color-mix(in srgb,var(--ink) 45%,var(--line))'));
assert(ownerStyles.includes('.international-phone-field select option'));
assert(ownerStyles.includes('.customer-credit-enabled-note'));

const safeProduct = publicProduct({
  idProducto: 8,
  nombre: 'Arroz',
  categoria: 'ABARROTES',
  unidadMedida: 'unidad',
  precioVenta: 12,
  destacado: 1,
  descripcionPublica: 'Bolsa de 1 kg',
  cantidadMaximaPedido: 4,
  stockUnidadesTotal: 2,
  stockMinimo: 3
});
assert.strictEqual(safeProduct.disponibilidad, 'pocas_unidades');
assert(!Object.hasOwn(safeProduct, 'stockUnidadesTotal'));
assert(!Object.hasOwn(safeProduct, 'stockMinimo'));

async function serviceContract() {
  const calls = [];
  const database = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes('FROM tienda t') && sql.includes("t.slug=?") && sql.includes('configuracionTiendaOnline')) {
        assert(sql.includes('configuracionCreditoTienda'));
        return [[{
          idTienda: 7,
          slug: 'tienda-prueba',
          nombre: 'Tienda Prueba',
          nombreMostrado: 'Mi Tienda',
          telefono: null,
          direccion: 'Zona central',
          activa: 1,
          mensajeBienvenida: 'Bienvenido',
          permiteRecojo: 1,
          permiteEntrega: 0,
          permiteEfectivo: 1,
          permiteQr: 0,
          pedidoMinimo: 0,
          costoEntrega: 0,
          tiempoPreparacionMinutos: 30
        }]];
      }
      if (sql.includes('FROM producto p') && sql.includes('productoCatalogoOnline o')) {
        assert.deepStrictEqual(params, [7]);
        return [[{
          idProducto: 11,
          nombre: 'Leche',
          categoria: 'LACTEOS',
          unidadMedida: 'unidad',
          precioVenta: 8.5,
          stockUnidadesTotal: 0,
          stockMinimo: 2,
          destacado: 0,
          descripcionPublica: null,
          cantidadMaximaPedido: null
        }]];
      }
      if (sql.includes('SELECT nombre,direccion FROM cliente')) {
        assert.strictEqual(params[0], 7);
        return [[{ nombre: 'Pablo', direccion: 'Zona central' }]];
      }
      throw new Error(`Consulta inesperada: ${sql.slice(0, 80)}`);
    }
  };
  const service = createOnlineStoreService({
    database,
    subscriptionResolver: async (_database, idTienda, options) => {
      assert.strictEqual(idTienda, 7);
      assert.deepStrictEqual(options, { materialize: false });
      return { estadoAcceso: 'completo', caracteristicas: ['portal_clientes'] };
    }
  });
  const catalog = await service.getPublicCatalog('tienda-prueba');
  assert.strictEqual(catalog.tienda.nombre, 'Mi Tienda');
  assert.deepStrictEqual(catalog.categorias, ['LACTEOS']);
  assert.strictEqual(catalog.productos[0].disponibilidad, 'agotado');
  assert(!JSON.stringify(catalog).includes('stockUnidadesTotal'));
  assert(!Object.hasOwn(catalog.tienda, 'telefono'));
  assert(!Object.hasOwn(catalog.tienda, 'direccion'));
  const customer = await service.identifyPublicCustomer('tienda-prueba', '+59177049566');
  assert.deepStrictEqual(customer, { encontrado: true, cliente: { nombre: 'Pablo', direccion: 'Zona central' } });
  assert(calls.every((call) => !call.params?.includes(undefined)));
}

async function orderContract() {
  const writes = [];
  const connection = {
    async beginTransaction() { writes.push('begin'); },
    async commit() { writes.push('commit'); },
    async rollback() { writes.push('rollback'); },
    release() { writes.push('release'); },
    async query(sql, params) {
      if (sql.startsWith('SELECT idTienda FROM tienda')) return [[{ idTienda: 7 }]];
      if (sql.includes('COUNT(*) total FROM pedidoTiendaOnline')) return [[{ total: 0 }]];
      if (sql.includes('FROM producto p') && sql.includes('FOR UPDATE')) return [[{
        idProducto: 11, nombre: 'Leche', unidadMedida: 'unidad', precioVenta: 8.5,
        stockUnidadesTotal: 5, publicado: 1
      }]];
      if (sql.includes('SUM(d.cantidad) stockReservado')) return [[]];
      if (sql.includes('FROM cliente') && sql.includes('FOR UPDATE')) return [[]];
      if (sql.includes('INSERT INTO cliente')) { writes.push('cliente'); return [{ insertId: 55 }]; }
      if (sql.includes('INSERT INTO pedidoTiendaOnline')) { writes.push('pedido'); return [{ insertId: 99 }]; }
      if (sql.includes('INSERT INTO detallePedidoTiendaOnline')) { writes.push('detalle'); return [{ insertId: 100 }]; }
      throw new Error(`Consulta inesperada: ${sql.slice(0, 80)} ${JSON.stringify(params)}`);
    }
  };
  const database = {
    async getConnection() { return connection; },
    async query(sql, params) {
      if (sql.includes('FROM tienda t') && sql.includes('configuracionTiendaOnline')) return [[{
        idTienda: 7, slug: 'tienda-prueba', nombre: 'Tienda Prueba', nombreMostrado: 'Mi Tienda',
        activa: 1, permiteRecojo: 1, permiteEntrega: 1, permiteEfectivo: 1, permiteQr: 1,
        pedidoMinimo: 20, costoEntrega: 5, tiempoPreparacionMinutos: 30
      }]];
      throw new Error(`Consulta inesperada: ${sql.slice(0, 80)} ${JSON.stringify(params)}`);
    }
  };
  const service = createOnlineStoreService({
    database,
    clock: () => '2026-10-11 11:30:00',
    planLimitEnforcer: async (_connection, idTienda, entity) => {
      assert.strictEqual(idTienda, 7);
      assert.strictEqual(entity, 'clientes');
    },
    subscriptionResolver: async () => ({ estadoAcceso: 'completo', caracteristicas: ['portal_clientes'], plan: { codigo: 'standard' } })
  });
  const result = await service.createPublicOrder('tienda-prueba', {
    telefono: '76543210', nombre: 'Cliente Nuevo', tipoEntrega: 'entrega',
    direccionEntrega: 'Zona central', franjaEntrega: 'noche', metodoPago: 'qr',
    productos: [{ idProducto: 11, cantidad: 2 }]
  });
  assert.strictEqual(result.pedido.total, 22);
  assert.strictEqual(result.pedido.codigo, '001');
  assert.deepStrictEqual(writes, ['begin', 'cliente', 'pedido', 'detalle', 'commit', 'release']);
}

async function orderWorkflowContract() {
  const writes = [];
  const database = {
    async query(sql, params) {
      if (sql.startsWith('SELECT idTienda FROM tienda')) return [[{ idTienda: 7 }]];
      if (sql.startsWith('SELECT estado,idCliente,subtotal,costoEntrega,total,metodoPago')) return [[{
        estado: 'listo', idCliente: 55, subtotal: 119, costoEntrega: 0, total: 119, metodoPago: 'qr'
      }]];
      if (sql.startsWith('SELECT idVenta,codigoComprobante FROM venta')) return [[]];
      if (sql.includes('FROM detallePedidoTiendaOnline d')) return [[{
        idDetallePedidoOnline: 100,
        idProducto: 11,
        nombreProductoSnapshot: 'Aceite de oliva',
        unidadMedidaSnapshot: 'unidad',
        cantidad: 7,
        precioUnitario: 17,
        subtotal: 119,
        stockUnidadesTotal: 10,
        ultimoPrecioCompra: 12,
        controlaLotes: 0,
        controlaVencimiento: 0,
        activo: 1
      }]];
      if (sql.includes('INSERT INTO venta')) { writes.push('venta'); return [{ insertId: 44 }]; }
      if (sql.startsWith('SELECT COALESCE(MAX(CAST(SUBSTRING(codigoComprobante,3)')) {
        assert.deepStrictEqual(params, [7, 'online', 'O-%']);
        return [[{ ultimo: 3 }]];
      }
      if (sql.startsWith('UPDATE venta SET codigoComprobante')) {
        assert.strictEqual(params[0], 'O-004');
        writes.push('comprobante');
        return [{ affectedRows: 1 }];
      }
      if (sql.includes('INSERT INTO detalleVenta')) {
        assert.strictEqual(params[1], 44);
        assert.strictEqual(params[3], 7);
        assert.strictEqual(params[9], 'real');
        writes.push('detalle-venta');
        return [{ insertId: 70 }];
      }
      if (sql.startsWith('UPDATE movimientoStock')) {
        assert.strictEqual(params[0], 70);
        writes.push('vinculo-stock');
        return [{ affectedRows: 1 }];
      }
      if (sql.includes('INSERT INTO pagoVenta')) {
        assert.strictEqual(params[2], 'qr');
        assert.strictEqual(params[3], 119);
        writes.push('pago');
        return [{ insertId: 80 }];
      }
      if (sql.startsWith('UPDATE pedidoTiendaOnline')) {
        assert.strictEqual(params[0], 'entregado');
        assert.strictEqual(params[1], 'pagado');
        writes.push('pedido-entregado');
        return [{ affectedRows: 1 }];
      }
      throw new Error(`Consulta inesperada: ${sql.slice(0, 80)}`);
    }
  };
  const service = createOnlineStoreService({ database, clock: () => '2026-10-11 11:45:00' });
  const result = await service.updateOrder({ idTienda: 7, idAdministrador: 3 }, 99, { estado: 'entregado', estadoPago: 'pagado' });
  assert.deepStrictEqual(result, { actualizado: true, inventario: 'sin_cambios', venta: { idVenta: 44, idFiado: null, registrada: true } });
  assert.deepStrictEqual(writes, ['venta', 'comprobante', 'detalle-venta', 'vinculo-stock', 'pago', 'pedido-entregado']);
}

async function orderCreditWorkflowContract() {
  const writes = [];
  const database = {
    async query(sql, params) {
      if (sql.startsWith('SELECT idTienda FROM tienda')) return [[{ idTienda: 7 }]];
      if (sql.startsWith('SELECT estado,idCliente,subtotal,costoEntrega,total,metodoPago')) return [[{
        estado: 'listo', idCliente: 55, subtotal: 119, costoEntrega: 10, total: 129, metodoPago: 'efectivo'
      }]];
      if (sql.startsWith('SELECT idVenta,codigoComprobante FROM venta')) return [[]];
      if (sql.startsWith('SELECT idCliente, nombre, telefono')) return [[{
        idCliente: 55, nombre: 'Cliente conocido', telefono: '70000000', telefonoNormalizado: '59170000000',
        telefonoAlternativo: null, limiteCredito: null, permiteFiado: 1, diasCreditoDefault: 30, activo: 1
      }]];
      if (sql.startsWith('SELECT limiteCreditoDefault')) return [[{
        limiteCreditoDefault: null, diasCreditoDefault: 30, diasAvisoVencimiento: 3,
        politicaFiadoVencido: 'permitir', requiereTelefonoParaFiado: 0, permiteFiadoSinFecha: 1
      }]];
      if (sql.startsWith('SELECT idFiado, idVenta, fechaInicio')) return [[]];
      if (sql.includes('FROM detallePedidoTiendaOnline d')) return [[{
        idDetallePedidoOnline: 100, idProducto: 11, nombreProductoSnapshot: 'Aceite de oliva',
        unidadMedidaSnapshot: 'unidad', cantidad: 7, precioUnitario: 17, subtotal: 119,
        stockUnidadesTotal: 10, ultimoPrecioCompra: 12, controlaLotes: 0,
        controlaVencimiento: 0, activo: 1
      }]];
      if (sql.includes('INSERT INTO venta')) {
        assert.strictEqual(params[3], 129);
        assert.strictEqual(params[4], 0);
        assert.strictEqual(params[5], 129);
        assert.strictEqual(params[6], 'pendiente');
        assert.strictEqual(params[7], 'fiada');
        writes.push('venta-fiada');
        return [{ insertId: 45 }];
      }
      if (sql.startsWith('SELECT COALESCE(MAX(CAST(SUBSTRING(codigoComprobante,3)')) return [[{ ultimo: 4 }]];
      if (sql.startsWith('UPDATE venta SET codigoComprobante')) {
        assert.strictEqual(params[0], 'O-005');
        writes.push('comprobante');
        return [{ affectedRows: 1 }];
      }
      if (sql.includes('INSERT INTO detalleVenta')) { writes.push('detalle-venta'); return [{ insertId: 71 }]; }
      if (sql.startsWith('UPDATE movimientoStock')) { writes.push('vinculo-stock'); return [{ affectedRows: 1 }]; }
      if (sql.includes('INSERT INTO fiado')) {
        assert.strictEqual(params[1], 55);
        assert.strictEqual(params[2], 45);
        assert.strictEqual(params[6], 129);
        assert.strictEqual(params[7], 129);
        writes.push('fiado');
        return [{ insertId: 91 }];
      }
      if (sql.startsWith('UPDATE pedidoTiendaOnline')) {
        assert.strictEqual(params[0], 'entregado');
        assert.strictEqual(params[1], 'pendiente');
        writes.push('pedido-entregado-fiado');
        return [{ affectedRows: 1 }];
      }
      throw new Error(`Consulta inesperada: ${sql.slice(0, 100)}`);
    }
  };
  const service = createOnlineStoreService({ database, clock: () => '2026-10-12 11:45:00' });
  const result = await service.updateOrder({ idTienda: 7, idAdministrador: 3 }, 100, {
    estado: 'entregado', estadoPago: 'pendiente', observacionCredito: 'Pagará a fin de mes.'
  });
  assert.deepStrictEqual(result, { actualizado: true, inventario: 'sin_cambios', venta: { idVenta: 45, idFiado: 91, registrada: true } });
  assert.deepStrictEqual(writes, ['venta-fiada', 'comprobante', 'detalle-venta', 'vinculo-stock', 'fiado', 'pedido-entregado-fiado']);
}

async function orderInventoryContract() {
  let state = 'preparando';
  let stock = 14;
  let movementId = 500;
  const events = [];
  const connection = {
    async beginTransaction() { events.push('begin'); },
    async commit() { events.push('commit'); },
    async rollback() { events.push('rollback'); },
    release() { events.push('release'); },
    async query(sql, params) {
      if (sql.startsWith('SELECT idTienda FROM tienda')) return [[{ idTienda: 7 }]];
      if (sql.startsWith('SELECT estado,idCliente,subtotal,costoEntrega,total,metodoPago')) return [[{ estado: state }]];
      if (sql.includes('FROM detallePedidoTiendaOnline d')) return [[{
        idDetallePedidoOnline: 100,
        idProducto: 11,
        nombreProductoSnapshot: 'Aceite de oliva',
        cantidad: 14,
        stockUnidadesTotal: stock,
        controlaLotes: 0,
        controlaVencimiento: 0,
        activo: 1
      }]];
      if (sql.startsWith('UPDATE producto SET stockUnidadesTotal')) {
        assert.strictEqual(params[4], stock);
        stock = Number(params[0]);
        events.push(`stock:${stock}`);
        return [{ affectedRows: 1 }];
      }
      if (sql.includes('INSERT INTO movimientoStock')) {
        movementId += 1;
        events.push(params[2] === 'salida' ? 'movimiento:salida' : 'movimiento:entrada');
        return [{ insertId: movementId }];
      }
      if (sql.startsWith('SELECT idMovimientoStock FROM movimientoStock')) return [[{ idMovimientoStock: 501 }]];
      if (sql.startsWith('UPDATE pedidoTiendaOnline')) {
        state = params[0];
        events.push(`pedido:${state}`);
        return [{ affectedRows: 1 }];
      }
      throw new Error(`Consulta inesperada: ${sql.slice(0, 100)} ${JSON.stringify(params)}`);
    }
  };
  const service = createOnlineStoreService({
    database: { async getConnection() { return connection; } },
    clock: () => '2026-10-11 12:00:00'
  });
  const ready = await service.updateOrder({ idTienda: 7, idAdministrador: 3 }, 99, { estado: 'listo' });
  assert.deepStrictEqual(ready, { actualizado: true, inventario: 'descontado', venta: null });
  assert.strictEqual(stock, 0);
  assert.deepStrictEqual(events.slice(0, 6), ['begin', 'stock:0', 'movimiento:salida', 'pedido:listo', 'commit', 'release']);

  events.length = 0;
  const cancelled = await service.updateOrder({ idTienda: 7, idAdministrador: 3 }, 99, { estado: 'cancelado' });
  assert.deepStrictEqual(cancelled, { actualizado: true, inventario: 'repuesto', venta: null });
  assert.strictEqual(stock, 14);
  assert.deepStrictEqual(events, ['begin', 'stock:14', 'movimiento:entrada', 'pedido:cancelado', 'commit', 'release']);
}

async function orderReadyShortageContract() {
  const events = [];
  const connection = {
    async beginTransaction() { events.push('begin'); },
    async rollback() { events.push('rollback'); },
    release() { events.push('release'); },
    async query(sql) {
      if (sql.startsWith('SELECT idTienda FROM tienda')) return [[{ idTienda: 7 }]];
      if (sql.startsWith('SELECT estado,idCliente,subtotal,costoEntrega,total,metodoPago')) return [[{ estado: 'preparando' }]];
      if (sql.includes('FROM detallePedidoTiendaOnline d')) return [[{
        idDetallePedidoOnline: 101,
        idProducto: 12,
        nombreProductoSnapshot: 'Aceite de oliva',
        cantidad: 14,
        stockUnidadesTotal: 8,
        controlaLotes: 0,
        controlaVencimiento: 0,
        activo: 1
      }]];
      throw new Error(`No debía continuar después de detectar stock insuficiente: ${sql.slice(0, 80)}`);
    }
  };
  const service = createOnlineStoreService({ database: { async getConnection() { return connection; } } });
  await assert.rejects(
    () => service.updateOrder({ idTienda: 7, idAdministrador: 3 }, 100, { estado: 'listo' }),
    (error) => error.code === 'ONLINE_STORE_READY_STOCK_INSUFFICIENT'
      && error.message.includes('el pedido necesita 14, pero solo quedan 8 unidades')
  );
  assert.deepStrictEqual(events, ['begin', 'rollback', 'release']);
}

async function stockShortageContract() {
  const connection = {
    async beginTransaction() {},
    async rollback() {},
    release() {},
    async query(sql) {
      if (sql.startsWith('SELECT idTienda FROM tienda')) return [[{ idTienda: 7 }]];
      if (sql.includes('COUNT(*) total FROM pedidoTiendaOnline')) return [[{ total: 0 }]];
      if (sql.includes('FROM producto p') && sql.includes('FOR UPDATE')) return [[{
        idProducto: 11, nombre: 'MICII', unidadMedida: 'unidad', precioVenta: 8.5,
        stockUnidadesTotal: 14, publicado: 1
      }]];
      if (sql.includes('SUM(d.cantidad) stockReservado')) return [[]];
      throw new Error(`Consulta inesperada: ${sql.slice(0, 80)}`);
    }
  };
  const database = {
    async getConnection() { return connection; },
    async query(sql) {
      if (sql.includes('FROM tienda t') && sql.includes('configuracionTiendaOnline')) return [[{
        idTienda: 7, slug: 'tienda-prueba', nombre: 'Tienda Prueba', nombreMostrado: 'Mi Tienda',
        activa: 1, permiteRecojo: 1, permiteEntrega: 1, permiteEfectivo: 1, permiteQr: 1,
        pedidoMinimo: 0, costoEntrega: 0, tiempoPreparacionMinutos: 30
      }]];
      throw new Error(`Consulta inesperada: ${sql.slice(0, 80)}`);
    }
  };
  const service = createOnlineStoreService({
    database,
    subscriptionResolver: async () => ({ estadoAcceso: 'completo', caracteristicas: ['portal_clientes'], plan: { codigo: 'pro' } })
  });
  await assert.rejects(
    () => service.createPublicOrder('tienda-prueba', {
      telefono: '76543210', nombre: 'Cliente', tipoEntrega: 'recojo',
      franjaEntrega: 'noche', metodoPago: 'efectivo', productos: [{ idProducto: 11, cantidad: 15 }]
    }),
    (error) => error.code === 'ONLINE_STORE_STOCK_CHANGED'
      && error.message.includes('MICII: pediste 15 y solo quedan 14 disponibles.')
  );
}

async function reservedStockContract() {
  const connection = {
    async beginTransaction() {}, async rollback() {}, release() {},
    async query(sql) {
      if (sql.startsWith('SELECT idTienda FROM tienda')) return [[{ idTienda: 7 }]];
      if (sql.includes('COUNT(*) total FROM pedidoTiendaOnline')) return [[{ total: 1 }]];
      if (sql.includes('FROM producto p') && sql.includes('FOR UPDATE')) return [[{
        idProducto: 11, nombre: 'Soda', unidadMedida: 'unidad', precioVenta: 10,
        stockUnidadesTotal: 10, publicado: 1
      }]];
      if (sql.includes('SUM(d.cantidad) stockReservado')) return [[{ idProducto: 11, stockReservado: 10 }]];
      throw new Error(`Consulta inesperada: ${sql.slice(0, 80)}`);
    }
  };
  const database = {
    async getConnection() { return connection; },
    async query(sql) {
      if (sql.includes('FROM tienda t') && sql.includes('configuracionTiendaOnline')) return [[{
        idTienda: 7, slug: 'tienda-prueba', nombre: 'Tienda Prueba', nombreMostrado: 'Mi Tienda',
        activa: 1, permiteRecojo: 1, permiteEntrega: 1, permiteEfectivo: 1, permiteQr: 1,
        pedidoMinimo: 0, costoEntrega: 0, tiempoPreparacionMinutos: 30
      }]];
      throw new Error(`Consulta inesperada: ${sql.slice(0, 80)}`);
    }
  };
  const service = createOnlineStoreService({
    database,
    subscriptionResolver: async () => ({ estadoAcceso: 'completo', caracteristicas: ['portal_clientes'], plan: { codigo: 'pro' } })
  });
  await assert.rejects(
    () => service.createPublicOrder('tienda-prueba', {
      telefono: '76543210', nombre: 'Cliente', tipoEntrega: 'recojo', franjaEntrega: 'noche',
      metodoPago: 'efectivo', productos: [{ idProducto: 11, cantidad: 2 }]
    }),
    (error) => error.code === 'ONLINE_STORE_STOCK_CHANGED'
      && error.message.includes('0 disponibles (10 reservadas para otros pedidos)')
  );
}

async function orderItemsEditContract() {
  const events = [];
  const connection = {
    async beginTransaction() { events.push('begin'); },
    async commit() { events.push('commit'); },
    async rollback() { events.push('rollback'); },
    release() { events.push('release'); },
    async query(sql, params) {
      if (sql.startsWith('SELECT idTienda FROM tienda')) return [[{ idTienda: 7 }]];
      if (sql.startsWith('SELECT estado,tipoEntrega')) return [[{ estado: 'preparando', tipoEntrega: 'entrega' }]];
      if (sql.startsWith('SELECT idDetallePedidoOnline,cantidad,precioUnitario')) return [[
        { idDetallePedidoOnline: 101, cantidad: 4, precioUnitario: 10 },
        { idDetallePedidoOnline: 102, cantidad: 2, precioUnitario: 15 }
      ]];
      if (sql.startsWith('UPDATE detallePedidoTiendaOnline')) {
        assert.deepStrictEqual(params.slice(0, 2), [2, 20]);
        events.push('detalle-actualizado');
        return [{ affectedRows: 1 }];
      }
      if (sql.startsWith('DELETE FROM detallePedidoTiendaOnline')) {
        assert.strictEqual(params[2], 102);
        events.push('detalle-eliminado');
        return [{ affectedRows: 1 }];
      }
      if (sql.startsWith('SELECT pedidoMinimo,costoEntrega')) return [[{ pedidoMinimo: 50, costoEntrega: 5 }]];
      if (sql.startsWith('UPDATE pedidoTiendaOnline')) {
        assert.deepStrictEqual(params.slice(0, 3), [20, 5, 25]);
        events.push('pedido-recalculado');
        return [{ affectedRows: 1 }];
      }
      throw new Error(`Consulta inesperada: ${sql.slice(0, 90)}`);
    }
  };
  const service = createOnlineStoreService({
    database: { async getConnection() { return connection; } },
    clock: () => '2026-10-11 13:00:00'
  });
  const result = await service.updateOrderItems({ idTienda: 7, idAdministrador: 3 }, 99, {
    productos: [{ idDetallePedidoOnline: 101, cantidad: 2 }]
  });
  assert.deepStrictEqual(result, { actualizado: true, subtotal: 20, costoEntrega: 5, total: 25 });
  assert.deepStrictEqual(events, ['begin', 'detalle-actualizado', 'detalle-eliminado', 'pedido-recalculado', 'commit', 'release']);
}

Promise.all([serviceContract(), orderContract(), orderWorkflowContract(), orderCreditWorkflowContract(), orderInventoryContract(), orderReadyShortageContract(), stockShortageContract(), reservedStockContract(), orderItemsEditContract()])
  .then(() => console.log('test:online-store-foundation OK'))
  .catch((error) => {
    console.error(`Error: ${error.message}`);
    process.exitCode = 1;
  });
