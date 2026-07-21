import fs from 'fs';
import path from 'path';
import { MessageMedia } from 'whatsapp-web.js';

export class MediaStorageService {
  private uploadsDir = path.resolve(process.cwd(), 'uploads');
  private audioDir = path.resolve(this.uploadsDir, 'audio');
  private imagesDir = path.resolve(this.uploadsDir, 'images');

  constructor() {
    this.ensureDirectories();
  }

  private ensureDirectories() {
    if (!fs.existsSync(this.uploadsDir)) fs.mkdirSync(this.uploadsDir, { recursive: true });
    if (!fs.existsSync(this.audioDir)) fs.mkdirSync(this.audioDir, { recursive: true });
    if (!fs.existsSync(this.imagesDir)) fs.mkdirSync(this.imagesDir, { recursive: true });
  }

  public async saveAudio(media: MessageMedia): Promise<string> {
    let ext = 'ogg';
    const mime = (media.mimetype || '').toLowerCase();

    if (mime.includes('mp4') || mime.includes('m4a') || mime.includes('aac')) {
      ext = 'm4a';
    } else if (mime.includes('mp3') || mime.includes('mpeg')) {
      ext = 'mp3';
    } else if (mime.includes('wav')) {
      ext = 'wav';
    } else if (mime.includes('webm')) {
      ext = 'webm';
    } else if (mime.includes('ogg')) {
      ext = 'ogg';
    }

    const filename = `audio_${Date.now()}_${Math.random().toString(36).substring(7)}.${ext}`;
    const filePath = path.join(this.audioDir, filename);

    const buffer = Buffer.from(media.data, 'base64');
    await fs.promises.writeFile(filePath, buffer);

    console.log(`[MediaStorage] Áudio salvo com sucesso: ${filePath} (${buffer.length} bytes, mime: ${media.mimetype})`);

    return filePath;
  }

  public async saveImage(media: MessageMedia): Promise<string> {
    const ext = media.mimetype.includes('png') ? 'png' : 'jpg';
    const filename = `img_${Date.now()}_${Math.random().toString(36).substring(7)}.${ext}`;
    const filePath = path.join(this.imagesDir, filename);

    const buffer = Buffer.from(media.data, 'base64');
    await fs.promises.writeFile(filePath, buffer);

    console.log(`[MediaStorage] Imagem salva com sucesso: ${filePath} (${buffer.length} bytes)`);

    return filePath;
  }
}

export const mediaStorageService = new MediaStorageService();
