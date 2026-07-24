import fs from 'fs';
import { openai } from '../../config/openai';
import { formatAIError } from './ai.error';
import { normalizeColorToFeminine } from '../../utils/formatters';

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
  public async extractInspectionData(
    plate: string,
    transcriptions: string[],
    images: string[] = []
  ): Promise<ExtractedInspectionData> {
    const combinedNotes = transcriptions.length > 0
      ? transcriptions.map((t, idx) => `[Item ${idx + 1}]: ${t}`).join('\n')
      : 'Nenhuma anotação de voz/texto registrada.';

    const systemPrompt = `Você é um Vistoriador Veicular Profissional e Auditor Técnico.
Analise os relatos de áudio/texto e as fotos capturadas do veículo.
Retorne ESTRITAMENTE um JSON estruturado.

Regras:
1. Extraia detalhes do veículo, lataria, pneus, vidros, interior, equipamentos e parecer geral.
2. Parecer geral DEVE ser impreterivelmente um destes valores: "APROVADO", "APROVADO_COM_APONTAMENTOS" ou "REPROVADO".
3. Se houver imagens anexadas, analise visualmente o estado de avarias, lataria ou pneus e complemente o laudo.
4. Se algum campo não foi relatado nem visível, use "Não informado".
5. A cor do veículo DEVE ser sempre no feminino (ex: "Preta" em vez de "Preto", "Branca" em vez de "Branco", "Vermelha", "Amarela", "Dourada", "Roxa", "Prateada", mantendo cores invariáveis como "Cinza", "Prata", "Azul", "Verde", "Marrom").`;

    const userPromptText = `Placa do Veículo: ${plate}
Relatos e Anotações da Vistoria:
${combinedNotes}

Total de fotos anexadas: ${images.length}

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

    const userContent: Array<any> = [
      { type: 'text', text: userPromptText }
    ];

    let imagesCount = 0;
    for (const imgPathOrUrl of images.slice(0, 4)) {
      try {
        if (imgPathOrUrl.startsWith('http://') || imgPathOrUrl.startsWith('https://')) {
          userContent.push({
            type: 'image_url',
            image_url: { url: imgPathOrUrl, detail: 'low' },
          });
          imagesCount++;
        } else if (fs.existsSync(imgPathOrUrl)) {
          const buffer = fs.readFileSync(imgPathOrUrl);
          const mime = imgPathOrUrl.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
          const base64 = buffer.toString('base64');
          userContent.push({
            type: 'image_url',
            image_url: { url: `data:${mime};base64,${base64}`, detail: 'low' },
          });
          imagesCount++;
        }
      } catch {
        // Ignora imagens com erro de leitura
      }
    }

    try {
      console.log(`[GPTService] Analisando dados e ${imagesCount} foto(s) com GPT-4o-mini Vision (Placa ${plate})...`);

      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.1,
        max_tokens: 1000,
      });

      const content = completion.choices[0]?.message?.content;
      if (!content) {
        throw new Error('Resposta vazia retornada pelo GPT-4o-mini');
      }

      console.log(
        `[GPTService] Análise multimodal e JSON extraídos com sucesso! Consumo: Input=${completion.usage?.prompt_tokens}, Output=${completion.usage?.completion_tokens}`
      );

      const parsedData = JSON.parse(content) as ExtractedInspectionData;
      parsedData.cor = normalizeColorToFeminine(parsedData.cor);
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
