const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const {
  buildDatabaseOptions,
  isProductionEnvironment,
  setBusinessSessionTimeZone
} = require('../config/database-options');
const {
  LEGACY_MIGRATION_NAMES,
  applyLegacyMigration,
  inspectAllLegacyMigrations,
  inspectLegacyMigration,
  legacySteps,
  migrateLegacyMigration,
  normalizedObjectKey
} = require('./migration-state/legacy-migrations');

const TEMP_PREFIX = 'tmp_tienda_legacy_';
const PROTECTED_DATABASES = new Set([
  'tienda_abarrotes',
  'tienda_abarrotes_pruebas',
  'mysql',
  'information_schema',
  'performance_schema',
  'sys'
]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertTemporaryDatabase(name) {
  const normalized = String(name || '').toLocaleLowerCase('en-US');
  if (!new RegExp(`^${TEMP_PREFIX}[a-f0-9]{12}$`).test(normalized)
    || PROTECTED_DATABASES.has(normalized)) {
    throw new Error(`Base temporal rechazada por la guarda de seguridad: ${name || '(vacia)'}.`);
  }
  return normalized;
}

function quotedTemporaryDatabase(name) {
  return `\`${assertTemporaryDatabase(name)}\``;
}

function temporaryDatabaseName() {
  return `${TEMP_PREFIX}${crypto.randomBytes(6).toString('hex')}`;
}

async function createServerConnection() {
  const environment = String(process.env.APP_ENV || '').trim().toLowerCase();
  if (!['local', 'test'].includes(environment) || isProductionEnvironment(process.env)) {
    throw new Error('test:legacy-migrations solo se permite con APP_ENV=local o APP_ENV=test.');
  }
  const host = String(process.env.DB_HOST || '').trim().toLowerCase();
  if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
    throw new Error('test:legacy-migrations solo se permite contra MySQL local.');
  }
  const options = buildDatabaseOptions(process.env);
  delete options.database;
  return setBusinessSessionTimeZone(await mysql.createConnection(options));
}

async function createTemporaryDatabase(server, name) {
  await server.query(
    `CREATE DATABASE ${quotedTemporaryDatabase(name)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
  );
}

async function dropTemporaryDatabase(server, name) {
  await server.query(`DROP DATABASE IF EXISTS ${quotedTemporaryDatabase(name)}`);
}

async function connectTemporaryDatabase(name) {
  const options = buildDatabaseOptions({
    ...process.env,
    DB_NAME: assertTemporaryDatabase(name)
  });
  return setBusinessSessionTimeZone(await mysql.createConnection(options));
}

async function createLegacyBase(connection, options = {}) {
  const providerId = options.providerWithoutPrimaryKey
    ? 'idProveedor INT NOT NULL'
    : 'idProveedor INT AUTO_INCREMENT PRIMARY KEY';
  const stockNullability = options.nullableStock ? 'NULL' : 'NOT NULL';
  const statements = [
    `CREATE TABLE schema_migrations (
       nombre VARCHAR(255) PRIMARY KEY,
       aplicadaEn DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
     ) ENGINE=InnoDB`,
    `CREATE TABLE administrador (
       idAdministrador INT AUTO_INCREMENT PRIMARY KEY,
       usuario VARCHAR(50) NOT NULL UNIQUE,
       password VARCHAR(255) NOT NULL
     ) ENGINE=InnoDB`,
    `CREATE TABLE cliente (
       idCliente INT AUTO_INCREMENT PRIMARY KEY,
       nombre VARCHAR(100) NOT NULL,
       telefono VARCHAR(30) NULL
     ) ENGINE=InnoDB`,
    `CREATE TABLE proveedor (
       ${providerId},
       nombre VARCHAR(100) NOT NULL,
       telefono VARCHAR(30) NULL,
       direccion VARCHAR(150) NULL
     ) ENGINE=InnoDB`,
    `CREATE TABLE producto (
       idProducto INT AUTO_INCREMENT PRIMARY KEY,
       nombre VARCHAR(100) NOT NULL,
       unidadMedida ENUM('unidad','paquete','kilo','gramo','litro','mililitro','caja','docena','bolsa')
         NOT NULL DEFAULT 'unidad',
       precioVenta DECIMAL(10,2) NOT NULL,
       stock DECIMAL(10,2) ${stockNullability} DEFAULT 0,
       stockMinimo DECIMAL(10,2) NOT NULL DEFAULT 5
     ) ENGINE=InnoDB`,
    `CREATE TABLE venta (
       idVenta INT AUTO_INCREMENT PRIMARY KEY,
       fecha DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
       total DECIMAL(10,2) NOT NULL,
       idCliente INT NULL,
       CONSTRAINT fk_venta_cliente FOREIGN KEY (idCliente) REFERENCES cliente(idCliente)
     ) ENGINE=InnoDB`,
    `CREATE TABLE detalleVenta (
       idDetalleVenta INT AUTO_INCREMENT PRIMARY KEY,
       idVenta INT NOT NULL,
       idProducto INT NOT NULL,
       cantidad DECIMAL(10,2) NOT NULL,
       precioVenta DECIMAL(10,2) NOT NULL,
       subtotal DECIMAL(10,2) NOT NULL,
       CONSTRAINT fk_detalleVenta_venta FOREIGN KEY (idVenta) REFERENCES venta(idVenta),
       CONSTRAINT fk_detalleVenta_producto FOREIGN KEY (idProducto) REFERENCES producto(idProducto)
     ) ENGINE=InnoDB`,
    `CREATE TABLE compra (
       idCompra INT AUTO_INCREMENT PRIMARY KEY,
       fecha DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
       total DECIMAL(10,2) NOT NULL,
       idProveedor INT NULL
     ) ENGINE=InnoDB`,
    `CREATE TABLE detalleCompra (
       idDetalleCompra INT AUTO_INCREMENT PRIMARY KEY,
       idCompra INT NOT NULL,
       idProducto INT NOT NULL,
       cantidad DECIMAL(10,2) NOT NULL,
       precioCompra DECIMAL(10,2) NOT NULL,
       subtotal DECIMAL(10,2) NOT NULL,
       CONSTRAINT fk_detalleCompra_compra FOREIGN KEY (idCompra) REFERENCES compra(idCompra),
       CONSTRAINT fk_detalleCompra_producto FOREIGN KEY (idProducto) REFERENCES producto(idProducto)
     ) ENGINE=InnoDB`,
    `CREATE TABLE fiado (
       idFiado INT AUTO_INCREMENT PRIMARY KEY,
       idCliente INT NOT NULL,
       fechaInicio DATE NOT NULL,
       totalFiado DECIMAL(10,2) NOT NULL DEFAULT 0,
       totalPagado DECIMAL(10,2) NOT NULL DEFAULT 0,
       saldoPendiente DECIMAL(10,2) NOT NULL DEFAULT 0,
       estado ENUM('pendiente','parcial','pagado') NOT NULL DEFAULT 'pendiente',
       CONSTRAINT fk_fiado_cliente FOREIGN KEY (idCliente) REFERENCES cliente(idCliente)
     ) ENGINE=InnoDB`,
    `CREATE TABLE detalleFiado (
       idDetalleFiado INT AUTO_INCREMENT PRIMARY KEY,
       idFiado INT NOT NULL,
       idProducto INT NOT NULL,
       cantidad DECIMAL(10,2) NOT NULL,
       precio DECIMAL(10,2) NOT NULL,
       subtotal DECIMAL(10,2) NOT NULL
     ) ENGINE=InnoDB`,
    `CREATE TABLE pagoFiado (
       idPagoFiado INT AUTO_INCREMENT PRIMARY KEY,
       idFiado INT NOT NULL,
       fechaPago DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
       monto DECIMAL(10,2) NOT NULL,
       observacion VARCHAR(150) NULL
     ) ENGINE=InnoDB`
  ];
  for (const statement of statements) await connection.query(statement);
  if (!options.skipSampleData) {
    await connection.query("INSERT INTO cliente (nombre,telefono) VALUES ('CLIENTE TEMPORAL','70000000')");
    if (options.providerWithoutPrimaryKey) {
      await connection.query("INSERT INTO proveedor (idProveedor,nombre) VALUES (1,'PROVEEDOR TEMPORAL')");
    } else {
      await connection.query("INSERT INTO proveedor (nombre) VALUES ('PROVEEDOR TEMPORAL')");
    }
    await connection.query(
      `INSERT INTO producto (nombre,unidadMedida,precioVenta,stock,stockMinimo)
       VALUES ('producto temporal','unidad',10,3.60,0)`
    );
    await connection.query('INSERT INTO venta (total,idCliente) VALUES (10,1)');
    await connection.query(
      'INSERT INTO detalleVenta (idVenta,idProducto,cantidad,precioVenta,subtotal) VALUES (1,1,1,10,10)'
    );
    await connection.query('INSERT INTO compra (total,idProveedor) VALUES (5,1)');
    await connection.query(
      'INSERT INTO detalleCompra (idCompra,idProducto,cantidad,precioCompra,subtotal) VALUES (1,1,1,5,5)'
    );
    await connection.query(
      `INSERT INTO fiado (idCliente,fechaInicio,totalFiado,totalPagado,saldoPendiente,estado)
       VALUES (1,'2026-01-01',10,0,10,'pendiente')`
    );
  }
}

async function recreateDatabase(server, name, options = {}) {
  await dropTemporaryDatabase(server, name);
  await createTemporaryDatabase(server, name);
  const connection = await connectTemporaryDatabase(name);
  await createLegacyBase(connection, options);
  return connection;
}

async function applyPreviousMigrations(connection, name, schemaName) {
  const migrationIndex = LEGACY_MIGRATION_NAMES.indexOf(name);
  for (const previous of LEGACY_MIGRATION_NAMES.slice(0, migrationIndex)) {
    await migrateLegacyMigration(connection, previous, { schemaName });
  }
}

async function registerMigration(connection, name) {
  await connection.query('INSERT IGNORE INTO schema_migrations (nombre) VALUES (?)', [name]);
}

async function evolveLegacyRelationsToMultiTenant(connection) {
  const statements = [
    `CREATE TABLE tienda (
       idTienda INT NOT NULL PRIMARY KEY,
       nombre VARCHAR(100) NOT NULL
     ) ENGINE=InnoDB`,
    "INSERT INTO tienda (idTienda,nombre) VALUES (1,'TIENDA TEMPORAL')",
    'ALTER TABLE proveedor ADD COLUMN idTienda INT NOT NULL DEFAULT 1',
    'ALTER TABLE producto ADD COLUMN idTienda INT NOT NULL DEFAULT 1',
    'ALTER TABLE venta ADD COLUMN idTienda INT NOT NULL DEFAULT 1',
    'ALTER TABLE fiado ADD COLUMN idTienda INT NOT NULL DEFAULT 1',
    'ALTER TABLE proveedor ADD UNIQUE INDEX uq_proveedor_tienda_id (idTienda,idProveedor)',
    'ALTER TABLE venta ADD UNIQUE INDEX uq_venta_tienda_id (idTienda,idVenta)',
    'ALTER TABLE producto ADD INDEX idx_producto_tienda_proveedor (idTienda,idProveedor)',
    'ALTER TABLE fiado ADD INDEX idx_fiado_tienda_venta (idTienda,idVenta)',
    'ALTER TABLE producto DROP FOREIGN KEY fk_producto_proveedor',
    'ALTER TABLE fiado DROP FOREIGN KEY fk_fiado_venta',
    `ALTER TABLE producto ADD CONSTRAINT fk_producto_tienda_proveedor
       FOREIGN KEY (idTienda,idProveedor) REFERENCES proveedor(idTienda,idProveedor)`,
    `ALTER TABLE fiado ADD CONSTRAINT fk_fiado_tienda_venta
       FOREIGN KEY (idTienda,idVenta) REFERENCES venta(idTienda,idVenta)`
  ];
  for (const statement of statements) await connection.query(statement);
  await registerMigration(connection, '004_multitienda_base.sql');
}

async function applyFinalCostPrecision(connection) {
  await connection.query(
    'ALTER TABLE producto MODIFY COLUMN ultimoPrecioCompra DECIMAL(14,6) NOT NULL DEFAULT 0'
  );
  await connection.query(
    'ALTER TABLE detalleVenta MODIFY COLUMN costoUnitario DECIMAL(14,6) NOT NULL DEFAULT 0'
  );
}

async function registerModernMigrationNames(connection) {
  const migrationNames = fs.readdirSync(path.join(__dirname, '..', 'database', 'migrations'))
    .filter((name) => /^(00[4-9]|01[0-3])_.*\.sql$/i.test(name))
    .sort();
  for (const name of migrationNames) await registerMigration(connection, name);
}

async function testCleanInstallation(server, databaseName) {
  const connection = await recreateDatabase(server, databaseName);
  try {
    for (const name of LEGACY_MIGRATION_NAMES) {
      const result = await migrateLegacyMigration(connection, name, { schemaName: databaseName });
      assert(result.state.estado === 'post', `${name} no termino en post.`);
    }
    for (const name of LEGACY_MIGRATION_NAMES) {
      const repeated = await migrateLegacyMigration(connection, name, { schemaName: databaseName });
      assert(repeated.action === 'ya-registrada', `${name} no fue idempotente.`);
    }
  } finally {
    await connection.end();
  }
}

async function testInterruptedSteps(server, databaseName, migrationName) {
  const totalSteps = legacySteps(migrationName).length;
  for (let stopAfterStep = 1; stopAfterStep <= totalSteps; stopAfterStep += 1) {
    const connection = await recreateDatabase(server, databaseName);
    try {
      await applyPreviousMigrations(connection, migrationName, databaseName);
      let interrupted = false;
      try {
        await applyLegacyMigration(connection, migrationName, {
          schemaName: databaseName,
          stopAfterStep
        });
      } catch (error) {
        interrupted = error.code === 'LEGACY_MIGRATION_INTERRUPTED';
        if (!interrupted) throw error;
      }
      assert(interrupted, `${migrationName} no simulo interrupcion en el paso ${stopAfterStep}.`);
      const partial = await inspectLegacyMigration(connection, migrationName, {
        schemaName: databaseName
      });
      assert(['parcial-recuperable', 'completa-no-registrada'].includes(partial.estado),
        `${migrationName} quedo en estado no recuperable tras el paso ${stopAfterStep}: ${partial.estado}.`);
      const recovered = await migrateLegacyMigration(connection, migrationName, {
        schemaName: databaseName
      });
      assert(recovered.state.estado === 'post',
        `${migrationName} no se recupero despues del paso ${stopAfterStep}.`);
    } finally {
      await connection.end();
    }
  }
}

async function testCompleteWithoutRegistration(server, databaseName) {
  const connection = await recreateDatabase(server, databaseName);
  try {
    await applyLegacyMigration(connection, LEGACY_MIGRATION_NAMES[0], { schemaName: databaseName });
    const state = await inspectLegacyMigration(connection, LEGACY_MIGRATION_NAMES[0], {
      schemaName: databaseName
    });
    assert(state.estado === 'completa-no-registrada', 'No se detecto la estructura completa sin registro.');
    const adopted = await migrateLegacyMigration(connection, LEGACY_MIGRATION_NAMES[0], {
      schemaName: databaseName
    });
    assert(adopted.action === 'estructura-adoptada' && adopted.state.estado === 'post',
      'No se adopto la estructura completa preexistente.');
  } finally {
    await connection.end();
  }
}

async function testRegisteredIncomplete(server, databaseName) {
  const connection = await recreateDatabase(server, databaseName);
  try {
    await connection.query('INSERT INTO schema_migrations (nombre) VALUES (?)', [LEGACY_MIGRATION_NAMES[0]]);
    const state = await inspectLegacyMigration(connection, LEGACY_MIGRATION_NAMES[0], {
      schemaName: databaseName
    });
    assert(state.estado === 'inconsistente', 'Una migracion registrada e incompleta no fue bloqueada.');
  } finally {
    await connection.end();
  }
}

async function testWrongColumnType(server, databaseName) {
  const connection = await recreateDatabase(server, databaseName);
  try {
    await connection.query('ALTER TABLE producto ADD COLUMN idProveedor VARCHAR(20) NULL AFTER nombre');
    const state = await inspectLegacyMigration(connection, LEGACY_MIGRATION_NAMES[0], {
      schemaName: databaseName
    });
    assert(state.estado === 'inconsistente'
      && state.elementosIncompatibles.includes('columna:producto.idProveedor'),
    'No se detecto la columna historica con tipo incorrecto.');
  } finally {
    await connection.end();
  }
}

async function testMissingIndexAndForeignKey(server, databaseName) {
  const connection = await recreateDatabase(server, databaseName);
  try {
    await applyLegacyMigration(connection, LEGACY_MIGRATION_NAMES[0], { schemaName: databaseName });
    await connection.query('ALTER TABLE producto DROP FOREIGN KEY fk_producto_proveedor');
    await connection.query('ALTER TABLE producto DROP INDEX fk_producto_proveedor');
    const missingIndex = await inspectLegacyMigration(connection, LEGACY_MIGRATION_NAMES[0], {
      schemaName: databaseName
    });
    assert(missingIndex.elementosFaltantes.includes('indice:producto.fk_producto_proveedor'),
      'No se detecto el indice historico faltante.');
    await connection.query(
      `ALTER TABLE producto ADD CONSTRAINT fk_producto_proveedor
       FOREIGN KEY (idProveedor) REFERENCES proveedor(idProveedor)`
    );
    await connection.query('ALTER TABLE fiado DROP FOREIGN KEY fk_fiado_venta');
    const missingForeignKey = await inspectLegacyMigration(connection, LEGACY_MIGRATION_NAMES[0], {
      schemaName: databaseName
    });
    assert(missingForeignKey.elementosFaltantes.includes('fk:fiado.fk_fiado_venta'),
      'No se detecto la clave foranea historica faltante.');
  } finally {
    await connection.end();
  }
}

async function testHistoricalForeignKeysBySemantics(server, databaseName) {
  const connection = await recreateDatabase(server, databaseName);
  try {
    await applyLegacyMigration(connection, LEGACY_MIGRATION_NAMES[0], { schemaName: databaseName });
    const state = await inspectLegacyMigration(connection, LEGACY_MIGRATION_NAMES[0], {
      schemaName: databaseName
    });
    const productResolution = state.resolucionRequisitos.clavesForaneas[
      'producto.fk_producto_proveedor'
    ];
    const debtResolution = state.resolucionRequisitos.clavesForaneas['fiado.fk_fiado_venta'];
    assert(state.estructuraCompleta
      && productResolution.estado === 'historico-valido'
      && debtResolution.estado === 'historico-valido',
    'Las FK historicas simples validas no fueron reconocidas por su relacion real.');
  } finally {
    await connection.end();
  }
}

async function testEvolvedCompositeForeignKeys(server, databaseName) {
  const connection = await recreateDatabase(server, databaseName);
  try {
    await migrateLegacyMigration(connection, LEGACY_MIGRATION_NAMES[0], { schemaName: databaseName });
    await evolveLegacyRelationsToMultiTenant(connection);
    const state = await inspectLegacyMigration(connection, LEGACY_MIGRATION_NAMES[0], {
      schemaName: databaseName
    });
    const productResolution = state.resolucionRequisitos.clavesForaneas[
      'producto.fk_producto_proveedor'
    ];
    const debtResolution = state.resolucionRequisitos.clavesForaneas['fiado.fk_fiado_venta'];
    assert(state.estado === 'post' && state.estructuraCompleta,
      'La evolucion multitienda valida no conservo 001 en estado post.');
    assert(productResolution.estado === 'equivalente-evolucionado'
      && productResolution.constraintReal === 'fk_producto_tienda_proveedor',
    'La FK compuesta producto-proveedor no fue diagnosticada como equivalencia evolucionada.');
    assert(debtResolution.estado === 'equivalente-evolucionado'
      && debtResolution.constraintReal === 'fk_fiado_tienda_venta',
    'La FK compuesta fiado-venta no fue diagnosticada como equivalencia evolucionada.');
  } finally {
    await connection.end();
  }
}

async function testRegisteredEvolutionRequiresPhysicalStructure(server, databaseName) {
  const connection = await recreateDatabase(server, databaseName);
  try {
    await migrateLegacyMigration(connection, LEGACY_MIGRATION_NAMES[0], { schemaName: databaseName });
    await registerMigration(connection, '004_multitienda_base.sql');
    const state = await inspectLegacyMigration(connection, LEGACY_MIGRATION_NAMES[0], {
      schemaName: databaseName
    });
    assert(state.estado === 'inconsistente'
      && state.elementosFaltantes.includes('fk:producto.fk_producto_proveedor')
      && state.elementosFaltantes.includes('fk:fiado.fk_fiado_venta'),
    'El registro de 004 sin sus relaciones compuestas no fue bloqueado.');
  } finally {
    await connection.end();
  }
}

async function testCompatibleDecimalEvolution(server, databaseName) {
  const connection = await recreateDatabase(server, databaseName);
  try {
    await migrateLegacyMigration(connection, LEGACY_MIGRATION_NAMES[0], { schemaName: databaseName });
    await migrateLegacyMigration(connection, LEGACY_MIGRATION_NAMES[1], { schemaName: databaseName });
    await applyFinalCostPrecision(connection);
    await connection.query(
      'ALTER TABLE detalleVenta MODIFY COLUMN subtotalCosto DECIMAL(14,6) NOT NULL DEFAULT 0'
    );
    await connection.query(
      'ALTER TABLE detalleVenta MODIFY COLUMN ganancia DECIMAL(14,6) NOT NULL DEFAULT 0'
    );
    const state = await inspectLegacyMigration(connection, LEGACY_MIGRATION_NAMES[1], {
      schemaName: databaseName
    });
    for (const key of [
      'producto.ultimoPrecioCompra',
      'detalleVenta.costoUnitario',
      'detalleVenta.subtotalCosto',
      'detalleVenta.ganancia'
    ]) {
      assert(state.columnas[key] === true,
        `${key} no acepto una ampliacion DECIMAL que conserva rango y escala.`);
    }
    assert(state.estado === 'post' && state.elementosIncompatibles.length === 0,
      'La precision DECIMAL ampliada produjo un falso estado inconsistente.');
  } finally {
    await connection.end();
  }
}

async function testReducedDecimalIsIncompatible(server, databaseName) {
  const connection = await recreateDatabase(server, databaseName);
  try {
    await migrateLegacyMigration(connection, LEGACY_MIGRATION_NAMES[0], { schemaName: databaseName });
    await migrateLegacyMigration(connection, LEGACY_MIGRATION_NAMES[1], { schemaName: databaseName });
    await connection.query(
      'ALTER TABLE producto MODIFY COLUMN ultimoPrecioCompra DECIMAL(9,2) NOT NULL DEFAULT 0'
    );
    const state = await inspectLegacyMigration(connection, LEGACY_MIGRATION_NAMES[1], {
      schemaName: databaseName
    });
    assert(state.estado === 'inconsistente'
      && state.columnas['producto.ultimoPrecioCompra'] === false
      && state.elementosIncompatibles.includes('columna:producto.ultimoPrecioCompra'),
    'La reduccion de capacidad DECIMAL no fue rechazada.');
  } finally {
    await connection.end();
  }
}

function testCaseInsensitiveObjectKeys() {
  assert(normalizedObjectKey('DetalleVenta', 'CostoUnitario')
    === normalizedObjectKey('detalleventa', 'costounitario'),
  'La clave normalizada cambia segun la capitalizacion de tabla o columna.');
  assert(normalizedObjectKey('Producto', 'FK_Producto_Proveedor')
    === 'producto.fk_producto_proveedor',
  'La clave normalizada de indices y constraints no es estable.');
}

async function testPost013SemanticStateAndNoDowngrade(server, databaseName) {
  const connection = await recreateDatabase(server, databaseName);
  try {
    for (const name of LEGACY_MIGRATION_NAMES) {
      await migrateLegacyMigration(connection, name, { schemaName: databaseName });
    }
    await evolveLegacyRelationsToMultiTenant(connection);
    await applyFinalCostPrecision(connection);
    await registerModernMigrationNames(connection);

    const before = await connection.query(
      `SELECT COLUMN_TYPE columnType FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA=? AND LOWER(TABLE_NAME)='producto'
         AND LOWER(COLUMN_NAME)='ultimopreciocompra'`,
      [databaseName]
    );
    const migrations = await inspectAllLegacyMigrations(connection, { schemaName: databaseName });
    assert(migrations.every((migration) => migration.estado === 'post'
      && migration.estructuraCompleta && migration.datosValidos),
    'La base evolucionada hasta post-013 no fue reconocida semanticamente.');
    const migration003 = migrations.find((migration) => migration.nombre === LEGACY_MIGRATION_NAMES[2]);
    assert(migration003.dependenciasBloqueantes.length === 0,
      '003 heredo un falso bloqueo de una dependencia satisfecha por evolucion posterior.');

    for (const name of LEGACY_MIGRATION_NAMES) {
      const result = await migrateLegacyMigration(connection, name, { schemaName: databaseName });
      assert(result.action === 'ya-registrada', `${name} intento reparar una estructura moderna valida.`);
    }
    const after = await connection.query(
      `SELECT COLUMN_TYPE columnType FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA=? AND LOWER(TABLE_NAME)='producto'
         AND LOWER(COLUMN_NAME)='ultimopreciocompra'`,
      [databaseName]
    );
    assert(before[0][0].columnType === after[0][0].columnType
      && after[0][0].columnType.toLowerCase() === 'decimal(14,6)',
    'El adaptador degrado la precision de una columna moderna.');
  } finally {
    await connection.end();
  }
}

async function testDuplicatesBeforeConstraint(server, databaseName) {
  const connection = await recreateDatabase(server, databaseName, {
    providerWithoutPrimaryKey: true,
    skipSampleData: true
  });
  try {
    await connection.query("INSERT INTO proveedor (idProveedor,nombre) VALUES (1,'A'),(1,'B')");
    await connection.query(
      `INSERT INTO producto (nombre,unidadMedida,precioVenta,stock,stockMinimo)
       VALUES ('P','unidad',1,1,1)`
    );
    await connection.query('ALTER TABLE producto ADD COLUMN idProveedor INT NULL AFTER nombre');
    const state = await inspectLegacyMigration(connection, LEGACY_MIGRATION_NAMES[0], {
      schemaName: databaseName
    });
    assert(state.datosInvalidos.proveedoresDuplicados === 1
      && state.estado === 'parcial-bloqueante',
    'No se detectaron duplicados que impiden la FK.');
  } finally {
    await connection.end();
  }
}

async function testNullBeforeNotNull(server, databaseName) {
  const connection = await recreateDatabase(server, databaseName, {
    nullableStock: true,
    skipSampleData: true
  });
  try {
    await connection.query(
      `INSERT INTO producto (nombre,unidadMedida,precioVenta,stock,stockMinimo)
       VALUES ('P','unidad',1,NULL,1)`
    );
    const state = await inspectLegacyMigration(connection, LEGACY_MIGRATION_NAMES[0], {
      schemaName: databaseName
    });
    assert(state.datosInvalidos.productosStockNulo === 1
      && ['parcial-bloqueante', 'inconsistente'].includes(state.estado),
    'No se detecto NULL antes de convertir stock a NOT NULL.');
  } finally {
    await connection.end();
  }
}

async function testBrokenReference(server, databaseName) {
  const connection = await recreateDatabase(server, databaseName);
  try {
    await connection.query('ALTER TABLE producto ADD COLUMN idProveedor INT NULL AFTER nombre');
    await connection.query('UPDATE producto SET idProveedor=999999 WHERE idProducto=1');
    const state = await inspectLegacyMigration(connection, LEGACY_MIGRATION_NAMES[0], {
      schemaName: databaseName
    });
    assert(state.referenciasRotas.proveedoresInexistentes === 1
      && state.estado === 'parcial-bloqueante',
    'No se detecto la referencia invalida antes de crear la FK.');
  } finally {
    await connection.end();
  }
}

function testLegacySqlIsAdapted() {
  const migratorPath = path.join(__dirname, 'migrate-db.js');
  const source = fs.readFileSync(migratorPath, 'utf8');
  const adapterPosition = source.indexOf('if (isLegacyMigration(file))');
  const rawSqlPosition = source.indexOf('const statements = readSqlStatements');
  assert(adapterPosition >= 0 && rawSqlPosition > adapterPosition,
    'El migrador no deriva 001-003 al adaptador antes de cargar SQL bruto.');
  for (const name of LEGACY_MIGRATION_NAMES.slice(0, 2)) {
    const sql = fs.readFileSync(path.join(__dirname, '..', 'database', 'migrations', name), 'utf8');
    assert(/^USE\s+tienda_abarrotes\s*;/im.test(sql),
      `${name} ya no conserva el identificador historico que el adaptador debe aislar.`);
  }
}

function testInitialSchemaContainsFinalLegacyStructure() {
  const schema = fs.readFileSync(
    path.join(__dirname, '..', 'database', 'tienda_abarrotes.sql'),
    'utf8'
  );
  const requiredFragments = [
    'idProveedor INT NULL',
    "categoria VARCHAR(50) NOT NULL DEFAULT 'otros'",
    'stockUnidadesTotal INT NOT NULL DEFAULT 0',
    'cantidadEquivalenteUnidades INT NOT NULL DEFAULT 0',
    'activo TINYINT(1) NOT NULL DEFAULT 1',
    'CONSTRAINT fk_producto_proveedor',
    'CONSTRAINT fk_fiado_venta'
  ];
  for (const fragment of requiredFragments) {
    assert(schema.includes(fragment), `El esquema inicial no contiene: ${fragment}.`);
  }
}

async function testDatabaseIsolation(server, firstDatabase, secondDatabase) {
  const first = await recreateDatabase(server, firstDatabase);
  const second = await recreateDatabase(server, secondDatabase);
  try {
    await migrateLegacyMigration(first, LEGACY_MIGRATION_NAMES[0], { schemaName: firstDatabase });
    const untouched = await inspectLegacyMigration(second, LEGACY_MIGRATION_NAMES[0], {
      schemaName: secondDatabase
    });
    assert(untouched.estado === 'pre', 'La migracion altero una base temporal distinta a la configurada.');
  } finally {
    await first.end();
    await second.end();
  }
}

async function main() {
  const configuredDatabase = String(process.env.DB_NAME || '').trim().toLocaleLowerCase('en-US');
  assert(!configuredDatabase.startsWith(TEMP_PREFIX),
    'DB_NAME debe apuntar a la base habitual; la prueba crea su propia base temporal aislada.');
  const server = await createServerConnection();
  const primary = temporaryDatabaseName();
  const secondary = temporaryDatabaseName();
  const created = [primary, secondary];
  try {
    console.log('Probando instalacion limpia e idempotencia historica...');
    await testCleanInstallation(server, primary);
    for (const migrationName of LEGACY_MIGRATION_NAMES) {
      console.log(`Probando interrupciones recuperables de ${migrationName}...`);
      await testInterruptedSteps(server, primary, migrationName);
    }
    await testCompleteWithoutRegistration(server, primary);
    await testRegisteredIncomplete(server, primary);
    await testWrongColumnType(server, primary);
    await testMissingIndexAndForeignKey(server, primary);
    await testHistoricalForeignKeysBySemantics(server, primary);
    await testEvolvedCompositeForeignKeys(server, primary);
    await testRegisteredEvolutionRequiresPhysicalStructure(server, primary);
    await testCompatibleDecimalEvolution(server, primary);
    await testReducedDecimalIsIncompatible(server, primary);
    testCaseInsensitiveObjectKeys();
    await testPost013SemanticStateAndNoDowngrade(server, primary);
    await testDuplicatesBeforeConstraint(server, primary);
    await testNullBeforeNotNull(server, primary);
    await testBrokenReference(server, primary);
    testLegacySqlIsAdapted();
    testInitialSchemaContainsFinalLegacyStructure();
    await testDatabaseIsolation(server, primary, secondary);
    console.log('Prueba de migraciones historicas completada correctamente.');
  } finally {
    let cleanupError = null;
    for (const databaseName of created) {
      try {
        await dropTemporaryDatabase(server, databaseName);
      } catch (error) {
        cleanupError ||= error;
      }
    }
    for (const databaseName of created) {
      try {
        const [[row]] = await server.query(
          `SELECT COUNT(*) total FROM information_schema.SCHEMATA
           WHERE SCHEMA_NAME=?`,
          [databaseName]
        );
        if (Number(row.total) !== 0) {
          cleanupError ||= new Error(`No se limpio la base temporal ${databaseName}.`);
        }
      } catch (error) {
        cleanupError ||= error;
      }
    }
    await server.end();
    if (cleanupError) throw cleanupError;
  }
}

main().catch((error) => {
  console.error('Fallo test:legacy-migrations.');
  console.error(error.message);
  process.exit(1);
});

module.exports = { assertTemporaryDatabase };
