import {
  nextDeliveryAttemptAt,
  recordDeliveryFailure,
  recordDeliverySuccess,
  type WebhookEndpoint,
  type WebhookFormat,
} from '@keelson/domain';
import type {
  AlertChannel,
  Clock,
  DeliveryResult,
  OutboxMessage,
  SecretStore,
  Transaction,
  UnitOfWork,
} from '../ports.js';

export const DRAIN_BATCH_LIMIT = 100;

const LEASE_MINUTES = 5;
const MILLISECONDS_PER_MINUTE = 60_000;

export interface DrainOutboxDeps {
  unitOfWork: UnitOfWork;
  secrets: SecretStore;
  channels: Record<WebhookFormat, AlertChannel>;
  clock: Clock;
}

export class DrainOutbox {
  constructor(private readonly deps: DrainOutboxDeps) {}

  async execute(): Promise<{ sent: number; failed: number }> {
    const now = this.deps.clock.now();
    const leaseUntil = new Date(now.getTime() + LEASE_MINUTES * MILLISECONDS_PER_MINUTE);
    const claimed = await this.deps.unitOfWork.run((tx) => tx.outbox.claimDue(now, leaseUntil, DRAIN_BATCH_LIMIT));

    let sent = 0;
    let failed = 0;
    for (const message of claimed) {
      const result = await this.deliver(message);
      if (result === 'sent') sent += 1;
      if (result === 'failed') failed += 1;
    }
    return { sent, failed };
  }

  private async deliver(message: OutboxMessage): Promise<'sent' | 'failed' | 'skipped'> {
    const endpoint = await this.deps.unitOfWork.run((tx) => tx.webhookEndpoints.get(message.endpointId));
    // An earlier failure in this same batch may have disabled the endpoint; the lease expires and the
    // message is claimed again only once the endpoint is re-enabled.
    if (endpoint === null || endpoint.status !== 'active') return 'skipped';

    const result = await this.attempt(message, endpoint);
    if (result.delivered) {
      await this.recordSuccess(message);
      return 'sent';
    }
    await this.recordFailure(message);
    return 'failed';
  }

  // The network call runs outside any transaction; a thrown error is just another failed delivery.
  private async attempt(message: OutboxMessage, endpoint: WebhookEndpoint): Promise<DeliveryResult> {
    try {
      const signingSecret = endpoint.secretRef === null ? null : await this.deps.secrets.read(endpoint.secretRef);
      return await this.deps.channels[endpoint.format].deliver({
        url: endpoint.url,
        signingSecret,
        alert: message.alert,
        messageId: message.idempotencyKey,
        timestamp: this.deps.clock.now(),
      });
    } catch (error) {
      return { delivered: false, reason: error instanceof Error ? error.message : String(error) };
    }
  }

  private recordSuccess(message: OutboxMessage): Promise<void> {
    return this.deps.unitOfWork.run(async (tx) => {
      await tx.outbox.markSent(message.id, this.deps.clock.now());
      await this.updateEndpoint(tx, message.endpointId, recordDeliverySuccess);
    });
  }

  private recordFailure(message: OutboxMessage): Promise<void> {
    return this.deps.unitOfWork.run(async (tx) => {
      const attempts = message.attempts + 1;
      await tx.outbox.markFailed(message.id, attempts, nextDeliveryAttemptAt(attempts, this.deps.clock.now()));
      await this.updateEndpoint(tx, message.endpointId, recordDeliveryFailure);
    });
  }

  // Re-read inside the transaction so a concurrent change to the endpoint is not overwritten with a stale copy.
  private async updateEndpoint(
    tx: Transaction,
    endpointId: string,
    transition: (endpoint: WebhookEndpoint) => WebhookEndpoint,
  ): Promise<void> {
    const endpoint = await tx.webhookEndpoints.get(endpointId);
    if (endpoint !== null) await tx.webhookEndpoints.save(transition(endpoint));
  }
}
