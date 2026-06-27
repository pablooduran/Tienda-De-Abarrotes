function requireAuth(req, res, next) {
  if (req.session && req.session.admin) {
    return next();
  }

  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'Debe iniciar sesion.' });
  }

  return res.redirect('/login.html');
}

module.exports = { requireAuth };
