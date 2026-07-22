import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import ffprobeInstaller from '@ffprobe-installer/ffprobe';
import fs from 'fs';
import path from 'path';

ffmpeg.setFfmpegPath(ffmpegInstaller.path);
ffmpeg.setFfprobePath(ffprobeInstaller.path);

/**
 * Obtém a duração exata do áudio em segundos via FFprobe
 */
export async function getAudioDuration(filePath: string): Promise<number> {
  return new Promise((resolve) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err || !metadata || !metadata.format || !metadata.format.duration) {
        console.warn('[MediaOptimizer] Não foi possível ler a duração do áudio:', err);
        return resolve(0);
      }
      resolve(metadata.format.duration);
    });
  });
}

/**
 * Redimensiona e comprime imagem para no máximo 1280px de largura mantendo a proporção.
 * Reduz arquivos de ~5MB para ~150-250KB com qualidade otimizada para laudos.
 */
export async function compressImage(filePath: string): Promise<string> {
  const dir = path.dirname(filePath);
  const ext = path.extname(filePath);
  const baseName = path.basename(filePath, ext);
  const compressedPath = path.join(dir, `${baseName}_compressed.jpg`);

  return new Promise((resolve) => {
    ffmpeg(filePath)
      .outputOptions([
        '-vf scale=min(1280\\,iw):-1', // Redimensiona para no máx 1280px de largura se for maior
        '-q:v 5',                       // Compressão de qualidade JPEG otimizada
      ])
      .save(compressedPath)
      .on('end', async () => {
        try {
          const originalSize = (await fs.promises.stat(filePath)).size;
          const compressedSize = (await fs.promises.stat(compressedPath)).size;
          console.log(`[MediaOptimizer] Imagem otimizada: ${originalSize} -> ${compressedSize} bytes (${Math.round((1 - compressedSize / originalSize) * 100)}% de redução)`);
          
          // Apaga a foto original pesada e substitui pelo arquivo otimizado
          await fs.promises.unlink(filePath).catch(() => {});
          resolve(compressedPath);
        } catch {
          resolve(compressedPath);
        }
      })
      .on('error', (err) => {
        console.warn('[MediaOptimizer] Erro ao comprimir imagem, usando original:', err);
        resolve(filePath);
      });
  });
}
