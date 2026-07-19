const crypto = require('crypto');
const { formatLocalDateTime } = require('../utils/local-datetime');

const LOCAL_CATEGORIES = Object.freeze([
  'LACTEOS', 'LIMPIEZA', 'BEBIDAS', 'SNACKS', 'ABARROTES',
  'ASEO PERSONAL', 'CONDIMENTOS', 'OTROS'
]);

function catalogError(status, message, code, details) {
  const error = new Error(message);
  error.status = status;
  if (code) error.code = code;
  if (details) error.details = details;
  return error;
}

function cleanText(value, maximum = 255) {
  const text = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  if (text.length > maximum) throw catalogError(400, `El texto no puede superar ${maximum} caracteres.`);
  return text;
}

function normalizeText(value) {
  return cleanText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('es')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function normalizeBarcode(value) {
  if (value === undefined || value === null || value === '') return null;
  const barcode = String(value).trim().replace(/\s+/g, '').toUpperCase();
  if (barcode.length < 4 || barcode.length > 64 || !/^[0-9A-Z._-]+$/.test(barcode)) {
    throw catalogError(400, 'El codigo de barras debe tener entre 4 y 64 caracteres validos.');
  }
  return barcode;
}

function booleanValue(value, defaultValue) {
  if (value === undefined || value === null || value === '') return defaultValue;
  const normalized = typeof value === 'string' ? normalizeText(value) : value;
  if ([true, 1, '1', 'true', 'on', 'si'].includes(normalized)) return true;
  if ([false, 0, '0', 'false', 'off', 'no'].includes(normalized)) return false;
  throw catalogError(400, 'Hay un valor booleano no valido.');
}

function positiveInteger(value, label, defaultValue = 1) {
  const number = value === undefined || value === null || value === '' ? defaultValue : Number(value);
  if (!Number.isInteger(number) || number < 1) throw catalogError(400, `${label} debe ser un entero positivo.`);
  return number;
}

function optionalPositiveDecimal(value, label) {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0 || number > 9999999.999) {
    throw catalogError(400, `${label} debe ser un numero positivo.`);
  }
  return number;
}

function parseId(value, label) {
  if (value === undefined || value === null || value === '') return null;
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw catalogError(400, `${label} no es valido.`);
  return id;
}

async function taxonomyRecord(connection, table, idField, value, label, requireActive = true) {
  const id = parseId(value, label);
  if (!id) return null;
  const [rows] = await connection.query(
    `SELECT ${idField} id, nombre, nombreNormalizado, activo FROM ${table} WHERE ${idField}=?`,
    [id]
  );
  if (!rows.length) throw catalogError(400, `${label} no existe.`);
  if (requireActive && Number(rows[0].activo) !== 1) throw catalogError(409, `${label} no esta disponible.`);
  return rows[0];
}

function duplicateFingerprint(data, brandNormalized = '') {
  const quantity = data.contenidoCantidad === null ? '' : Number(data.contenidoCantidad).toFixed(3);
  const source = [
    data.nombreNormalizado,
    brandNormalized,
    normalizeText(data.presentacion || ''),
    quantity,
    normalizeText(data.contenidoUnidad || '')
  ].join('|');
  return crypto.createHash('sha256').update(source).digest('hex');
}

async function normalizeMasterPayload(connection, input, options = {}) {
  const nombre = cleanText(input?.nombre, 160);
  if (!nombre) throw catalogError(400, 'El nombre del producto maestro es obligatorio.');
  const categoria = await taxonomyRecord(
    connection, 'categoriaMaestra', 'idCategoriaMaestra', input.idCategoriaMaestra, 'La categoria maestra',
    Number(input.idCategoriaMaestra) !== Number(options.allowInactiveCategoryId)
  );
  const marca = await taxonomyRecord(
    connection, 'marcaMaestra', 'idMarcaMaestra', input.idMarcaMaestra, 'La marca maestra',
    Number(input.idMarcaMaestra) !== Number(options.allowInactiveBrandId)
  );
  const unidadesPorPaquete = positiveInteger(input.unidadesPorPaquete, 'Unidades por paquete');
  const permiteVentaPorUnidad = booleanValue(input.permiteVentaPorUnidad, true);
  const permiteVentaPorPaquete = booleanValue(input.permiteVentaPorPaquete, false);
  if (!permiteVentaPorUnidad && !permiteVentaPorPaquete) {
    throw catalogError(400, 'Debe permitir venta por unidad o por paquete.');
  }
  if (permiteVentaPorPaquete && unidadesPorPaquete <= 1) {
    throw catalogError(400, 'La venta por paquete requiere mas de una unidad por paquete.');
  }
  const data = {
    nombre,
    nombreNormalizado: normalizeText(nombre),
    descripcion: cleanText(input.descripcion, 500) || null,
    idCategoriaMaestra: categoria?.id || null,
    idMarcaMaestra: marca?.id || null,
    codigoBarras: normalizeBarcode(input.codigoBarras),
    presentacion: cleanText(input.presentacion, 60) || null,
    contenidoCantidad: optionalPositiveDecimal(input.contenidoCantidad, 'El contenido'),
    contenidoUnidad: cleanText(input.contenidoUnidad, 30) || null,
    unidadesPorPaquete,
    permiteVentaPorUnidad,
    permiteVentaPorPaquete,
    activo: booleanValue(input.activo, true)
  };
  if ((data.contenidoCantidad === null) !== (data.contenidoUnidad === null)) {
    throw catalogError(400, 'Contenido cantidad y contenido unidad deben completarse juntos.');
  }
  data.huellaDuplicado = duplicateFingerprint(data, marca?.nombreNormalizado || '');
  return data;
}

async function duplicateCandidates(connection, data, excludeId = null) {
  if (data.codigoBarras) {
    const [barcodeRows] = await connection.query(
      `SELECT idProductoMaestro, nombre, codigoBarras, activo
       FROM productoMaestro WHERE codigoBarras=? AND (? IS NULL OR idProductoMaestro<>?)`,
      [data.codigoBarras, excludeId, excludeId]
    );
    if (barcodeRows.length) {
      throw catalogError(409, 'Ya existe un producto maestro con ese codigo de barras.', 'DUPLICATE_BARCODE', barcodeRows);
    }
  }
  const [rows] = await connection.query(
    `SELECT pm.idProductoMaestro, pm.nombre, pm.codigoBarras, pm.presentacion,
       pm.contenidoCantidad, pm.contenidoUnidad, pm.activo, m.nombre marca
     FROM productoMaestro pm
     LEFT JOIN marcaMaestra m ON m.idMarcaMaestra=pm.idMarcaMaestra
     WHERE pm.huellaDuplicado=? AND (? IS NULL OR pm.idProductoMaestro<>?)
     ORDER BY pm.activo DESC, pm.nombre LIMIT 10`,
    [data.huellaDuplicado, excludeId, excludeId]
  );
  return rows;
}

async function auditCatalog(connection, idAdministrador, accion, entidad, idEntidad, detail = null) {
  await connection.query(
    `INSERT INTO auditoriaCatalogo (idAdministrador, accion, entidad, idEntidad, detalle, creadoEn)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [idAdministrador, accion, entidad, idEntidad || null,
      detail ? JSON.stringify(detail) : null, formatLocalDateTime()]
  );
}

async function createMasterProduct(connection, input, idAdministrador) {
  const data = await normalizeMasterPayload(connection, input);
  const duplicates = await duplicateCandidates(connection, data);
  if (duplicates.length && input.confirmarDuplicado !== true) {
    throw catalogError(409, 'Se encontraron productos maestros posiblemente duplicados.', 'POSSIBLE_DUPLICATE', duplicates);
  }
  const localDateTime = formatLocalDateTime();
  const [result] = await connection.query(
    `INSERT INTO productoMaestro
      (nombre, nombreNormalizado, descripcion, idCategoriaMaestra, idMarcaMaestra, codigoBarras,
       presentacion, contenidoCantidad, contenidoUnidad, unidadesPorPaquete,
       permiteVentaPorUnidad, permiteVentaPorPaquete, huellaDuplicado, activo, creadoEn, actualizadoEn)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [data.nombre, data.nombreNormalizado, data.descripcion, data.idCategoriaMaestra, data.idMarcaMaestra,
      data.codigoBarras, data.presentacion, data.contenidoCantidad, data.contenidoUnidad,
      data.unidadesPorPaquete, data.permiteVentaPorUnidad, data.permiteVentaPorPaquete,
      data.huellaDuplicado, data.activo, localDateTime, localDateTime]
  );
  await auditCatalog(connection, idAdministrador, 'crear', 'productoMaestro', result.insertId, {
    nombre: data.nombre,
    codigoBarras: data.codigoBarras,
    duplicadoConfirmado: duplicates.length > 0
  });
  return { idProductoMaestro: result.insertId, duplicadosAdvertidos: duplicates };
}

async function updateMasterProduct(connection, idProductoMaestro, input, idAdministrador) {
  const id = parseId(idProductoMaestro, 'El producto maestro');
  const [current] = await connection.query(
    `SELECT idProductoMaestro, idCategoriaMaestra, idMarcaMaestra
     FROM productoMaestro WHERE idProductoMaestro=? FOR UPDATE`,
    [id]
  );
  if (!current.length) throw catalogError(404, 'El producto maestro no existe.');
  const data = await normalizeMasterPayload(connection, input, {
    allowInactiveCategoryId: current[0].idCategoriaMaestra,
    allowInactiveBrandId: current[0].idMarcaMaestra
  });
  const duplicates = await duplicateCandidates(connection, data, id);
  if (duplicates.length && input.confirmarDuplicado !== true) {
    throw catalogError(409, 'Se encontraron productos maestros posiblemente duplicados.', 'POSSIBLE_DUPLICATE', duplicates);
  }
  await connection.query(
    `UPDATE productoMaestro SET nombre=?, nombreNormalizado=?, descripcion=?, idCategoriaMaestra=?,
       idMarcaMaestra=?, codigoBarras=?, presentacion=?, contenidoCantidad=?, contenidoUnidad=?,
       unidadesPorPaquete=?, permiteVentaPorUnidad=?, permiteVentaPorPaquete=?, huellaDuplicado=?, activo=?, actualizadoEn=?
     WHERE idProductoMaestro=?`,
    [data.nombre, data.nombreNormalizado, data.descripcion, data.idCategoriaMaestra, data.idMarcaMaestra,
      data.codigoBarras, data.presentacion, data.contenidoCantidad, data.contenidoUnidad,
      data.unidadesPorPaquete, data.permiteVentaPorUnidad, data.permiteVentaPorPaquete,
      data.huellaDuplicado, data.activo, formatLocalDateTime(), id]
  );
  await auditCatalog(connection, idAdministrador, 'editar', 'productoMaestro', id, {
    nombre: data.nombre,
    codigoBarras: data.codigoBarras,
    duplicadoConfirmado: duplicates.length > 0
  });
  return { idProductoMaestro: id, duplicadosAdvertidos: duplicates };
}

async function createTaxonomy(connection, kind, name, idAdministrador) {
  const definition = kind === 'categoria'
    ? { table: 'categoriaMaestra', id: 'idCategoriaMaestra', entity: 'categoriaMaestra' }
    : { table: 'marcaMaestra', id: 'idMarcaMaestra', entity: 'marcaMaestra' };
  const display = cleanText(name, 100);
  const normalized = normalizeText(display);
  if (!normalized) throw catalogError(400, 'El nombre es obligatorio.');
  const [existing] = await connection.query(
    `SELECT ${definition.id} id, activo FROM ${definition.table} WHERE nombreNormalizado=? FOR UPDATE`,
    [normalized]
  );
  if (existing.length) throw catalogError(409, 'Ya existe un registro con ese nombre normalizado.');
  const localDateTime = formatLocalDateTime();
  const [result] = await connection.query(
    `INSERT INTO ${definition.table}
     (nombre, nombreNormalizado, activo, creadoEn, actualizadoEn) VALUES (?, ?, 1, ?, ?)`,
    [display, normalized, localDateTime, localDateTime]
  );
  await auditCatalog(connection, idAdministrador, 'crear', definition.entity, result.insertId, { nombre: display });
  return { id: result.insertId, nombre: display };
}

async function findOrCreateTaxonomy(connection, kind, name, idAdministrador) {
  const definition = kind === 'categoria'
    ? { table: 'categoriaMaestra', id: 'idCategoriaMaestra' }
    : { table: 'marcaMaestra', id: 'idMarcaMaestra' };
  const display = cleanText(name, 100);
  if (!display) return null;
  const normalized = normalizeText(display);
  const [rows] = await connection.query(
    `SELECT ${definition.id} id FROM ${definition.table} WHERE nombreNormalizado=?`,
    [normalized]
  );
  if (rows.length) return rows[0].id;
  const created = await createTaxonomy(connection, kind, display, idAdministrador);
  return created.id;
}

async function updateTaxonomy(connection, kind, idValue, input, idAdministrador) {
  const definition = kind === 'categoria'
    ? { table: 'categoriaMaestra', id: 'idCategoriaMaestra', entity: 'categoriaMaestra' }
    : { table: 'marcaMaestra', id: 'idMarcaMaestra', entity: 'marcaMaestra' };
  const id = parseId(idValue, `La ${kind}`);
  const [current] = await connection.query(
    `SELECT ${definition.id} id FROM ${definition.table} WHERE ${definition.id}=? FOR UPDATE`,
    [id]
  );
  if (!current.length) throw catalogError(404, `La ${kind} no existe.`);
  const name = cleanText(input.nombre, 100);
  const normalized = normalizeText(name);
  if (!normalized) throw catalogError(400, 'El nombre es obligatorio.');
  const [duplicate] = await connection.query(
    `SELECT ${definition.id} id FROM ${definition.table}
     WHERE nombreNormalizado=? AND ${definition.id}<>?`,
    [normalized, id]
  );
  if (duplicate.length) throw catalogError(409, 'Ya existe un registro con ese nombre normalizado.');
  await connection.query(
    `UPDATE ${definition.table} SET nombre=?, nombreNormalizado=?, actualizadoEn=? WHERE ${definition.id}=?`,
    [name, normalized, formatLocalDateTime(), id]
  );
  if (kind === 'marca') {
    const [products] = await connection.query(
      `SELECT idProductoMaestro, nombreNormalizado, presentacion, contenidoCantidad, contenidoUnidad
       FROM productoMaestro WHERE idMarcaMaestra=?`,
      [id]
    );
    for (const product of products) {
      const fingerprint = duplicateFingerprint(product, normalized);
      await connection.query(
        'UPDATE productoMaestro SET huellaDuplicado=?, actualizadoEn=? WHERE idProductoMaestro=?',
        [fingerprint, formatLocalDateTime(), product.idProductoMaestro]
      );
    }
  }
  await auditCatalog(connection, idAdministrador, 'editar', definition.entity, id, { nombre: name });
  return { id, nombre: name };
}

module.exports = {
  LOCAL_CATEGORIES,
  auditCatalog,
  booleanValue,
  catalogError,
  cleanText,
  createMasterProduct,
  createTaxonomy,
  duplicateFingerprint,
  duplicateCandidates,
  findOrCreateTaxonomy,
  normalizeBarcode,
  normalizeMasterPayload,
  normalizeText,
  parseId,
  positiveInteger,
  updateTaxonomy,
  updateMasterProduct
};
