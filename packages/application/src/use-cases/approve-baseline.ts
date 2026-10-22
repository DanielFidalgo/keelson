import { approveBaseline, type Monitor, type SnapshotHash } from '@keelson/domain';
import { NotFoundError } from '../errors.js';
import { requireOwned } from '../ownership.js';
import type { Clock, IdGenerator, UnitOfWork } from '../ports.js';
import { resolveAndAlert } from './apply-assessment.js';

export interface ApproveBaselineDeps {
  unitOfWork: UnitOfWork;
  clock: Clock;
  ids: IdGenerator;
}

export interface ApproveBaselineInput {
  tenantId: string;
  monitorId: string;
  snapshotHash: SnapshotHash;
}

export class ApproveBaseline {
  constructor(private readonly deps: ApproveBaselineDeps) {}

  execute({ tenantId, monitorId, snapshotHash }: ApproveBaselineInput): Promise<Monitor> {
    return this.deps.unitOfWork.run(async (tx) => {
      const monitor = requireOwned(await tx.monitors.lockForUpdate(monitorId), tenantId, 'monitor');
      // Only a snapshot this monitor was actually seen serving can become its baseline.
      if (!(await tx.probes.monitorHasSnapshot(monitorId, snapshotHash))) throw new NotFoundError('snapshot not found');

      const openDrift = await tx.incidents.findOpen(monitorId, 'drift');
      if (openDrift !== null) await resolveAndAlert({ ...this.deps, tx, monitor }, openDrift, 'approved');

      const approved = approveBaseline(monitor, snapshotHash);
      await tx.monitors.save(approved);
      return approved;
    });
  }
}
