import path from 'node:path';
import { useMultiFileAuthState } from '@whiskeysockets/baileys';

const AUTH_STATE_DIR = path.join(process.cwd(), 'auth_state');

export async function getAuthState() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_STATE_DIR);
  return { state, saveCreds };
}

export { AUTH_STATE_DIR };
