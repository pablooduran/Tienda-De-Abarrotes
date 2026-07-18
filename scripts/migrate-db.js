const fs = require('fs');
const path = require('path');
const { logDatabaseTarget } = require('../config/env');
const {
  createConnection,
  hasTable,
  hasColumns,
  hasColumnTypes,
  hasForeignKey,
  hasForeignKeyConstraint,
  hasIndex,
  hasIndexNamed,
  hasConstraint,
  hasCheckConstraint,
  readSqlStatements
} = require('./db-utils');

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
  },
  '004_multitienda_base.sql': {
    columns: {
      tienda: ['idTienda', 'nombre', 'slug', 'activo', 'estado', 'creadoEn', 'actualizadoEn'],
      administrador: ['idTienda', 'rol', 'activo'],
      cliente: ['idTienda'],
      proveedor: ['idTienda'],
      producto: ['idTienda'],
      venta: ['idTienda'],
      compra: ['idTienda'],
      fiado: ['idTienda'],
      detalleVenta: ['idTienda'],
      detalleCompra: ['idTienda'],
      detalleFiado: ['idTienda'],
      pagoFiado: ['idTienda']
    },
    indexes: [
      ['tienda', 'uq_tienda_slug', ['slug'], true],
      ['administrador', 'idx_administrador_tienda_activo', ['idTienda', 'activo'], false],
      ['cliente', 'uq_cliente_tienda_id', ['idTienda', 'idCliente'], true],
      ['cliente', 'idx_cliente_tienda_activo_nombre', ['idTienda', 'activo', 'nombre'], false],
      ['proveedor', 'uq_proveedor_tienda_id', ['idTienda', 'idProveedor'], true],
      ['proveedor', 'idx_proveedor_tienda_nombre', ['idTienda', 'nombre'], false],
      ['producto', 'uq_producto_tienda_id', ['idTienda', 'idProducto'], true],
      ['producto', 'idx_producto_tienda_proveedor', ['idTienda', 'idProveedor'], false],
      ['producto', 'idx_producto_tienda_categoria_nombre', ['idTienda', 'categoria', 'nombre'], false],
      ['venta', 'uq_venta_tienda_id', ['idTienda', 'idVenta'], true],
      ['venta', 'idx_venta_tienda_fecha', ['idTienda', 'fecha'], false],
      ['venta', 'idx_venta_tienda_cliente', ['idTienda', 'idCliente'], false],
      ['compra', 'uq_compra_tienda_id', ['idTienda', 'idCompra'], true],
      ['compra', 'idx_compra_tienda_fecha', ['idTienda', 'fecha'], false],
      ['compra', 'idx_compra_tienda_proveedor', ['idTienda', 'idProveedor'], false],
      ['fiado', 'uq_fiado_tienda_id', ['idTienda', 'idFiado'], true],
      ['fiado', 'idx_fiado_tienda_estado_fecha', ['idTienda', 'activo', 'estado', 'fechaInicio'], false],
      ['fiado', 'idx_fiado_tienda_cliente', ['idTienda', 'idCliente'], false],
      ['fiado', 'idx_fiado_tienda_venta', ['idTienda', 'idVenta'], false],
      ['detalleVenta', 'idx_detalleVenta_tienda_venta', ['idTienda', 'idVenta'], false],
      ['detalleVenta', 'idx_detalleVenta_tienda_producto', ['idTienda', 'idProducto'], false],
      ['detalleCompra', 'idx_detalleCompra_tienda_compra', ['idTienda', 'idCompra'], false],
      ['detalleCompra', 'idx_detalleCompra_tienda_producto', ['idTienda', 'idProducto'], false],
      ['detalleFiado', 'idx_detalleFiado_tienda_fiado', ['idTienda', 'idFiado'], false],
      ['detalleFiado', 'idx_detalleFiado_tienda_producto', ['idTienda', 'idProducto'], false],
      ['pagoFiado', 'idx_pagoFiado_tienda_fiado', ['idTienda', 'idFiado'], false]
    ],
    checks: [
      ['administrador', 'chk_administrador_rol_tienda']
    ],
    foreignKeyConstraints: [
      ['administrador', 'fk_administrador_tienda', ['idTienda'], 'tienda', ['idTienda']],
      ['cliente', 'fk_cliente_tienda', ['idTienda'], 'tienda', ['idTienda']],
      ['proveedor', 'fk_proveedor_tienda', ['idTienda'], 'tienda', ['idTienda']],
      ['producto', 'fk_producto_tienda', ['idTienda'], 'tienda', ['idTienda']],
      ['venta', 'fk_venta_tienda', ['idTienda'], 'tienda', ['idTienda']],
      ['compra', 'fk_compra_tienda', ['idTienda'], 'tienda', ['idTienda']],
      ['fiado', 'fk_fiado_tienda', ['idTienda'], 'tienda', ['idTienda']],
      ['detalleVenta', 'fk_detalleVenta_tienda', ['idTienda'], 'tienda', ['idTienda']],
      ['detalleCompra', 'fk_detalleCompra_tienda', ['idTienda'], 'tienda', ['idTienda']],
      ['detalleFiado', 'fk_detalleFiado_tienda', ['idTienda'], 'tienda', ['idTienda']],
      ['pagoFiado', 'fk_pagoFiado_tienda', ['idTienda'], 'tienda', ['idTienda']],
      ['producto', 'fk_producto_tienda_proveedor', ['idTienda', 'idProveedor'], 'proveedor', ['idTienda', 'idProveedor']],
      ['venta', 'fk_venta_tienda_cliente', ['idTienda', 'idCliente'], 'cliente', ['idTienda', 'idCliente']],
      ['compra', 'fk_compra_tienda_proveedor', ['idTienda', 'idProveedor'], 'proveedor', ['idTienda', 'idProveedor']],
      ['fiado', 'fk_fiado_tienda_cliente', ['idTienda', 'idCliente'], 'cliente', ['idTienda', 'idCliente']],
      ['fiado', 'fk_fiado_tienda_venta', ['idTienda', 'idVenta'], 'venta', ['idTienda', 'idVenta']],
      ['detalleVenta', 'fk_detalleVenta_tienda_venta', ['idTienda', 'idVenta'], 'venta', ['idTienda', 'idVenta']],
      ['detalleVenta', 'fk_detalleVenta_tienda_producto', ['idTienda', 'idProducto'], 'producto', ['idTienda', 'idProducto']],
      ['detalleCompra', 'fk_detalleCompra_tienda_compra', ['idTienda', 'idCompra'], 'compra', ['idTienda', 'idCompra']],
      ['detalleCompra', 'fk_detalleCompra_tienda_producto', ['idTienda', 'idProducto'], 'producto', ['idTienda', 'idProducto']],
      ['detalleFiado', 'fk_detalleFiado_tienda_fiado', ['idTienda', 'idFiado'], 'fiado', ['idTienda', 'idFiado']],
      ['detalleFiado', 'fk_detalleFiado_tienda_producto', ['idTienda', 'idProducto'], 'producto', ['idTienda', 'idProducto']],
      ['pagoFiado', 'fk_pagoFiado_tienda_fiado', ['idTienda', 'idFiado'], 'fiado', ['idTienda', 'idFiado']]
    ]
  },
  '005_planes_suscripciones.sql': {
    columns: {
      plan: ['idPlan', 'codigo', 'nombre', 'activo', 'precioMensual', 'duracionDias', 'limitePropietarios', 'limiteProductos', 'limiteClientes', 'limiteProveedores', 'creadoEn', 'actualizadoEn'],
      funcionalidad: ['idFuncionalidad', 'codigo', 'nombre', 'activo', 'creadoEn', 'actualizadoEn'],
      planFuncionalidad: ['idPlan', 'idFuncionalidad', 'habilitada', 'creadoEn'],
      suscripcionTienda: ['idSuscripcion', 'idTienda', 'idPlan', 'tipo', 'estado', 'fechaInicio', 'fechaFin', 'renovacionAutomatica', 'observacion', 'creadoPor', 'creadoEn', 'actualizadoEn']
    },
    indexes: [
      ['plan', 'uq_plan_codigo', ['codigo'], true],
      ['funcionalidad', 'uq_funcionalidad_codigo', ['codigo'], true],
      ['planFuncionalidad', 'idx_planFuncionalidad_funcionalidad', ['idFuncionalidad'], false],
      ['suscripcionTienda', 'idx_suscripcion_tienda_estado_fechas', ['idTienda', 'estado', 'fechaInicio', 'fechaFin'], false],
      ['suscripcionTienda', 'idx_suscripcion_plan', ['idPlan'], false],
      ['suscripcionTienda', 'idx_suscripcion_creadoPor', ['creadoPor'], false]
    ],
    foreignKeyConstraints: [
      ['planFuncionalidad', 'fk_planFuncionalidad_plan', ['idPlan'], 'plan', ['idPlan']],
      ['planFuncionalidad', 'fk_planFuncionalidad_funcionalidad', ['idFuncionalidad'], 'funcionalidad', ['idFuncionalidad']],
      ['suscripcionTienda', 'fk_suscripcion_tienda', ['idTienda'], 'tienda', ['idTienda']],
      ['suscripcionTienda', 'fk_suscripcion_plan', ['idPlan'], 'plan', ['idPlan']],
      ['suscripcionTienda', 'fk_suscripcion_creadoPor', ['creadoPor'], 'administrador', ['idAdministrador']]
    ]
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
  for (const index of requirements.indexes || []) {
    if (!await hasIndex(connection, ...index)) return false;
  }
  for (const check of requirements.checks || []) {
    if (!await hasCheckConstraint(connection, ...check)) return false;
  }
  for (const relation of requirements.foreignKeyConstraints || []) {
    if (!await hasForeignKeyConstraint(connection, ...relation)) return false;
  }
  if (file === '004_multitienda_base.sql') {
    const [[shop]] = await connection.query("SELECT COUNT(*) total FROM tienda WHERE slug='tienda-deisy'");
    if (Number(shop.total) !== 1) return false;
    const tenantTables = ['cliente', 'proveedor', 'producto', 'venta', 'compra', 'fiado', 'detalleVenta', 'detalleCompra', 'detalleFiado', 'pagoFiado'];
    for (const table of tenantTables) {
      const [[missing]] = await connection.query(`SELECT COUNT(*) total FROM ${table} WHERE idTienda IS NULL`);
      if (Number(missing.total) > 0) return false;
    }
    const [[ownersWithoutShop]] = await connection.query(
      "SELECT COUNT(*) total FROM administrador WHERE rol='dueno_tienda' AND idTienda IS NULL"
    );
    if (Number(ownersWithoutShop.total) > 0) return false;
  }
  if (file === '005_planes_suscripciones.sql') {
    const [[plans]] = await connection.query(
      "SELECT COUNT(DISTINCT codigo) total FROM plan WHERE codigo IN ('basico','avanzado')"
    );
    if (Number(plans.total) !== 2) return false;
    const [[features]] = await connection.query(
      `SELECT COUNT(DISTINCT codigo) total FROM funcionalidad
       WHERE codigo IN ('reportes_avanzados','compras_sugeridas','historial_stock','recibos_whatsapp','recordatorios_fiado','gastos','cierre_caja','vencimientos_lote','portal_clientes')`
    );
    if (Number(features.total) !== 9) return false;
    const [[advancedFeatures]] = await connection.query(
      `SELECT COUNT(*) total
       FROM planFuncionalidad pf
       JOIN plan p ON p.idPlan=pf.idPlan
       JOIN funcionalidad f ON f.idFuncionalidad=pf.idFuncionalidad
       WHERE p.codigo='avanzado' AND pf.habilitada=1 AND f.activo=1`
    );
    if (Number(advancedFeatures.total) < 9) return false;
    const [[storesWithoutSubscription]] = await connection.query(
      `SELECT COUNT(*) total FROM tienda t
       WHERE NOT EXISTS (SELECT 1 FROM suscripcionTienda s WHERE s.idTienda=t.idTienda)`
    );
    if (Number(storesWithoutSubscription.total) > 0) return false;
    const [[invalidDates]] = await connection.query(
      'SELECT COUNT(*) total FROM suscripcionTienda WHERE fechaFin <= fechaInicio'
    );
    if (Number(invalidDates.total) > 0) return false;
    const [[overlaps]] = await connection.query(
      `SELECT COUNT(*) total
       FROM suscripcionTienda a
       JOIN suscripcionTienda b ON b.idTienda=a.idTienda AND b.idSuscripcion>a.idSuscripcion
       WHERE a.estado IN ('pendiente','activa')
         AND b.estado IN ('pendiente','activa')
         AND a.fechaInicio < b.fechaFin AND b.fechaInicio < a.fechaFin`
    );
    if (Number(overlaps.total) > 0) return false;
  }
  return true;
}

const multitenantTables = [
  'cliente',
  'proveedor',
  'producto',
  'venta',
  'compra',
  'fiado',
  'detalleVenta',
  'detalleCompra',
  'detalleFiado',
  'pagoFiado'
];

const multitenantRelations = [
  ['producto', 'idProveedor', 'proveedor', 'idProveedor'],
  ['venta', 'idCliente', 'cliente', 'idCliente'],
  ['compra', 'idProveedor', 'proveedor', 'idProveedor'],
  ['fiado', 'idCliente', 'cliente', 'idCliente'],
  ['fiado', 'idVenta', 'venta', 'idVenta'],
  ['detalleVenta', 'idVenta', 'venta', 'idVenta'],
  ['detalleVenta', 'idProducto', 'producto', 'idProducto'],
  ['detalleCompra', 'idCompra', 'compra', 'idCompra'],
  ['detalleCompra', 'idProducto', 'producto', 'idProducto'],
  ['detalleFiado', 'idFiado', 'fiado', 'idFiado'],
  ['detalleFiado', 'idProducto', 'producto', 'idProducto'],
  ['pagoFiado', 'idFiado', 'fiado', 'idFiado']
];

async function validateMultitenantData(connection) {
  const problems = [];
  const [[shop]] = await connection.query("SELECT COUNT(*) total FROM tienda WHERE slug='tienda-deisy'");
  if (Number(shop.total) !== 1) problems.push(`slug tienda-deisy: ${shop.total} registros`);

  const [[invalidAdmins]] = await connection.query(
    `SELECT COUNT(*) total
     FROM administrador a
     LEFT JOIN tienda t ON t.idTienda=a.idTienda
     WHERE (a.rol='superadmin' AND a.idTienda IS NOT NULL)
        OR (a.rol='dueno_tienda' AND (a.idTienda IS NULL OR t.idTienda IS NULL))`
  );
  if (Number(invalidAdmins.total) > 0) {
    problems.push(`administrador: ${invalidAdmins.total} roles sin una tienda valida`);
  }

  for (const table of multitenantTables) {
    const [[invalidTenant]] = await connection.query(
      `SELECT COUNT(*) total
       FROM \`${table}\` r
       LEFT JOIN tienda t ON t.idTienda=r.idTienda
       WHERE r.idTienda IS NULL OR t.idTienda IS NULL`
    );
    if (Number(invalidTenant.total) > 0) {
      problems.push(`${table}: ${invalidTenant.total} registros sin tienda valida`);
    }
  }

  for (const [child, childColumn, parent, parentColumn] of multitenantRelations) {
    const [[mismatch]] = await connection.query(
      `SELECT COUNT(*) total
       FROM \`${child}\` c
       LEFT JOIN \`${parent}\` p ON p.\`${parentColumn}\`=c.\`${childColumn}\`
       WHERE c.\`${childColumn}\` IS NOT NULL
         AND (p.\`${parentColumn}\` IS NULL OR NOT (c.idTienda <=> p.idTienda))`
    );
    if (Number(mismatch.total) > 0) {
      problems.push(`${child}.${childColumn} -> ${parent}.${parentColumn}: ${mismatch.total} relaciones huerfanas o cruzadas`);
    }
  }

  if (problems.length) {
    throw new Error(`Validacion previa de 004 rechazada. No se crearon indices ni restricciones multi-tienda: ${problems.join('; ')}.`);
  }
}

function beginsMultitenantConstraintPhase(statement) {
  const normalized = statement.replace(/\s+/g, ' ').trim();
  return /^ALTER TABLE .+ ADD (?:(?:UNIQUE )?INDEX|CONSTRAINT)\b/i.test(normalized);
}

function structureElementFromStatement(statement) {
  const normalized = statement.replace(/\s+/g, ' ').trim();
  const column = normalized.match(/^ALTER TABLE\s+`?([A-Za-z0-9_]+)`?\s+ADD COLUMN\s+`?([A-Za-z0-9_]+)`?/i);
  if (column) return { type: 'columna', table: column[1], name: column[2] };

  const index = normalized.match(/^ALTER TABLE\s+`?([A-Za-z0-9_]+)`?\s+ADD\s+(?:UNIQUE\s+)?INDEX\s+`?([A-Za-z0-9_]+)`?/i);
  if (index) return { type: 'indice', table: index[1], name: index[2] };

  const constraint = normalized.match(/^ALTER TABLE\s+`?([A-Za-z0-9_]+)`?\s+ADD CONSTRAINT\s+`?([A-Za-z0-9_]+)`?/i);
  if (constraint) return { type: 'restriccion', table: constraint[1], name: constraint[2] };

  return null;
}

async function structureElementExists(connection, element) {
  if (!element) return false;
  if (element.type === 'columna') return hasColumns(connection, element.table, [element.name]);
  if (element.type === 'indice') return hasIndexNamed(connection, element.table, element.name);
  return hasConstraint(connection, element.table, element.name);
}

function presenceSummary(items) {
  return {
    presentes: items.filter((item) => item.exists).length,
    esperados: items.length,
    faltantes: items.filter((item) => !item.exists).map((item) => item.name)
  };
}

async function inspect004State(connection, recorded) {
  const storeTableExists = await hasTable(connection, 'tienda');
  let deisyStores = 0;
  if (storeTableExists) {
    const [[row]] = await connection.query("SELECT COUNT(*) total FROM tienda WHERE slug='tienda-deisy'");
    deisyStores = Number(row.total);
  }

  const idTiendaTables = ['administrador', ...multitenantTables];
  const columns = [];
  for (const table of idTiendaTables) {
    columns.push({
      name: `${table}.idTienda`,
      exists: await hasColumns(connection, table, ['idTienda'])
    });
  }

  const requirements = migrationRequirements['004_multitienda_base.sql'];
  const indexes = [];
  for (const [table, name] of requirements.indexes) {
    indexes.push({ name: `${table}.${name}`, exists: await hasIndexNamed(connection, table, name) });
  }

  const constraints = [];
  for (const [table, name] of [...requirements.checks, ...requirements.foreignKeyConstraints]) {
    constraints.push({ name: `${table}.${name}`, exists: await hasConstraint(connection, table, name) });
  }

  console.log('Estado previo detectado para 004_multitienda_base.sql:');
  console.log(JSON.stringify({
    registradaEnSchemaMigrations: recorded,
    tablaTienda: storeTableExists,
    tiendasConSlugDeisy: deisyStores,
    columnasIdTienda: presenceSummary(columns),
    indices004: presenceSummary(indexes),
    restricciones004: presenceSummary(constraints)
  }, null, 2));
}

function isExistingStructureError(error) {
  return [
    'ER_DUP_FIELDNAME',
    'ER_DUP_KEYNAME',
    'ER_FK_DUP_NAME',
    'ER_DUP_CONSTRAINT_NAME',
    'ER_CHECK_CONSTRAINT_DUP_NAME'
  ].includes(error.code);
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
      if (file === '004_multitienda_base.sql') {
        await inspect004State(connection, recorded.length > 0);
      }
      if (recorded.length) {
        if (['004_multitienda_base.sql', '005_planes_suscripciones.sql'].includes(file)
          && !await requirementsSatisfied(connection, file)) {
          throw new Error(`La migracion ${file} figura en schema_migrations, pero su estructura o sus datos estan incompletos. No se aplicaron cambios adicionales.`);
        }
        console.log(`Migracion ya registrada: ${file}`);
        continue;
      }

      if (await requirementsSatisfied(connection, file)) {
        await connection.query('INSERT INTO schema_migrations (nombre) VALUES (?)', [file]);
        console.log(`Migracion existente registrada sin repetir cambios: ${file}`);
        continue;
      }

      const statements = readSqlStatements(path.join(migrationsDir, file));
      let multitenantDataValidated = false;
      for (let index = 0; index < statements.length; index += 1) {
        const statement = statements[index];
        if (file === '004_multitienda_base.sql'
          && !multitenantDataValidated
          && beginsMultitenantConstraintPhase(statement)) {
          await validateMultitenantData(connection);
          multitenantDataValidated = true;
          console.log('Datos multi-tienda validados antes de crear indices y restricciones.');
        }

        const element = file === '004_multitienda_base.sql'
          ? structureElementFromStatement(statement)
          : null;
        if (element && await structureElementExists(connection, element)) {
          console.log(`Paso ${index + 1}/${statements.length} omitido; ${element.type} existente: ${element.table}.${element.name}.`);
          continue;
        }

        try {
          await connection.query(statement);
        } catch (error) {
          if (isExistingStructureError(error)) {
            console.log(`Paso ${index + 1}/${statements.length}: elemento existente; se verificara al finalizar.`);
            continue;
          }
          const description = element
            ? `${element.type} ${element.table}.${element.name}`
            : statement.replace(/\s+/g, ' ').trim().slice(0, 100);
          throw new Error(`Fallo ${file} en el paso ${index + 1}/${statements.length} (${description}): ${error.message}`);
        }
      }

      if (file === '004_multitienda_base.sql' && !multitenantDataValidated) {
        await validateMultitenantData(connection);
      }

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
