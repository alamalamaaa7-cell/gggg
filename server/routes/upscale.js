const express = require('express');
const multer = require('multer');
const FormData = require('form-data');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 60 * 1024 * 1024 } // 60MB, cek lebih ketat per-tipe di bawah
});

const MAX_PHOTO_MB = 15;
const MAX_VIDEO_MB = 60;
const RESOLUTION_COST = { '720p': 5, '1080p': 20, '2k': 35, '4k': 50 };

async function fetchWithTimeout(url, options = {}, timeoutMs = 45000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('Server API tidak merespons (timeout).');
    throw new Error('Gagal terhubung ke server API pihak ketiga.');
  } finally {
    clearTimeout(timer);
  }
}

async function safeParseJSON(res) {
  const raw = await res.text();
  try {
    return JSON.parse(raw);
  } catch (_) {
    console.error('[upscale] Respons API bukan JSON valid:', raw.slice(0, 300));
    throw new Error('Respons API tidak valid (server pihak ketiga mungkin sedang error).');
  }
}

function extractResultUrl(payload) {
  if (!payload) return null;
  if (typeof payload === 'string' && payload.startsWith('http')) return payload;
  const candidates = [
    payload.result, payload.url, payload.link, payload.download,
    payload.downloadUrl, payload.hd, payload.hdurl, payload.image, payload.video,
    payload.data?.url, payload.data?.result, payload.data?.download, payload.data?.hd,
    payload.result?.url, payload.result?.download
  ];
  return candidates.find((v) => typeof v === 'string' && v.startsWith('http')) || null;
}

// POST /api/upscale/upload -> upload file dari user, backend yang teruskan ke host sementara
// (dilakukan di server supaya tidak kena CORS di browser, dan supaya bisa validasi ukuran dulu)
router.post('/upload', requireAuth, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'File tidak ditemukan.' });

    const isVideo = req.file.mimetype.startsWith('video/');
    const sizeMB = req.file.size / (1024 * 1024);
    const maxMB = isVideo ? MAX_VIDEO_MB : MAX_PHOTO_MB;
    if (sizeMB > maxMB) {
      return res.status(400).json({
        error: `Ukuran berkas terlalu besar (${sizeMB.toFixed(1)}MB). Maksimal ${maxMB}MB untuk ${isVideo ? 'video' : 'foto'}.`
      });
    }

    const form = new FormData();
    form.append('file', req.file.buffer, { filename: req.file.originalname, contentType: req.file.mimetype });

    const uploadRes = await fetchWithTimeout(process.env.TMP_HOST_UPLOAD, {
      method: 'POST',
      body: form,
      headers: form.getHeaders()
    }, 60000);

    if (!uploadRes.ok) {
      return res.status(502).json({ error: `Gagal upload ke host sementara (status ${uploadRes.status}).` });
    }

    const data = await safeParseJSON(uploadRes);
    let url = data?.data?.url || data?.data?.URL || data?.url;
    if (!url) return res.status(502).json({ error: 'URL hasil upload tidak ditemukan.' });
    url = url.replace('tmpfiles.org/', 'tmpfiles.org/dl/');

    res.json({ url, isVideo });
  } catch (err) {
    console.error('[upscale/upload]', err);
    res.status(500).json({ error: err.message || 'Gagal upload berkas.' });
  }
});

// POST /api/upscale/photo { url }
router.post('/photo', requireAuth, async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'URL foto wajib diisi.' });

    const endpoint = process.env.UPSCALE_PHOTO_API + encodeURIComponent(url);
    const apiRes = await fetchWithTimeout(endpoint, {}, 60000);
    if (!apiRes.ok) return res.status(502).json({ error: `API upscale foto gagal (status ${apiRes.status}).` });

    const data = await safeParseJSON(apiRes);
    const resultUrl = extractResultUrl(data);
    if (!resultUrl) return res.status(502).json({ error: 'API tidak mengembalikan URL hasil foto HD.' });

    res.json({ resultUrl });
  } catch (err) {
    console.error('[upscale/photo]', err);
    res.status(500).json({ error: err.message || 'Gagal memproses foto.' });
  }
});

// POST /api/upscale/video { url }
router.post('/video', requireAuth, async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'URL video wajib diisi.' });

    const endpoint = process.env.UPSCALE_VIDEO_API + encodeURIComponent(url);
    const apiRes = await fetchWithTimeout(endpoint, {}, 120000);
    if (!apiRes.ok) return res.status(502).json({ error: `API upscale video gagal (status ${apiRes.status}).` });

    const data = await safeParseJSON(apiRes);
    const resultUrl = extractResultUrl(data);
    if (!resultUrl) return res.status(502).json({ error: 'API tidak mengembalikan URL hasil video HD.' });

    res.json({ resultUrl });
  } catch (err) {
    console.error('[upscale/video]', err);
    res.status(500).json({ error: err.message || 'Gagal memproses video.' });
  }
});

// POST /api/upscale/deduct { resolution } -> potong kuota simpan user saat export/save
// Dihitung & divalidasi di SERVER (bukan percaya angka dari client) supaya tidak bisa dicurangi.
router.post('/deduct', requireAuth, async (req, res) => {
  const resolution = req.body.resolution;
  const cost = RESOLUTION_COST[resolution];
  if (!cost) return res.status(400).json({ error: 'Resolusi tidak valid.' });

  const user = req.user;
  if (user.role === 'admin') return res.json({ ok: true, limit: 999, maxLimit: 999 });

  if (user.limit_remaining < cost) {
    return res.status(400).json({
      error: `Limit tidak cukup. Butuh ${cost}, sisa ${user.limit_remaining}.`,
      limit: user.limit_remaining,
      maxLimit: user.max_limit
    });
  }

  const { rows } = await pool.query(
    `UPDATE users SET limit_remaining = limit_remaining - $2 WHERE id = $1 RETURNING limit_remaining, max_limit`,
    [user.id, cost]
  );

  res.json({ ok: true, limit: rows[0].limit_remaining, maxLimit: rows[0].max_limit });
});

module.exports = router;
