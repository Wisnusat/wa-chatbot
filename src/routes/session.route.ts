import { rm } from 'node:fs/promises';
import { Router } from 'express';
import { getSocket, initSocket, reconnect } from '../whatsapp/socket.ts';
import { getStatus, getFullStatus, updateStatus } from '../whatsapp/sessionStatus.ts';
import { AUTH_STATE_DIR } from '../whatsapp/authState.ts';
import { logger } from '../utils/logger.ts';

export const sessionRouter = Router();

/**
 * @swagger
 * /session/status:
 *   get:
 *     summary: Cek status koneksi sesi WhatsApp
 *     responses:
 *       200:
 *         description: Status sesi saat ini, termasuk nomor terkoneksi dan tujuan webhook n8n
 */
sessionRouter.get('/session/status', (_req, res) => {
  res.json(getFullStatus());
});

/**
 * @swagger
 * /session/qr:
 *   get:
 *     summary: Ambil QR code terakhir (fallback non-realtime)
 *     responses:
 *       200:
 *         description: QR code dalam bentuk base64 data URL
 *       404:
 *         description: Tidak ada QR aktif (sudah terhubung atau belum digenerate)
 */
sessionRouter.get('/session/qr', (_req, res) => {
  const status = getStatus();

  if (status.status !== 'qr' || !status.qr) {
    res.status(404).json({ error: 'Tidak ada QR code aktif saat ini' });
    return;
  }

  res.json({ qr: status.qr });
});

/**
 * @swagger
 * /session/logout:
 *   post:
 *     summary: Logout sesi WhatsApp dan hapus auth state
 *     responses:
 *       200:
 *         description: Berhasil logout, sesi baru siap di-scan ulang
 */
sessionRouter.post('/session/logout', async (_req, res) => {
  await getSocket().logout();
  await rm(AUTH_STATE_DIR, { recursive: true, force: true });
  updateStatus({ status: 'connecting', qr: null, phoneNumber: null, lastConnectedAt: null });

  res.json({ success: true });

  initSocket().catch((err) => logger.error(err, 'Failed to re-initialize WhatsApp socket after logout'));
});

/**
 * @swagger
 * /session/reconnect:
 *   post:
 *     summary: Paksa reconnect socket WhatsApp (reset percobaan reconnect otomatis)
 *     description: Berguna kalau auto-reconnect sudah menyerah setelah gagal berkali-kali. Tidak menghapus auth state — kalau sesi masih valid, akan connect kembali tanpa perlu scan QR.
 *     responses:
 *       200:
 *         description: Proses reconnect dimulai
 */
sessionRouter.post('/session/reconnect', (_req, res) => {
  res.json({ success: true });
  reconnect().catch((err) => logger.error(err, 'Manual reconnect failed'));
});
