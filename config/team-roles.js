const TENANT_ROLES = Object.freeze(['dueno_tienda', 'encargado', 'cajero', 'inventario']);

const ROLE_DETAILS = Object.freeze({
  dueno_tienda: Object.freeze({ nombre: 'Propietario', descripcion: 'Control total de la tienda y su suscripcion.' }),
  encargado: Object.freeze({ nombre: 'Encargado', descripcion: 'Opera ventas, clientes e inventario; no modifica la cuenta ni el equipo.' }),
  cajero: Object.freeze({ nombre: 'Caja', descripcion: 'Registra ventas, consulta clientes y cobra fiados.' }),
  inventario: Object.freeze({ nombre: 'Inventario', descripcion: 'Gestiona productos, proveedores, compras y movimientos de stock.' })
});

function isTenantRole(role) {
  return TENANT_ROLES.includes(role);
}

function canAccessCommercialPath(role, path, method = 'GET') {
  if (role === 'dueno_tienda' || role === 'encargado') return true;
  const normalized = String(path || '').split('?')[0];
  if (role === 'cajero') {
    if (/^\/(contexto|dashboard|pos|ventas)(?:\/|$)/.test(normalized)) return true;
    if (/^\/(clientes|fiados|cobros-fiado|cobranza)(?:\/|$)/.test(normalized)) return method === 'GET';
    return method === 'POST' && /^\/(pagos-fiado|fiados\/\d+\/pagos)(?:\/|$)/.test(normalized);
  }
  if (role === 'inventario') {
    return /^\/(contexto|dashboard|productos|proveedores|compras|movimientos-stock|inventario-inteligente|lotes)(?:\/|$)/.test(normalized);
  }
  return false;
}

function roleSections(role) {
  if (role === 'dueno_tienda' || role === 'encargado') return null;
  if (role === 'cajero') return Object.freeze(['inicio', 'ventas', 'historialVentas', 'pagos', 'clientes']);
  if (role === 'inventario') return Object.freeze([
    'inicio', 'productos', 'catalogoMaestro', 'movimientosStock', 'inventarioInteligente',
    'inventarioOperativo', 'lotesVencimientos', 'proveedores', 'compras'
  ]);
  return Object.freeze([]);
}

module.exports = { ROLE_DETAILS, TENANT_ROLES, canAccessCommercialPath, isTenantRole, roleSections };
