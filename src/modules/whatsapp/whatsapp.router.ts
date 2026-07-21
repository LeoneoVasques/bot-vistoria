import { Message, MessageMedia } from 'whatsapp-web.js';
import { inspectionService } from '../inspection/inspection.service';
import { mediaStorageService } from '../media/media.storage';
import { whisperService } from '../ai/whisper.service';
import { gptService } from '../ai/gpt.service';
import { pdfService } from '../pdf/pdf.service';
import { prisma } from '../../config/prisma';

// Helper para download seguro de mídia com retentativas (evita erros temporários do Puppeteer)
async function safeDownloadMedia(msg: Message, retries = 3): Promise<MessageMedia | null> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const media = await msg.downloadMedia();
      if (media && media.data) return media;
    } catch (err) {
      if (attempt === retries) throw err;
      await new Promise((res) => setTimeout(res, 500));
    }
  }
  return null;
}

export async function handleIncomingMessage(msg: Message): Promise<void> {
  const userPhone = msg.from;
  const body = msg.body?.trim() || '';

  // Evita loops infinitos em auto-conversas de teste ("Você")
  if (msg.fromMe) {
    const botPrefixes = ['Pong!', '✅', '⚠️', '🎙️', '📸', '📝', '📄', '⏳', '📌', '1️⃣', '2️⃣', '3️⃣', '❌'];
    if (botPrefixes.some((prefix) => body.startsWith(prefix))) {
      return;
    }
  }

  // Comando 1: !teste (Fase 1)
  if (body.toLowerCase() === '!teste') {
    console.log(`[Router] Comando !teste recebido de: ${userPhone}`);
    await msg.reply('Pong! 🚗 VistoriaBot ativo e pronto para operacionalizar vistorias.');
    return;
  }

  // Comando 2: Vistoria [PLACA] (Fase 2 - Início da Vistoria)
  const startMatch = body.match(/^vistoria\s+([a-zA-Z0-9\-]+)/i);
  if (startMatch) {
    const rawPlate = startMatch[1];
    const activeSession = await inspectionService.getSession(userPhone);

    if (activeSession) {
      await msg.reply(
        `⚠️ Já existe uma vistoria em andamento para a placa *${activeSession.plate}*.\n` +
        `Envie áudios, textos e fotos ou envie *Finalizar ${activeSession.plate}* para concluir.`
      );
      return;
    }

    const session = await inspectionService.createSession(userPhone, rawPlate);
    await msg.reply(
      `✅ *Vistoria iniciada para a placa ${session.plate}!*\n\n` +
      `📌 *Instruções:*\n` +
      `1️⃣ Envie mensagens de texto ou 🎙️ áudios explicando os detalhes e estado do veículo.\n` +
      `2️⃣ Envie 📸 fotos do veículo (lataria, pneus, painel, etc.).\n` +
      `3️⃣ Quando concluir, envie a mensagem: *Finalizar ${session.plate}*.`
    );
    return;
  }

  // Busca sessão ativa para mensagens subsequentes
  const session = await inspectionService.getSession(userPhone);

  // Comando 3: Finalizar [PLACA] (Fase 4 & 5 - Consolidação, GPT-4o, PDF e DB)
  const finishMatch = body.match(/^finalizar(?:\s+([a-zA-Z0-9\-]+))?/i);
  if (finishMatch) {
    if (!session) {
      await msg.reply('⚠️ Nenhuma vistoria em andamento encontrada para este número.');
      return;
    }

    await msg.reply(
      `⏳ *Processando laudo de vistoria para a placa ${session.plate}...*\n\n` +
      `1️⃣ Consolidando transcrições e fotos...\n` +
      `2️⃣ Extraindo dados estruturados com IA GPT-4o...\n` +
      `3️⃣ Renderizando laudo PDF com anexo fotográfico...`
    );

    try {
      // 1. Extração GPT-4o
      const extractedData = await gptService.extractInspectionData(
        session.plate,
        session.transcriptions
      );

      // Se houver alerta de cota/indisponibilidade da OpenAI, avisa o usuário no chat
      if (extractedData.aiStatusMessage) {
        await msg.reply(extractedData.aiStatusMessage);
      }

      // 2. Geração do PDF com Puppeteer
      const pdfPath = await pdfService.generateInspectionPDF(
        extractedData,
        session.images
      );

      // 3. Persistência no PostgreSQL via Prisma
      try {
        const inspectionRecord = await prisma.inspection.create({
          data: {
            plate: session.plate,
            userPhone: session.userPhone,
            status: 'CONCLUIDO',
            transcriptions: session.transcriptions,
            reportData: extractedData as any,
            pdfPath: pdfPath,
            photos: {
              create: session.images.map((imgPath) => ({ filePath: imgPath })),
            },
          },
        });
        console.log(`[DB] Vistoria ${inspectionRecord.id} salva no PostgreSQL.`);
      } catch (dbErr) {
        console.warn('[DB Warning] Não foi possível salvar no PostgreSQL (verifique a conexão DB):', dbErr);
      }

      // 4. Envio do PDF no WhatsApp
      const media = MessageMedia.fromFilePath(pdfPath);
      await msg.reply(media, undefined, {
        caption: `📄 *Laudo de Vistoria Concluído!*\nPlaca: *${session.plate}*\nParecer: *${extractedData.parecer_geral}*`,
      });

      // 5. Encerramento da sessão no Redis
      await inspectionService.removeSession(userPhone);
      console.log(`[Session] Sessão encerrada para ${userPhone}`);
    } catch (err) {
      console.error('❌ Erro na finalização da vistoria:', err);
      await msg.reply('❌ Ocorreu um erro ao gerar o laudo da vistoria. Por favor, tente novamente.');
    }

    return;
  }

  // Processamento de Mídia e Texto dentro da Vistoria em Andamento
  if (session) {
    // 1. Áudio (Fase 3 - Whisper)
    if (msg.hasMedia && (msg.type === 'audio' || msg.type === 'ptt')) {
      await msg.reply('🎙️ *Áudio recebido.* Baixando e transcrevendo via Whisper...');
      try {
        const media = await safeDownloadMedia(msg);
        if (!media || !media.data) {
          throw new Error('Não foi possível realizar o download do áudio no WhatsApp.');
        }

        const savedAudioPath = await mediaStorageService.saveAudio(media);
        const transcription = await whisperService.transcribeAudio(savedAudioPath);

        await inspectionService.addTranscription(userPhone, transcription);
        await msg.reply(`✅ *Transcrito:* "${transcription}"`);
      } catch (err: any) {
        console.error('[WhatsApp Router] Erro ao processar áudio:', err);
        await msg.reply(err?.message || '⚠️ Falha ao processar o áudio. Tente enviar em texto.');
      }
      return;
    }

    // 2. Imagem (Fase 3 - Fotos da Vistoria)
    if (msg.hasMedia && msg.type === 'image') {
      try {
        const media = await safeDownloadMedia(msg);
        if (!media || !media.data) {
          throw new Error('Não foi possível realizar o download da imagem no WhatsApp.');
        }

        const savedImagePath = await mediaStorageService.saveImage(media);

        await inspectionService.addImage(userPhone, savedImagePath);
        await msg.reply(`📸 *Foto registrada com sucesso* para a vistoria da placa *${session.plate}*!`);
      } catch (err: any) {
        console.error('[WhatsApp Router] Erro ao salvar imagem:', err);
        await msg.reply('⚠️ Falha ao salvar a imagem. Tente enviá-la novamente.');
      }
      return;
    }

    // 3. Texto simples
    if (body.length > 0) {
      await inspectionService.addTranscription(userPhone, body);
      await msg.reply(`📝 *Anotação registrada:* "${body}"`);
      return;
    }
  }
}
