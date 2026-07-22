import { openai } from '../../config/openai';
import { formatAIError } from './ai.error';

export interface AIHealthResult {
  ok: boolean;
  reason?: string;
}

let cachedResult: AIHealthResult | null = null;
let lastCheckTime = 0;

export async function checkOpenAIHealth(force = false): Promise<AIHealthResult> {
  const now = Date.now();
  // Economia: Cache estendido de 2 minutos (120.000ms) para evitar requisições repetidas
  if (!force && cachedResult && now - lastCheckTime < 120000) {
    return cachedResult;
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000);

    // Economia: Valida a conexão e chave na API da OpenAI sem consumir tokens de chat ($0.00)
    await openai.models.retrieve('gpt-4o-mini', { signal: controller.signal });

    clearTimeout(timeoutId);
    cachedResult = { ok: true };
    lastCheckTime = now;
    return cachedResult;
  } catch (error: any) {
    console.warn('[AI HealthCheck] Falha detectada na API da OpenAI:', error?.message || error);
    const reason = formatAIError(error);
    cachedResult = { ok: false, reason };
    lastCheckTime = now;
    return cachedResult;
  }
}
