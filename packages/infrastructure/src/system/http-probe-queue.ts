import type { ProbeJob, ProbeQueue } from '@keelson/application';
import type { InternalCaller } from '../internal-auth/internal-caller.js';

export interface HttpProbeQueueConfig {
  workerUrl: string;
  caller: InternalCaller;
  // Called when a job could not be handed to the worker. Required: with no retry, this report is the only trace of the loss.
  onDeliveryError: (error: unknown, job: ProbeJob) => void | Promise<void>;
}

const DELIVERY_TIMEOUT_MS = 60_000;

// The reporter is the only outlet for a lost job, so when it fails too the loss goes to stdout, where the platform
// collects logs, rather than being swallowed or surfacing as an unhandled rejection.
function writeUnreportedFailure(job: ProbeJob, reportingError: unknown): void {
  const message = reportingError instanceof Error ? reportingError.message : String(reportingError);
  process.stdout.write(
    `${JSON.stringify({ severity: 'ERROR', event: 'probe.enqueue_failure_unreported', monitorId: job.monitorId, slot: job.slot, error: message })}\n`,
  );
}

// Local and e2e stand-in for Cloud Tasks. Like Cloud Tasks it accepts the job and returns at once: the worker's probe
// locks the monitor row that the dispatching transaction still holds, so waiting for the probe would deadlock the dispatch.
// There is no retry and no task name to dedupe on; the worker's probe insert is the backstop against a repeated job.
export class HttpProbeQueue implements ProbeQueue {
  private readonly config: HttpProbeQueueConfig;

  constructor(config: HttpProbeQueueConfig) {
    this.config = config;
  }

  enqueue(job: ProbeJob): Promise<void> {
    const { onDeliveryError } = this.config;
    // A failure has nowhere to go once the dispatch has returned, so it is reported here instead of left as a rejection.
    // Returning the reporter's result keeps an async reporter's rejection inside the chain.
    this.send(job)
      .catch((error: unknown) => onDeliveryError(error, job))
      .catch((reportingError: unknown) => {
        writeUnreportedFailure(job, reportingError);
      });
    return Promise.resolve();
  }

  private async send(job: ProbeJob): Promise<void> {
    const { workerUrl, caller } = this.config;
    const response = await fetch(`${workerUrl}/internal/probe`, {
      method: 'POST',
      headers: { authorization: await caller.authorizationFor(workerUrl), 'content-type': 'application/json' },
      body: JSON.stringify({ monitorId: job.monitorId, slot: job.slot }),
      signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
    });
    await response.body?.cancel();
    if (!response.ok) throw new Error(`worker probe failed with HTTP ${String(response.status)}`);
  }
}
