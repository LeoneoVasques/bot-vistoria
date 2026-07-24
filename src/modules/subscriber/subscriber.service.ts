import { prisma } from '../../config/prisma';
import { Subscriber, SubscriberStatus } from '@prisma/client';

export interface AccessCheckResult {
  allowed: boolean;
  reason?: string;
  subscriber?: Subscriber;
}

export class SubscriberService {
  /**
   * Normaliza telefone para apenas dígitos (ex: 5511999999999@s.whatsapp.net -> 5511999999999)
   */
  public cleanPhone(phone: string): string {
    return phone.replace(/[^0-9]/g, '');
  }

  /**
   * Busca um assinante/localizador pelo número de telefone
   */
  public async getSubscriberByPhone(phone: string): Promise<Subscriber | null> {
    const cleaned = this.cleanPhone(phone);
    try {
      return await prisma.subscriber.findUnique({
        where: { phone: cleaned },
      });
    } catch (error) {
      console.warn('[SubscriberService] Aviso ao buscar assinante no DB:', error);
      return null;
    }
  }

  /**
   * Verifica se o usuário tem permissão e cota para usar o bot
   */
  public async checkAccess(userPhone: string): Promise<AccessCheckResult> {
    // Se a trava de assinatura não estiver ativada explicitamente no .env, libera acesso (modo livre/dev)
    const accessControlEnabled = process.env.CHECK_SUBSCRIBER_ACCESS === 'true';
    if (!accessControlEnabled) {
      return { allowed: true };
    }

    const subscriber = await this.getSubscriberByPhone(userPhone);

    if (!subscriber) {
      return {
        allowed: false,
        reason: 'NÚMERO_NÃO_CADASTRADO',
      };
    }

    if (subscriber.status !== SubscriberStatus.ACTIVE) {
      return {
        allowed: false,
        reason: 'ASSINATURA_INATIVA',
        subscriber,
      };
    }

    if (subscriber.expiresAt && new Date(subscriber.expiresAt) < new Date()) {
      return {
        allowed: false,
        reason: 'ASSINATURA_EXPIRADA',
        subscriber,
      };
    }

    if (subscriber.inspectionsCount >= subscriber.maxInspectionsPerMonth) {
      return {
        allowed: false,
        reason: 'LIMITE_MENSAL_ATINGIDO',
        subscriber,
      };
    }

    return {
      allowed: true,
      subscriber,
    };
  }

  /**
   * Cadastra ou atualiza um localizador assinante
   */
  public async registerSubscriber(data: {
    name: string;
    phone: string;
    plan?: string;
    maxInspectionsPerMonth?: number;
    expiresAt?: Date;
  }): Promise<Subscriber> {
    const cleaned = this.cleanPhone(data.phone);
    return await prisma.subscriber.upsert({
      where: { phone: cleaned },
      update: {
        name: data.name,
        status: SubscriberStatus.ACTIVE,
        plan: data.plan || 'PRO',
        maxInspectionsPerMonth: data.maxInspectionsPerMonth || 100,
        expiresAt: data.expiresAt || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 dias por padrão
      },
      create: {
        name: data.name,
        phone: cleaned,
        status: SubscriberStatus.ACTIVE,
        plan: data.plan || 'PRO',
        maxInspectionsPerMonth: data.maxInspectionsPerMonth || 100,
        expiresAt: data.expiresAt || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });
  }

  /**
   * Incrementa o contador de vistorias concluídas no mês
   */
  public async incrementUsage(userPhone: string): Promise<void> {
    const cleaned = this.cleanPhone(userPhone);
    try {
      const subscriber = await this.getSubscriberByPhone(cleaned);
      if (subscriber) {
        await prisma.subscriber.update({
          where: { id: subscriber.id },
          data: { inspectionsCount: { increment: 1 } },
        });
      }
    } catch (err) {
      console.warn('[SubscriberService] Erro ao incrementar uso do assinante:', err);
    }
  }

  /**
   * Cadastra a imagem da assinatura oficial do vistoriador enviada via WhatsApp
   */
  public async saveSubscriberSignature(
    userPhone: string,
    buffer: Buffer,
    mimetype: string = 'image/png'
  ): Promise<string> {
    const fs = require('fs');
    const path = require('path');
    const { mediaStorageService } = require('../media/media.storage');

    const cleaned = this.cleanPhone(userPhone);
    const assetsDir = path.resolve(process.cwd(), 'assets', 'signatures');
    if (!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir, { recursive: true });

    const ext = mimetype.includes('png') ? 'png' : 'jpg';
    const filename = `sig_${cleaned}.${ext}`;
    const localPath = path.join(assetsDir, filename);

    await fs.promises.writeFile(localPath, buffer);
    console.log(`[SubscriberService] Assinatura do vistoriador salva localmente: ${localPath}`);

    let cloudUrl = localPath;
    if (mediaStorageService.isCloudStorageEnabled()) {
      const cloudKey = `signatures/${cleaned}/${filename}`;
      const uploaded = await mediaStorageService.uploadToCloud(cloudKey, buffer, mimetype);
      if (uploaded) cloudUrl = uploaded;
    }

    try {
      const subscriber = await this.getSubscriberByPhone(cleaned);
      if (subscriber) {
        await prisma.subscriber.update({
          where: { id: subscriber.id },
          data: { signaturePath: localPath, signatureUrl: cloudUrl },
        });
      }
    } catch (err) {
      console.warn('[SubscriberService] Aviso ao atualizar assinatura no DB:', err);
    }

    return localPath;
  }

  /**
   * Obtém o caminho local da assinatura do vistoriador
   */
  public async getSubscriberSignaturePath(userPhone: string): Promise<string | null> {
    const fs = require('fs');
    const path = require('path');
    const cleaned = this.cleanPhone(userPhone);
    const assetsDir = path.resolve(process.cwd(), 'assets', 'signatures');
    
    // Busca no DB primeiro
    const subscriber = await this.getSubscriberByPhone(cleaned);
    if (subscriber && subscriber.signaturePath && fs.existsSync(subscriber.signaturePath)) {
      return subscriber.signaturePath;
    }

    // Busca arquivo local fallback
    const pngPath = path.join(assetsDir, `sig_${cleaned}.png`);
    if (fs.existsSync(pngPath)) return pngPath;

    const jpgPath = path.join(assetsDir, `sig_${cleaned}.jpg`);
    if (fs.existsSync(jpgPath)) return jpgPath;

    // Fallback padrão se houver assets/signature.png
    const defaultSig = path.resolve(process.cwd(), 'assets', 'signature.png');
    if (fs.existsSync(defaultSig)) return defaultSig;

    return null;
  }
}

export const subscriberService = new SubscriberService();
