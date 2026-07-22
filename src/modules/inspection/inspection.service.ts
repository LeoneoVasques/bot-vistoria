import fs from 'fs';
import { redis } from '../../config/redis';
import { ActiveInspectionSession } from './inspection.types';

export class InspectionService {
  private inMemoryStore = new Map<string, ActiveInspectionSession>();
  private readonly SESSION_TTL_SECONDS = 3600; // 1 hora de expiração por inatividade

  private getKey(userPhone: string): string {
    return `vistoria:session:${userPhone}`;
  }

  private async saveSession(session: ActiveInspectionSession): Promise<void> {
    session.updatedAt = new Date().toISOString();
    this.inMemoryStore.set(session.userPhone, session);

    try {
      if (redis.status === 'ready') {
        await redis.set(this.getKey(session.userPhone), JSON.stringify(session), 'EX', this.SESSION_TTL_SECONDS);
      }
    } catch {
      // Fallback em memória
    }
  }

  public async getSession(userPhone: string, checkExpiration: boolean = true): Promise<ActiveInspectionSession | null> {
    let session: ActiveInspectionSession | null = null;
    try {
      if (redis.status === 'ready') {
        const data = await redis.get(this.getKey(userPhone));
        if (data) session = JSON.parse(data) as ActiveInspectionSession;
      }
    } catch {
      // Ignora erro e usa fallback em memória
    }

    if (!session) {
      session = this.inMemoryStore.get(userPhone) || null;
    }

    if (session && checkExpiration) {
      const lastActivity = new Date(session.updatedAt || session.startedAt).getTime();
      if (Date.now() - lastActivity > this.SESSION_TTL_SECONDS * 1000) {
        console.log(`[InspectionService] Sessão expirada por inatividade (1h) para: ${userPhone}`);
        await this.removeSession(userPhone);
        return null;
      }
    }

    return session;
  }

  public async createSession(userPhone: string, rawPlate: string, officeTemplate?: string): Promise<ActiveInspectionSession> {
    const plate = rawPlate.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    const session: ActiveInspectionSession = {
      plate,
      userPhone,
      officeTemplate: officeTemplate ? officeTemplate.toLowerCase().trim() : undefined,
      status: 'EM_ANDAMENTO',
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      transcriptions: [],
      images: [],
    };

    await this.saveSession(session);
    return session;
  }

  public async addTranscription(userPhone: string, text: string): Promise<ActiveInspectionSession | null> {
    const session = await this.getSession(userPhone);
    if (!session) return null;

    session.transcriptions.push(text);
    await this.saveSession(session);
    return session;
  }

  public async addImage(userPhone: string, imagePath: string): Promise<ActiveInspectionSession | null> {
    const session = await this.getSession(userPhone);
    if (!session) return null;

    session.images.push(imagePath);
    await this.saveSession(session);
    return session;
  }

  public async updateDraftData(
    userPhone: string,
    extractedData: any,
    pdfPath: string
  ): Promise<ActiveInspectionSession | null> {
    const session = await this.getSession(userPhone);
    if (!session) return null;

    session.status = 'AGUARDANDO_APROVACAO';
    session.lastExtractedData = extractedData;
    session.lastPdfPath = pdfPath;
    await this.saveSession(session);
    return session;
  }

  public async removeSession(userPhone: string): Promise<void> {
    const session = await this.getSession(userPhone, false);
    if (session && session.images && session.images.length > 0) {
      console.log(`[InspectionService] Limpando ${session.images.length} foto(s) temporária(s) do disco para: ${userPhone}`);
      for (const imgPath of session.images) {
        if (fs.existsSync(imgPath)) {
          await fs.promises.unlink(imgPath).catch(() => {});
        }
      }
    }

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
