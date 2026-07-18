const crypto = require('crypto');

const MOVEMENT_TYPES = new Set([
  'entrada',
  'salida',
  'ajuste_positivo',
  'ajuste_negativo',
  'inventario_inicial'
]);

const MOVEMENT_ORIGINS = new Set([
  'compra',
  'venta',
  'ajuste_manual',
  'alta_producto',
  'migracion_inicial',
  'correccion_sistema',
  'otro'
]);

function stockError(status, message, code) {
  const error = new Error(message);
  error.status = status;
  if (code) error.code = code;
  return error;
}

function integer(value, label, { allowZero = true } = {}) {
  const number = Number(value);
  if (!Number.isInteger(number) || (allowZero ? number < 0 : number <= 0)) {
    throw stockError(400, `${label} debe ser un numero entero ${allowZero ? 'igual o mayor a cero' : 'positivo'}.`);
  }
  return number;
}

function cleanText(value, maximum = 500) {
  const text = String(value ?? '').trim();
  return text ? text.slice(0, maximum) : null;
}

function operationKey(value) {
  const key = String(value || '').trim();
  if (!key) return crypto.randomUUID();
  if (key.length > 64 || !/^[A-Za-z0-9._:-]+$/.test(key)) {
    throw stockError(400, 'La clave de operacion no es valida.', 'INVALID_OPERATION_KEY');
  }
  return key;
}

function movementKey(prefix, value) {
  const key = `${prefix}:${value}`;
  if (key.length > 160) throw stockError(400, 'La referencia de inventario es demasiado larga.');
  return key;
}

function movementRecordKey(value) {
  const key = String(value || '').trim();
  if (!key || key.length > 160 || !/^[A-Za-z0-9._:-]+$/.test(key)) {
    throw stockError(400, 'La clave del movimiento no es valida.');
  }
  return key;
}

function optionalReferenceId(value, label) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    throw stockError(500, `${label} del movimiento no es valida.`, 'INVALID_STOCK_REFERENCE');
  }
  return number;
}

async function insertStockMovement(connection, input) {
  const idTienda = integer(input.idTienda, 'La tienda', { allowZero: false });
  const idProducto = integer(input.idProducto, 'El producto', { allowZero: false });
  const stockAnterior = integer(input.stockAnterior, 'El stock anterior');
  const stockPosterior = integer(input.stockPosterior, 'El stock posterior');
  const cantidad = Number(input.cantidad);
  if (!Number.isInteger(cantidad) || cantidad === 0) {
    throw stockError(400, 'El movimiento debe tener una cantidad entera distinta de cero.');
  }
  if (stockPosterior !== stockAnterior + cantidad) {
    throw stockError(500, 'El movimiento no coincide con el cambio real de stock.', 'STOCK_MOVEMENT_MISMATCH');
  }
  if (!MOVEMENT_TYPES.has(input.tipoMovimiento)) {
    throw stockError(500, 'El tipo de movimiento no es valido.');
  }
  if (!MOVEMENT_ORIGINS.has(input.origen)) {
    throw stockError(500, 'El origen del movimiento no es valido.');
  }
  const positiveType = ['entrada', 'ajuste_positivo', 'inventario_inicial'].includes(input.tipoMovimiento);
  if ((positiveType && cantidad < 0) || (!positiveType && cantidad > 0)) {
    throw stockError(500, 'El signo de la cantidad no coincide con el tipo de movimiento.');
  }
  const idDetalleVenta = optionalReferenceId(input.idDetalleVenta, 'La referencia de venta');
  const idDetalleCompra = optionalReferenceId(input.idDetalleCompra, 'La referencia de compra');
  if (idDetalleVenta && idDetalleCompra) {
    throw stockError(500, 'Un movimiento no puede referenciar una venta y una compra simultaneamente.', 'STOCK_REFERENCE_CONFLICT');
  }
  if (input.origen === 'venta' && !idDetalleVenta) {
    throw stockError(500, 'El movimiento de venta requiere su detalle de venta.', 'MISSING_STOCK_REFERENCE');
  }
  if (input.origen === 'compra' && !idDetalleCompra) {
    throw stockError(500, 'El movimiento de compra requiere su detalle de compra.', 'MISSING_STOCK_REFERENCE');
  }
  if (input.origen !== 'venta' && idDetalleVenta) {
    throw stockError(500, 'La referencia de venta no coincide con el origen del movimiento.', 'INVALID_STOCK_REFERENCE');
  }
  if (input.origen !== 'compra' && idDetalleCompra) {
    throw stockError(500, 'La referencia de compra no coincide con el origen del movimiento.', 'INVALID_STOCK_REFERENCE');
  }
  const motivo = cleanText(input.motivo, 160);
  if (!motivo) throw stockError(400, 'El motivo del movimiento es obligatorio.');
  const cantidadOperacion = input.cantidadOperacion === null || input.cantidadOperacion === undefined
    ? null
    : Number(input.cantidadOperacion);
  if (cantidadOperacion !== null && (!Number.isFinite(cantidadOperacion) || cantidadOperacion <= 0)) {
    throw stockError(400, 'La cantidad de la operacion debe ser mayor a cero.');
  }

  const [result] = await connection.query(
    `INSERT INTO movimientoStock
      (idTienda, idProducto, tipoMovimiento, origen, cantidad, stockAnterior, stockPosterior,
       cantidadOperacion, unidadOperacion, motivo, observacion, idDetalleVenta, idDetalleCompra,
       referenciaTipo, referenciaId, claveOperacion, idAdministrador)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      idTienda,
      idProducto,
      input.tipoMovimiento,
      input.origen,
      cantidad,
      stockAnterior,
      stockPosterior,
      cantidadOperacion,
      cleanText(input.unidadOperacion, 30),
      motivo,
      cleanText(input.observacion, 500),
      idDetalleVenta,
      idDetalleCompra,
      cleanText(input.referenciaTipo, 40),
      input.referenciaId || null,
      movementRecordKey(input.claveOperacion),
      input.idAdministrador || null
    ]
  );
  return result.insertId;
}

function logRejectedStockAction(event, context = {}) {
  const safeContext = {
    evento: event,
    idTienda: Number(context.idTienda) || null,
    idAdministrador: Number(context.idAdministrador) || null,
    idProducto: Number(context.idProducto) || null,
    codigo: cleanText(context.codigo, 50),
    fecha: new Date().toISOString()
  };
  console.warn('Accion sensible de stock rechazada:', JSON.stringify(safeContext));
}

module.exports = {
  MOVEMENT_ORIGINS,
  MOVEMENT_TYPES,
  cleanText,
  insertStockMovement,
  integer,
  logRejectedStockAction,
  movementKey,
  operationKey,
  stockError
};
