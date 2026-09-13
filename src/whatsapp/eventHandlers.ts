import qrcodeTerminal from 'qrcode-terminal';
import qrcode from 'qrcode';
import { Boom } from '@hapi/boom';
import {
  DisconnectReason,
  extractMessageContent,
  getContentType,
  type WASocket,
} from '@whiskeysockets/baileys';
import { logger } from '../utils/logger.ts';
import { updateStatus, getStatus } from './sessionStatus.ts';
import { getIO } from '../sockets/io.ts';
import { enqueueForward } from '../queue/queue.ts';

type SaveCreds = () => Promise<void>;

export function registerEventHandlers(sock: WASocket, saveCreds: SaveCreds): void {
  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, qr, lastDisconnect } = update;

    if (qr) {
      qrcodeTerminal.generate(qr, { small: true });
      logger.info('QR code generated — scan with WhatsApp to link this device');

      qrcode
        .toDataURL(qr)
        .then((qrDataUrl) => {
          updateStatus({ status: 'qr', qr: qrDataUrl });
          getIO().emit('qr:update', { qr: qrDataUrl });
        })
        .catch((err) => logger.error(err, 'Failed to render QR code as image'));
    }

    if (connection === 'open') {
      updateStatus({
        status: 'open',
        qr: null,
        lastConnectedAt: new Date().toISOString(),
      });
      logger.info('WhatsApp connection open');
      getIO().emit('qr:cleared');
      getIO().emit('status:update', getStatus());
    }

    if (connection === 'close') {
      const statusCode = (lastDisconnect?.error as Boom | undefined)?.output?.statusCode;
      const isLoggedOut = statusCode === DisconnectReason.loggedOut;
      updateStatus({ status: 'close' });
      logger.warn({ statusCode, isLoggedOut }, 'WhatsApp connection closed');
      getIO().emit('status:update', getStatus());
    }
  });

  sock.ev.on('messages.upsert', ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const msg of messages) {
      if (msg.key.fromMe || msg.key.remoteJid === 'status@broadcast' || !msg.message) {
        continue;
      }

      const content = extractMessageContent(msg.message);
      const contentType = getContentType(content);
      const text =
        content?.conversation ??
        content?.extendedTextMessage?.text ??
        content?.imageMessage?.caption ??
        content?.videoMessage?.caption ??
        content?.documentMessage?.caption ??
        null;

      updateStatus({ lastMessageAt: new Date().toISOString() });

      enqueueForward({
        from: msg.key.remoteJid ?? 'unknown',
        text,
        type: contentType ?? 'unknown',
        timestamp: Number(msg.messageTimestamp ?? Math.floor(Date.now() / 1000)),
        rawId: msg.key.id ?? '',
      }).catch((err) => logger.error(err, 'Failed to enqueue message for n8n forwarding'));
    }
  });
}
