import { Redis } from 'ioredis';
import { env } from '../config/env.ts';

export const redisConnection = new Redis(env.redisUrl, {
  maxRetriesPerRequest: null,
});
