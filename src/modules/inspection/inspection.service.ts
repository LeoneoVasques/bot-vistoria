import { redis } from '../../config/redis';
import { ActiveInspectionSession } from './inspection.types';

export class InspectionService {
  // Store em memória para fallback gracioso se o Redis estiver offline
  private inMemoryStore = new Map<string, ActiveInspectionSession>();

  private getKey(userPhone: string): string {
    return `vistoria:session:${userPhone}`;
  }

  public async getSession(userPhone: string): Promise<ActiveInspectionSession | null> {
    try {
      if (redis.status === 'ready') {
        const data = await redis.get(this.getKey(userPhone));
        if (data) return JSON.parse(data) as ActiveInspectionSession;
      }
    } catch {
      // Ignora erro e usa fallback em memória
    }
    return this.inMemoryStore.get(userPhone) || null;
  }

  public async createSession(userPhone: string, rawPlate: string): Promise<ActiveInspectionSession> {
    const plate = rawPlate.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    const session: ActiveInspectionSession = {
      plate,
      userPhone,
      status: 'EM_ANDAMENTO',
      startedAt: new Date().toISOString(),
      transcriptions: [],
      images: [],
    };

    // Atualiza store em memória
    this.inMemoryStore.set(userPhone, session);

    // Tenta salvar no Redis
    try {
      if (redis.status === 'ready') {
        await redis.set(this.getKey(userPhone), JSON.stringify(session), 'EX', 86400);
      }
    } catch {
      // Fallback em memória ativado
    }

    return session;
  }

  public async addTranscription(userPhone: string, text: string): Promise<ActiveInspectionSession | null> {
    const session = await this.getSession(userPhone);
    if (!session) return null;

    session.transcriptions.push(text);
    this.inMemoryStore.set(userPhone, session);

    try {
      if (redis.status === 'ready') {
        await redis.set(this.getKey(userPhone), JSON.stringify(session), 'EX', 86400);
      }
    } catch {
      // Fallback em memória
    }

    return session;
  }

  public async addImage(userPhone: string, imagePath: string): Promise<ActiveInspectionSession | null> {
    const session = await this.getSession(userPhone);
    if (!session) return null;

    session.images.push(imagePath);
    this.inMemoryStore.set(userPhone, session);

    try {
      if (redis.status === 'ready') {
        await redis.set(this.getKey(userPhone), JSON.stringify(session), 'EX', 86400);
      }
    } catch {
      // Fallback em memória
    }

    return session;
  }

  public async removeSession(userPhone: string): Promise<void> {
    this.inMemoryStore.delete(userPhone);
    try {
      if (redis.status === 'ready') {
        await redis.del(this.getKey(userPhone));
      }
    } catch {
      // Fallback em memória
    }
  }
}

export const inspectionService = new InspectionService();
