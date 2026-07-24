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
  missingFields?: string[];
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

    const systemPrompt = `Você é um Auditor Técnico e Vistoriador Veicular Sênior de altíssima precisão.
Sua análise DEVE ser EXTREMAMENTE MINUCIOSA, rigorosa e detalhada. NENHUMA informação relatada nos áudios/textos ou visível nas fotos pode ser omitida ou ignorada.

Regras Meticulosas de Auditoria:
1. Extraia com máxima exatidão: Marca/Modelo com versão completa, Ano (Fab/Mod), Cor (sempre no feminino), Quilometragem exata (Km), Combustível.
2. Analise minunciosamente cada componente:
   - Funilaria / Pintura: Registre arranhões, amassados, mossas, riscos, desalinhamentos de lataria ou estado impecável.
   - Pneus / Rodas: Detalhe o desgaste dos pneus (novos, bom estado, meia-vida, careca) e avarias em rodas/calotas.
   - Vidros / Faróis: Verifique trincas em para-brisa, faróis opacos, lanternas quebradas ou em perfeito estado.
   - Interior / Estofamento: Registre manchas, rasgos, desgaste em bancos, painel ou higienização.
   - Equipamentos de Segurança: Verifique presença de estepe, macaco, chave de roda, triângulo.
3. Parecer Geral DEVE ser impreterivelmente um destes valores: "APROVADO", "APROVADO_COM_APONTAMENTOS" ou "REPROVADO".
4. Se algum campo realmente não foi relatado no áudio/texto nem está visível em foto nenhuma, use rigorosamente "Não informado".
5. A cor do veículo DEVE ser sempre no feminino (ex: "Preta" em vez de "Preto", "Branca" em vez de "Branco", "Vermelha", "Amarela", "Dourada", "Roxa", "Prateada", mantendo cores invariáveis como "Cinza", "Prata", "Azul", "Verde", "Marrom").

}`;

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
            image_url: { url: imgPathOrUrl, detail: 'high' },
          });
          imagesCount++;
        } else if (fs.existsSync(imgPathOrUrl)) {
          const buffer = fs.readFileSync(imgPathOrUrl);
          const mime = imgPathOrUrl.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
          const base64 = buffer.toString('base64');
          userContent.push({
            type: 'image_url',
            image_url: { url: `data:${mime};base64,${base64}`, detail: 'high' },
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

      const fieldLabels: Record<string, string> = {
        modelo: 'Marca / Modelo',
        ano: 'Ano de Fabricação / Modelo',
        cor: 'Cor do Veículo',
        quilometragem: 'Quilometragem (Km)',
        combustivel: 'Combustível',
        funilaria_pintura: 'Funilaria / Pintura',
        pneus_rodas: 'Pneus / Rodas',
        vidros_farois: 'Vidros / Faróis',
        interior_estofamento: 'Interior / Estofamento',
        equipamentos_seguranca: 'Equipamentos de Segurança',
      };

      const missing: string[] = [];
      for (const [key, label] of Object.entries(fieldLabels)) {
        const val = (parsedData as any)[key];
        if (
          !val ||
          typeof val !== 'string' ||
          val.toLowerCase().includes('não informado') ||
          val.toLowerCase().includes('não informada')
        ) {
          missing.push(label);
        }
      }
      parsedData.missingFields = missing;

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
