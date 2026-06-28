const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const mysql = require('mysql2/promise');
require('dotenv').config();

const requiredEnv = ['DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME'];

function requireEnv() {
  const missing = requiredEnv.filter((key) => !process.env[key]);
  if (missing.length) {
    throw new Error(`Faltan variables de entorno: ${missing.join(', ')}`);
  }
}

function connectionConfig(database = process.env.DB_NAME) {
  const useSsl = String(process.env.DB_SSL || '').toLowerCase() === 'true'
    || /aivencloud\.com$/i.test(process.env.DB_HOST || '');

  return {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database,
    port: Number(process.env.DB_PORT || 3306),
    multipleStatements: false,
    decimalNumbers: true,
    ssl: useSsl ? { rejectUnauthorized: false } : undefined
  };
}

async function columnExists(connection, table, column) {
  const [rows] = await connection.query(
    `SELECT COUNT(*) total
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [process.env.DB_NAME, table, column]
  );
  return Number(rows[0].total) > 0;
}

async function addColumnIfMissing(connection, table, column, definition) {
  if (!await columnExists(connection, table, column)) {
    await connection.query(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
    console.log(`Columna creada: ${table}.${column}`);
  }
}

async function foreignKeyExists(connection, table, column, referencedTable, referencedColumn) {
  const [rows] = await connection.query(
    `SELECT COUNT(*) total
     FROM information_schema.KEY_COLUMN_USAGE
     WHERE TABLE_SCHEMA = ?
       AND TABLE_NAME = ?
       AND COLUMN_NAME = ?
       AND REFERENCED_TABLE_NAME = ?
       AND REFERENCED_COLUMN_NAME = ?`,
    [process.env.DB_NAME, table, column, referencedTable, referencedColumn]
  );
  return Number(rows[0].total) > 0;
}

async function addForeignKeyIfMissing(connection, table, column, referencedTable, referencedColumn, keyName, sql) {
  if (!await foreignKeyExists(connection, table, column, referencedTable, referencedColumn)) {
    try {
      await connection.query(sql);
      console.log(`Relacion creada: ${keyName}`);
    } catch (error) {
      if (!['ER_FK_DUP_NAME', 'ER_DUP_KEYNAME'].includes(error.code)) throw error;
    }
  }
}

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
      telefono VARCHAR(30) NULL
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
      categoria VARCHAR(50) NOT NULL DEFAULT 'OTROS',
      unidadMedida ENUM('unidad','paquete','kilo','gramo','litro','mililitro','caja','docena','bolsa') NOT NULL DEFAULT 'unidad',
      unidadesPorPaquete INT NOT NULL DEFAULT 1,
      paquetesPorCaja INT NOT NULL DEFAULT 1,
      precioVenta DECIMAL(10,2) NOT NULL,
      stock INT NOT NULL DEFAULT 0,
      stockMinimo INT NOT NULL DEFAULT 5,
      stockUnidadesTotal INT NOT NULL DEFAULT 0,
      ultimoPrecioCompra DECIMAL(10,2) NOT NULL DEFAULT 0,
      permiteVentaPorPaquete BOOLEAN NOT NULL DEFAULT TRUE,
      permiteVentaPorUnidad BOOLEAN NOT NULL DEFAULT TRUE
    )
  `);

  await connection.query(`
    CREATE TABLE IF NOT EXISTS venta (
      idVenta INT AUTO_INCREMENT PRIMARY KEY,
      fecha DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      total DECIMAL(10,2) NOT NULL,
      tipo ENUM('pagada','fiada') NOT NULL DEFAULT 'pagada',
      idCliente INT NULL
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
      cantidadEquivalenteUnidades INT NOT NULL DEFAULT 0
    )
  `);

  await connection.query(`
    CREATE TABLE IF NOT EXISTS compra (
      idCompra INT AUTO_INCREMENT PRIMARY KEY,
      fecha DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      total DECIMAL(10,2) NOT NULL,
      idProveedor INT NULL
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
      cantidadEquivalenteUnidades INT NOT NULL DEFAULT 0
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
      estado ENUM('pendiente','parcial','pagado') NOT NULL DEFAULT 'pendiente'
    )
  `);

  await connection.query(`
    CREATE TABLE IF NOT EXISTS detalleFiado (
      idDetalleFiado INT AUTO_INCREMENT PRIMARY KEY,
      idFiado INT NOT NULL,
      idProducto INT NOT NULL,
      cantidad DECIMAL(10,2) NOT NULL,
      precio DECIMAL(10,2) NOT NULL,
      subtotal DECIMAL(10,2) NOT NULL
    )
  `);

  await connection.query(`
    CREATE TABLE IF NOT EXISTS pagoFiado (
      idPagoFiado INT AUTO_INCREMENT PRIMARY KEY,
      idFiado INT NOT NULL,
      fechaPago DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      monto DECIMAL(10,2) NOT NULL,
      observacion VARCHAR(150) NULL
    )
  `);
}

async function ensureColumns(connection) {
  await addColumnIfMissing(connection, 'producto', 'idProveedor', 'idProveedor INT NULL AFTER nombre');
  await addColumnIfMissing(connection, 'producto', 'categoria', "categoria VARCHAR(50) NOT NULL DEFAULT 'OTROS' AFTER idProveedor");
  await addColumnIfMissing(connection, 'producto', 'unidadesPorPaquete', 'unidadesPorPaquete INT NOT NULL DEFAULT 1 AFTER unidadMedida');
  await addColumnIfMissing(connection, 'producto', 'paquetesPorCaja', 'paquetesPorCaja INT NOT NULL DEFAULT 1 AFTER unidadesPorPaquete');
  await addColumnIfMissing(connection, 'producto', 'stockUnidadesTotal', 'stockUnidadesTotal INT NOT NULL DEFAULT 0 AFTER stockMinimo');
  await addColumnIfMissing(connection, 'producto', 'ultimoPrecioCompra', 'ultimoPrecioCompra DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER stockUnidadesTotal');
  await addColumnIfMissing(connection, 'producto', 'permiteVentaPorPaquete', 'permiteVentaPorPaquete BOOLEAN NOT NULL DEFAULT TRUE AFTER ultimoPrecioCompra');
  await addColumnIfMissing(connection, 'producto', 'permiteVentaPorUnidad', 'permiteVentaPorUnidad BOOLEAN NOT NULL DEFAULT TRUE AFTER permiteVentaPorPaquete');

  await addColumnIfMissing(connection, 'venta', 'tipo', "tipo ENUM('pagada','fiada') NOT NULL DEFAULT 'pagada' AFTER total");

  await addColumnIfMissing(connection, 'fiado', 'idVenta', 'idVenta INT NULL AFTER idCliente');

  await addColumnIfMissing(connection, 'detalleVenta', 'costoUnitario', 'costoUnitario DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER precioVenta');
  await addColumnIfMissing(connection, 'detalleVenta', 'subtotalCosto', 'subtotalCosto DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER subtotal');
  await addColumnIfMissing(connection, 'detalleVenta', 'ganancia', 'ganancia DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER subtotalCosto');
  await addColumnIfMissing(connection, 'detalleVenta', 'presentacionVenta', "presentacionVenta VARCHAR(30) NOT NULL DEFAULT 'unidad' AFTER ganancia");
  await addColumnIfMissing(connection, 'detalleVenta', 'cantidadEquivalenteUnidades', 'cantidadEquivalenteUnidades INT NOT NULL DEFAULT 0 AFTER presentacionVenta');

  await addColumnIfMissing(connection, 'detalleCompra', 'presentacionCompra', "presentacionCompra VARCHAR(30) NOT NULL DEFAULT 'unidad' AFTER subtotal");
  await addColumnIfMissing(connection, 'detalleCompra', 'cantidadEquivalenteUnidades', 'cantidadEquivalenteUnidades INT NOT NULL DEFAULT 0 AFTER presentacionCompra');
}

async function ensureRelations(connection) {
  await addForeignKeyIfMissing(connection, 'producto', 'idProveedor', 'proveedor', 'idProveedor', 'fk_producto_proveedor', 'ALTER TABLE producto ADD CONSTRAINT fk_producto_proveedor FOREIGN KEY (idProveedor) REFERENCES proveedor(idProveedor)');
  await addForeignKeyIfMissing(connection, 'venta', 'idCliente', 'cliente', 'idCliente', 'fk_venta_cliente', 'ALTER TABLE venta ADD CONSTRAINT fk_venta_cliente FOREIGN KEY (idCliente) REFERENCES cliente(idCliente)');
  await addForeignKeyIfMissing(connection, 'detalleVenta', 'idVenta', 'venta', 'idVenta', 'fk_detalleVenta_venta', 'ALTER TABLE detalleVenta ADD CONSTRAINT fk_detalleVenta_venta FOREIGN KEY (idVenta) REFERENCES venta(idVenta)');
  await addForeignKeyIfMissing(connection, 'detalleVenta', 'idProducto', 'producto', 'idProducto', 'fk_detalleVenta_producto', 'ALTER TABLE detalleVenta ADD CONSTRAINT fk_detalleVenta_producto FOREIGN KEY (idProducto) REFERENCES producto(idProducto)');
  await addForeignKeyIfMissing(connection, 'compra', 'idProveedor', 'proveedor', 'idProveedor', 'fk_compra_proveedor', 'ALTER TABLE compra ADD CONSTRAINT fk_compra_proveedor FOREIGN KEY (idProveedor) REFERENCES proveedor(idProveedor)');
  await addForeignKeyIfMissing(connection, 'detalleCompra', 'idCompra', 'compra', 'idCompra', 'fk_detalleCompra_compra', 'ALTER TABLE detalleCompra ADD CONSTRAINT fk_detalleCompra_compra FOREIGN KEY (idCompra) REFERENCES compra(idCompra)');
  await addForeignKeyIfMissing(connection, 'detalleCompra', 'idProducto', 'producto', 'idProducto', 'fk_detalleCompra_producto', 'ALTER TABLE detalleCompra ADD CONSTRAINT fk_detalleCompra_producto FOREIGN KEY (idProducto) REFERENCES producto(idProducto)');
  await addForeignKeyIfMissing(connection, 'fiado', 'idCliente', 'cliente', 'idCliente', 'fk_fiado_cliente', 'ALTER TABLE fiado ADD CONSTRAINT fk_fiado_cliente FOREIGN KEY (idCliente) REFERENCES cliente(idCliente)');
  await addForeignKeyIfMissing(connection, 'fiado', 'idVenta', 'venta', 'idVenta', 'fk_fiado_venta', 'ALTER TABLE fiado ADD CONSTRAINT fk_fiado_venta FOREIGN KEY (idVenta) REFERENCES venta(idVenta)');
  await addForeignKeyIfMissing(connection, 'detalleFiado', 'idFiado', 'fiado', 'idFiado', 'fk_detalleFiado_fiado', 'ALTER TABLE detalleFiado ADD CONSTRAINT fk_detalleFiado_fiado FOREIGN KEY (idFiado) REFERENCES fiado(idFiado)');
  await addForeignKeyIfMissing(connection, 'detalleFiado', 'idProducto', 'producto', 'idProducto', 'fk_detalleFiado_producto', 'ALTER TABLE detalleFiado ADD CONSTRAINT fk_detalleFiado_producto FOREIGN KEY (idProducto) REFERENCES producto(idProducto)');
  await addForeignKeyIfMissing(connection, 'pagoFiado', 'idFiado', 'fiado', 'idFiado', 'fk_pagoFiado_fiado', 'ALTER TABLE pagoFiado ADD CONSTRAINT fk_pagoFiado_fiado FOREIGN KEY (idFiado) REFERENCES fiado(idFiado)');
}

async function normalizeExistingData(connection) {
  await connection.query(`
    UPDATE producto
    SET
      nombre = UPPER(nombre),
      categoria = UPPER(COALESCE(NULLIF(categoria, ''), 'OTROS')),
      paquetesPorCaja = CASE WHEN paquetesPorCaja < 1 THEN 1 ELSE paquetesPorCaja END,
      unidadesPorPaquete = CASE WHEN unidadesPorPaquete < 1 THEN 1 ELSE unidadesPorPaquete END,
      stock = CASE WHEN stock < 0 THEN 0 ELSE stock END,
      stockMinimo = CASE WHEN stockMinimo < 1 THEN 1 ELSE stockMinimo END,
      stockUnidadesTotal = CASE WHEN stockUnidadesTotal > 0 THEN stockUnidadesTotal ELSE stock END
  `);

  await connection.query(`
    UPDATE detalleVenta dv
    JOIN producto p ON p.idProducto = dv.idProducto
    SET
      dv.costoUnitario = CASE WHEN dv.costoUnitario > 0 THEN dv.costoUnitario ELSE p.ultimoPrecioCompra END,
      dv.cantidadEquivalenteUnidades = CASE WHEN dv.cantidadEquivalenteUnidades > 0 THEN dv.cantidadEquivalenteUnidades ELSE ROUND(dv.cantidad) END,
      dv.subtotalCosto = CASE WHEN dv.subtotalCosto > 0 THEN dv.subtotalCosto ELSE p.ultimoPrecioCompra * ROUND(dv.cantidad) END,
      dv.ganancia = dv.subtotal - CASE WHEN dv.subtotalCosto > 0 THEN dv.subtotalCosto ELSE p.ultimoPrecioCompra * ROUND(dv.cantidad) END
  `);

  await connection.query(`
    UPDATE detalleCompra
    SET cantidadEquivalenteUnidades = CASE WHEN cantidadEquivalenteUnidades > 0 THEN cantidadEquivalenteUnidades ELSE ROUND(cantidad) END
  `);
}

function readSqlStatements(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, 'utf8')
    .split(';')
    .map((part) => part.split(/\r?\n/).filter((line) => !line.trim().startsWith('--')).join('\n').trim())
    .filter(Boolean)
    .filter((statement) => !/^DROP\s+/i.test(statement))
    .filter((statement) => !/^CREATE\s+DATABASE/i.test(statement))
    .filter((statement) => !/^USE\s+/i.test(statement))
    .filter((statement) => !/^INSERT\s+INTO\s+(producto|proveedor|cliente|venta|compra|detalleVenta|detalleCompra|fiado|detalleFiado|pagoFiado)\b/i.test(statement));
}

async function runMigrationStatements(connection) {
  const migrationsDir = path.join(__dirname, '..', 'database', 'migrations');
  if (!fs.existsSync(migrationsDir)) return;

  const files = fs.readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const filePath = path.join(migrationsDir, file);
    const statements = readSqlStatements(filePath);
    for (const statement of statements) {
      try {
        await connection.query(statement);
      } catch (error) {
        const ignorableCodes = ['ER_DUP_FIELDNAME', 'ER_DUP_KEYNAME', 'ER_FK_DUP_NAME', 'ER_CANT_DROP_FIELD_OR_KEY'];
        const duplicateColumnText = /Duplicate column name/i.test(error.message || '');
        const unsupportedIfNotExists = /syntax/i.test(error.message || '') && /IF NOT EXISTS/i.test(statement);
        if (ignorableCodes.includes(error.code) || duplicateColumnText || unsupportedIfNotExists) {
          console.log(`Migracion omitida por existir: ${file}`);
        } else {
          throw error;
        }
      }
    }
  }
}

async function ensureAdmin(connection) {
  const adminUser = process.env.ADMIN_USER || 'admin';
  const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';
  const [rows] = await connection.query('SELECT idAdministrador FROM administrador WHERE usuario = ?', [adminUser]);
  if (rows.length > 0) {
    console.log(`Administrador existente: ${adminUser}`);
    return;
  }

  const hash = await bcrypt.hash(adminPassword, 10);
  await connection.query('INSERT INTO administrador (usuario, password) VALUES (?, ?)', [adminUser, hash]);
  console.log(`Administrador inicial creado: ${adminUser}`);
}

async function main() {
  requireEnv();
  const connection = await mysql.createConnection(connectionConfig(process.env.DB_NAME));
  try {
    await createBaseTables(connection);
    await ensureColumns(connection);
    await ensureRelations(connection);
    await runMigrationStatements(connection);
    await normalizeExistingData(connection);
    await ensureAdmin(connection);
    console.log('Base de datos inicializada sin borrar datos.');
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error('No se pudo inicializar la base de datos.');
  console.error(error.message);
  process.exit(1);
});
