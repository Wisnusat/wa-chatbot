import { Worker } from 'bullmq';
import { redisConnection } from './redisConnection.ts';
import { forwardToN8n, type IncomingMessagePayload } from '../webhook/n8nClient.ts';
import { logger } from '../utils/logger.ts';

export function startWorker(): Worker<IncomingMessagePayload> {
  const worker = new Worker<IncomingMessagePayload>(
    'n8n-forward',
    async (job) => {
      await forwardToN8n(job.data);
    },
    { connection: redisConnection },
  );

  worker.on('completed', (job) => {
    logger.info({ jobId: job.id }, 'Message forwarded to n8n');
  });

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, attempts: job?.attemptsMade, err }, 'Failed to forward message to n8n');
  });

  return worker;
}
