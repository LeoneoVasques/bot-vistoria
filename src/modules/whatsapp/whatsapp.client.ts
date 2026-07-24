import makeWASocket, { useMultiFileAuthState, DisconnectReason, Browsers } from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import qrcode from 'qrcode-terminal';
import pino from 'pino';
import { handleIncomingMessage } from './whatsapp.router';
import { initQueues } from '../queue/inspection.queue';

export class WhatsAppService {
  private sock: ReturnType<typeof makeWASocket> | null = null;
  private isReady: boolean = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private watchdogTimer: NodeJS.Timeout | null = null;

  public async initialize(): Promise<void> {
    console.log('🔄 Inicializando cliente do WhatsApp (Baileys)...');

    // Inicializa filas de segundo plano do BullMQ
    initQueues(() => this.sock);
    
    const { state, saveCreds } = await useMultiFileAuthState('./.baileys_auth');

    this.sock = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      logger: pino({ level: 'silent' }) as any,
      browser: Browsers.macOS('Desktop'),
      syncFullHistory: false,
      connectTimeoutMs: 60000,
      keepAliveIntervalMs: 25000,
    });

    this.sock.ev.on('creds.update', saveCreds);

    this.sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        console.log('\n======================================================');
        console.log('📱 ESCANEIE O QR CODE ABAIXO PARA CONECTAR AO WHATSAPP');
        console.log('======================================================\n');
        qrcode.generate(qr, { small: true });
      }

      if (connection === 'close') {
        const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
        this.isReady = false;
        
        console.warn(`[WhatsAppClient] Conexão fechada. Motivo: ${lastDisconnect?.error || statusCode}. Reconectar: ${shouldReconnect}`);
        
        if (shouldReconnect) {
          this.scheduleReconnect();
        } else {
          console.log('[WhatsAppClient] Deslogado. Apague a pasta .baileys_auth e reinicie para escanear novo QR Code.');
        }
      } else if (connection === 'open') {
        this.isReady = true;
        console.log('\n======================================================');
        console.log('🚀 VistoriaBot WhatsApp Client TOTALMENTE PRONTO E WATCHDOG ATIVO!');
        console.log('======================================================\n');
        this.startWatchdog();
      }
    });

    this.sock.ev.on('messages.upsert', async (m) => {
      if (m.type === 'notify') {
        for (const msg of m.messages) {
          try {
            await handleIncomingMessage(msg, this.sock!);
          } catch (err) {
            console.error(`❌ Erro crítico ao processar mensagem via router:`, err);
          }
        }
      }
    });
  }

  private scheduleReconnect(delayMs: number = 5000) {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      console.log('🔄 Tentando reconectar o cliente WhatsApp...');
      this.initialize().catch((err) => {
        console.error('[WhatsAppClient] Falha ao tentar reconectar:', err);
      });
    }, delayMs);
  }

  private startWatchdog() {
    if (this.watchdogTimer) clearInterval(this.watchdogTimer);
    // Monitor de saúde a cada 45 segundos
    this.watchdogTimer = setInterval(() => {
      if (!this.isReady && this.sock) {
        console.warn('⚠️ [Watchdog] Detectado socket em estado inconsistente. Forçando reconexão...');
        this.scheduleReconnect(1000);
      }
    }, 45000);
  }

  public getClient() {
    return this.sock;
  }

  public getIsReady(): boolean {
    return this.isReady;
  }

  public async destroy(): Promise<void> {
    this.isReady = false;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.watchdogTimer) clearInterval(this.watchdogTimer);
    this.sock?.logout();
  }
}

export const whatsappService = new WhatsAppService();
