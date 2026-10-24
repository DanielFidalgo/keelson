import { newWebhookEndpoint, type WebhookEndpoint, type WebhookFormat } from '@keelson/domain';
import type { Clock, CredentialFactory, IdGenerator, SecretStore, UnitOfWork } from '../ports/index.js';

export interface RegisterWebhookEndpointDeps {
  unitOfWork: UnitOfWork;
  secrets: SecretStore;
  credentials: CredentialFactory;
  clock: Clock;
  ids: IdGenerator;
}

export interface RegisterWebhookEndpointInput {
  tenantId: string;
  url: string;
  format: WebhookFormat;
}

export interface RegisteredWebhookEndpoint {
  endpoint: WebhookEndpoint;
  // Returned only here: afterwards the secret is readable by the delivery worker alone.
  signingSecret: string | null;
}

export class RegisterWebhookEndpoint {
  constructor(private readonly deps: RegisterWebhookEndpointDeps) {}

  async execute({ tenantId, url, format }: RegisterWebhookEndpointInput): Promise<RegisteredWebhookEndpoint> {
    const id = this.deps.ids.next();
    const signingSecret = format === 'standard' ? this.deps.credentials.signingSecret() : null;
    const secretRef = signingSecret === null ? null : await this.deps.secrets.create(`webhook-${id}-signing`, signingSecret);
    try {
      const endpoint = newWebhookEndpoint({ id, tenantId, url, format, secretRef }, this.deps.clock.now());
      await this.deps.unitOfWork.run((tx) => tx.webhookEndpoints.save(endpoint));
      return { endpoint, signingSecret };
    } catch (error) {
      // The secret is created first because the endpoint cannot be built without its reference.
      if (secretRef !== null) await this.deps.secrets.destroy(secretRef);
      throw error;
    }
  }
}
