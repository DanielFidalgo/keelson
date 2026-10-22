import type { ProbeJob, ProbeQueue } from '../ports.js';

export class RecordingProbeQueue implements ProbeQueue {
  private readonly jobsByName = new Map<string, ProbeJob>();

  get jobs(): ProbeJob[] {
    return [...this.jobsByName.values()];
  }

  // Cloud Tasks drops a task whose name already exists, so the name is derived from the job identity.
  enqueue(job: ProbeJob): Promise<void> {
    const name = `${job.monitorId}:${String(job.slot)}`;
    if (!this.jobsByName.has(name)) this.jobsByName.set(name, { ...job });
    return Promise.resolve();
  }
}
