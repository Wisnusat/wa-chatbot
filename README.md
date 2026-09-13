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
3. Jalankan dev server:
   ```
   npm run dev
   ```
4. Buka `http://localhost:3000/api-docs` untuk cek API, atau hubungkan frontend eksternal ke Socket.IO untuk scan QR (lihat bagian **Socket.IO Events** di bawah).

Auth state tersimpan di folder `auth_state/` (gitignored) — sekali scan, tidak perlu scan ulang selama folder ini tidak dihapus.

## REST Endpoint

| Path | Keterangan |
|---|---|
| `GET /health` | Health check JSON (status, last connected, reconnect count) |
| `GET /api-docs` | Dokumentasi API interaktif (Swagger UI) |
| `POST /messages/send` | Kirim pesan WhatsApp |
| `GET /session/status` | Cek status sesi — termasuk `phoneNumber` (nomor terkoneksi) dan `n8nWebhookUrl` |
| `GET /session/qr` | Ambil QR terakhir dalam bentuk base64 data URL (fallback non-realtime, untuk frontend yang belum konek Socket.IO) |
| `POST /session/logout` | Logout sesi & hapus auth state (dipakai juga untuk "ganti nomor" — otomatis generate QR baru setelahnya) |
| `GET /logs/messages` | Riwayat pesan WhatsApp masuk (in-memory, maks 200 terakhir) |
| `GET /logs/forwards` | Riwayat hasil forward ke n8n — sukses/gagal per percobaan (in-memory, maks 200 terakhir) |

## Socket.IO Events

Frontend eksternal connect ke server ini via Socket.IO client (`io("http://localhost:3000")`) dan subscribe event berikut untuk render QR, status, dan log realtime:

| Event | Payload | Kapan dikirim |
|---|---|---|
| `qr:update` | `{ qr: string }` (base64 data URL) | Setiap kali QR baru digenerate (expired ~20 detik) |
| `qr:cleared` | — | Saat koneksi berhasil dibuka, sembunyikan QR di UI |
| `status:update` | Sama seperti response `GET /session/status` | Saat status koneksi berubah (open/close) |
| `message:received` | `{ from, text, type, timestamp, rawId }` | Setiap pesan WhatsApp masuk baru |
| `forward:result` | `{ jobId, status: 'success'\|'failed', attempt, timestamp, error, payload }` | Setiap kali worker selesai (atau gagal) forward pesan ke n8n |

> Catatan: log pesan & forward disimpan in-memory (reset kalau server restart), belum persisten ke database — cukup untuk monitoring dashboard, bukan audit trail jangka panjang.

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

## Roadmap

Fase 1-4 (fondasi, QR/monitoring, webhook forwarding, REST API+Swagger) sudah selesai. Fase 5 (Docker/deployment) dan Fase 6 (hardening: enkripsi auth state, rate limiting, reconnect lebih robust) belum dikerjakan — lihat [whatsapp-engine-design.md](./whatsapp-engine-design.md) untuk detail rancangannya.
