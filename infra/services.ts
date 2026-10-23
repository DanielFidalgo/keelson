import * as gcp from '@pulumi/gcp';
import type * as pulumi from '@pulumi/pulumi';
import type { DeployConfig } from './config';
import { demoServerEnvironment, apiEnvironment, workerEnvironment, type EnvironmentEntry } from './environment';
import { memberOf } from './iam';
import { imageReference, type ImageApp } from './registry';
import type { ServiceAccounts } from './service-accounts';
import { API_SERVICE, DEMO_SERVER_SERVICE, WORKER_SERVICE, type ServiceUrls } from './service-urls';

const RUN_INVOKER_ROLE = 'roles/run.invoker';
const PUBLIC_MEMBER = 'allUsers';
// Bounds the bill if a client or a retry storm floods a service; probes are rate limited well below this anyway.
const MAX_INSTANCES = 5;
const MEMORY_LIMIT = '512Mi';
const CPU_LIMIT = '1';

export interface Services {
  api: gcp.cloudrunv2.Service;
  worker: gcp.cloudrunv2.Service;
  demoServer: gcp.cloudrunv2.Service;
}

export interface ServiceInputs {
  config: DeployConfig;
  accounts: ServiceAccounts;
  urls: ServiceUrls;
}

interface ServiceDefinition {
  name: string;
  app: ImageApp;
  runAs: string;
  environment: EnvironmentEntry[];
}

function createService(config: DeployConfig, definition: ServiceDefinition): gcp.cloudrunv2.Service {
  return new gcp.cloudrunv2.Service(definition.name, {
    name: definition.name,
    location: config.region,
    ingress: 'INGRESS_TRAFFIC_ALL',
    // Stateless services: a destroy must not be blocked by the provider's default guard.
    deletionProtection: false,
    template: {
      serviceAccount: definition.runAs,
      scaling: { maxInstanceCount: MAX_INSTANCES },
      containers: [
        {
          image: imageReference(config, definition.app),
          envs: definition.environment,
          resources: { limits: { cpu: CPU_LIMIT, memory: MEMORY_LIMIT } },
        },
      ],
    },
  });
}

function allowInvoker(service: gcp.cloudrunv2.Service, region: string, grantName: string, member: pulumi.Input<string>): gcp.cloudrunv2.ServiceIamMember {
  return new gcp.cloudrunv2.ServiceIamMember(grantName, { name: service.name, location: region, role: RUN_INVOKER_ROLE, member });
}

export function createServices({ config, accounts, urls }: ServiceInputs): Services {
  const environmentInputs = { config, accounts, urls };
  const api = createService(config, { name: API_SERVICE, app: 'api', runAs: accounts.api, environment: apiEnvironment(environmentInputs) });
  const worker = createService(config, { name: WORKER_SERVICE, app: 'worker', runAs: accounts.worker, environment: workerEnvironment(environmentInputs) });
  const demoServer = createService(config, { name: DEMO_SERVER_SERVICE, app: 'demo-server', runAs: accounts.demoServer, environment: demoServerEnvironment() });

  // The api authenticates callers itself with API keys, and its internal route verifies the scheduler's token.
  allowInvoker(api, config.region, 'keelson-api-public', PUBLIC_MEMBER);
  allowInvoker(api, config.region, 'keelson-api-scheduler', memberOf(accounts.scheduler));
  allowInvoker(demoServer, config.region, 'keelson-demo-server-public', PUBLIC_MEMBER);

  // The worker has no public caller: Cloud Run rejects every request that does not carry one of these identities.
  allowInvoker(worker, config.region, 'keelson-worker-tasks', memberOf(accounts.tasks));
  allowInvoker(worker, config.region, 'keelson-worker-scheduler', memberOf(accounts.scheduler));
  allowInvoker(worker, config.region, 'keelson-worker-api', memberOf(accounts.api));

  return { api, worker, demoServer };
}
