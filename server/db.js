const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

if (!process.env.DATABASE_URL) {
  console.error('[db] DATABASE_URL belum diset! Isi environment variable ini (lihat .env.example).');
}

// Railway Postgres butuh SSL, tapi self-signed - rejectUnauthorized:false aman untuk kasus ini.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

pool.on('error', (err) => {
  console.error('[db] Unexpected error pada idle client', err);
});

async function initSchema() {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(schema);
  console.log('[db] Schema OK (tabel dibuat/ sudah ada).');
}

module.exports = { pool, initSchema };
  
