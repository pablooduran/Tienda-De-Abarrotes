const path = require('path');
const express = require('express');
const session = require('express-session');
const MySQLSessionStore = require('express-mysql-session')(session);

const { databaseConfig, isLocalEnvironment, logDatabaseTarget, sessionSecret } = require('./config/env');
const { deploymentConfig } = require('./config/deployment');
const { webSecurityConfig } = require('./config/web-security');
let appDatabaseConfig;
let appSessionSecret;
let appSecurityConfig;
let appDeploymentConfig;
try {
  appDeploymentConfig = deploymentConfig();
  appDatabaseConfig = databaseConfig();
  appSessionSecret = sessionSecret();
  appSecurityConfig = webSecurityConfig();
} catch (error) {
  console.error('No se pudo iniciar la aplicacion por una configuracion incompleta.');
  console.error(error.message);
  process.exit(1);
}

const pool = require('./config/db');
const { requireAuth } = require('./middleware/auth');
const { createErrorHandler, notFoundHandler } = require('./middleware/error-handler');
const { createRateLimiters } = require('./middleware/rate-limiters');
const { requestContext } = require('./middleware/request-context');
const { mutationProtection, noStoreSensitiveResponses } = require('./middleware/request-security');
const { createCommercialAuditMiddleware } = require('./middleware/administrative-audit-middleware');
const { requireRole } = require('./middleware/roles');
const { permissionsPolicy, securityHeaders } = require('./middleware/security-headers');
const {
  requireActiveSubscription,
  requireFullSubscriptionAccess,
  resolveSubscription
} = require('./middleware/subscription');
const { requireTenant } = require('./middleware/tenant');
const { createSecurityLogger } = require('./utils/security-logger');
const { administrativeAuditService } = require('./services/administrative-audit-service');
const { createAdminHealthRouter } = require('./routes/admin-health');
const { createHealthRouter } = require('./routes/health');
const { createBackupStatusService } = require('./services/backup-status-service');
const { createOperationalEventDispatcher } = require('./services/operational-event-dispatcher');
const {
  createOperationalDiagnosticService,
  createOperationalHealthService
} = require('./services/operational-health-service');
const {
  createOperationalMonitor,
  createOperationalStateTracker
} = require('./services/operational-state-tracker');
const {
  announceInitialReadiness,
  createGracefulShutdown,
  installShutdownHandlers
} = require('./services/server-lifecycle-service');
const adminCatalogRoutes = require('./routes/admin-catalog');
const adminRoutes = require('./routes/admin');
const { createAdminPaymentSubscriptionsRouter } = require('./routes/admin-payment-subscriptions');
const { createAdminPaymentReviewsRouter } = require('./routes/admin-payment-reviews');
const { createAdminSubscriptionsRouter } = require('./routes/admin-subscriptions');
const { createAuditRouter } = require('./routes/audit');
const apiRoutes = require('./routes/api');
const authRoutes = require('./routes/auth');
const customerCreditRoutes = require('./routes/customers-credit');
const financeRoutes = require('./routes/finance');
const financialCompensationRoutes = require('./routes/financial-compensations');
const inventoryAdjustmentRoutes = require('./routes/inventory-adjustments');
const inventoryIntelligenceRoutes = require('./routes/inventory-intelligence');
const lotRoutes = require('./routes/lots');
const masterCatalogRoutes = require('./routes/master-catalog');
const onboardingRoutes = require('./routes/onboarding');
const storeConfigurationRoutes = require('./routes/store-configuration');
const { createPaymentSubscriptionsRouter } = require('./routes/payment-subscriptions');
const subscriptionRoutes = require('./routes/subscription');
const posRoutes = require('./routes/pos');
const salesCompensationRoutes = require('./routes/sales-compensations');
const stockRoutes = require('./routes/stock');
const { ownerDestination } = require('./services/subscription-access-service');
const { createRateLimitStoreBackend } = require('./services/rate-limit-store-service');
const { createPrivateReceiptStorage } = require('./services/private-receipt-storage');

const app = express();
const PORT = process.env.PORT || 3000;
const securityLogger = createSecurityLogger(appSecurityConfig.logLevel);
administrativeAuditService.setLogger(securityLogger);
const rateLimitStore = createRateLimitStoreBackend(appDeploymentConfig.rateLimitStore, {
  logger: securityLogger
});
const privateReceiptStorage = appDeploymentConfig.privateStorage.enabled
  ? createPrivateReceiptStorage({ rootDirectory: appDeploymentConfig.privateStorage.root })
  : null;
const rateLimiters = createRateLimiters(appSecurityConfig.rateLimit, {
  storeFactory: rateLimitStore.storeFor,
  onLoginLimited: (req) => administrativeAuditService.recordOutcome({
    actorType: 'anonimo',
    administratorId: null,
    storeId: null,
    action: 'inicio_sesion',
    result: 'limitado',
    resultCode: 'TOO_MANY_LOGIN_ATTEMPTS',
    origin: 'web',
    requestId: req.requestId
  })
});
const operationalEventDispatcher = createOperationalEventDispatcher({
  logger: securityLogger
});
const operationalStateTracker = createOperationalStateTracker({
  dispatch: (event) => operationalEventDispatcher.dispatch(event),
  warningReminderMs: appSecurityConfig.operationalMonitoring.warningReminderMs,
  errorReminderMs: appSecurityConfig.operationalMonitoring.errorReminderMs,
  criticalReminderMs: appSecurityConfig.operationalMonitoring.criticalReminderMs
});
const operationalMonitor = createOperationalMonitor({
  tracker: operationalStateTracker,
  dispatcher: operationalEventDispatcher
});
const healthService = createOperationalHealthService({
  pool,
  dependencyChecks: appDeploymentConfig.hosted ? [
    { name: 'rateLimitStore', check: rateLimitStore.health },
    appDeploymentConfig.privateStorage.enabled
      ? {
        name: 'privateStorage',
        check: async () => {
          const result = await privateReceiptStorage.health();
          if (!result.available) throw new Error('El almacenamiento privado no esta disponible.');
        }
      }
      : { name: 'privateStorage', status: 'disabled' }
  ] : [],
  softLimitMs: appSecurityConfig.operationalHealth.softLimitMs,
  timeoutMs: appSecurityConfig.operationalHealth.timeoutMs,
  cacheMs: appSecurityConfig.operationalHealth.cacheMs
});
const healthRoutes = createHealthRouter({
  healthService,
  logger: securityLogger,
  monitor: operationalMonitor
});
const backupStatusService = createBackupStatusService({
  warningHours: appSecurityConfig.operationalBackup.warningHours,
  criticalHours: appSecurityConfig.operationalBackup.criticalHours,
  cacheMs: appSecurityConfig.operationalBackup.cacheMs
});
const diagnosticService = createOperationalDiagnosticService({
  healthService,
  backupStatusService
});
const adminHealthRoutes = createAdminHealthRouter({
  diagnosticService,
  logger: securityLogger,
  monitor: operationalMonitor
});
const tenantAuditRoutes = createAuditRouter({ mode: 'tenant' });
const adminAuditRoutes = createAuditRouter({ mode: 'admin' });
const commercialAuditMiddleware = createCommercialAuditMiddleware({
  auditService: administrativeAuditService
});
const sessionStore = new MySQLSessionStore({
  createDatabaseTable: true,
  endConnectionOnClose: false,
  schema: {
    tableName: 'sessions',
    columnNames: {
      session_id: 'session_id',
      expires: 'expires',
      data: 'data'
    }
  }
}, pool);

sessionStore.on('error', (error) => {
  securityLogger.error('session_store_error', {
    errorName: error?.name || 'Error',
    errorCode: error?.code || null
  });
});

app.set('trust proxy', appDeploymentConfig.trustProxy);
app.use(requestContext(securityLogger));
app.use(securityHeaders(appSecurityConfig));
app.use(permissionsPolicy);
app.use(noStoreSensitiveResponses);
app.use('/health', rateLimiters.health, healthRoutes);
app.use(express.urlencoded({ extended: true }));
app.use(express.json({ limit: '2mb' }));
app.use(session({
  store: sessionStore,
  name: 'tienda.sid',
  secret: appSessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: appDeploymentConfig.secureCookies,
    maxAge: 1000 * 60 * 60 * 8
  }
}));
app.use('/api', commercialAuditMiddleware);
app.use(mutationProtection(appSecurityConfig.trustedOrigins));

app.use('/auth', rateLimiters.auth);
app.use('/auth/login', rateLimiters.loginIp, rateLimiters.loginIdentity);
app.use('/auth/registro', rateLimiters.publicRegistration);
app.use('/auth/verificar-correo', rateLimiters.emailVerificationConfirm);
app.use('/auth/reenviar-verificacion', rateLimiters.emailVerificationResendIp, rateLimiters.emailVerificationResendIdentity);
app.use('/auth/solicitar-recuperacion', rateLimiters.passwordRecoveryRequestIp, rateLimiters.passwordRecoveryRequestIdentity);
app.use('/auth/restablecer-password', rateLimiters.passwordRecoveryConfirmIp, rateLimiters.passwordRecoveryConfirmToken);
app.use('/api/admin/catalogo/importaciones/plantilla.xlsx', rateLimiters.export);
app.use('/api/exportaciones', rateLimiters.export);
app.use('/api/inventario-inteligente/exportacion.xlsx', rateLimiters.export);
app.use('/api/lotes/exportacion.xlsx', rateLimiters.export);
app.use('/api/clientes/exportacion.xlsx', rateLimiters.export);
app.use('/api/fiados/exportacion.xlsx', rateLimiters.export);
app.use(/^\/api\/clientes\/\d+\/estado-cuenta\/exportacion\.xlsx\/?$/, rateLimiters.export);
app.use('/api/compensaciones/exportaciones', rateLimiters.export);
app.use('/api/cobranza/mensaje-whatsapp/preparar', rateLimiters.whatsapp);
app.post(
  /^\/api\/pagos-suscripcion\/solicitudes\/[A-Za-z0-9_-]{32,64}\/comprobantes\/?$/,
  rateLimiters.receiptUpload
);
app.use('/api/admin/pagos-suscripcion', rateLimiters.paymentAdmin);
app.use('/api/pagos-suscripcion', rateLimiters.payment);
app.use('/api/admin', rateLimiters.admin);
app.use('/api', rateLimiters.api);

app.use('/auth', authRoutes);
app.use('/api/admin/health', requireAuth, requireRole('superadmin'), adminHealthRoutes);
app.use('/api/admin/auditoria', requireAuth, requireRole('superadmin'), adminAuditRoutes);
app.use('/api/admin/catalogo', requireAuth, requireRole('superadmin'), adminCatalogRoutes);
app.use(
  '/api/admin/pagos-suscripcion',
  requireAuth,
  requireRole('superadmin'),
  createAdminPaymentSubscriptionsRouter()
);
app.use(
  '/api/admin/pagos-suscripcion/revision',
  requireAuth,
  requireRole('superadmin'),
  createAdminPaymentReviewsRouter({ receiptsEnabled: appDeploymentConfig.privateStorage.enabled })
);
app.use('/api/admin/suscripciones', requireAuth, requireRole('superadmin'), createAdminSubscriptionsRouter());
app.use('/api/admin', requireAuth, requireRole('superadmin'), adminRoutes);
app.use(
  '/api/auditoria',
  rateLimiters.admin,
  requireAuth,
  requireTenant,
  resolveSubscription,
  requireActiveSubscription,
  tenantAuditRoutes
);
app.use(
  '/api/suscripcion',
  requireAuth,
  requireTenant,
  resolveSubscription,
  requireActiveSubscription,
  subscriptionRoutes
);
app.use(
  '/api/pagos-suscripcion',
  requireAuth,
  requireTenant,
  resolveSubscription,
  createPaymentSubscriptionsRouter({ receiptsEnabled: appDeploymentConfig.privateStorage.enabled })
);
app.use(
  '/onboarding',
  rateLimiters.api,
  requireAuth,
  requireTenant,
  resolveSubscription,
  requireFullSubscriptionAccess,
  onboardingRoutes
);
app.use('/api/catalogo-maestro', requireAuth, requireTenant, resolveSubscription, requireActiveSubscription, masterCatalogRoutes);
app.use(
  '/api/configuracion-tienda',
  requireAuth,
  requireTenant,
  resolveSubscription,
  requireActiveSubscription,
  storeConfigurationRoutes
);
app.use(
  '/api',
  requireAuth,
  requireTenant,
  resolveSubscription,
  requireActiveSubscription,
  financeRoutes,
  inventoryAdjustmentRoutes,
  inventoryIntelligenceRoutes,
  lotRoutes,
  customerCreditRoutes,
  salesCompensationRoutes,
  financialCompensationRoutes,
  posRoutes,
  stockRoutes,
  apiRoutes
);

function requireOwnerPage(req, res, next) {
  if (req.auth.rol === 'dueno_tienda') return next();
  return res.redirect('/admin.html');
}

app.get('/app.html', requireAuth, requireOwnerPage, requireTenant, resolveSubscription, (req, res) => {
  const destination = ownerDestination(req.subscriptionContext, req.auth.estadoOnboarding);
  if (destination !== '/app.html') return res.redirect(destination);
  return res.sendFile(path.join(__dirname, 'public', 'app.html'));
});

app.get('/onboarding.html', requireAuth, requireOwnerPage, requireTenant, resolveSubscription, (req, res) => {
  const destination = ownerDestination(req.subscriptionContext, req.auth.estadoOnboarding);
  if (destination !== '/onboarding.html') return res.redirect(destination);
  return res.sendFile(path.join(__dirname, 'public', 'onboarding.html'));
});

function sendSubscriptionPage(req, res) {
  return res.sendFile(path.join(__dirname, 'public', 'subscription.html'));
}

app.get('/suscripcion.html', requireAuth, requireOwnerPage, requireTenant, resolveSubscription, sendSubscriptionPage);
app.get('/subscription.html', requireAuth, requireOwnerPage, requireTenant, resolveSubscription, sendSubscriptionPage);

app.get('/admin.html', requireAuth, (req, res) => {
  if (req.auth.rol !== 'superadmin') return res.redirect('/app.html');
  return res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.use(express.static(path.join(__dirname, 'public')));

app.get(
  '/',
  requireAuth,
  (req, res, next) => (req.auth.rol === 'superadmin' ? res.redirect('/admin.html') : next()),
  requireTenant,
  resolveSubscription,
  (req, res) => res.redirect(ownerDestination(req.subscriptionContext, req.auth.estadoOnboarding))
);

app.use(notFoundHandler);
app.use(createErrorHandler({ logger: securityLogger, production: appSecurityConfig.production }));

async function startServer() {
  await rateLimitStore.ready();
  if (appDeploymentConfig.hosted && appDeploymentConfig.privateStorage.enabled) {
    await privateReceiptStorage.health();
  }
  if (isLocalEnvironment) logDatabaseTarget('Servidor local', appDatabaseConfig);
  const server = app.listen(PORT, () => {
    securityLogger.info('server_started', {
      puerto: Number(PORT),
      entorno: process.env.APP_ENV || 'no_definido'
    });
    void announceInitialReadiness(healthService, securityLogger, operationalMonitor);
  });
  server.on('error', (error) => {
    securityLogger.error('server_listen_failed', {
      errorName: error?.name || 'Error',
      errorCode: error?.code || null
    });
    process.exitCode = 1;
  });
  const shutdown = createGracefulShutdown({
    server,
    pool,
    sessionStore,
    rateLimitStore,
    logger: securityLogger,
    monitor: operationalMonitor,
    timeoutMs: appSecurityConfig.operationalHealth.shutdownTimeoutMs
  });
  installShutdownHandlers(process, shutdown);
  return server;
}

startServer().catch(async (error) => {
  securityLogger.error('server_startup_failed', {
    errorName: error?.name || 'Error',
    errorCode: typeof error?.code === 'string' ? error.code.slice(0, 80) : null
  });
  await rateLimitStore.close().catch(() => {});
  if (typeof sessionStore.close === 'function') {
    await Promise.resolve(sessionStore.close()).catch(() => {});
  }
  await pool.end().catch(() => {});
  process.exitCode = 1;
});
