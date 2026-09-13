# WhatsApp Engine

Engine WhatsApp berbasis [Baileys](https://github.com/WhiskeySockets/Baileys) yang meneruskan pesan masuk sebagai webhook ke n8n, menyediakan REST API terdokumentasi (Swagger) untuk kontrol dasar, dan halaman web untuk scan QR & monitoring status koneksi.

Rancangan arsitektur lengkap ada di [whatsapp-engine-design.md](./whatsapp-engine-design.md).

## Tech Stack

- Node.js LTS + TypeScript (dijalankan native tanpa transpiler terpisah saat dev, lihat catatan di bawah)
- `@whiskeysockets/baileys` — koneksi WhatsApp
- Express 5 — REST API & static file serving
- Socket.IO — push QR code & status realtime ke browser
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
4. Buka `http://localhost:3000/index.html`, scan QR dari WhatsApp (Linked Devices → Link a Device).

Auth state tersimpan di folder `auth_state/` (gitignored) — sekali scan, tidak perlu scan ulang selama folder ini tidak dihapus.

## Endpoint & Halaman

| Path | Keterangan |
|---|---|
| `GET /index.html` | Halaman scan QR (realtime via Socket.IO) |
| `GET /dashboard.html` | Dashboard monitoring status koneksi (realtime) |
| `GET /health` | Health check JSON (status, last connected, reconnect count) |
| `GET /api-docs` | Dokumentasi API interaktif (Swagger UI) |
| `POST /messages/send` | Kirim pesan WhatsApp |
| `GET /session/status` | Cek status sesi |
| `GET /session/qr` | Ambil QR terakhir (fallback non-realtime) |
| `POST /session/logout` | Logout sesi & hapus auth state |

## Scripts

| Command | Keterangan |
|---|---|
| `npm run dev` | Jalankan dev server dengan hot-reload (Node native TypeScript execution, lihat catatan di bawah) |
| `npm run build` | Compile TypeScript ke `dist/` + copy asset `public/` |
| `npm start` | Jalankan hasil build (`node dist/server.js`) — untuk production |

### Catatan: kenapa dev script tidak pakai `tsx`

Baileys versi terbaru bergantung pada `whatsapp-rust-bridge`, sebuah package ESM-only tanpa fallback CommonJS. Tool transpiler populer seperti `tsx` punya resolver yang konflik dengan package semacam ini di setup tertentu. Karena itu proyek ini full ESM (`"type": "module"`) dan dev server dijalankan langsung lewat fitur native TypeScript execution Node.js (`node --experimental-strip-types`), tanpa dependency transpiler tambahan. Source tetap ditulis dengan ekstensi import `.ts` (di-rewrite otomatis jadi `.js` saat `npm run build` lewat opsi `rewriteRelativeImportExtensions`).

## Risiko

- Baileys bekerja di luar API resmi WhatsApp — ada risiko ban akun yang tidak bisa diprediksi sepenuhnya. Gunakan nomor development, bukan nomor bisnis utama, sampai stabil.
- Folder `auth_state/` setara kredensial penuh ke akun WhatsApp — jangan pernah commit ke git (sudah di-gitignore).

## Roadmap

Fase 1-4 (fondasi, QR/monitoring, webhook forwarding, REST API+Swagger) sudah selesai. Fase 5 (Docker/deployment) dan Fase 6 (hardening: enkripsi auth state, rate limiting, reconnect lebih robust) belum dikerjakan — lihat [whatsapp-engine-design.md](./whatsapp-engine-design.md) untuk detail rancangannya.
