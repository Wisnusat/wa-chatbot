import { Worker } from 'bullmq';
import { redisConnection } from './redisConnection.ts';
import { forwardToN8n, type IncomingMessagePayload } from '../webhook/n8nClient.ts';
import { logger } from '../utils/logger.ts';
import { getIO } from '../sockets/io.ts';
import { addForwardLog, type ForwardLogEntry } from './forwardLog.ts';

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

    const entry: ForwardLogEntry = {
      jobId: String(job.id),
      status: 'success',
      attempt: job.attemptsMade,
      timestamp: new Date().toISOString(),
      error: null,
      payload: job.data,
    };
    addForwardLog(entry);
    getIO().emit('forward:result', entry);
  });

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, attempts: job?.attemptsMade, err }, 'Failed to forward message to n8n');

    if (!job) return;

    const entry: ForwardLogEntry = {
      jobId: String(job.id),
      status: 'failed',
      attempt: job.attemptsMade,
      timestamp: new Date().toISOString(),
      error: err.message,
      payload: job.data,
    };
    addForwardLog(entry);
    getIO().emit('forward:result', entry);
  });

  return worker;
}
