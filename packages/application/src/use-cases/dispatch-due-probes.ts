import { advanceSchedule } from '@keelson/domain';
import type { Clock, ProbeQueue, UnitOfWork } from '../ports.js';

export const DISPATCH_BATCH_LIMIT = 500;

export interface DispatchDueProbesDeps {
  unitOfWork: UnitOfWork;
  queue: ProbeQueue;
  clock: Clock;
}

export class DispatchDueProbes {
  constructor(private readonly deps: DispatchDueProbesDeps) {}

  async execute(): Promise<{ dispatched: number }> {
    const now = this.deps.clock.now();
    return this.deps.unitOfWork.run(async (tx) => {
      const due = await tx.monitors.claimDue(now, DISPATCH_BATCH_LIMIT);
      for (const monitor of due) {
        const { monitor: advanced, slot } = advanceSchedule(monitor, now);
        await tx.monitors.save(advanced);
        // Enqueued before the commit: if the commit fails the monitor stays due and the next dispatch enqueues the same
        // (monitorId, slot) again, so the worst case is a repeated job. Cloud Tasks drops the repeat by task name; the
        // local HTTP queue lets it through, so the target may be probed twice, but the probe insert records only one. The local queue
        // also accepts without waiting, so a failed delivery there does not roll this dispatch back.
        await this.deps.queue.enqueue({ monitorId: monitor.id, slot });
      }
      return { dispatched: due.length };
    });
  }
}
