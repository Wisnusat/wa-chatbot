import { createRingBuffer } from '../utils/ringBuffer.ts';
import type { IncomingMessagePayload } from '../webhook/n8nClient.ts';

export interface ForwardLogEntry {
  jobId: string;
  status: 'success' | 'failed';
  attempt: number;
  timestamp: string;
  error: string | null;
  payload: IncomingMessagePayload;
}

const buffer = createRingBuffer<ForwardLogEntry>(200);

export function addForwardLog(entry: ForwardLogEntry): void {
  buffer.push(entry);
}

export function getForwardLogs(): ForwardLogEntry[] {
  return buffer.getAll();
}
