import { Router } from 'express';
import { getAllowlist, setAllowlist } from '../whatsapp/allowlist.ts';
import { getKnownChats } from '../whatsapp/chatDirectory.ts';

export const allowlistRouter = Router();

/**
 * @swagger
 * /allowlist:
 *   get:
 *     summary: Ambil konfigurasi allowlist forwarding ke n8n
 *     responses:
 *       200:
 *         description: "{ enabled: boolean, jids: string[] }"
 */
allowlistRouter.get('/allowlist', (_req, res) => {
  res.json(getAllowlist());
});

/**
 * @swagger
 * /allowlist:
 *   put:
 *     summary: Ganti konfigurasi allowlist forwarding ke n8n
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [enabled, jids]
 *             properties:
 *               enabled:
 *                 type: boolean
 *                 description: Kalau true, hanya JID di daftar "jids" yang di-forward ke n8n. Kalau false, semua pesan di-forward (default).
 *               jids:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: Daftar JID grup/kontak yang diizinkan (dari GET /chats/known)
 *     responses:
 *       200:
 *         description: Allowlist berhasil diperbarui
 *       400:
 *         description: Input tidak valid
 */
allowlistRouter.put('/allowlist', (req, res) => {
  const { enabled, jids } = req.body ?? {};

  if (typeof enabled !== 'boolean' || !Array.isArray(jids) || !jids.every((j) => typeof j === 'string')) {
    res.status(400).json({ error: '"enabled" harus boolean dan "jids" harus array of string' });
    return;
  }

  res.json(setAllowlist({ enabled, jids }));
});

/**
 * @swagger
 * /chats/known:
 *   get:
 *     summary: Daftar grup/kontak yang pernah mengirim pesan (untuk dipilih di allowlist)
 *     responses:
 *       200:
 *         description: Array of { jid, name, isGroup, lastMessageAt }
 */
allowlistRouter.get('/chats/known', (_req, res) => {
  res.json(getKnownChats());
});
