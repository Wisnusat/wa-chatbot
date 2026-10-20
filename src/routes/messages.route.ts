import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import type { AnyMessageContent } from '@whiskeysockets/baileys';
import { getSocket } from '../whatsapp/socket.ts';
import { getStatus } from '../whatsapp/sessionStatus.ts';
import { getCachedMessage } from '../whatsapp/quotedCache.ts';
import { env } from '../config/env.ts';
import { logger } from '../utils/logger.ts';

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
 *               replyTo:
 *                 type: string
 *                 description: >-
 *                   Opsional. `rawId` pesan masuk yang mau di-quote (balas spesifik).
 *                   Kalau pesan tidak ada di cache (server restart / terlalu lama), dikirim sebagai pesan biasa
 *                   dan response `quoted` bernilai false.
 *                 example: "3EB0ABC123DEF456"
 *               mentions:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: >-
 *                   Opsional. Daftar JID (atau nomor) yang di-mention. Supaya tampil sebagai tag,
 *                   teks juga harus memuat `@<nomor>` dari JID tersebut.
 *                 example: ["6281234567890@s.whatsapp.net"]
 *     responses:
 *       200:
 *         description: Pesan berhasil dikirim
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 quoted:
 *                   type: boolean
 *                   description: true kalau pesan terkirim sebagai quote-reply dari `replyTo`
 *       400:
 *         description: Input tidak valid
 *       429:
 *         description: Rate limit terlampaui
 *       503:
 *         description: Socket WhatsApp belum terhubung
 */
messagesRouter.post('/messages/send', sendRateLimiter, async (req, res) => {
  const { to, type, content, replyTo, mentions } = req.body ?? {};

  if (!to || !type || content === undefined) {
    res.status(400).json({ error: 'Field "to", "type", dan "content" wajib diisi' });
    return;
  }

  if (replyTo !== undefined && typeof replyTo !== 'string') {
    res.status(400).json({ error: 'Field "replyTo" harus berupa string (rawId pesan masuk)' });
    return;
  }

  if (
    mentions !== undefined &&
    (!Array.isArray(mentions) || !mentions.every((m) => typeof m === 'string'))
  ) {
    res.status(400).json({ error: 'Field "mentions" harus berupa array string (JID atau nomor)' });
    return;
  }

  if (getStatus().status !== 'open') {
    res.status(503).json({ error: 'WhatsApp socket belum terhubung' });
    return;
  }

  const message = (
    type === 'text' ? { text: String(content) } : { [type]: content }
  ) as AnyMessageContent;

  if (mentions?.length) {
    Object.assign(message, { mentions: (mentions as string[]).map(toJid) });
  }

  const quoted = replyTo ? getCachedMessage(replyTo) : undefined;
  if (replyTo && !quoted) {
    logger.warn({ replyTo }, 'replyTo not found in cache — sending without quote');
  }

  await getSocket().sendMessage(toJid(to), message, quoted ? { quoted } : undefined);
  res.json({ success: true, quoted: !!quoted });
});
