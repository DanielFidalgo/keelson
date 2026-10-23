import type { FastifyInstance } from 'fastify';

export function registerDrainRoute(server: FastifyInstance): void {
  server.post('/internal/outbox/drain', () => server.diContainer.cradle.drainOutbox.execute());
}
