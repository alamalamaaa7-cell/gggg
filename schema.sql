-- Dijalankan otomatis saat server start (lihat db.js -> initSchema()).
-- Aman dipanggil berkali-kali karena pakai IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  google_id TEXT UNIQUE,
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  avatar TEXT,
  role TEXT NOT NULL DEFAULT 'user',
  package TEXT,
  package_expires TIMESTAMPTZ,
  limit_remaining INT NOT NULL DEFAULT 50,
  max_limit INT NOT NULL DEFAULT 50,
  free_reset_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS login_history (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  method TEXT NOT NULL DEFAULT 'google',
  ip TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE INDEX IF NOT EXISTS idx_login_history_created_at ON login_history (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_login_history_email ON login_history (email);
