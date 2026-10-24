import type { ProbeJob, ProbeQueue } from '@keelson/application';
import type { google } from '@google-cloud/tasks/build/protos';

export type CreateTaskRequest = google.cloud.tasks.v2.ICreateTaskRequest;

// The one client operation the queue needs, so a test double does not have to implement the whole generated client.
export interface CloudTasksCreateTask {
  createTask(request: CreateTaskRequest): Promise<unknown>;
}

export interface CloudTasksProbeQueueConfig {
  tasksClient: CloudTasksCreateTask;
  queuePath: string;
  workerUrl: string;
  invokerEmail: string;
}

const GRPC_ALREADY_EXISTS = 6;

function isAlreadyExists(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === GRPC_ALREADY_EXISTS;
}

export class CloudTasksProbeQueue implements ProbeQueue {
  private readonly config: CloudTasksProbeQueueConfig;

  constructor(config: CloudTasksProbeQueueConfig) {
    this.config = config;
  }

  // The task name is derived from the job, so a second fan-out for the same slot is rejected by Cloud Tasks itself.
  async enqueue(job: ProbeJob): Promise<void> {
    const { tasksClient, queuePath, workerUrl, invokerEmail } = this.config;
    try {
      await tasksClient.createTask({
        parent: queuePath,
        task: {
          name: `${queuePath}/tasks/probe-${job.monitorId}-${String(job.slot)}`,
          httpRequest: {
            httpMethod: 'POST',
            url: `${workerUrl}/internal/probe`,
            headers: { 'Content-Type': 'application/json' },
            // A string would be read as base64 by the protobuf encoder, so the body goes in as bytes.
            body: Buffer.from(JSON.stringify({ monitorId: job.monitorId, slot: job.slot })),
            oidcToken: { serviceAccountEmail: invokerEmail, audience: workerUrl },
          },
        },
      });
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;
    }
  }
}
