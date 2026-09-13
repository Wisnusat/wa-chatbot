# WhatsApp Engine

Engine WhatsApp berbasis [Baileys](https://github.com/WhiskeySockets/Baileys) yang meneruskan pesan masuk sebagai webhook ke n8n, dan menyediakan REST API terdokumentasi (Swagger) + event Socket.IO untuk kontrol dasar dan monitoring status koneksi.

Ini adalah **backend murni (headless)** — tidak ada halaman web bawaan. Interface (QR scan page, dashboard monitoring) dibangun sebagai project terpisah yang mengonsumsi REST API & Socket.IO di bawah ini. CORS sudah diaktifkan (`origin: '*'`) agar bisa diakses dari origin manapun.

Rancangan arsitektur lengkap ada di [whatsapp-engine-design.md](./whatsapp-engine-design.md).

## Tech Stack

- Node.js LTS + TypeScript (dijalankan native tanpa transpiler terpisah saat dev, lihat catatan di bawah)
- `@whiskeysockets/baileys` — koneksi WhatsApp
- Express 5 — REST API
- Socket.IO — push QR code & status realtime ke frontend eksternal
- BullMQ + Redis (Upstash) — antrian forwarding pesan ke n8n dengan retry otomatis
- Pino — structured logging
- `swagger-jsdoc` + `swagger-ui-express` — dokumentasi API otomatis

## Setup

1. Install dependencies:
   ```
   npm install
   ```
2. Copy `.env.example` ke `.env`, lalu isi:
   - `N8N_WEBHOOK_URL` — endpoint webhook n8n tujuan forwarding pesan masuk
   - `REDIS_URL` — connection string Redis (rekomendasi: buat database gratis di [Upstash](https://console.upstash.com), ambil connection string dari tab **Connect** driver **ioredis**, formatnya `rediss://default:<password>@<endpoint>.upstash.io:6379`)
   - `SEND_RATE_LIMIT_MAX` / `SEND_RATE_LIMIT_WINDOW_MS` — opsional, default 20 pesan/60 detik (lihat bagian **Reconnect & Rate Limiting**)
   - `AUTH_STATE_ENCRYPTION_KEY` — **wajib**, passphrase rahasia untuk enkripsi `auth_state/` (lihat bagian **Enkripsi Auth State** di bawah). Generate dengan:
     ```
     node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
     ```
3. Jalankan dev server:
   ```
   npm run dev
   ```
4. Buka `http://localhost:3000/api-docs` untuk cek API, atau hubungkan frontend eksternal ke Socket.IO untuk scan QR (lihat bagian **Socket.IO Events** di bawah).

Auth state tersimpan terenkripsi di folder `auth_state/` (gitignored) — sekali scan, tidak perlu scan ulang selama folder ini tidak dihapus dan `AUTH_STATE_ENCRYPTION_KEY` tidak berubah.

## Enkripsi Auth State

`auth_state/` setara kredensial penuh ke akun WhatsApp, jadi setiap file di dalamnya dienkripsi (AES-256-GCM) sebelum ditulis ke disk — implementasinya di [src/whatsapp/encryptedAuthState.ts](src/whatsapp/encryptedAuthState.ts), pengganti `useMultiFileAuthState` bawaan Baileys yang menyimpan plain JSON.

- Key diturunkan dari `AUTH_STATE_ENCRYPTION_KEY` via `scrypt`. **Jangan sampai hilang/berubah** — auth state lama tidak bisa didekripsi dengan key yang berbeda (server akan gagal start dengan error jelas, bukan diam-diam kehilangan sesi).
- File `auth_state/` lama (belum terenkripsi, dari sebelum fitur ini ada) otomatis terdeteksi dan di-migrasi ke format terenkripsi saat pertama kali dibaca — tidak perlu scan ulang QR saat upgrade.
- Kalau memang sengaja mau reset total (ganti key atau lupa key lama), hapus folder `auth_state/` dan scan ulang dari nol.

## REST Endpoint

| Path | Keterangan |
|---|---|
| `GET /health` | Health check JSON (status, last connected, reconnect count) |
| `GET /api-docs` | Dokumentasi API interaktif (Swagger UI) |
| `POST /messages/send` | Kirim pesan WhatsApp |
| `GET /session/status` | Cek status sesi — termasuk `phoneNumber` (nomor terkoneksi) dan `n8nWebhookUrl` |
| `GET /session/qr` | Ambil QR terakhir dalam bentuk base64 data URL (fallback non-realtime, untuk frontend yang belum konek Socket.IO) |
| `POST /session/logout` | Logout sesi & hapus auth state (dipakai juga untuk "ganti nomor" — otomatis generate QR baru setelahnya) |
| `POST /session/reconnect` | Paksa reconnect (reset counter auto-reconnect), tanpa hapus auth state — untuk pemulihan manual kalau auto-reconnect sudah menyerah |
| `GET /logs/messages` | Riwayat pesan WhatsApp masuk (in-memory, maks 200 terakhir) |
| `GET /logs/forwards` | Riwayat hasil forward ke n8n — sukses/gagal per percobaan (in-memory, maks 200 terakhir) |
| `GET /allowlist` | Ambil konfigurasi filter forwarding (`{ enabled, jids }`) |
| `PUT /allowlist` | Ganti filter forwarding — kalau `enabled: true`, hanya JID di `jids` yang diteruskan ke n8n |
| `GET /chats/known` | Daftar grup/kontak yang pernah kirim pesan (untuk dipilih sebagai allowlist) |

## Socket.IO Events

Frontend eksternal connect ke server ini via Socket.IO client (`io("http://localhost:3000")`) dan subscribe event berikut untuk render QR, status, dan log realtime:

| Event | Payload | Kapan dikirim |
|---|---|---|
| `qr:update` | `{ qr: string }` (base64 data URL) | Setiap kali QR baru digenerate (expired ~20 detik) |
| `qr:cleared` | — | Saat koneksi berhasil dibuka, sembunyikan QR di UI |
| `status:update` | Sama seperti response `GET /session/status` | Saat status koneksi berubah (open/close) |
| `message:received` | `{ from, text, type, timestamp, rawId }` | Setiap pesan WhatsApp masuk baru |
| `forward:result` | `{ jobId, status: 'success'\|'failed', attempt, timestamp, error, payload }` | Setiap kali worker selesai (atau gagal) forward pesan ke n8n |
| `chat:known` | `{ jid, name, isGroup, lastMessageAt }` | Saat grup/kontak baru terdeteksi pertama kali mengirim pesan |
| `allowlist:update` | `{ enabled, jids }` | Saat allowlist diubah lewat `PUT /allowlist` |

> Catatan: log pesan, forward, dan daftar chat dikenal disimpan in-memory (reset kalau server restart), belum persisten ke database — cukup untuk monitoring dashboard, bukan audit trail jangka panjang. Allowlist sendiri **persisten** ke file `data/allowlist.json` (gitignored), jadi tetap tersimpan lintas restart.

## Filter Pesan (Allowlist)

Secara default, **semua** pesan masuk diteruskan ke n8n. Untuk membatasi hanya dari grup/kontak tertentu:

1. `GET /chats/known` untuk lihat daftar JID yang pernah mengirim pesan (nama grup di-resolve otomatis via `sock.groupMetadata`, nama kontak dari `pushName` WhatsApp).
2. `PUT /allowlist` dengan body `{ "enabled": true, "jids": ["<jid1>", "<jid2>"] }` — hanya JID di daftar ini yang akan di-forward ke n8n setelahnya. Pesan lain tetap tercatat di `/logs/messages` (untuk visibility), tapi tidak dikirim ke webhook.
3. Set `enabled: false` untuk kembali forward semua pesan.

## Reconnect & Rate Limiting

- **Auto-reconnect** pakai exponential backoff (2s, 4s, 8s, ... maks 60s per percobaan) dan berhenti otomatis setelah 10 kali gagal berturut-turut (supaya tidak spam-reconnect ke WhatsApp kalau jaringan/server bermasalah lama). Kalau sudah menyerah, panggil `POST /session/reconnect` untuk coba lagi manual — counter di-reset, tidak perlu scan QR ulang selama auth state masih valid.
- **Rate limit** di `POST /messages/send`: default maks 20 pesan per 60 detik, berlaku **global** (bukan per-IP/per-caller) karena tujuannya membatasi total volume yang keluar dari satu akun WhatsApp ini, bukan membatasi satu klien. Kelebihan limit dapat response `429`. Atur lewat `SEND_RATE_LIMIT_MAX` dan `SEND_RATE_LIMIT_WINDOW_MS` di `.env`.

## Deployment (Docker)

Image dibangun multi-stage (`Dockerfile`) — stage build compile TypeScript, stage production cuma bawa `dist/` + dependency production (`npm ci --omit=dev`), jalan sebagai non-root user (`node`) bawaan image `node:22-alpine`.

```bash
# Build & jalankan lokal
docker compose up --build

# Atau manual tanpa compose
docker build -t wa-chatbot .
docker run -d --name wa-chatbot \
  --env-file .env \
  -p 3000:3000 \
  -v wa-chatbot-auth-state:/app/auth_state \
  -v wa-chatbot-data:/app/data \
  wa-chatbot
```

- **`auth_state/`** dan **`data/`** harus jadi **persistent volume** (bukan folder biasa di container) — kalau tidak, sesi WhatsApp & allowlist hilang tiap kali container di-redeploy/restart.
- Redis pakai Upstash (cloud), jadi `docker-compose.yml` tidak menyertakan container Redis — kalau nanti pindah ke Redis self-hosted, tinggal tambah service `redis:7-alpine` di compose dan ganti `REDIS_URL`.
- `HEALTHCHECK` bawaan Dockerfile hit `GET /health` — kalau deploy ke Kubernetes/OpenShift, ini bisa dipetakan langsung ke `livenessProbe`/`readinessProbe` (HTTP GET `/health` di port container).
- Image ini portable ke platform manapun yang menerima container: Kubernetes/OpenShift (termasuk K-PaaS), Docker Compose di VM, atau container registry lain — tidak ada asumsi platform spesifik di dalam Dockerfile-nya.

## Multi-Akun WhatsApp?

Engine ini didesain **single-account** (satu socket Baileys, satu `auth_state/`). "Ganti nomor" (logout nomor lama → scan QR nomor baru) sudah didukung lewat `POST /session/logout`. Multi-akun yang jalan **bersamaan** secara teknis mungkin dengan Baileys, tapi butuh refactor arsitektur (auth state & socket per-sesi, endpoint session-aware) yang belum diimplementasikan — dicatat sebagai enhancement masa depan, bukan bagian dari versi saat ini.

## Scripts

| Command | Keterangan |
|---|---|
| `npm run dev` | Jalankan dev server dengan hot-reload (Node native TypeScript execution, lihat catatan di bawah) |
| `npm run build` | Compile TypeScript ke `dist/` |
| `npm start` | Jalankan hasil build (`node dist/server.js`) — untuk production |

### Catatan: kenapa dev script tidak pakai `tsx`

Baileys versi terbaru bergantung pada `whatsapp-rust-bridge`, sebuah package ESM-only tanpa fallback CommonJS. Tool transpiler populer seperti `tsx` punya resolver yang konflik dengan package semacam ini di setup tertentu. Karena itu proyek ini full ESM (`"type": "module"`) dan dev server dijalankan langsung lewat fitur native TypeScript execution Node.js (`node --experimental-strip-types`), tanpa dependency transpiler tambahan. Source tetap ditulis dengan ekstensi import `.ts` (di-rewrite otomatis jadi `.js` saat `npm run build` lewat opsi `rewriteRelativeImportExtensions`).

## Risiko

- Baileys bekerja di luar API resmi WhatsApp — ada risiko ban akun yang tidak bisa diprediksi sepenuhnya. Gunakan nomor development, bukan nomor bisnis utama, sampai stabil.
- Folder `auth_state/` setara kredensial penuh ke akun WhatsApp — jangan pernah commit ke git (sudah di-gitignore).

