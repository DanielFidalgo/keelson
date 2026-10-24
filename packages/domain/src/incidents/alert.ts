import type { Change, Severity } from '../drift/drift.js';
import type { IncidentKind, Resolution } from './incident.js';

export type AlertType = 'incident.opened' | 'incident.escalated' | 'incident.resolved';

export interface Alert {
  readonly type: AlertType;
  readonly incidentId: string;
  readonly monitorId: string;
  readonly monitorName: string;
  readonly kind: IncidentKind;
  readonly severity: Severity | null;
  readonly changes: readonly Change[];
  readonly resolution: Resolution | null;
  readonly occurredAt: Date;
}
