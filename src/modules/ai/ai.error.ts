export function formatAIError(error: any): string {
  const msg = error?.message || String(error);
  const code = error?.code || error?.error?.code;

  if (code === 'insufficient_quota' || msg.includes('exceeded your current quota') || msg.includes('quota')) {
    return '⚠️ *Alerta do Sistema:* Os serviços de Inteligência Artificial estão temporariamente indisponíveis por cota. Por favor, tente novamente mais tarde.';
  }

  if (error?.status === 401 || msg.includes('Incorrect API key')) {
    return '⚠️ *Alerta do Sistema:* Chave de acesso da Inteligência Artificial não configurada ou inválida no servidor.';
  }

  if (error?.status === 429 || msg.includes('Rate limit')) {
    return '⚠️ *Alerta do Sistema:* Limite de requisições de Inteligência Artificial atingido. Aguarde alguns segundos e tente novamente.';
  }

  return '⚠️ *Alerta do Sistema:* Serviços de Inteligência Artificial temporariamente indisponíveis. Tente novamente em instantes.';
}
