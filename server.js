const path = require('path');
const express = require('express');
const session = require('express-session');
const MySQLSessionStore = require('express-mysql-session')(session);
const helmet = require('helmet');

const { databaseConfig, isLocalEnvironment, logDatabaseTarget, sessionSecret } = require('./config/env');
let appDatabaseConfig;
let appSessionSecret;
try {
  appDatabaseConfig = databaseConfig();
  appSessionSecret = sessionSecret();
} catch (error) {
  console.error('No se pudo iniciar la aplicacion por una configuracion incompleta.');
  console.error(error.message);
  process.exit(1);
}

const pool = require('./config/db');
const { requireAuth } = require('./middleware/auth');
const { requireRole } = require('./middleware/roles');
const { requireActiveSubscription, resolveSubscription } = require('./middleware/subscription');
const { requireTenant } = require('./middleware/tenant');
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
  console.error('Error en el almacen de sesiones MySQL.');
  console.error(error.message);
});

app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));
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
    secure: process.env.NODE_ENV === 'production',
    maxAge: 1000 * 60 * 60 * 8
  }
}));

app.use('/auth', authRoutes);
app.use('/api/admin/catalogo', requireAuth, requireRole('superadmin'), adminCatalogRoutes);
app.use('/api/admin', requireAuth, requireRole('superadmin'), adminRoutes);
app.use('/api/catalogo-maestro', requireAuth, requireTenant, resolveSubscription, requireActiveSubscription, masterCatalogRoutes);
app.use('/api', requireAuth, requireTenant, resolveSubscription, requireActiveSubscription, financeRoutes);
app.use('/api', requireAuth, requireTenant, resolveSubscription, requireActiveSubscription, inventoryIntelligenceRoutes);
app.use('/api', requireAuth, requireTenant, resolveSubscription, requireActiveSubscription, lotRoutes);
app.use('/api', requireAuth, requireTenant, resolveSubscription, requireActiveSubscription, customerCreditRoutes);
app.use('/api', requireAuth, requireTenant, resolveSubscription, requireActiveSubscription, posRoutes);
app.use('/api', requireAuth, requireTenant, resolveSubscription, requireActiveSubscription, stockRoutes);
app.use('/api', requireAuth, requireTenant, resolveSubscription, requireActiveSubscription, apiRoutes);

app.get('/app.html', requireAuth, (req, res) => {
  if (req.session.admin.rol !== 'dueno_tienda') return res.redirect('/admin.html');
  res.sendFile(path.join(__dirname, 'public', 'app.html'));
});

app.get('/admin.html', requireAuth, (req, res) => {
  if (req.session.admin.rol !== 'superadmin') return res.redirect('/app.html');
  return res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', requireAuth, (req, res) => {
  const destination = req.session.admin.rol === 'superadmin' ? '/admin.html' : '/app.html';
  res.redirect(destination);
});

app.use((req, res) => {
  res.status(404).json({ error: 'Ruta no encontrada.' });
});

app.use((err, req, res, next) => {
  if (err.status) {
    return res.status(err.status).json({ error: err.message, ...(err.code ? { code: err.code } : {}) });
  }
  console.error(err);
  return res.status(500).json({ error: 'Ocurrio un error interno.' });
});

async function startServer() {
  try {
    if (isLocalEnvironment) logDatabaseTarget('Servidor local', appDatabaseConfig);
    await pool.query('SELECT 1');
    app.listen(PORT, () => {
      console.log(`Sistema iniciado en puerto ${PORT}`);
    });
  } catch (error) {
    console.error('No se pudo iniciar la aplicacion. Revise la configuracion y la base de datos.');
    console.error(error.message);
    process.exit(1);
  }
}

startServer();
