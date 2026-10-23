import { beforeAll, describe, expect, it } from 'vitest';
// probe.ts relies on a module augmentation that server.ts declares, so tsconfig.json includes that file too.
import { loadApiConfig } from '../apps/api/src/config';
import { PROBE_MAX_ATTEMPTS } from '../apps/worker/src/routes/probe';
import { loadWorkerConfig } from '../apps/worker/src/config';
import { serviceAccountEmail } from './shared-names';
import {
  PROJECT,
  PROJECT_NUMBER,
  REGION,
  memberInputsOf,
  recordProgram,
  resourcesOfType,
  serviceAccountMember,
  type RecordedResource,
} from './test-support';

const ALERT_EMAIL = 'oncall@example.invalid';
const RUN_INVOKER = 'roles/run.invoker';
const API_URL = `https://keelson-api-${PROJECT_NUMBER}.${REGION}.run.app`;
const WORKER_URL = `https://keelson-worker-${PROJECT_NUMBER}.${REGION}.run.app`;

interface EnvEntry {
  name: string;
  value?: string;
  valueSource?: { secretKeyRef: { secret: string; version: string } };
}

interface ServiceInputs {
  name: string;
  template: { serviceAccount: string; containers: { image: string; envs: EnvEntry[] }[] };
}

let recorded: RecordedResource[] = [];
let programOutputs: Record<string, unknown> = {};

function ofType(type: string): RecordedResource[] {
  return resourcesOfType(recorded, type);
}

function serviceNamed(name: string): ServiceInputs {
  const service = ofType('gcp:cloudrunv2/service:Service').find((candidate) => candidate.inputs['name'] === name);
  if (service === undefined) throw new Error(`no Cloud Run service named ${name}`);
  return service.inputs as unknown as ServiceInputs;
}

function environmentOf(serviceName: string): EnvEntry[] {
  const container = serviceNamed(serviceName).template.containers[0];
  if (container === undefined) throw new Error(`${serviceName} has no container`);
  return container.envs;
}

function literalEnvironment(entries: EnvEntry[]): Record<string, string | undefined> {
  return Object.fromEntries(entries.map((entry) => [entry.name, entry.value]));
}

function invokersOf(serviceName: string): string[] {
  return ofType('gcp:cloudrunv2/serviceIamMember:ServiceIamMember')
    .map(memberInputsOf)
    .filter((member) => member.name === serviceName && member.role === RUN_INVOKER)
    .map((member) => member.member);
}

beforeAll(async () => {
  process.env['ALERT_NOTIFICATION_EMAIL'] = ALERT_EMAIL;
  recorded = await recordProgram({ projectName: 'keelson', stackConfig: { 'keelson:imageTag': 'test-tag' } }, async () => {
    programOutputs = await import('./index.js');
  });
});

describe('Keelson infrastructure', () => {
  it('only the tasks, scheduler and api service accounts hold run.invoker on worker; it allows no unauthenticated calls', () => {
    expect(invokersOf('keelson-worker').sort()).toEqual(
      [serviceAccountMember('keelson-tasks'), serviceAccountMember('keelson-scheduler'), serviceAccountMember('keelson-api')].sort(),
    );
  });

  it('keeps the api public while only the scheduler holds run.invoker for its internal route', () => {
    expect(invokersOf('keelson-api').sort()).toEqual(['allUsers', serviceAccountMember('keelson-scheduler')].sort());
  });

  it('the probes queue limits dispatch to 5 per second, 20 concurrent, 5 attempts, backoff 10 s to 300 s', () => {
    const [queue] = ofType('gcp:cloudtasks/queue:Queue');

    expect(queue?.inputs['name']).toBe('probes');
    expect(queue?.inputs['rateLimits']).toEqual({ maxDispatchesPerSecond: 5, maxConcurrentDispatches: 20 });
    expect(queue?.inputs['retryConfig']).toMatchObject({ maxAttempts: PROBE_MAX_ATTEMPTS, minBackoff: '10s', maxBackoff: '300s' });
  });

  it('lets only the api enqueue on the queue', () => {
    const enqueuers = ofType('gcp:cloudtasks/queueIamMember:QueueIamMember').map(memberInputsOf);

    expect(enqueuers).toEqual([expect.objectContaining({ role: 'roles/cloudtasks.enqueuer', member: serviceAccountMember('keelson-api') })]);
  });

  it('scheduler runs dispatch on api and drain on worker every minute with OIDC tokens', () => {
    const jobs = ofType('gcp:cloudscheduler/job:Job').map((resource) => resource.inputs);
    const scheduler = serviceAccountEmail('keelson-scheduler', PROJECT);

    expect(jobs).toHaveLength(2);
    expect(jobs).toContainEqual(
      expect.objectContaining({
        schedule: '* * * * *',
        httpTarget: expect.objectContaining({ httpMethod: 'POST', uri: `${API_URL}/internal/dispatch`, oidcToken: { serviceAccountEmail: scheduler, audience: API_URL } }) as unknown,
      }),
    );
    expect(jobs).toContainEqual(
      expect.objectContaining({
        schedule: '* * * * *',
        httpTarget: expect.objectContaining({ httpMethod: 'POST', uri: `${WORKER_URL}/internal/outbox/drain`, oidcToken: { serviceAccountEmail: scheduler, audience: WORKER_URL } }) as unknown,
      }),
    );
  });

  it('DATABASE_URL reaches api and worker only as a Secret Manager reference, never a literal', () => {
    for (const serviceName of ['keelson-api', 'keelson-worker']) {
      const entry = environmentOf(serviceName).find((candidate) => candidate.name === 'DATABASE_URL');
      expect(entry?.value).toBeUndefined();
      expect(entry?.valueSource?.secretKeyRef).toEqual({ secret: 'database-url', version: 'latest' });
    }
  });

  it('gives the demo server its admin token only as a Secret Manager reference', () => {
    const entry = environmentOf('keelson-demo-server').find((candidate) => candidate.name === 'DEMO_ADMIN_TOKEN');

    expect(entry?.value).toBeUndefined();
    expect(entry?.valueSource?.secretKeyRef.secret).toBe('demo-admin-token');
  });

  it('leaves identities, secrets, custom roles and CI trust to the bootstrap stack', () => {
    const bootstrapOnly = [
      'gcp:serviceaccount/account:Account',
      'gcp:serviceaccount/iAMMember:IAMMember',
      'gcp:secretmanager/secret:Secret',
      'gcp:secretmanager/secretVersion:SecretVersion',
      'gcp:secretmanager/secretIamMember:SecretIamMember',
      'gcp:projects/iAMCustomRole:IAMCustomRole',
      'gcp:iam/workloadIdentityPool:WorkloadIdentityPool',
      'gcp:iam/workloadIdentityPoolProvider:WorkloadIdentityPoolProvider',
    ];

    expect(recorded.filter((resource) => bootstrapOnly.includes(resource.type))).toEqual([]);
  });

  it('makes no project-level IAM binding, so the deployer needs no right to edit project IAM', () => {
    const projectLevel = recorded.filter((resource) => /^gcp:projects\/iAM(Member|Binding|Policy|AuditConfig)/.test(resource.type));

    expect(projectLevel).toEqual([]);
  });

  it('wires the worker environment so its own config schema accepts it', () => {
    const environment = { ...literalEnvironment(environmentOf('keelson-worker')), DATABASE_URL: 'postgres://placeholder' };

    expect(loadWorkerConfig(environment)).toMatchObject({
      allowPrivateTargets: false,
      allowHttpTargets: false,
      secretStore: { kind: 'gcp', project: PROJECT },
      internalAuth: {
        mode: 'oidc',
        audience: WORKER_URL,
        allowedEmails: ['keelson-tasks', 'keelson-scheduler', 'keelson-api'].map((id) => serviceAccountEmail(id, PROJECT)),
      },
    });
  });

  it('wires the api environment so its own config schema accepts it', () => {
    const environment = { ...literalEnvironment(environmentOf('keelson-api')), DATABASE_URL: 'postgres://placeholder' };

    expect(loadApiConfig(environment)).toMatchObject({
      workerUrl: WORKER_URL,
      secretStore: { kind: 'gcp', project: PROJECT },
      internalAuth: { mode: 'oidc', audience: API_URL, allowedEmails: [serviceAccountEmail('keelson-scheduler', PROJECT)] },
      probeQueue: {
        kind: 'cloud-tasks',
        queuePath: `projects/${PROJECT}/locations/${REGION}/queues/probes`,
        invokerEmail: serviceAccountEmail('keelson-tasks', PROJECT),
      },
    });
  });

  it('runs the migrate job from the api image with the database secret reference', () => {
    const migrate = ofType('gcp:cloudrunv2/job:Job').find((job) => job.inputs['name'] === 'keelson-migrate');
    const inputs = JSON.stringify(migrate?.inputs);

    expect(inputs).toContain('apps/api/dist/commands/migrate.js');
    expect(inputs).toContain(`${REGION}-docker.pkg.dev/${PROJECT}/keelson/api:test-tag`);
    expect(inputs).toContain('"secret":"database-url"');
  });

  it('a log-based metric on probe.retries_exhausted feeds an alert policy', () => {
    const [metric] = ofType('gcp:logging/metric:Metric');
    const [policy] = ofType('gcp:monitoring/alertPolicy:AlertPolicy');
    const [channel] = ofType('gcp:monitoring/notificationChannel:NotificationChannel');

    expect(metric?.inputs['filter']).toContain('jsonPayload.event="probe.retries_exhausted"');
    expect(JSON.stringify(policy?.inputs['conditions'])).toContain(`logging.googleapis.com/user/${String(metric?.inputs['name'])}`);
    expect(policy?.inputs['notificationChannels']).toEqual([`projects/${PROJECT}/notificationChannels/channel-1`]);
    expect(channel?.inputs['labels']).toEqual({ email_address: ALERT_EMAIL });
  });

  it('never grants owner or editor to anyone', () => {
    const roles = recorded.map((resource) => resource.inputs['role']);

    expect(roles).not.toContain('roles/owner');
    expect(roles).not.toContain('roles/editor');
  });

  it('exports the public urls', () => {
    expect(Object.keys(programOutputs).sort()).toEqual(['apiUrl', 'demoServerUrl', 'workerUrl']);
  });
});
