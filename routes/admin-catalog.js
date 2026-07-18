const path = require('path');
const express = require('express');
const ExcelJS = require('exceljs');
const multer = require('multer');
const pool = require('../config/db');
const {
  auditCatalog,
  booleanValue,
  catalogError,
  cleanText,
  createMasterProduct,
  createTaxonomy,
  duplicateCandidates,
  duplicateFingerprint,
  findOrCreateTaxonomy,
  normalizeBarcode,
  normalizeMasterPayload,
  normalizeText,
  parseId,
  positiveInteger,
  updateMasterProduct,
  updateTaxonomy
} = require('../services/master-catalog-service');

const router = express.Router();
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_IMPORT_ROWS = 2000;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES, files: 1 },
  fileFilter: (req, file, callback) => {
    const extension = path.extname(file.originalname || '').toLowerCase();
    callback(extension === '.xlsx' ? null : catalogError(400, 'Solo se permiten archivos .xlsx.'), extension === '.xlsx');
  }
});

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function pagination(query) {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, Number.parseInt(query.limit, 10) || 25));
  return { page, limit, offset: (page - 1) * limit };
}

async function transaction(work) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await work(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

function taxonomyDefinition(kind) {
  return kind === 'categorias'
    ? { table: 'categoriaMaestra', id: 'idCategoriaMaestra', singular: 'categoria' }
    : { table: 'marcaMaestra', id: 'idMarcaMaestra', singular: 'marca' };
}

function taxonomyRoutes(kind) {
  const definition = taxonomyDefinition(kind);
  router.get(`/${kind}`, asyncRoute(async (req, res) => {
    const [rows] = await pool.query(
      `SELECT ${definition.id}, nombre, nombreNormalizado, activo, creadoEn, actualizadoEn
       FROM ${definition.table} ORDER BY activo DESC, nombre`
    );
    res.json(rows);
  }));

  router.post(`/${kind}`, asyncRoute(async (req, res) => {
    const result = await transaction((connection) => createTaxonomy(
      connection, definition.singular, req.body?.nombre, req.session.admin.id
    ));
    res.status(201).json({ message: 'Registro maestro creado.', ...result });
  }));

  router.put(`/${kind}/:id`, asyncRoute(async (req, res) => {
    const result = await transaction((connection) => updateTaxonomy(
      connection, definition.singular, req.params.id, req.body || {}, req.session.admin.id
    ));
    res.json({ message: 'Registro maestro actualizado.', ...result });
  }));

  router.patch(`/${kind}/:id/estado`, asyncRoute(async (req, res) => {
    const id = parseId(req.params.id, `La ${definition.singular}`);
    const activo = booleanValue(req.body?.activo, false);
    await transaction(async (connection) => {
      const [result] = await connection.query(
        `UPDATE ${definition.table} SET activo=? WHERE ${definition.id}=?`,
        [activo, id]
      );
      if (!result.affectedRows) throw catalogError(404, `La ${definition.singular} no existe.`);
      await auditCatalog(connection, req.session.admin.id, activo ? 'activar' : 'desactivar',
        definition.table, id, { activo });
    });
    res.json({ message: `Registro ${activo ? 'activado' : 'desactivado'}.` });
  }));
}

taxonomyRoutes('categorias');
taxonomyRoutes('marcas');

router.get('/resumen', asyncRoute(async (req, res) => {
  const [[categorias], [marcas], [productos], [activos], [vinculos]] = await Promise.all([
    pool.query('SELECT COUNT(*) total FROM categoriaMaestra'),
    pool.query('SELECT COUNT(*) total FROM marcaMaestra'),
    pool.query('SELECT COUNT(*) total FROM productoMaestro'),
    pool.query('SELECT COUNT(*) total FROM productoMaestro WHERE activo=1'),
    pool.query('SELECT COUNT(*) total FROM producto WHERE idProductoMaestro IS NOT NULL')
  ]);
  res.json({
    categorias: Number(categorias[0].total),
    marcas: Number(marcas[0].total),
    productos: Number(productos[0].total),
    productosActivos: Number(activos[0].total),
    productosLocalesVinculados: Number(vinculos[0].total)
  });
}));

router.get('/productos', asyncRoute(async (req, res) => {
  const { page, limit, offset } = pagination(req.query);
  const conditions = [];
  const params = [];
  const search = normalizeText(req.query.q || '');
  if (search) {
    conditions.push('(pm.nombreNormalizado LIKE ? OR pm.codigoBarras LIKE ? OR m.nombreNormalizado LIKE ?)');
    const barcodeSearch = cleanText(req.query.q, 64).replace(/\s+/g, '').toUpperCase();
    params.push(`%${search}%`, `%${barcodeSearch}%`, `%${search}%`);
  }
  if (req.query.idCategoriaMaestra) {
    conditions.push('pm.idCategoriaMaestra=?');
    params.push(parseId(req.query.idCategoriaMaestra, 'La categoria'));
  }
  if (req.query.idMarcaMaestra) {
    conditions.push('pm.idMarcaMaestra=?');
    params.push(parseId(req.query.idMarcaMaestra, 'La marca'));
  }
  if (req.query.activo === 'true' || req.query.activo === 'false') {
    conditions.push('pm.activo=?');
    params.push(req.query.activo === 'true' ? 1 : 0);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const [[count], [rows]] = await Promise.all([
    pool.query(`SELECT COUNT(*) total FROM productoMaestro pm LEFT JOIN marcaMaestra m ON m.idMarcaMaestra=pm.idMarcaMaestra ${where}`, params),
    pool.query(
      `SELECT pm.*, c.nombre categoria, m.nombre marca,
         (SELECT COUNT(DISTINCT p.idTienda) FROM producto p WHERE p.idProductoMaestro=pm.idProductoMaestro) tiendasQueLoUsan
       FROM productoMaestro pm
       LEFT JOIN categoriaMaestra c ON c.idCategoriaMaestra=pm.idCategoriaMaestra
       LEFT JOIN marcaMaestra m ON m.idMarcaMaestra=pm.idMarcaMaestra
       ${where} ORDER BY pm.actualizadoEn DESC, pm.nombre LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    )
  ]);
  res.json({ rows, page, limit, total: Number(count[0].total), pages: Math.max(1, Math.ceil(Number(count[0].total) / limit)) });
}));

router.get('/productos/:id', asyncRoute(async (req, res) => {
  const id = parseId(req.params.id, 'El producto maestro');
  const [rows] = await pool.query(
    `SELECT pm.*, c.nombre categoria, m.nombre marca,
       (SELECT COUNT(DISTINCT p.idTienda) FROM producto p WHERE p.idProductoMaestro=pm.idProductoMaestro) tiendasQueLoUsan
     FROM productoMaestro pm
     LEFT JOIN categoriaMaestra c ON c.idCategoriaMaestra=pm.idCategoriaMaestra
     LEFT JOIN marcaMaestra m ON m.idMarcaMaestra=pm.idMarcaMaestra
     WHERE pm.idProductoMaestro=?`,
    [id]
  );
  if (!rows.length) throw catalogError(404, 'El producto maestro no existe.');
  res.json(rows[0]);
}));

router.post('/productos/detectar-duplicados', asyncRoute(async (req, res) => {
  const data = await normalizeMasterPayload(pool, req.body || {});
  const duplicates = await duplicateCandidates(pool, data, req.body?.idProductoMaestro || null);
  res.json({ posibleDuplicado: duplicates.length > 0, duplicados: duplicates });
}));

router.post('/productos', asyncRoute(async (req, res) => {
  const result = await transaction((connection) => createMasterProduct(connection, req.body || {}, req.session.admin.id));
  res.status(201).json({ message: 'Producto maestro creado.', ...result });
}));

router.put('/productos/:id', asyncRoute(async (req, res) => {
  const result = await transaction((connection) => updateMasterProduct(
    connection, req.params.id, req.body || {}, req.session.admin.id
  ));
  res.json({ message: 'Producto maestro actualizado sin modificar inventarios locales.', ...result });
}));

router.patch('/productos/:id/estado', asyncRoute(async (req, res) => {
  const id = parseId(req.params.id, 'El producto maestro');
  const activo = booleanValue(req.body?.activo, false);
  await transaction(async (connection) => {
    const [result] = await connection.query(
      'UPDATE productoMaestro SET activo=? WHERE idProductoMaestro=?',
      [activo, id]
    );
    if (!result.affectedRows) throw catalogError(404, 'El producto maestro no existe.');
    await auditCatalog(connection, req.session.admin.id, activo ? 'activar' : 'desactivar',
      'productoMaestro', id, { activo });
  });
  res.json({ message: `Producto maestro ${activo ? 'activado' : 'desactivado'}.` });
}));

function importCell(cell) {
  if (cell?.value && typeof cell.value === 'object' && Object.prototype.hasOwnProperty.call(cell.value, 'formula')) {
    throw catalogError(400, 'La plantilla no admite formulas.');
  }
  if (cell?.value && typeof cell.value === 'object' && Object.prototype.hasOwnProperty.call(cell.value, 'richText')) {
    return cell.value.richText.map((part) => part.text).join('');
  }
  return cell?.text ?? cell?.value ?? '';
}

const IMPORT_HEADERS = [
  'nombre', 'marca', 'categoria', 'codigoBarras', 'presentacion', 'contenidoCantidad',
  'contenidoUnidad', 'unidadesPorPaquete', 'permiteVentaPorUnidad', 'permiteVentaPorPaquete', 'descripcion'
];

async function readWorkbookRows(buffer) {
  if (!buffer || buffer.length < 4 || buffer[0] !== 0x50 || buffer[1] !== 0x4B) {
    throw catalogError(400, 'El archivo no tiene una estructura .xlsx valida.');
  }
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) throw catalogError(400, 'El archivo no contiene hojas.');
  const headers = worksheet.getRow(1).values.slice(1).map((value) => cleanText(String(value), 80));
  const headerMap = new Map(headers.map((header, index) => [normalizeText(header).replace(/ /g, ''), index + 1]));
  for (const required of IMPORT_HEADERS) {
    if (!headerMap.has(normalizeText(required).replace(/ /g, ''))) {
      throw catalogError(400, `Falta la columna ${required}.`);
    }
  }
  if (worksheet.actualRowCount - 1 > MAX_IMPORT_ROWS) {
    throw catalogError(413, `El archivo supera el limite de ${MAX_IMPORT_ROWS} filas.`);
  }
  const rows = [];
  for (let number = 2; number <= worksheet.actualRowCount; number += 1) {
    const row = worksheet.getRow(number);
    const data = { fila: number };
    const readErrors = [];
    let hasValue = false;
    for (const header of IMPORT_HEADERS) {
      const cell = row.getCell(headerMap.get(normalizeText(header).replace(/ /g, '')));
      try {
        if (header === 'codigoBarras' && typeof cell.value === 'number') {
          throw catalogError(400, 'El codigo de barras debe estar guardado como texto para conservar ceros iniciales.');
        }
        const value = importCell(cell);
        data[header] = typeof value === 'string' ? value.trim() : value;
      } catch (error) {
        data[header] = '';
        readErrors.push(error.message);
      }
      if (data[header] !== '' && data[header] !== null && data[header] !== undefined) hasValue = true;
    }
    if (readErrors.length) data.erroresLectura = [...new Set(readErrors)];
    if (hasValue || readErrors.length) rows.push(data);
  }
  return rows;
}

function normalizedImportInput(row) {
  const nombre = cleanText(row.nombre, 160);
  if (!nombre) throw catalogError(400, 'El nombre es obligatorio.');
  const data = {
    nombre,
    nombreNormalizado: normalizeText(nombre),
    codigoBarras: normalizeBarcode(row.codigoBarras),
    presentacion: cleanText(row.presentacion, 60) || null,
    contenidoCantidad: row.contenidoCantidad === '' || row.contenidoCantidad === null
      ? null : Number(row.contenidoCantidad),
    contenidoUnidad: cleanText(row.contenidoUnidad, 30) || null,
    unidadesPorPaquete: positiveInteger(row.unidadesPorPaquete, 'Unidades por paquete'),
    permiteVentaPorUnidad: booleanValue(row.permiteVentaPorUnidad, true),
    permiteVentaPorPaquete: booleanValue(row.permiteVentaPorPaquete, false),
    descripcion: cleanText(row.descripcion, 500) || null,
    marca: cleanText(row.marca, 100) || null,
    categoria: cleanText(row.categoria, 100) || null
  };
  if (data.contenidoCantidad !== null && (!Number.isFinite(data.contenidoCantidad) || data.contenidoCantidad <= 0)) {
    throw catalogError(400, 'El contenido debe ser un numero positivo.');
  }
  if ((data.contenidoCantidad === null) !== (data.contenidoUnidad === null)) {
    throw catalogError(400, 'Contenido cantidad y unidad deben completarse juntos.');
  }
  if (!data.permiteVentaPorUnidad && !data.permiteVentaPorPaquete) {
    throw catalogError(400, 'Debe permitir venta por unidad o por paquete.');
  }
  if (data.permiteVentaPorPaquete && data.unidadesPorPaquete <= 1) {
    throw catalogError(400, 'La venta por paquete requiere mas de una unidad.');
  }
  data.huellaDuplicado = duplicateFingerprint(data, normalizeText(data.marca || ''));
  return data;
}

async function groupedMasterMatches(connection, column, values) {
  const groups = new Map();
  const uniqueValues = [...new Set(values.filter(Boolean))];
  for (let offset = 0; offset < uniqueValues.length; offset += 400) {
    const batch = uniqueValues.slice(offset, offset + 400);
    const placeholders = batch.map(() => '?').join(',');
    const [matches] = await connection.query(
      `SELECT idProductoMaestro, nombre, ${column} valor
       FROM productoMaestro WHERE ${column} IN (${placeholders})`,
      batch
    );
    for (const match of matches) {
      if (!groups.has(match.valor)) groups.set(match.valor, []);
      if (groups.get(match.valor).length < 10) {
        groups.get(match.valor).push({ idProductoMaestro: match.idProductoMaestro, nombre: match.nombre });
      }
    }
  }
  return groups;
}

async function previewRows(connection, rows) {
  const prepared = rows.map((row) => {
    try {
      if (Array.isArray(row.erroresLectura) && row.erroresLectura.length) {
        throw catalogError(400, row.erroresLectura.join(' '));
      }
      return { row, data: normalizedImportInput(row), error: null };
    } catch (error) {
      return { row, data: null, error };
    }
  });
  const validData = prepared.filter((item) => item.data).map((item) => item.data);
  const [barcodeMatches, fingerprintMatches, categories, brands] = await Promise.all([
    groupedMasterMatches(connection, 'codigoBarras', validData.map((data) => data.codigoBarras)),
    groupedMasterMatches(connection, 'huellaDuplicado', validData.map((data) => data.huellaDuplicado)),
    connection.query('SELECT nombreNormalizado, activo FROM categoriaMaestra'),
    connection.query('SELECT nombreNormalizado, activo FROM marcaMaestra')
  ]);
  const categoryState = new Map(categories[0].map((row) => [row.nombreNormalizado, Number(row.activo)]));
  const brandState = new Map(brands[0].map((row) => [row.nombreNormalizado, Number(row.activo)]));
  const preview = [];
  const seenBarcodes = new Map();
  const seenFingerprints = new Map();

  for (const item of prepared) {
    const { row, data } = item;
    try {
      if (item.error) throw item.error;
      const categoryNormalized = normalizeText(data.categoria || '');
      const brandNormalized = normalizeText(data.marca || '');
      if (categoryNormalized && categoryState.get(categoryNormalized) === 0) {
        throw catalogError(409, 'La categoria maestra indicada esta desactivada.');
      }
      if (brandNormalized && brandState.get(brandNormalized) === 0) {
        throw catalogError(409, 'La marca maestra indicada esta desactivada.');
      }

      let duplicates = data.codigoBarras ? (barcodeMatches.get(data.codigoBarras) || []) : [];
      let duplicateType = duplicates.length ? 'codigo_barras' : null;
      if (!duplicates.length) {
        duplicates = fingerprintMatches.get(data.huellaDuplicado) || [];
        if (duplicates.length) duplicateType = 'posible';
      }
      if (!duplicates.length && data.codigoBarras && seenBarcodes.has(data.codigoBarras)) {
        duplicates = [{ fila: seenBarcodes.get(data.codigoBarras), nombre: 'Otra fila del archivo' }];
        duplicateType = 'codigo_barras';
      }
      if (!duplicates.length && seenFingerprints.has(data.huellaDuplicado)) {
        duplicates = [{ fila: seenFingerprints.get(data.huellaDuplicado), nombre: 'Otra fila del archivo' }];
        duplicateType = 'posible';
      }
      if (!duplicates.length) {
        if (data.codigoBarras) seenBarcodes.set(data.codigoBarras, row.fila);
        seenFingerprints.set(data.huellaDuplicado, row.fila);
      }
      const duplicateConfirmed = duplicateType === 'posible' && booleanValue(row.confirmarDuplicado, false);
      preview.push({
        ...row,
        valido: duplicates.length === 0 || duplicateConfirmed,
        duplicado: duplicates.length > 0,
        tipoDuplicado: duplicateType,
        duplicadoConfirmable: duplicateType === 'posible',
        confirmarDuplicado: duplicateConfirmed,
        errores: [],
        coincidencias: duplicates
      });
    } catch (error) {
      preview.push({ ...row, valido: false, duplicado: false, errores: [error.message], coincidencias: [] });
    }
  }
  return preview;
}

router.get('/importaciones/plantilla.xlsx', asyncRoute(async (req, res) => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Catalogo maestro');
  sheet.addRow(IMPORT_HEADERS);
  sheet.getRow(1).font = { bold: true };
  sheet.columns.forEach((column) => { column.width = 22; });
  sheet.getColumn(4).numFmt = '@';
  const buffer = await workbook.xlsx.writeBuffer();
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="plantilla-catalogo-maestro.xlsx"');
  res.send(Buffer.from(buffer));
}));

router.post('/importaciones/previsualizar', upload.single('archivo'), asyncRoute(async (req, res) => {
  if (!req.file) throw catalogError(400, 'Debe seleccionar un archivo .xlsx.');
  const rows = await readWorkbookRows(req.file.buffer);
  const preview = await previewRows(pool, rows);
  res.json({
    total: preview.length,
    validos: preview.filter((row) => row.valido).length,
    duplicados: preview.filter((row) => row.duplicado).length,
    invalidos: preview.filter((row) => row.errores.length).length,
    filas: preview
  });
}));

router.post('/importaciones/confirmar', asyncRoute(async (req, res) => {
  const rows = Array.isArray(req.body?.filas) ? req.body.filas : [];
  if (!rows.length || rows.length > MAX_IMPORT_ROWS) throw catalogError(400, 'La cantidad de filas a importar no es valida.');
  const result = await transaction(async (connection) => {
    const freshPreview = await previewRows(connection, rows);
    const summary = { creados: 0, omitidos: 0, duplicados: 0, invalidos: 0, resultados: [] };
    for (const row of freshPreview) {
      if (!row.valido) {
        if (row.duplicado) summary.duplicados += 1;
        else summary.invalidos += 1;
        summary.omitidos += 1;
        summary.resultados.push({ fila: row.fila, creado: false, duplicado: row.duplicado, errores: row.errores });
        continue;
      }
      const normalized = normalizedImportInput(row);
      const idCategoriaMaestra = await findOrCreateTaxonomy(connection, 'categoria', normalized.categoria, req.session.admin.id);
      const idMarcaMaestra = await findOrCreateTaxonomy(connection, 'marca', normalized.marca, req.session.admin.id);
      const created = await createMasterProduct(connection, {
        ...normalized,
        idCategoriaMaestra,
        idMarcaMaestra,
        activo: true,
        confirmarDuplicado: row.confirmarDuplicado === true
      }, req.session.admin.id);
      summary.creados += 1;
      summary.resultados.push({ fila: row.fila, creado: true, idProductoMaestro: created.idProductoMaestro });
    }
    await auditCatalog(connection, req.session.admin.id, 'importacion_confirmada', 'importacion', null, {
      total: rows.length,
      creados: summary.creados,
      omitidos: summary.omitidos,
      duplicados: summary.duplicados,
      invalidos: summary.invalidos
    });
    return summary;
  });
  res.status(201).json({ message: 'Importacion procesada.', ...result });
}));

router.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    return res.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: 'El archivo no cumple los limites permitidos.' });
  }
  if (error.code === 'ER_DUP_ENTRY') {
    return res.status(409).json({ error: 'Ya existe un registro con esos datos unicos.' });
  }
  if (error.status) {
    return res.status(error.status).json({
      error: error.message,
      ...(error.code ? { code: error.code } : {}),
      ...(error.details ? { duplicados: error.details } : {})
    });
  }
  console.error('Error en catalogo maestro administrativo:', error.message);
  return res.status(500).json({ error: 'No se pudo completar la operacion del catalogo maestro.' });
});

module.exports = router;
