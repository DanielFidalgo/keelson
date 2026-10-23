import type { Alert } from '@keelson/domain';
import type { Outbox, OutboxMessage } from '@keelson/application';
import type { Queryable, RepositoryDeps } from './queryable.js';

// The alert is stored as JSON, which turns its Date into a string.
type StoredAlert = Omit<Alert, 'occurredAt'> & { occurredAt: string };

interface OutboxRow {
  id: string;
  incident_id: string;
  endpoint_id: string;
  payload: StoredAlert;
  idempotency_key: string;
  attempts: number;
  next_attempt_at: Date;
  sent_at: Date | null;
}

function toOutboxMessage(row: OutboxRow): OutboxMessage {
  return {
    id: row.id,
    incidentId: row.incident_id,
    endpointId: row.endpoint_id,
    alert: { ...row.payload, occurredAt: new Date(row.payload.occurredAt) },
    idempotencyKey: row.idempotency_key,
    attempts: row.attempts,
    nextAttemptAt: row.next_attempt_at,
    sentAt: row.sent_at,
  };
}

export class PostgresOutbox implements Outbox {
  private readonly db: Queryable;

  constructor({ db }: RepositoryDeps) {
    this.db = db;
  }

  async enqueue(messages: OutboxMessage[]): Promise<void> {
    for (const message of messages) {
      await this.db.query(
        `insert into outbox (id, incident_id, endpoint_id, payload, idempotency_key, attempts, next_attempt_at, sent_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          message.id,
          message.incidentId,
          message.endpointId,
          JSON.stringify(message.alert),
          message.idempotencyKey,
          message.attempts,
          message.nextAttemptAt,
          message.sentAt,
        ],
      );
    }
  }

  // Pushing next_attempt_at to the lease hides the claimed rows from other drainers until the lease lapses, and
  // skip locked keeps two concurrent claims from queueing behind each other. A disabled endpoint's messages are
  // not claimed, so they wait until it is re-enabled.
  async claimDue(now: Date, leaseUntil: Date, limit: number): Promise<OutboxMessage[]> {
    const { rows } = await this.db.query<OutboxRow>(
      `update outbox set next_attempt_at = $2
       where id in (
         select o.id
         from outbox o
         join webhook_endpoints e on e.id = o.endpoint_id
         where o.sent_at is null and o.next_attempt_at <= $1 and e.status = 'active'
         order by o.next_attempt_at, o.id
         limit $3
         for update of o skip locked
       )
       returning *`,
      [now, leaseUntil, limit],
    );
    return rows.map(toOutboxMessage);
  }

  markSent(id: string, now: Date): Promise<void> {
    return this.update(id, 'sent_at = $2', now);
  }

  markFailed(id: string, attempts: number, nextAttemptAt: Date): Promise<void> {
    return this.update(id, 'attempts = $2, next_attempt_at = $3', attempts, nextAttemptAt);
  }

  private async update(id: string, assignments: string, ...values: unknown[]): Promise<void> {
    const result = await this.db.query(`update outbox set ${assignments} where id = $1`, [id, ...values]);
    if (result.rowCount === 0) throw new Error(`unknown outbox message: ${id}`);
  }
}
