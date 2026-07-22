import { proto, downloadMediaMessage, WAMessage } from '@whiskeysockets/baileys';
import pino from 'pino';
import { inspectionService } from '../inspection/inspection.service';
import { mediaStorageService } from '../media/media.storage';
import { whisperService } from '../ai/whisper.service';
import { gptService } from '../ai/gpt.service';
import { pdfService } from '../pdf/pdf.service';
import { prisma } from '../../config/prisma';
import { checkOpenAIHealth } from '../ai/ai.health';

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

  // Comando 2: Vistoria [PLACA]
  const startMatch = body.match(/^vistoria\s+([a-zA-Z0-9\-]+)/i);
  if (startMatch) {
    const rawPlate = startMatch[1];
    
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

    const session = await inspectionService.createSession(userPhone, rawPlate);
    await reply(`✅ *Vistoria iniciada para a placa ${session.plate}!*\n\n📌 *Instruções:*\n1️⃣ Envie mensagens de texto ou 🎙️ áudios explicando os detalhes e estado do veículo.\n2️⃣ Envie 📸 fotos do veículo (lataria, pneus, painel, etc.).\n3️⃣ Quando concluir, envie a mensagem: *Finalizar ${session.plate}*.`);
    return;
  }

  const session = await inspectionService.getSession(userPhone);

  // Comando 3: Finalizar [PLACA]
  const finishMatch = body.match(/^finalizar(?:\s+([a-zA-Z0-9\-]+))?/i);
  if (finishMatch) {
    if (!session) {
      await reply('⚠️ Nenhuma vistoria em andamento encontrada para este número.');
      return;
    }

    const aiHealth = await checkOpenAIHealth(true);
    if (!aiHealth.ok) {
      await reply(`⛔ *Não é possível finalizar a vistoria - IA Indisponível*\n\nA consolidação dos dados e laudo exige acesso ativo à OpenAI.\n\n${aiHealth.reason}\n\nSua sessão para a placa *${session.plate}* continua mantida. Assim que a cota da OpenAI for restabelecida, envie *Finalizar ${session.plate}* novamente.`);
      return;
    }

    await reply(`⏳ *Processando laudo de vistoria para a placa ${session.plate}...*\n\n1️⃣ Consolidando transcrições e fotos...\n2️⃣ Extraindo dados estruturados com IA GPT-4o-mini...\n3️⃣ Renderizando laudo PDF com anexo fotográfico...`);

    try {
      const extractedData = await gptService.extractInspectionData(session.plate, session.transcriptions);
      const pdfPath = await pdfService.generateInspectionPDF(extractedData, session.images);

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

      const fs = require('fs');
      await reply(`📄 *Laudo de Vistoria Concluído!*\nPlaca: *${session.plate}*\nParecer: *${extractedData.parecer_geral}*`, { 
        document: fs.readFileSync(pdfPath),
        fileName: `Laudo_${session.plate}.pdf`
      });

      await inspectionService.removeSession(userPhone);
      console.log(`[Session] Sessão encerrada para ${userPhone}`);
    } catch (err) {
      console.error('❌ Erro na finalização da vistoria:', err);
      await reply('❌ Ocorreu um erro ao gerar o laudo da vistoria. Por favor, tente novamente.');
    }
    return;
  }

  // Processamento de Mídia
  if (session) {
    const messageType = Object.keys(msg.message || {})[0];

    // 1. Áudio
    if (messageType === 'audioMessage') {
      const aiHealth = await checkOpenAIHealth();
      if (!aiHealth.ok) {
        await reply(`⛔ *Transcrição de Áudio Bloqueada*\n\nNão foi possível enviar o áudio ao Whisper pois os serviços de IA da OpenAI estão inacessíveis.\n\n${aiHealth.reason}`);
        return;
      }

      await reply('🎙️ *Áudio recebido.* Baixando e transcrevendo via Whisper...');
      try {
        const buffer = await downloadMediaMessage(msg as WAMessage, 'buffer', { }, { logger: pino({ level: 'silent' }) as any, reuploadRequest: sock.updateMediaMessage });
        const savedAudioPath = await mediaStorageService.saveAudio(buffer as Buffer, msg.message?.audioMessage?.mimetype || 'audio/ogg');
        const transcription = await whisperService.transcribeAudio(savedAudioPath);
        
        await inspectionService.addTranscription(userPhone, transcription);
        await reply(`✅ *Transcrito:* "${transcription}"`);
      } catch (err: any) {
        console.error('[WhatsApp Router] Erro ao processar áudio:', err);
        await reply(formatErrorMessage(err, '⚠️ Falha no processamento do áudio. Tente regravar o áudio ou enviar a anotação em texto.'));
      }
      return;
    }

    // 2. Imagem
    if (messageType === 'imageMessage') {
      try {
        const buffer = await downloadMediaMessage(msg as WAMessage, 'buffer', { }, { logger: pino({ level: 'silent' }) as any, reuploadRequest: sock.updateMediaMessage });
        const savedImagePath = await mediaStorageService.saveImage(buffer as Buffer, msg.message?.imageMessage?.mimetype || 'image/jpeg');

        await inspectionService.addImage(userPhone, savedImagePath);
        await reply(`📸 *Foto registrada com sucesso* para a vistoria da placa *${session.plate}*!`);
      } catch (err: any) {
        console.error('[WhatsApp Router] Erro ao salvar imagem:', err);
        await reply(formatErrorMessage(err, '⚠️ O WhatsApp não permitiu o download da imagem. Tente enviá-la novamente.'));
      }
      return;
    }

    // 3. Texto
    if (body.length > 0) {
      await inspectionService.addTranscription(userPhone, body);
      await reply(`📝 *Anotação registrada:* "${body}"`);
      return;
    }
  }
}
