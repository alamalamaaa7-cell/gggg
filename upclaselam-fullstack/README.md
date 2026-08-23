# UpclaseLam — Fullstack (Realtime + Google OAuth + Admin Monitoring)

Struktur project:

```
upclaselam-fullstack/
├─ server/        -> Backend (Express + Socket.IO + PostgreSQL + Google OAuth) → deploy ke RAILWAY
└─ public/        -> Frontend (HTML statis) → deploy ke VERCEL
```

Kenapa dipisah begini?
- Realtime (Socket.IO / WebSocket) butuh server yang hidup terus-menerus → cocoknya **Railway**
  (bukan serverless function seperti Vercel yang mati-hidup per-request).
- Frontend statis (HTML/JS/CSS) paling murah & cepat di-hosting sebagai static site di **Vercel**.
- Frontend akan connect ke backend Railway lewat URL publiknya (REST API + WebSocket).

---

## 1. Setup Google OAuth (butuh Client ID & Client Secret Anda)

1. Buka https://console.cloud.google.com/apis/credentials
2. Buat **OAuth 2.0 Client ID** tipe **Web application**.
3. Authorized redirect URI, isi:
   ```
   https://NAMA-APP-ANDA.up.railway.app/api/auth/google/callback
   ```
   (ganti setelah Anda tahu domain Railway-nya, bisa diedit ulang kapan saja di Google Console)
4. Authorized JavaScript origins, isi domain Vercel Anda:
   ```
   https://nama-app-anda.vercel.app
   ```
5. Simpan **Client ID** dan **Client Secret** — akan dipakai di environment variable Railway, BUKAN ditulis di kode.

---

## 2. Deploy Backend ke Railway

1. Push folder `server/` ini ke repo GitHub (boleh 1 repo untuk semuanya, Railway bisa pilih root directory `server`).
2. Di Railway: **New Project → Deploy from GitHub repo** → pilih repo, set **Root Directory = server**.
3. Tambahkan plugin **PostgreSQL** di project yang sama (Railway → New → Database → PostgreSQL).
   Railway otomatis membuat env var `DATABASE_URL` yang bisa dipakai service backend (Add Reference / Variable Reference).
4. Set Environment Variables di service backend (Railway → Variables):

   ```
   DATABASE_URL=${{Postgres.DATABASE_URL}}      # reference otomatis dari plugin Postgres
   GOOGLE_CLIENT_ID=isi_punya_anda
   GOOGLE_CLIENT_SECRET=isi_punya_anda
   GOOGLE_CALLBACK_URL=https://NAMA-APP-ANDA.up.railway.app/api/auth/google/callback
   JWT_SECRET=ganti_dengan_string_acak_panjang
   ADMIN_EMAIL=lamzy103@gmail.com
   FRONTEND_URL=https://nama-app-anda.vercel.app
   NODE_ENV=production
   PORT=8080
   ```

5. Deploy. Railway otomatis jalankan `npm install && npm start` (lihat `server/package.json`).
6. Setelah live, cek domain publiknya (Railway → Settings → Domains → Generate Domain), lalu **update lagi**:
   - `GOOGLE_CALLBACK_URL` di Railway variables (kalau domain baru diketahui setelah deploy pertama)
   - Redirect URI yang sama di Google Cloud Console

Backend otomatis membuat tabel database saat pertama kali start (lihat `server/schema.sql`, dijalankan dari `db.js`).

---

## 3. Deploy Frontend ke Vercel

1. Edit `public/config.js`, isi URL backend Railway Anda:
   ```js
   window.API_BASE_URL = "https://NAMA-APP-ANDA.up.railway.app";
   ```
2. Push folder `public/` (atau seluruh repo, root directory di-set `public` saat import ke Vercel).
3. Di Vercel: **Add New Project → Import Git Repo** → Root Directory = `public` → Framework Preset: **Other** (static) → Deploy.
4. Setelah live, catat domain Vercel-nya, lalu pastikan `FRONTEND_URL` di Railway environment variable sudah sama persis (untuk CORS & redirect setelah login Google).

---

## 4. Alur Realtime & Admin Monitoring

- Setiap user login (Google OAuth), backend mencatat baris baru ke tabel `login_history` dan mem-broadcast event
  `admin:new-login` via Socket.IO ke room `admins`.
- Hanya user dengan `role = 'admin'` (email = `ADMIN_EMAIL`) yang di-join-kan ke room `admins` saat koneksi socket
  (diverifikasi dari JWT cookie di server, bukan dari client) — jadi user biasa **tidak bisa** menguping data ini
  meskipun buka DevTools.
- Dashboard admin (`/api/admin/stats`, `/api/admin/login-history`) juga dilindungi middleware `requireAdmin` di server.

## 5. Proses HD Foto/Video

Supaya tidak kena CORS dan API key/endpoint tidak "kelihatan" & bisa diubah tanpa redeploy frontend, semua panggilan ke
API upscale foto/video sekarang lewat backend (`POST /api/upscale/photo`, `POST /api/upscale/video`), bukan langsung
dari browser lagi.

## 6. Menjalankan di Lokal (opsional, untuk testing sebelum deploy)

```bash
cd server
cp .env.example .env   # isi manual
npm install
npm run dev             # nodemon, jalan di http://localhost:8080

# di terminal lain, buka public/index.html dengan Live Server, atau:
cd public
npx serve .
```
