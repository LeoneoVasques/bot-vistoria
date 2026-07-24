import fs from 'fs';
import { proto, downloadMediaMessage, WAMessage } from '@whiskeysockets/baileys';
import pino from 'pino';
import { inspectionService } from '../inspection/inspection.service';
import { mediaStorageService } from '../media/media.storage';
import { whisperService } from '../ai/whisper.service';
import { gptService } from '../ai/gpt.service';
import { pdfService } from '../pdf/pdf.service';
import { prisma } from '../../config/prisma';
import { checkOpenAIHealth } from '../ai/ai.health';
import { getAudioDuration, compressImage } from '../media/media.optimizer';
import { subscriberService } from '../subscriber/subscriber.service';
import { addAudioJob, addPdfJob } from '../queue/inspection.queue';

const MAX_AUDIO_DURATION_SECONDS = 180; // 3 minutos
const MAX_AUDIO_COUNT = 30; // 30 áudios/anotações
const MAX_IMAGE_COUNT = 30; // 30 fotos

function formatErrorMessage(err: any, fallbackMessage: string): string {
  const msg = (err?.message || String(err || '')).trim();
  if (!msg || msg === 'r' || msg.length <= 3) {
    return fallbackMessage;
  }
  return msg;
}

export async function handleIncomingMessage(msg: proto.IWebMessageInfo, sock: any): Promise<void> {
  const userPhone = msg.key?.remoteJid;
  if (!userPhone || userPhone.includes('@g.us')) return; // Ignore groups

  // Extrair texto
  const body = msg.message?.conversation || msg.message?.extendedTextMessage?.text || msg.message?.imageMessage?.caption || msg.message?.videoMessage?.caption || '';

  const botPrefixes = ['Pong!', '✅', '⚠️', '🎙️', '📸', '📝', '📄', '⏳', '📌', '1️⃣', '2️⃣', '3️⃣', '❌', '⛔'];
  
  if (msg.key?.fromMe) {
    if (botPrefixes.some((prefix) => body.startsWith(prefix))) {
      return;
    }
  }

  const reply = async (text: string, options?: any) => {
    if (options && options.document) {
      await sock.sendMessage(userPhone, { document: options.document, mimetype: 'application/pdf', fileName: options.fileName, caption: text }, { quoted: msg });
    } else {
      await sock.sendMessage(userPhone, { text }, { quoted: msg });
    }
  };

  // Comando 1: !teste
  if (body.toLowerCase() === '!teste') {
    console.log(`[Router] Comando !teste recebido de: ${userPhone}`);
    const aiHealth = await checkOpenAIHealth(true);

    if (aiHealth.ok) {
      await reply('Pong! 🚗 VistoriaBot ativo e serviços de IA da OpenAI totalmente operacionais (GPT-4o & Whisper).');
    } else {
      await reply(`Pong! 🚗 VistoriaBot ativo, mas os serviços de IA estão com limitações.\n\n${aiHealth.reason}`);
    }
    return;
  }

  // Comando 2: Vistoria [PLACA] [MODELO_OPCIONAL]
  const startMatch = body.match(/^vistoria\s+([a-zA-Z0-9\-]+)(?:\s+([a-zA-Z0-9_\-]+))?/i);
  if (startMatch) {
    const rawPlate = startMatch[1];
    const officeTemplate = startMatch[2];

    // Checagem de Assinatura do Localizador
    const accessCheck = await subscriberService.checkAccess(userPhone);
    if (!accessCheck.allowed) {
      if (accessCheck.reason === 'NÚMERO_NÃO_CADASTRADO') {
        await reply(`⚠️ *Acesso Restrito*\n\nSeu número (*${subscriberService.cleanPhone(userPhone)}*) não possui uma assinatura ativa do VistoriaBot.\n\n👉 Para contratar seu plano e liberar a geração de laudos automáticos no WhatsApp, entre em contato para ativar seu acesso.`);
      } else if (accessCheck.reason === 'ASSINATURA_EXPIRADA') {
        await reply(`⚠️ *Assinatura Expirada*\n\nA sua assinatura do VistoriaBot venceu.\nEntre em contato para renovar seu acesso.`);
      } else if (accessCheck.reason === 'LIMITE_MENSAL_ATINGIDO') {
        await reply(`⚠️ *Limite Mensal Atingido*\n\nVocê atingiu a cota máxima de vistorias do seu plano neste mês.\nEntre em contato para fazer o upgrade de plano.`);
      } else {
        await reply(`⚠️ *Acesso Indisponível*\n\nSua assinatura está inativa no momento.`);
      }
      return;
    }

    const aiHealth = await checkOpenAIHealth(true);
    if (!aiHealth.ok) {
      await reply(`⛔ *Vistoria Não Iniciada - Conexão com IA Indisponível*\n\nO VistoriaBot requer obrigatoriamente a API da OpenAI ativa e com saldo de cota para operar a leitura, transcrição de voz e geração do laudo.\n\n${aiHealth.reason}\n\n*A vistoria só poderá ser iniciada após o restabelecimento do acesso à IA da OpenAI.*`);
      return;
    }

    const activeSession = await inspectionService.getSession(userPhone);
    if (activeSession) {
      await reply(`⚠️ Já existe uma vistoria em andamento para a placa *${activeSession.plate}*.\nEnvie áudios, textos e fotos ou envie *Finalizar ${activeSession.plate}* para concluir.`);
      return;
    }

    const session = await inspectionService.createSession(userPhone, rawPlate, officeTemplate);
    const templateMsg = session.officeTemplate ? ` (Modelo: *${session.officeTemplate}*)` : '';
    await reply(`✅ *Vistoria iniciada para a placa ${session.plate}*${templateMsg}!\n\n📌 *Instruções:*\n1️⃣ Envie mensagens de texto ou 🎙️ áudios explicando os detalhes e estado do veículo.\n2️⃣ Envie 📸 fotos do veículo (lataria, pneus, painel, etc.).\n3️⃣ Quando concluir, envie a mensagem: *Finalizar ${session.plate}*.`);
    return;
  }

  const session = await inspectionService.getSession(userPhone);

  // Comando 3: Finalizar [PLACA] (Gera Rascunho)
  const finishMatch = body.match(/^finalizar(?:\s+([a-zA-Z0-9\-]+))?/i);
  if (finishMatch) {
    if (!session) {
      await reply('⚠️ Nenhuma vistoria em andamento encontrada para este número.');
      return;
    }

    const aiHealth = await checkOpenAIHealth(true);
    if (!aiHealth.ok) {
      await reply(`⛔ *Não é possível gerar o laudo - IA Indisponível*\n\nA consolidação dos dados e laudo exige acesso ativo à OpenAI.\n\n${aiHealth.reason}\n\nSua sessão para a placa *${session.plate}* continua mantida. Assim que a cota da OpenAI for restabelecida, envie *Finalizar ${session.plate}* novamente.`);
      return;
    }

    const enqueued = await addPdfJob({
      userPhone,
      plate: session.plate,
      transcriptions: session.transcriptions,
      images: session.images,
      officeTemplate: session.officeTemplate,
    });

    if (enqueued) {
      await reply(`⏳ *Gerando rascunho do laudo para a placa ${session.plate} em segundo plano...*\n\n1️⃣ Consolidando transcrições e fotos...\n2️⃣ Extraindo dados estruturados com IA GPT-4o-mini...\n3️⃣ Renderizando laudo PDF com anexo fotográfico...\n\nVocê receberá o laudo completo em instantes!`);
      return;
    }

    await reply(`⏳ *Gerando rascunho do laudo para a placa ${session.plate}...*\n\n1️⃣ Consolidando transcrições e fotos...\n2️⃣ Extraindo dados estruturados com IA GPT-4o-mini...\n3️⃣ Renderizando laudo PDF com anexo fotográfico...`);

    try {
      const extractedData = await gptService.extractInspectionData(session.plate, session.transcriptions);
      const pdfPath = await pdfService.generateInspectionPDF(extractedData, session.images, session.officeTemplate);

      await inspectionService.updateDraftData(userPhone, extractedData, pdfPath);

      const fs = require('fs');
      await reply(
        `📄 *Rascunho do Laudo de Vistoria Gerado!*\nPlaca: *${session.plate}*\nParecer: *${extractedData.parecer_geral}*\n\n📌 *Instruções de Revisão:*\n- Se o laudo estiver correto, envie a palavra *Aprovar* para concluir e salvar definitivamente.\n- Se houver algum erro ou dado faltando, envie novas mensagens/áudios com as correções e digite *Finalizar* novamente.`,
        { 
          document: fs.readFileSync(pdfPath),
          fileName: `Rascunho_Laudo_${session.plate}.pdf`
        }
      );
    } catch (err) {
      console.error('❌ Erro na geração do rascunho da vistoria:', err);
      await reply('❌ Ocorreu um erro ao gerar o rascunho do laudo. Por favor, tente novamente.');
    }
    return;
  }

  // Comando 4: Aprovar (Confirma o rascunho e encerra a vistoria)
  const approveMatch = body.match(/^aprovar/i);
  if (approveMatch) {
    if (!session || session.status !== 'AGUARDANDO_APROVACAO' || !session.lastExtractedData || !session.lastPdfPath) {
      await reply('⚠️ Nenhuma vistoria aguardando aprovação encontrada.\nEnvie *Finalizar* para gerar o rascunho do laudo antes de aprovar.');
      return;
    }

    try {
      try {
        const inspectionRecord = await prisma.inspection.create({
          data: {
            plate: session.plate,
            userPhone: session.userPhone,
            status: 'CONCLUIDO',
            transcriptions: session.transcriptions,
            reportData: session.lastExtractedData as any,
            pdfPath: session.lastPdfPath,
            photos: {
              create: session.images.map((imgPath) => ({ filePath: imgPath })),
            },
          },
        });
        console.log(`[DB] Vistoria ${inspectionRecord.id} salva no PostgreSQL após aprovação.`);
      } catch (dbErr) {
        console.warn('[DB Warning] Não foi possível salvar no PostgreSQL (verifique a conexão DB):', dbErr);
      }

      await reply(`✅ *Laudo da vistoria (${session.plate}) APROVADO e finalizado com sucesso!*`);
      await subscriberService.incrementUsage(userPhone);
      await inspectionService.removeSession(userPhone);
      console.log(`[Session] Sessão encerrada após aprovação para ${userPhone}`);
    } catch (err) {
      console.error('❌ Erro ao aprovar vistoria:', err);
      await reply('❌ Ocorreu um erro ao aprovar e salvar a vistoria. Tente novamente.');
    }
    return;
  }

  // Processamento de Mídia
  if (session) {
    const messageType = Object.keys(msg.message || {})[0];

    // 1. Áudio
    if (messageType === 'audioMessage') {
      if (session.transcriptions.length >= MAX_AUDIO_COUNT) {
        await reply(`⚠️ *Limite Atingido!* Esta vistoria já atingiu o limite de ${MAX_AUDIO_COUNT} áudios/anotações.`);
        return;
      }

      const aiHealth = await checkOpenAIHealth();
      if (!aiHealth.ok) {
        await reply(`⛔ *Transcrição de Áudio Bloqueada*\n\nNão foi possível enviar o áudio ao Whisper pois os serviços de IA da OpenAI estão inacessíveis.\n\n${aiHealth.reason}`);
        return;
      }

      await reply('🎙️ *Áudio recebido.* Baixando, otimizando e transcrevendo via Whisper...');
      let savedAudioPath: string | null = null;
      try {
        const buffer = await downloadMediaMessage(msg as WAMessage, 'buffer', { }, { logger: pino({ level: 'silent' }) as any, reuploadRequest: sock.updateMediaMessage });
        savedAudioPath = await mediaStorageService.saveAudio(buffer as Buffer, msg.message?.audioMessage?.mimetype || 'audio/ogg');

        // Checagem de limite de duração do áudio
        const duration = await getAudioDuration(savedAudioPath);
        if (duration > MAX_AUDIO_DURATION_SECONDS) {
          await reply(`⚠️ *Áudio Muito Longo!* O áudio enviado possui aproximadamente ${Math.round(duration)}s.\nO limite máximo permitido por áudio é de 3 minutos (180s). Por favor, envie áudios mais curtos e objetivos.`);
          return;
        }

        const enqueued = await addAudioJob({ userPhone, savedAudioPath });
        if (enqueued) {
          // O worker excluirá o arquivo e responderá ao usuário quando concluir
          return;
        }

        const transcription = await whisperService.transcribeAudio(savedAudioPath);
        
        await inspectionService.addTranscription(userPhone, transcription);
        await reply(`✅ *Transcrito:* "${transcription}"`);
      } catch (err: any) {
        console.error('[WhatsApp Router] Erro ao processar áudio:', err);
        await reply(formatErrorMessage(err, '⚠️ Falha no processamento do áudio. Tente regravar o áudio ou enviar a anotação em texto.'));
      } finally {
        if (savedAudioPath && fs.existsSync(savedAudioPath)) {
          await fs.promises.unlink(savedAudioPath).catch(() => {});
          console.log(`[MediaStorage] Áudio temporário apagado do disco: ${savedAudioPath}`);
        }
      }
      return;
    }

    // 2. Imagem
    if (messageType === 'imageMessage') {
      if (session.images.length >= MAX_IMAGE_COUNT) {
        await reply(`⚠️ *Limite Atingido!* Esta vistoria já atingiu o limite máximo de ${MAX_IMAGE_COUNT} fotos.`);
        return;
      }

      try {
        const buffer = await downloadMediaMessage(msg as WAMessage, 'buffer', { }, { logger: pino({ level: 'silent' }) as any, reuploadRequest: sock.updateMediaMessage });
        const savedImagePath = await mediaStorageService.saveImage(buffer as Buffer, msg.message?.imageMessage?.mimetype || 'image/jpeg');

        // Compressão e otimização automática de imagem
        const compressedImagePath = await compressImage(savedImagePath);

        await inspectionService.addImage(userPhone, compressedImagePath);
        await reply(`📸 *Foto registrada e otimizada* (${session.images.length + 1}/${MAX_IMAGE_COUNT}) para a placa *${session.plate}*!`);
      } catch (err: any) {
        console.error('[WhatsApp Router] Erro ao salvar imagem:', err);
        await reply(formatErrorMessage(err, '⚠️ O WhatsApp não permitiu o download da imagem. Tente enviá-la novamente.'));
      }
      return;
    }

    // 3. Texto
    if (body.length > 0) {
      if (session.transcriptions.length >= MAX_AUDIO_COUNT) {
        await reply(`⚠️ *Limite Atingido!* Esta vistoria já atingiu o limite de ${MAX_AUDIO_COUNT} anotações.`);
        return;
      }

      await inspectionService.addTranscription(userPhone, body);
      await reply(`📝 *Anotação registrada:* "${body}"`);
      return;
    }
  }
}
