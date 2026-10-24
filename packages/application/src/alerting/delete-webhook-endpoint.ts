import { requireOwned } from '../shared/ownership.js';
import type { SecretStore, UnitOfWork } from '../ports/index.js';

export interface DeleteWebhookEndpointDeps {
  unitOfWork: UnitOfWork;
  secrets: SecretStore;
}

export class DeleteWebhookEndpoint {
  constructor(private readonly deps: DeleteWebhookEndpointDeps) {}

  async execute({ tenantId, endpointId }: { tenantId: string; endpointId: string }): Promise<void> {
    const secretRef = await this.deps.unitOfWork.run(async (tx) => {
      const endpoint = requireOwned(await tx.webhookEndpoints.get(endpointId), tenantId, 'webhook endpoint');
      await tx.webhookEndpoints.delete(endpoint.id);
      return endpoint.secretRef;
    });
    if (secretRef !== null) await this.deps.secrets.destroy(secretRef);
  }
}
