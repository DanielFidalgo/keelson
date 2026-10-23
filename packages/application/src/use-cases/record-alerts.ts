import type { Alert, AlertType, Drift, Incident, Monitor } from '@keelson/domain';
import type { Clock, IdGenerator, OutboxMessage, Transaction } from '../ports.js';

const FIRST_ATTEMPT = 0;

export interface AlertSubject {
  monitor: Monitor;
  incident: Incident;
  type: AlertType;
  drift: Drift | null;
}

export async function recordAlerts(
  tx: Transaction,
  subject: AlertSubject,
  deps: { ids: IdGenerator; clock: Clock },
): Promise<void> {
  const endpoints = await tx.webhookEndpoints.listActive(subject.monitor.tenantId);
  const now = deps.clock.now();
  const alert = toAlert(subject, now);
  const messages = endpoints.map(
    (endpoint): OutboxMessage => ({
      id: deps.ids.next(),
      incidentId: subject.incident.id,
      endpointId: endpoint.id,
      alert,
      idempotencyKey: `msg_${deps.ids.next()}`,
      attempts: FIRST_ATTEMPT,
      nextAttemptAt: now,
      sentAt: null,
      lastError: null,
    }),
  );
  await tx.outbox.enqueue(messages);
}

function toAlert({ monitor, incident, type, drift }: AlertSubject, occurredAt: Date): Alert {
  return {
    type,
    incidentId: incident.id,
    monitorId: monitor.id,
    monitorName: monitor.name,
    kind: incident.kind,
    severity: drift?.maxSeverity ?? null,
    changes: drift?.changes ?? [],
    resolution: incident.resolution,
    occurredAt,
  };
}
