import { Boom } from '@hapi/boom';
import makeWASocket, { DisconnectReason, type WASocket } from '@whiskeysockets/baileys';
import { logger } from '../utils/logger.ts';
import { getAuthState } from './authState.ts';
import { registerEventHandlers } from './eventHandlers.ts';
import { updateStatus, getStatus, getFullStatus } from './sessionStatus.ts';
import { getIO } from '../sockets/io.ts';

const MAX_RECONNECT_ATTEMPTS = 10;
const BASE_RECONNECT_DELAY_MS = 2000;
const MAX_RECONNECT_DELAY_MS = 60_000;

let sock: WASocket | null = null;
let reconnectAttempts = 0;
let reconnectTimer: NodeJS.Timeout | null = null;

function getReconnectDelay(attempt: number): number {
  return Math.min(BASE_RECONNECT_DELAY_MS * 2 ** attempt, MAX_RECONNECT_DELAY_MS);
}

function scheduleReconnect(): void {
  if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    logger.error(
      { reconnectAttempts },
      'Max reconnect attempts reached — giving up automatic reconnect. Call POST /session/reconnect to retry manually.',
    );
    return;
  }

  const delay = getReconnectDelay(reconnectAttempts);
  reconnectAttempts += 1;
  updateStatus({ reconnectCount: getStatus().reconnectCount + 1 });
  logger.warn({ attempt: reconnectAttempts, delayMs: delay }, 'Reconnecting to WhatsApp...');

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    initSocket().catch((err) => logger.error(err, 'Failed to reconnect WhatsApp socket'));
  }, delay);
}

function cancelScheduledReconnect(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

/**
 * Tutup socket lama sebelum membuat yang baru, supaya tidak ada dua koneksi aktif
 * dengan kredensial yang sama. Listener kita dilepas dulu karena `end()` milik Baileys
 * meng-emit `connection: 'close'` sebelum membersihkan listener — tanpa ini, handler
 * close akan memicu scheduleReconnect() dan membuat socket ketiga.
 */
function closeCurrentSocket(): void {
  if (!sock) return;

  const old = sock;
  sock = null;

  try {
    old.ev.removeAllListeners('connection.update');
    old.ev.removeAllListeners('messages.upsert');
    old.ev.removeAllListeners('creds.update');
    Promise.resolve(old.end(undefined)).catch((err) =>
      logger.warn({ err }, 'Failed to close previous WhatsApp socket cleanly'),
    );
  } catch (err) {
    logger.warn({ err }, 'Failed to close previous WhatsApp socket cleanly');
  }

  // Listener status di eventHandlers sudah dilepas, jadi update manual
  updateStatus({ status: 'connecting', qr: null });
  getIO().emit('status:update', getFullStatus());
}

export async function initSocket(): Promise<WASocket> {
  cancelScheduledReconnect();
  const { state, saveCreds } = await getAuthState();

  // Setelah await: kalau ada initSocket() lain yang jalan bersamaan, yang terakhir menang
  closeCurrentSocket();

  const current = makeWASocket({
    auth: state,
    logger: logger.child({ module: 'baileys' }),
  });
  sock = current;

  registerEventHandlers(current, saveCreds);

  current.ev.on('connection.update', (update) => {
    if (current !== sock) return;

    if (update.connection === 'open') {
      reconnectAttempts = 0;
    }

    if (update.connection === 'close') {
      const statusCode = (update.lastDisconnect?.error as Boom | undefined)?.output?.statusCode;
      const isLoggedOut = statusCode === DisconnectReason.loggedOut;

      if (isLoggedOut) {
        logger.warn('WhatsApp session logged out — QR scan required to reconnect');
        return;
      }

      scheduleReconnect();
    }
  });

  return current;
}

export function reconnect(): Promise<WASocket> {
  reconnectAttempts = 0;
  return initSocket();
}

export function getSocket(): WASocket {
  if (!sock) {
    throw new Error('WhatsApp socket has not been initialized yet');
  }
  return sock;
}
