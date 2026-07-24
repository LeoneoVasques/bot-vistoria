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

    // 1.1 Gera arquivo de configuração de coordenadas .json automaticamente para esta nova ficha
    const jsonPath = localPath.replace(/\.pdf$/i, '.json');
    const defaultCoords = {
      placa: { x: 105, y: 745, fontSize: 11, bold: true, page: 0 },
      modelo: { x: 240, y: 745, fontSize: 10, bold: true, page: 0 },
      ano: { x: 435, y: 745, fontSize: 10, page: 0 },
      cor: { x: 105, y: 718, fontSize: 10, page: 0 },
      quilometragem: { x: 240, y: 718, fontSize: 10, page: 0 },
      combustivel: { x: 435, y: 718, fontSize: 10, page: 0 },
      funilaria_pintura: { x: 105, y: 665, fontSize: 9, page: 0 },
      pneus_rodas: { x: 105, y: 625, fontSize: 9, page: 0 },
      vidros_farois: { x: 105, y: 585, fontSize: 9, page: 0 },
      interior_estofamento: { x: 105, y: 545, fontSize: 9, page: 0 },
      equipamentos_seguranca: { x: 105, y: 505, fontSize: 9, page: 0 },
      parecer_geral: { x: 105, y: 455, fontSize: 11, bold: true, page: 0 },
      observacoes: { x: 105, y: 410, fontSize: 9, page: 0 },
      assinatura: { x: 420, y: 40, width: 130, height: 50, page: 0 },
    };
    await fs.promises.writeFile(jsonPath, JSON.stringify(defaultCoords, null, 2), 'utf8');
    console.log(`[TemplateService] Mapeamento de coordenadas gerado automaticamente em: ${jsonPath}`);

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

  /**
   * Obtém a lista de todas as fichas de vistoria disponíveis para o assinante escolher
   */
  public async getUserTemplatesList(userPhone: string): Promise<Array<{ name: string; path: string }>> {
    const cleanedPhone = subscriberService.cleanPhone(userPhone);
    const result: Array<{ name: string; path: string }> = [];

    try {
      const subscriber = await prisma.subscriber.findUnique({
        where: { phone: cleanedPhone },
        include: { templates: { orderBy: { createdAt: 'desc' } } },
      });

      if (subscriber && subscriber.templates.length > 0) {
        for (const t of subscriber.templates) {
          if (t.pdfPath && fs.existsSync(t.pdfPath)) {
            result.push({ name: t.name, path: t.pdfPath });
          }
        }
      }
    } catch {}

    // Busca também arquivos em pdf_base
    const files = fs.readdirSync(this.pdfBaseDir).filter((f) => f.toLowerCase().endsWith('.pdf'));
    for (const file of files) {
      const fullPath = path.join(this.pdfBaseDir, file);
      const displayName = file
        .replace(/^template_\d+_\d+_/i, '')
        .replace(/\.pdf$/i, '')
        .replace(/ - Copia$/i, '');

      if (!result.some((r) => r.path === fullPath)) {
        result.push({ name: displayName, path: fullPath });
      }
    }

    return result;
  }
}

export const templateService = new TemplateService();
