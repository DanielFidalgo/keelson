import { updateWebhookEndpoint, type WebhookEndpoint, type WebhookEndpointChanges } from '@keelson/domain';
import { requireOwned } from '../ownership.js';
import type { UnitOfWork } from '../ports.js';

export interface UpdateWebhookEndpointDeps {
  unitOfWork: UnitOfWork;
}

export type UpdateWebhookEndpointInput = WebhookEndpointChanges & { tenantId: string; endpointId: string };

export class UpdateWebhookEndpoint {
  constructor(private readonly deps: UpdateWebhookEndpointDeps) {}

  execute({ tenantId, endpointId, ...changes }: UpdateWebhookEndpointInput): Promise<WebhookEndpoint> {
    return this.deps.unitOfWork.run(async (tx) => {
      const current = requireOwned(await tx.webhookEndpoints.get(endpointId), tenantId, 'webhook endpoint');
      const updated = updateWebhookEndpoint(current, changes);
      await tx.webhookEndpoints.save(updated);
      return updated;
    });
  }
}
