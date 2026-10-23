import type { ProbeJob, ProbeQueue } from '@keelson/application';
import type { InternalCaller } from '../internal-auth/internal-caller.js';

export interface HttpProbeQueueConfig {
  workerUrl: string;
  caller: InternalCaller;
}

const ENQUEUE_TIMEOUT_MS = 10_000;

// Local and e2e stand-in for Cloud Tasks. It has no task names to dedupe on; the worker's probe insert is the backstop.
export class HttpProbeQueue implements ProbeQueue {
  private readonly config: HttpProbeQueueConfig;

  constructor(config: HttpProbeQueueConfig) {
    this.config = config;
  }

  async enqueue(job: ProbeJob): Promise<void> {
    const { workerUrl, caller } = this.config;
    const response = await fetch(`${workerUrl}/internal/probe`, {
      method: 'POST',
      headers: { authorization: await caller.authorizationFor(workerUrl), 'content-type': 'application/json' },
      body: JSON.stringify({ monitorId: job.monitorId, slot: job.slot }),
      signal: AbortSignal.timeout(ENQUEUE_TIMEOUT_MS),
    });
    await response.body?.cancel();
    if (!response.ok) throw new Error(`worker probe enqueue failed with HTTP ${String(response.status)}`);
  }
}
