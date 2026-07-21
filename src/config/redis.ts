import Redis from 'ioredis';
import { env } from './env';

export const redis = new Redis({
  host: env.REDIS_HOST,
  port: env.REDIS_PORT,
  password: env.REDIS_PASSWORD || undefined,
  lazyConnect: true,
  maxRetriesPerRequest: null,
  enableOfflineQueue: false,
  retryStrategy(times) {
    if (times > 3) {
      return null; // Cancela tentativas continuas se o servidor Redis local não estiver rodando
    }
    return Math.min(times * 200, 1000);
  },
});

redis.on('connect', () => {
  console.log('✅ Conectado ao Redis com sucesso.');
});

redis.on('error', (err) => {
  // Log silencioso para evitar flood no terminal se o Redis local estiver offline
});
