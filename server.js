const path = require('path');
const express = require('express');
const session = require('express-session');
const MySQLSessionStore = require('express-mysql-session')(session);
const helmet = require('helmet');

const { databaseConfig, sessionSecret } = require('./config/env');
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
const apiRoutes = require('./routes/api');
const authRoutes = require('./routes/auth');

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
app.use(express.json());
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
app.use('/api', requireAuth, apiRoutes);

app.get('/app.html', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'app.html'));
});

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  if (!req.session.admin) return res.redirect('/login.html');
  return res.sendFile(path.join(__dirname, 'public', 'app.html'));
});

app.use((req, res) => {
  res.status(404).json({ error: 'Ruta no encontrada.' });
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Ocurrio un error interno.' });
});

async function startServer() {
  try {
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
