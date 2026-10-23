import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

const inspectionTargetSchema = z.object({ url: z.url(), bearerToken: z.string().nullable() });

export function registerInspectRoute(server: FastifyInstance): void {
  server.post('/internal/inspect', async (request, reply) => {
    const target = inspectionTargetSchema.safeParse(request.body);
    if (!target.success) return reply.code(400).send({ error: 'url and bearerToken are required' });

    return request.server.diContainer.cradle.inspector.inspect(target.data);
  });
}
