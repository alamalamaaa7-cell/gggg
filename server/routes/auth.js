const express = require('express');
const jwt = require('jsonwebtoken');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const { pool } = require('../db');
const { requireAuth, optionalAuth } = require('../middleware/auth');

const router = express.Router();

const FREE_LIMIT_QUOTA = 50;
const FREE_RESET_MS = 5 * 24 * 60 * 60 * 1000; // 5 hari

// ---- Passport Google Strategy (session:false, kita pakai JWT sendiri) ----
passport.use(new GoogleStrategy(
  {
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: process.env.GOOGLE_CALLBACK_URL
  },
  async (accessToken, refreshToken, profile, done) => {
    try {
      const email = profile.emails?.[0]?.value?.toLowerCase();
      const name = profile.displayName;
      const avatar = profile.photos?.[0]?.value;
      const googleId = profile.id;

      if (!email) return done(new Error('Google tidak mengembalikan email.'));

      const role = email === (process.env.ADMIN_EMAIL || '').toLowerCase() ? 'admin' : 'user';

      // Upsert user: buat baru kalau belum ada, update profil kalau sudah ada.
      const { rows } = await pool.query(
        `INSERT INTO users (google_id, email, name, avatar, role, limit_remaining, max_limit, free_reset_at, last_login)
         VALUES ($1, $2, $3, $4, $5, $6, $6, now() + interval '5 days', now())
         ON CONFLICT (email) DO UPDATE SET
           google_id = EXCLUDED.google_id,
           name = EXCLUDED.name,
           avatar = EXCLUDED.avatar,
           role = CASE WHEN EXCLUDED.role = 'admin' THEN 'admin' ELSE users.role END,
           last_login = now()
         RETURNING *`,
        [googleId, email, name, avatar, role, FREE_LIMIT_QUOTA]
      );

      return done(null, rows[0]);
    } catch (err) {
      return done(err);
    }
  }
));

// Refresh kuota gratis (reset tiap 5 hari) & cek VIP kadaluarsa. Dipanggil tiap login / /me.
async function refreshUserQuota(user) {
  const now = new Date();
  let needsUpdate = false;
  const updates = {};

  if (user.package && user.package_expires && new Date(user.package_expires) <= now) {
    updates.package = null;
    updates.package_expires = null;
    needsUpdate = true;
  }

  const isVipActive = user.package && user.package_expires && new Date(user.package_expires) > now;
  if (!isVipActive && user.role !== 'admin') {
    if (!user.free_reset_at || new Date(user.free_reset_at) <= now) {
      updates.limit_remaining = FREE_LIMIT_QUOTA;
      updates.max_limit = FREE_LIMIT_QUOTA;
      updates.free_reset_at = new Date(now.getTime() + FREE_RESET_MS);
      needsUpdate = true;
    }
  }

  if (!needsUpdate) return user;

  const setClauses = Object.keys(updates).map((k, i) => `${k} = $${i + 2}`).join(', ');
  const values = Object.values(updates);
  const { rows } = await pool.query(
    `UPDATE users SET ${setClauses} WHERE id = $1 RETURNING *`,
    [user.id, ...values]
  );
  return rows[0];
}

function sanitizeUser(user) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    avatar: user.avatar,
    role: user.role,
    package: user.package,
    packageExpires: user.package_expires,
    limit: user.limit_remaining,
    maxLimit: user.max_limit
  };
}

// GET /api/auth/google -> redirect ke halaman consent Google
router.get('/google', passport.authenticate('google', { scope: ['profile', 'email'], session: false }));

// GET /api/auth/google/callback -> Google redirect ke sini setelah user setuju
router.get('/google/callback',
  passport.authenticate('google', { session: false, failureRedirect: `${process.env.FRONTEND_URL}/?login=gagal` }),
  async (req, res) => {
    try {
      const user = await refreshUserQuota(req.user);

      // Catat riwayat login untuk dipantau Admin + broadcast realtime
      const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress;
      const userAgent = req.headers['user-agent'] || '';
      const { rows } = await pool.query(
        `INSERT INTO login_history (user_id, email, method, ip, user_agent)
         VALUES ($1, $2, 'google', $3, $4) RETURNING *`,
        [user.id, user.email, ip, userAgent]
      );

      const io = req.app.get('io');
      if (io) {
        io.to('admins').emit('admin:new-login', rows[0]);
        const { rows: statRows } = await pool.query('SELECT COUNT(*)::int AS total_users FROM users');
        const { rows: loginCountRows } = await pool.query('SELECT COUNT(*)::int AS total_logins FROM login_history');
        io.to('admins').emit('admin:stats', {
          totalUsers: statRows[0].total_users,
          totalLogins: loginCountRows[0].total_logins
        });
      }

      const token = jwt.sign({ uid: user.id }, process.env.JWT_SECRET, { expiresIn: '30d' });
      res.cookie('token', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
        maxAge: 30 * 24 * 60 * 60 * 1000
      });

      res.redirect(process.env.FRONTEND_URL || '/');
    } catch (err) {
      console.error('[auth callback] error:', err);
      res.redirect(`${process.env.FRONTEND_URL}/?login=error`);
    }
  }
);

// GET /api/auth/me -> data user yang sedang login (untuk restore session di frontend)
router.get('/me', optionalAuth, async (req, res) => {
  if (!req.user) return res.json({ user: null });
  const fresh = await refreshUserQuota(req.user);
  res.json({ user: sanitizeUser(fresh) });
});

// POST /api/auth/logout
router.post('/logout', requireAuth, (req, res) => {
  res.clearCookie('token', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax'
  });
  res.json({ ok: true });
});

module.exports = { router, refreshUserQuota, sanitizeUser };
