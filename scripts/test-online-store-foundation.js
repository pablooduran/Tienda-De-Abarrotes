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
const schema = fs.readFileSync(path.join(root, 'database', 'tienda_abarrotes.sql'), 'utf8');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const migrator = fs.readFileSync(path.join(root, 'scripts', 'migrate-db.js'), 'utf8');
const ownerUi = fs.readFileSync(path.join(root, 'public', 'js', 'online-store-admin-ui.js'), 'utf8');
const publicUi = fs.readFileSync(path.join(root, 'public', 'js', 'storefront.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'public', 'js', 'app.js'), 'utf8');

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
assert(app.includes("features.includes('portal_clientes')"));
assert(ownerUi.includes('/api/tienda-online/productos/'));
assert(ownerUi.includes('Todos se muestran por defecto'));
assert(!ownerUi.includes('Descripción para el cliente'));
assert(!ownerUi.includes('Máximo por pedido'));
assert(!ownerUi.includes('Permitir sustitución'));
assert(publicUi.includes('/api/public/tiendas/'));
assert(publicUi.includes('data-cart-action'));
assert(publicUi.includes('data-quantity-dialog'));
assert(!publicUi.includes('stockUnidadesTotal'));

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

serviceContract()
  .then(() => console.log('test:online-store-foundation OK'))
  .catch((error) => {
    console.error(`Error: ${error.message}`);
    process.exitCode = 1;
  });
