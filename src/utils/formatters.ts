/**
 * Mapeamento de cores no masculino para feminino no contexto de automóveis.
 * No Brasil / vistorias veiculares, a cor do veículo é sempre referenciada no feminino.
 * Exemplo: "Ford Ka preto" -> cor: "Preta".
 */
const COLOR_MASCULINE_TO_FEMININE: Record<string, string> = {
  preto: 'preta',
  branco: 'branca',
  vermelho: 'vermelha',
  amarelo: 'amarela',
  dourado: 'dourada',
  roxo: 'roxa',
  prateado: 'prateada',
  cinzento: 'cinzenta',
  alaranjado: 'alaranjada',
};

/**
 * Normaliza o texto de cor de um veículo para o gênero feminino,
 * preservando a capitalização original (Maiúsculo, Minúsculo, Title Case).
 *
 * @param colorText Texto da cor (ex: "Preto", "PRETO", "Preto e Branco", "Azul")
 * @returns Cor normalizada no feminino (ex: "Preta", "PRETA", "Preta e Branca", "Azul")
 */
export function normalizeColorToFeminine(colorText?: string | null): string {
  if (!colorText || typeof colorText !== 'string') {
    return 'Não informada';
  }

  const trimmed = colorText.trim();
  if (!trimmed) {
    return 'Não informada';
  }

  // Substitui cada palavra mapeada mantendo a caixa das letras original
  return trimmed.replace(/\b[a-zA-ZáàâãéèêíóòôõúçÁÀÂÃÉÈÊÍÓÒÔÕÚÇ]+\b/g, (word) => {
    const lowerWord = word.toLowerCase();
    const feminineWord = COLOR_MASCULINE_TO_FEMININE[lowerWord];

    if (!feminineWord) {
      return word;
    }

    // Se a palavra original for TODA MAIÚSCULA
    if (word === word.toUpperCase()) {
      return feminineWord.toUpperCase();
    }

    // Se a primeira letra for maiúscula (Title Case / Capitalized)
    if (word[0] === word[0].toUpperCase()) {
      return feminineWord.charAt(0).toUpperCase() + feminineWord.slice(1);
    }

    return feminineWord;
  });
}
