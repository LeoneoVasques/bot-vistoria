import { redis } from '../../config/redis';

export class RateLimiterService {
  private inMemoryCounts = new Map<string, { count: number; resetAt: number }>();
  private readonly WINDOW_SECONDS = 60; // Janela de 1 minuto
  private readonly MAX_MESSAGES_PER_WINDOW = 12; // Máximo de 12 mensagens/mídias por minuto por usuário

  /**
   * Verifica se o usuário excedeu a taxa máxima de requisições por minuto.
   * Previne ataques de spam para consumo indevido da OpenAI e Cloudflare R2.
   */
  public async checkRateLimit(userPhone: string): Promise<{ allowed: boolean; remaining: number }> {
    const key = `ratelimit:${userPhone}`;
    const now = Date.now();

    try {
      if (redis.status === 'ready') {
        const current = await redis.incr(key);
        if (current === 1) {
          await redis.expire(key, this.WINDOW_SECONDS);
        }
        if (current > this.MAX_MESSAGES_PER_WINDOW) {
          console.warn(`⚠️ [RateLimiter] Bloqueio anti-spam ativado para o número ${userPhone} (${current}/${this.MAX_MESSAGES_PER_WINDOW} msgs/min)`);
          return { allowed: false, remaining: 0 };
        }
        return { allowed: true, remaining: this.MAX_MESSAGES_PER_WINDOW - current };
      }
    } catch {
      // Fallback em memória se o Redis estiver desativado
    }

    const record = this.inMemoryCounts.get(userPhone);
    if (!record || now > record.resetAt) {
      this.inMemoryCounts.set(userPhone, { count: 1, resetAt: now + this.WINDOW_SECONDS * 1000 });
      return { allowed: true, remaining: this.MAX_MESSAGES_PER_WINDOW - 1 };
    }

    record.count++;
    if (record.count > this.MAX_MESSAGES_PER_WINDOW) {
      console.warn(`⚠️ [RateLimiter] Bloqueio anti-spam ativado em memória para ${userPhone}`);
      return { allowed: false, remaining: 0 };
    }

    return { allowed: true, remaining: this.MAX_MESSAGES_PER_WINDOW - record.count };
  }
}

export const rateLimiterService = new RateLimiterService();
