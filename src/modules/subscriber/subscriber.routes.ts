import { FastifyInstance } from 'fastify';
import { subscriberService } from './subscriber.service';
import { prisma } from '../../config/prisma';

export async function subscriberRoutes(app: FastifyInstance) {
  // 1. Cadastrar / Ativar um Localizador Assinante
  app.post('/api/subscribers', async (request, reply) => {
    const body = request.body as {
      name: string;
      phone: string;
      plan?: string;
      maxInspectionsPerMonth?: number;
      daysValid?: number;
    };

    if (!body || !body.name || !body.phone) {
      return reply.status(400).send({
        error: 'Campos nome e telefone são obrigatórios.',
      });
    }

    const days = body.daysValid || 30;
    const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

    try {
      const subscriber = await subscriberService.registerSubscriber({
        name: body.name,
        phone: body.phone,
        plan: body.plan,
        maxInspectionsPerMonth: body.maxInspectionsPerMonth,
        expiresAt,
      });

      return reply.send({
        success: true,
        message: `Localizador ${subscriber.name} ativado com sucesso até ${expiresAt.toLocaleDateString('pt-BR')}`,
        subscriber,
      });
    } catch (err: any) {
      return reply.status(500).send({
        error: 'Erro ao cadastrar assinante.',
        details: err?.message,
      });
    }
  });

  // 2. Listar todos os Assinantes
  app.get('/api/subscribers', async (request, reply) => {
    try {
      const subscribers = await prisma.subscriber.findMany({
        orderBy: { createdAt: 'desc' },
      });
      return reply.send({ subscribers });
    } catch (err: any) {
      return reply.status(500).send({ error: 'Erro ao buscar assinantes.' });
    }
  });

  // 3. Consultar Status de um Telefone Específico
  app.get('/api/subscribers/:phone', async (request, reply) => {
    const { phone } = request.params as { phone: string };
    const access = await subscriberService.checkAccess(phone);
    return reply.send(access);
  });
}
