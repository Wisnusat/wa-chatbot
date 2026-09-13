import http from 'node:http';
import { env } from './config/env.ts';
import { logger } from './utils/logger.ts';
import { app } from './app.ts';
import { initSocketIO } from './sockets/io.ts';
import { initSocket } from './whatsapp/socket.ts';
import { startWorker } from './queue/worker.ts';

async function main() {
  const httpServer = http.createServer(app);
  initSocketIO(httpServer);

  startWorker();
  await initSocket();

  httpServer.listen(env.port, () => {
    logger.info(`WhatsApp engine listening on port ${env.port}`);
  });
}

main().catch((err) => {
  logger.error(err, 'Fatal error during startup');
  process.exit(1);
});
