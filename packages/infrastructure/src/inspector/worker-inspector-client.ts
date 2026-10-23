import type { Inspection, InspectionTarget, McpInspector } from '@keelson/application';
import type { InternalCaller } from '../internal-auth/internal-caller.js';

export interface WorkerInspectorClientConfig {
  workerUrl: string;
  caller: InternalCaller;
}

// Covers the worker's own 10 s probe budget plus the hop, so the worker reports a timeout before this call gives up.
const INSPECT_TIMEOUT_MS = 30_000;

// Keelson's own worker, at a configured URL: trusted, so it uses plain fetch. Dialling the monitored server stays in the worker.
export class WorkerInspectorClient implements McpInspector {
  private readonly config: WorkerInspectorClientConfig;

  constructor(config: WorkerInspectorClientConfig) {
    this.config = config;
  }

  async inspect(target: InspectionTarget): Promise<Inspection> {
    const { workerUrl, caller } = this.config;
    const response = await fetch(`${workerUrl}/internal/inspect`, {
      method: 'POST',
      headers: { authorization: await caller.authorizationFor(workerUrl), 'content-type': 'application/json' },
      body: JSON.stringify(target),
      signal: AbortSignal.timeout(INSPECT_TIMEOUT_MS),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`worker inspect failed with HTTP ${String(response.status)}`);
    }
    // The body comes from our own worker, which serialises an Inspection, so it is not re-validated here.
    return (await response.json()) as Inspection;
  }
}
