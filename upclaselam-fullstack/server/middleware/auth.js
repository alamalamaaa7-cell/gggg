const jwt = require('jsonwebtoken');
const { pool } = require('../db');

// Verifikasi JWT dari cookie httpOnly 'token'. Tidak pernah percaya data dari client
// selain identitas (id) di dalam token - role/paket selalu diambil ulang dari DB.
async function requireAuth(req, res, next) {
  try {
    const token = req.cookies?.token;
    if (!token) return res.status(401).json({ error: 'Belum login.' });

    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [payload.uid]);
    if (rows.length === 0) return res.status(401).json({ error: 'Akun tidak ditemukan.' });

    req.user = rows[0];
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Sesi tidak valid, silakan login ulang.' });
  }
}

// Dipasang SETELAH requireAuth. Cek role dari DB (bukan dari client) - jadi user
// biasa tidak mungkin bisa "menipu" jadi admin walau memodifikasi request.
function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Khusus Admin.' });
  }
  next();
}

// Versi optional: kalau ada token valid, isi req.user; kalau tidak, lanjut sebagai guest.
async function optionalAuth(req, res, next) {
  try {
    const token = req.cookies?.token;
    if (!token) return next();
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [payload.uid]);
    if (rows.length) req.user = rows[0];
  } catch (_) {
    // token invalid/expired -> anggap guest, tidak perlu error
  }
  next();
}

module.exports = { requireAuth, requireAdmin, optionalAuth };
