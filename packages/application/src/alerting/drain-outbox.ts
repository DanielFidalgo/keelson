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
} from '../ports/index.js';

export const DRAIN_BATCH_LIMIT = 100;

// Receivers and thrown errors choose their own wording; the stored and logged text must stay bounded.
export const MAX_FAILURE_REASON_LENGTH = 500;

const LEASE_MINUTES = 5;
const MILLISECONDS_PER_MINUTE = 60_000;

export interface DrainOutboxDeps {
  unitOfWork: UnitOfWork;
  secrets: SecretStore;
  channels: Record<WebhookFormat, AlertChannel>;
  clock: Clock;
}

export interface DeliveryFailure {
  // The id the receiver sees on the delivery, so a log line can be matched with the receiver's own records.
  messageId: string;
  incidentId: string;
  endpointId: string;
  attempts: number;
  reason: string;
  endpointDisabled: boolean;
}

export interface DrainReport {
  sent: number;
  failed: number;
  failures: DeliveryFailure[];
}

type DeliveryOutcome = { type: 'sent' } | { type: 'skipped' } | { type: 'failed'; failure: DeliveryFailure };

export class DrainOutbox {
  constructor(private readonly deps: DrainOutboxDeps) {}

  async execute(): Promise<DrainReport> {
    const now = this.deps.clock.now();
    const leaseUntil = new Date(now.getTime() + LEASE_MINUTES * MILLISECONDS_PER_MINUTE);
    const claimed = await this.deps.unitOfWork.run((tx) => tx.outbox.claimDue(now, leaseUntil, DRAIN_BATCH_LIMIT));

    let sent = 0;
    const failures: DeliveryFailure[] = [];
    for (const message of claimed) {
      const outcome = await this.deliver(message);
      if (outcome.type === 'sent') sent += 1;
      if (outcome.type === 'failed') failures.push(outcome.failure);
    }
    return { sent, failed: failures.length, failures };
  }

  private async deliver(message: OutboxMessage): Promise<DeliveryOutcome> {
    const endpoint = await this.deps.unitOfWork.run((tx) => tx.webhookEndpoints.get(message.endpointId));
    // An earlier failure in this same batch may have disabled the endpoint; the lease expires and the
    // message is claimed again only once the endpoint is re-enabled.
    if (endpoint === null || endpoint.status !== 'active') return { type: 'skipped' };

    const result = await this.attempt(message, endpoint);
    if (result.delivered) {
      await this.recordSuccess(message);
      return { type: 'sent' };
    }
    const reason = result.reason.slice(0, MAX_FAILURE_REASON_LENGTH);
    const endpointDisabled = await this.recordFailure(message, reason);
    return { type: 'failed', failure: describeFailure(message, reason, endpointDisabled) };
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

  // Returns whether this failure was the one that disabled the endpoint.
  private recordFailure(message: OutboxMessage, reason: string): Promise<boolean> {
    return this.deps.unitOfWork.run(async (tx) => {
      const attempts = message.attempts + 1;
      await tx.outbox.markFailed(message.id, {
        attempts,
        nextAttemptAt: nextDeliveryAttemptAt(attempts, this.deps.clock.now()),
        lastError: reason,
      });
      const updated = await this.updateEndpoint(tx, message.endpointId, recordDeliveryFailure);
      return updated?.status === 'disabled';
    });
  }

  // Re-read inside the transaction so a concurrent change to the endpoint is not overwritten with a stale copy.
  private async updateEndpoint(
    tx: Transaction,
    endpointId: string,
    transition: (endpoint: WebhookEndpoint) => WebhookEndpoint,
  ): Promise<WebhookEndpoint | null> {
    const endpoint = await tx.webhookEndpoints.get(endpointId);
    if (endpoint === null) return null;
    const updated = transition(endpoint);
    await tx.webhookEndpoints.save(updated);
    return updated;
  }
}

function describeFailure(message: OutboxMessage, reason: string, endpointDisabled: boolean): DeliveryFailure {
  return {
    messageId: message.idempotencyKey,
    incidentId: message.incidentId,
    endpointId: message.endpointId,
    attempts: message.attempts + 1,
    reason,
    endpointDisabled,
  };
}
