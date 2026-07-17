const fs = require('fs');
const path = require('path');
const { logDatabaseTarget } = require('../config/env');
const { createConnection, hasColumns, hasColumnTypes, hasForeignKey, readSqlStatements } = require('./db-utils');

const migrationRequirements = {
  '001_mejoras_tienda.sql': {
    columns: {
      producto: ['idProveedor', 'categoria', 'unidadesPorPaquete'],
      venta: ['tipo'],
      fiado: ['idVenta']
    },
    columnTypes: { producto: { stock: 'int', stockMinimo: 'int' } },
    foreignKeys: [
      ['producto', 'idProveedor', 'proveedor', 'idProveedor'],
      ['fiado', 'idVenta', 'venta', 'idVenta']
    ]
  },
  '002_mejoras_stock_reportes.sql': {
    columns: {
      producto: ['paquetesPorCaja', 'stockUnidadesTotal', 'ultimoPrecioCompra', 'permiteVentaPorPaquete', 'permiteVentaPorUnidad'],
      detalleVenta: ['costoUnitario', 'subtotalCosto', 'ganancia', 'presentacionVenta', 'cantidadEquivalenteUnidades'],
      detalleCompra: ['presentacionCompra', 'cantidadEquivalenteUnidades']
    }
  },
  '003_borrado_logico.sql': {
    columns: {
      cliente: ['activo', 'eliminadoEn'],
      fiado: ['activo', 'eliminadoEn']
    }
  }
};

async function requirementsSatisfied(connection, file) {
  const requirements = migrationRequirements[file];
  if (!requirements) return false;
  for (const [table, columns] of Object.entries(requirements.columns || {})) {
    if (!await hasColumns(connection, table, columns)) return false;
  }
  for (const [table, types] of Object.entries(requirements.columnTypes || {})) {
    if (!await hasColumnTypes(connection, table, types)) return false;
  }
  for (const relation of requirements.foreignKeys || []) {
    if (!await hasForeignKey(connection, ...relation)) return false;
  }
  return true;
}

async function main() {
  logDatabaseTarget('Aplicacion de migraciones');
  const connection = await createConnection();
  try {
    await connection.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        nombre VARCHAR(255) PRIMARY KEY,
        aplicadaEn DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    const migrationsDir = path.join(__dirname, '..', 'database', 'migrations');
    const files = fs.readdirSync(migrationsDir).filter((file) => file.endsWith('.sql')).sort();

    for (const file of files) {
      const [recorded] = await connection.query('SELECT nombre FROM schema_migrations WHERE nombre=?', [file]);
      if (recorded.length) {
        console.log(`Migracion ya registrada: ${file}`);
        continue;
      }

      if (await requirementsSatisfied(connection, file)) {
        await connection.query('INSERT INTO schema_migrations (nombre) VALUES (?)', [file]);
        console.log(`Migracion existente registrada sin repetir cambios: ${file}`);
        continue;
      }

      const statements = readSqlStatements(path.join(migrationsDir, file));
      for (const statement of statements) await connection.query(statement);

      if (!await requirementsSatisfied(connection, file)) {
        throw new Error(`La migracion ${file} termino sin completar la estructura esperada.`);
      }
      await connection.query('INSERT INTO schema_migrations (nombre) VALUES (?)', [file]);
      console.log(`Migracion aplicada: ${file}`);
    }

    console.log('Migraciones completadas. No se cargaron datos de demostracion.');
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error('No se pudieron aplicar las migraciones.');
  console.error(error.message);
  process.exit(1);
});
