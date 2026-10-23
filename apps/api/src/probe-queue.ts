import { CloudTasksClient } from '@google-cloud/tasks';
import type { ProbeQueue } from '@keelson/application';
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
}

export function createProbeQueue({ config, workerUrl, caller }: ProbeQueueTarget): ManagedProbeQueue {
  if (config.kind === 'http') return { queue: new HttpProbeQueue({ workerUrl, caller }), close: () => Promise.resolve() };
  const tasksClient = new CloudTasksClient();
  return {
    queue: new CloudTasksProbeQueue({ tasksClient, queuePath: config.queuePath, workerUrl, invokerEmail: config.invokerEmail }),
    close: () => tasksClient.close(),
  };
}
