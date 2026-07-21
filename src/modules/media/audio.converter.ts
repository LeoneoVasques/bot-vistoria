import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import fs from 'fs';
import path from 'path';

// Configura o caminho do binário do FFMPEG
ffmpeg.setFfmpegPath(ffmpegInstaller.path);

export async function convertOggToMp3(inputPath: string): Promise<string> {
  const outputPath = inputPath.replace(/\.[^/.]+$/, '') + '.mp3';

  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .toFormat('mp3')
      .on('end', () => {
        resolve(outputPath);
      })
      .on('error', (err) => {
        console.error('Erro na conversão FFMPEG:', err);
        reject(err);
      })
      .save(outputPath);
  });
}
