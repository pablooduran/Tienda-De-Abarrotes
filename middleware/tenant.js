function requireTenant(req, res, next) {
  const admin = req.auth;
  if (!admin) return res.status(401).json({ error: 'Debe iniciar sesion.' });
  if (admin.rol !== 'dueno_tienda') {
    return res.status(403).json({ error: 'Debe seleccionar una tienda antes de usar las funciones operativas.' });
  }

  const idTienda = Number(admin.idTienda);
  if (!Number.isInteger(idTienda) || idTienda <= 0) {
    return res.status(403).json({ error: 'La sesion no tiene una tienda valida.' });
  }

  req.tenant = Object.freeze({ idTienda });
  return next();
}

module.exports = { requireTenant };
