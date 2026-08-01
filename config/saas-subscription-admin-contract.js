const FILTERS = Object.freeze({
  estado: Object.freeze(['pendiente', 'activa', 'gracia', 'vencida', 'suspendida', 'cancelada']),
  acceso: Object.freeze(['completo', 'solo_lectura', 'restringido']),
  tipo: Object.freeze(['prueba', 'pagada', 'cortesia']),
  orden: Object.freeze(['tienda', 'vencimiento', 'estado', 'plan'])
});

const ACTION_FIELDS = Object.freeze({
  suspender: Object.freeze(['motivo']),
  reactivar: Object.freeze(['periodo']),
  renovar: Object.freeze(['periodo']),
  cancelar: Object.freeze(['motivo']),
  upgrade: Object.freeze(['codigoPlan']),
  downgrade: Object.freeze(['codigoPlan'])
});

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function inputError(message, code = 'INVALID_SAAS_SUBSCRIPTION_INPUT') {
  const error = new Error(message);
  error.status = 400;
  error.code = code;
  return error;
}

function storeReference(value) {
  const reference = String(value || '').trim().toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9-]{0,118}[a-z0-9])?$/.test(reference)) {
    throw inputError('La referencia de tienda no es valida.');
  }
  return reference;
}

function pageNumber(value, fallback, maximum) {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw inputError('La paginacion no es valida.');
  }
  return parsed;
}

function optionalCode(value, allowed, label) {
  const code = String(value || '').trim().toLowerCase();
  if (!code) return null;
  if (allowed && !allowed.includes(code)) throw inputError(`${label} no es valido.`);
  if (!/^[a-z][a-z0-9_]{1,79}$/.test(code)) throw inputError(`${label} no es valido.`);
  return code;
}

function optionalDate(value, label) {
  const date = String(value || '').trim();
  if (!date) return null;
  if (!DATE_PATTERN.test(date)) throw inputError(`${label} no es valida.`);
  const [year, month, day] = date.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
    throw inputError(`${label} no es valida.`);
  }
  return date;
}

function listQuery(query = {}) {
  const search = String(query.texto || '').trim();
  if (search.length > 120) throw inputError('La busqueda es demasiado larga.');
  return Object.freeze({
    search,
    estado: optionalCode(query.estado, FILTERS.estado, 'El estado'),
    acceso: optionalCode(query.acceso, FILTERS.acceso, 'El acceso'),
    tipo: optionalCode(query.tipo, FILTERS.tipo, 'El tipo'),
    plan: optionalCode(query.plan, null, 'El plan'),
    vencimiento: optionalCode(query.vencimiento, ['proximo', 'gracia'], 'El vencimiento'),
    downgrade: query.downgrade === 'true',
    excedidos: query.excedidos === 'true',
    orden: optionalCode(query.orden, FILTERS.orden, 'El orden') || 'vencimiento',
    page: pageNumber(query.pagina, 1, 100000),
    pageSize: pageNumber(query.limite, 20, 100)
  });
}

function historyQuery(query = {}) {
  const desde = optionalDate(query.desde, 'La fecha inicial');
  const hasta = optionalDate(query.hasta, 'La fecha final');
  if (desde && hasta && desde > hasta) throw inputError('El rango de fechas no es valido.');
  return Object.freeze({
    operation: optionalCode(query.operacion, null, 'La operacion'),
    previousState: optionalCode(query.estadoAnterior, FILTERS.estado, 'El estado anterior'),
    nextState: optionalCode(query.estadoNuevo, FILTERS.estado, 'El estado nuevo'),
    actor: optionalCode(query.actor, ['administrador', 'sistema', 'anonimo', 'migracion'], 'El actor'),
    desde,
    hasta,
    page: pageNumber(query.paginaHistorial, 1, 100000),
    pageSize: pageNumber(query.limiteHistorial, 20, 50)
  });
}

function actionBody(action, body = {}) {
  const allowed = ACTION_FIELDS[action];
  if (!allowed) throw inputError('La accion administrativa no es valida.');
  const source = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  const unknown = Object.keys(source).filter((field) => !allowed.includes(field));
  if (unknown.length) throw inputError('La solicitud contiene campos no permitidos.', 'SAAS_SUBSCRIPTION_FIELDS_NOT_ALLOWED');
  if (action === 'suspender' || action === 'cancelar') {
    return Object.freeze({ motivo: optionalCode(source.motivo, [
      'falta_pago', 'incumplimiento', 'solicitud_administrativa', 'seguridad', 'otro_controlado'
    ], 'El motivo') });
  }
  if (action === 'reactivar' || action === 'renovar') {
    return Object.freeze({ periodo: optionalCode(source.periodo, ['mensual', 'anual'], 'El periodo') });
  }
  return Object.freeze({ codigoPlan: optionalCode(source.codigoPlan, null, 'El plan') });
}

module.exports = { actionBody, historyQuery, listQuery, storeReference };
