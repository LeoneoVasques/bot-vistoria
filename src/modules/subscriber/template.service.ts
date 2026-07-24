import fs from 'fs';
import path from 'path';
import { prisma } from '../../config/prisma';
import { mediaStorageService } from '../media/media.storage';
import { subscriberService } from './subscriber.service';

export class TemplateService {
  private pdfBaseDir = path.resolve(process.cwd(), 'src', 'modules', 'pdf', 'templates', 'pdf_base');

  constructor() {
    if (!fs.existsSync(this.pdfBaseDir)) {
      fs.mkdirSync(this.pdfBaseDir, { recursive: true });
    }
  }

  /**
   * Salva a ficha de vistoria PDF personalizada enviada pelo cliente
   */
  public async saveCustomTemplate(
    userPhone: string,
    pdfBuffer: Buffer,
    fileName: string = 'Ficha_Personalizada.pdf'
  ) {
    const cleanedPhone = subscriberService.cleanPhone(userPhone);
    const safeFileName = `template_${cleanedPhone}_${Date.now()}.pdf`;
    const localPath = path.join(this.pdfBaseDir, safeFileName);

    // 1. Salva cópia local
    await fs.promises.writeFile(localPath, pdfBuffer);
    console.log(`[TemplateService] PDF Base do cliente salvo localmente: ${localPath}`);

    // 2. Upload para Cloudflare R2 se ativado
    let pdfUrl = localPath;
    if (mediaStorageService.isCloudStorageEnabled()) {
      const cloudKey = `templates/${cleanedPhone}/${safeFileName}`;
      const uploadedUrl = await mediaStorageService.uploadToCloud(cloudKey, pdfBuffer, 'application/pdf');
      if (uploadedUrl) {
        pdfUrl = uploadedUrl;
      }
    }

    // 3. Salva no banco de dados vinculando ao Assinante (se existir)
    try {
      const subscriber = await prisma.subscriber.findUnique({
        where: { phone: cleanedPhone },
      });

      if (subscriber) {
        const template = await prisma.subscriberTemplate.create({
          data: {
            subscriberId: subscriber.id,
            name: fileName.replace(/\.pdf$/i, ''),
            pdfUrl,
            pdfPath: localPath,
          },
        });
        console.log(`[TemplateService] Modelo de PDF vinculado ao assinante ${subscriber.name} no DB!`);
        return template;
      }
    } catch (err) {
      console.warn('[TemplateService] Aviso ao salvar template no DB:', err);
    }

    return {
      name: fileName,
      pdfUrl,
      pdfPath: localPath,
    };
  }

  /**
   * Obtém a ficha PDF personalizada ativa do cliente (se houver)
   */
  public async getActiveTemplatePath(userPhone: string): Promise<string | null> {
    const cleanedPhone = subscriberService.cleanPhone(userPhone);

    try {
      const subscriber = await prisma.subscriber.findUnique({
        where: { phone: cleanedPhone },
        include: { templates: { orderBy: { createdAt: 'desc' }, take: 1 } },
      });

      if (subscriber && subscriber.templates.length > 0) {
        const lastTemplate = subscriber.templates[0];
        if (lastTemplate.pdfPath && fs.existsSync(lastTemplate.pdfPath)) {
          return lastTemplate.pdfPath;
        }
      }
    } catch {
      // Ignora e usa fallback
    }

    // Busca arquivos no diretório local de templates
    const files = fs.readdirSync(this.pdfBaseDir).filter((f) => f.toLowerCase().endsWith('.pdf'));
    const userFile = files.find((f) => f.includes(cleanedPhone));
    if (userFile) {
      return path.join(this.pdfBaseDir, userFile);
    }

    // Se houver qualquer PDF de ficha na pasta pdf_base, usa como modelo padrão
    if (files.length > 0) {
      return path.join(this.pdfBaseDir, files[0]);
    }

    return null;
  }
}

export const templateService = new TemplateService();
