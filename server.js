const path = require('path');
const express = require('express');
const session = require('express-session');
const MySQLSessionStore = require('express-mysql-session')(session);
const helmet = require('helmet');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const pool = require('./config/db');
const { requireAuth } = require('./middleware/auth');
const apiRoutes = require('./routes/api');
const authRoutes = require('./routes/auth');

const app = express();
const PORT = process.env.PORT || 3000;
const useSsl = String(process.env.DB_SSL || '').toLowerCase() === 'true'
  || /aivencloud\.com$/i.test(process.env.DB_HOST || '');
const sessionStore = new MySQLSessionStore({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: useSsl ? { rejectUnauthorized: false } : undefined,
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
  secret: process.env.SESSION_SECRET || 'cambia_esta_clave',
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

async function ensureDefaultAdmin() {
  const [rows] = await pool.query('SELECT idAdministrador, password FROM administrador WHERE usuario = ?', ['admin']);
  const hash = await bcrypt.hash('admin123', 10);

  if (rows.length === 0) {
    await pool.query('INSERT INTO administrador (usuario, password) VALUES (?, ?)', ['admin', hash]);
    return;
  }

  // Mantiene util el usuario inicial aunque el SQL se importe con un hash de ejemplo.
  const validDefaultPassword = await bcrypt.compare('admin123', rows[0].password).catch(() => false);
  if (!validDefaultPassword) {
    await pool.query('UPDATE administrador SET password = ? WHERE usuario = ?', [hash, 'admin']);
  }
}

async function startServer() {
  try {
    await pool.query('SELECT 1');
    await ensureDefaultAdmin();
    app.listen(PORT, () => {
      console.log(`Sistema iniciado en puerto ${PORT}`);
    });
  } catch (error) {
    console.error('No se pudo conectar a MySQL. Revise el archivo .env y la base de datos.');
    console.error(error.message);
    process.exit(1);
  }
}

startServer();
