import fs from 'fs';
import path from 'path';
import { toFile } from 'openai';
import { openai } from '../../config/openai';
import { convertOggToMp3 } from '../media/audio.converter';
import { formatAIError } from './ai.error';

export class WhisperService {
  public async transcribeAudio(filePath: string): Promise<string> {
    console.log(`[WhisperService] Iniciando processamento do áudio: ${filePath}`);

    if (!fs.existsSync(filePath)) {
      throw new Error(`Arquivo de áudio não encontrado no caminho: ${filePath}`);
    }

    const fileBuffer = await fs.promises.readFile(filePath);
    const fileName = path.basename(filePath);

    // Estratégia 1: Upload direto com toFile(buffer, fileName)
    try {
      console.log(`[WhisperService] Tentativa 1: toFile(buffer, "${fileName}")...`);
      const fileToUpload = await toFile(fileBuffer, fileName);

      const response = await openai.audio.transcriptions.create({
        file: fileToUpload,
        model: 'whisper-1',
        language: 'pt',
      });

      console.log(`[WhisperService] Transcrição concluída na Tentativa 1: "${response.text}"`);
      return response.text;
    } catch (err1: any) {
      console.warn(`[WhisperService] Tentativa 1 falhou: ${err1?.message || err1}`);
      if (err1?.code === 'insufficient_quota' || err1?.status === 429 || err1?.status === 401) {
        throw new Error(formatAIError(err1));
      }
    }

    // Estratégia 2: Upload com toFile usando extensão '.ogg'
    try {
      console.log(`[WhisperService] Tentativa 2: toFile(buffer, "audio.ogg")...`);
      const fileToUpload = await toFile(fileBuffer, 'audio.ogg');

      const response = await openai.audio.transcriptions.create({
        file: fileToUpload,
        model: 'whisper-1',
        language: 'pt',
      });

      console.log(`[WhisperService] Transcrição concluída na Tentativa 2: "${response.text}"`);
      return response.text;
    } catch (err2: any) {
      console.warn(`[WhisperService] Tentativa 2 falhou: ${err2?.message || err2}`);
      if (err2?.code === 'insufficient_quota' || err2?.status === 429 || err2?.status === 401) {
        throw new Error(formatAIError(err2));
      }
    }

    // Estratégia 3: Conversão para MP3 via FFMPEG
    let convertedMp3Path: string | null = null;
    try {
      console.log(`[WhisperService] Tentativa 3: Convertendo para MP3 com FFMPEG...`);
      convertedMp3Path = await convertOggToMp3(filePath);

      const mp3Buffer = await fs.promises.readFile(convertedMp3Path);
      const mp3File = await toFile(mp3Buffer, 'audio.mp3');

      const response = await openai.audio.transcriptions.create({
        file: mp3File,
        model: 'whisper-1',
        language: 'pt',
      });

      console.log(`[WhisperService] Transcrição concluída na Tentativa 3 (MP3): "${response.text}"`);
      return response.text;
    } catch (err3: any) {
      console.error('[WhisperService] Erro em todas as tentativas de transcrição:', err3);
      throw new Error(formatAIError(err3));
    } finally {
      if (convertedMp3Path && fs.existsSync(convertedMp3Path)) {
        fs.promises.unlink(convertedMp3Path).catch(() => {});
      }
    }
  }
}

export const whisperService = new WhisperService();
