import axios from 'axios';
import { env } from '../config/env.ts';

export interface IncomingMessagePayload {
  from: string;
  text: string | null;
  type: string;
  timestamp: number;
  rawId: string;
}

export async function forwardToN8n(payload: IncomingMessagePayload): Promise<void> {
  await axios.post(env.n8nWebhookUrl, payload, { timeout: 10_000 });
}
