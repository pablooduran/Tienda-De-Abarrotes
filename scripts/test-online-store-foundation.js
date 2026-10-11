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
const schema = fs.readFileSync(path.join(root, 'database', 'tienda_abarrotes.sql'), 'utf8');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const migrator = fs.readFileSync(path.join(root, 'scripts', 'migrate-db.js'), 'utf8');
const ownerUi = fs.readFileSync(path.join(root, 'public', 'js', 'online-store-admin-ui.js'), 'utf8');
const publicUi = fs.readFileSync(path.join(root, 'public', 'js', 'storefront.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'public', 'js', 'app.js'), 'utf8');
const ownerStyles = fs.readFileSync(path.join(root, 'public', 'css', 'styles.css'), 'utf8');

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
assert(ownerUi.includes('Pedidos recibidos'));
assert(ownerUi.includes("let activeView = 'orders'"));
assert(ownerUi.includes('data-online-view="config"'));
assert(ownerUi.includes('data-online-view="products"'));
assert(ownerUi.includes('/api/tienda-online/pedidos?estado=todos'));
assert(ownerUi.includes('global.setTimeout(() =>'));
assert(ownerUi.includes('}, 3000);'));
assert(ownerUi.includes("currentTarget.textContent = '';"));
assert(!publicUi.includes('stockUnidadesTotal'));
assert(/\.online-store-admin\{\r?\n\s+--primary:var\(--brand\);/.test(ownerStyles));
assert(ownerStyles.includes('html:not([data-theme="dark"]) .online-store-hero'));
assert(ownerStyles.includes('html:not([data-theme="dark"]) :is(.online-store-settings-card,.online-store-preview-card,.online-catalog-manager)'));
assert(ownerStyles.includes('.online-store-workspace-nav'));
assert(ownerStyles.includes('border:2px solid color-mix(in srgb,var(--ink) 45%,var(--line))'));

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
  assert.deepStrictEqual(writes, ['begin', 'cliente', 'pedido', 'detalle', 'commit', 'release']);
}

Promise.all([serviceContract(), orderContract()])
  .then(() => console.log('test:online-store-foundation OK'))
  .catch((error) => {
    console.error(`Error: ${error.message}`);
    process.exitCode = 1;
  });
