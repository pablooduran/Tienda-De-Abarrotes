const { logDatabaseTarget } = require('../config/env');
const {
  createConnection,
  hasCheckConstraint,
  hasColumns,
  hasForeignKeyConstraint,
  hasIndex,
  hasTable
} = require('./db-utils');

const MIGRATION = '009_finanzas_reportes_caja.sql';
const REQUIRED_COLUMNS = Object.freeze({
  detalleVenta: ['origenCosto'],
  categoriaGasto: ['idCategoriaGasto', 'idTienda', 'nombre', 'nombreNormalizado', 'descripcion', 'activo', 'creadoEn', 'actualizadoEn'],
  gasto: ['idGasto', 'idTienda', 'idCategoriaGasto', 'idAdministrador', 'idAdministradorModifica', 'idAdministradorAnula', 'fechaGasto', 'concepto', 'monto', 'metodoPago', 'referencia', 'observacion', 'recurrente', 'estado', 'motivoAnulacion', 'creadoEn', 'actualizadoEn', 'anuladoEn'],
  cierreCaja: ['idCierreCaja', 'idTienda', 'idAdministrador', 'idAdministradorAnula', 'fechaInicio', 'fechaFin', 'efectivoInicial', 'efectivoVentasEsperado', 'efectivoFiadosCobrado', 'gastosEfectivo', 'efectivoEsperado', 'efectivoContado', 'diferencia', 'totalQR', 'totalNoEspecificado', 'totalCobrado', 'totalVentas', 'totalFiadoGenerado', 'totalGastos', 'totalCompras', 'observacion', 'estado', 'motivoAnulacion', 'claveOperacion', 'creadoEn', 'anuladoEn']
});

const INDEXES = Object.freeze([
  ['categoriaGasto', 'uq_categoriaGasto_tienda_id', ['idTienda', 'idCategoriaGasto'], true],
  ['categoriaGasto', 'uq_categoriaGasto_tienda_normalizada', ['idTienda', 'nombreNormalizado'], true],
  ['categoriaGasto', 'idx_categoriaGasto_tienda_activo_nombre', ['idTienda', 'activo', 'nombre'], false],
  ['gasto', 'uq_gasto_tienda_id', ['idTienda', 'idGasto'], true],
  ['gasto', 'idx_gasto_tienda_fecha_estado', ['idTienda', 'fechaGasto', 'estado'], false],
  ['gasto', 'idx_gasto_tienda_categoria_fecha', ['idTienda', 'idCategoriaGasto', 'fechaGasto'], false],
  ['gasto', 'idx_gasto_tienda_metodo_fecha', ['idTienda', 'metodoPago', 'fechaGasto'], false],
  ['cierreCaja', 'uq_cierreCaja_tienda_id', ['idTienda', 'idCierreCaja'], true],
  ['cierreCaja', 'uq_cierreCaja_tienda_clave', ['idTienda', 'claveOperacion'], true],
  ['cierreCaja', 'idx_cierreCaja_tienda_estado_periodo', ['idTienda', 'estado', 'fechaInicio', 'fechaFin'], false],
  ['cierreCaja', 'idx_cierreCaja_tienda_admin_fecha', ['idTienda', 'idAdministrador', 'creadoEn'], false]
]);

const CHECKS = Object.freeze([
  ['gasto', 'chk_gasto_monto'], ['gasto', 'chk_gasto_estado'],
  ['cierreCaja', 'chk_cierreCaja_periodo'], ['cierreCaja', 'chk_cierreCaja_montos'],
  ['cierreCaja', 'chk_cierreCaja_balance'], ['cierreCaja', 'chk_cierreCaja_estado']
]);

const FOREIGN_KEYS = Object.freeze([
  ['categoriaGasto', 'fk_categoriaGasto_tienda', ['idTienda'], 'tienda', ['idTienda'], 'RESTRICT', 'RESTRICT'],
  ['gasto', 'fk_gasto_tienda', ['idTienda'], 'tienda', ['idTienda'], 'RESTRICT', 'RESTRICT'],
  ['gasto', 'fk_gasto_categoria', ['idTienda', 'idCategoriaGasto'], 'categoriaGasto', ['idTienda', 'idCategoriaGasto'], 'RESTRICT', 'RESTRICT'],
  ['gasto', 'fk_gasto_creador', ['idTienda', 'idAdministrador'], 'administrador', ['idTienda', 'idAdministrador'], 'RESTRICT', 'RESTRICT'],
  ['gasto', 'fk_gasto_modificador', ['idTienda', 'idAdministradorModifica'], 'administrador', ['idTienda', 'idAdministrador'], 'RESTRICT', 'RESTRICT'],
  ['gasto', 'fk_gasto_anulador', ['idTienda', 'idAdministradorAnula'], 'administrador', ['idTienda', 'idAdministrador'], 'RESTRICT', 'RESTRICT'],
  ['cierreCaja', 'fk_cierreCaja_tienda', ['idTienda'], 'tienda', ['idTienda'], 'RESTRICT', 'RESTRICT'],
  ['cierreCaja', 'fk_cierreCaja_creador', ['idTienda', 'idAdministrador'], 'administrador', ['idTienda', 'idAdministrador'], 'RESTRICT', 'RESTRICT'],
  ['cierreCaja', 'fk_cierreCaja_anulador', ['idTienda', 'idAdministradorAnula'], 'administrador', ['idTienda', 'idAdministrador'], 'RESTRICT', 'RESTRICT']
]);

async function count(connection, sql, params = []) {
  const [[row]] = await connection.query(sql, params);
  return Number(row.total || 0);
}

async function main() {
  logDatabaseTarget('Comprobacion de finanzas y caja');
  const connection = await createConnection();
  try {
    const schemaMigrations = await hasTable(connection, 'schema_migrations');
    const migracionRegistrada = schemaMigrations
      ? await count(connection, 'SELECT COUNT(*) total FROM schema_migrations WHERE nombre=?', [MIGRATION]) === 1
      : false;
    const tablas = {};
    const columnas = {};
    for (const [table, columns] of Object.entries(REQUIRED_COLUMNS)) {
      tablas[table] = await hasTable(connection, table);
      columnas[table] = tablas[table] && await hasColumns(connection, table, columns);
    }
    const indices = {};
    for (const index of INDEXES) indices[`${index[0]}.${index[1]}`] = await hasIndex(connection, ...index);
    const checks = {};
    for (const check of CHECKS) checks[`${check[0]}.${check[1]}`] = await hasCheckConstraint(connection, ...check);
    const clavesForaneas = {};
    for (const relation of FOREIGN_KEYS) clavesForaneas[`${relation[0]}.${relation[1]}`] = await hasForeignKeyConstraint(connection, ...relation);

    const estructuraCompleta = Object.values(tablas).every(Boolean)
      && Object.values(columnas).every(Boolean)
      && Object.values(indices).every(Boolean)
      && Object.values(checks).every(Boolean)
      && Object.values(clavesForaneas).every(Boolean);

    const datos = {
      categoriasDuplicadas: null,
      categoriasConTiendaInvalida: null,
      tiendasSinCategorias: null,
      gastosInvalidos: null,
      gastosConTiendaOCategoriaInvalida: null,
      responsablesGastoInvalidos: null,
      anulacionesGastoSinTrazabilidad: null,
      costosNegativos: null,
      costosTotalesIncoherentes: null,
      costosPositivosSinClasificar: null,
      ventasNuevasSinOrigenCosto: null,
      cierresPeriodoInvalido: null,
      cierresSuperpuestos: null,
      cierresBalanceInvalido: null,
      responsablesCierreInvalidos: null,
      funcionalidadesActivas: null,
      accesosPlanCorrectos: null,
      diferenciaPagosPorMetodo: null,
      detallesGananciaIncoherente: null,
      conteos: null
    };

    if (estructuraCompleta) {
      datos.categoriasDuplicadas = await count(connection,
        `SELECT COUNT(*) total FROM (
           SELECT idTienda, nombreNormalizado FROM categoriaGasto
           GROUP BY idTienda, nombreNormalizado HAVING COUNT(*)>1
         ) duplicados`);
      datos.categoriasConTiendaInvalida = await count(connection,
        `SELECT COUNT(*) total FROM categoriaGasto cg
         LEFT JOIN tienda t ON t.idTienda=cg.idTienda
         WHERE t.idTienda IS NULL`);
      datos.tiendasSinCategorias = await count(connection,
        `SELECT COUNT(*) total FROM tienda t
         WHERE NOT EXISTS (SELECT 1 FROM categoriaGasto cg WHERE cg.idTienda=t.idTienda)`);
      datos.gastosInvalidos = await count(connection,
        "SELECT COUNT(*) total FROM gasto WHERE monto<=0 OR metodoPago NOT IN ('efectivo','qr','transferencia','otro')");
      datos.gastosConTiendaOCategoriaInvalida = await count(connection,
        `SELECT COUNT(*) total FROM gasto g
         LEFT JOIN categoriaGasto c ON c.idTienda=g.idTienda AND c.idCategoriaGasto=g.idCategoriaGasto
         WHERE c.idCategoriaGasto IS NULL`);
      datos.responsablesGastoInvalidos = await count(connection,
        `SELECT COUNT(*) total FROM gasto g
         LEFT JOIN administrador a ON a.idTienda=g.idTienda AND a.idAdministrador=g.idAdministrador
         LEFT JOIN administrador am ON am.idTienda=g.idTienda AND am.idAdministrador=g.idAdministradorModifica
         LEFT JOIN administrador aa ON aa.idTienda=g.idTienda AND aa.idAdministrador=g.idAdministradorAnula
         WHERE a.idAdministrador IS NULL
            OR (g.idAdministradorModifica IS NOT NULL AND am.idAdministrador IS NULL)
            OR (g.idAdministradorAnula IS NOT NULL AND aa.idAdministrador IS NULL)`);
      datos.anulacionesGastoSinTrazabilidad = await count(connection,
        `SELECT COUNT(*) total FROM gasto
         WHERE (estado='registrado' AND (anuladoEn IS NOT NULL OR idAdministradorAnula IS NOT NULL OR motivoAnulacion IS NOT NULL))
            OR (estado='anulado' AND (anuladoEn IS NULL OR idAdministradorAnula IS NULL OR motivoAnulacion IS NULL))`);
      datos.costosNegativos = await count(connection,
        'SELECT COUNT(*) total FROM detalleVenta WHERE costoUnitario<0 OR subtotalCosto<0');
      datos.costosTotalesIncoherentes = await count(connection,
        `SELECT COUNT(*) total FROM detalleVenta
         WHERE cantidadEquivalenteUnidades>0
           AND ABS(subtotalCosto-(costoUnitario*cantidadEquivalenteUnidades))>=0.02`);
      datos.costosPositivosSinClasificar = await count(connection,
        `SELECT COUNT(*) total FROM detalleVenta
         WHERE costoUnitario>0 AND cantidadEquivalenteUnidades>0 AND origenCosto='desconocido'`);
      datos.ventasNuevasSinOrigenCosto = await count(connection,
        `SELECT COUNT(*) total FROM detalleVenta d
         JOIN movimientoStock m ON m.idTienda=d.idTienda AND m.idDetalleVenta=d.idDetalleVenta AND m.origen='venta'
         WHERE d.costoUnitario>0 AND d.origenCosto<>'real'`);
      datos.cierresPeriodoInvalido = await count(connection,
        'SELECT COUNT(*) total FROM cierreCaja WHERE fechaFin<=fechaInicio');
      datos.cierresSuperpuestos = await count(connection,
        `SELECT COUNT(*) total FROM cierreCaja a
         JOIN cierreCaja b ON b.idTienda=a.idTienda AND b.idCierreCaja>a.idCierreCaja
         WHERE a.estado='cerrado' AND b.estado='cerrado'
           AND a.fechaInicio<b.fechaFin AND b.fechaInicio<a.fechaFin`);
      datos.cierresBalanceInvalido = await count(connection,
        `SELECT COUNT(*) total FROM cierreCaja
         WHERE ABS(efectivoEsperado-(efectivoInicial+efectivoVentasEsperado+efectivoFiadosCobrado-gastosEfectivo))>=0.01
            OR ABS(diferencia-(efectivoContado-efectivoEsperado))>=0.01`);
      datos.responsablesCierreInvalidos = await count(connection,
        `SELECT COUNT(*) total FROM cierreCaja c
         LEFT JOIN administrador a ON a.idTienda=c.idTienda AND a.idAdministrador=c.idAdministrador
         LEFT JOIN administrador aa ON aa.idTienda=c.idTienda AND aa.idAdministrador=c.idAdministradorAnula
         WHERE a.idAdministrador IS NULL OR (c.idAdministradorAnula IS NOT NULL AND aa.idAdministrador IS NULL)`);
      datos.funcionalidadesActivas = await count(connection,
        `SELECT COUNT(DISTINCT codigo) total FROM funcionalidad
         WHERE codigo IN ('gastos','reportes_financieros','rentabilidad_producto','exportacion_reportes','cierre_caja','dashboard_financiero') AND activo=1`);
      datos.accesosPlanCorrectos = await count(connection,
        `SELECT COUNT(DISTINCT CONCAT(p.codigo, ':', f.codigo)) total
         FROM planFuncionalidad pf JOIN plan p ON p.idPlan=pf.idPlan
         JOIN funcionalidad f ON f.idFuncionalidad=pf.idFuncionalidad
         WHERE pf.habilitada=1 AND p.activo=1 AND f.activo=1
           AND ((p.codigo IN ('basico','avanzado') AND f.codigo IN ('gastos','reportes_financieros','exportacion_reportes','dashboard_financiero'))
             OR (p.codigo='avanzado' AND f.codigo IN ('rentabilidad_producto','cierre_caja')))`);
      datos.diferenciaPagosPorMetodo = await count(connection,
        `SELECT COUNT(*) total FROM (
           SELECT idTienda, ABS(SUM(monto)-(
             SUM(CASE WHEN metodoPago='efectivo' THEN monto ELSE 0 END)
             +SUM(CASE WHEN metodoPago='qr' THEN monto ELSE 0 END)
             +SUM(CASE WHEN metodoPago='no_especificado' THEN monto ELSE 0 END))) diferencia
           FROM pagoVenta GROUP BY idTienda HAVING diferencia>=0.01
         ) diferencias`);
      datos.detallesGananciaIncoherente = await count(connection,
        `SELECT COUNT(*) total FROM detalleVenta
         WHERE (subtotal-(subtotalCosto+ganancia))<-0.02`);
      const [[counts]] = await connection.query(
        `SELECT
          (SELECT COUNT(*) FROM categoriaGasto) categorias,
          (SELECT COUNT(*) FROM gasto) gastos,
          (SELECT COUNT(*) FROM gasto WHERE estado='anulado') gastosAnulados,
          (SELECT COUNT(*) FROM cierreCaja) cierres,
          (SELECT COUNT(*) FROM cierreCaja WHERE estado='anulado') cierresAnulados,
          (SELECT COUNT(*) FROM detalleVenta WHERE origenCosto='real') costosReales,
          (SELECT COUNT(*) FROM detalleVenta WHERE origenCosto='estimado') costosEstimados,
          (SELECT COUNT(*) FROM detalleVenta WHERE origenCosto='desconocido') costosDesconocidos`
      );
      datos.conteos = counts;
    }

    const datosValidos = estructuraCompleta
      && Object.entries(datos)
        .filter(([key]) => !['conteos', 'funcionalidadesActivas', 'accesosPlanCorrectos'].includes(key))
        .every(([, value]) => value === 0)
      && datos.funcionalidadesActivas === 6
      && datos.accesosPlanCorrectos === 10;
    const estadoMigracion = migracionRegistrada && estructuraCompleta && datosValidos
      ? 'post-migracion'
      : (!migracionRegistrada && !tablas.categoriaGasto && !tablas.gasto && !tablas.cierreCaja && !columnas.detalleVenta)
        ? 'pre-migracion'
        : 'estructura-incompleta-o-migracion-parcial';

    console.log(JSON.stringify({
      estadoMigracion,
      migracionRegistrada,
      tablas,
      columnas,
      indices,
      checks,
      clavesForaneas,
      estructuraCompleta,
      datosValidos,
      datos
    }, null, 2));
    if (migracionRegistrada && (!estructuraCompleta || !datosValidos)) process.exitCode = 1;
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error('No se pudo comprobar la estructura financiera.');
  console.error(error.message);
  process.exit(1);
});
