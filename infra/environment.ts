import type * as pulumi from '@pulumi/pulumi';
import type { DeployConfig } from './config';
import { PROBE_QUEUE_NAME } from './queue';
import { DATABASE_URL_SECRET, DEMO_ADMIN_TOKEN_SECRET } from './shared-names';
import type { ServiceAccounts } from './service-accounts';
import type { ServiceUrls } from './service-urls';

// Shaped to fit both the service and the job container types, which the provider declares separately.
export type EnvironmentEntry =
  | { name: string; value: pulumi.Input<string> }
  | { name: string; valueSource: { secretKeyRef: { secret: string; version: string } } };

interface EnvironmentInputs {
  config: DeployConfig;
  accounts: ServiceAccounts;
  urls: ServiceUrls;
}

function literal(name: string, value: pulumi.Input<string>): EnvironmentEntry {
  return { name, value };
}

// A reference makes Cloud Run read the value at start-up, so it never appears in the service definition or in Pulumi state.
function secretReference(name: string, secretId: string): EnvironmentEntry {
  return { name, valueSource: { secretKeyRef: { secret: secretId, version: 'latest' } } };
}

// Production never takes the weaker local options the config schemas offer, so each is set explicitly.
const PRODUCTION_PLATFORM = [literal('INTERNAL_AUTH_MODE', 'oidc'), literal('SECRET_STORE', 'gcp')];

// The api also runs as the migrate and create-tenant jobs, which load the same configuration.
export function apiEnvironment({ config, accounts, urls }: EnvironmentInputs): EnvironmentEntry[] {
  return [
    ...PRODUCTION_PLATFORM,
    secretReference('DATABASE_URL', DATABASE_URL_SECRET),
    literal('API_URL', urls.api),
    literal('WORKER_URL', urls.worker),
    literal('INTERNAL_INVOKER_EMAILS', accounts.scheduler),
    literal('GCP_PROJECT', config.project),
    literal('GCP_LOCATION', config.region),
    literal('PROBE_QUEUE', PROBE_QUEUE_NAME),
    literal('TASKS_INVOKER_EMAIL', accounts.tasks),
  ];
}

export function workerEnvironment({ config, accounts, urls }: EnvironmentInputs): EnvironmentEntry[] {
  return [
    ...PRODUCTION_PLATFORM,
    secretReference('DATABASE_URL', DATABASE_URL_SECRET),
    literal('WORKER_URL', urls.worker),
    // The api is a caller too: it asks the worker to inspect a server before a monitor is saved.
    literal('INTERNAL_INVOKER_EMAILS', `${accounts.tasks},${accounts.scheduler},${accounts.api}`),
    literal('GCP_PROJECT', config.project),
    literal('ALLOW_PRIVATE_TARGETS', 'false'),
    literal('ALLOW_HTTP_TARGETS', 'false'),
  ];
}

export function demoServerEnvironment(): EnvironmentEntry[] {
  return [secretReference('DEMO_ADMIN_TOKEN', DEMO_ADMIN_TOKEN_SECRET)];
}
