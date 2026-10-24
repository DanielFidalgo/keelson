import type { Incident } from '@keelson/domain';
import { NotFoundError } from './errors.js';
import type { Transaction } from '../ports/index.js';

// A foreign tenant's entity is reported as missing so its existence is never revealed.
export function requireOwned<T extends { tenantId: string }>(entity: T | null, tenantId: string, label: string): T {
  if (entity === null || entity.tenantId !== tenantId) throw new NotFoundError(`${label} not found`);
  return entity;
}

// Incidents carry only a monitor id, so ownership is decided by the monitor they belong to.
export async function requireOwnedIncident(tx: Transaction, tenantId: string, incidentId: string): Promise<Incident> {
  const incident = await tx.incidents.get(incidentId);
  if (incident === null) throw new NotFoundError('incident not found');
  const monitor = await tx.monitors.get(incident.monitorId);
  requireOwned(monitor, tenantId, 'incident');
  return incident;
}
