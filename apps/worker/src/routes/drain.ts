import type { DeliveryFailure } from '@keelson/application';
import type { FastifyBaseLogger, FastifyInstance } from 'fastify';

// Only identifiers and the channel's short reason are logged: never the endpoint url (its query string can carry a
// secret), the signing secret or the alert payload.
function logDeliveryFailure(log: FastifyBaseLogger, { endpointDisabled, ...failure }: DeliveryFailure): void {
  const fields = { event: 'webhook.delivery_failed', ...failure };
  if (endpointDisabled) log.error({ ...fields, endpointDisabled }, 'webhook delivery failed and the endpoint was disabled');
  else log.warn(fields, 'webhook delivery failed');
}

export function registerDrainRoute(server: FastifyInstance): void {
  server.post('/internal/outbox/drain', async (request) => {
    const { sent, failed, failures } = await request.server.diContainer.cradle.drainOutbox.execute();
    for (const failure of failures) logDeliveryFailure(request.log, failure);
    return { sent, failed };
  });
}
