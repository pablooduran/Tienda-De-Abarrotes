const { canAccessCommercialPath } = require('../config/team-roles');

function requireCommercialPermission(req, res, next) {
  if (canAccessCommercialPath(req.auth?.rol, req.path, req.method)) return next();
  return res.status(403).json({
    error: 'Tu rol no tiene permiso para usar esta sección.',
    code: 'TEAM_PERMISSION_REQUIRED'
  });
}

module.exports = { requireCommercialPermission };
