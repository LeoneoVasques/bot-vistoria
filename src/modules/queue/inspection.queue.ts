import { Queue, Worker, Job } from 'bullmq';
import { redisConnectionOptions } from './queue.config';
import { whisperService } from '../ai/whisper.service';
import { gptService } from '../ai/gpt.service';
import { pdfService } from '../pdf/pdf.service';
import { inspectionService } from '../inspection/inspection.service';
import { redis } from '../../config/redis';
import { env } from '../../config/env';
import fs from 'fs';

export interface AudioProcessingJobData {
  userPhone: string;
  savedAudioPath: string;
}

export interface PdfGenerationJobData {
  userPhone: string;
  plate: string;
  transcriptions: string[];
  images: string[];
  officeTemplate?: string;
}

export const QUEUE_NAMES = {
  AUDIO_TRANSCRIPTION: 'audio-transcription-queue',
  PDF_GENERATION: 'pdf-generation-queue',
};

let audioQueue: Queue<AudioProcessingJobData> | null = null;
let pdfQueue: Queue<PdfGenerationJobData> | null = null;

export function initQueues(sockGetter?: () => any) {
  if (redis.status !== 'ready') {
    console.log('📁 [BullMQ] Redis local inativo no momento. Operando em modo de processamento direto (Fallback).');
    return;
  }

  try {
    audioQueue = new Queue<AudioProcessingJobData>(QUEUE_NAMES.AUDIO_TRANSCRIPTION, {
      connection: redisConnectionOptions,
    });

    pdfQueue = new Queue<PdfGenerationJobData>(QUEUE_NAMES.PDF_GENERATION, {
      connection: redisConnectionOptions,
    });

    // Worker de Transcrição de Áudio
    new Worker<AudioProcessingJobData>(
      QUEUE_NAMES.AUDIO_TRANSCRIPTION,
      async (job: Job<AudioProcessingJobData>) => {
        const { userPhone, savedAudioPath } = job.data;
        console.log(`[BullMQ Worker] Processando áudio do usuário ${userPhone} (Job ID: ${job.id})...`);

        try {
          const transcription = await whisperService.transcribeAudio(savedAudioPath);
          await inspectionService.addTranscription(userPhone, transcription);

          const sock = sockGetter?.();
          if (sock) {
            await sock.sendMessage(userPhone, { text: `✅ *Transcrito:* "${transcription}"` });
          }
        } catch (err: any) {
          console.error(`[BullMQ Worker] Erro no job de áudio para ${userPhone}:`, err);
          const sock = sockGetter?.();
          if (sock) {
            await sock.sendMessage(userPhone, { text: '⚠️ Falha na transcrição do áudio enviado.' });
          }
        } finally {
          if (savedAudioPath && fs.existsSync(savedAudioPath)) {
            await fs.promises.unlink(savedAudioPath).catch(() => {});
          }
        }
      },
      { connection: redisConnectionOptions, concurrency: 3 }
    );

    // Worker de Geração de PDF
    new Worker<PdfGenerationJobData>(
      QUEUE_NAMES.PDF_GENERATION,
      async (job: Job<PdfGenerationJobData>) => {
        const { userPhone, plate, transcriptions, images, officeTemplate } = job.data;
        console.log(`[BullMQ Worker] Gerando laudo PDF da placa ${plate} para ${userPhone} (Job ID: ${job.id})...`);

        try {
          const extractedData = await gptService.extractInspectionData(plate, transcriptions, images);
          const pdfPath = await pdfService.generateInspectionPDF(extractedData, images, officeTemplate);

          await inspectionService.updateDraftData(userPhone, extractedData, pdfPath);

          const sock = sockGetter?.();
          if (sock) {
            const pdfBuffer = await fs.promises.readFile(pdfPath);
            const reviewUrl = `http://localhost:${env.PORT}/review/${encodeURIComponent(userPhone)}`;
            await sock.sendMessage(
              userPhone,
              {
                document: pdfBuffer,
                mimetype: 'application/pdf',
                fileName: `Rascunho_Laudo_${plate}.pdf`,
                caption:
                  `📄 *Rascunho do Laudo de Vistoria Gerado!*\n` +
                  `Placa: *${plate}*\n` +
                  `Parecer: *${extractedData.parecer_geral}*\n\n` +
                  `📌 *Escolha uma opção digitando no chat:*\n\n` +
                  `1️⃣ *Aprovar* (ou digite *1*) - Aprova e finaliza o laudo definitivamente.\n` +
                  `2️⃣ *Revisar/Assinar Touch* (ou digite *2*) - Acesse: ${reviewUrl}\n` +
                  `3️⃣ *Cancelar* (ou digite *3*) - Descarta a vistoria em andamento.`,
              }
            );
          }
        } catch (err) {
          console.error(`[BullMQ Worker] Erro ao gerar PDF para ${userPhone}:`, err);
          const sock = sockGetter?.();
          if (sock) {
            await sock.sendMessage(userPhone, { text: '❌ Ocorreu um erro ao gerar o rascunho do laudo. Por favor, tente novamente.' });
          }
        }
      },
      { connection: redisConnectionOptions, concurrency: 2 }
    );

    console.log('⚡ [BullMQ] Filas de segundo plano e Workers inicializados com sucesso!');
  } catch (err) {
    console.warn('[BullMQ] Não foi possível conectar ao Redis para criar filas BullMQ. Usando execução síncrona inline.');
  }
}

export async function addAudioJob(data: AudioProcessingJobData): Promise<boolean> {
  if (audioQueue && redis.status === 'ready') {
    try {
      await audioQueue.add('transcribe-audio', data, { attempts: 2, backoff: 3000 });
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

export async function addPdfJob(data: PdfGenerationJobData): Promise<boolean> {
  if (pdfQueue && redis.status === 'ready') {
    try {
      await pdfQueue.add('generate-pdf', data, { attempts: 2, backoff: 3000 });
      return true;
    } catch {
      return false;
    }
  }
  return false;
}
