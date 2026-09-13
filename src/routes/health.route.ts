import { Router } from 'express';
import { getStatus } from '../whatsapp/sessionStatus.ts';

export const healthRouter = Router();

/**
 * @swagger
 * /health:
 *   get:
 *     summary: Cek kesehatan koneksi WhatsApp engine
 *     responses:
 *       200:
 *         description: Status kesehatan saat ini
 */
healthRouter.get('/health', (_req, res) => {
  const status = getStatus();
  res.json({
    status: status.status,
    lastConnectedAt: status.lastConnectedAt,
    lastMessageAt: status.lastMessageAt,
    reconnectCount: status.reconnectCount,
    uptimeSeconds: process.uptime(),
  });
});
