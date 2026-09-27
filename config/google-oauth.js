const { isHostedEnvironment } = require('./database-options');

function clean(value) {
  return String(value || '').trim();
}

function googleOauthConfig(environment = process.env) {
  const clientId = clean(environment.GOOGLE_OAUTH_CLIENT_ID);
  const clientSecret = clean(environment.GOOGLE_OAUTH_CLIENT_SECRET);
  const redirectUri = clean(environment.GOOGLE_OAUTH_REDIRECT_URI);
  const configured = [clientId, clientSecret, redirectUri].filter(Boolean).length;
  if (!configured) return Object.freeze({ enabled: false });
  if (configured !== 3) {
    throw new Error('Google OAuth requiere client ID, client secret y redirect URI juntos.');
  }
  if (!clientId.endsWith('.apps.googleusercontent.com') || clientSecret.length < 12) {
    throw new Error('La configuracion de Google OAuth no tiene el formato esperado.');
  }
  let redirect;
  try { redirect = new URL(redirectUri); } catch { throw new Error('GOOGLE_OAUTH_REDIRECT_URI debe ser una URL valida.'); }
  if (redirect.pathname !== '/auth/google/callback' || redirect.search || redirect.hash) {
    throw new Error('GOOGLE_OAUTH_REDIRECT_URI debe terminar exactamente en /auth/google/callback.');
  }
  const hosted = isHostedEnvironment(environment);
  if (hosted && redirect.protocol !== 'https:') {
    throw new Error('Google OAuth hospedado exige una redirect URI HTTPS.');
  }
  if (!hosted && redirect.protocol !== 'https:'
    && !(redirect.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(redirect.hostname))) {
    throw new Error('Google OAuth local solo permite HTTP en localhost.');
  }
  if (hosted && clean(environment.APP_BASE_URL)) {
    const base = new URL(clean(environment.APP_BASE_URL));
    if (base.origin !== redirect.origin) throw new Error('La redirect URI de Google debe usar el mismo origen que APP_BASE_URL.');
  }
  return Object.freeze({ enabled: true, clientId, clientSecret, redirectUri: redirect.toString() });
}

module.exports = { googleOauthConfig };
