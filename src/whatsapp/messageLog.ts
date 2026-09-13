import { createRingBuffer } from '../utils/ringBuffer.ts';
import type { IncomingMessagePayload } from '../webhook/n8nClient.ts';

const buffer = createRingBuffer<IncomingMessagePayload>(200);

export function addMessageLog(entry: IncomingMessagePayload): void {
  buffer.push(entry);
}

export function getMessageLogs(): IncomingMessagePayload[] {
  return buffer.getAll();
}
