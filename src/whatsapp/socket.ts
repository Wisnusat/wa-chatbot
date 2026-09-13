import { Boom } from '@hapi/boom';
import makeWASocket, { DisconnectReason, type WASocket } from '@whiskeysockets/baileys';
import { logger } from '../utils/logger.ts';
import { getAuthState } from './authState.ts';
import { registerEventHandlers } from './eventHandlers.ts';
import { updateStatus, getStatus } from './sessionStatus.ts';

let sock: WASocket | null = null;

export async function initSocket(): Promise<WASocket> {
  const { state, saveCreds } = await getAuthState();

  sock = makeWASocket({
    auth: state,
    logger: logger.child({ module: 'baileys' }),
  });

  registerEventHandlers(sock, saveCreds);

  sock.ev.on('connection.update', (update) => {
    if (update.connection === 'close') {
      const statusCode = (update.lastDisconnect?.error as Boom | undefined)?.output?.statusCode;
      const isLoggedOut = statusCode === DisconnectReason.loggedOut;

      if (!isLoggedOut) {
        updateStatus({ reconnectCount: getStatus().reconnectCount + 1 });
        initSocket().catch((err) => logger.error(err, 'Failed to reconnect WhatsApp socket'));
      } else {
        logger.warn('WhatsApp session logged out — QR scan required to reconnect');
      }
    }
  });

  return sock;
}

export function getSocket(): WASocket {
  if (!sock) {
    throw new Error('WhatsApp socket has not been initialized yet');
  }
  return sock;
}
