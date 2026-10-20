import type { WAMessage } from '@whiskeysockets/baileys';

// Simpan pesan masuk mentah terakhir supaya POST /messages/send bisa quote-reply
// lewat `replyTo` (rawId). In-memory: hilang saat restart, cukup untuk balasan chatbot
// yang biasanya dikirim dalam hitungan detik.
const MAX_SIZE = 500;

// jpegThumbnail, pngThumbnail, thumbnail, attachmentJpegThumbnail, dst. — preview gambar
// (bisa puluhan KB per pesan) yang tidak wajib untuk quote-reply.
const THUMBNAIL_KEY = /thumbnail/i;

const messages = new Map<string, WAMessage>();

/** Salin isi pesan tanpa field thumbnail biner, tanpa mengubah objek asli milik Baileys. */
function stripThumbnails(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripThumbnails);
  if (!value || typeof value !== 'object' || ArrayBuffer.isView(value)) return value;

  const copy: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (THUMBNAIL_KEY.test(key) && ArrayBuffer.isView(child)) continue;
    copy[key] = stripThumbnails(child);
  }
  return copy;
}

export function cacheIncomingMessage(msg: WAMessage): void {
  const id = msg.key.id;
  if (!id) return;

  messages.delete(id);
  messages.set(id, {
    key: msg.key,
    participant: msg.participant,
    pushName: msg.pushName,
    messageTimestamp: msg.messageTimestamp,
    message: stripThumbnails(msg.message) as WAMessage['message'],
  });

  if (messages.size > MAX_SIZE) {
    const oldest = messages.keys().next().value;
    if (oldest !== undefined) messages.delete(oldest);
  }
}

export function getCachedMessage(id: string): WAMessage | undefined {
  return messages.get(id);
}
