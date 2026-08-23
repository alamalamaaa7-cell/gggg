const express = require('express');
const multer = require('multer');
const { pool } = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// Semua route di bawah ini WAJIB login + role admin (dicek dari DB, bukan dari client).
router.use(requireAuth, requireAdmin);

// GET /api/admin/stats -> total user terdaftar & total login tercatat
router.get('/stats', async (req, res) => {
  const { rows: u } = await pool.query('SELECT COUNT(*)::int AS total_users FROM users');
  const { rows: l } = await pool.query('SELECT COUNT(*)::int AS total_logins FROM login_history');
  const { rows: vip } = await pool.query(
    `SELECT COUNT(*)::int AS active_vip FROM users WHERE package IS NOT NULL AND package_expires > now()`
  );
  res.json({
    totalUsers: u[0].total_users,
    totalLogins: l[0].total_logins,
    activeVip: vip[0].active_vip
  });
});

// GET /api/admin/login-history?limit=50&offset=0 -> riwayat login semua user
router.get('/login-history', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const offset = parseInt(req.query.offset) || 0;
  const { rows } = await pool.query(
    `SELECT id, email, method, ip, user_agent, created_at
     FROM login_history ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
  res.json({ history: rows });
});

// GET /api/admin/users -> daftar semua user (bukan cuma VIP), untuk dipantau admin
router.get('/users', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, email, name, role, package, package_expires, limit_remaining, max_limit, created_at, last_login
     FROM users ORDER BY last_login DESC NULLS LAST`
  );
  res.json({ users: rows });
});

// POST /api/admin/grant-vip { email, package, days }
router.post('/grant-vip', async (req, res) => {
  const email = (req.body.email || '').trim().toLowerCase();
  const pkg = req.body.package;
  const days = parseInt(req.body.days) || 30;
  if (!email || !['basic', 'standar', 'promax'].includes(pkg)) {
    return res.status(400).json({ error: 'Email atau paket tidak valid.' });
  }
  const maxLimit = pkg === 'promax' ? 999 : (pkg === 'standar' ? 150 : 50);

  const { rows } = await pool.query(
    `UPDATE users SET package = $2, package_expires = now() + ($3 || ' days')::interval,
       limit_remaining = $4, max_limit = $4
     WHERE email = $1 RETURNING *`,
    [email, pkg, days, maxLimit]
  );

  if (rows.length === 0) {
    return res.status(404).json({ error: 'User belum pernah login/terdaftar di sistem.' });
  }

  res.json({ ok: true, user: rows[0] });
});

// POST /api/admin/revoke-vip { email }
router.post('/revoke-vip', async (req, res) => {
  const email = (req.body.email || '').trim().toLowerCase();
  await pool.query(
    `UPDATE users SET package = NULL, package_expires = NULL, limit_remaining = 50, max_limit = 50 WHERE email = $1`,
    [email]
  );
  res.json({ ok: true });
});

// POST /api/admin/qris -> upload foto QRIS (disimpan sebagai base64 di tabel settings)
router.post('/qris', upload.single('qris'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'File tidak ditemukan.' });
  const base64 = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
  await pool.query(
    `INSERT INTO settings (key, value) VALUES ('qris_image', $1)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [base64]
  );
  res.json({ ok: true, qris: base64 });
});

module.exports = router;
