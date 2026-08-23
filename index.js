require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const passport = require('passport');
const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');

const { pool, initSchema } = require('./db');
const { router: authRouter } = require('./routes/auth');
const adminRouter = require('./routes/admin');
const upscaleRouter = require('./routes/upscale');
const qrisRouter = require('./routes/qris');

const REQUIRED_ENV = ['DATABASE_URL', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'JWT_SECRET', 'FRONTEND_URL'];
const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
if (missing.length) {
  console.warn(`[startup] PERINGATAN: environment variable belum diisi: ${missing.join(', ')}`);
}

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: process.env.FRONTEND_URL, credentials: true }
});
app.set('io', io); // supaya routes/auth.js bisa broadcast lewat req.app.get('io')

app.use(cors({ origin: process.env.FRONTEND_URL, credentials: true }));
app.use(express.json());
app.use(cookieParser());
app.use(passport.initialize());

app.get('/', (req, res) => res.json({ ok: true, service: 'upclaselam-server' }));
app.get('/health', (req, res) => res.json({ ok: true }));

app.use('/api/auth', authRouter);
app.use('/api/admin', adminRouter);
app.use('/api/upscale', upscaleRouter);
app.use('/api/qris', qrisRouter);

// Error handler terakhir - supaya error tak terduga tidak bikin server crash/hang,
// dan tidak membocorkan stack trace ke client di production.
app.use((err, req, res, next) => {
  console.error('[unhandled error]', err);
  res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Terjadi kesalahan server.' : err.message });
});

// ---- Socket.IO: hanya admin yang di-join ke room 'admins' ----
// Verifikasi role dibaca ULANG dari database tiap koneksi socket (bukan dipercaya dari client),
// supaya user biasa tidak bisa memalsukan diri jadi admin untuk menguping data ini.
function parseCookie(cookieHeader, name) {
  if (!cookieHeader) return null;
  const match = cookieHeader.split(';').map((c) => c.trim()).find((c) => c.startsWith(name + '='));
  return match ? decodeURIComponent(match.split('=')[1]) : null;
}

io.on('connection', async (socket) => {
  try {
    const token = parseCookie(socket.handshake.headers.cookie, 'token');
    if (!token) return;
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const { rows } = await pool.query('SELECT role FROM users WHERE id = $1', [payload.uid]);
    if (rows[0]?.role === 'admin') {
      socket.join('admins');
    }
  } catch (_) {
    // token invalid/expired - socket tetap connect sebagai guest, cuma tidak join room admin
  }
});

const PORT = process.env.PORT || 8080;

initSchema()
  .then(() => {
    server.listen(PORT, () => {
      console.log(`[startup] UpclaseLam server jalan di port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error('[startup] Gagal inisialisasi database:', err);
    process.exit(1);
  });
