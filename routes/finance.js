const express = require('express');
const pool = require('../config/db');
const { requirePlanFeature } = require('../middleware/subscription');
const { buildFinancialExport } = require('../services/financial-export-service');
const {
  calculateCashClose,
  cents,
  cleanText,
  closeRange,
  decimal,
  expensePayload,
  expensesByCategory,
  expensesByDay,
  financialSummary,
  httpError,
  normalizeName,
  paymentMethods,
  positiveId,
  productProfitability,
  purchasesReport,
  receivables,
  reportRange,
  salesByDay,
  validateExpenseCategory
} = require('../services/financial-service');
const { formatLocalDateTime } = require('../utils/local-datetime');

const router = express.Router();

router.use('/gastos', requirePlanFeature('gastos'));
router.use('/reportes/finanzas', requirePlanFeature('reportes_financieros'));
router.use('/dashboard/financiero', requirePlanFeature('dashboard_financiero'));
router.use('/caja/cierres', requirePlanFeature('cierre_caja'));
router.use('/exportaciones', requirePlanFeature('exportacion_reportes'));

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function tenantId(req) {
  return req.tenant.idTienda;
}

function pagination(query, maximum = 100) {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const limit = Math.min(maximum, Math.max(1, Number.parseInt(query.limit, 10) || 30));
  return { page, limit, offset: (page - 1) * limit };
}

function hasFeature(req, code) {
  return req.subscriptionContext?.caracteristicas?.includes(code);
}

router.get('/gastos/categorias', asyncRoute(async (req, res) => {
  const includeInactive = req.query.incluirInactivas === '1';
  const [rows] = await pool.query(
    `SELECT idCategoriaGasto, nombre, descripcion, activo, creadoEn, actualizadoEn
     FROM categoriaGasto WHERE idTienda=? ${includeInactive ? '' : 'AND activo=1'}
     ORDER BY activo DESC, nombre`,
    [tenantId(req)]
  );
  res.json(rows);
}));

router.post('/gastos/categorias', asyncRoute(async (req, res) => {
  const nombre = cleanText(req.body?.nombre, 100, { required: true, label: 'El nombre' });
  const nombreNormalizado = normalizeName(nombre);
  const descripcion = cleanText(req.body?.descripcion, 255, { label: 'La descripcion' });
  if (!nombreNormalizado) throw httpError(400, 'El nombre de la categoria no es valido.');
  try {
    const localDateTime = formatLocalDateTime();
    const [result] = await pool.query(
      `INSERT INTO categoriaGasto
       (idTienda, nombre, nombreNormalizado, descripcion, creadoEn, actualizadoEn)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [tenantId(req), nombre, nombreNormalizado, descripcion, localDateTime, localDateTime]
    );
    res.status(201).json({ message: 'Categoria creada.', idCategoriaGasto: result.insertId });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') throw httpError(409, 'Ya existe una categoria con ese nombre.');
    throw error;
  }
}));

router.put('/gastos/categorias/:id', asyncRoute(async (req, res) => {
  const idCategoriaGasto = positiveId(req.params.id, 'La categoria');
  const nombre = cleanText(req.body?.nombre, 100, { required: true, label: 'El nombre' });
  const descripcion = cleanText(req.body?.descripcion, 255, { label: 'La descripcion' });
  const activo = req.body?.activo === false || req.body?.activo === 0 || req.body?.activo === '0' ? 0 : 1;
  try {
    const [result] = await pool.query(
      `UPDATE categoriaGasto SET nombre=?, nombreNormalizado=?, descripcion=?, activo=?, actualizadoEn=?
       WHERE idTienda=? AND idCategoriaGasto=?`,
      [nombre, normalizeName(nombre), descripcion, activo, formatLocalDateTime(), tenantId(req), idCategoriaGasto]
    );
    if (!result.affectedRows) throw httpError(404, 'La categoria no existe.');
    res.json({ message: 'Categoria actualizada.' });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') throw httpError(409, 'Ya existe una categoria con ese nombre.');
    throw error;
  }
}));

router.get('/gastos', asyncRoute(async (req, res) => {
  const range = reportRange(req.query);
  const { page, limit, offset } = pagination(req.query);
  const conditions = ['g.idTienda=?', 'g.fechaGasto>=?', 'g.fechaGasto<?'];
  const params = [tenantId(req), range.inicio, range.finExclusivo];
  if (req.query.idCategoriaGasto) { conditions.push('g.idCategoriaGasto=?'); params.push(positiveId(req.query.idCategoriaGasto, 'La categoria')); }
  if (req.query.metodoPago) {
    const method = String(req.query.metodoPago).trim().toLowerCase();
    if (!['efectivo', 'qr', 'transferencia', 'otro'].includes(method)) throw httpError(400, 'El metodo de pago no es valido.');
    conditions.push('g.metodoPago=?'); params.push(method);
  }
  if (req.query.estado) {
    const state = String(req.query.estado).trim().toLowerCase();
    if (!['registrado', 'anulado'].includes(state)) throw httpError(400, 'El estado del gasto no es valido.');
    conditions.push('g.estado=?'); params.push(state);
  }
  if (req.query.q) { conditions.push('g.concepto LIKE ?'); params.push(`%${String(req.query.q).trim().slice(0, 100)}%`); }
  const [[rows], [counts]] = await Promise.all([
    pool.query(
      `SELECT g.idGasto, DATE_FORMAT(g.fechaGasto,'%Y-%m-%dT%H:%i:%s') fechaGasto,
              g.concepto, g.monto, g.metodoPago, g.referencia,
              g.observacion, g.recurrente, g.estado, g.motivoAnulacion, g.creadoEn,
              g.actualizadoEn, g.anuladoEn, cg.idCategoriaGasto, cg.nombre categoria,
              a.usuario creadoPor, am.usuario modificadoPor, aa.usuario anuladoPor
       FROM gasto g
       JOIN categoriaGasto cg ON cg.idTienda=g.idTienda AND cg.idCategoriaGasto=g.idCategoriaGasto
       JOIN administrador a ON a.idTienda=g.idTienda AND a.idAdministrador=g.idAdministrador
       LEFT JOIN administrador am ON am.idTienda=g.idTienda AND am.idAdministrador=g.idAdministradorModifica
       LEFT JOIN administrador aa ON aa.idTienda=g.idTienda AND aa.idAdministrador=g.idAdministradorAnula
       WHERE ${conditions.join(' AND ')} ORDER BY g.fechaGasto DESC, g.idGasto DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    ),
    pool.query(
      `SELECT COUNT(*) total, COALESCE(SUM(CASE WHEN g.estado='registrado' THEN g.monto ELSE 0 END),0) montoVigente
       FROM gasto g WHERE ${conditions.join(' AND ')}`,
      params
    )
  ]);
  res.json({ gastos: rows, total: Number(counts[0].total), montoVigente: counts[0].montoVigente, pagina: page, limite: limit, rango: range });
}));

router.get('/gastos/:id', asyncRoute(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT g.idGasto, DATE_FORMAT(g.fechaGasto,'%Y-%m-%dT%H:%i:%s') fechaGasto,
            g.concepto, g.monto, g.metodoPago, g.referencia,
            g.observacion, g.recurrente, g.estado, g.motivoAnulacion, g.creadoEn,
            g.actualizadoEn, g.anuladoEn, cg.idCategoriaGasto, cg.nombre categoria
     FROM gasto g JOIN categoriaGasto cg ON cg.idTienda=g.idTienda AND cg.idCategoriaGasto=g.idCategoriaGasto
     WHERE g.idTienda=? AND g.idGasto=?`,
    [tenantId(req), positiveId(req.params.id, 'El gasto')]
  );
  if (!rows.length) throw httpError(404, 'El gasto no existe.');
  res.json(rows[0]);
}));

router.post('/gastos', asyncRoute(async (req, res) => {
  const data = expensePayload(req.body);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await validateExpenseCategory(connection, tenantId(req), data.idCategoriaGasto, true);
    const localDateTime = formatLocalDateTime();
    const [result] = await connection.query(
      `INSERT INTO gasto
       (idTienda, idCategoriaGasto, idAdministrador, fechaGasto, concepto, monto, metodoPago,
        referencia, observacion, recurrente, creadoEn, actualizadoEn)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [tenantId(req), data.idCategoriaGasto, req.session.admin.id, data.fechaGasto, data.concepto,
        data.monto, data.metodoPago, data.referencia, data.observacion, data.recurrente,
        localDateTime, localDateTime]
    );
    await connection.commit();
    res.status(201).json({ message: 'Gasto registrado.', idGasto: result.insertId });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}));

router.put('/gastos/:id', asyncRoute(async (req, res) => {
  const idGasto = positiveId(req.params.id, 'El gasto');
  const data = expensePayload(req.body);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [expenses] = await connection.query(
      'SELECT idGasto, estado FROM gasto WHERE idTienda=? AND idGasto=? FOR UPDATE',
      [tenantId(req), idGasto]
    );
    if (!expenses.length) throw httpError(404, 'El gasto no existe.');
    if (expenses[0].estado !== 'registrado') throw httpError(409, 'Un gasto anulado no puede editarse.');
    await validateExpenseCategory(connection, tenantId(req), data.idCategoriaGasto, true);
    await connection.query(
      `UPDATE gasto SET idCategoriaGasto=?, idAdministradorModifica=?, fechaGasto=?, concepto=?,
         monto=?, metodoPago=?, referencia=?, observacion=?, recurrente=?, actualizadoEn=?
       WHERE idTienda=? AND idGasto=?`,
      [data.idCategoriaGasto, req.session.admin.id, data.fechaGasto, data.concepto, data.monto,
        data.metodoPago, data.referencia, data.observacion, data.recurrente, formatLocalDateTime(),
        tenantId(req), idGasto]
    );
    await connection.commit();
    res.json({ message: 'Gasto actualizado.' });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}));

router.post('/gastos/:id/anular', asyncRoute(async (req, res) => {
  const idGasto = positiveId(req.params.id, 'El gasto');
  const motivo = cleanText(req.body?.motivo, 300, { required: true, label: 'El motivo de anulacion' });
  if (motivo.length < 8) throw httpError(400, 'El motivo de anulacion debe tener al menos 8 caracteres.');
  const localDateTime = formatLocalDateTime();
  const [result] = await pool.query(
    `UPDATE gasto SET estado='anulado', motivoAnulacion=?, idAdministradorAnula=?, anuladoEn=?, actualizadoEn=?
     WHERE idTienda=? AND idGasto=? AND estado='registrado'`,
    [motivo, req.session.admin.id, localDateTime, localDateTime, tenantId(req), idGasto]
  );
  if (!result.affectedRows) {
    const [[row]] = await pool.query('SELECT COUNT(*) total FROM gasto WHERE idTienda=? AND idGasto=?', [tenantId(req), idGasto]);
    if (!Number(row.total)) throw httpError(404, 'El gasto no existe.');
    throw httpError(409, 'El gasto ya fue anulado.');
  }
  res.json({ message: 'Gasto anulado sin borrar su historial.' });
}));

router.get('/reportes/finanzas/resumen', asyncRoute(async (req, res) => {
  const range = reportRange(req.query);
  res.json(await financialSummary(pool, tenantId(req), range));
}));

router.get('/reportes/finanzas/ventas', asyncRoute(async (req, res) => {
  const range = reportRange(req.query);
  res.json({ rango: range, filas: await salesByDay(pool, tenantId(req), range) });
}));

router.get('/reportes/finanzas/metodos-pago', asyncRoute(async (req, res) => {
  const range = reportRange(req.query);
  res.json({ rango: range, filas: await paymentMethods(pool, tenantId(req), range) });
}));

router.get('/reportes/finanzas/gastos', asyncRoute(async (req, res) => {
  const range = reportRange(req.query);
  const [rows, evolution] = await Promise.all([
    expensesByCategory(pool, tenantId(req), range),
    expensesByDay(pool, tenantId(req), range)
  ]);
  res.json({ rango: range, filas: rows, evolucion: evolution });
}));

router.get('/reportes/finanzas/rentabilidad-productos', requirePlanFeature('rentabilidad_producto'), asyncRoute(async (req, res) => {
  const range = reportRange(req.query);
  res.json({ rango: range, filas: await productProfitability(pool, tenantId(req), range, req.query) });
}));

router.get('/reportes/finanzas/cuentas-por-cobrar', asyncRoute(async (req, res) => {
  const { page, limit, offset } = pagination(req.query);
  const [rows, [summaryRows]] = await Promise.all([
    receivables(pool, tenantId(req), { limit, offset }),
    pool.query(
      `SELECT COUNT(*) cantidad, COALESCE(SUM(saldoPendiente),0) total
       FROM fiado WHERE idTienda=? AND saldoPendiente>0`,
      [tenantId(req)]
    )
  ]);
  res.json({
    filas: rows,
    total: Number(summaryRows[0].total || 0),
    totalRegistros: Number(summaryRows[0].cantidad || 0),
    pagina: page,
    limite: limit
  });
}));

router.get('/reportes/finanzas/compras', asyncRoute(async (req, res) => {
  const range = reportRange(req.query);
  const { page, limit, offset } = pagination(req.query);
  const [rows, [summaryRows]] = await Promise.all([
    purchasesReport(pool, tenantId(req), range, { limit, offset }),
    pool.query(
      `SELECT COUNT(*) cantidad, COALESCE(SUM(total),0) total FROM compra
       WHERE idTienda=? AND fecha>=? AND fecha<?`,
      [tenantId(req), range.inicio, range.finExclusivo]
    )
  ]);
  res.json({
    rango: range,
    filas: rows,
    total: Number(summaryRows[0].total || 0),
    totalRegistros: Number(summaryRows[0].cantidad || 0),
    pagina: page,
    limite: limit,
    afectaGananciaNeta: false
  });
}));

router.get('/dashboard/financiero', asyncRoute(async (req, res) => {
  const range = reportRange(req.query, { defaultPeriod: 'mes' });
  const [summary, sales, methods, expenses] = await Promise.all([
    financialSummary(pool, tenantId(req), range),
    salesByDay(pool, tenantId(req), range),
    paymentMethods(pool, tenantId(req), range),
    expensesByCategory(pool, tenantId(req), range)
  ]);
  const response = { resumen: summary, ventasPorDia: sales, metodosPago: methods, gastosPorCategoria: expenses };
  if (hasFeature(req, 'rentabilidad_producto')) {
    response.productosRentables = await productProfitability(pool, tenantId(req), range, { limit: 8 });
  }
  res.json(response);
}));

router.get('/caja/cierres/calcular', asyncRoute(async (req, res) => {
  const range = closeRange(req.query);
  res.json(await calculateCashClose(pool, tenantId(req), range, req.query.efectivoInicial || 0));
}));

router.get('/caja/cierres', asyncRoute(async (req, res) => {
  const { page, limit, offset } = pagination(req.query, 50);
  const [rows] = await pool.query(
    `SELECT c.idCierreCaja, DATE_FORMAT(c.fechaInicio,'%Y-%m-%dT%H:%i:%s') fechaInicio,
            DATE_FORMAT(c.fechaFin,'%Y-%m-%dT%H:%i:%s') fechaFin, c.efectivoInicial,
            c.efectivoVentasEsperado, c.efectivoFiadosCobrado, c.gastosEfectivo,
            c.compensacionesEfectivo, c.reembolsosEfectivo,
            c.compensacionesCobroTotal, c.reembolsosTotal,
            c.efectivoEsperado, c.efectivoContado, c.diferencia, c.totalQR,
            c.totalNoEspecificado, c.totalCobrado, c.totalVentas,
            c.compensacionesVenta, c.liquidacionesOtroMedio, c.totalFiadoGenerado,
            c.totalGastos, c.totalCompras, c.observacion, c.estado, c.motivoAnulacion,
            c.creadoEn, c.anuladoEn, a.usuario responsable, aa.usuario anuladoPor
     FROM cierreCaja c
     JOIN administrador a ON a.idTienda=c.idTienda AND a.idAdministrador=c.idAdministrador
     LEFT JOIN administrador aa ON aa.idTienda=c.idTienda AND aa.idAdministrador=c.idAdministradorAnula
     WHERE c.idTienda=? ORDER BY c.fechaFin DESC, c.idCierreCaja DESC LIMIT ? OFFSET ?`,
    [tenantId(req), limit, offset]
  );
  res.json({ cierres: rows, pagina: page, limite: limit });
}));

router.get('/caja/cierres/:id', asyncRoute(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT c.idCierreCaja, DATE_FORMAT(c.fechaInicio,'%Y-%m-%dT%H:%i:%s') fechaInicio,
            DATE_FORMAT(c.fechaFin,'%Y-%m-%dT%H:%i:%s') fechaFin, c.efectivoInicial,
            c.efectivoVentasEsperado, c.efectivoFiadosCobrado, c.gastosEfectivo,
            c.compensacionesEfectivo, c.reembolsosEfectivo,
            c.compensacionesCobroTotal, c.reembolsosTotal,
            c.efectivoEsperado, c.efectivoContado, c.diferencia, c.totalQR,
            c.totalNoEspecificado, c.totalCobrado, c.totalVentas,
            c.compensacionesVenta, c.liquidacionesOtroMedio, c.totalFiadoGenerado,
            c.totalGastos, c.totalCompras, c.observacion, c.estado, c.motivoAnulacion,
            c.creadoEn, c.anuladoEn, a.usuario responsable, aa.usuario anuladoPor
     FROM cierreCaja c
     JOIN administrador a ON a.idTienda=c.idTienda AND a.idAdministrador=c.idAdministrador
     LEFT JOIN administrador aa ON aa.idTienda=c.idTienda AND aa.idAdministrador=c.idAdministradorAnula
     WHERE c.idTienda=? AND c.idCierreCaja=?`,
    [tenantId(req), positiveId(req.params.id, 'El cierre')]
  );
  if (!rows.length) throw httpError(404, 'El cierre no existe.');
  res.json(rows[0]);
}));

router.post('/caja/cierres', asyncRoute(async (req, res) => {
  const range = closeRange(req.body || {});
  const key = cleanText(req.body?.claveOperacion, 64, { required: true, label: 'La clave de operacion' });
  const observacion = cleanText(req.body?.observacion, 500, { label: 'La observacion' });
  const countedCents = cents(req.body?.efectivoContado, 'El efectivo contado');
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.query('SELECT idTienda FROM tienda WHERE idTienda=? FOR UPDATE', [tenantId(req)]);
    const [existing] = await connection.query(
      'SELECT idCierreCaja FROM cierreCaja WHERE idTienda=? AND claveOperacion=? FOR UPDATE',
      [tenantId(req), key]
    );
    if (existing.length) {
      await connection.commit();
      return res.status(200).json({ message: 'El cierre ya estaba registrado.', idCierreCaja: existing[0].idCierreCaja, repetido: true });
    }
    const [overlaps] = await connection.query(
      `SELECT idCierreCaja FROM cierreCaja
       WHERE idTienda=? AND estado='cerrado' AND fechaInicio<? AND ?<fechaFin
       LIMIT 1 FOR UPDATE`,
      [tenantId(req), range.finExclusivo, range.inicio]
    );
    if (overlaps.length) throw httpError(409, 'El periodo se superpone con otro cierre vigente.');
    const calculated = await calculateCashClose(connection, tenantId(req), range, req.body?.efectivoInicial || 0);
    const expectedCents = cents(calculated.efectivoEsperado, 'El efectivo esperado');
    const diferencia = decimal(countedCents - expectedCents);
    const [result] = await connection.query(
      `INSERT INTO cierreCaja
       (idTienda, idAdministrador, fechaInicio, fechaFin, efectivoInicial, efectivoVentasEsperado,
        efectivoFiadosCobrado, gastosEfectivo, compensacionesEfectivo,
        reembolsosEfectivo, compensacionesCobroTotal, reembolsosTotal,
        efectivoEsperado, efectivoContado, diferencia,
        totalQR, totalNoEspecificado, totalCobrado, totalVentas, compensacionesVenta,
        liquidacionesOtroMedio, totalFiadoGenerado,
        totalGastos, totalCompras, observacion, claveOperacion, creadoEn)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
               ?, ?, ?, ?, ?, ?)`,
      [tenantId(req), req.session.admin.id, range.inicio, range.finExclusivo,
        calculated.efectivoInicial, calculated.efectivoVentasEsperado, calculated.efectivoFiadosCobrado,
        calculated.gastosEfectivo, calculated.compensacionesEfectivo,
        calculated.reembolsosEfectivo, calculated.compensacionesCobroTotal,
        calculated.reembolsosTotal, calculated.efectivoEsperado,
        decimal(countedCents), diferencia,
        calculated.totalQR, calculated.totalNoEspecificado, calculated.totalCobrado,
        calculated.totalVentas, calculated.compensacionesVenta,
        calculated.liquidacionesOtroMedio, calculated.totalFiadoGenerado, calculated.totalGastos,
        calculated.totalCompras, observacion, key, formatLocalDateTime()]
    );
    await connection.commit();
    res.status(201).json({ message: 'Cierre de caja registrado.', idCierreCaja: result.insertId, diferencia, calculo: calculated });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}));

router.post('/caja/cierres/:id/anular', asyncRoute(async (req, res) => {
  const motivo = cleanText(req.body?.motivo, 300, { required: true, label: 'El motivo de anulacion' });
  if (motivo.length < 8) throw httpError(400, 'El motivo de anulacion debe tener al menos 8 caracteres.');
  const [result] = await pool.query(
    `UPDATE cierreCaja SET estado='anulado', motivoAnulacion=?, idAdministradorAnula=?, anuladoEn=?
     WHERE idTienda=? AND idCierreCaja=? AND estado='cerrado'`,
    [motivo, req.session.admin.id, formatLocalDateTime(), tenantId(req), positiveId(req.params.id, 'El cierre')]
  );
  if (!result.affectedRows) throw httpError(404, 'El cierre no existe o ya esta anulado.');
  res.json({ message: 'Cierre anulado. Sus valores historicos se conservaron.' });
}));

router.get('/exportaciones/:tipo.xlsx', asyncRoute(async (req, res) => {
  const type = String(req.params.tipo || '').trim().toLowerCase();
  if (type === 'rentabilidad' && !hasFeature(req, 'rentabilidad_producto')) {
    throw httpError(403, 'La rentabilidad detallada no esta incluida en el plan actual.');
  }
  if (type === 'cierres' && !hasFeature(req, 'cierre_caja')) {
    throw httpError(403, 'El cierre de caja no esta incluido en el plan actual.');
  }
  const result = await buildFinancialExport(pool, tenantId(req), type, req.query);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${result.fileName}"`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(Buffer.from(result.buffer));
}));

module.exports = router;
