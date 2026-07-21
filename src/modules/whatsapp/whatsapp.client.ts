import { Client, LocalAuth } from 'whatsapp-web.js';
import qrcode from 'qrcode-terminal';
import { handleIncomingMessage } from './whatsapp.router';

export class WhatsAppService {
  private client: Client;
  private isReady: boolean = false;

  constructor() {
    this.client = new Client({
      authStrategy: new LocalAuth({ dataPath: './.wwebjs_auth' }),
      puppeteer: {
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--disable-gpu',
        ],
      },
    });

    this.registerEvents();
  }

  private registerEvents(): void {
    // Evento de geração do QR Code no Terminal
    this.client.on('qr', (qr: string) => {
      console.log('\n======================================================');
      console.log('📱 ESCANEIE O QR CODE ABAIXO PARA CONECTAR AO WHATSAPP');
      console.log('======================================================\n');
      qrcode.generate(qr, { small: true });
    });

    // Tela de carregamento do WhatsApp Web
    this.client.on('loading_screen', (percent, message) => {
      console.log(`⏳ Carregando WhatsApp Web: ${percent}% - ${message}`);
    });

    // Evento de autenticação bem sucedida
    this.client.on('authenticated', () => {
      console.log('🔑 WhatsApp Autenticado com sucesso!');
    });

    // Evento de cliente pronto
    this.client.on('ready', () => {
      this.isReady = true;
      console.log('🚀 VistoriaBot WhatsApp Client está PRONTO e operando!');
    });

    // Evento de erro de autenticação
    this.client.on('auth_failure', (msg: string) => {
      console.error('❌ Falha na autenticação do WhatsApp:', msg);
    });

    // Evento de desconexão
    this.client.on('disconnected', (reason: string) => {
      this.isReady = false;
      console.warn('⚠️ WhatsApp Desconectado:', reason);
    });

    // Evento de mensagem recebida de terceiros
    this.client.on('message', async (msg) => {
      try {
        await handleIncomingMessage(msg);
      } catch (err) {
        console.error('❌ Erro ao processar mensagem do WhatsApp:', err);
      }
    });

    // Evento de mensagem criada (permite testes em auto-conversa / "Você")
    this.client.on('message_create', async (msg) => {
      // Processa apenas mensagens enviadas pelo próprio usuário para si mesmo no WhatsApp
      if (msg.fromMe && msg.to === msg.from) {
        try {
          await handleIncomingMessage(msg);
        } catch (err) {
          console.error('❌ Erro ao processar auto-mensagem do WhatsApp:', err);
        }
      }
    });
  }

  public async initialize(): Promise<void> {
    console.log('🔄 Inicializando cliente do WhatsApp...');
    await this.client.initialize();
  }

  public getClient(): Client {
    return this.client;
  }

  public getIsReady(): boolean {
    return this.isReady;
  }
}

export const whatsappService = new WhatsAppService();
