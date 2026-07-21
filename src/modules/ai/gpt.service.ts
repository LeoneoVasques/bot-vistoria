import { openai } from '../../config/openai';
import { formatAIError } from './ai.error';

export interface ExtractedInspectionData {
  placa: string;
  modelo: string;
  ano: string;
  cor: string;
  quilometragem: string;
  combustivel: string;
  funilaria_pintura: string;
  pneus_rodas: string;
  vidros_farois: string;
  interior_estofamento: string;
  equipamentos_seguranca: string;
  parecer_geral: 'APROVADO' | 'APROVADO_COM_APONTAMENTOS' | 'REPROVADO';
  observacoes: string;
  aiStatusMessage?: string;
}

export class GPTService {
  public async extractInspectionData(plate: string, transcriptions: string[]): Promise<ExtractedInspectionData> {
    const combinedNotes = transcriptions.length > 0
      ? transcriptions.map((t, idx) => `[Registro ${idx + 1}]: ${t}`).join('\n')
      : 'Nenhuma observação em áudio/texto foi registrada.';

    const systemPrompt = `Você é um Vistoriador Veicular Especialista e Arquiteto de Dados.
Sua função é analisar todas as transcrições e anotações coletadas durante uma vistoria veicular no WhatsApp e preencher um formulário estruturado de laudo de vistoria em formato JSON.

Regras de Mapeamento:
1. Extraia o máximo de detalhes possível sobre o estado do veículo a partir das transcrições informadas.
2. Se alguma informação específica (ex: quilometragem, ano, cor) não for mencionada no texto, utilize "Não informado" ou infira adequadamente com base nos relatórios.
3. Para o 'parecer_geral', defina obrigatoriamente um dos valores: "APROVADO", "APROVADO_COM_APONTAMENTOS" ou "REPROVADO".
4. Retorne ESTRITAMENTE um objeto JSON válido seguindo a estrutura solicitada.`;

    const userPrompt = `Placa do Veículo: ${plate}

Transcrições e Anotações da Vistoria:
${combinedNotes}

Por favor, gere o JSON com a estrutura:
{
  "placa": "${plate}",
  "modelo": "...",
  "ano": "...",
  "cor": "...",
  "quilometragem": "...",
  "combustivel": "...",
  "funilaria_pintura": "...",
  "pneus_rodas": "...",
  "vidros_farois": "...",
  "interior_estofamento": "...",
  "equipamentos_seguranca": "...",
  "parecer_geral": "APROVADO | APROVADO_COM_APONTAMENTOS | REPROVADO",
  "observacoes": "..."
}`;

    try {
      console.log(`[GPTService] Enviando dados para GPT-4o extrair laudo da placa ${plate}...`);

      const completion = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.2,
      });

      const content = completion.choices[0]?.message?.content;
      if (!content) {
        throw new Error('Resposta vazia retornada pelo GPT-4o');
      }

      console.log('[GPTService] JSON extraído com sucesso pelo GPT-4o.');
      const parsedData = JSON.parse(content) as ExtractedInspectionData;
      return parsedData;
    } catch (error: any) {
      const aiWarning = formatAIError(error);
      console.error('[GPTService] Erro na API da OpenAI (GPT-4o):', aiWarning);

      // Fallback em caso de falha da API da OpenAI (Sem saldo, offline ou chave inválida)
      return {
        placa: plate,
        modelo: 'Preenchimento Manual / Fallback',
        ano: 'Não informado',
        cor: 'Não informada',
        quilometragem: 'Não informada',
        combustivel: 'Não informado',
        funilaria_pintura: combinedNotes,
        pneus_rodas: 'Não informado',
        vidros_farois: 'Não informado',
        interior_estofamento: 'Não informado',
        equipamentos_seguranca: 'Não informado',
        parecer_geral: 'APROVADO_COM_APONTAMENTOS',
        observacoes: `${combinedNotes}\n\n[NOTA DO SISTEMA]: Os serviços de IA da OpenAI estavam indisponíveis no momento do fechamento.`,
        aiStatusMessage: aiWarning,
      };
    }
  }
}

export const gptService = new GPTService();
