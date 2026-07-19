const path = require('path');
const express = require('express');
const session = require('express-session');
const MySQLSessionStore = require('express-mysql-session')(session);

const { databaseConfig, isLocalEnvironment, logDatabaseTarget, sessionSecret } = require('./config/env');
const { webSecurityConfig } = require('./config/web-security');
let appDatabaseConfig;
let appSessionSecret;
let appSecurityConfig;
try {
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
const { requireRole } = require('./middleware/roles');
const { permissionsPolicy, securityHeaders } = require('./middleware/security-headers');
const { requireActiveSubscription, resolveSubscription } = require('./middleware/subscription');
const { requireTenant } = require('./middleware/tenant');
const { createSecurityLogger } = require('./utils/security-logger');
const adminCatalogRoutes = require('./routes/admin-catalog');
const adminRoutes = require('./routes/admin');
const apiRoutes = require('./routes/api');
const authRoutes = require('./routes/auth');
const customerCreditRoutes = require('./routes/customers-credit');
const financeRoutes = require('./routes/finance');
const inventoryIntelligenceRoutes = require('./routes/inventory-intelligence');
const lotRoutes = require('./routes/lots');
const masterCatalogRoutes = require('./routes/master-catalog');
const posRoutes = require('./routes/pos');
const stockRoutes = require('./routes/stock');

const app = express();
const PORT = process.env.PORT || 3000;
const securityLogger = createSecurityLogger(appSecurityConfig.logLevel);
const rateLimiters = createRateLimiters(appSecurityConfig.rateLimit);
const sessionStore = new MySQLSessionStore({
  ...appDatabaseConfig,
  createDatabaseTable: true,
  schema: {
    tableName: 'sessions',
    columnNames: {
      session_id: 'session_id',
      expires: 'expires',
      data: 'data'
    }
  }
});

sessionStore.on('error', (error) => {
  securityLogger.error('session_store_error', {
    errorName: error?.name || 'Error',
    errorCode: error?.code || null
  });
});

app.set('trust proxy', appSecurityConfig.production ? 1 : false);
app.use(requestContext(securityLogger));
app.use(securityHeaders(appSecurityConfig));
app.use(permissionsPolicy);
app.use(noStoreSensitiveResponses);
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
    secure: appSecurityConfig.production,
    maxAge: 1000 * 60 * 60 * 8
  }
}));
app.use(mutationProtection(appSecurityConfig.trustedOrigins));

app.use('/auth', rateLimiters.auth);
app.use('/auth/login', rateLimiters.loginIp, rateLimiters.loginIdentity);
app.use('/api/admin/catalogo/importaciones/plantilla.xlsx', rateLimiters.export);
app.use('/api/exportaciones', rateLimiters.export);
app.use('/api/inventario-inteligente/exportacion.xlsx', rateLimiters.export);
app.use('/api/lotes/exportacion.xlsx', rateLimiters.export);
app.use('/api/cobranza/mensaje-whatsapp/preparar', rateLimiters.whatsapp);
app.use('/api/admin', rateLimiters.admin);
app.use('/api', rateLimiters.api);

app.use('/auth', authRoutes);
app.use('/api/admin/catalogo', requireAuth, requireRole('superadmin'), adminCatalogRoutes);
app.use('/api/admin', requireAuth, requireRole('superadmin'), adminRoutes);
app.use('/api/catalogo-maestro', requireAuth, requireTenant, resolveSubscription, requireActiveSubscription, masterCatalogRoutes);
app.use(
  '/api',
  requireAuth,
  requireTenant,
  resolveSubscription,
  requireActiveSubscription,
  financeRoutes,
  inventoryIntelligenceRoutes,
  lotRoutes,
  customerCreditRoutes,
  posRoutes,
  stockRoutes,
  apiRoutes
);

app.get('/app.html', requireAuth, (req, res) => {
  if (req.auth.rol !== 'dueno_tienda') return res.redirect('/admin.html');
  res.sendFile(path.join(__dirname, 'public', 'app.html'));
});

app.get('/admin.html', requireAuth, (req, res) => {
  if (req.auth.rol !== 'superadmin') return res.redirect('/app.html');
  return res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', requireAuth, (req, res) => {
  const destination = req.auth.rol === 'superadmin' ? '/admin.html' : '/app.html';
  res.redirect(destination);
});

app.use(notFoundHandler);
app.use(createErrorHandler({ logger: securityLogger, production: appSecurityConfig.production }));

async function startServer() {
  try {
    if (isLocalEnvironment) logDatabaseTarget('Servidor local', appDatabaseConfig);
    await pool.query('SELECT 1');
    app.listen(PORT, () => {
      securityLogger.info('server_started', { puerto: Number(PORT), entorno: process.env.APP_ENV || 'no_definido' });
    });
  } catch (error) {
    securityLogger.error('server_start_failed', {
      errorName: error?.name || 'Error',
      errorCode: error?.code || null
    });
    process.exit(1);
  }
}

startServer();
