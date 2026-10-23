import { describe, expect, it } from 'vitest';
import { CloudTasksProbeQueue, type CloudTasksCreateTask, type CreateTaskRequest } from './cloud-tasks-probe-queue.js';

const ALREADY_EXISTS = 6;
const PERMISSION_DENIED = 7;

const config = {
  queuePath: 'projects/keelson-test/locations/europe-west1/queues/probes',
  workerUrl: 'https://worker.example.test',
  invokerEmail: 'invoker@keelson-test.iam.gserviceaccount.com',
};

class RecordingTasksClient implements CloudTasksCreateTask {
  readonly requests: CreateTaskRequest[] = [];

  constructor(private readonly failure: Error | null = null) {}

  createTask(request: CreateTaskRequest): Promise<unknown> {
    this.requests.push(request);
    return this.failure === null ? Promise.resolve([{}]) : Promise.reject(this.failure);
  }
}

const grpcError = (code: number): Error => Object.assign(new Error(`rpc failed with ${String(code)}`), { code });

describe('CloudTasksProbeQueue', () => {
  it('enqueue names the task probe-<monitorId>-<slot> and targets /internal/probe with an OIDC token for the invoker', async () => {
    const client = new RecordingTasksClient();

    await new CloudTasksProbeQueue({ ...config, tasksClient: client }).enqueue({ monitorId: 'mon-1', slot: 42 });

    const [request] = client.requests;
    expect(request?.parent).toBe(config.queuePath);
    expect(request?.task?.name).toBe(`${config.queuePath}/tasks/probe-mon-1-42`);
    const httpRequest = request?.task?.httpRequest;
    expect(httpRequest?.httpMethod).toBe('POST');
    expect(httpRequest?.url).toBe('https://worker.example.test/internal/probe');
    expect(httpRequest?.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(httpRequest?.oidcToken).toEqual({
      serviceAccountEmail: config.invokerEmail,
      audience: config.workerUrl,
    });
    expect(JSON.parse(Buffer.from(httpRequest?.body as Uint8Array).toString('utf8'))).toEqual({
      monitorId: 'mon-1',
      slot: 42,
    });
  });

  it('enqueue treats ALREADY_EXISTS as success', async () => {
    const client = new RecordingTasksClient(grpcError(ALREADY_EXISTS));

    await expect(
      new CloudTasksProbeQueue({ ...config, tasksClient: client }).enqueue({ monitorId: 'mon-1', slot: 42 }),
    ).resolves.toBeUndefined();
  });

  it('enqueue rethrows any other gRPC error', async () => {
    const failure = grpcError(PERMISSION_DENIED);
    const client = new RecordingTasksClient(failure);

    await expect(new CloudTasksProbeQueue({ ...config, tasksClient: client }).enqueue({ monitorId: 'mon-1', slot: 42 })).rejects.toBe(
      failure,
    );
  });

  it('enqueue rethrows an error that carries no gRPC code', async () => {
    const failure = new Error('socket hang up');
    const client = new RecordingTasksClient(failure);

    await expect(new CloudTasksProbeQueue({ ...config, tasksClient: client }).enqueue({ monitorId: 'mon-1', slot: 42 })).rejects.toBe(
      failure,
    );
  });
});
