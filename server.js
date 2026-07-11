'use strict';
const path = require('path');
const express = require('express');
const session = require('express-session');
const config = require('./src/config');
const PgStore = require('./src/sessionStore');
const auth = require('./src/auth');

const app = express();
app.set('trust proxy', 1); // untuk Cloudflare Tunnel / reverse proxy
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

app.use(session({
  name: 'sikeu.sid',
  store: new PgStore(),
  secret: config.sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProd, // aktifkan di produksi (HTTPS via Cloudflare)
    maxAge: 7 * 24 * 3600 * 1000,
  },
}));

// ---- API ----
app.get('/api/health', (req, res) => res.json({ ok: true, app: 'SIKEU Tazkia' }));
app.use('/api/auth', require('./src/routes/auth'));
// Semua rute di bawah wajib login
app.use('/api', auth.requireAuth);
app.use('/api/master', require('./src/routes/master'));
app.use('/api/journals', require('./src/routes/journals'));
app.use('/api/kasbank', require('./src/routes/kasbank'));
app.use('/api/piutang', require('./src/routes/piutang'));
app.use('/api/pajak', require('./src/routes/pajak'));
app.use('/api/budget', require('./src/routes/budget'));
app.use('/api/admin', require('./src/routes/admin'));
app.use('/api/reports', require('./src/routes/reports'));

// ---- Frontend statis ----
const PUB = path.join(__dirname, 'public');
app.use(express.static(PUB));
// Login page & app shell
app.get('/', (req, res) => res.sendFile(path.join(PUB, 'index.html')));
app.get('/login', (req, res) => res.sendFile(path.join(PUB, 'login.html')));
// Fallback SPA (rute non-API diarahkan ke shell)
app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(path.join(PUB, 'index.html')));

app.listen(config.port, config.host, () => {
  console.log(`\n  SIKEU Tazkia berjalan di  http://${config.host}:${config.port}\n`);
  // Backup database otomatis (saat start + harian)
  require('./src/services/backupService').startAuto();
});
