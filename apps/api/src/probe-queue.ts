import { CloudTasksClient } from '@google-cloud/tasks';
import type { ProbeJob, ProbeQueue } from '@keelson/application';
import { CloudTasksProbeQueue, HttpProbeQueue, type InternalCaller } from '@keelson/infrastructure';
import type { ProbeQueueConfig } from './config.js';

export interface ManagedProbeQueue {
  queue: ProbeQueue;
  // The Cloud Tasks client holds a gRPC channel that has to be closed for the process to exit; the HTTP queue holds nothing.
  close: () => Promise<void>;
}

interface ProbeQueueTarget {
  config: ProbeQueueConfig;
  workerUrl: string;
  caller: InternalCaller;
  // Only the local HTTP queue reports here: Cloud Tasks owns delivery and retries of its own jobs.
  onDeliveryError: (error: unknown, job: ProbeJob) => void;
}

export function createProbeQueue({ config, workerUrl, caller, onDeliveryError }: ProbeQueueTarget): ManagedProbeQueue {
  if (config.kind === 'http') return { queue: new HttpProbeQueue({ workerUrl, caller, onDeliveryError }), close: () => Promise.resolve() };
  const tasksClient = new CloudTasksClient();
  return {
    queue: new CloudTasksProbeQueue({ tasksClient, queuePath: config.queuePath, workerUrl, invokerEmail: config.invokerEmail }),
    close: () => tasksClient.close(),
  };
}
