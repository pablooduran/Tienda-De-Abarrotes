function normalizeAppEnvironment(value) {
  return String(value || '').trim().toLowerCase();
}

function resolveEnvironmentFile(value) {
  return normalizeAppEnvironment(value) === 'local' ? '.env.local' : '.env';
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
