const ACCESS_LEVELS = Object.freeze({
  FULL: 'completo',
  READ_ONLY: 'solo_lectura',
  RESTRICTED: 'restringido'
});

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const RESTRICTED_PATHS = Object.freeze([
  /^\/api\/contexto\/?$/,
  /^\/api\/suscripcion\/?$/
]);
const GRACE_READ_PATHS = Object.freeze([
  ...RESTRICTED_PATHS,
  /^\/api\/dashboard(?:\/|$)/,
  /^\/api\/categorias(?:\/|$)/,
  /^\/api\/productos(?:\/|$)/,
  /^\/api\/clientes(?:\/|$)/,
  /^\/api\/proveedores(?:\/|$)/,
  /^\/api\/ventas(?:\/|$)/,
  /^\/api\/fiados(?:\/|$)/,
  /^\/api\/reportes(?:\/|$)/,
  /^\/api\/gastos(?:\/|$)/,
  /^\/api\/caja\/cierres(?:\/|$)/,
  /^\/api\/configuracion-credito\/?$/,
  /^\/api\/cobranza(?:\/|$)/,
  /^\/api\/plantillas-cobranza(?:\/|$)/,
  /^\/api\/cobros-fiado(?:\/|$)/,
  /^\/api\/pos(?:\/|$)/,
  /^\/api\/movimientos-stock(?:\/|$)/,
  /^\/api\/inventario(?:\/|$)/,
  /^\/api\/inventario-inteligente(?:\/|$)/,
  /^\/api\/lotes(?:\/|$)/,
  /^\/api\/compensaciones(?:\/|$)/,
  /^\/api\/auditoria(?:\/|$)/,
  /^\/api\/catalogo-maestro(?:\/|$)/
]);
const BLOCKED_READ_OUTPUTS = Object.freeze([
  /(?:^|\/)exportacion(?:es)?(?:\.|\/|$)/,
  /\.xlsx(?:\/|$)/,
  /(?:^|\/)comprobante(?:\/|$)/
]);

function accessLevelForStatus(status) {
  if (status === 'activa') return ACCESS_LEVELS.FULL;
  if (status === 'gracia') return ACCESS_LEVELS.READ_ONLY;
  return ACCESS_LEVELS.RESTRICTED;
}

function requestPath(value) {
  const raw = String(value || '/').split('?')[0];
  return raw.startsWith('/') ? raw : `/${raw}`;
}

function matchesAny(path, rules) {
  return rules.some((rule) => rule.test(path));
}

function subscriptionRequestDecision({ method, path, accessLevel }) {
  const normalizedMethod = String(method || 'GET').toUpperCase();
  const normalizedPath = requestPath(path);
  if (accessLevel === ACCESS_LEVELS.FULL) {
    return Object.freeze({ allowed: true, category: 'acceso_completo' });
  }
  if (!SAFE_METHODS.has(normalizedMethod)) {
    return Object.freeze({ allowed: false, category: 'escritura_bloqueada' });
  }
  if (matchesAny(normalizedPath, BLOCKED_READ_OUTPUTS)) {
    return Object.freeze({ allowed: false, category: 'salida_bloqueada' });
  }
  const rules = accessLevel === ACCESS_LEVELS.READ_ONLY ? GRACE_READ_PATHS : RESTRICTED_PATHS;
  return Object.freeze({
    allowed: matchesAny(normalizedPath, rules),
    category: accessLevel === ACCESS_LEVELS.READ_ONLY ? 'lectura_gracia' : 'acceso_restringido'
  });
}

function accessDescription(status) {
  const level = accessLevelForStatus(status);
  if (level === ACCESS_LEVELS.FULL) {
    return Object.freeze({
      nivel: level,
      mensaje: 'La suscripcion permite el acceso normal segun el plan.',
      siguienteAccion: 'continuar'
    });
  }
  if (level === ACCESS_LEVELS.READ_ONLY) {
    return Object.freeze({
      nivel: level,
      mensaje: 'El periodo termino y la tienda esta en gracia. Los datos pueden consultarse, pero no modificarse.',
      siguienteAccion: 'renovar'
    });
  }
  const cancelled = status === 'cancelada';
  return Object.freeze({
    nivel: level,
    mensaje: cancelled
      ? 'La suscripcion esta cancelada. Los datos permanecen conservados y el acceso comercial esta restringido.'
      : 'La suscripcion no permite acceso comercial. Los datos permanecen conservados.',
    siguienteAccion: cancelled ? 'contactar_soporte' : 'reactivar'
  });
}

module.exports = {
  ACCESS_LEVELS,
  accessDescription,
  accessLevelForStatus,
  subscriptionRequestDecision
};
