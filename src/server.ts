import { buildApp } from './app';
import { env } from './config/env';
import { whatsappService } from './modules/whatsapp/whatsapp.client';

async function start() {
  const app = buildApp();

  const shutdown = async (signal: string) => {
    console.log(`\n🛑 Recebido sinal ${signal}. Encerrando servidor e Puppeteer...`);
    await whatsappService.destroy();
    await app.close();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  try {
    // Inicializa o servidor Fastify
    await app.listen({ port: env.PORT, host: env.HOST });
    console.log(`🌐 Servidor HTTP rodando em http://${env.HOST}:${env.PORT}`);

    // Inicializa o cliente WhatsApp
    await whatsappService.initialize();
  } catch (err) {
    app.log.error(err);
    await whatsappService.destroy();
    process.exit(1);
  }
}

start();
