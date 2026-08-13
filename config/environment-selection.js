function normalizeAppEnvironment(value) {
  return String(value || '').trim().toLowerCase();
}

function resolveEnvironmentFile(value) {
  const environment = normalizeAppEnvironment(value);
  if (environment === 'local') return '.env.local';
  if (environment === 'staging') return '.env.staging';
  if (environment === 'ci' || environment === 'test') return '.env.ci';
  if (environment === 'production') return '.env.production';
  return '.env';
}

function missingEnvironmentWarning(value) {
  if (normalizeAppEnvironment(value)) return null;
  return 'APP_ENV no esta definido: se cargara .env. Para desarrollo local use npm run start:local.';
}

module.exports = {
  missingEnvironmentWarning,
  normalizeAppEnvironment,
  resolveEnvironmentFile
};
