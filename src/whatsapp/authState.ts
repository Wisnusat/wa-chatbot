import path from 'node:path';
import { useEncryptedMultiFileAuthState } from './encryptedAuthState.ts';
import { env } from '../config/env.ts';

const AUTH_STATE_DIR = path.join(process.cwd(), 'auth_state');

export async function getAuthState() {
  const { state, saveCreds } = await useEncryptedMultiFileAuthState(
    AUTH_STATE_DIR,
    env.authStateEncryptionKey,
  );
  return { state, saveCreds };
}

export { AUTH_STATE_DIR };
