const EXIT_CODES = Object.freeze({
  healthy: 0,
  degraded: 1,
  unhealthy: 2,
  error: 3
});

function validateCheckEnvironment(environment = process.env) {
  const appEnvironment = String(environment.APP_ENV || '').trim().toLowerCase();
  if (!appEnvironment) {
    throw new Error('APP_ENV debe definirse explicitamente para el comprobador operativo.');
  }
  if (appEnvironment !== 'local') {
    throw new Error('El comprobador operativo solo esta habilitado con APP_ENV=local.');
  }
  return appEnvironment;
}

function publicSummary(diagnostic) {
  const checks = diagnostic?.checks || {};
  return {
    status: diagnostic?.status || 'unhealthy',
    checks: {
      application: checks.app?.status || 'error',
      database: checks.database?.status || 'error',
      migrations: checks.migrations?.status || 'error',
      backup: {
        status: checks.backup?.status || 'error',
        code: checks.backup?.code || 'BACKUP_CHECK_FAILED'
      }
    },
    checkedAt: diagnostic?.checkedAt || new Date().toISOString(),
    durationMs: Number.isFinite(diagnostic?.durationMs)
      ? Number(Math.max(0, diagnostic.durationMs).toFixed(1))
      : 0
  };
}

async function runOperationalCheck(options = {}) {
  const {
    environment = process.env,
    diagnosticService,
    write = (value) => console.log(JSON.stringify(value))
  } = options;
  validateCheckEnvironment(environment);
  if (!diagnosticService || typeof diagnosticService.diagnose !== 'function') {
    throw new Error('El comprobador operativo requiere el servicio de diagnostico.');
  }
  const diagnostic = await diagnosticService.diagnose();
  const summary = publicSummary(diagnostic);
  write(summary);
  return EXIT_CODES[summary.status] ?? EXIT_CODES.error;
}

async function createLocalRuntime() {
  validateCheckEnvironment(process.env);
  const { requireLocalhostDatabase } = require('../config/env');
  requireLocalhostDatabase('El comprobador operativo');
  const pool = require('../config/db');
  const { webSecurityConfig } = require('../config/web-security');
  const { createBackupStatusService } = require('../services/backup-status-service');
  const {
    createOperationalDiagnosticService,
    createOperationalHealthService
  } = require('../services/operational-health-service');
  const config = webSecurityConfig();
  const healthService = createOperationalHealthService({
    pool,
    softLimitMs: config.operationalHealth.softLimitMs,
    timeoutMs: config.operationalHealth.timeoutMs,
    cacheMs: 0
  });
  const backupStatusService = createBackupStatusService({
    warningHours: config.operationalBackup.warningHours,
    criticalHours: config.operationalBackup.criticalHours,
    cacheMs: 0
  });
  return {
    diagnosticService: createOperationalDiagnosticService({
      healthService,
      backupStatusService
    }),
    close: () => pool.end()
  };
}

async function main() {
  let runtime;
  try {
    validateCheckEnvironment(process.env);
    runtime = await createLocalRuntime();
    process.exitCode = await runOperationalCheck({
      environment: process.env,
      diagnosticService: runtime.diagnosticService
    });
  } catch {
    console.error(JSON.stringify({
      status: 'error',
      code: 'OPERATIONAL_CHECK_CONFIGURATION_ERROR'
    }));
    process.exitCode = EXIT_CODES.error;
  } finally {
    if (runtime) {
      try {
        await runtime.close();
      } catch {
        process.exitCode = EXIT_CODES.error;
      }
    }
  }
}

if (require.main === module) {
  void main();
}

module.exports = {
  EXIT_CODES,
  createLocalRuntime,
  publicSummary,
  runOperationalCheck,
  validateCheckEnvironment
};
