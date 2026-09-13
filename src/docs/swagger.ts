import path from 'node:path';
import swaggerJsdoc from 'swagger-jsdoc';

function toGlobPath(...segments: string[]): string {
  return path.join(...segments).split(path.sep).join('/');
}

export const swaggerSpec = swaggerJsdoc({
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'WhatsApp Engine API',
      version: '1.0.0',
      description:
        'REST API untuk mengontrol WhatsApp engine (Baileys): kirim pesan, kelola sesi, dan cek kesehatan koneksi.',
    },
  },
  apis: [
    toGlobPath(import.meta.dirname, '../routes/*.ts'),
    toGlobPath(import.meta.dirname, '../routes/*.js'),
  ],
});
