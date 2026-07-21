import { buildApp } from './app';
import { env } from './config/env';
import { whatsappService } from './modules/whatsapp/whatsapp.client';

async function start() {
  const app = buildApp();

  try {
    // Inicializa o servidor Fastify
    await app.listen({ port: env.PORT, host: env.HOST });
    console.log(`🌐 Servidor HTTP rodando em http://${env.HOST}:${env.PORT}`);

    // Inicializa o cliente WhatsApp
    await whatsappService.initialize();
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

start();
