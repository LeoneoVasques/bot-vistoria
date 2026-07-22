import makeWASocket, { useMultiFileAuthState, DisconnectReason, Browsers } from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import qrcode from 'qrcode-terminal';
import pino from 'pino';
import { handleIncomingMessage } from './whatsapp.router';

export class WhatsAppService {
  private sock: ReturnType<typeof makeWASocket> | null = null;
  private isReady: boolean = false;

  public async initialize(): Promise<void> {
    console.log('🔄 Inicializando cliente do WhatsApp (Baileys)...');
    
    const { state, saveCreds } = await useMultiFileAuthState('./.baileys_auth');

    this.sock = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      logger: pino({ level: 'silent' }) as any,
      browser: Browsers.macOS('Desktop'),
      syncFullHistory: false
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
        const shouldReconnect = (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
        this.isReady = false;
        
        console.log(`[WhatsAppClient] Conexão fechada. Motivo: ${lastDisconnect?.error}. Reconectar: ${shouldReconnect}`);
        
        if (shouldReconnect) {
          this.initialize(); // Reconecta
        } else {
          console.log('[WhatsAppClient] Deslogado. Apague a pasta .baileys_auth e reinicie para escanear novo QR Code.');
        }
      } else if (connection === 'open') {
        this.isReady = true;
        console.log('\n======================================================');
        console.log('🚀 VistoriaBot WhatsApp Client TOTALMENTE PRONTO (Baileys)!');
        console.log('======================================================\n');
      }
    });

    this.sock.ev.on('messages.upsert', async (m) => {
      if (m.type === 'notify') {
        for (const msg of m.messages) {
          try {
            await handleIncomingMessage(msg, this.sock!);
          } catch (err) {
            console.error(`❌ Erro ao processar mensagem via router:`, err);
          }
        }
      }
    });
  }

  public getClient() {
    return this.sock;
  }

  public getIsReady(): boolean {
    return this.isReady;
  }

  public async destroy(): Promise<void> {
    this.isReady = false;
    this.sock?.logout();
  }
}

export const whatsappService = new WhatsAppService();
