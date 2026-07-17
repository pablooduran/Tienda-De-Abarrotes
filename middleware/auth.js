function isAuthenticated(req) {
  const admin = req.session?.admin;
  if (!admin || !admin.id || !admin.usuario || !['dueno_tienda', 'superadmin'].includes(admin.rol)) return false;
  if (admin.rol === 'superadmin') return admin.idTienda === null;
  const idTienda = Number(admin.idTienda);
  return Number.isInteger(idTienda) && idTienda > 0;
}

function requireAuth(req, res, next) {
  if (isAuthenticated(req)) return next();

  if (req.originalUrl.startsWith('/api')) {
    return res.status(401).json({ error: 'Debe iniciar sesion.' });
  }

  return res.redirect('/login.html');
}

module.exports = { isAuthenticated, requireAuth };
