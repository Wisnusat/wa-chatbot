import type { Server as HttpServer } from 'node:http';
import { Server as SocketIOServer } from 'socket.io';

let io: SocketIOServer | null = null;

export function initSocketIO(httpServer: HttpServer): SocketIOServer {
  io = new SocketIOServer(httpServer);
  return io;
}

export function getIO(): SocketIOServer {
  if (!io) {
    throw new Error('Socket.IO has not been initialized yet');
  }
  return io;
}
