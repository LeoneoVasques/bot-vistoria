export function formatAIError(error: any): string {
  const msg = error?.message || String(error);
  const code = error?.code || error?.error?.code;

  if (code === 'insufficient_quota' || msg.includes('exceeded your current quota') || msg.includes('quota')) {
    return '⚠️ *Alerta do Sistema (IA):* A conta da OpenAI está sem saldo ou créditos ativos (`insufficient_quota`). Adicione saldo na sua conta da OpenAI (platform.openai.com) para ativar as transcrições e análises do GPT-4o.';
  }

  if (error?.status === 401 || msg.includes('Incorrect API key')) {
    return '⚠️ *Alerta do Sistema (IA):* Chave da API da OpenAI inválida ou não configurada no arquivo `.env`.';
  }

  if (error?.status === 429 || msg.includes('Rate limit')) {
    return '⚠️ *Alerta do Sistema (IA):* Limite de requisições por minuto da OpenAI excedido. Tente novamente em alguns segundos.';
  }

  return `⚠️ *Alerta do Sistema (IA):* Serviços de IA temporariamente indisponíveis (${msg}).`;
}
