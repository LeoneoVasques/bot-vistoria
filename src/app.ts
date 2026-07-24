import fastify from 'fastify';
import cors from '@fastify/cors';
import { whatsappService } from './modules/whatsapp/whatsapp.client';
import { subscriberRoutes } from './modules/subscriber/subscriber.routes';
import { webRoutes } from './modules/web/web.routes';

export function buildApp() {
  const app = fastify({
    logger: true,
  });

  app.register(cors, {
    origin: '*',
  });

  app.register(subscriberRoutes);
  app.register(webRoutes);

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
