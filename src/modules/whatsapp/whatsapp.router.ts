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
import { templateService } from '../subscriber/template.service';
import { addAudioJob, addPdfJob } from '../queue/inspection.queue';
import { env } from '../../config/env';

import { rateLimiterService } from '../security/rate.limiter';

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

  // Trava de Segurança Anti-Ataque / Rate Limiter (Máximo 12 requisições por minuto por número)
  const rateLimit = await rateLimiterService.checkRateLimit(userPhone);
  if (!rateLimit.allowed) {
    await reply('⚠️ *Proteção Anti-Spam Ativada!* Você está enviando mensagens rápido demais. Por favor, aguarde alguns segundos antes de enviar novos comandos ou mídias.');
    return;
  }

  // Comando 1: !teste
  if (body.toLowerCase() === '!teste') {
    console.log(`[Router] Comando !teste recebido de: ${userPhone}`);
    const aiHealth = await checkOpenAIHealth(true);

    if (aiHealth.ok) {
      await reply('Pong! 🚗 VistoriaBot ativo e todos os serviços de Inteligência Artificial totalmente operacionais.');
    } else {
      await reply(`Pong! 🚗 VistoriaBot ativo, mas os serviços de Inteligência Artificial estão com limitações no momento.\n\n${aiHealth.reason}`);
    }
    return;
  }

  // Comando: !menu / menu / ajuda / opçoes
  if (body.match(/^(!menu|menu|ajuda|help|opçõ|opco)/i)) {
    await reply(
      `🤖 *VistoriaBot - Menu de Opções*\n\n` +
      `Selecione uma opção digitando no chat:\n\n` +
      `1️⃣ *Iniciar Nova Vistoria*\n` +
      `👉 Digite: *Vistoria [PLACA]* (ex: \`Vistoria ABC1D23\`)\n\n` +
      `2️⃣ *Gerar Laudo Rascunho*\n` +
      `👉 Digite: *Finalizar*\n\n` +
      `3️⃣ *Aprovar Vistoria*\n` +
      `👉 Digite: *Aprovar* ou *1*\n\n` +
      `4️⃣ *Cadastrar Assinatura do Vistoriador*\n` +
      `👉 Envie foto da sua assinatura com a legenda *!assinatura*\n\n` +
      `5️⃣ *Cadastrar Ficha de Vistoria (PDF)*\n` +
      `👉 Envie o arquivo PDF da ficha da sua empresa no chat.`
    );
    return;
  }

  // Mapa em memória para capturar o nome customizado de fichas recém enviadas
  const pendingNamingMap = (global as any).pendingNamingMap || ((global as any).pendingNamingMap = new Map<string, any>());

  if (pendingNamingMap.has(userPhone)) {
    const templateObj = pendingNamingMap.get(userPhone);
    const newName = body.trim().replace(/[^a-zA-Z0-9_\-\s]/g, '');
    if (newName.length >= 2) {
      pendingNamingMap.delete(userPhone);
      templateObj.name = newName;
      await reply(
        `✅ *Ficha '${newName}' cadastrada e pronta para uso!*\n\n` +
        `⚙️ Estrutura de preenchimento e coordenadas mapeadas automaticamente.\n\n` +
        `👉 *Como utilizar:*\n` +
        `- Ao iniciar uma vistoria, digite: \`Vistoria [PLACA] ${newName.toLowerCase()}\`\n` +
        `- Ou digite apenas \`Vistoria [PLACA]\` e escolha a ficha no menu de opções!`
      );
      return;
    }
  }

  // Comando 2: Vistoria [PLACA] [MODELO_OPCIONAL]
  const startMatch = body.match(/^vistoria\s+([a-zA-Z0-9\-]+)(?:\s+([a-zA-Z0-9_\-]+))?/i);
  if (startMatch) {
    const rawPlate = startMatch[1];
    let officeTemplate = startMatch[2];

    const userTemplates = await templateService.getUserTemplatesList(userPhone);

    // Se o vistoriador especificou o modelo no comando (ex: Vistoria ABC1D23 itau)
    if (startMatch[2]) {
      officeTemplate = startMatch[2];
    } else if (userTemplates.length > 1) {
      // Se possui mais de uma ficha cadastrada, pergunta qual ele quer usar nesta vistoria
      const activeCheck = await inspectionService.getSession(userPhone);
      if (activeCheck) {
        await reply(`⚠️ Já existe uma vistoria em andamento para a placa *${activeCheck.plate}*.\nEnvie áudios, textos e fotos ou envie *Finalizar ${activeCheck.plate}* para concluir.`);
        return;
      }

      const session = await inspectionService.createSession(userPhone, rawPlate);
      session.status = 'AGUARDANDO_SELECAO_TEMPLATE';
      await inspectionService.updateDraftData(userPhone, null, '');

      const templateOptions = userTemplates.map((t, idx) => `   ${idx + 1}️⃣ *${t.name}*`).join('\n');
      await reply(
        `📋 *Iniciando Vistoria - Placa: ${session.plate}*\n\n` +
        `📌 *Selecione qual modelo de ficha deseja utilizar nesta vistoria:*\n\n` +
        `${templateOptions}\n` +
        `   ${userTemplates.length + 1}️⃣ *Modelo Padrão VistoriaBot*\n\n` +
        `👉 Responda digitando o número da opção ou o nome da ficha (ex: "1" ou "${userTemplates[0].name}").`
      );
      return;
    } else if (userTemplates.length === 1) {
      officeTemplate = userTemplates[0].path;
    }

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
      await reply(`⛔ *Vistoria Não Iniciada - Conexão com IA Indisponível*\n\nOs serviços de Inteligência Artificial do VistoriaBot estão indisponíveis no momento.\n\n${aiHealth.reason}\n\n*A vistoria só poderá ser iniciada após o restabelecimento do acesso à Inteligência Artificial.*`);
      return;
    }

    const activeSession = await inspectionService.getSession(userPhone);
    if (activeSession) {
      await reply(`⚠️ Já existe uma vistoria em andamento para a placa *${activeSession.plate}*.\nEnvie áudios, textos e fotos ou envie *Finalizar ${activeSession.plate}* para concluir.`);
      return;
    }

    const session = await inspectionService.createSession(userPhone, rawPlate, officeTemplate);
    const templateMsg = session.officeTemplate ? ` (Modelo: *Personalizado do Cliente*)` : '';
    await reply(`✅ *Vistoria iniciada para a placa ${session.plate}*${templateMsg}!\n\n📌 *Instruções:*\n1️⃣ Envie mensagens de texto ou 🎙️ áudios explicando os detalhes e estado do veículo.\n2️⃣ Envie 📸 fotos do veículo (lataria, pneus, painel, etc.).\n3️⃣ Quando concluir, envie a mensagem: *Finalizar ${session.plate}*.`);
    return;
  }

  const session = await inspectionService.getSession(userPhone);

  // Se a sessão está aguardando o vistoriador escolher qual ficha deseja utilizar
  if (session && session.status === 'AGUARDANDO_SELECAO_TEMPLATE') {
    const userTemplates = await templateService.getUserTemplatesList(userPhone);
    let chosenPath: string | undefined;
    let chosenName = 'Modelo Padrão';

    const numChoice = parseInt(body.trim(), 10);
    if (!isNaN(numChoice) && numChoice >= 1 && numChoice <= userTemplates.length) {
      chosenPath = userTemplates[numChoice - 1].path;
      chosenName = userTemplates[numChoice - 1].name;
    } else if (!isNaN(numChoice) && numChoice === userTemplates.length + 1) {
      chosenPath = undefined;
      chosenName = 'Modelo Padrão';
    } else {
      const match = userTemplates.find((t) => t.name.toLowerCase().includes(body.trim().toLowerCase()));
      if (match) {
        chosenPath = match.path;
        chosenName = match.name;
      }
    }

    session.officeTemplate = chosenPath;
    session.status = 'EM_ANDAMENTO';
    await inspectionService.updateDraftData(userPhone, null, '');

    await reply(
      `✅ *Ficha '${chosenName}' selecionada para a vistoria da placa ${session.plate}!*\n\n` +
      `📌 *Instruções:*\n` +
      `1️⃣ Envie mensagens de texto ou 🎙️ áudios detalhando o veículo.\n` +
      `2️⃣ Envie 📸 fotos do veículo.\n` +
      `3️⃣ Quando concluir, envie a mensagem: *Finalizar*.`
    );
    return;
  }

  // Comando 3: Finalizar [PLACA] (Gera Rascunho)
  const finishMatch = body.match(/^finalizar(?:\s+([a-zA-Z0-9\-]+))?/i);
  if (finishMatch) {
    if (!session) {
      await reply('⚠️ Nenhuma vistoria em andamento encontrada para este número.');
      return;
    }

    const aiHealth = await checkOpenAIHealth(true);
    if (!aiHealth.ok) {
      await reply(`⛔ *Não é possível gerar o laudo - IA Indisponível*\n\nA consolidação dos dados exige acesso ativo aos serviços de Inteligência Artificial.\n\n${aiHealth.reason}\n\nSua sessão para a placa *${session.plate}* continua mantida. Assim que o acesso for restabelecido, envie *Finalizar ${session.plate}* novamente.`);
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
      await reply(`⏳ *Gerando rascunho do laudo para a placa ${session.plate} em segundo plano...*\n\n1️⃣ Consolidando transcrições e fotos...\n2️⃣ Extraindo dados estruturados com Inteligência Artificial...\n3️⃣ Renderizando laudo PDF com anexo fotográfico...\n\nVocê receberá o laudo completo em instantes!`);
      return;
    }

    await reply(`⏳ *Analisando dados da vistoria para a placa ${session.plate}...*`);

    try {
      const extractedData = await gptService.extractInspectionData(session.plate, session.transcriptions, session.images);

      // Se existirem campos não informados e ainda não questionamos o vistoriador
      if (extractedData.missingFields && extractedData.missingFields.length > 0 && !session.missingFieldsPrompted) {
        session.status = 'AGUARDANDO_DADOS_FALTANTES';
        session.lastExtractedData = extractedData;
        session.missingFieldsPrompted = true;

        await inspectionService.updateDraftData(userPhone, extractedData, '');

        const missingList = extractedData.missingFields.map((f, i) => `   ${i + 1}️⃣ *${f}*`).join('\n');
        await reply(
          `📋 *Checagem de Dados da Vistoria (${session.plate})*\n\n` +
          `⚠️ *Identificamos que as seguintes informações não foram relatadas:*\n` +
          `${missingList}\n\n` +
          `📌 *Como deseja prosseguir?*\n` +
          `👉 *Envie mensagens de texto ou áudios* no chat complementando as informações pendentes.\n` +
          `👉 Ou digite *Gerar* (ou *1*) para prosseguir e deixar estes campos em branco no laudo.`
        );
        return;
      }

      // Caso contrário, gera o PDF do laudo imediatamente
      const pdfPath = await pdfService.generateInspectionPDF(extractedData, session.images, session.officeTemplate);
      await inspectionService.updateDraftData(userPhone, extractedData, pdfPath);

      const reviewUrl = `http://localhost:${env.PORT}/review/${encodeURIComponent(userPhone)}`;
      await reply(
        `📄 *Rascunho do Laudo de Vistoria Gerado!*\n` +
        `Placa: *${session.plate}*\n` +
        `Parecer: *${extractedData.parecer_geral}*\n\n` +
        `📌 *Escolha uma opção digitando no chat:*\n\n` +
        `1️⃣ *Aprovar* (ou digite *1*) - Aprova e finaliza o laudo definitivamente.\n` +
        `2️⃣ *Revisar/Assinar Touch* (ou digite *2*) - Acesse: ${reviewUrl}\n` +
        `3️⃣ *Cancelar* (ou digite *3*) - Descarta a vistoria em andamento.`,
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

  // Comando Gerar / 1 (quando aguardando confirmação de dados faltantes)
  const generateMatch = body.match(/^(gerar|continuar|prosseguir)$/i);
  if (generateMatch && session && session.status === 'AGUARDANDO_DADOS_FALTANTES') {
    await reply(`⏳ *Gerando laudo para a placa ${session.plate} com os campos em branco...*`);
    try {
      const extractedData = session.lastExtractedData || await gptService.extractInspectionData(session.plate, session.transcriptions, session.images);
      const pdfPath = await pdfService.generateInspectionPDF(extractedData, session.images, session.officeTemplate);

      await inspectionService.updateDraftData(userPhone, extractedData, pdfPath);

      const reviewUrl = `http://localhost:${env.PORT}/review/${encodeURIComponent(userPhone)}`;
      await reply(
        `📄 *Rascunho do Laudo de Vistoria Gerado!*\n` +
        `Placa: *${session.plate}*\n` +
        `Parecer: *${extractedData.parecer_geral}*\n\n` +
        `📌 *Escolha uma opção digitando no chat:*\n\n` +
        `1️⃣ *Aprovar* (ou digite *1*) - Aprova e finaliza o laudo definitivamente.\n` +
        `2️⃣ *Revisar/Assinar Touch* (ou digite *2*) - Acesse: ${reviewUrl}\n` +
        `3️⃣ *Cancelar* (ou digite *3*) - Descarta a vistoria em andamento.`,
        { 
          document: fs.readFileSync(pdfPath),
          fileName: `Rascunho_Laudo_${session.plate}.pdf`
        }
      );
    } catch (err) {
      console.error('❌ Erro na geração do laudo:', err);
      await reply('❌ Ocorreu um erro ao gerar o laudo. Tente novamente.');
    }
    return;
  }

  // Comando 4: Opção 1 ou Aprovar (Confirma o rascunho e encerra a vistoria)
  const approveMatch = body.match(/^(1|aprovar|\!aprovar)/i);
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

  // Opção 2 ou Revisar/Editar: Envia link de revisão Web App com assinatura touch
  const reviewMatch = body.match(/^(2|revisar|editar|\!revisar|\!editar)/i);
  if (reviewMatch) {
    if (session && session.lastExtractedData) {
      const reviewUrl = `http://localhost:${env.PORT}/review/${encodeURIComponent(userPhone)}`;
      await reply(
        `✍️ *Link para Revisão & Assinatura Digital Touch:*\n${reviewUrl}\n\n` +
        `Abra o link acima no celular para editar qualquer campo e assinar com o dedo na tela!`
      );
      return;
    }
  }

  // Opção 3 ou Cancelar: Cancela a sessão em andamento
  const cancelMatch = body.match(/^(3|cancelar|\!cancelar)/i);
  if (cancelMatch) {
    if (session) {
      const plate = session.plate;
      await inspectionService.removeSession(userPhone);
      await reply(`🛑 *Vistoria da placa ${plate} cancelada e descartada.*`);
      return;
    }
  }

  // Upload de Modelo de Ficha PDF Personalizada pelo Cliente
  const messageTypeRoot = Object.keys(msg.message || {})[0];
  if (messageTypeRoot === 'documentMessage') {
    const doc = msg.message?.documentMessage;
    if (doc?.mimetype?.includes('pdf') || doc?.fileName?.toLowerCase().endsWith('.pdf')) {
      await reply('📄 *Recebendo seu modelo de ficha de vistoria em PDF...*');
      try {
        const buffer = await downloadMediaMessage(
          msg as WAMessage,
          'buffer',
          {},
          { logger: pino({ level: 'silent' }) as any, reuploadRequest: sock.updateMediaMessage }
        );

        const template = await templateService.saveCustomTemplate(
          userPhone,
          buffer as Buffer,
          doc.fileName || 'Ficha_Oficial.pdf'
        );

        await reply(
          `✅ *Ficha de Vistoria Oficial cadastrada e mapeada com sucesso!*\n\n` +
          `📌 Modelo: *${template.name}*\n` +
          `⚙️ O VistoriaBot analisou e criou a estrutura de preenchimento do seu PDF automaticamente!\n\n` +
          `👉 *Como utilizar nas próximas vistorias:*\n` +
          `- Por padrão, todas as suas novas vistorias serão preenchidas no modelo da sua ficha!\n` +
          `- Se você tiver mais de um modelo cadastrado, pode escolher qual usar ao iniciar: \`Vistoria [PLACA] ${template.name.toLowerCase()}\``
        );
      } catch (err) {
        console.error('[WhatsApp Router] Erro ao cadastrar ficha PDF do cliente:', err);
        await reply('❌ Não foi possível cadastrar sua ficha PDF. Por favor, tente enviá-la novamente.');
      }
      return;
    }
  }

  // Upload de Imagem de Assinatura Oficial do Vistoriador (!assinatura ou legenda contendo 'assinatura')
  if (messageTypeRoot === 'imageMessage') {
    const caption = (msg.message?.imageMessage?.caption || body).toLowerCase().trim();
    if (caption.includes('!assinatura') || caption.includes('assinatura')) {
      await reply('✍️ *Recebendo foto da sua assinatura oficial...*');
      try {
        const buffer = await downloadMediaMessage(
          msg as WAMessage,
          'buffer',
          {},
          { logger: pino({ level: 'silent' }) as any, reuploadRequest: sock.updateMediaMessage }
        );

        await subscriberService.saveSubscriberSignature(
          userPhone,
          buffer as Buffer,
          msg.message?.imageMessage?.mimetype || 'image/png'
        );

        await reply(
          `✅ *Assinatura Oficial do Vistoriador cadastrada com sucesso!*\n\n` +
          `A partir de agora, todos os seus laudos de vistoria em PDF serão emitidos automaticamente com a sua assinatura no rodapé, 100% via WhatsApp!`
        );
      } catch (err) {
        console.error('[WhatsApp Router] Erro ao cadastrar foto de assinatura:', err);
        await reply('❌ Não foi possível salvar a imagem da assinatura. Tente enviá-la novamente.');
      }
      return;
    }
  }

  // Processamento de Mídia na Sessão Ativa
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
        await reply(`⛔ *Transcrição de Áudio Bloqueada*\n\nNão foi possível processar o áudio pois os serviços de Inteligência Artificial estão indisponíveis no momento.\n\n${aiHealth.reason}`);
        return;
      }

      await reply('🎙️ *Áudio recebido.* Processando e transcrevendo com Inteligência Artificial...');
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
