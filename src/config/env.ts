import 'dotenv/config';

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const env = {
  port: Number(process.env.PORT ?? 3000),
  logLevel: process.env.LOG_LEVEL ?? 'info',
  n8nWebhookUrl: required('N8N_WEBHOOK_URL'),
  redisUrl: required('REDIS_URL'),
  sendRateLimitMax: Number(process.env.SEND_RATE_LIMIT_MAX ?? 20),
  sendRateLimitWindowMs: Number(process.env.SEND_RATE_LIMIT_WINDOW_MS ?? 60_000),
};
