import axios from 'axios';
import { env } from '../config/env.ts';

export interface IncomingMessagePayload {
  /** Chat JID (grup atau kontak) — pakai ini sebagai tujuan balasan */
  from: string;
  isGroup: boolean;
  /** JID pengirim sebenarnya — participant di grup, sama dengan `from` di chat pribadi */
  sender: string;
  senderName: string | null;
  /** Nomor HP pengirim (digit saja, mis. 6281234567890) — null kalau `sender` berupa LID yang belum ter-mapping */
  senderPhone: string | null;
  text: string | null;
  type: string;
  timestamp: number;
  rawId: string;
}

export async function forwardToN8n(payload: IncomingMessagePayload): Promise<void> {
  await axios.post(env.n8nWebhookUrl, payload, { timeout: 10_000 });
}
