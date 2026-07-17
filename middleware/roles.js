function requireRole(...allowedRoles) {
  return (req, res, next) => {
    const role = req.session?.admin?.rol;
    if (!role) return res.status(401).json({ error: 'Debe iniciar sesion.' });
    if (!allowedRoles.includes(role)) {
      return res.status(403).json({ error: 'No tiene permisos para esta operacion.' });
    }
    return next();
  };
}

module.exports = { requireRole };
