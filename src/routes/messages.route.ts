import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import type { AnyMessageContent } from '@whiskeysockets/baileys';
import { getSocket } from '../whatsapp/socket.ts';
import { getStatus } from '../whatsapp/sessionStatus.ts';
import { env } from '../config/env.ts';

export const messagesRouter = Router();

function toJid(to: string): string {
  return to.includes('@') ? to : `${to}@s.whatsapp.net`;
}

const sendRateLimiter = rateLimit({
  windowMs: env.sendRateLimitWindowMs,
  limit: env.sendRateLimitMax,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: () => 'global',
  message: { error: 'Terlalu banyak pesan dikirim dalam waktu singkat, coba lagi nanti' },
});

/**
 * @swagger
 * /messages/send:
 *   post:
 *     summary: Kirim pesan WhatsApp
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [to, type, content]
 *             properties:
 *               to:
 *                 type: string
 *                 description: Nomor tujuan (mis. 6281234567890) atau JID lengkap
 *                 example: "6281234567890"
 *               type:
 *                 type: string
 *                 description: Tipe pesan Baileys (text, image, document, dst.)
 *                 example: text
 *               content:
 *                 description: Isi pesan. Untuk type "text", berupa string. Untuk tipe lain, mengikuti bentuk AnyMessageContent Baileys.
 *                 example: "Halo dari WhatsApp Engine"
 *     responses:
 *       200:
 *         description: Pesan berhasil dikirim
 *       400:
 *         description: Input tidak valid
 *       429:
 *         description: Rate limit terlampaui
 *       503:
 *         description: Socket WhatsApp belum terhubung
 */
messagesRouter.post('/messages/send', sendRateLimiter, async (req, res) => {
  const { to, type, content } = req.body ?? {};

  if (!to || !type || content === undefined) {
    res.status(400).json({ error: 'Field "to", "type", dan "content" wajib diisi' });
    return;
  }

  if (getStatus().status !== 'open') {
    res.status(503).json({ error: 'WhatsApp socket belum terhubung' });
    return;
  }

  const message: AnyMessageContent =
    type === 'text' ? { text: String(content) } : ({ [type]: content } as AnyMessageContent);

  await getSocket().sendMessage(toJid(to), message);
  res.json({ success: true });
});
