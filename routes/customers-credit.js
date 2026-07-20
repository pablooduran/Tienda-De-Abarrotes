const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../config/db');
const { requirePlanFeature } = require('../middleware/subscription');
const { enforcePlanLimit } = require('../services/subscription-service');
const {
  centsToDecimal,
  buildCustomerFilter,
  buildDebtFilter,
  buildStatementFilter,
  cleanText,
  collectionState,
  creditError,
  daysBetweenLocalDates,
  effectiveDebtDate,
  effectiveLimitCents,
  getCreditConfiguration,
  lockCustomer,
  moneyToCents,
  normalizeCreditConfiguration,
  normalizeCustomerPayload,
  parseLocalDate,
  setCustomerVisibility,
  summarizeDebts
} = require('../services/customer-credit-service');
const { collectCustomerDebt, collectSpecificDebt } = require('../services/debt-collection-service');
const {
  exportCustomerStatement,
  exportCustomers,
  exportDebts
} = require('../services/customer-credit-export-service');
const {
  TEMPLATE_TYPES,
  TEMPLATE_VARIABLES,
  createTemplate,
  listTemplates,
  renderTemplate,
  resolveActiveTemplate,
  setTemplateActive,
  updateTemplate
} = require('../services/customer-credit-template-service');
const { getCollectionReceipt } = require('../services/customer-credit-receipt-service');
const {
  addLocalDays,
  formatLocalDate,
  formatLocalDateTime,
  parseLocalDate: parseBusinessDate
} = require('../utils/local-datetime');

const router = express.Router();
const FOLLOWUP_TYPES = new Set(['nota', 'llamada', 'mensaje_enviado_manual', 'compromiso_pago', 'visita']);
const FOLLOWUP_CHANNELS = new Set(['ninguno', 'whatsapp', 'telefono', 'presencial', 'correo']);
const CUSTOMER_HISTORY_LIMIT = 20;

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function tenantId(req) {
  return req.tenant.idTienda;
}

function requireExportSubscription(req, res, next) {
  const context = req.subscriptionContext;
  if (context && !context.soloLectura) return next();
  return res.status(403).json({
    error: 'La suscripcion debe estar activa para generar exportaciones.',
    code: 'SUBSCRIPTION_READ_ONLY',
    estadoSuscripcion: context?.suscripcion?.estadoEfectivo || 'sin_suscripcion'
  });
}

function sendWorkbook(res, result) {
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${result.fileName}"`);
  res.setHeader('Cache-Control', 'no-store');
  return res.send(Buffer.from(result.buffer));
}

function administratorPassword(body = {}) {
  return body.passwordAdministrador || body.adminPassword || body.contrasena || body.password || '';
}

async function requireAdministratorPassword(req) {
  const password = administratorPassword(req.body);
  if (!password) throw creditError(400, 'Debes ingresar la contrasena del administrador.', 'ADMIN_PASSWORD_REQUIRED');
  const idAdministrador = req.session?.admin?.id;
  if (!idAdministrador) throw creditError(401, 'La sesion no es valida.', 'AUTH_REQUIRED');
  const [rows] = await pool.query(
    `SELECT password FROM administrador
     WHERE idAdministrador=? AND idTienda=? AND rol='dueno_tienda' AND activo=1`,
    [idAdministrador, tenantId(req)]
  );
  if (!rows.length || !await bcrypt.compare(password, rows[0].password)) {
    throw creditError(403, 'Contrasena de administrador incorrecta.', 'INVALID_ADMIN_PASSWORD');
  }
}

function positiveId(value, label = 'El identificador') {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) throw creditError(400, `${label} no es valido.`);
  return number;
}

function pagination(query, maximum = 100) {
  const rawPage = query.pagina ?? query.page;
  const rawLimit = query.limite ?? query.limit;
  const page = rawPage === undefined || rawPage === '' ? 1 : Number(rawPage);
  const limit = rawLimit === undefined || rawLimit === '' ? 20 : Number(rawLimit);
  if (!Number.isInteger(page) || page < 1) throw creditError(400, 'La pagina debe ser un entero positivo.');
  if (!Number.isInteger(limit) || limit < 1 || limit > maximum) {
    throw creditError(400, `El limite debe ser un entero entre 1 y ${maximum}.`);
  }
  return { page, limit, offset: (page - 1) * limit };
}

function paginationMetadata(page, pageSize, total) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return {
    page,
    pageSize,
    total,
    totalPages,
    hasNextPage: page < totalPages,
    hasPreviousPage: page > 1,
    pagina: page,
    limite: pageSize
  };
}

function collectionSummarySql(where) {
  return `SELECT COUNT(*) total, COALESCE(SUM(f.saldoPendiente),0) deudaTotal,
                 COALESCE(SUM(f.saldoPendiente>0 AND COALESCE(f.fechaPrometidaPago,f.fechaVencimiento) IS NOT NULL
                   AND COALESCE(f.fechaPrometidaPago,f.fechaVencimiento)<?),0) vencidos,
                 COALESCE(SUM(f.saldoPendiente>0 AND COALESCE(f.fechaPrometidaPago,f.fechaVencimiento)=?),0) venceHoy,
                 COALESCE(SUM(f.saldoPendiente>0 AND COALESCE(f.fechaPrometidaPago,f.fechaVencimiento)>?
                   AND COALESCE(f.fechaPrometidaPago,f.fechaVencimiento)<=?),0) proximos,
                 COALESCE(SUM(f.saldoPendiente>0 AND COALESCE(f.fechaPrometidaPago,f.fechaVencimiento)>?),0) alDia,
                 COALESCE(SUM(f.saldoPendiente>0 AND COALESCE(f.fechaPrometidaPago,f.fechaVencimiento) IS NULL),0) sinFecha,
                 COALESCE(SUM(f.saldoPendiente<=0),0) pagados
          FROM fiado f JOIN cliente c ON c.idTienda=f.idTienda AND c.idCliente=f.idCliente
          WHERE ${where}`;
}

function publicCollectionSummary(row) {
  return {
    deudaTotal: row.deudaTotal,
    vencidos: Number(row.vencidos || 0),
    venceHoy: Number(row.venceHoy || 0),
    proximos: Number(row.proximos || 0),
    alDia: Number(row.alDia || 0),
    sinFecha: Number(row.sinFecha || 0),
    pagados: Number(row.pagados || 0)
  };
}

function historyMetadata(shown, total) {
  return {
    shown,
    mostrados: shown,
    total,
    limit: CUSTOMER_HISTORY_LIMIT,
    limite: CUSTOMER_HISTORY_LIMIT,
    truncated: total > shown,
    truncado: total > shown
  };
}

function hasFeature(req, code) {
  return req.subscriptionContext?.caracteristicas?.includes(code) === true;
}

function assertAdvancedCreditFields(req) {
  if (hasFeature(req, 'limites_credito')) return;
  if (req.body?.limiteCredito !== undefined || req.body?.diasCreditoDefault !== undefined) {
    throw creditError(403, 'Los limites y plazos personalizados requieren la funcion de limites de credito.', 'PLAN_FEATURE_REQUIRED');
  }
}

async function transaction(handler) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await handler(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

function publicCustomer(row, configuration, debts = []) {
  const summary = summarizeDebts(debts);
  const limitCents = effectiveLimitCents(row, configuration);
  return {
    idCliente: row.idCliente,
    nombre: row.nombre,
    telefono: row.telefono,
    telefonoAlternativo: row.telefonoAlternativo,
    documentoIdentidad: row.documentoIdentidad,
    correo: row.correo,
    direccion: row.direccion,
    notas: row.notas,
    limiteCredito: row.limiteCredito,
    permiteFiado: Boolean(row.permiteFiado),
    diasCreditoDefault: row.diasCreditoDefault,
    canalPreferido: row.canalPreferido,
    aceptaRecordatorios: Boolean(row.aceptaRecordatorios),
    horarioPreferido: row.horarioPreferido,
    activo: Boolean(row.activo),
    eliminadoEn: row.eliminadoEn,
    creadoEn: row.creadoEn,
    actualizadoEn: row.actualizadoEn,
    deudaActual: centsToDecimal(summary.openCents),
    deudaVencida: centsToDecimal(summary.overdueCents),
    limiteEfectivo: limitCents === null ? null : centsToDecimal(limitCents),
    creditoDisponible: limitCents === null ? null : centsToDecimal(Math.max(0, limitCents - summary.openCents)),
    excedenteCredito: limitCents === null ? '0.00' : centsToDecimal(Math.max(0, summary.openCents - limitCents))
  };
}

function publicCreditConfiguration(configuration) {
  return {
    limiteCreditoDefault: configuration.limiteCreditoDefault,
    diasCreditoDefault: configuration.diasCreditoDefault,
    diasAvisoVencimiento: configuration.diasAvisoVencimiento,
    politicaFiadoVencido: configuration.politicaFiadoVencido,
    requiereTelefonoParaFiado: Boolean(configuration.requiereTelefonoParaFiado),
    permiteFiadoSinFecha: Boolean(configuration.permiteFiadoSinFecha),
    codigoPaisWhatsApp: configuration.codigoPaisWhatsApp,
    creadoEn: configuration.creadoEn,
    actualizadoEn: configuration.actualizadoEn
  };
}

async function customerSnapshot(connection, idTienda, idCliente, { lock = false } = {}) {
  const customer = lock
    ? await lockCustomer(connection, idTienda, idCliente)
    : (await connection.query(
      `SELECT idCliente, nombre, telefono, telefonoAlternativo, telefonoNormalizado,
              documentoIdentidad, documentoNormalizado, correo, direccion, notas,
              limiteCredito, permiteFiado, diasCreditoDefault, canalPreferido,
              aceptaRecordatorios, horarioPreferido, activo, eliminadoEn,
              creadoEn, actualizadoEn
       FROM cliente WHERE idTienda=? AND idCliente=?`,
      [idTienda, idCliente]
    ))[0][0];
  if (!customer) throw creditError(404, 'Cliente no encontrado.');
  const [debts] = await connection.query(
    `SELECT idFiado, idVenta, fechaInicio, fechaVencimiento, fechaPrometidaPago,
            totalFiado, totalPagado, saldoPendiente, estado, activo, cerradoEn
     FROM fiado WHERE idTienda=? AND idCliente=? ORDER BY idFiado`,
    [idTienda, idCliente]
  );
  const configuration = await getCreditConfiguration(connection, idTienda);
  return { customer, debts, configuration, summary: publicCustomer(customer, configuration, debts) };
}

async function listCustomers(req, res, options = {}) {
  const legacyResponse = options.legacyResponse === true
    || !['pagina', 'page', 'limite', 'limit'].some((key) => req.query[key] !== undefined);
  const { page, limit, offset } = legacyResponse
    ? { page: 1, limit: 500, offset: 0 }
    : pagination(req.query);
  const { params, state, where } = buildCustomerFilter(req.query, tenantId(req), {
    forcedState: options.forcedState
  });
  const [[count], [rows], configuration, [summaryRows]] = await Promise.all([
    pool.query(`SELECT COUNT(*) total FROM cliente c WHERE ${where}`, params),
    pool.query(
      `SELECT c.idCliente, c.nombre, c.telefono, c.telefonoAlternativo, c.documentoIdentidad,
              c.correo, c.limiteCredito, c.permiteFiado, c.diasCreditoDefault,
              c.canalPreferido, c.aceptaRecordatorios, c.activo, c.eliminadoEn,
              (SELECT COALESCE(SUM(f.saldoPendiente),0) FROM fiado f
               WHERE f.idTienda=c.idTienda AND f.idCliente=c.idCliente AND f.saldoPendiente>0) deudaActual,
              (SELECT COALESCE(SUM(f.saldoPendiente),0) FROM fiado f
               WHERE f.idTienda=c.idTienda AND f.idCliente=c.idCliente AND f.saldoPendiente>0
                 AND COALESCE(f.fechaPrometidaPago,f.fechaVencimiento) IS NOT NULL
                 AND COALESCE(f.fechaPrometidaPago,f.fechaVencimiento)<?) deudaVencida,
              (SELECT MAX(v.fecha) FROM venta v WHERE v.idTienda=c.idTienda AND v.idCliente=c.idCliente) ultimaCompra,
              (SELECT MAX(pf.fechaPago) FROM pagoFiado pf JOIN fiado f
               ON f.idTienda=pf.idTienda AND f.idFiado=pf.idFiado
               WHERE f.idTienda=c.idTienda AND f.idCliente=c.idCliente) ultimoPago
       FROM cliente c WHERE ${where}
       ORDER BY c.nombre, c.idCliente LIMIT ? OFFSET ?`,
      [formatLocalDate(), ...params, limit, offset]
    ),
    getCreditConfiguration(pool, tenantId(req)),
    pool.query(
      `SELECT COUNT(*) clientesFiltrados,
              COALESCE(SUM(c.activo=1),0) clientesActivos,
              COALESCE(SUM(c.activo=0),0) clientesOcultos,
              COALESCE(SUM(EXISTS (
                SELECT 1 FROM fiado fd WHERE fd.idTienda=c.idTienda
                  AND fd.idCliente=c.idCliente AND fd.saldoPendiente>0
              )),0) clientesConDeuda,
              COALESCE(SUM((
                SELECT COALESCE(SUM(fs.saldoPendiente),0) FROM fiado fs
                WHERE fs.idTienda=c.idTienda AND fs.idCliente=c.idCliente AND fs.saldoPendiente>0
              )),0) deudaTotal,
              COALESCE(SUM(EXISTS (
                SELECT 1 FROM fiado fv WHERE fv.idTienda=c.idTienda
                  AND fv.idCliente=c.idCliente AND fv.saldoPendiente>0
                  AND COALESCE(fv.fechaPrometidaPago,fv.fechaVencimiento) IS NOT NULL
                  AND COALESCE(fv.fechaPrometidaPago,fv.fechaVencimiento)<?
              )),0) clientesVencidos
       FROM cliente c WHERE ${where}`,
      [formatLocalDate(), ...params]
    )
  ]);
  const customers = rows.map((row) => {
    const limitCents = effectiveLimitCents(row, configuration);
    const debtCents = moneyToCents(row.deudaActual, 'La deuda');
    return {
      ...row,
      permiteFiado: Boolean(row.permiteFiado),
      aceptaRecordatorios: Boolean(row.aceptaRecordatorios),
      activo: Boolean(row.activo),
      limiteEfectivo: limitCents === null ? null : centsToDecimal(limitCents),
      creditoDisponible: limitCents === null ? null : centsToDecimal(Math.max(0, limitCents - debtCents))
    };
  });
  res.json(legacyResponse ? customers : {
    clientes: customers, pagina: page, limite: limit, total: Number(count[0].total),
    estado: state, resumen: summaryRows[0]
  });
}

router.get('/clientes/ocultos', requirePlanFeature('clientes_basico'), asyncRoute((req, res) => (
  listCustomers(req, res, { forcedState: 'ocultos', legacyResponse: true })
)));

router.get('/clientes', requirePlanFeature('clientes_basico'), asyncRoute((req, res) => listCustomers(req, res)));

router.get(
  '/clientes/exportacion.xlsx',
  requireExportSubscription,
  requirePlanFeature('clientes_basico'),
  requirePlanFeature('exportacion_clientes_fiados'),
  asyncRoute(async (req, res) => {
    const result = await exportCustomers(pool, tenantId(req), req.query);
    sendWorkbook(res, result);
  })
);

router.post('/clientes', requirePlanFeature('clientes_basico'), asyncRoute(async (req, res) => {
  assertAdvancedCreditFields(req);
  const result = await transaction(async (connection) => {
    const idTienda = tenantId(req);
    const now = formatLocalDateTime();
    const data = normalizeCustomerPayload(req.body);
    await connection.query('SELECT idTienda FROM tienda WHERE idTienda=? FOR UPDATE', [idTienda]);
    await enforcePlanLimit(connection, idTienda, 'clientes');
    const [[duplicatePhone]] = data.telefonoNormalizado
      ? await connection.query(
        'SELECT COUNT(*) total FROM cliente WHERE idTienda=? AND telefonoNormalizado=?',
        [idTienda, data.telefonoNormalizado]
      ) : [[{ total: 0 }]];
    try {
      const [insert] = await connection.query(
        `INSERT INTO cliente
         (idTienda, nombre, telefono, direccion, telefonoAlternativo, telefonoNormalizado,
          documentoIdentidad, documentoNormalizado, correo, notas, limiteCredito,
          permiteFiado, diasCreditoDefault, canalPreferido, aceptaRecordatorios,
          horarioPreferido, creadoEn, actualizadoEn, idAdministradorCrea, idAdministradorActualiza)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [idTienda, data.nombre, data.telefono, data.direccion, data.telefonoAlternativo,
          data.telefonoNormalizado, data.documentoIdentidad, data.documentoNormalizado, data.correo,
          data.notas, data.limiteCreditoCents === null ? null : centsToDecimal(data.limiteCreditoCents),
          data.permiteFiado, data.diasCreditoDefault, data.canalPreferido, data.aceptaRecordatorios,
          data.horarioPreferido, now, now, req.session.admin.id, req.session.admin.id]
      );
      return {
        idCliente: insert.insertId,
        advertencias: Number(duplicatePhone.total) > 0 ? ['Ya existe otro cliente con el mismo telefono.'] : []
      };
    } catch (error) {
      if (error.code === 'ER_DUP_ENTRY' && data.documentoNormalizado) {
        throw creditError(409, 'Ya existe un cliente con ese documento en la tienda.', 'DUPLICATE_CUSTOMER_DOCUMENT');
      }
      throw error;
    }
  });
  res.status(201).json({ message: 'Cliente creado.', ...result });
}));

async function updateCustomer(req, res) {
  assertAdvancedCreditFields(req);
  const result = await transaction(async (connection) => {
    const idTienda = tenantId(req);
    const idCliente = positiveId(req.params.id, 'El cliente');
    const current = await lockCustomer(connection, idTienda, idCliente, { requireActive: true });
    const data = normalizeCustomerPayload(req.body, current);
    const [[duplicatePhone]] = data.telefonoNormalizado
      ? await connection.query(
        'SELECT COUNT(*) total FROM cliente WHERE idTienda=? AND telefonoNormalizado=? AND idCliente<>?',
        [idTienda, data.telefonoNormalizado, idCliente]
      ) : [[{ total: 0 }]];
    try {
      await connection.query(
        `UPDATE cliente SET nombre=?, telefono=?, direccion=?, telefonoAlternativo=?,
            telefonoNormalizado=?, documentoIdentidad=?, documentoNormalizado=?, correo=?, notas=?,
            limiteCredito=?, permiteFiado=?, diasCreditoDefault=?, canalPreferido=?,
            aceptaRecordatorios=?, horarioPreferido=?, actualizadoEn=?, idAdministradorActualiza=?
         WHERE idTienda=? AND idCliente=?`,
        [data.nombre, data.telefono, data.direccion, data.telefonoAlternativo, data.telefonoNormalizado,
          data.documentoIdentidad, data.documentoNormalizado, data.correo, data.notas,
          data.limiteCreditoCents === null ? null : centsToDecimal(data.limiteCreditoCents),
          data.permiteFiado, data.diasCreditoDefault, data.canalPreferido, data.aceptaRecordatorios,
          data.horarioPreferido, formatLocalDateTime(), req.session.admin.id, idTienda, idCliente]
      );
    } catch (error) {
      if (error.code === 'ER_DUP_ENTRY' && data.documentoNormalizado) {
        throw creditError(409, 'Ya existe un cliente con ese documento en la tienda.', 'DUPLICATE_CUSTOMER_DOCUMENT');
      }
      throw error;
    }
    return { advertencias: Number(duplicatePhone.total) > 0 ? ['Ya existe otro cliente con el mismo telefono.'] : [] };
  });
  res.json({ message: 'Cliente actualizado.', ...result });
}

router.patch('/clientes/:id', requirePlanFeature('clientes_basico'), asyncRoute(updateCustomer));
router.put('/clientes/:id', requirePlanFeature('clientes_basico'), asyncRoute(updateCustomer));

async function changeCustomerVisibility(req, res, active) {
  await requireAdministratorPassword(req);
  const result = await transaction((connection) => setCustomerVisibility(connection, {
    idTienda: tenantId(req),
    idCliente: positiveId(req.params.id, 'El cliente'),
    idAdministrador: req.session.admin.id,
    active,
    now: formatLocalDateTime()
  }));
  res.json({
    message: active
      ? 'Cliente restaurado. Su historial y sus saldos no fueron modificados.'
      : 'Cliente ocultado. Su historial y sus saldos se conservan.',
    cliente: result
  });
}

router.delete('/clientes/:id', requirePlanFeature('clientes_basico'), asyncRoute((req, res) => (
  changeCustomerVisibility(req, res, false)
)));
router.patch('/clientes/:id/restaurar', requirePlanFeature('clientes_basico'), asyncRoute((req, res) => (
  changeCustomerVisibility(req, res, true)
)));

router.get('/clientes/:id/resumen', requirePlanFeature('clientes_basico'), asyncRoute(async (req, res) => {
  const idTienda = tenantId(req);
  const idCliente = positiveId(req.params.id, 'El cliente');
  const snapshot = await customerSnapshot(pool, idTienda, idCliente);
  const [[purchases], [payments], [openDebts]] = await Promise.all([
    pool.query('SELECT COUNT(*) cantidad, COALESCE(SUM(total),0) total, MAX(fecha) ultimaCompra FROM venta WHERE idTienda=? AND idCliente=?', [idTienda, idCliente]),
    pool.query(`SELECT COUNT(*) cantidad, COALESCE(SUM(pf.monto),0) total, MAX(pf.fechaPago) ultimoPago
      FROM pagoFiado pf JOIN fiado f ON f.idTienda=pf.idTienda AND f.idFiado=pf.idFiado
      WHERE f.idTienda=? AND f.idCliente=?`, [idTienda, idCliente]),
    pool.query('SELECT COUNT(*) cantidad FROM fiado WHERE idTienda=? AND idCliente=? AND saldoPendiente>0', [idTienda, idCliente])
  ]);
  res.json({ cliente: snapshot.summary, compras: purchases[0], pagos: payments[0], fiadosAbiertos: Number(openDebts[0].cantidad) });
}));

router.get(
  '/clientes/:id/estado-cuenta/exportacion.xlsx',
  requireExportSubscription,
  requirePlanFeature('estado_cuenta_basico'),
  requirePlanFeature('exportacion_clientes_fiados'),
  asyncRoute(async (req, res) => {
    const idCliente = positiveId(req.params.id, 'El cliente');
    const result = await exportCustomerStatement(pool, tenantId(req), idCliente, req.query);
    sendWorkbook(res, result);
  })
);

router.get('/clientes/:id/estado-cuenta', requirePlanFeature('estado_cuenta_basico'), asyncRoute(async (req, res) => {
  const idTienda = tenantId(req);
  const idCliente = positiveId(req.params.id, 'El cliente');
  const { page, limit, offset } = pagination(req.query);
  const snapshot = await customerSnapshot(pool, idTienda, idCliente);
  const {
    debtConditions, debtParams, movementParams, movementSql,
    paymentConditions, paymentParams, saleConditions, saleParams
  } = buildStatementFilter(req.query, idTienda, idCliente);
  const [[debts], [movementRows], [movementCountRows], [debtSummaryRows], [paymentSummaryRows], [saleSummaryRows]] = await Promise.all([
    pool.query(
      `SELECT f.idFiado, f.idVenta, f.fechaInicio, f.fechaVencimiento, f.fechaPrometidaPago,
              f.totalFiado, f.totalPagado, f.saldoPendiente, f.estado, f.activo, f.cerradoEn,
              v.codigoComprobante, v.fecha fechaVenta, v.total totalVenta
       FROM fiado f LEFT JOIN venta v ON v.idTienda=f.idTienda AND v.idVenta=f.idVenta
       WHERE ${debtConditions.join(' AND ')} ORDER BY f.fechaInicio DESC, f.idFiado DESC`,
      debtParams
    ),
    pool.query(
      `SELECT * FROM (${movementSql}) movimientos
       ORDER BY fecha DESC, tipoOrden DESC, ordenId DESC LIMIT ? OFFSET ?`,
      [...movementParams, limit, offset]
    ),
    pool.query(`SELECT COUNT(*) total FROM (${movementSql}) movimientos`, movementParams),
    pool.query(`SELECT COUNT(*) cantidad, COALESCE(SUM(f.totalFiado),0) total
      FROM fiado f LEFT JOIN venta v ON v.idTienda=f.idTienda AND v.idVenta=f.idVenta
      WHERE ${debtConditions.join(' AND ')}`, debtParams),
    pool.query(`SELECT COUNT(*) cantidad, COALESCE(SUM(pf.monto),0) total
      FROM pagoFiado pf JOIN fiado f ON f.idTienda=pf.idTienda AND f.idFiado=pf.idFiado
      WHERE ${paymentConditions.join(' AND ')}`, paymentParams),
    pool.query(`SELECT COUNT(*) cantidad, COALESCE(SUM(total),0) total
      FROM venta v WHERE ${saleConditions.join(' AND ')}`, saleParams)
  ]);
  const warningDays = Number(snapshot.configuration.diasAvisoVencimiento);
  const debtsWithState = debts.map((debt) => ({ ...debt, estadoCobranza: collectionState(debt, formatLocalDate(), warningDays) }));
  const movements = movementRows.map(({ tipoOrden, ordenId, ...movement }) => movement);
  const payments = movements.filter((movement) => movement.tipo === 'pago').map((movement) => ({
    idPagoFiado: movement.idPagoFiado,
    idFiado: movement.idFiado,
    fechaPago: movement.fecha,
    monto: movement.monto,
    metodoPago: movement.metodoPago,
    referencia: movement.referencia
  }));
  const sales = movements.filter((movement) => movement.tipo === 'venta').map((movement) => ({
    idVenta: movement.idVenta,
    fecha: movement.fecha,
    total: movement.monto,
    saldoPendiente: movement.saldoPendiente,
    estadoPago: movement.estadoPago,
    codigoComprobante: movement.codigoComprobante
  }));
  const total = Number(movementCountRows[0].total || 0);
  res.json({
    cliente: snapshot.summary,
    fiadosAbiertos: debtsWithState.filter((debt) => Number(debt.saldoPendiente) > 0),
    fiadosPagados: debtsWithState.filter((debt) => Number(debt.saldoPendiente) === 0),
    pagos: payments,
    compras: sales,
    movimientos: movements,
    resumenPeriodo: {
      compras: saleSummaryRows[0],
      fiadoGenerado: debtSummaryRows[0],
      pagos: paymentSummaryRows[0]
    },
    paginacion: paginationMetadata(page, limit, total),
    ...paginationMetadata(page, limit, total)
  });
}));

router.get('/clientes/:id', requirePlanFeature('clientes_basico'), asyncRoute(async (req, res) => {
  const idTienda = tenantId(req);
  const idCliente = positiveId(req.params.id, 'El cliente');
  const snapshot = await customerSnapshot(pool, idTienda, idCliente);
  const canReadFollowups = hasFeature(req, 'seguimiento_cobranza');
  const followupRows = canReadFollowups
    ? pool.query(`SELECT s.idSeguimientoCobranza, s.idFiado, s.tipo, s.canal, s.detalle,
        s.fechaCompromiso, s.creadoEn, a.usuario administrador
        FROM seguimientoCobranza s
        JOIN administrador a ON a.idTienda=s.idTienda AND a.idAdministrador=s.idAdministrador
        WHERE s.idTienda=? AND s.idCliente=? ORDER BY s.creadoEn DESC LIMIT ?`,
      [idTienda, idCliente, CUSTOMER_HISTORY_LIMIT])
    : Promise.resolve([[]]);
  const followupCount = canReadFollowups
    ? pool.query('SELECT COUNT(*) total FROM seguimientoCobranza WHERE idTienda=? AND idCliente=?', [idTienda, idCliente])
    : Promise.resolve([[{ total: 0 }]]);
  const [[sales], [payments], [followups], [saleCount], [paymentCount], [followupCountRows]] = await Promise.all([
    pool.query('SELECT idVenta, fecha, total, montoPagado, saldoPendiente, estadoPago, codigoComprobante FROM venta WHERE idTienda=? AND idCliente=? ORDER BY fecha DESC, idVenta DESC LIMIT ?', [idTienda, idCliente, CUSTOMER_HISTORY_LIMIT]),
    pool.query(`SELECT pf.idPagoFiado, pf.idFiado, pf.idCobroFiado, pf.fechaPago, pf.monto, cf.metodoPago,
      a.usuario administrador
      FROM pagoFiado pf JOIN fiado f ON f.idTienda=pf.idTienda AND f.idFiado=pf.idFiado
      JOIN cobroFiado cf ON cf.idTienda=pf.idTienda AND cf.idCobroFiado=pf.idCobroFiado
      LEFT JOIN administrador a ON a.idTienda=cf.idTienda AND a.idAdministrador=cf.idAdministrador
      WHERE f.idTienda=? AND f.idCliente=? ORDER BY pf.fechaPago DESC, pf.idPagoFiado DESC LIMIT ?`,
    [idTienda, idCliente, CUSTOMER_HISTORY_LIMIT]),
    followupRows,
    pool.query('SELECT COUNT(*) total FROM venta WHERE idTienda=? AND idCliente=?', [idTienda, idCliente]),
    pool.query(`SELECT COUNT(*) total FROM pagoFiado pf JOIN fiado f
      ON f.idTienda=pf.idTienda AND f.idFiado=pf.idFiado WHERE f.idTienda=? AND f.idCliente=?`, [idTienda, idCliente]),
    followupCount
  ]);
  const response = {
    cliente: snapshot.summary,
    fiados: snapshot.debts,
    compras: sales,
    pagos: payments,
    permisos: { seguimientoCobranza: canReadFollowups },
    historial: {
      compras: historyMetadata(sales.length, Number(saleCount[0].total || 0)),
      pagos: historyMetadata(payments.length, Number(paymentCount[0].total || 0))
    }
  };
  if (canReadFollowups) {
    response.seguimientos = followups;
    response.historial.seguimientos = historyMetadata(followups.length, Number(followupCountRows[0].total || 0));
  }
  res.json(response);
}));

router.get('/configuracion-credito', asyncRoute(async (req, res) => {
  res.json(publicCreditConfiguration(await getCreditConfiguration(pool, tenantId(req))));
}));

router.put('/configuracion-credito', requirePlanFeature('limites_credito'), asyncRoute(async (req, res) => {
  const configuration = await transaction(async (connection) => {
    const idTienda = tenantId(req);
    const current = await getCreditConfiguration(connection, idTienda, { forUpdate: true });
    const data = normalizeCreditConfiguration(req.body, current);
    const now = formatLocalDateTime();
    await connection.query(
      `UPDATE configuracionCreditoTienda
       SET limiteCreditoDefault=?, diasCreditoDefault=?, diasAvisoVencimiento=?,
           politicaFiadoVencido=?, requiereTelefonoParaFiado=?, permiteFiadoSinFecha=?,
           codigoPaisWhatsApp=?, actualizadoEn=?, idAdministradorActualiza=?
       WHERE idTienda=?`,
      [data.limiteCreditoDefaultCents === null ? null : centsToDecimal(data.limiteCreditoDefaultCents),
        data.diasCreditoDefault, data.diasAvisoVencimiento, data.politicaFiadoVencido,
        data.requiereTelefonoParaFiado, data.permiteFiadoSinFecha, data.codigoPaisWhatsApp,
        now, req.session.admin.id, idTienda]
    );
    return getCreditConfiguration(connection, idTienda);
  });
  res.json({ message: 'Configuracion de credito actualizada.', configuracion: publicCreditConfiguration(configuration) });
}));

async function listDebts(req, res, forcedActive = null) {
  const legacyResponse = !['pagina', 'page', 'limite', 'limit'].some((key) => req.query[key] !== undefined);
  const { page, limit, offset } = legacyResponse
    ? { page: 1, limit: 500, offset: 0 }
    : pagination(req.query);
  const configuration = await getCreditConfiguration(pool, tenantId(req));
  const { effectiveDate, params, today, warningThrough, where } = buildDebtFilter(
    req.query,
    tenantId(req),
    configuration,
    { forcedActive, allowStored: true }
  );
  const [[rows], [summaryRows]] = await Promise.all([
    pool.query(
      `SELECT f.idFiado, f.idCliente, f.idVenta, f.fechaInicio, f.fechaVencimiento,
              f.fechaPrometidaPago, f.totalFiado, f.totalPagado, f.saldoPendiente,
              f.estado, f.activo, f.cerradoEn, c.nombre cliente, c.telefono,
              c.activo clienteActivo, c.eliminadoEn clienteEliminadoEn,
              c.aceptaRecordatorios, c.canalPreferido,
              v.codigoComprobante, v.fecha fechaVenta
       FROM fiado f JOIN cliente c ON c.idTienda=f.idTienda AND c.idCliente=f.idCliente
       LEFT JOIN venta v ON v.idTienda=f.idTienda AND v.idVenta=f.idVenta
       WHERE ${where}
       ORDER BY ${effectiveDate} IS NULL, ${effectiveDate}, f.fechaInicio, f.idFiado
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    ),
    pool.query(collectionSummarySql(where), [today, today, today, warningThrough, warningThrough, ...params])
  ]);
  const debts = rows.map((row) => ({
      ...row,
      aceptaRecordatorios: Boolean(row.aceptaRecordatorios),
      clienteActivo: Boolean(row.clienteActivo),
      estadoCobranza: collectionState(row, today, Number(configuration.diasAvisoVencimiento)),
      fechaEfectiva: effectiveDebtDate(row),
      diasRestantes: effectiveDebtDate(row) ? Math.max(0, daysBetweenLocalDates(today, effectiveDebtDate(row))) : null,
      diasAtraso: effectiveDebtDate(row) ? Math.max(0, -daysBetweenLocalDates(today, effectiveDebtDate(row))) : null
    }));
  const total = Number(summaryRows[0].total || 0);
  res.json(legacyResponse ? debts : {
    fiados: debts,
    resumen: publicCollectionSummary(summaryRows[0]),
    paginacion: paginationMetadata(page, limit, total),
    ...paginationMetadata(page, limit, total)
  });
}

router.get('/fiados/activos', requirePlanFeature('fiados_basico'), asyncRoute((req, res) => listDebts(req, res, 1)));
router.get('/fiados/ocultos', requirePlanFeature('fiados_basico'), asyncRoute((req, res) => listDebts(req, res, 0)));
router.get('/fiados', requirePlanFeature('fiados_basico'), asyncRoute((req, res) => listDebts(req, res)));

router.get(
  '/fiados/exportacion.xlsx',
  requireExportSubscription,
  requirePlanFeature('fiados_basico'),
  requirePlanFeature('exportacion_clientes_fiados'),
  asyncRoute(async (req, res) => {
    const result = await exportDebts(pool, tenantId(req), req.query);
    sendWorkbook(res, result);
  })
);

router.get('/fiados/:id', requirePlanFeature('fiados_basico'), asyncRoute(async (req, res) => {
  const idTienda = tenantId(req);
  const idFiado = positiveId(req.params.id, 'El fiado');
  const canReadFollowups = hasFeature(req, 'seguimiento_cobranza');
  const followupRows = canReadFollowups
    ? pool.query(`SELECT idSeguimientoCobranza, tipo, canal, detalle, fechaCompromiso, creadoEn
        FROM seguimientoCobranza WHERE idTienda=? AND idFiado=?
        ORDER BY creadoEn DESC, idSeguimientoCobranza DESC LIMIT ?`,
      [idTienda, idFiado, CUSTOMER_HISTORY_LIMIT])
    : Promise.resolve([[]]);
  const followupCountRows = canReadFollowups
    ? pool.query('SELECT COUNT(*) total FROM seguimientoCobranza WHERE idTienda=? AND idFiado=?', [idTienda, idFiado])
    : Promise.resolve([[{ total: 0 }]]);
  const [[debts], [payments], [details], [followups], [paymentCounts], [followupCounts]] = await Promise.all([
    pool.query(`SELECT f.*, c.nombre cliente, c.telefono, c.activo clienteActivo,
      c.eliminadoEn clienteEliminadoEn, v.codigoComprobante, v.fecha fechaVenta
      FROM fiado f JOIN cliente c ON c.idTienda=f.idTienda AND c.idCliente=f.idCliente
      LEFT JOIN venta v ON v.idTienda=f.idTienda AND v.idVenta=f.idVenta
      WHERE f.idTienda=? AND f.idFiado=?`, [idTienda, idFiado]),
    pool.query(`SELECT pf.idPagoFiado, pf.fechaPago, pf.monto, pf.observacion,
      cf.idCobroFiado, cf.metodoPago, cf.montoRecibido, cf.cambio, cf.referencia,
      a.usuario administrador
      FROM pagoFiado pf JOIN cobroFiado cf ON cf.idTienda=pf.idTienda AND cf.idCobroFiado=pf.idCobroFiado
      LEFT JOIN administrador a ON a.idTienda=cf.idTienda AND a.idAdministrador=cf.idAdministrador
      WHERE pf.idTienda=? AND pf.idFiado=?
      ORDER BY pf.fechaPago DESC, pf.idPagoFiado DESC LIMIT ?`, [idTienda, idFiado, CUSTOMER_HISTORY_LIMIT]),
    pool.query(`SELECT dv.idDetalleVenta, dv.idProducto, p.nombre producto, dv.cantidad,
      dv.presentacionVenta, dv.precioVenta, dv.subtotal
      FROM fiado f JOIN detalleVenta dv ON dv.idTienda=f.idTienda AND dv.idVenta=f.idVenta
      JOIN producto p ON p.idTienda=dv.idTienda AND p.idProducto=dv.idProducto
      WHERE f.idTienda=? AND f.idFiado=?`, [idTienda, idFiado]),
    followupRows,
    pool.query('SELECT COUNT(*) total FROM pagoFiado WHERE idTienda=? AND idFiado=?', [idTienda, idFiado]),
    followupCountRows
  ]);
  if (!debts.length) throw creditError(404, 'Fiado no encontrado.');
  const configuration = await getCreditConfiguration(pool, idTienda);
  const response = {
    fiado: {
      ...debts[0],
      clienteActivo: Boolean(debts[0].clienteActivo),
      estadoCobranza: collectionState(debts[0], formatLocalDate(), Number(configuration.diasAvisoVencimiento))
    },
    pagos: payments,
    detalle: details,
    permisos: { seguimientoCobranza: canReadFollowups },
    historial: {
      pagos: historyMetadata(payments.length, Number(paymentCounts[0].total || 0))
    }
  };
  if (canReadFollowups) {
    response.seguimientos = followups;
    response.historial.seguimientos = historyMetadata(followups.length, Number(followupCounts[0].total || 0));
  }
  res.json(response);
}));

async function specificPayment(req, res, idFiado) {
  const result = await collectSpecificDebt({
    idTienda: tenantId(req),
    idAdministrador: req.session.admin.id,
    idFiado,
    body: req.body
  });
  res.status(result.repetido ? 200 : 201).json({
    message: result.repetido ? 'El cobro ya habia sido registrado.' : 'Cobro registrado.',
    ...result
  });
}

router.post('/fiados/:id/pagos', requirePlanFeature('pagos_fiado'), asyncRoute((req, res) => specificPayment(req, res, req.params.id)));
router.post('/pagos-fiado', requirePlanFeature('pagos_fiado'), asyncRoute((req, res) => specificPayment(req, res, req.body?.idFiado)));

router.post('/pagos-fiado/cliente', requirePlanFeature('pagos_fiado'), asyncRoute(async (req, res) => {
  const result = await collectCustomerDebt({
    idTienda: tenantId(req),
    idAdministrador: req.session.admin.id,
    idCliente: req.body?.idCliente,
    body: req.body
  });
  res.status(result.repetido ? 200 : 201).json({
    message: result.repetido ? 'El cobro ya habia sido registrado.' : 'Cobro acumulado registrado.',
    ...result
  });
}));

router.patch('/fiados/:id/fecha-prometida', requirePlanFeature('seguimiento_cobranza'), asyncRoute(async (req, res) => {
  const result = await transaction(async (connection) => {
    const idTienda = tenantId(req);
    const idFiado = positiveId(req.params.id, 'El fiado');
    const [rows] = await connection.query(
      `SELECT idFiado, idCliente, saldoPendiente, fechaPrometidaPago
       FROM fiado WHERE idTienda=? AND idFiado=? FOR UPDATE`,
      [idTienda, idFiado]
    );
    if (!rows.length) throw creditError(404, 'Fiado no encontrado.');
    if (moneyToCents(rows[0].saldoPendiente, 'El saldo') === 0) throw creditError(409, 'El fiado ya esta pagado.');
    const clear = req.body?.limpiarFechaPrometida === true;
    const detail = cleanText(req.body?.detalle, 2000, { required: true });
    const channel = String(req.body?.canal || 'ninguno').toLowerCase();
    if (!FOLLOWUP_CHANNELS.has(channel)) throw creditError(400, 'El canal no es valido.');
    const promisedDate = clear ? null : parseLocalDate(req.body?.fechaPrometidaPago, 'La fecha prometida', { allowNull: false });
    if (promisedDate && promisedDate < formatLocalDate()) throw creditError(400, 'La fecha prometida no puede ser anterior a hoy.');
    await connection.query(
      'UPDATE fiado SET fechaPrometidaPago=? WHERE idTienda=? AND idFiado=?',
      [promisedDate, idTienda, idFiado]
    );
    await connection.query(
      `INSERT INTO seguimientoCobranza
       (idTienda,idCliente,idFiado,tipo,canal,detalle,fechaCompromiso,creadoEn,idAdministrador)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [idTienda, rows[0].idCliente, idFiado, clear ? 'nota' : 'compromiso_pago', channel,
        detail, promisedDate, formatLocalDateTime(), req.session.admin.id]
    );
    return { fechaPrometidaPago: promisedDate };
  });
  res.json({ message: 'Fecha prometida actualizada.', ...result });
}));

router.get('/cobranza/alertas', requirePlanFeature('recordatorios_fiado'), asyncRoute(async (req, res) => {
  const { page, limit, offset } = pagination(req.query);
  const idTienda = tenantId(req);
  const configuration = await getCreditConfiguration(pool, idTienda);
  const { conditions, params, today, warningThrough } = buildDebtFilter(
    req.query,
    idTienda,
    configuration,
    { allowStored: false }
  );
  conditions.push('f.saldoPendiente>0');
  const where = conditions.join(' AND ');
  const [[rows], [summaryRows]] = await Promise.all([
    pool.query(
      `SELECT f.idFiado, f.idCliente, f.fechaVencimiento, f.fechaPrometidaPago,
              f.saldoPendiente, c.nombre cliente, c.telefono, c.telefonoNormalizado,
              c.activo clienteActivo, c.eliminadoEn clienteEliminadoEn,
              c.aceptaRecordatorios, c.canalPreferido
       FROM fiado f JOIN cliente c ON c.idTienda=f.idTienda AND c.idCliente=f.idCliente
       WHERE ${where}
       ORDER BY COALESCE(f.fechaPrometidaPago,f.fechaVencimiento) IS NULL,
                COALESCE(f.fechaPrometidaPago,f.fechaVencimiento), f.idFiado
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    ),
    pool.query(collectionSummarySql(where), [today, today, today, warningThrough, warningThrough, ...params])
  ]);
  const alerts = rows.map((row) => {
    const effectiveDate = effectiveDebtDate(row);
    const difference = effectiveDate ? daysBetweenLocalDates(today, effectiveDate) : null;
    return {
      ...row,
      aceptaRecordatorios: Boolean(row.aceptaRecordatorios),
      clienteActivo: Boolean(row.clienteActivo),
      fechaEfectiva: effectiveDate,
      estadoCobranza: collectionState(row, today, Number(configuration.diasAvisoVencimiento)),
      diasRestantes: difference === null ? null : Math.max(0, difference),
      diasAtraso: difference === null ? null : Math.max(0, -difference)
    };
  });
  const total = Number(summaryRows[0].total || 0);
  res.json({
    alertas: alerts,
    resumen: publicCollectionSummary(summaryRows[0]),
    paginacion: paginationMetadata(page, limit, total),
    ...paginationMetadata(page, limit, total)
  });
}));

router.get('/cobranza/seguimientos', requirePlanFeature('seguimiento_cobranza'), asyncRoute(async (req, res) => {
  const { page, limit, offset } = pagination(req.query);
  const conditions = ['s.idTienda=?'];
  const params = [tenantId(req)];
  for (const [queryName, column, label] of [
    ['cliente', 's.idCliente', 'El cliente'], ['fiado', 's.idFiado', 'El fiado']
  ]) {
    if (req.query[queryName]) { conditions.push(`${column}=?`); params.push(positiveId(req.query[queryName], label)); }
  }
  if (req.query.tipo) {
    const type = String(req.query.tipo).toLowerCase();
    if (!FOLLOWUP_TYPES.has(type)) throw creditError(400, 'El tipo de seguimiento no es valido.');
    conditions.push('s.tipo=?'); params.push(type);
  }
  if (req.query.canal) {
    const channel = String(req.query.canal).toLowerCase();
    if (!FOLLOWUP_CHANNELS.has(channel)) throw creditError(400, 'El canal no es valido.');
    conditions.push('s.canal=?'); params.push(channel);
  }
  const from = req.query.fechaDesde
    ? parseLocalDate(req.query.fechaDesde, 'La fecha inicial', { allowNull: false }) : null;
  const to = req.query.fechaHasta
    ? parseLocalDate(req.query.fechaHasta, 'La fecha final', { allowNull: false }) : null;
  if (from && to && from > to) throw creditError(400, 'La fecha inicial debe ser anterior a la final.');
  if (from) { conditions.push('s.creadoEn>=?'); params.push(`${from} 00:00:00`); }
  if (to) { conditions.push('s.creadoEn<?'); params.push(`${addOneDay(to)} 00:00:00`); }
  const where = conditions.join(' AND ');
  const [[rows], [countRows]] = await Promise.all([
    pool.query(
      `SELECT s.idSeguimientoCobranza, s.idCliente, s.idFiado, s.tipo, s.canal,
              s.detalle, s.fechaCompromiso, s.creadoEn, c.nombre cliente, a.usuario administrador
       FROM seguimientoCobranza s
       JOIN cliente c ON c.idTienda=s.idTienda AND c.idCliente=s.idCliente
       JOIN administrador a ON a.idTienda=s.idTienda AND a.idAdministrador=s.idAdministrador
       WHERE ${where} ORDER BY s.creadoEn DESC, s.idSeguimientoCobranza DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    ),
    pool.query(`SELECT COUNT(*) total FROM seguimientoCobranza s WHERE ${where}`, params)
  ]);
  const total = Number(countRows[0].total || 0);
  res.json({
    seguimientos: rows,
    paginacion: paginationMetadata(page, limit, total),
    ...paginationMetadata(page, limit, total)
  });
}));

router.post('/cobranza/seguimientos', requirePlanFeature('seguimiento_cobranza'), asyncRoute(async (req, res) => {
  const result = await transaction(async (connection) => {
    const idTienda = tenantId(req);
    const idCliente = positiveId(req.body?.idCliente, 'El cliente');
    await lockCustomer(connection, idTienda, idCliente);
    const idFiado = req.body?.idFiado ? positiveId(req.body.idFiado, 'El fiado') : null;
    const type = String(req.body?.tipo || '').toLowerCase();
    const channel = String(req.body?.canal || 'ninguno').toLowerCase();
    if (!FOLLOWUP_TYPES.has(type)) throw creditError(400, 'El tipo de seguimiento no es valido.');
    if (!FOLLOWUP_CHANNELS.has(channel)) throw creditError(400, 'El canal no es valido.');
    const detail = cleanText(req.body?.detalle, 2000, { required: true });
    const commitmentDate = type === 'compromiso_pago'
      ? parseLocalDate(req.body?.fechaCompromiso, 'La fecha de compromiso', { allowNull: false })
      : parseLocalDate(req.body?.fechaCompromiso, 'La fecha de compromiso');
    if (commitmentDate && commitmentDate < formatLocalDate()) throw creditError(400, 'La fecha de compromiso no puede ser anterior a hoy.');
    if (idFiado) {
      const [debts] = await connection.query(
        'SELECT saldoPendiente FROM fiado WHERE idTienda=? AND idCliente=? AND idFiado=? FOR UPDATE',
        [idTienda, idCliente, idFiado]
      );
      if (!debts.length) throw creditError(404, 'Fiado no encontrado para el cliente.');
      if (type === 'compromiso_pago') {
        if (moneyToCents(debts[0].saldoPendiente, 'El saldo') === 0) throw creditError(409, 'El fiado ya esta pagado.');
        await connection.query(
          'UPDATE fiado SET fechaPrometidaPago=? WHERE idTienda=? AND idFiado=?',
          [commitmentDate, idTienda, idFiado]
        );
      }
    } else if (type === 'compromiso_pago') {
      throw creditError(400, 'Un compromiso de pago debe indicar el fiado.');
    }
    const [insert] = await connection.query(
      `INSERT INTO seguimientoCobranza
       (idTienda,idCliente,idFiado,tipo,canal,detalle,fechaCompromiso,creadoEn,idAdministrador)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [idTienda, idCliente, idFiado, type, channel, detail, commitmentDate,
        formatLocalDateTime(), req.session.admin.id]
    );
    return { idSeguimientoCobranza: insert.insertId };
  });
  res.status(201).json({ message: 'Seguimiento registrado.', ...result });
}));

router.get('/plantillas-cobranza', requirePlanFeature('recordatorios_fiado'), asyncRoute(async (req, res) => {
  res.json(await listTemplates(pool, tenantId(req), req.query));
}));

router.post('/plantillas-cobranza', requirePlanFeature('recordatorios_fiado'), asyncRoute(async (req, res) => {
  const plantilla = await transaction((connection) => createTemplate(connection, {
    idTienda: tenantId(req),
    idAdministrador: req.session.admin.id,
    body: req.body
  }));
  res.status(201).json({ message: 'Plantilla creada.', plantilla });
}));

router.patch('/plantillas-cobranza/:id', requirePlanFeature('recordatorios_fiado'), asyncRoute(async (req, res) => {
  const plantilla = await transaction((connection) => updateTemplate(connection, {
    idTienda: tenantId(req),
    idAdministrador: req.session.admin.id,
    idPlantilla: req.params.id,
    body: req.body
  }));
  res.json({ message: 'Plantilla actualizada.', plantilla });
}));

async function changeTemplateState(req, res, active) {
  const plantilla = await transaction((connection) => setTemplateActive(connection, {
    idTienda: tenantId(req),
    idAdministrador: req.session.admin.id,
    idPlantilla: req.params.id,
    active
  }));
  res.json({ message: active ? 'Plantilla activada.' : 'Plantilla desactivada.', plantilla });
}

router.patch('/plantillas-cobranza/:id/activar', requirePlanFeature('recordatorios_fiado'),
  asyncRoute((req, res) => changeTemplateState(req, res, true)));
router.patch('/plantillas-cobranza/:id/desactivar', requirePlanFeature('recordatorios_fiado'),
  asyncRoute((req, res) => changeTemplateState(req, res, false)));

async function collectionReceipt(req, res) {
  res.json(await getCollectionReceipt(pool, tenantId(req), req.params.id));
}

router.get('/cobros-fiado/:id', requirePlanFeature('pagos_fiado'), asyncRoute(collectionReceipt));
router.get('/cobros-fiado/:id/comprobante', requirePlanFeature('pagos_fiado'), asyncRoute(collectionReceipt));

router.post('/cobranza/mensaje-whatsapp/preparar', requirePlanFeature('recordatorios_fiado'), asyncRoute(async (req, res) => {
  const idTienda = tenantId(req);
  const idCobroFiado = req.body?.idCobroFiado
    ? positiveId(req.body.idCobroFiado, 'El cobro') : null;
  const receipt = idCobroFiado ? await getCollectionReceipt(pool, idTienda, idCobroFiado) : null;
  const idCliente = receipt?.cliente.idCliente || positiveId(req.body?.idCliente, 'El cliente');
  if (receipt && req.body?.idCliente && Number(req.body.idCliente) !== Number(idCliente)) {
    throw creditError(404, 'Cobro no encontrado para el cliente.', 'COBRO_NO_ENCONTRADO');
  }
  const idFiado = req.body?.idFiado ? positiveId(req.body.idFiado, 'El fiado') : null;
  const configuration = await getCreditConfiguration(pool, idTienda);
  const [[customers], [stores]] = await Promise.all([
    pool.query('SELECT idCliente,nombre,telefono,telefonoNormalizado,aceptaRecordatorios FROM cliente WHERE idTienda=? AND idCliente=?', [idTienda, idCliente]),
    pool.query('SELECT nombre FROM tienda WHERE idTienda=?', [idTienda])
  ]);
  if (!customers.length) throw creditError(404, 'Cliente no encontrado.');
  const customer = customers[0];
  if (!customer.aceptaRecordatorios) throw creditError(409, 'El cliente no acepta recordatorios.');
  let debt = null;
  if (idFiado) {
    const [debts] = await pool.query(
      `SELECT idFiado,idCliente,saldoPendiente,fechaVencimiento,fechaPrometidaPago,idVenta
       FROM fiado WHERE idTienda=? AND idFiado=? AND idCliente=?`,
      [idTienda, idFiado, idCliente]
    );
    if (!debts.length) throw creditError(404, 'Fiado no encontrado para el cliente.');
    debt = debts[0];
  }
  const type = String(req.body?.tipoPlantilla || (receipt ? 'confirmacion_pago'
    : (debt && collectionState(debt) === 'vencido' ? 'deuda_vencida' : 'recordatorio_previo')));
  if (receipt && type !== 'confirmacion_pago') {
    throw creditError(409, 'El comprobante solo puede usar una plantilla de confirmacion de pago.', 'PLANTILLA_TIPO_INCORRECTO');
  }
  if (!TEMPLATE_TYPES.includes(type)) throw creditError(400, 'El tipo de plantilla no es valido.', 'PLANTILLA_TIPO_INVALIDO');
  const templateId = req.body?.idPlantillaCobranza ? positiveId(req.body.idPlantillaCobranza, 'La plantilla') : null;
  const template = await resolveActiveTemplate(pool, { idTienda, idPlantilla: templateId, tipo: type });
  const customerSummary = await customerSnapshot(pool, idTienda, idCliente);
  const balance = debt ? Number(debt.saldoPendiente).toFixed(2) : customerSummary.summary.deudaActual;
  const dueDate = debt ? effectiveDebtDate(debt) : null;
  const lateDays = dueDate ? Math.max(0, -daysBetweenLocalDates(formatLocalDate(), dueDate)) : 0;
  let saleReceipt = '';
  if (debt?.idVenta) {
    const [sales] = await pool.query('SELECT codigoComprobante FROM venta WHERE idTienda=? AND idVenta=?', [idTienda, debt.idVenta]);
    saleReceipt = sales[0]?.codigoComprobante || '';
  }
  const values = {
    tienda: stores[0]?.nombre || 'La tienda', cliente: customer.nombre, saldo: `Bs ${balance}`,
    telefono: customer.telefono || '', fecha: formatLocalDate(),
    vencimiento: dueDate || 'sin fecha', fecha_vencimiento: debt?.fechaVencimiento || 'sin fecha',
    fecha_prometida: debt?.fechaPrometidaPago || 'sin promesa', dias_atraso: String(lateDays),
    comprobante: receipt?.comprobante.numero || saleReceipt,
    monto_pagado: receipt ? `Bs ${Number(receipt.comprobante.montoTotal).toFixed(2)}` : '',
    metodo_pago: receipt?.comprobante.metodoPago || '',
    saldo_restante: receipt ? `Bs ${Number(receipt.comprobante.saldoPosterior).toFixed(2)}` : '',
    referencia: receipt?.comprobante.referencia || '',
    saldo_inicial: '', debitos: '', creditos: '', saldo_final: `Bs ${balance}`, periodo: ''
  };
  const text = renderTemplate(template, values);
  const countryCode = configuration.codigoPaisWhatsApp;
  const normalizedPhone = customer.telefonoNormalizado;
  const phone = countryCode && normalizedPhone
    ? (normalizedPhone.startsWith(countryCode) ? normalizedPhone : `${countryCode}${normalizedPhone}`)
    : null;
  if (req.body?.registrarPreparacion === true) {
    await pool.query(
      `INSERT INTO seguimientoCobranza
       (idTienda,idCliente,idFiado,tipo,canal,detalle,fechaCompromiso,creadoEn,idAdministrador)
       VALUES (?, ?, ?, 'recordatorio_preparado', 'whatsapp', ?, NULL, ?, ?)`,
      [idTienda, idCliente, idFiado, `Recordatorio preparado con plantilla: ${template.nombre}`,
        formatLocalDateTime(), req.session.admin.id]
    );
  }
  res.json({
    texto: text,
    url: phone ? `https://wa.me/${phone}?text=${encodeURIComponent(text)}` : null,
    advertencia: phone ? 'El mensaje esta preparado; el usuario debe confirmar el envio en WhatsApp.'
      : 'No hay codigo de pais y telefono confiables. Copie el texto manualmente.',
    enviado: false,
    plantilla: {
      idPlantillaCobranza: template.idPlantillaCobranza,
      tipo: template.tipo,
      nombre: template.nombre,
      origen: template.origen
    },
    variablesPermitidas: TEMPLATE_VARIABLES[type]
  });
}));

function addOneDay(dateText) {
  return formatLocalDate(addLocalDays(parseBusinessDate(dateText), 1));
}

module.exports = router;
