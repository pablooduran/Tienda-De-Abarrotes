const { formatLocalDate, formatLocalDateTime, parseLocalDate } = require('../utils/local-datetime');
const { stockError } = require('./stock-movement-service');

const LOT_ORIGINS = new Set(['compra', 'distribucion_inicial', 'ajuste_positivo', 'reversion']);
const LOT_STATES = new Set(['disponible', 'bloqueado', 'anulado']);
const MAX_LOTS_PER_OPERATION = 100;
const MICRO_SCALE = 1000000n;

function positiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) throw stockError(400, `${label} debe ser un entero positivo.`);
  return number;
}

function optionalPositiveInteger(value, label) {
  if (value === null || value === undefined || value === '') return null;
  return positiveInteger(value, label);
}

function cleanText(value, maximum) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  if (text.length > maximum) throw stockError(400, `El texto no puede superar ${maximum} caracteres.`);
  return text;
}

function operationPart(value, label = 'La clave de operacion') {
  const text = String(value || '').trim();
  if (!text || text.length > 64 || !/^[A-Za-z0-9._:-]+$/.test(text)) {
    throw stockError(400, `${label} no es valida.`, 'INVALID_LOT_OPERATION_KEY');
  }
  return text;
}

function internalOperationPart(value) {
  const text = String(value || '').trim();
  if (!text || text.length > 120 || !/^[A-Za-z0-9._:-]+$/.test(text)) {
    throw stockError(500, 'La clave interna de lotes no es valida.', 'INVALID_INTERNAL_LOT_KEY');
  }
  return text;
}

function derivedKey(prefix, operation, detailIndex, lotIndex) {
  const key = `${prefix}:${operation}:d${detailIndex}:l${lotIndex}`;
  if (key.length > 160) throw stockError(400, 'La clave derivada de lote supera la longitud permitida.');
  return key;
}

function validLocalDate(value, label, { required = false } = {}) {
  if (value === null || value === undefined || value === '') {
    if (required) throw stockError(400, `${label} es obligatoria.`);
    return null;
  }
  const text = String(value).trim();
  try {
    parseLocalDate(text);
  } catch {
    throw stockError(400, `${label} no es valida.`);
  }
  return text;
}

function databaseLocalDate(value) {
  if (!value) return null;
  if (value instanceof Date) return formatLocalDate(value);
  return String(value).slice(0, 10);
}

function databaseLocalDateTime(value) {
  if (!value) return '';
  if (value instanceof Date) return formatLocalDateTime(value);
  return String(value).replace('T', ' ').slice(0, 19);
}

function decimalToMicros(value, label, { nullable = true } = {}) {
  if (value === null || value === undefined || value === '') {
    if (nullable) return null;
    throw stockError(400, `${label} es obligatorio.`);
  }
  const text = String(value).trim();
  if (!/^\d+(?:\.\d{1,6})?$/.test(text)) throw stockError(400, `${label} no es valido.`);
  const [whole, fraction = ''] = text.split('.');
  const micros = (BigInt(whole) * MICRO_SCALE) + BigInt(fraction.padEnd(6, '0'));
  if (micros > 99999999999999n) throw stockError(400, `${label} supera el valor permitido.`);
  return micros;
}

function microsToDecimal(value) {
  const micros = BigInt(value);
  const whole = micros / MICRO_SCALE;
  const fraction = String(micros % MICRO_SCALE).padStart(6, '0');
  return `${whole}.${fraction}`;
}

function roundedDivision(total, divisor) {
  const denominator = BigInt(divisor);
  return (BigInt(total) + (denominator / 2n)) / denominator;
}

function microsToCents(value) {
  return Number(roundedDivision(value, 10000));
}

async function lockProduct(connection, idTienda, idProducto, { activeOnly = true } = {}) {
  const [rows] = await connection.query(
    `SELECT p.* FROM producto p
     WHERE p.idTienda=? AND p.idProducto=?${activeOnly ? ' AND p.activo=1' : ''}
     FOR UPDATE`,
    [positiveInteger(idTienda, 'La tienda'), positiveInteger(idProducto, 'El producto')]
  );
  if (!rows.length) throw stockError(404, 'Producto no encontrado o inactivo.');
  return rows[0];
}

async function lockLots(connection, idTienda, idProducto, product = null) {
  const order = Number(product?.controlaVencimiento) === 1
    ? 'fechaVencimiento IS NULL, fechaVencimiento, fechaIngreso, idLoteProducto'
    : 'fechaIngreso, idLoteProducto';
  const [rows] = await connection.query(
    `SELECT idLoteProducto, idTienda, idProducto, idProveedor, idDetalleCompra,
            codigoLote, origen, fechaIngreso, fechaVencimiento, cantidadInicial,
            cantidadRestante, CAST(costoUnitarioBase AS CHAR) costoUnitarioBase,
            estadoOperativo, claveOperacion
     FROM loteProducto
     WHERE idTienda=? AND idProducto=?
     ORDER BY ${order}
     FOR UPDATE`,
    [idTienda, idProducto]
  );
  return rows;
}

function lotBalances(product, lots, today = formatLocalDate()) {
  const stockGeneral = Number(product.stockUnidadesTotal);
  const nonCancelled = lots.filter((lot) => lot.estadoOperativo !== 'anulado');
  const stockTrazado = nonCancelled.reduce((sum, lot) => sum + Number(lot.cantidadRestante), 0);
  const stockVendible = nonCancelled
    .filter((lot) => lot.estadoOperativo === 'disponible'
      && Number(lot.cantidadRestante) > 0
      && (!lot.fechaVencimiento || databaseLocalDate(lot.fechaVencimiento) >= today))
    .reduce((sum, lot) => sum + Number(lot.cantidadRestante), 0);
  return { stockGeneral, stockTrazado, stockVendible };
}

function assertReconciled(product, lots) {
  if (!Number(product.controlaLotes)) return lotBalances(product, lots);
  const balances = lotBalances(product, lots);
  if (balances.stockTrazado !== balances.stockGeneral) {
    throw stockError(409,
      'El stock general y los lotes no coinciden. Debe reconciliar el inventario antes de continuar.',
      'LOT_STOCK_MISMATCH');
  }
  return balances;
}

function sortEligibleLots(product, lots) {
  const expirationControl = Number(product.controlaVencimiento) === 1;
  return lots.slice().sort((a, b) => {
    if (expirationControl) {
      const dateA = a.fechaVencimiento ? databaseLocalDate(a.fechaVencimiento) : '9999-12-31';
      const dateB = b.fechaVencimiento ? databaseLocalDate(b.fechaVencimiento) : '9999-12-31';
      if (dateA !== dateB) return dateA.localeCompare(dateB);
    }
    const ingresoA = databaseLocalDateTime(a.fechaIngreso);
    const ingresoB = databaseLocalDateTime(b.fechaIngreso);
    if (ingresoA !== ingresoB) return ingresoA.localeCompare(ingresoB);
    return Number(a.idLoteProducto) - Number(b.idLoteProducto);
  });
}

async function prepareLotExit(connection, { idTienda, product, cantidad }) {
  if (!Number(product.controlaLotes)) return null;
  const required = positiveInteger(cantidad, 'La cantidad de salida');
  const lots = await lockLots(connection, idTienda, product.idProducto, product);
  const balances = assertReconciled(product, lots);
  const today = formatLocalDate();
  const eligible = sortEligibleLots(product, lots.filter((lot) => lot.estadoOperativo === 'disponible'
    && Number(lot.cantidadRestante) > 0
    && (!lot.fechaVencimiento || databaseLocalDate(lot.fechaVencimiento) >= today)));
  if (balances.stockVendible < required) {
    throw stockError(409,
      'Hay stock fisico, pero parte esta vencida o bloqueada y no puede venderse.',
      'INSUFFICIENT_SELLABLE_LOT_STOCK');
  }
  let pending = required;
  const allocations = [];
  for (const lot of eligible) {
    if (pending === 0) break;
    const quantity = Math.min(pending, Number(lot.cantidadRestante));
    allocations.push({ lot, quantity, before: Number(lot.cantidadRestante), after: Number(lot.cantidadRestante) - quantity });
    pending -= quantity;
  }
  if (pending !== 0) throw stockError(409, 'No se pudo asignar toda la salida a lotes vendibles.');
  const allCostsKnown = allocations.every(({ lot }) => lot.costoUnitarioBase !== null);
  const totalCostMicros = allCostsKnown
    ? allocations.reduce((sum, item) => sum
      + (decimalToMicros(item.lot.costoUnitarioBase, 'El costo del lote', { nullable: false }) * BigInt(item.quantity)), 0n)
    : null;
  return {
    allocations,
    balances,
    allCostsKnown,
    totalCostMicros,
    unitCostMicros: allCostsKnown ? roundedDivision(totalCostMicros, required) : null,
    totalCostCents: allCostsKnown ? microsToCents(totalCostMicros) : 0
  };
}

async function insertLotMovement(connection, input) {
  const [result] = await connection.query(
    `INSERT INTO movimientoLote
     (idTienda, idProducto, idLoteProducto, idMovimientoStock, tipoRegistro,
      cantidad, cantidadAnterior, cantidadPosterior, claveOperacion, creadoEn, idAdministrador)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [input.idTienda, input.idProducto, input.idLoteProducto, input.idMovimientoStock || null,
      input.tipoRegistro, input.cantidad, input.cantidadAnterior, input.cantidadPosterior,
      input.claveOperacion, input.creadoEn, input.idAdministrador]
  );
  return result.insertId;
}

async function applyLotExit(connection, input) {
  if (!input.prepared) return [];
  const movementIds = [];
  for (let index = 0; index < input.prepared.allocations.length; index += 1) {
    const allocation = input.prepared.allocations[index];
    const [updated] = await connection.query(
      `UPDATE loteProducto SET cantidadRestante=?, actualizadoEn=?, idAdministradorActualiza=?
       WHERE idTienda=? AND idProducto=? AND idLoteProducto=? AND cantidadRestante=?`,
      [allocation.after, input.creadoEn, input.idAdministrador, input.idTienda,
        input.idProducto, allocation.lot.idLoteProducto, allocation.before]
    );
    if (!updated.affectedRows) throw stockError(409, 'El saldo de un lote cambio durante la operacion.');
    movementIds.push(await insertLotMovement(connection, {
      idTienda: input.idTienda,
      idProducto: input.idProducto,
      idLoteProducto: allocation.lot.idLoteProducto,
      idMovimientoStock: input.idMovimientoStock,
      tipoRegistro: 'movimiento_stock',
      cantidad: -allocation.quantity,
      cantidadAnterior: allocation.before,
      cantidadPosterior: allocation.after,
      claveOperacion: derivedKey('ml', input.operation, input.detailIndex, index + 1),
      creadoEn: input.creadoEn,
      idAdministrador: input.idAdministrador
    }));
  }
  return movementIds;
}

function normalizeLotEntries(rawLots, { requiredTotal, controlsExpiration, operationDate }) {
  if (!Array.isArray(rawLots) || !rawLots.length) throw stockError(400, 'Debe indicar al menos un lote fisico.');
  if (rawLots.length > MAX_LOTS_PER_OPERATION) throw stockError(400, `Se permiten como maximo ${MAX_LOTS_PER_OPERATION} lotes por operacion.`);
  const today = formatLocalDate(operationDate);
  const entries = rawLots.map((raw, index) => {
    const quantity = positiveInteger(raw.cantidadUnidadesBase ?? raw.cantidad, `La cantidad del lote ${index + 1}`);
    const expiration = validLocalDate(raw.fechaVencimiento, `La fecha de vencimiento del lote ${index + 1}`, {
      required: controlsExpiration
    });
    if (expiration && expiration < today) throw stockError(400, 'No se puede ingresar un lote ya vencido.');
    return {
      codigoLote: cleanText(raw.codigoLote, 80),
      fechaVencimiento: expiration,
      quantity,
      costMicros: decimalToMicros(raw.costoUnitarioBase, `El costo del lote ${index + 1}`)
    };
  });
  const total = entries.reduce((sum, entry) => sum + entry.quantity, 0);
  if (requiredTotal !== null && requiredTotal !== undefined && total !== requiredTotal) {
    throw stockError(400, `La distribucion de lotes debe sumar exactamente ${requiredTotal} unidades base.`);
  }
  return entries;
}

async function createLotEntries(connection, input) {
  if (!LOT_ORIGINS.has(input.origen)) throw stockError(500, 'El origen del lote no es valido.');
  const operation = internalOperationPart(input.operation);
  const created = [];
  for (let index = 0; index < input.entries.length; index += 1) {
    const entry = input.entries[index];
    const lotKey = derivedKey('lot', operation, input.detailIndex, index + 1);
    const movementKey = derivedKey('ml', operation, input.detailIndex, index + 1);
    const cost = input.costMicros !== undefined ? input.costMicros : entry.costMicros;
    const [lot] = await connection.query(
      `INSERT INTO loteProducto
       (idTienda, idProducto, idProveedor, idDetalleCompra, codigoLote, origen,
        fechaIngreso, fechaVencimiento, cantidadInicial, cantidadRestante, costoUnitarioBase,
        estadoOperativo, claveOperacion, creadoEn, actualizadoEn, idAdministradorCrea)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'disponible', ?, ?, ?, ?)`,
      [input.idTienda, input.idProducto, input.idProveedor || null, input.idDetalleCompra || null,
        entry.codigoLote, input.origen, input.creadoEn, entry.fechaVencimiento,
        entry.quantity, entry.quantity, cost === null ? null : microsToDecimal(cost),
        lotKey, input.creadoEn, input.creadoEn, input.idAdministrador]
    );
    const idMovimientoLote = await insertLotMovement(connection, {
      idTienda: input.idTienda,
      idProducto: input.idProducto,
      idLoteProducto: lot.insertId,
      idMovimientoStock: input.idMovimientoStock || null,
      tipoRegistro: input.idMovimientoStock ? 'movimiento_stock' : 'distribucion_inicial',
      cantidad: entry.quantity,
      cantidadAnterior: 0,
      cantidadPosterior: entry.quantity,
      claveOperacion: movementKey,
      creadoEn: input.creadoEn,
      idAdministrador: input.idAdministrador
    });
    created.push({ idLoteProducto: lot.insertId, idMovimientoLote, cantidad: entry.quantity });
  }
  return created;
}

async function existingOperationLots(connection, { idTienda, idProducto, operation, detailIndex, entries }) {
  const keys = entries.map((_, index) => derivedKey('lot', operation, detailIndex, index + 1));
  const placeholders = keys.map(() => '?').join(',');
  const [rows] = await connection.query(
    `SELECT idLoteProducto, idProducto, codigoLote, fechaVencimiento,
            cantidadInicial, CAST(costoUnitarioBase AS CHAR) costoUnitarioBase, claveOperacion
     FROM loteProducto WHERE idTienda=? AND claveOperacion IN (${placeholders}) FOR UPDATE`,
    [idTienda, ...keys]
  );
  if (!rows.length) return null;
  if (rows.length !== keys.length || rows.some((row) => Number(row.idProducto) !== Number(idProducto))) {
    throw stockError(409, 'La clave de operacion ya fue utilizada con otra distribucion de lotes.');
  }
  const byKey = new Map(rows.map((row) => [row.claveOperacion, row]));
  const matches = entries.every((entry, index) => {
    const row = byKey.get(keys[index]);
    const existingCost = row?.costoUnitarioBase === null
      ? null : decimalToMicros(row.costoUnitarioBase, 'El costo existente', { nullable: false });
    return row
      && Number(row.cantidadInicial) === entry.quantity
      && (row.codigoLote || null) === entry.codigoLote
      && databaseLocalDate(row.fechaVencimiento) === entry.fechaVencimiento
      && existingCost === entry.costMicros;
  });
  if (!matches) throw stockError(409, 'La clave de operacion ya fue utilizada con otra distribucion de lotes.');
  return rows;
}

async function productLotSnapshot(connection, idTienda, idProducto, { lock = false } = {}) {
  const product = lock
    ? await lockProduct(connection, idTienda, idProducto, { activeOnly: false })
    : (await connection.query(
      `SELECT idProducto, nombre, stockUnidadesTotal, controlaLotes, controlaVencimiento,
              lotesActivadosEn, diasAlertaVencimiento
       FROM producto WHERE idTienda=? AND idProducto=?`, [idTienda, idProducto]))[0][0];
  if (!product) throw stockError(404, 'Producto no encontrado.');
  const lots = lock ? await lockLots(connection, idTienda, idProducto, product) : (await connection.query(
    `SELECT idLoteProducto, codigoLote, fechaIngreso, fechaVencimiento, cantidadInicial,
            cantidadRestante, CAST(costoUnitarioBase AS CHAR) costoUnitarioBase, estadoOperativo
     FROM loteProducto WHERE idTienda=? AND idProducto=? ORDER BY idLoteProducto`,
    [idTienda, idProducto]))[0];
  return { product, lots, balances: lotBalances(product, lots) };
}

module.exports = {
  LOT_STATES,
  MAX_LOTS_PER_OPERATION,
  applyLotExit,
  assertReconciled,
  createLotEntries,
  databaseLocalDate,
  databaseLocalDateTime,
  decimalToMicros,
  derivedKey,
  existingOperationLots,
  insertLotMovement,
  lockLots,
  lockProduct,
  lotBalances,
  microsToDecimal,
  normalizeLotEntries,
  operationPart,
  optionalPositiveInteger,
  prepareLotExit,
  productLotSnapshot,
  validLocalDate
};
