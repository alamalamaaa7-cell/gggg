const express = require('express');
const { pool } = require('../db');

const router = express.Router();

const DEFAULT_QRIS_URL = 'https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=UpclaseLam-VIP-Payment-QRIS';

// GET /api/qris -> foto QRIS aktif (untuk ditampilkan ke user yang mau checkout VIP)
router.get('/', async (req, res) => {
  const { rows } = await pool.query(`SELECT value FROM settings WHERE key = 'qris_image'`);
  res.json({ qris: rows[0]?.value || DEFAULT_QRIS_URL });
});

module.exports = router;
