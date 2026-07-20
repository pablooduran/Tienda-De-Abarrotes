const { formatLocalDateTime } = require('../utils/local-datetime');
const { creditError } = require('./customer-credit-service');

const TEMPLATE_TYPES = Object.freeze([
  'recordatorio_previo',
  'deuda_vencida',
  'confirmacion_pago',
  'estado_cuenta'
]);

const COMMON_VARIABLES = [
  'tienda', 'cliente', 'telefono', 'saldo', 'fecha', 'fecha_vencimiento',
  'fecha_prometida', 'vencimiento', 'dias_atraso', 'comprobante'
];

const TEMPLATE_VARIABLES = Object.freeze({
  recordatorio_previo: Object.freeze([...COMMON_VARIABLES]),
  deuda_vencida: Object.freeze([...COMMON_VARIABLES]),
  confirmacion_pago: Object.freeze([
    ...COMMON_VARIABLES, 'monto_pagado', 'metodo_pago', 'saldo_restante', 'referencia'
  ]),
  estado_cuenta: Object.freeze([
    ...COMMON_VARIABLES, 'saldo_inicial', 'debitos', 'creditos', 'saldo_final', 'periodo'
  ])
});

const INTERNAL_TEMPLATES = Object.freeze({
  recordatorio_previo: 'Hola {cliente}, le recordamos que su saldo en {tienda} es {saldo} y vence el {vencimiento}.',
  deuda_vencida: 'Hola {cliente}, su saldo vencido en {tienda} es {saldo}. Agradecemos coordinar su pago.',
  confirmacion_pago: 'Hola {cliente}, registramos su pago de {monto_pagado} en {tienda}. Saldo restante: {saldo_restante}.',
  estado_cuenta: 'Hola {cliente}, su estado de cuenta en {tienda} muestra un saldo de {saldo_final}.'
});

const VALID_TOKEN = /\{\{([a-z_]+)\}\}|\{([a-z_]+)\}/g;
const DANGEROUS_HTML = /<\s*\/?\s*(?:script|style|iframe|object|embed|svg|math|link|meta)\b|\bon[a-z]+\s*=|javascript\s*:|data\s*:\s*text\/html/i;
const INVALID_CONTROLS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

function templateType(value) {
  const type = String(value || '').trim().toLowerCase();
  if (!TEMPLATE_TYPES.includes(type)) {
    throw creditError(400, 'El tipo de plantilla no es valido.', 'PLANTILLA_TIPO_INVALIDO');
  }
  return type;
}

function templateName(value) {
  const name = String(value ?? '').trim();
  if (!name) throw creditError(400, 'El nombre de la plantilla es obligatorio.', 'PLANTILLA_NOMBRE_REQUERIDO');
  if (name.length > 100 || INVALID_CONTROLS.test(name)) {
    throw creditError(400, 'El nombre de la plantilla no es valido.', 'PLANTILLA_NOMBRE_INVALIDO');
  }
  return name;
}

function templateContent(value, type) {
  const content = String(value ?? '').trim();
  if (!content) throw creditError(400, 'El contenido de la plantilla es obligatorio.', 'PLANTILLA_CONTENIDO_REQUERIDO');
  if (content.length > 2000 || INVALID_CONTROLS.test(content) || DANGEROUS_HTML.test(content)) {
    throw creditError(400, 'El contenido contiene elementos no permitidos.', 'PLANTILLA_CONTENIDO_INVALIDO');
  }
  const allowed = new Set(TEMPLATE_VARIABLES[type]);
  const variables = [];
  const remainder = content.replace(VALID_TOKEN, (_, doubleName, singleName) => {
    const name = doubleName || singleName;
    variables.push(name);
    return '';
  });
  if (/[{}]/.test(remainder) || variables.some((variable) => !allowed.has(variable))) {
    throw creditError(400, 'La plantilla contiene variables no permitidas.', 'PLANTILLA_VARIABLE_INVALIDA');
  }
  return content;
}

function activeValue(value, { optional = false } = {}) {
  if (optional && value === undefined) return undefined;
  if (value === true || value === 1 || value === '1') return 1;
  if (value === false || value === 0 || value === '0') return 0;
  throw creditError(400, 'El estado activo de la plantilla no es valido.', 'PLANTILLA_ACTIVO_INVALIDO');
}

function positiveId(value, label = 'La plantilla') {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw creditError(400, `${label} no es valida.`);
  return id;
}

function duplicateTemplateError(error) {
  if (error?.code === 'ER_DUP_ENTRY') {
    throw creditError(409, 'Ya existe una plantilla con ese tipo y nombre.', 'PLANTILLA_DUPLICADA');
  }
  throw error;
}

async function listTemplates(connection, idTienda, query = {}) {
  const page = query.pagina === undefined ? 1 : Number(query.pagina);
  const limit = query.limite === undefined ? 50 : Number(query.limite);
  if (!Number.isInteger(page) || page < 1 || !Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw creditError(400, 'La paginacion de plantillas no es valida.', 'PLANTILLA_PAGINACION_INVALIDA');
  }
  const clauses = ['idTienda=?'];
  const params = [idTienda];
  if (query.tipo !== undefined && query.tipo !== '') {
    clauses.push('tipo=?');
    params.push(templateType(query.tipo));
  }
  if (query.activo !== undefined && query.activo !== '') {
    clauses.push('activo=?');
    params.push(activeValue(query.activo));
  }
  if (query.busqueda !== undefined && String(query.busqueda).trim()) {
    const search = String(query.busqueda).trim();
    if (search.length > 100 || INVALID_CONTROLS.test(search)) {
      throw creditError(400, 'La busqueda de plantillas no es valida.', 'PLANTILLA_BUSQUEDA_INVALIDA');
    }
    clauses.push('nombre LIKE ?');
    params.push(`%${search}%`);
  }
  const where = clauses.join(' AND ');
  const [[rows], [countRows]] = await Promise.all([
    connection.query(
      `SELECT idPlantillaCobranza,tipo,nombre,contenido,activo,creadoEn,actualizadoEn
       FROM plantillaCobranzaTienda WHERE ${where}
       ORDER BY tipo,nombre,idPlantillaCobranza LIMIT ? OFFSET ?`,
      [...params, limit, (page - 1) * limit]
    ),
    connection.query(`SELECT COUNT(*) total FROM plantillaCobranzaTienda WHERE ${where}`, params)
  ]);
  const total = Number(countRows[0].total || 0);
  return {
    plantillas: rows.map((row) => ({ ...row, activo: Boolean(row.activo) })),
    pagina: page,
    limite: limit,
    total,
    totalPaginas: Math.max(1, Math.ceil(total / limit)),
    variablesPermitidas: TEMPLATE_VARIABLES
  };
}

async function createTemplate(connection, input) {
  const type = templateType(input.body?.tipo);
  const name = templateName(input.body?.nombre);
  const content = templateContent(input.body?.contenido, type);
  const active = input.body?.activo === undefined ? 1 : activeValue(input.body.activo);
  const now = formatLocalDateTime();
  try {
    const [result] = await connection.query(
      `INSERT INTO plantillaCobranzaTienda
       (idTienda,tipo,nombre,contenido,activo,creadoEn,actualizadoEn,idAdministradorActualiza)
       VALUES (?,?,?,?,?,?,?,?)`,
      [input.idTienda, type, name, content, active, now, now, input.idAdministrador]
    );
    return getTemplate(connection, input.idTienda, result.insertId);
  } catch (error) {
    return duplicateTemplateError(error);
  }
}

async function getTemplate(connection, idTienda, idPlantilla, { forUpdate = false } = {}) {
  const [rows] = await connection.query(
    `SELECT idPlantillaCobranza,tipo,nombre,contenido,activo,creadoEn,actualizadoEn
     FROM plantillaCobranzaTienda WHERE idTienda=? AND idPlantillaCobranza=?${forUpdate ? ' FOR UPDATE' : ''}`,
    [idTienda, positiveId(idPlantilla)]
  );
  if (!rows.length) throw creditError(404, 'Plantilla no encontrada.', 'PLANTILLA_NO_ENCONTRADA');
  return { ...rows[0], activo: Boolean(rows[0].activo) };
}

async function updateTemplate(connection, input) {
  const current = await getTemplate(connection, input.idTienda, input.idPlantilla, { forUpdate: true });
  if (input.body?.tipo !== undefined && templateType(input.body.tipo) !== current.tipo) {
    throw creditError(409, 'El tipo de una plantilla existente no puede cambiarse.', 'PLANTILLA_TIPO_INMUTABLE');
  }
  const name = input.body?.nombre === undefined ? current.nombre : templateName(input.body.nombre);
  const content = input.body?.contenido === undefined
    ? current.contenido : templateContent(input.body.contenido, current.tipo);
  const active = activeValue(input.body?.activo, { optional: true });
  try {
    await connection.query(
      `UPDATE plantillaCobranzaTienda
       SET nombre=?,contenido=?,activo=?,actualizadoEn=?,idAdministradorActualiza=?
       WHERE idTienda=? AND idPlantillaCobranza=?`,
      [name, content, active === undefined ? Number(current.activo) : active, formatLocalDateTime(),
        input.idAdministrador, input.idTienda, current.idPlantillaCobranza]
    );
    return getTemplate(connection, input.idTienda, current.idPlantillaCobranza);
  } catch (error) {
    return duplicateTemplateError(error);
  }
}

async function setTemplateActive(connection, input) {
  const current = await getTemplate(connection, input.idTienda, input.idPlantilla, { forUpdate: true });
  const desired = Boolean(input.active);
  if (current.activo === desired) {
    throw creditError(409, desired ? 'La plantilla ya esta activa.' : 'La plantilla ya esta inactiva.',
      desired ? 'PLANTILLA_YA_ACTIVA' : 'PLANTILLA_YA_INACTIVA');
  }
  await connection.query(
    `UPDATE plantillaCobranzaTienda
     SET activo=?,actualizadoEn=?,idAdministradorActualiza=?
     WHERE idTienda=? AND idPlantillaCobranza=?`,
    [desired ? 1 : 0, formatLocalDateTime(), input.idAdministrador, input.idTienda, current.idPlantillaCobranza]
  );
  return getTemplate(connection, input.idTienda, current.idPlantillaCobranza);
}

async function resolveActiveTemplate(connection, input) {
  const type = templateType(input.tipo);
  let rows;
  if (input.idPlantilla) {
    [rows] = await connection.query(
      `SELECT idPlantillaCobranza,tipo,nombre,contenido,activo,actualizadoEn
       FROM plantillaCobranzaTienda WHERE idTienda=? AND idPlantillaCobranza=?`,
      [input.idTienda, positiveId(input.idPlantilla)]
    );
    if (!rows.length) throw creditError(404, 'Plantilla no encontrada.', 'PLANTILLA_NO_ENCONTRADA');
    if (!rows[0].activo) throw creditError(409, 'La plantilla seleccionada esta inactiva.', 'PLANTILLA_INACTIVA');
    if (rows[0].tipo !== type) throw creditError(409, 'La plantilla no corresponde al tipo solicitado.', 'PLANTILLA_TIPO_INCORRECTO');
  } else {
    [rows] = await connection.query(
      `SELECT idPlantillaCobranza,tipo,nombre,contenido,activo,actualizadoEn
       FROM plantillaCobranzaTienda
       WHERE idTienda=? AND tipo=? AND activo=1
       ORDER BY actualizadoEn DESC,idPlantillaCobranza DESC LIMIT 1`,
      [input.idTienda, type]
    );
  }
  if (rows.length) {
    templateContent(rows[0].contenido, type);
    return { ...rows[0], activo: true, origen: 'tienda' };
  }
  return {
    idPlantillaCobranza: null,
    tipo: type,
    nombre: 'Texto predeterminado del sistema',
    contenido: INTERNAL_TEMPLATES[type],
    activo: true,
    actualizadoEn: null,
    origen: 'fallback_interno'
  };
}

function renderTemplate(template, values = {}) {
  templateContent(template.contenido, template.tipo);
  return template.contenido.replace(VALID_TOKEN, (_, doubleName, singleName) => {
    const value = values[doubleName || singleName];
    return value === null || value === undefined ? '' : String(value);
  });
}

module.exports = {
  TEMPLATE_TYPES,
  TEMPLATE_VARIABLES,
  createTemplate,
  getTemplate,
  listTemplates,
  renderTemplate,
  resolveActiveTemplate,
  setTemplateActive,
  templateContent,
  templateType,
  updateTemplate
};
