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

export async function enqueueForward(payload: IncomingMessagePayload): Promise<void> {
  await n8nForwardQueue.add('forward', payload);
}
