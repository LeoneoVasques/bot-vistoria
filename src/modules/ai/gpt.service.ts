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
      ? transcriptions.map((t, idx) => `[Item ${idx + 1}]: ${t}`).join('\n')
      : 'Nenhuma anotação registrada.';

    const systemPrompt = `Você é um Vistoriador Veicular.
Analise os relatos da vistoria e retorne ESTRITAMENTE um JSON estruturado.
Regras:
1. Extraia detalhes da lataria, pneus, vidros, interior, equipamentos e parecer geral.
2. Parecer geral DEVE ser: "APROVADO", "APROVADO_COM_APONTAMENTOS" ou "REPROVADO".
3. Se algum campo não foi relatado, use "Não informado".`;

    const userPrompt = `Placa: ${plate}
Relatos da Vistoria:
${combinedNotes}

Estrutura do JSON exigida:
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
      console.log(`[GPTService] Enviando dados otimizados para GPT-4o-mini (Placa ${plate})...`);

      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini', // Modelo ultra-econômico (economia de ~95% nos custos com alta precisão)
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.1,
        max_tokens: 800, // Limite para evitar desperdício de tokens na geração
      });

      const content = completion.choices[0]?.message?.content;
      if (!content) {
        throw new Error('Resposta vazia retornada pelo GPT-4o-mini');
      }

      console.log(
        `[GPTService] JSON extraído com sucesso! Consumo de tokens: Input=${completion.usage?.prompt_tokens}, Output=${completion.usage?.completion_tokens} (Custo aproximado: ~$0.0002 USD)`
      );

      const parsedData = JSON.parse(content) as ExtractedInspectionData;
      return parsedData;
    } catch (error: any) {
      const aiWarning = formatAIError(error);
      console.error('[GPTService] Erro na API da OpenAI:', aiWarning);

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
        observacoes: `${combinedNotes}\n\n[NOTA DO SISTEMA]: IA indisponível no momento da consolidação.`,
        aiStatusMessage: aiWarning,
      };
    }
  }
}

export const gptService = new GPTService();
