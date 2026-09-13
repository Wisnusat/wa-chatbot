# Rancangan WhatsApp Engine (Baileys → n8n Webhook)

## 1. Ringkasan Proyek

**Tujuan:** Membangun engine WhatsApp berbasis Node.js + Baileys yang:
- Menerima pesan masuk dan meneruskannya sebagai webhook ke n8n
- Menyediakan REST API terdokumentasi (Swagger) untuk kontrol dasar (kirim pesan, cek status, dsb)
- Menyediakan interface web sederhana untuk menampilkan QR code saat linking device
- Menyediakan monitoring status koneksi/kesehatan session
- Single-account (1 nomor WA), logging ke database bersifat opsional (future work)

---

## 2. Tech Stack

| Layer | Pilihan | Keterangan |
|---|---|---|
| Runtime | Node.js (LTS) + TypeScript | Baileys native TS, type-safety untuk payload event |
| WA Library | `@whiskeysockets/baileys` | Fork aktif yang paling maintained |
| Web Framework | Express.js | REST API + serve halaman QR |
| Dokumentasi API | `swagger-jsdoc` + `swagger-ui-express` | Auto-generate dari JSDoc anotasi di route |
| Realtime QR & Status | Socket.IO (atau Server-Sent Events) | Push QR code & status koneksi ke frontend tanpa polling |
| Frontend QR/Monitoring | HTML statis + JS (atau React ringan) | Cukup 1-2 halaman: QR scan page & dashboard status |
| Queue (opsional, disiapkan sejak awal) | BullMQ + Redis | Supaya forward ke n8n tidak blocking & auto-retry |
| Logger | Pino | Default logger Baileys, structured logging |
| Config | `dotenv` | Simpan `N8N_WEBHOOK_URL`, `PORT`, dsb |
| Proses Manager | PM2 | Auto-restart kalau proses crash |
| Container | Docker + volume untuk auth state | Portabilitas & persist session |
| Database (opsional/future) | SQLite (ringan) → upgrade ke PostgreSQL | Untuk logging pesan, riwayat status |

> Karena hanya 1 akun, tidak perlu session manager multi-instance yang kompleks — cukup 1 socket Baileys yang di-manage sebagai singleton service.

---

## 3. Flow Aplikasi

### 3.1 Flow Koneksi & QR Code

```
[Start service]
      │
      ▼
Baileys initSocket()
      │
      ▼
Cek auth state tersimpan? ──Yes──► Auto-reconnect (tanpa QR)
      │No
      ▼
Generate QR code (event: connection.update, qr present)
      │
      ▼
Broadcast QR via Socket.IO ke frontend
      │
      ▼
User scan QR dari HP
      │
      ▼
connection.update → status "open"
      │
      ▼
Simpan auth state (creds.json) ke storage
      │
      ▼
Broadcast status "connected" ke dashboard
```

### 3.2 Flow Pesan Masuk → Webhook n8n

```
WhatsApp (pesan masuk)
      │
      ▼
Baileys event: messages.upsert
      │
      ▼
Filter & normalize payload (ambil sender, text, tipe pesan, timestamp)
      │
      ▼
(Opsional) Simpan ke DB / log lokal
      │
      ▼
Push job ke queue (BullMQ) ──► agar tidak blocking event loop
      │
      ▼
Worker proses job → HTTP POST ke N8N_WEBHOOK_URL
      │
      ├──Success──► ack job selesai
      │
      └──Failed───► retry otomatis (exponential backoff)
```

### 3.3 Flow Kirim Pesan (dari n8n / API)

```
Request masuk ke REST API (POST /messages/send)
      │
      ▼
Validasi input (nomor tujuan, tipe pesan, isi)
      │
      ▼
Cek status socket Baileys (harus "connected")
      │
      ▼
sock.sendMessage(jid, content)
      │
      ▼
Response sukses/gagal ke pemanggil (n8n)
```

### 3.4 Flow Monitoring Kesehatan

```
Interval / event-based check:
- Status socket (connecting / open / close)
- Last seen event timestamp
- Reconnect attempt count
      │
      ▼
Expose via:
  - GET /health (REST, untuk automated check)
  - Socket.IO event (untuk dashboard realtime)
```

---

## 4. Struktur Code (Folder Structure)

```
whatsapp-engine/
├── src/
│   ├── config/
│   │   └── env.ts                 # load & validasi env vars
│   ├── whatsapp/
│   │   ├── socket.ts               # inisialisasi & lifecycle Baileys socket
│   │   ├── authState.ts            # handler auth state (file/redis)
│   │   ├── eventHandlers.ts        # messages.upsert, connection.update, dll
│   │   └── sessionStatus.ts        # state management: connected/disconnected/qr
│   ├── queue/
│   │   ├── queue.ts                # setup BullMQ queue
│   │   └── worker.ts               # worker: proses job → POST ke n8n
│   ├── webhook/
│   │   └── n8nClient.ts            # HTTP client forward payload ke n8n
│   ├── routes/
│   │   ├── messages.route.ts       # POST /messages/send
│   │   ├── session.route.ts        # GET /session/qr, /session/status, /session/logout
│   │   └── health.route.ts         # GET /health
│   ├── docs/
│   │   └── swagger.ts              # setup swagger-jsdoc + swagger-ui
│   ├── sockets/
│   │   └── io.ts                   # setup Socket.IO untuk push QR & status realtime
│   ├── public/
│   │   ├── index.html              # halaman QR scan
│   │   └── dashboard.html          # halaman monitoring status/health
│   ├── db/                         # (opsional/future work)
│   │   ├── models/
│   │   └── client.ts
│   ├── utils/
│   │   └── logger.ts               # setup Pino
│   ├── app.ts                      # setup Express app & middleware
│   └── server.ts                   # entrypoint: start server + start WA socket
├── auth_state/                     # volume untuk creds.json (di-gitignore)
├── .env.example
├── Dockerfile
├── docker-compose.yml              # app + redis (+ postgres kalau sudah pakai DB)
├── package.json
├── tsconfig.json
└── README.md
```

**Prinsip pemisahan tanggung jawab:**
- `whatsapp/` murni urusan Baileys (socket lifecycle, auth, event)
- `queue/` + `webhook/` urusan forwarding ke n8n (decoupled dari Baileys)
- `routes/` murni REST API (tidak tahu detail internal Baileys, panggil service layer)
- `sockets/` murni untuk push realtime ke frontend (QR & status)
- `db/` disiapkan sebagai folder kosong/opsional agar mudah diaktifkan nanti tanpa restrukturisasi besar

---

## 5. Detail Komponen Penting

### 5.1 Auth State
- Fase awal (1 akun): cukup `useMultiFileAuthState` bawaan Baileys, simpan di folder `auth_state/` yang di-mount sebagai Docker volume
- Future work bila perlu portabilitas lebih (redeploy tanpa hilang session): pindah ke Redis-based auth state adapter

### 5.2 QR Code Interface
- Saat event `connection.update` menghasilkan `qr` string, convert ke image (library `qrcode`) lalu:
  - Kirim via Socket.IO event `qr:update` ke halaman `index.html`
  - Halaman render `<img>` dari base64 QR, auto-refresh tiap kali QR baru di-generate (QR Baileys expired ~20 detik)
- Setelah `connection.update` status `open`, kirim event `qr:cleared` + `status:connected` agar frontend switch ke tampilan "Connected"

### 5.3 Monitoring & Health
- State disimpan in-memory: `status`, `lastConnectedAt`, `reconnectCount`, `lastMessageAt`
- `GET /health` return JSON status untuk keperluan automated monitoring (misal dicek n8n atau uptime checker)
- Dashboard (`dashboard.html`) subscribe Socket.IO event `status:update` untuk tampilan realtime tanpa reload

### 5.4 Swagger
- Anotasi JSDoc di tiap route (`@swagger` comment block) di-scan oleh `swagger-jsdoc`
- Expose di `/api-docs` via `swagger-ui-express`
- Dokumentasikan minimal endpoint:
  - `POST /messages/send`
  - `GET /session/status`
  - `GET /session/qr` (opsional, karena QR real-time via socket, endpoint ini bisa jadi fallback)
  - `POST /session/logout`
  - `GET /health`

### 5.5 Queue (BullMQ)
- Meski awalnya 1 akun & volume rendah, tetap disiapkan sejak awal supaya:
  - Event `messages.upsert` tidak nge-block kalau n8n lambat/down
  - Ada retry otomatis dengan backoff kalau POST ke n8n gagal
- Redis cukup jalan sebagai single container di `docker-compose.yml`

### 5.6 Database (Opsional / Future Work)
- Tidak diimplementasi di fase awal
- Struktur folder `db/` disiapkan kosong agar saat dibutuhkan (misal untuk log riwayat pesan, audit, analytics) tinggal:
  - Tambah Prisma/Drizzle ORM
  - Tambah service `messageLog.service.ts` yang dipanggil dari `eventHandlers.ts`

---

## 6. Rencana Implementasi (Roadmap)

### Fase 1 — Fondasi
- [ ] Setup project TypeScript + struktur folder
- [ ] Setup Express app + Pino logger
- [ ] Integrasi Baileys: init socket, handle `connection.update`, `creds.update`
- [ ] Simpan auth state ke file (`useMultiFileAuthState`)
- [ ] Test koneksi dasar: scan QR dari terminal (log ASCII QR dulu untuk validasi)

### Fase 2 — Interface QR & Monitoring
- [ ] Setup Socket.IO
- [ ] Buat halaman `index.html` untuk render QR (base64 image)
- [ ] Broadcast event `qr:update`, `status:update` dari socket handler
- [ ] Buat halaman `dashboard.html` untuk monitoring status realtime
- [ ] Implementasi `GET /health`

### Fase 3 — Webhook Forwarding ke n8n
- [ ] Setup Redis + BullMQ (queue & worker)
- [ ] Handle `messages.upsert` → normalize payload → push ke queue
- [ ] Worker: POST payload ke `N8N_WEBHOOK_URL`
- [ ] Test end-to-end: kirim pesan dari HP → cek payload sampai di n8n

### Fase 4 — REST API & Swagger
- [ ] Implementasi `POST /messages/send`
- [ ] Implementasi `POST /session/logout`
- [ ] Implementasi `GET /session/status`
- [ ] Setup `swagger-jsdoc` + `swagger-ui-express`, expose `/api-docs`
- [ ] Anotasi semua endpoint dengan JSDoc Swagger

### Fase 5 — Containerization & Deployment
- [ ] Buat `Dockerfile` (multi-stage build)
- [ ] Buat `docker-compose.yml` (app + redis)
- [ ] Setup volume untuk `auth_state/`
- [ ] Setup PM2 (kalau tidak pakai Docker) atau restart policy Docker
- [ ] Dokumentasi `.env.example` & README setup instructions

### Fase 6 — Hardening (opsional, sebelum production)
- [ ] Enkripsi auth state at-rest
- [ ] Rate limiting sederhana pada event forwarding (anti-ban awareness)
- [ ] Tambah reconnect logic yang robust (exponential backoff, max retry)
- [ ] (Future) Aktifkan logging ke database untuk audit pesan

---

## 7. Catatan Risiko (Ringkasan)

- Baileys bekerja di luar API resmi WhatsApp — ada risiko ban akun yang tidak bisa diprediksi sepenuhnya
- Gunakan nomor khusus untuk development, bukan nomor bisnis utama, sampai stabil
- Simpan `auth_state/` dengan aman — file ini setara kredensial penuh akses ke akun WA
- Hindari deploy dari IP datacenter murah tanpa mitigasi kalau nanti volume pesan mulai tinggi
