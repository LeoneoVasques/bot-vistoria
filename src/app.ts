import fastify from 'fastify';
import cors from '@fastify/cors';
import { whatsappService } from './modules/whatsapp/whatsapp.client';

export function buildApp() {
  const app = fastify({
    logger: true,
  });

  app.register(cors, {
    origin: '*',
  });

  // Rota de Health Check
  app.get('/health', async () => {
    return {
      status: 'ok',
      service: 'VistoriaBot API',
      whatsappReady: whatsappService.getIsReady(),
      timestamp: new Date().toISOString(),
    };
  });

  return app;
}
