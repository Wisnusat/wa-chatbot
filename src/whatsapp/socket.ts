import { Boom } from '@hapi/boom';
import makeWASocket, { DisconnectReason, type WASocket } from '@whiskeysockets/baileys';
import { logger } from '../utils/logger.ts';
import { getAuthState } from './authState.ts';
import { registerEventHandlers } from './eventHandlers.ts';
import { updateStatus, getStatus } from './sessionStatus.ts';

const MAX_RECONNECT_ATTEMPTS = 10;
const BASE_RECONNECT_DELAY_MS = 2000;
const MAX_RECONNECT_DELAY_MS = 60_000;

let sock: WASocket | null = null;
let reconnectAttempts = 0;

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

  setTimeout(() => {
    initSocket().catch((err) => logger.error(err, 'Failed to reconnect WhatsApp socket'));
  }, delay);
}

export async function initSocket(): Promise<WASocket> {
  const { state, saveCreds } = await getAuthState();

  sock = makeWASocket({
    auth: state,
    logger: logger.child({ module: 'baileys' }),
  });

  registerEventHandlers(sock, saveCreds);

  sock.ev.on('connection.update', (update) => {
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

  return sock;
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
