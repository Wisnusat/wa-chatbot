import { Queue } from 'bullmq';
import { redisConnection } from './redisConnection.ts';
import type { IncomingMessagePayload } from '../webhook/n8nClient.ts';

export const n8nForwardQueue = new Queue<IncomingMessagePayload>('n8n-forward', {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: { count: 1000 },
    removeOnFail: { count: 1000 },
  },
});

// Baileys bisa mengirim ulang pesan yang sama (mis. setelah reconnect/retry dekripsi).
// Dedup per chat + message ID supaya n8n tidak memproses (dan membalas) dua kali.
const DEDUP_TTL_MS = 24 * 60 * 60 * 1000;

export async function enqueueForward(payload: IncomingMessagePayload): Promise<void> {
  await n8nForwardQueue.add('forward', payload, {
    ...(payload.rawId && {
      deduplication: { id: `${payload.from}|${payload.rawId}`, ttl: DEDUP_TTL_MS },
    }),
  });
}
