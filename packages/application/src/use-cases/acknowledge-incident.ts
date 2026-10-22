import { acknowledgeIncident, type Incident } from '@keelson/domain';
import { requireOwnedIncident } from '../ownership.js';
import type { Clock, UnitOfWork } from '../ports.js';

export interface AcknowledgeIncidentDeps {
  unitOfWork: UnitOfWork;
  clock: Clock;
}

export class AcknowledgeIncident {
  constructor(private readonly deps: AcknowledgeIncidentDeps) {}

  execute({ tenantId, incidentId }: { tenantId: string; incidentId: string }): Promise<Incident> {
    return this.deps.unitOfWork.run(async (tx) => {
      const incident = await requireOwnedIncident(tx, tenantId, incidentId);
      const acknowledged = acknowledgeIncident(incident, this.deps.clock.now());
      await tx.incidents.save(acknowledged);
      return acknowledged;
    });
  }
}
