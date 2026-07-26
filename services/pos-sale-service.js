const pool = require('../config/db');
const {
  insertStockMovement,
  movementKey,
  operationKey,
  stockError
} = require('./stock-movement-service');
const {
  applyLotExit,
  microsToDecimal,
  prepareLotExit
} = require('./lot-service');
const {
  centsToDecimal: creditDecimal,
  lockCustomer,
  recordOverdueCreditConfirmation,
  validateNewCredit
} = require('./customer-credit-service');
const { administrativeAuditService } = require('./administrative-audit-service');
const { formatLocalDate, formatLocalDateTime } = require('../utils/local-datetime');

const SALE_PRESENTATIONS = new Set(['unidad', 'paquete']);
const PAYMENT_METHODS = new Set(['efectivo', 'qr']);
const MAX_SALE_ITEMS = 100;
const MAX_PAYMENT_COMPONENTS = 6;
const MAX_MONEY_CENTS = 9999999999;

function cents(value, label, { allowZero = true } = {}) {
  if (value === null || value === undefined || value === '') {
    if (allowZero) return 0;
    throw stockError(400, `${label} es obligatorio.`);
  }
  const number = Number(value);
  if (!Number.isFinite(number)) throw stockError(400, `${label} no es valido.`);
  const amount = Math.round(number * 100);
  if (amount < 0 || (!allowZero && amount === 0)) {
    throw stockError(400, `${label} debe ser mayor a cero.`);
  }
  if (amount > MAX_MONEY_CENTS) throw stockError(400, `${label} supera el monto permitido.`);
  return amount;
}

function ensureMoneyRange(valueInCents, label) {
  if (!Number.isSafeInteger(valueInCents) || valueInCents < 0 || valueInCents > MAX_MONEY_CENTS) {
    throw stockError(400, `${label} supera el monto permitido.`);
  }
  return valueInCents;
}

function decimal(valueInCents) {
  return (valueInCents / 100).toFixed(2);
}

function positiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    throw stockError(400, `${label} debe ser un numero entero positivo.`);
  }
  return number;
}

function optionalId(value, label) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) throw stockError(400, `${label} no es valido.`);
  return number;
}

function cleanText(value, maximum) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  if (text.length > maximum) throw stockError(400, `El texto no puede superar ${maximum} caracteres.`);
  return text;
}

function normalizeBarcode(value) {
  const barcode = String(value ?? '').trim();
  if (!barcode) return null;
  if (barcode.length > 64 || !/^[A-Za-z0-9._-]+$/.test(barcode)) {
    throw stockError(400, 'El codigo de barras no es valido.');
  }
  return barcode;
}

function saleCode(idTienda, idVenta) {
  return `V-${idTienda}-${String(idVenta).padStart(8, '0')}`;
}

function normalizeItems(items) {
  if (!Array.isArray(items) || !items.length) throw stockError(400, 'Debe agregar al menos un producto.');
  if (items.length > MAX_SALE_ITEMS) throw stockError(400, `Una venta admite como maximo ${MAX_SALE_ITEMS} productos.`);
  const normalized = items.map((item, index) => {
    const idProducto = positiveInteger(item.idProducto, `Producto de la linea ${index + 1}`);
    const cantidad = positiveInteger(item.cantidad, `Cantidad de la linea ${index + 1}`);
    const presentacion = String(item.presentacion || item.presentacionVenta || 'unidad').trim().toLowerCase();
    if (!SALE_PRESENTATIONS.has(presentacion)) throw stockError(400, 'La presentacion de venta no es valida.');
    return { idProducto, cantidad, presentacion, index };
  });
  if (new Set(normalized.map((item) => item.idProducto)).size !== normalized.length) {
    throw stockError(400, 'Cada producto debe aparecer una sola vez en el carrito.');
  }
  return normalized;
}

async function lockAndPriceItems(connection, idTienda, rawItems) {
  const items = normalizeItems(rawItems);
  const locked = [];
  for (const item of [...items].sort((a, b) => a.idProducto - b.idProducto)) {
    const [rows] = await connection.query(
      `SELECT idProducto, nombre, codigoBarras, precioVenta, precioVentaPaquete,
              unidadesPorPaquete, ultimoPrecioCompra, stockUnidadesTotal,
              permiteVentaPorUnidad, permiteVentaPorPaquete, activo,
              controlaLotes, controlaVencimiento, lotesActivadosEn
       FROM producto
       WHERE idProducto=? AND idTienda=? AND activo=1
       FOR UPDATE`,
      [item.idProducto, idTienda]
    );
    if (!rows.length) throw stockError(404, 'Producto no encontrado o inactivo.');
    const product = rows[0];
    if (item.presentacion === 'unidad' && !product.permiteVentaPorUnidad) {
      throw stockError(400, `${product.nombre} no permite venta por unidad.`);
    }
    if (item.presentacion === 'paquete') {
      if (!product.permiteVentaPorPaquete || Number(product.unidadesPorPaquete) <= 1) {
        throw stockError(400, `${product.nombre} no tiene una presentacion por paquete valida.`);
      }
    }
    const units = item.presentacion === 'paquete'
      ? item.cantidad * Number(product.unidadesPorPaquete)
      : item.cantidad;
    if (!Number.isInteger(units) || units <= 0) throw stockError(400, 'La equivalencia de unidades no es valida.');
    if (Number(product.stockUnidadesTotal) < units) {
      throw stockError(400, `Stock insuficiente para ${product.nombre}. Disponible: ${product.stockUnidadesTotal} unidades.`);
    }
    const unitPriceCents = cents(product.precioVenta, `Precio de ${product.nombre}`, { allowZero: false });
    const packagePriceCents = product.precioVentaPaquete === null
      ? unitPriceCents * Number(product.unidadesPorPaquete)
      : cents(product.precioVentaPaquete, `Precio por paquete de ${product.nombre}`, { allowZero: false });
    const priceCents = item.presentacion === 'paquete' ? packagePriceCents : unitPriceCents;
    const lotExit = await prepareLotExit(connection, { idTienda, product, cantidad: units });
    const costUnitCents = lotExit
      ? (lotExit.allCostsKnown ? Math.round(lotExit.totalCostCents / units) : 0)
      : cents(product.ultimoPrecioCompra, `Costo de ${product.nombre}`);
    const subtotalCents = ensureMoneyRange(priceCents * item.cantidad, `Subtotal de ${product.nombre}`);
    const subtotalCostCents = ensureMoneyRange(
      lotExit ? lotExit.totalCostCents : costUnitCents * units,
      `Costo de ${product.nombre}`
    );
    locked.push({
      ...item,
      product,
      lotExit,
      units,
      priceCents,
      costUnitValue: lotExit
        ? (lotExit.allCostsKnown ? microsToDecimal(lotExit.unitCostMicros) : '0.000000')
        : decimal(costUnitCents),
      costSource: lotExit ? (lotExit.allCostsKnown ? 'real' : 'desconocido')
        : (costUnitCents > 0 ? 'real' : 'desconocido'),
      subtotalCents,
      subtotalCostCents
    });
  }
  return locked.sort((a, b) => a.index - b.index);
}

function allocateDiscount(items, discountCents, subtotalCents) {
  let remaining = discountCents;
  return items.map((item, index) => {
    const share = index === items.length - 1
      ? remaining
      : Math.min(remaining, Math.round(discountCents * item.subtotalCents / subtotalCents));
    remaining -= share;
    return { ...item, discountShareCents: share, gainCents: item.subtotalCents - share - item.subtotalCostCents };
  });
}

function normalizePayments(rawPayments, totalCents, legacyType) {
  if ((!Array.isArray(rawPayments) || rawPayments.length === 0) && legacyType === 'pagada' && totalCents > 0) {
    return [{ metodoPago: 'efectivo', montoCents: totalCents, referencia: null }];
  }
  if (!Array.isArray(rawPayments)) return [];
  if (rawPayments.length > MAX_PAYMENT_COMPONENTS) {
    throw stockError(400, `Se permiten como maximo ${MAX_PAYMENT_COMPONENTS} componentes de pago.`);
  }
  const consolidated = new Map();
  rawPayments.forEach((payment) => {
    const metodoPago = String(payment.metodoPago || payment.metodo || '').trim().toLowerCase();
    if (!PAYMENT_METHODS.has(metodoPago)) throw stockError(400, 'El metodo de pago no es valido.');
    const montoCents = cents(payment.monto, 'El monto del pago', { allowZero: false });
    const referencia = metodoPago === 'qr' ? cleanText(payment.referencia, 120) : null;
    const key = `${metodoPago}:${referencia || ''}`;
    const previous = consolidated.get(key);
    consolidated.set(key, previous
      ? { ...previous, montoCents: previous.montoCents + montoCents }
      : { metodoPago, montoCents, referencia });
  });
  const payments = [...consolidated.values()];
  const paidCents = payments.reduce((sum, payment) => sum + payment.montoCents, 0);
  if (paidCents > totalCents) throw stockError(400, 'Los pagos no pueden superar el total de la venta.');
  return payments;
}

function paymentState(totalCents, paidCents) {
  if (paidCents === totalCents) return 'pagada';
  return paidCents > 0 ? 'parcial' : 'pendiente';
}

async function existingSale(connection, idTienda, requestKey) {
  const [rows] = await connection.query(
    `SELECT idVenta, codigoComprobante FROM venta
     WHERE idTienda=? AND claveOperacion=? FOR UPDATE`,
    [idTienda, requestKey]
  );
  return rows[0] || null;
}

async function registerSale({
  idTienda,
  idAdministrador,
  body,
  requestId = null,
  legacyMode = false
}) {
  body = body && typeof body === 'object' ? body : {};
  if (!legacyMode && !String(body.claveOperacion || '').trim()) {
    throw stockError(400, 'La clave de operacion de la venta es obligatoria.');
  }
  const requestKey = operationKey(body.claveOperacion);
  const idCliente = optionalId(body.idCliente, 'El cliente');
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const operationDate = new Date();
    const operationDateTime = formatLocalDateTime(operationDate);
    const [insert] = await connection.query(
      `INSERT INTO venta (idTienda, fecha, total, tipo, idCliente, claveOperacion)
       VALUES (?, ?, 0, 'pagada', NULL, ?)
       ON DUPLICATE KEY UPDATE idVenta=LAST_INSERT_ID(idVenta)`,
      [idTienda, operationDateTime, requestKey]
    );
    const idVenta = insert.insertId;
    const repeated = await existingSale(connection, idTienda, requestKey);
    if (repeated?.codigoComprobante) {
      await connection.commit();
      return { idVenta: repeated.idVenta, codigoComprobante: repeated.codigoComprobante, repetida: true };
    }
    const lockedCustomer = idCliente
      ? await lockCustomer(connection, idTienda, idCliente, { requireActive: true })
      : null;

    const pricedItems = await lockAndPriceItems(connection, idTienda, body.items);
    const subtotalCents = ensureMoneyRange(
      pricedItems.reduce((sum, item) => sum + item.subtotalCents, 0),
      'El subtotal de la venta'
    );
    const discountCents = cents(body.descuento ?? body.descuentoMonto ?? 0, 'El descuento');
    if (discountCents > subtotalCents) throw stockError(400, 'El descuento no puede superar el subtotal.');
    const totalCents = subtotalCents - discountCents;
    const items = allocateDiscount(pricedItems, discountCents, subtotalCents || 1);
    const legacyType = legacyMode ? (body.tipo === 'fiada' ? 'fiada' : 'pagada') : null;
    const payments = normalizePayments(body.pagos, totalCents, legacyType);
    const paidCents = payments.reduce((sum, payment) => sum + payment.montoCents, 0);
    const balanceCents = totalCents - paidCents;
    const state = paymentState(totalCents, paidCents);
    if (balanceCents > 0 && !idCliente) {
      throw stockError(400, 'Las ventas con saldo pendiente requieren un cliente registrado.');
    }
    const creditValidation = balanceCents > 0
      ? await validateNewCredit(connection, {
        idTienda,
        idCliente,
        customer: lockedCustomer,
        newDebt: decimal(balanceCents),
        saleDate: formatLocalDate(operationDate),
        requestedDueDate: body.fechaVencimiento,
        confirmOverdueDebt: body.confirmarDeudaVencida === true,
        overdueReason: body.motivoDeudaVencida
      })
      : null;
    if (body.saldoFiado !== undefined && cents(body.saldoFiado, 'El saldo fiado') !== balanceCents) {
      throw stockError(400, 'El saldo fiado enviado no coincide con los pagos aplicados.');
    }
    const cashPayment = payments.find((payment) => payment.metodoPago === 'efectivo');
    const cashReceivedCents = body.efectivoRecibido === undefined || body.efectivoRecibido === ''
      ? (cashPayment?.montoCents || 0)
      : cents(body.efectivoRecibido, 'El efectivo recibido');
    if (cashPayment && cashReceivedCents < cashPayment.montoCents) {
      throw stockError(400, 'El efectivo recibido no alcanza para el monto aplicado en efectivo.');
    }
    if (!cashPayment && cashReceivedCents > 0) {
      throw stockError(400, 'No se puede calcular cambio sin un pago en efectivo.');
    }
    const changeCents = cashPayment ? cashReceivedCents - cashPayment.montoCents : 0;
    const code = saleCode(idTienda, idVenta);
    const saleType = balanceCents > 0 ? 'fiada' : 'pagada';

    await connection.query(
      `UPDATE venta
       SET subtotal=?, descuento=?, total=?, montoPagado=?, saldoPendiente=?, estadoPago=?,
           tipo=?, idCliente=?, codigoComprobante=?
       WHERE idVenta=? AND idTienda=?`,
      [decimal(subtotalCents), decimal(discountCents), decimal(totalCents), decimal(paidCents),
        decimal(balanceCents), state, saleType, idCliente, code, idVenta, idTienda]
    );

    for (const item of items) {
      const [detail] = await connection.query(
        `INSERT INTO detalleVenta
         (idTienda, idVenta, idProducto, cantidad, precioVenta, costoUnitario, subtotal,
          subtotalCosto, ganancia, origenCosto, presentacionVenta, cantidadEquivalenteUnidades)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [idTienda, idVenta, item.product.idProducto, item.cantidad, decimal(item.priceCents),
          item.costUnitValue, decimal(item.subtotalCents),
          decimal(item.subtotalCostCents), decimal(item.gainCents), item.costSource, item.presentacion, item.units]
      );
      const stockAnterior = Number(item.product.stockUnidadesTotal);
      const stockPosterior = stockAnterior - item.units;
      const [stockUpdate] = await connection.query(
        `UPDATE producto SET stockUnidadesTotal=?, stock=?
         WHERE idProducto=? AND idTienda=? AND activo=1 AND stockUnidadesTotal=?`,
        [stockPosterior, stockPosterior, item.product.idProducto, idTienda, stockAnterior]
      );
      if (!stockUpdate.affectedRows) throw stockError(409, 'El stock cambio durante la venta. Revise el carrito.');
      const idMovimientoStock = await insertStockMovement(connection, {
        idTienda,
        idProducto: item.product.idProducto,
        tipoMovimiento: 'salida',
        origen: 'venta',
        cantidad: -item.units,
        stockAnterior,
        stockPosterior,
        cantidadOperacion: item.cantidad,
        unidadOperacion: item.presentacion,
        motivo: balanceCents > 0 ? 'Salida por venta con saldo pendiente.' : 'Salida por venta pagada.',
        idDetalleVenta: detail.insertId,
        claveOperacion: movementKey('detalle-venta', detail.insertId),
        idAdministrador,
        creadoEn: operationDateTime
      });
      await applyLotExit(connection, {
        prepared: item.lotExit,
        idTienda,
        idProducto: item.product.idProducto,
        idMovimientoStock,
        operation: `sale:${requestKey}`,
        detailIndex: item.index + 1,
        creadoEn: operationDateTime,
        idAdministrador
      });
    }

    for (let index = 0; index < payments.length; index += 1) {
      const payment = payments[index];
      await connection.query(
        `INSERT INTO pagoVenta
         (idTienda, idVenta, metodoPago, monto, montoRecibido, cambio, referencia, claveOperacion, idAdministrador, creadoEn)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [idTienda, idVenta, payment.metodoPago, decimal(payment.montoCents),
          payment.metodoPago === 'efectivo' ? decimal(cashReceivedCents) : null,
          payment.metodoPago === 'efectivo' ? decimal(changeCents) : '0.00', payment.referencia,
          `pos:${idVenta}:pago:${index + 1}`, idAdministrador, operationDateTime]
      );
    }

    let idFiado = null;
    if (balanceCents > 0) {
      const [debt] = await connection.query(
        `INSERT INTO fiado
         (idTienda, idCliente, idVenta, fechaInicio, fechaVencimiento, fechaPrometidaPago,
          observacionCredito, totalFiado, totalPagado, saldoPendiente, estado, cerradoEn,
          idAdministradorCrea)
         VALUES (?, ?, ?, ?, ?, NULL, ?, ?, 0, ?, 'pendiente', NULL, ?)`,
        [idTienda, idCliente, idVenta, formatLocalDate(operationDate), creditValidation.dueDate,
          cleanText(body.observacionCredito, 1000), decimal(balanceCents), decimal(balanceCents), idAdministrador]
      );
      idFiado = debt.insertId;
      await recordOverdueCreditConfirmation(connection, {
        idTienda,
        idCliente,
        idFiado,
        idAdministrador,
        validation: creditValidation,
        createdAt: operationDateTime
      });
    }

    if (requestId) {
      await administrativeAuditService.recordCritical(connection, {
        storeId: idTienda,
        actorType: 'administrador',
        administratorId: idAdministrador,
        action: 'registro_venta',
        result: 'correcto',
        resultCode: 'COMMERCIAL_OPERATION_OK',
        origin: 'web',
        reference: `venta:${idVenta}`,
        requestId,
        after: {
          estadoOperacion: 'vigente',
          estadoPago: paymentState(totalCents, paidCents)
        }
      });
    }
    await connection.commit();
    return {
      idVenta,
      idFiado,
      codigoComprobante: code,
      subtotal: decimal(subtotalCents),
      descuento: decimal(discountCents),
      total: decimal(totalCents),
      montoPagado: decimal(paidCents),
      saldoPendiente: decimal(balanceCents),
      estadoPago: state,
      cambio: decimal(changeCents),
      advertencias: creditValidation?.warnings || [],
      deudaAnterior: creditValidation ? creditDecimal(creditValidation.debtBeforeCents) : null,
      nuevoSaldoFiado: creditValidation ? creditDecimal(creditValidation.newDebtCents) : '0.00',
      deudaPosterior: creditValidation ? creditDecimal(creditValidation.debtAfterCents) : null,
      limiteEfectivo: creditValidation?.limitCents === null || creditValidation === null
        ? null : creditDecimal(creditValidation.limitCents),
      creditoDisponiblePosterior: creditValidation?.availableAfterCents === null || creditValidation === null
        ? null : creditDecimal(creditValidation.availableAfterCents),
      fechaVencimiento: creditValidation?.dueDate || null,
      repetida: false
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function getSaleReceipt(idTienda, idVenta) {
  const [[sales], [details], [payments], [creditConfigurations]] = await Promise.all([
    pool.query(
      `SELECT v.idVenta, v.fecha, v.subtotal, v.descuento, v.total, v.montoPagado,
              v.saldoPendiente, v.estadoPago, v.tipo, v.codigoComprobante,
              c.idCliente, COALESCE(c.nombre, 'Cliente ocasional') cliente, c.telefono, c.telefonoNormalizado,
              t.nombre tienda, f.idFiado, f.saldoPendiente saldoActualFiado, f.estado estadoFiado
       FROM venta v
       JOIN tienda t ON t.idTienda=v.idTienda
       LEFT JOIN cliente c ON c.idTienda=v.idTienda AND c.idCliente=v.idCliente
       LEFT JOIN fiado f ON f.idTienda=v.idTienda AND f.idVenta=v.idVenta
       WHERE v.idTienda=? AND v.idVenta=?`,
      [idTienda, idVenta]
    ),
    pool.query(
      `SELECT d.idDetalleVenta, p.nombre, d.cantidad, d.presentacionVenta,
              d.cantidadEquivalenteUnidades, d.precioVenta, d.subtotal
       FROM detalleVenta d
       JOIN producto p ON p.idTienda=d.idTienda AND p.idProducto=d.idProducto
       WHERE d.idTienda=? AND d.idVenta=? ORDER BY d.idDetalleVenta`,
      [idTienda, idVenta]
    ),
    pool.query(
      `SELECT idPagoVenta, metodoPago, monto, montoRecibido, cambio, referencia, creadoEn
       FROM pagoVenta WHERE idTienda=? AND idVenta=? ORDER BY creadoEn, idPagoVenta`,
      [idTienda, idVenta]
    ),
    pool.query('SELECT codigoPaisWhatsApp FROM configuracionCreditoTienda WHERE idTienda=?', [idTienda])
  ]);
  if (!sales.length) throw stockError(404, 'Venta no encontrada.');
  const receipt = { venta: sales[0], detalle: details, pagos: payments };
  const countryCode = String(creditConfigurations[0]?.codigoPaisWhatsApp || '').replace(/\D/g, '');
  const normalizedPhone = String(sales[0].telefonoNormalizado || '').replace(/\D/g, '');
  if (!countryCode || !normalizedPhone) return { ...receipt, whatsappUrl: null };
  const phone = normalizedPhone.startsWith(countryCode) ? normalizedPhone : `${countryCode}${normalizedPhone}`;
  const lines = [
    sales[0].tienda,
    `Comprobante ${sales[0].codigoComprobante || `Venta #${sales[0].idVenta}`}`,
    `Cliente: ${sales[0].cliente}`,
    ...details.map((item) => `${item.nombre}: ${item.cantidad} ${item.presentacionVenta} - Bs ${Number(item.subtotal).toFixed(2)}`),
    `Total: Bs ${Number(sales[0].total).toFixed(2)}`,
    `Pagado: Bs ${Number(sales[0].montoPagado).toFixed(2)}`,
    `Saldo: Bs ${Number(sales[0].saldoActualFiado ?? sales[0].saldoPendiente).toFixed(2)}`
  ];
  return { ...receipt, whatsappUrl: `https://wa.me/${phone}?text=${encodeURIComponent(lines.join('\n'))}` };
}

module.exports = {
  MAX_SALE_ITEMS,
  getSaleReceipt,
  normalizeBarcode,
  registerSale
};
