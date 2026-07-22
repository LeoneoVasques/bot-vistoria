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
}

export const subscriberService = new SubscriberService();
