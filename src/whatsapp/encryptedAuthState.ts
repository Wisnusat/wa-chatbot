import { mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import {
  BufferJSON,
  initAuthCreds,
  proto,
  type AuthenticationState,
  type SignalDataTypeMap,
} from '@whiskeysockets/baileys';
import { logger } from '../utils/logger.ts';

const ALGORITHM = 'aes-256-gcm';
const KEY_DERIVATION_SALT = 'wa-chatbot-auth-state-v1';

function deriveKey(passphrase: string): Buffer {
  return scryptSync(passphrase, KEY_DERIVATION_SALT, 32);
}

function encrypt(plaintext: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return JSON.stringify({
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    data: ciphertext.toString('base64'),
  });
}

function decrypt(payload: string, key: Buffer): string {
  const { iv, tag, data } = JSON.parse(payload) as { iv: string; tag: string; data: string };
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]);
  return plaintext.toString('utf-8');
}

const fixFileName = (file: string) => file.replace(/\//g, '__').replace(/:/g, '-');

/**
 * Varian useMultiFileAuthState Baileys yang mengenkripsi (AES-256-GCM) setiap file
 * sebelum ditulis ke disk. File lama (belum terenkripsi) tetap bisa dibaca sekali
 * sebagai fallback migrasi, lalu otomatis ditulis ulang dalam bentuk terenkripsi.
 */
export async function useEncryptedMultiFileAuthState(
  folder: string,
  passphrase: string,
): Promise<{ state: AuthenticationState; saveCreds: () => Promise<void> }> {
  const key = deriveKey(passphrase);

  const writeData = async (data: unknown, file: string): Promise<void> => {
    const filePath = join(folder, fixFileName(file));
    const serialized = JSON.stringify(data, BufferJSON.replacer);
    await writeFile(filePath, encrypt(serialized, key), 'utf-8');
  };

  const readData = async (file: string): Promise<unknown> => {
    const filePath = join(folder, fixFileName(file));
    let raw: string;
    try {
      raw = await readFile(filePath, 'utf-8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }

    let envelope: unknown;
    try {
      envelope = JSON.parse(raw);
    } catch {
      logger.error({ file }, 'auth_state file rusak (bukan JSON valid), diabaikan');
      return null;
    }

    const looksEncrypted =
      !!envelope &&
      typeof envelope === 'object' &&
      'iv' in (envelope as object) &&
      'tag' in (envelope as object) &&
      'data' in (envelope as object);

    if (looksEncrypted) {
      try {
        return JSON.parse(decrypt(raw, key), BufferJSON.reviver);
      } catch {
        throw new Error(
          `Gagal dekripsi "${file}": AUTH_STATE_ENCRYPTION_KEY salah atau file korup. ` +
            'Pastikan memakai passphrase yang sama seperti saat auth_state ini pertama dibuat.',
        );
      }
    }

    // Format lama (belum terenkripsi) — migrasi otomatis, sekali jalan
    logger.warn({ file }, 'auth_state file tidak terenkripsi, migrasi otomatis ke format terenkripsi');
    const legacy = JSON.parse(raw, BufferJSON.reviver);
    await writeData(legacy, file);
    return legacy;
  };

  const removeData = async (file: string): Promise<void> => {
    try {
      await unlink(join(folder, fixFileName(file)));
    } catch {
      // File sudah tidak ada, abaikan
    }
  };

  const folderInfo = await stat(folder).catch(() => null);
  if (folderInfo && !folderInfo.isDirectory()) {
    throw new Error(`${folder} bukan folder, hapus atau pindahkan dulu`);
  }
  if (!folderInfo) {
    await mkdir(folder, { recursive: true });
  }

  const creds = ((await readData('creds.json')) as AuthenticationState['creds']) ?? initAuthCreds();

  return {
    state: {
      creds,
      keys: {
        get: async <T extends keyof SignalDataTypeMap>(type: T, ids: string[]) => {
          const data: Record<string, SignalDataTypeMap[T]> = {};
          await Promise.all(
            ids.map(async (id) => {
              let value = await readData(`${type}-${id}.json`);
              if (type === 'app-state-sync-key' && value) {
                value = proto.Message.AppStateSyncKeyData.fromObject(value as object);
              }
              data[id] = value as SignalDataTypeMap[T];
            }),
          );
          return data;
        },
        set: async (data) => {
          const tasks: Promise<void>[] = [];
          for (const category in data) {
            for (const id in data[category as keyof typeof data]) {
              const value = data[category as keyof typeof data]?.[id];
              const file = `${category}-${id}.json`;
              tasks.push(value ? writeData(value, file) : removeData(file));
            }
          }
          await Promise.all(tasks);
        },
      },
    },
    saveCreds: () => writeData(creds, 'creds.json'),
  };
}
