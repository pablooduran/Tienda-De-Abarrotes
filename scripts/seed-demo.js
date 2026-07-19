const { createConnection } = require('./db-utils');
const { logDatabaseTarget, requireLocalhostDatabase } = require('../config/env');
const { formatLocalDateTime } = require('../utils/local-datetime');

const protectedTables = ['cliente', 'proveedor', 'producto', 'venta', 'detalleVenta', 'compra', 'detalleCompra', 'fiado', 'detalleFiado', 'pagoFiado'];

async function main() {
  const config = requireLocalhostDatabase('La carga demo');
  if (String(process.env.ALLOW_DEMO_SEED || '').toLowerCase() !== 'true') {
    throw new Error('La carga demo esta deshabilitada. Use ALLOW_DEMO_SEED=true solo en una base local vacia.');
  }

  logDatabaseTarget('Carga de datos de demostracion', config);
  const connection = await createConnection();
  let transactionStarted = false;
  try {
    for (const table of protectedTables) {
      const [[row]] = await connection.query(`SELECT COUNT(*) total FROM ${table}`);
      if (Number(row.total) > 0) {
        throw new Error('La base contiene datos. La carga demo fue cancelada sin realizar cambios.');
      }
    }

    await connection.beginTransaction();
    transactionStarted = true;
    const [provider] = await connection.query(
      'INSERT INTO proveedor (nombre, telefono, direccion) VALUES (?, ?, ?)',
      ['Proveedor de demostracion', null, null]
    );
    const products = [
      ['Arroz', 'ABARROTES', 'gramo', 1, 1, 0.01, 25000, 5000, 25000, 0.008, false, true],
      ['Aceite', 'ABARROTES', 'mililitro', 1, 1, 0.02, 12000, 3000, 12000, 0.015, false, true],
      ['Shampoo', 'ASEO PERSONAL', 'unidad', 1, 1, 18, 8, 2, 8, 12, false, true],
      ['Bebida gaseosa', 'BEBIDAS', 'unidad', 1, 1, 10, 24, 6, 24, 7, false, true],
      ['Papel higienico', 'ASEO PERSONAL', 'unidad', 12, 4, 2, 120, 24, 120, 1.2, true, true],
      ['Snacks', 'SNACKS', 'bolsa', 1, 1, 5, 30, 8, 30, 3, false, true]
    ];
    const fechaInicioSeguimiento = formatLocalDateTime();
    for (const product of products) {
      await connection.query(
        `INSERT INTO producto
         (nombre, idProveedor, categoria, unidadMedida, unidadesPorPaquete, paquetesPorCaja,
          precioVenta, stock, stockMinimo, stockUnidadesTotal, ultimoPrecioCompra,
          permiteVentaPorPaquete, permiteVentaPorUnidad, fechaInicioSeguimiento)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [product[0], provider.insertId, ...product.slice(1), fechaInicioSeguimiento]
      );
    }
    await connection.commit();
    transactionStarted = false;
    console.log('Datos de demostracion cargados en la base local vacia.');
  } catch (error) {
    if (transactionStarted) await connection.rollback().catch(() => {});
    throw error;
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error('No se pudieron cargar los datos de demostracion.');
  console.error(error.message);
  process.exit(1);
});
