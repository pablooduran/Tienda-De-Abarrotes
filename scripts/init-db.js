const { createDatabaseConnection } = require('../config/database-connection');
const { databaseConfig, logDatabaseTarget } = require('../config/env');
const {
  assertEmptyRemoteStagingDatabase,
  resolveDatabaseMutationMode
} = require('../config/staging-database-mutation-guard');
const {
  classifyRemoteOperationFailure,
  remoteOperationStatus
} = require('../config/staging-remote-operation-status');

const requiredColumns = {
  administrador: ['idAdministrador', 'usuario', 'password'],
  cliente: ['idCliente', 'nombre', 'telefono', 'activo', 'eliminadoEn'],
  proveedor: ['idProveedor', 'nombre', 'telefono', 'direccion'],
  producto: ['idProducto', 'nombre', 'idProveedor', 'categoria', 'unidadMedida', 'unidadesPorPaquete', 'paquetesPorCaja', 'precioVenta', 'stock', 'stockMinimo', 'stockUnidadesTotal', 'ultimoPrecioCompra', 'permiteVentaPorPaquete', 'permiteVentaPorUnidad'],
  venta: ['idVenta', 'fecha', 'total', 'tipo', 'idCliente'],
  detalleVenta: ['idDetalleVenta', 'idVenta', 'idProducto', 'cantidad', 'precioVenta', 'costoUnitario', 'subtotal', 'subtotalCosto', 'ganancia', 'presentacionVenta', 'cantidadEquivalenteUnidades'],
  compra: ['idCompra', 'fecha', 'total', 'idProveedor'],
  detalleCompra: ['idDetalleCompra', 'idCompra', 'idProducto', 'cantidad', 'precioCompra', 'subtotal', 'presentacionCompra', 'cantidadEquivalenteUnidades'],
  fiado: ['idFiado', 'idCliente', 'idVenta', 'fechaInicio', 'totalFiado', 'totalPagado', 'saldoPendiente', 'estado', 'activo', 'eliminadoEn'],
  detalleFiado: ['idDetalleFiado', 'idFiado', 'idProducto', 'cantidad', 'precio', 'subtotal'],
  pagoFiado: ['idPagoFiado', 'idFiado', 'fechaPago', 'monto', 'observacion']
};

const requiredRelations = [
  ['producto', 'idProveedor', 'proveedor', 'idProveedor'],
  ['venta', 'idCliente', 'cliente', 'idCliente'],
  ['detalleVenta', 'idVenta', 'venta', 'idVenta'],
  ['detalleVenta', 'idProducto', 'producto', 'idProducto'],
  ['compra', 'idProveedor', 'proveedor', 'idProveedor'],
  ['detalleCompra', 'idCompra', 'compra', 'idCompra'],
  ['detalleCompra', 'idProducto', 'producto', 'idProducto'],
  ['fiado', 'idCliente', 'cliente', 'idCliente'],
  ['fiado', 'idVenta', 'venta', 'idVenta'],
  ['detalleFiado', 'idFiado', 'fiado', 'idFiado'],
  ['detalleFiado', 'idProducto', 'producto', 'idProducto'],
  ['pagoFiado', 'idFiado', 'fiado', 'idFiado']
];

async function createBaseTables(connection) {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS administrador (
      idAdministrador INT AUTO_INCREMENT PRIMARY KEY,
      usuario VARCHAR(50) NOT NULL UNIQUE,
      password VARCHAR(255) NOT NULL
    )
  `);
  await connection.query(`
    CREATE TABLE IF NOT EXISTS cliente (
      idCliente INT AUTO_INCREMENT PRIMARY KEY,
      nombre VARCHAR(100) NOT NULL,
      telefono VARCHAR(30) NULL,
      activo TINYINT(1) NOT NULL DEFAULT 1,
      eliminadoEn DATETIME NULL
    )
  `);
  await connection.query(`
    CREATE TABLE IF NOT EXISTS proveedor (
      idProveedor INT AUTO_INCREMENT PRIMARY KEY,
      nombre VARCHAR(100) NOT NULL,
      telefono VARCHAR(30) NULL,
      direccion VARCHAR(150) NULL
    )
  `);
  await connection.query(`
    CREATE TABLE IF NOT EXISTS producto (
      idProducto INT AUTO_INCREMENT PRIMARY KEY,
      nombre VARCHAR(100) NOT NULL,
      idProveedor INT NULL,
      categoria VARCHAR(50) NOT NULL DEFAULT 'otros',
      unidadMedida ENUM('unidad','paquete','kilo','gramo','litro','mililitro','caja','docena','bolsa') NOT NULL DEFAULT 'unidad',
      unidadesPorPaquete INT NOT NULL DEFAULT 1,
      paquetesPorCaja INT NOT NULL DEFAULT 1,
      precioVenta DECIMAL(10,2) NOT NULL,
      stock INT NOT NULL DEFAULT 0,
      stockMinimo INT NOT NULL DEFAULT 5,
      stockUnidadesTotal INT NOT NULL DEFAULT 0,
      ultimoPrecioCompra DECIMAL(10,2) NOT NULL DEFAULT 0,
      permiteVentaPorPaquete BOOLEAN NOT NULL DEFAULT TRUE,
      permiteVentaPorUnidad BOOLEAN NOT NULL DEFAULT TRUE,
      CONSTRAINT fk_producto_proveedor FOREIGN KEY (idProveedor) REFERENCES proveedor(idProveedor)
    )
  `);
  await connection.query(`
    CREATE TABLE IF NOT EXISTS venta (
      idVenta INT AUTO_INCREMENT PRIMARY KEY,
      fecha DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      total DECIMAL(10,2) NOT NULL,
      tipo ENUM('pagada','fiada') NOT NULL DEFAULT 'pagada',
      idCliente INT NULL,
      CONSTRAINT fk_venta_cliente FOREIGN KEY (idCliente) REFERENCES cliente(idCliente)
    )
  `);
  await connection.query(`
    CREATE TABLE IF NOT EXISTS detalleVenta (
      idDetalleVenta INT AUTO_INCREMENT PRIMARY KEY,
      idVenta INT NOT NULL,
      idProducto INT NOT NULL,
      cantidad DECIMAL(10,2) NOT NULL,
      precioVenta DECIMAL(10,2) NOT NULL,
      costoUnitario DECIMAL(10,2) NOT NULL DEFAULT 0,
      subtotal DECIMAL(10,2) NOT NULL,
      subtotalCosto DECIMAL(10,2) NOT NULL DEFAULT 0,
      ganancia DECIMAL(10,2) NOT NULL DEFAULT 0,
      presentacionVenta VARCHAR(30) NOT NULL DEFAULT 'unidad',
      cantidadEquivalenteUnidades INT NOT NULL DEFAULT 0,
      CONSTRAINT fk_detalleVenta_venta FOREIGN KEY (idVenta) REFERENCES venta(idVenta),
      CONSTRAINT fk_detalleVenta_producto FOREIGN KEY (idProducto) REFERENCES producto(idProducto)
    )
  `);
  await connection.query(`
    CREATE TABLE IF NOT EXISTS compra (
      idCompra INT AUTO_INCREMENT PRIMARY KEY,
      fecha DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      total DECIMAL(10,2) NOT NULL,
      idProveedor INT NULL,
      CONSTRAINT fk_compra_proveedor FOREIGN KEY (idProveedor) REFERENCES proveedor(idProveedor)
    )
  `);
  await connection.query(`
    CREATE TABLE IF NOT EXISTS detalleCompra (
      idDetalleCompra INT AUTO_INCREMENT PRIMARY KEY,
      idCompra INT NOT NULL,
      idProducto INT NOT NULL,
      cantidad DECIMAL(10,2) NOT NULL,
      precioCompra DECIMAL(10,2) NOT NULL,
      subtotal DECIMAL(10,2) NOT NULL,
      presentacionCompra VARCHAR(30) NOT NULL DEFAULT 'unidad',
      cantidadEquivalenteUnidades INT NOT NULL DEFAULT 0,
      CONSTRAINT fk_detalleCompra_compra FOREIGN KEY (idCompra) REFERENCES compra(idCompra),
      CONSTRAINT fk_detalleCompra_producto FOREIGN KEY (idProducto) REFERENCES producto(idProducto)
    )
  `);
  await connection.query(`
    CREATE TABLE IF NOT EXISTS fiado (
      idFiado INT AUTO_INCREMENT PRIMARY KEY,
      idCliente INT NOT NULL,
      idVenta INT NULL,
      fechaInicio DATE NOT NULL,
      totalFiado DECIMAL(10,2) NOT NULL DEFAULT 0,
      totalPagado DECIMAL(10,2) NOT NULL DEFAULT 0,
      saldoPendiente DECIMAL(10,2) NOT NULL DEFAULT 0,
      estado ENUM('pendiente','parcial','pagado') NOT NULL DEFAULT 'pendiente',
      activo TINYINT(1) NOT NULL DEFAULT 1,
      eliminadoEn DATETIME NULL,
      CONSTRAINT fk_fiado_cliente FOREIGN KEY (idCliente) REFERENCES cliente(idCliente),
      CONSTRAINT fk_fiado_venta FOREIGN KEY (idVenta) REFERENCES venta(idVenta)
    )
  `);
  await connection.query(`
    CREATE TABLE IF NOT EXISTS detalleFiado (
      idDetalleFiado INT AUTO_INCREMENT PRIMARY KEY,
      idFiado INT NOT NULL,
      idProducto INT NOT NULL,
      cantidad DECIMAL(10,2) NOT NULL,
      precio DECIMAL(10,2) NOT NULL,
      subtotal DECIMAL(10,2) NOT NULL,
      CONSTRAINT fk_detalleFiado_fiado FOREIGN KEY (idFiado) REFERENCES fiado(idFiado),
      CONSTRAINT fk_detalleFiado_producto FOREIGN KEY (idProducto) REFERENCES producto(idProducto)
    )
  `);
  await connection.query(`
    CREATE TABLE IF NOT EXISTS pagoFiado (
      idPagoFiado INT AUTO_INCREMENT PRIMARY KEY,
      idFiado INT NOT NULL,
      fechaPago DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      monto DECIMAL(10,2) NOT NULL,
      observacion VARCHAR(150) NULL,
      CONSTRAINT fk_pagoFiado_fiado FOREIGN KEY (idFiado) REFERENCES fiado(idFiado)
    )
  `);
}

async function verifyStructure(connection) {
  const missing = [];
  for (const [table, columns] of Object.entries(requiredColumns)) {
    const [rows] = await connection.query(
      `SELECT COLUMN_NAME
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA=? AND TABLE_NAME=?`,
      [process.env.DB_NAME, table]
    );
    const existing = new Set(rows.map((row) => row.COLUMN_NAME));
    columns.forEach((column) => {
      if (!existing.has(column)) missing.push(`${table}.${column}`);
    });
  }
  if (missing.length) {
    throw new Error(`La estructura existente requiere migraciones. Faltan columnas: ${missing.join(', ')}.`);
  }

  const missingRelations = [];
  for (const [table, column, referencedTable, referencedColumn] of requiredRelations) {
    const [rows] = await connection.query(
      `SELECT COUNT(*) total
       FROM information_schema.KEY_COLUMN_USAGE
       WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND COLUMN_NAME=?
         AND REFERENCED_TABLE_NAME=? AND REFERENCED_COLUMN_NAME=?`,
      [process.env.DB_NAME, table, column, referencedTable, referencedColumn]
    );
    if (!Number(rows[0].total)) missingRelations.push(`${table}.${column}`);
  }
  if (missingRelations.length) {
    throw new Error(`La estructura existente requiere migraciones. Faltan relaciones: ${missingRelations.join(', ')}.`);
  }
}

async function runInitialization({
  args = process.argv.slice(2),
  resolveMode = resolveDatabaseMutationMode,
  buildConfig = databaseConfig,
  connect = createDatabaseConnection,
  logTarget = logDatabaseTarget,
  assertEmpty = assertEmptyRemoteStagingDatabase
} = {}) {
  const remoteRequested = args.includes('--remote-staging');
  let phase = 'AUTHORIZATION';
  let connection;
  try {
    const mode = resolveMode({ args });
    phase = 'CONFIGURATION';
    const config = buildConfig({ decimalNumbers: true });
    logTarget('Inicializacion de estructura', config);
    connection = await connect(config, { onPhase: (nextPhase) => { phase = nextPhase; } });
    if (mode.type === 'remote-staging') {
      phase = 'EMPTY_DATABASE';
      await assertEmpty(connection, config.database);
    }
    phase = 'BASE_SCHEMA';
    await createBaseTables(connection);
    phase = 'STRUCTURE_VERIFICATION';
    await verifyStructure(connection);
    return { remote: mode.type === 'remote-staging', passed: true };
  } catch (error) {
    if (remoteRequested) {
      return {
        remote: true,
        passed: false,
        phase,
        cause: classifyRemoteOperationFailure(error, phase)
      };
    }
    throw error;
  } finally {
    if (connection) await connection.end();
  }
}

async function main() {
  const result = await runInitialization();
  if (result.remote) {
    console.log(remoteOperationStatus('INIT', result));
    if (!result.passed) process.exitCode = 1;
    return;
  }
  console.log('Estructura inicial verificada. No se modificaron datos ni se ejecutaron migraciones.');
}

if (require.main === module) {
  main().catch((error) => {
    console.error('No se pudo inicializar la estructura de la base de datos.');
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = { createBaseTables, runInitialization, verifyStructure };
