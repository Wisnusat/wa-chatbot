import qrcodeTerminal from 'qrcode-terminal';
import qrcode from 'qrcode';
import { Boom } from '@hapi/boom';
import {
  DisconnectReason,
  extractMessageContent,
  getContentType,
  isLidUser,
  isPnUser,
  type WAMessage,
  type WAMessageKey,
  type WASocket,
} from '@whiskeysockets/baileys';
import { logger } from '../utils/logger.ts';
import { updateStatus, getFullStatus } from './sessionStatus.ts';
import { getIO } from '../sockets/io.ts';
import { enqueueForward } from '../queue/queue.ts';
import { addMessageLog } from './messageLog.ts';
import { hasKnownChat, touchKnownChat, upsertKnownChat } from './chatDirectory.ts';
import { isJidAllowed } from './allowlist.ts';
import { cacheIncomingMessage } from './quotedCache.ts';
import type { IncomingMessagePayload } from '../webhook/n8nClient.ts';

type SaveCreds = () => Promise<void>;

function extractPhoneNumber(jid: string | undefined): string | null {
  if (!jid) return null;
  return jid.split(/[:@]/)[0] ?? null;
}

/**
 * Baileys v7 bisa mengalamatkan pengirim pakai LID (`xxx@lid`) alih-alih nomor HP.
 * Cari nomor HP-nya: JID utama kalau sudah PN, lalu JID alternatif dari key,
 * terakhir lookup ke LID mapping store milik Baileys.
 */
async function resolveSenderPhone(
  sock: WASocket,
  key: WAMessageKey,
  isGroup: boolean,
): Promise<string | null> {
  const primary = isGroup ? key.participant : key.remoteJid;
  const alt = isGroup ? key.participantAlt : key.remoteJidAlt;

  if (isPnUser(primary ?? undefined)) return extractPhoneNumber(primary ?? undefined);
  if (isPnUser(alt)) return extractPhoneNumber(alt);

  if (primary && isLidUser(primary)) {
    try {
      const pn = await sock.signalRepository.lidMapping.getPNForLID(primary);
      return extractPhoneNumber(pn ?? undefined);
    } catch (err) {
      logger.warn({ err, lid: primary }, 'Failed to resolve phone number for LID');
    }
  }

  return null;
}

async function resolveChatName(
  sock: WASocket,
  jid: string,
  isGroup: boolean,
  pushName: string | null | undefined,
): Promise<string> {
  if (!isGroup) return pushName ?? jid;

  try {
    const metadata = await sock.groupMetadata(jid);
    return metadata.subject || jid;
  } catch {
    return jid;
  }
}

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
        phoneNumber: extractPhoneNumber(sock.user?.id),
        lastConnectedAt: new Date().toISOString(),
      });
      logger.info('WhatsApp connection open');
      getIO().emit('qr:cleared');
      getIO().emit('status:update', getFullStatus());
    }

    if (connection === 'close') {
      const statusCode = (lastDisconnect?.error as Boom | undefined)?.output?.statusCode;
      const isLoggedOut = statusCode === DisconnectReason.loggedOut;
      updateStatus({ status: 'close' });
      logger.warn({ statusCode, isLoggedOut }, 'WhatsApp connection closed');
      getIO().emit('status:update', getFullStatus());
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const msg of messages) {
      await handleIncomingMessage(sock, msg).catch((err) =>
        logger.error({ err, msgId: msg.key.id }, 'Failed to process incoming message'),
      );
    }
  });
}

async function handleIncomingMessage(sock: WASocket, msg: WAMessage): Promise<void> {
  if (msg.key.fromMe || msg.key.remoteJid === 'status@broadcast' || !msg.message) {
    return;
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
  cacheIncomingMessage(msg);

  const from = msg.key.remoteJid ?? 'unknown';
  const isGroup = from.endsWith('@g.us');

  const payload: IncomingMessagePayload = {
    from,
    isGroup,
    sender: (isGroup ? msg.key.participant : from) ?? from,
    senderName: msg.pushName ?? null,
    senderPhone: await resolveSenderPhone(sock, msg.key, isGroup),
    text,
    type: contentType ?? 'unknown',
    timestamp: Number(msg.messageTimestamp ?? Math.floor(Date.now() / 1000)),
    rawId: msg.key.id ?? '',
  };

  addMessageLog(payload);
  getIO().emit('message:received', payload);

  if (hasKnownChat(payload.from)) {
    touchKnownChat(payload.from);
  } else {
    resolveChatName(sock, payload.from, isGroup, msg.pushName)
      .then((name) => upsertKnownChat(payload.from, name, isGroup))
      .catch((err) => logger.error(err, 'Failed to resolve chat name'));
  }

  if (isJidAllowed(payload.from)) {
    enqueueForward(payload).catch((err) =>
      logger.error(err, 'Failed to enqueue message for n8n forwarding'),
    );
  } else {
    logger.info({ jid: payload.from }, 'Message skipped: not in allowlist');
  }
}
