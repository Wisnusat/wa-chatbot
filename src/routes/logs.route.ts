import { Router } from 'express';
import { getMessageLogs } from '../whatsapp/messageLog.ts';
import { getForwardLogs } from '../queue/forwardLog.ts';

export const logsRouter = Router();

/**
 * @swagger
 * /logs/messages:
 *   get:
 *     summary: Riwayat pesan WhatsApp masuk (in-memory, maks 200 terakhir)
 *     responses:
 *       200:
 *         description: Daftar pesan masuk terbaru
 */
logsRouter.get('/logs/messages', (_req, res) => {
  res.json(getMessageLogs());
});

/**
 * @swagger
 * /logs/forwards:
 *   get:
 *     summary: Riwayat hasil forwarding pesan ke n8n (in-memory, maks 200 terakhir)
 *     responses:
 *       200:
 *         description: Daftar hasil forward (sukses/gagal) terbaru
 */
logsRouter.get('/logs/forwards', (_req, res) => {
  res.json(getForwardLogs());
});
