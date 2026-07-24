import fs from 'fs';
import path from 'path';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { env } from '../../config/env';

export class MediaStorageService {
  private uploadsDir = path.resolve(process.cwd(), 'uploads');
  private audioDir = path.resolve(this.uploadsDir, 'audio');
  private imagesDir = path.resolve(this.uploadsDir, 'images');
  private s3Client: S3Client | null = null;

  constructor() {
    this.ensureDirectories();
    this.initS3Client();
  }

  private ensureDirectories() {
    if (!fs.existsSync(this.uploadsDir)) fs.mkdirSync(this.uploadsDir, { recursive: true });
    if (!fs.existsSync(this.audioDir)) fs.mkdirSync(this.audioDir, { recursive: true });
    if (!fs.existsSync(this.imagesDir)) fs.mkdirSync(this.imagesDir, { recursive: true });
  }

  private initS3Client() {
    if (env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY && env.R2_ACCOUNT_ID) {
      const endpoint = `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
      this.s3Client = new S3Client({
        region: 'auto',
        endpoint,
        credentials: {
          accessKeyId: env.R2_ACCESS_KEY_ID,
          secretAccessKey: env.R2_SECRET_ACCESS_KEY,
        },
      });
      console.log('☁️ [MediaStorage] Cliente Cloudflare R2 / S3 configurado e ativado!');
    } else {
      console.log('📁 [MediaStorage] Modo de armazenamento local ativo (R2/S3 opcional).');
    }
  }

  public isCloudStorageEnabled(): boolean {
    return this.s3Client !== null && !!env.R2_BUCKET_NAME;
  }

  /**
   * Faz upload de um buffer de arquivo para o Cloudflare R2 / AWS S3
   */
  public async uploadToCloud(fileKey: string, buffer: Buffer, contentType: string): Promise<string | null> {
    if (!this.s3Client || !env.R2_BUCKET_NAME) return null;

    try {
      const command = new PutObjectCommand({
        Bucket: env.R2_BUCKET_NAME,
        Key: fileKey,
        Body: buffer,
        ContentType: contentType,
      });

      await this.s3Client.send(command);

      const publicUrl = env.R2_PUBLIC_URL 
        ? `${env.R2_PUBLIC_URL.replace(/\/$/, '')}/${fileKey}`
        : `https://${env.R2_BUCKET_NAME}.${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${fileKey}`;

      console.log(`☁️ [MediaStorage] Upload concluído para o Cloudflare R2: ${publicUrl}`);
      return publicUrl;
    } catch (err) {
      console.error('❌ [MediaStorage] Erro ao fazer upload para o Cloudflare R2:', err);
      return null;
    }
  }

  public async saveAudio(buffer: Buffer, mimetype: string = ''): Promise<string> {
    let ext = 'ogg';
    const mime = mimetype.toLowerCase();

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
    const localFilePath = path.join(this.audioDir, filename);

    await fs.promises.writeFile(localFilePath, buffer);
    console.log(`[MediaStorage] Áudio salvo localmente: ${localFilePath} (${buffer.length} bytes)`);

    if (this.isCloudStorageEnabled()) {
      const cloudKey = `audios/${filename}`;
      const cloudUrl = await this.uploadToCloud(cloudKey, buffer, mimetype || 'audio/ogg');
      if (cloudUrl) return cloudUrl;
    }

    return localFilePath;
  }

  public async saveImage(buffer: Buffer, mimetype: string = ''): Promise<string> {
    const ext = mimetype.toLowerCase().includes('png') ? 'png' : 'jpg';
    const filename = `img_${Date.now()}_${Math.random().toString(36).substring(7)}.${ext}`;
    const localFilePath = path.join(this.imagesDir, filename);

    await fs.promises.writeFile(localFilePath, buffer);
    console.log(`[MediaStorage] Imagem salva localmente: ${localFilePath} (${buffer.length} bytes)`);

    if (this.isCloudStorageEnabled()) {
      const cloudKey = `images/${filename}`;
      const contentType = ext === 'png' ? 'image/png' : 'image/jpeg';
      const cloudUrl = await this.uploadToCloud(cloudKey, buffer, contentType);
      if (cloudUrl) return cloudUrl;
    }

    return localFilePath;
  }
}

export const mediaStorageService = new MediaStorageService();
