const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const ExcelJS = require('exceljs');
const mysql = require('mysql2/promise');
const { requireLocalhostDatabase } = require('../config/env');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

class HttpSession {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
    this.cookie = '';
  }

  async fetch(path, options = {}) {
    const request = { ...options, headers: { ...(options.headers || {}) }, redirect: 'manual' };
    if (request.body && typeof request.body !== 'string') {
      request.headers['content-type'] = 'application/json';
      request.body = JSON.stringify(request.body);
    }
    if (this.cookie) request.headers.cookie = this.cookie;
    const response = await fetch(`${this.baseUrl}${path}`, request);
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) this.cookie = setCookie.split(';')[0];
    return response;
  }

  async request(path, options = {}) {
    const response = await this.fetch(path, options);
    const text = await response.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = text; }
    return { status: response.status, body };
  }
}

function safeBody(value) {
  if (Array.isArray(value)) return value.map(safeBody);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !/(password|cookie|session|token|secret|hash)/i.test(key))
    .map(([key, item]) => [key, safeBody(item)]));
}

async function expect(session, path, options, status, label) {
  const response = await session.request(path, options);
  if (response.status !== status) {
    throw new Error(`${label}: se esperaba HTTP ${status}, se obtuvo ${response.status}. Respuesta: ${JSON.stringify(safeBody(response.body))}`);
  }
  return response.body;
}

function pad(value) { return String(value).padStart(2, '0'); }
function dateOnly(date = new Date()) { return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`; }
function dateTime(date) { return `${dateOnly(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`; }

function storePayload(marker, code) {
  const password = `Owner-${code}-${crypto.randomBytes(10).toString('hex')}!`;
  return {
    password,
    body: {
      nombre: `Tienda Finanzas ${code} ${marker}`,
      slug: `tienda-finanzas-${code}-${marker}`,
      estado: 'activa',
      activo: true,
      propietario: { usuario: `owner_fin_${code}_${marker}`, password, confirmacionPassword: password, activo: true },
      suscripcion: { planCodigo: code === 'basico' ? 'basico' : 'avanzado', tipo: 'cortesia', duracionDias: 30 }
    }
  };
}

function productPayload(marker, idProveedor) {
  return {
    nombre: `Producto financiero ${marker}`,
    idProveedor,
    categoria: 'OTROS',
    unidadMedida: 'unidad',
    unidadesPorPaquete: 5,
    paquetesPorCaja: 1,
    precioVenta: 10,
    precioVentaPaquete: 45,
    stockMinimo: 2,
    stockUnidadesTotal: 30,
    ultimoPrecioCompra: 4,
    permiteVentaPorPaquete: true,
    permiteVentaPorUnidad: true
  };
}

async function scalar(connection, sql, params = []) {
  const [[row]] = await connection.query(sql, params);
  return Number(row.total || 0);
}

async function cleanupStore(connection, idTienda) {
  await connection.query('DELETE FROM cierreCaja WHERE idTienda=?', [idTienda]);
  await connection.query('DELETE FROM gasto WHERE idTienda=?', [idTienda]);
  await connection.query('DELETE FROM categoriaGasto WHERE idTienda=?', [idTienda]);
  await connection.query('DELETE FROM movimientoStock WHERE idTienda=?', [idTienda]);
  await connection.query('DELETE FROM pagoVenta WHERE idTienda=?', [idTienda]);
  await connection.query('DELETE FROM pagoFiado WHERE idTienda=?', [idTienda]);
  await connection.query('DELETE FROM detalleFiado WHERE idTienda=?', [idTienda]);
  await connection.query('DELETE FROM detalleVenta WHERE idTienda=?', [idTienda]);
  await connection.query('DELETE FROM detalleCompra WHERE idTienda=?', [idTienda]);
  await connection.query('DELETE FROM fiado WHERE idTienda=?', [idTienda]);
  await connection.query('DELETE FROM venta WHERE idTienda=?', [idTienda]);
  await connection.query('DELETE FROM compra WHERE idTienda=?', [idTienda]);
  await connection.query('DELETE FROM producto WHERE idTienda=?', [idTienda]);
  await connection.query('DELETE FROM cliente WHERE idTienda=?', [idTienda]);
  await connection.query('DELETE FROM proveedor WHERE idTienda=?', [idTienda]);
  await connection.query('DELETE FROM configuracionInventarioTienda WHERE idTienda=?', [idTienda]);
  await connection.query('DELETE FROM suscripcionTienda WHERE idTienda=?', [idTienda]);
  await connection.query('DELETE FROM administrador WHERE idTienda=?', [idTienda]);
  await connection.query('DELETE FROM tienda WHERE idTienda=?', [idTienda]);
}

async function cleanup(connection, fixture) {
  if (!connection) return;
  const [found] = await connection.query('SELECT idTienda FROM tienda WHERE slug LIKE ?', [`tienda-finanzas-%-${fixture.marker}`]);
  const storeIds = new Set([fixture.advancedStore, fixture.basicStore, ...found.map((row) => row.idTienda)].filter(Boolean));
  for (const idTienda of storeIds) {
    await cleanupStore(connection, idTienda);
  }
  if (fixture.superUser) await connection.query('DELETE FROM administrador WHERE usuario=?', [fixture.superUser]);
}

async function main() {
  const config = { ...requireLocalhostDatabase('La prueba de reportes financieros'), decimalNumbers: true };
  if (!/(prueba|test)/i.test(config.database)) throw new Error('La prueba requiere una base local cuyo nombre contenga prueba o test.');
  const baseUrl = process.env.TEST_BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
  const testTarget = new URL(baseUrl);
  if (!['localhost', '127.0.0.1', '::1'].includes(testTarget.hostname)) {
    throw new Error('La prueba HTTP solo puede ejecutarse contra localhost.');
  }
  const marker = crypto.randomBytes(6).toString('hex');
  const fixture = { marker, superUser: `super_fin_${marker}` };
  const superPassword = `Super-${crypto.randomBytes(12).toString('hex')}!`;
  let connection;

  try {
    connection = await mysql.createConnection(config);
    assert(await scalar(connection, "SELECT COUNT(*) total FROM schema_migrations WHERE nombre='009_finanzas_reportes_caja.sql'") === 1,
      'La migracion 009 debe estar aplicada.');
    const hash = await bcrypt.hash(superPassword, 12);
    await connection.query(
      "INSERT INTO administrador (idTienda, usuario, password, rol, activo) VALUES (NULL, ?, ?, 'superadmin', 1)",
      [fixture.superUser, hash]
    );

    const superSession = new HttpSession(baseUrl);
    const advanced = new HttpSession(baseUrl);
    const basic = new HttpSession(baseUrl);
    await expect(superSession, '/auth/login', { method: 'POST', body: { usuario: fixture.superUser, password: superPassword } }, 200, 'Login superadmin');
    const advancedStore = storePayload(marker, 'avanzado');
    const basicStore = storePayload(marker, 'basico');
    const createdAdvanced = await expect(superSession, '/api/admin/tiendas', { method: 'POST', body: advancedStore.body }, 201, 'Crear tienda avanzada');
    const createdBasic = await expect(superSession, '/api/admin/tiendas', { method: 'POST', body: basicStore.body }, 201, 'Crear tienda basica');
    fixture.advancedStore = createdAdvanced.tienda.idTienda;
    fixture.basicStore = createdBasic.tienda.idTienda;
    fixture.advancedSubscription = createdAdvanced.suscripcion.idSuscripcion;
    await expect(advanced, '/auth/login', { method: 'POST', body: { usuario: advancedStore.body.propietario.usuario, password: advancedStore.password } }, 200, 'Login avanzado');
    await expect(basic, '/auth/login', { method: 'POST', body: { usuario: basicStore.body.propietario.usuario, password: basicStore.password } }, 200, 'Login basico');
    await expect(superSession, '/api/gastos/categorias', {}, 403, 'Superadmin bloqueado de gastos');
    await expect(basic, '/api/caja/cierres', {}, 403, 'Cierre bloqueado en plan basico');
    await expect(basic, `/api/reportes/finanzas/rentabilidad-productos?periodo=hoy`, {}, 403, 'Rentabilidad bloqueada en plan basico');

    const financialSetupStartedAt = new Date(Date.now() - 1000);
    const categories = await expect(advanced, '/api/gastos/categorias', {}, 200, 'Categorias iniciales');
    assert(categories.length >= 8, 'La tienda nueva no recibio categorias iniciales.');
    const category = categories[0];
    await expect(advanced, '/api/gastos/categorias', { method: 'POST', body: { nombre: 'Servicios  especiales' } }, 201, 'Crear categoria');
    await expect(advanced, '/api/gastos/categorias', { method: 'POST', body: { nombre: 'servicios especiales' } }, 409, 'Categoria normalizada duplicada');
    const basicCategories = await expect(basic, '/api/gastos/categorias', {}, 200, 'Categorias basicas');
    await expect(basic, '/api/gastos', { method: 'POST', body: {
      idCategoriaGasto: category.idCategoriaGasto, fechaGasto: dateTime(new Date()), concepto: 'Categoria ajena', monto: 1, metodoPago: 'efectivo'
    } }, 404, 'Categoria de otra tienda rechazada');
    const basicExpenseConcept = `Gasto basico no exportable ${marker}`;
    await expect(basic, '/api/gastos', { method: 'POST', body: {
      idCategoriaGasto: basicCategories[0].idCategoriaGasto,
      fechaGasto: dateTime(new Date()),
      concepto: basicExpenseConcept,
      monto: 1,
      metodoPago: 'qr'
    } }, 201, 'Gasto disponible en plan basico');

    const effectiveExpense = await expect(advanced, '/api/gastos', { method: 'POST', body: {
      idCategoriaGasto: category.idCategoriaGasto, fechaGasto: dateTime(new Date()), concepto: '=FORMULA MALICIOSA', monto: 2, metodoPago: 'efectivo'
    } }, 201, 'Crear gasto efectivo');
    const qrExpense = await expect(advanced, '/api/gastos', { method: 'POST', body: {
      idCategoriaGasto: category.idCategoriaGasto, fechaGasto: dateTime(new Date()), concepto: 'Gasto QR', monto: 3, metodoPago: 'qr', referencia: 'QR-PRUEBA'
    } }, 201, 'Crear gasto QR');
    const cancelledExpense = await expect(advanced, '/api/gastos', { method: 'POST', body: {
      idCategoriaGasto: category.idCategoriaGasto, fechaGasto: dateTime(new Date()), concepto: 'Gasto duplicado', monto: 1, metodoPago: 'efectivo'
    } }, 201, 'Crear gasto para anular');
    await expect(advanced, '/api/gastos', { method: 'POST', body: {
      idCategoriaGasto: category.idCategoriaGasto, fechaGasto: dateTime(new Date()), concepto: 'Monto cero', monto: 0, metodoPago: 'efectivo'
    } }, 400, 'Monto cero rechazado');
    await expect(advanced, '/api/gastos', { method: 'POST', body: {
      idCategoriaGasto: category.idCategoriaGasto, fechaGasto: dateTime(new Date()), concepto: 'Monto negativo', monto: -1, metodoPago: 'efectivo'
    } }, 400, 'Monto negativo rechazado');
    await expect(advanced, '/api/gastos', { method: 'POST', body: {
      idCategoriaGasto: category.idCategoriaGasto, fechaGasto: dateTime(new Date()), concepto: '', monto: 1, metodoPago: 'efectivo'
    } }, 400, 'Concepto vacio rechazado');
    await expect(advanced, `/api/gastos/${effectiveExpense.idGasto}`, { method: 'PUT', body: {
      idCategoriaGasto: category.idCategoriaGasto, fechaGasto: dateTime(new Date()), concepto: '=FORMULA ACTUALIZADA', monto: 2, metodoPago: 'efectivo'
    } }, 200, 'Editar gasto');
    await expect(advanced, `/api/gastos/${cancelledExpense.idGasto}/anular`, { method: 'POST', body: { motivo: 'Registro duplicado de prueba' } }, 200, 'Anular gasto');
    await expect(basic, `/api/gastos/${effectiveExpense.idGasto}`, {}, 404, 'Gasto aislado por tienda');

    const providerName = `Proveedor financiero ${marker}`;
    await expect(advanced, '/api/proveedores', { method: 'POST', body: {
      nombre: providerName,
      telefono: '70000000',
      direccion: 'Direccion de prueba'
    } }, 201, 'Crear proveedor financiero');
    const [[provider]] = await connection.query(
      'SELECT idProveedor FROM proveedor WHERE idTienda=? AND nombre=?',
      [fixture.advancedStore, providerName]
    );
    assert(provider?.idProveedor, 'No se pudo recuperar el proveedor financiero creado.');
    const clientName = `Cliente financiero ${marker}`;
    await expect(advanced, '/api/clientes', { method: 'POST', body: {
      nombre: clientName,
      telefono: '71111111'
    } }, 201, 'Crear cliente financiero');
    const [[client]] = await connection.query(
      'SELECT idCliente FROM cliente WHERE idTienda=? AND nombre=?',
      [fixture.advancedStore, clientName]
    );
    assert(client?.idCliente, 'No se pudo recuperar el cliente financiero creado.');
    const product = await expect(advanced, '/api/productos', {
      method: 'POST', body: productPayload(marker, provider.idProveedor)
    }, 201, 'Crear producto con costo');
    const sale = await expect(advanced, '/api/pos/ventas', { method: 'POST', body: {
      claveOperacion: `venta-fin-${marker}`,
      items: [{ idProducto: product.idProducto, cantidad: 1, presentacion: 'unidad' }],
      descuento: 2,
      pagos: [{ metodoPago: 'efectivo', monto: 8 }],
      efectivoRecibido: 10,
      saldoFiado: 0
    } }, 201, 'Venta financiera');
    const [[detailBefore]] = await connection.query(
      'SELECT costoUnitario, subtotalCosto, ganancia, origenCosto FROM detalleVenta WHERE idTienda=? AND idVenta=?',
      [fixture.advancedStore, sale.idVenta]
    );
    assert(detailBefore.origenCosto === 'real' && Number(detailBefore.costoUnitario) === 4 && Number(detailBefore.subtotalCosto) === 4,
      'La venta nueva no congelo el costo historico real.');
    await expect(advanced, '/api/compras', { method: 'POST', body: {
      idProveedor: provider.idProveedor,
      claveOperacion: `compra-fin-${marker}`,
      items: [{ idProducto: product.idProducto, cantidad: 1, presentacion: 'unidad', precioCompra: 9 }]
    } }, 201, 'Registrar compra separada del gasto');
    const [[detailAfter]] = await connection.query(
      'SELECT costoUnitario, subtotalCosto FROM detalleVenta WHERE idTienda=? AND idVenta=?',
      [fixture.advancedStore, sale.idVenta]
    );
    assert(Number(detailAfter.costoUnitario) === 4 && Number(detailAfter.subtotalCosto) === 4,
      'Cambiar el costo vigente altero el costo historico de la venta.');

    const productWithoutCost = await expect(advanced, '/api/productos', {
      method: 'POST', body: { ...productPayload(`${marker} sin costo`, provider.idProveedor), ultimoPrecioCompra: 0 }
    }, 201, 'Crear producto sin costo');
    const packageSale = await expect(advanced, '/api/pos/ventas', { method: 'POST', body: {
      claveOperacion: `venta-paquete-fin-${marker}`,
      items: [{ idProducto: productWithoutCost.idProducto, cantidad: 1, presentacion: 'paquete' }],
      pagos: [{ metodoPago: 'qr', monto: 45, referencia: `QR-${marker}` }],
      saldoFiado: 0
    } }, 201, 'Venta por paquete sin costo conocido');
    const [[packageDetail]] = await connection.query(
      `SELECT cantidadEquivalenteUnidades, subtotalCosto, ganancia, origenCosto
       FROM detalleVenta WHERE idTienda=? AND idVenta=?`,
      [fixture.advancedStore, packageSale.idVenta]
    );
    assert(Number(packageDetail.cantidadEquivalenteUnidades) === 5
      && Number(packageDetail.subtotalCosto) === 0
      && Number(packageDetail.ganancia) === 45
      && packageDetail.origenCosto === 'desconocido',
    'La venta por paquete sin costo no quedo identificada correctamente.');

    const creditSale = await expect(advanced, '/api/pos/ventas', { method: 'POST', body: {
      claveOperacion: `venta-fiada-fin-${marker}`,
      idCliente: client.idCliente,
      items: [{ idProducto: product.idProducto, cantidad: 1, presentacion: 'unidad' }],
      pagos: [],
      saldoFiado: 10
    } }, 201, 'Venta totalmente fiada');
    assert(creditSale.idFiado && Number(creditSale.saldoPendiente) === 10,
      'La venta fiada no creo un unico saldo pendiente.');

    const today = dateOnly();
    const summaryBeforeDebtPayment = await expect(advanced, `/api/reportes/finanzas/resumen?desde=${today}&hasta=${today}`, {}, 200, 'Resumen financiero');
    assert(Number(summaryBeforeDebtPayment.ventasNetas) === 63
      && Number(summaryBeforeDebtPayment.costoVendido) === 13
      && Number(summaryBeforeDebtPayment.gananciaBruta) === 50,
    `Resumen de ventas o costo incorrecto: ${JSON.stringify(safeBody(summaryBeforeDebtPayment))}`);
    assert(Number(summaryBeforeDebtPayment.gastos) === 5 && Number(summaryBeforeDebtPayment.gananciaNeta) === 45,
      'El gasto vigente no se aplico correctamente a la ganancia neta.');
    assert(Number(summaryBeforeDebtPayment.compras) === 9 && summaryBeforeDebtPayment.comprasIncluidasEnFlujo === false,
      'Las compras se mezclaron con gastos o ganancia.');
    assert(Number(summaryBeforeDebtPayment.dineroCobrado) === 53
      && Number(summaryBeforeDebtPayment.fiadoGenerado) === 10
      && Number(summaryBeforeDebtPayment.cuentasPorCobrar) === 10,
    'La venta fiada se confundio con dinero cobrado.');
    assert(Number(summaryBeforeDebtPayment.detallesCostoDesconocido) === 1
      && Number(summaryBeforeDebtPayment.ventasSinCosto) === 45
      && Number(summaryBeforeDebtPayment.gananciaBrutaCalculable) === 5
      && Number(summaryBeforeDebtPayment.gananciaNetaCalculable) === 0
      && summaryBeforeDebtPayment.rentabilidadCompleta === false,
    'El producto sin costo no fue identificado en el resumen.');

    await expect(advanced, '/api/pagos-fiado', { method: 'POST', body: {
      idFiado: creditSale.idFiado,
      monto: 4,
      metodoPago: 'efectivo',
      observacion: 'Cobro financiero de prueba'
    } }, 201, 'Cobro posterior de fiado');
    const summary = await expect(advanced, `/api/reportes/finanzas/resumen?desde=${today}&hasta=${today}`, {}, 200, 'Resumen despues del cobro');
    assert(Number(summary.ventasNetas) === 63 && Number(summary.dineroCobrado) === 57
      && Number(summary.cobrosFiado) === 4 && Number(summary.cuentasPorCobrar) === 6,
    'El cobro de fiado no aumento cobros o altero las ventas.');
    const methods = await expect(advanced, `/api/reportes/finanzas/metodos-pago?desde=${today}&hasta=${today}`, {}, 200, 'Reporte de metodos');
    const methodTotals = Object.fromEntries(methods.filas.map((row) => [row.metodoPago, Number(row.total)]));
    assert(methodTotals.efectivo === 12 && methodTotals.qr === 45,
      `Los metodos de pago no coinciden: ${JSON.stringify(methodTotals)}`);
    const expenseReport = await expect(advanced, `/api/reportes/finanzas/gastos?desde=${today}&hasta=${today}`, {}, 200, 'Gastos por categoria');
    assert(expenseReport.filas.length >= 1 && expenseReport.evolucion.length === 1,
      'El reporte de gastos no incluyo categoria y evolucion temporal.');
    const profitability = await expect(advanced, `/api/reportes/finanzas/rentabilidad-productos?desde=${today}&hasta=${today}`, {}, 200, 'Rentabilidad por producto');
    const unknownProfit = profitability.filas.find((row) => Number(row.idProducto) === Number(productWithoutCost.idProducto));
    assert(unknownProfit && unknownProfit.margenPorcentaje === null && unknownProfit.costoConfiable === false,
      'La rentabilidad con costo desconocido se mostro como exacta.');
    const receivables = await expect(advanced, '/api/reportes/finanzas/cuentas-por-cobrar', {}, 200, 'Cuentas por cobrar');
    assert(Number(receivables.total) === 6, 'El reporte de cuentas por cobrar es incorrecto.');
    const purchases = await expect(advanced, `/api/reportes/finanzas/compras?desde=${today}&hasta=${today}`, {}, 200, 'Compras separadas');
    assert(Number(purchases.total) === 9 && purchases.afectaGananciaNeta === false,
      'El reporte de compras no esta separado de la ganancia.');
    const expensePage = await expect(advanced, `/api/gastos?desde=${today}&hasta=${today}&limit=1`, {}, 200, 'Paginacion de gastos');
    assert(expensePage.gastos.length === 1 && Number(expensePage.total) === 3,
      'La paginacion de gastos es incorrecta.');
    const isolatedSummary = await expect(basic, `/api/reportes/finanzas/resumen?desde=${today}&hasta=${today}`, {}, 200, 'Resumen aislado');
    assert(Number(isolatedSummary.ventasNetas) === 0 && Number(isolatedSummary.gastos) === 1,
      'El resumen basico recibio datos de otra tienda.');
    await expect(advanced, '/api/reportes/finanzas/resumen?desde=2026-02-30&hasta=2026-03-01', {}, 400, 'Rango invalido rechazado');

    const exportResponse = await advanced.fetch(`/api/exportaciones/gastos.xlsx?desde=${today}&hasta=${today}`);
    assert(exportResponse.status === 200, `La exportacion devolvio HTTP ${exportResponse.status}.`);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(await exportResponse.arrayBuffer()));
    const exportedConcepts = [];
    workbook.worksheets[0].eachRow((row, rowNumber) => {
      if (rowNumber > 1) exportedConcepts.push(row.getCell(3).value);
    });
    assert(workbook.worksheets[0].getRow(1).getCell(3).value === 'Concepto',
      'La exportacion no contiene el encabezado esperado.');
    assert(exportedConcepts.some((value) => String(value).startsWith("'=")),
      'La exportacion no neutralizo una formula de Excel.');
    assert(!exportedConcepts.some((value) => String(value).includes(basicExpenseConcept)),
      'La exportacion incluyo datos de otra tienda.');

    const start = financialSetupStartedAt;
    const end = new Date(Date.now() + 1000);
    const closeBody = {
      fechaInicio: dateTime(start), fechaFin: dateTime(end), efectivoInicial: 5,
      efectivoContado: 13, diferencia: 9999,
      observacion: 'Cierre de prueba', claveOperacion: `cierre-${marker}`
    };
    const salesBeforeClose = await scalar(connection, 'SELECT COUNT(*) total FROM venta WHERE idTienda=?', [fixture.advancedStore]);
    const paymentsBeforeClose = await scalar(connection, 'SELECT COUNT(*) total FROM pagoVenta WHERE idTienda=?', [fixture.advancedStore]);
    const calculation = await expect(advanced,
      `/api/caja/cierres/calcular?fechaInicio=${encodeURIComponent(closeBody.fechaInicio)}&fechaFin=${encodeURIComponent(closeBody.fechaFin)}&efectivoInicial=5`,
      {}, 200, 'Calcular cierre');
    const [diagnosticSales] = await connection.query(
      `SELECT idVenta, idTienda, DATE_FORMAT(fecha,'%Y-%m-%d %H:%i:%s') fecha, estadoPago, total
       FROM venta WHERE idTienda=? AND idVenta IN (?, ?, ?) ORDER BY idVenta`,
      [fixture.advancedStore, sale.idVenta, packageSale.idVenta, creditSale.idVenta]
    );
    const [diagnosticSalePayments] = await connection.query(
      `SELECT idPagoVenta, idTienda, idVenta, idPagoFiado, metodoPago, monto,
              DATE_FORMAT(creadoEn,'%Y-%m-%d %H:%i:%s') creadoEn
       FROM pagoVenta WHERE idTienda=? AND idVenta IN (?, ?, ?) ORDER BY idPagoVenta`,
      [fixture.advancedStore, sale.idVenta, packageSale.idVenta, creditSale.idVenta]
    );
    const [diagnosticDebts] = await connection.query(
      `SELECT idFiado, idTienda, idVenta, DATE_FORMAT(fechaInicio,'%Y-%m-%d') fechaInicio,
              estado, totalFiado, saldoPendiente
       FROM fiado WHERE idTienda=? AND idFiado=?`,
      [fixture.advancedStore, creditSale.idFiado]
    );
    const [diagnosticDebtPayments] = await connection.query(
      `SELECT pf.idPagoFiado, pf.idTienda, pf.idFiado, pf.monto,
              DATE_FORMAT(pf.fechaPago,'%Y-%m-%d %H:%i:%s') fechaPago
       FROM pagoFiado pf WHERE pf.idTienda=? AND pf.idFiado=? ORDER BY pf.idPagoFiado`,
      [fixture.advancedStore, creditSale.idFiado]
    );
    const [diagnosticPurchases] = await connection.query(
      `SELECT idCompra, idTienda, total, DATE_FORMAT(fecha,'%Y-%m-%d %H:%i:%s') fecha
       FROM compra WHERE idTienda=? AND claveOperacion=?`,
      [fixture.advancedStore, `compra-fin-${marker}`]
    );
    const [diagnosticExpenses] = await connection.query(
      `SELECT idGasto, idTienda, estado, metodoPago, monto,
              DATE_FORMAT(fechaGasto,'%Y-%m-%d %H:%i:%s') fechaGasto
       FROM gasto WHERE idTienda=? AND idGasto IN (?, ?) ORDER BY idGasto`,
      [fixture.advancedStore, effectiveExpense.idGasto, qrExpense.idGasto]
    );
    console.log(`Diagnostico temporal del cierre: ${JSON.stringify(safeBody({
      rango: { fechaInicio: closeBody.fechaInicio, fechaFin: closeBody.fechaFin },
      ventas: diagnosticSales,
      pagosVenta: diagnosticSalePayments,
      fiados: diagnosticDebts,
      pagosFiado: diagnosticDebtPayments,
      compras: diagnosticPurchases,
      gastos: diagnosticExpenses
    }))}`);
    const expectedClose = {
      efectivoInicial: 5,
      efectivoVentasEsperado: 8,
      efectivoFiadosCobrado: 4,
      gastosEfectivo: 2,
      efectivoEsperado: 15,
      totalQR: 45,
      totalCobrado: 57,
      totalVentas: 63,
      totalFiadoGenerado: 10,
      totalGastos: 5,
      totalCompras: 9
    };
    const receivedClose = Object.fromEntries(Object.keys(expectedClose)
      .map((field) => [field, Number(calculation[field])]));
    const closeDifferences = Object.fromEntries(Object.entries(expectedClose)
      .filter(([field, expected]) => receivedClose[field] !== expected)
      .map(([field, expected]) => [field, { esperado: expected, recibido: receivedClose[field] }]));
    assert(Object.keys(closeDifferences).length === 0,
      `El cierre no separo correctamente sus importes. Esperado: ${JSON.stringify(expectedClose)}. `
      + `Recibido: ${JSON.stringify(receivedClose)}. Diferencias: ${JSON.stringify(closeDifferences)}.`);
    const close = await expect(advanced, '/api/caja/cierres', { method: 'POST', body: closeBody }, 201, 'Crear cierre');
    const [[storedClose]] = await connection.query(
      'SELECT efectivoEsperado, efectivoContado, diferencia FROM cierreCaja WHERE idTienda=? AND idCierreCaja=?',
      [fixture.advancedStore, close.idCierreCaja]
    );
    assert(Number(close.diferencia) === -2
      && Number(storedClose.efectivoEsperado) === 15
      && Number(storedClose.efectivoContado) === 13
      && Number(storedClose.diferencia) === -2,
    'La diferencia del cierre no fue calculada exclusivamente por el backend.');
    assert(await scalar(connection, 'SELECT COUNT(*) total FROM venta WHERE idTienda=?', [fixture.advancedStore]) === salesBeforeClose
      && await scalar(connection, 'SELECT COUNT(*) total FROM pagoVenta WHERE idTienda=?', [fixture.advancedStore]) === paymentsBeforeClose,
    'El cierre modifico ventas o pagos existentes.');
    const repeatedClose = await expect(advanced, '/api/caja/cierres', { method: 'POST', body: closeBody }, 200, 'Reintento idempotente de cierre');
    assert(repeatedClose.repetido === true && Number(repeatedClose.idCierreCaja) === Number(close.idCierreCaja),
      'El reintento del cierre no devolvio el registro existente.');
    await expect(advanced, '/api/caja/cierres', { method: 'POST', body: { ...closeBody, claveOperacion: `cierre-solapado-${marker}` } }, 409, 'Cierre solapado rechazado');
    await expect(basic, `/api/caja/cierres/${close.idCierreCaja}`, {}, 403, 'Cierre inaccesible para plan sin funcion');

    await connection.query(
      "UPDATE suscripcionTienda SET fechaInicio=DATE_SUB(NOW(), INTERVAL 2 DAY), fechaFin=DATE_SUB(NOW(), INTERVAL 1 DAY), estado='activa' WHERE idSuscripcion=?",
      [fixture.advancedSubscription]
    );
    await expect(advanced, `/api/reportes/finanzas/resumen?desde=${today}&hasta=${today}`, {}, 200, 'Lectura financiera vencida');
    await expect(advanced, '/api/gastos', { method: 'POST', body: {
      idCategoriaGasto: category.idCategoriaGasto, fechaGasto: dateTime(new Date()), concepto: 'Bloqueado', monto: 1, metodoPago: 'efectivo'
    } }, 403, 'Gasto bloqueado con suscripcion vencida');
    await expect(advanced, '/api/caja/cierres', { method: 'POST', body: {
      ...closeBody, claveOperacion: `cierre-vencido-${marker}`
    } }, 403, 'Cierre bloqueado con suscripcion vencida');
    await connection.query(
      "UPDATE suscripcionTienda SET fechaInicio=NOW(), fechaFin=DATE_ADD(NOW(), INTERVAL 30 DAY), estado='activa' WHERE idSuscripcion=?",
      [fixture.advancedSubscription]
    );

    assert(await scalar(connection, 'SELECT COUNT(*) total FROM gasto WHERE idTienda=? AND estado=\'registrado\'', [fixture.advancedStore]) === 2,
      'La prueba dejo una cantidad inesperada de gastos vigentes.');
    assert(await scalar(connection, 'SELECT COUNT(*) total FROM cierreCaja WHERE idTienda=? AND estado=\'cerrado\'', [fixture.advancedStore]) === 1,
      'La prueba dejo una cantidad inesperada de cierres vigentes.');
    assert(basicCategories.length >= 8, 'El plan basico no recibio categorias de gasto.');
    console.log('Prueba de finanzas, gastos, exportaciones y caja completada correctamente.');
  } finally {
    if (connection) {
      try { await cleanup(connection, fixture); } finally { await connection.end(); }
    }
  }
}

main().catch((error) => {
  console.error('La prueba de reportes financieros fallo.');
  console.error(error.message);
  process.exit(1);
});
